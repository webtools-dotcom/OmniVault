/**
 * Fails if the packaged APK is not signed with the release key recorded in
 * docs/ANDROID_SIGNING.md. A differently signed APK cannot be installed over
 * an existing copy, and uninstalling deletes the user's vault.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const VERSION = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).version;
const APK = path.join(root, "release", `omnivault-v${VERSION}-android.apk`);
const NOTE = path.join(root, "docs", "ANDROID_SIGNING.md");

function expectedFingerprint() {
  const doc = fs.readFileSync(NOTE, "utf-8");
  const match = doc.match(/\b([0-9a-f]{64})\b/);
  if (!match) {
    throw new Error("docs/ANDROID_SIGNING.md no longer records a SHA-256 fingerprint.");
  }
  return match[1];
}

/**
 * Locates apksigner.jar in the Android build tools. The jar is run directly
 * because Node cannot spawn the .bat wrapper without a shell.
 */
function findApksignerJar() {
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
    const jar = path.join(dir, v, "lib", "apksigner.jar");
    if (fs.existsSync(jar)) return jar;
  }
  return null;
}
function findJavaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const guesses = [
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    "C:\\Program Files\\Android\\Android Studio\\jre",
  ];
  return guesses.find((g) => fs.existsSync(path.join(g, "bin", "java.exe"))) || null;
}

const expected = expectedFingerprint();

if (!fs.existsSync(APK)) {
  console.log("  › No packaged APK to check — skipping the signing key check.");
  process.exit(0);
}

const apksignerJar = findApksignerJar();
const javaHome = findJavaHome();

if (!apksignerJar || !javaHome) {
  // Skipping loudly beats failing on a machine with no Android SDK, but it must
  // never look like the check passed.
  console.log(
    "  › NOT CHECKED: the Android build tools or a JDK are missing on this machine, " +
      "so the APK's signing key was not verified. Do not publish this build from here.",
  );
  process.exit(0);
}

let out;
try {
  const java = path.join(javaHome, "bin", "java.exe");
  const javaBin = fs.existsSync(java) ? java : path.join(javaHome, "bin", "java");
  out = execFileSync(javaBin, ["-jar", apksignerJar, "verify", "--print-certs", APK], {
    encoding: "utf-8",
  });
} catch (err) {
  console.error("  › The APK could not be verified at all:");
  console.error(String(err.stdout || err.message).trim());
  process.exit(1);
}

const found = (out.match(/SHA-256 digest:\s*([0-9a-f]{64})/i) || [])[1];

if (!found) {
  console.error("  › The APK reported no SHA-256 certificate digest. Is it signed at all?");
  process.exit(1);
}

if (found !== expected) {
  console.error("");
  console.error("  ✖ THE APK IS SIGNED WITH THE WRONG KEY.");
  console.error(`      expected  ${expected}`);
  console.error(`      found     ${found}`);
  console.error("");
  console.error("    Shipping this build would mean nobody can install it over the copy");
  console.error("    they already have. They would have to uninstall first, and that");
  console.error("    destroys their vault. See docs/ANDROID_SIGNING.md.");
  console.error("");
  process.exit(1);
}

console.log(`  › APK signing key verified (${found.slice(0, 12)}…).`);
