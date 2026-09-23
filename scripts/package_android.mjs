import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
// The version comes from package.json and nowhere else. It used to be typed
// into artifact filenames in three scripts, so a release meant editing ten
// hardcoded strings by hand and the version guard only ever checked three
// files. See D-085.
const VERSION = JSON.parse(fs.readFileSync(path.resolve(rootDir, "package.json"), "utf-8")).version;

const releaseApkPath = path.resolve(
  rootDir,
  "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
);
const debugApkPath = path.resolve(
  rootDir,
  "src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
);

const targetApkDir = path.resolve(rootDir, "release");
const targetApkPath = path.resolve(targetApkDir, `omnivault-v${VERSION}-android.apk`);
const apkShaPath = path.resolve(targetApkDir, `omnivault-v${VERSION}-android.apk.sha256`);
const shaSumsPath = path.resolve(targetApkDir, "SHA256SUMS.txt");

console.log("\n=======================================================");
console.log("   OmniVault Android APK Release Packaging");
console.log("=======================================================\n");

// 1. Locate release APK (or fallback to universal debug APK if release not built)
let sourceApkPath = releaseApkPath;
let isReleaseBuild = true;

if (!fs.existsSync(sourceApkPath)) {
  if (fs.existsSync(debugApkPath)) {
    console.warn("⚠️ Warning: Release APK not found. Using debug universal APK as fallback.");
    sourceApkPath = debugApkPath;
    isReleaseBuild = false;
  } else {
    console.error("❌ Android APK not found!");
    console.error("Expected at:", releaseApkPath);
    console.error("Run `npm run build:android` or `cargo tauri android build --apk` first.");
    process.exit(1);
  }
}

const stats = fs.statSync(sourceApkPath);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`[1/4] Found Android APK: ${sourceApkPath}`);
console.log(`      Build type: ${isReleaseBuild ? "Optimized Release (Signed)" : "Debug"}`);
console.log(`      APK size: ${stats.size.toLocaleString()} bytes (${sizeMB} MB)`);

// 2. Size budget check.
//
// The budget exists to catch this project's own code growing, and a flat
// ceiling on the whole APK stopped measuring that the moment the build went
// universal: one APK carrying arm64, armeabi-v7a and x86_64 holds three copies
// of the same library, so the file tripled while the code did not change at
// all. Judging the package by its total would have meant either failing a
// build that got no heavier, or raising a number until it stopped complaining
// — which is how a budget quietly stops being one.
//
// So the code is measured per ABI, against the original 15 MB, and the package
// as a whole gets a separate and looser ceiling that still catches assets or
// ABIs piling up unnoticed. See D-084.
const MAX_CODE_MB = 15;
const MAX_PACKAGE_MB = 32;

const abiSizes = new Map();

// Read the APK's central directory to size each ABI's payload.
const apkBuf = fs.readFileSync(sourceApkPath);
{
  const eocd = apkBuf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd > -1) {
    let count = apkBuf.readUInt16LE(eocd + 10);
    let pos = apkBuf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count && pos + 46 <= apkBuf.length; i++) {
      if (apkBuf.readUInt32LE(pos) !== 0x02014b50) break;
      const compressed = apkBuf.readUInt32LE(pos + 20);
      const uncompressed = apkBuf.readUInt32LE(pos + 24);
      const nameLen = apkBuf.readUInt16LE(pos + 28);
      const extraLen = apkBuf.readUInt16LE(pos + 30);
      const commentLen = apkBuf.readUInt16LE(pos + 32);
      const name = apkBuf.subarray(pos + 46, pos + 46 + nameLen).toString("utf-8");
      const m = name.match(/^lib\/([^/]+)\//);
      if (m) {
        abiSizes.set(m[1], (abiSizes.get(m[1]) || 0) + Math.max(compressed, uncompressed));
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
  }
}

if (abiSizes.size === 0) {
  console.error("❌ No native libraries found in the APK — it would not run on any device.");
  process.exit(1);
}

const abiReport = [...abiSizes.entries()]
  .map(([abi, bytes]) => `${abi} ${(bytes / (1024 * 1024)).toFixed(2)} MB`)
  .join(", ");
console.log(`      ABIs: ${abiReport}`);

const largestAbi = Math.max(...abiSizes.values());
if (largestAbi > MAX_CODE_MB * 1024 * 1024) {
  console.error(
    `❌ Native code for one ABI exceeds ${MAX_CODE_MB} MB! Actual: ${(largestAbi / (1024 * 1024)).toFixed(2)} MB`
  );
  process.exit(1);
}
if (stats.size > MAX_PACKAGE_MB * 1024 * 1024) {
  console.error(`❌ APK exceeds the ${MAX_PACKAGE_MB} MB package ceiling! Actual: ${sizeMB} MB`);
  process.exit(1);
}
console.log(
  `[2/4] Size budget check passed (code < ${MAX_CODE_MB} MB per ABI, package < ${MAX_PACKAGE_MB} MB): ✅ PASS`
);


/**
 * The APK must declare the version this repository says it is.
 *
 * Gradle does not track `tauri.properties` as an input to its resource task,
 * so a version bump followed by an incremental build produces an APK whose
 * manifest still carries the previous versionName — a package that says 0.1.0
 * while the release around it says 0.1.1. Nothing caught that: the existing
 * version guard compares package.json, tauri.conf.json and updates.ts to each
 * other, and never asks the artifact. See D-085.
 */
function findAapt2() {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
  const dir = path.join(sdk, "build-tools");
  if (!fs.existsSync(dir)) return null;
  const versions = fs
    .readdirSync(dir)
    .filter((v) => /^\d/.test(v))
    .sort()
    .reverse();
  for (const v of versions) {
    for (const name of ["aapt2.exe", "aapt2"]) {
      const bin = path.join(dir, v, name);
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

const aapt2 = findAapt2();
if (!aapt2) {
  // Skipping loudly beats failing on a machine with no Android SDK, but it
  // must be visible that the check did not run.
  console.log("      ⚠️  aapt2 not found — APK version NOT verified against package.json.");
} else {
  const badging = execFileSync(aapt2, ["dump", "badging", sourceApkPath], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const declared = (badging.match(/versionName='([^']*)'/) || [])[1];
  if (declared !== VERSION) {
    console.error(
      `❌ The APK declares versionName='${declared}' but this repository is ${VERSION}.`
    );
    console.error("   Gradle reused a stale manifest. Delete src-tauri/gen/android/app/build and rebuild.");
    process.exit(1);
  }
  console.log(`      APK declares versionName=${declared}: ✅ matches package.json`);
}

// 3. Stage APK to release directory
fs.mkdirSync(targetApkDir, { recursive: true });
fs.copyFileSync(sourceApkPath, targetApkPath);
console.log(`[3/4] Staged release APK to: ${targetApkPath}`);

// 4. Generate SHA-256 Checksums
const apkBuffer = fs.readFileSync(targetApkPath);
const apkHash = crypto.createHash("sha256").update(apkBuffer).digest("hex");

fs.writeFileSync(apkShaPath, `${apkHash}  omnivault-v${VERSION}-android.apk\n`, "utf-8");
console.log(`[4/4] Generated SHA-256 checksum:`);
console.log(`      ${apkHash}  omnivault-v${VERSION}-android.apk`);
console.log(`      Saved to: ${apkShaPath}`);

// Append or update in master SHA256SUMS.txt
if (fs.existsSync(shaSumsPath)) {
  let lines = fs
    .readFileSync(shaSumsPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0 && !l.includes(`omnivault-v${VERSION}-android.apk`));
  lines.push(`${apkHash}  omnivault-v${VERSION}-android.apk`);
  fs.writeFileSync(shaSumsPath, lines.join("\n") + "\n", "utf-8");
  console.log(`      Updated master checksum file: ${shaSumsPath}`);
} else {
  fs.writeFileSync(shaSumsPath, `${apkHash}  omnivault-v${VERSION}-android.apk\n`, "utf-8");
}

console.log("\n-------------------------------------------------------");
console.log(`✅ Standalone Android APK ready in release/!`);
console.log("=======================================================\n");
