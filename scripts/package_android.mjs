import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const rootDir = process.cwd();
const releaseApkPath = path.resolve(
  rootDir,
  "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
);
const debugApkPath = path.resolve(
  rootDir,
  "src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
);

const targetApkDir = path.resolve(rootDir, "release");
const targetApkPath = path.resolve(targetApkDir, "omnivault-v0.1.0-android.apk");
const apkShaPath = path.resolve(targetApkDir, "omnivault-v0.1.0-android.apk.sha256");
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

// 3. Stage APK to release directory
fs.mkdirSync(targetApkDir, { recursive: true });
fs.copyFileSync(sourceApkPath, targetApkPath);
console.log(`[3/4] Staged release APK to: ${targetApkPath}`);

// 4. Generate SHA-256 Checksums
const apkBuffer = fs.readFileSync(targetApkPath);
const apkHash = crypto.createHash("sha256").update(apkBuffer).digest("hex");

fs.writeFileSync(apkShaPath, `${apkHash}  omnivault-v0.1.0-android.apk\n`, "utf-8");
console.log(`[4/4] Generated SHA-256 checksum:`);
console.log(`      ${apkHash}  omnivault-v0.1.0-android.apk`);
console.log(`      Saved to: ${apkShaPath}`);

// Append or update in master SHA256SUMS.txt
if (fs.existsSync(shaSumsPath)) {
  let lines = fs
    .readFileSync(shaSumsPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0 && !l.includes("omnivault-v0.1.0-android.apk"));
  lines.push(`${apkHash}  omnivault-v0.1.0-android.apk`);
  fs.writeFileSync(shaSumsPath, lines.join("\n") + "\n", "utf-8");
  console.log(`      Updated master checksum file: ${shaSumsPath}`);
} else {
  fs.writeFileSync(shaSumsPath, `${apkHash}  omnivault-v0.1.0-android.apk\n`, "utf-8");
}

console.log("\n-------------------------------------------------------");
console.log(`✅ Standalone Android APK ready in release/!`);
console.log("=======================================================\n");
