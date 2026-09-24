/**
 * Builds the universal Android APK.
 *
 * Gradle does not track `tauri.properties` as an input, so after a version bump
 * an incremental build would ship the previous versionName. `tauri.properties`
 * still holds the last build's version until the Tauri CLI regenerates it, so
 * when it differs from package.json the Gradle output is cleared first.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const VERSION = JSON.parse(fs.readFileSync(path.resolve(rootDir, "package.json"), "utf-8")).version;

const gradleBuildDir = path.resolve(rootDir, "src-tauri/gen/android/app/build");
const propsPath = path.resolve(rootDir, "src-tauri/gen/android/app/tauri.properties");

let lastBuilt = null;
if (fs.existsSync(propsPath)) {
  const props = fs.readFileSync(propsPath, "utf-8");
  lastBuilt = (props.match(/tauri\.android\.versionName=(.+)/) || [])[1]?.trim() ?? null;
}

if (lastBuilt !== null && lastBuilt !== VERSION && fs.existsSync(gradleBuildDir)) {
  console.log(`  › Version changed since the last Android build (${lastBuilt} → ${VERSION}).`);
  console.log("    Clearing Gradle output so the manifest is regenerated.");
  fs.rmSync(gradleBuildDir, { recursive: true, force: true });
} else if (lastBuilt === null) {
  console.log("  › No previous Android build recorded; building from scratch.");
} else {
  console.log(`  › Version unchanged since the last Android build (${VERSION}).`);
}

const args = ["tauri", "android", "build", "--target", "aarch64", "armv7", "x86_64", "--apk"];
const result = spawnSync("cargo", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
