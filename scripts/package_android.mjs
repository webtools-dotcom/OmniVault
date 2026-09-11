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

// 2. Size budget check (< 15MB budget)
const MAX_BUDGET_MB = 15;
if (stats.size > MAX_BUDGET_MB * 1024 * 1024) {
  console.error(`❌ APK size exceeds ${MAX_BUDGET_MB} MB budget! Actual: ${sizeMB} MB`);
  process.exit(1);
}
console.log(`[2/4] Size budget check passed (< ${MAX_BUDGET_MB} MB budget): ✅ PASS`);

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
