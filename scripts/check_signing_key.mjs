/**
 * Fails the build if the packaged APK is signed with anything other than the
 * key recorded in SIGNING-KEY.md.
 *
 * This is the guard for the one mistake in the project with no recovery: an APK
 * signed with a different key cannot be installed over an existing copy, so the
 * person on the other end has to uninstall — and uninstalling takes their vault
 * with it. The mistake is silent at build time and permanent at install time,
 * which is exactly the shape of thing a machine should be checking rather than
 * a person remembering. See P12-T03 and D-074.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const APK = path.join(root, "release", "omnivault-v0.1.0-android.apk");
const NOTE = path.join(root, "SIGNING-KEY.md");

function expectedFingerprint() {
  const doc = fs.readFileSync(NOTE, "utf-8");
  const match = doc.match(/\b([0-9a-f]{64})\b/);
  if (!match) {
    throw new Error("SIGNING-KEY.md no longer records a SHA-256 fingerprint.");
  }
  return match[1];
}

/**
 * apksigner ships with the build tools. The jar is invoked directly rather
 * than the .bat wrapper, which Node cannot spawn without a shell — and a shell
 * would mean quoting a path with spaces in it correctly on every platform.
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
      "so the APK's signing key was not verified. Do not publish this build from here."
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
  console.error("    destroys their vault. See SIGNING-KEY.md.");
  console.error("");
  process.exit(1);
}

console.log(`  › APK signing key verified (${found.slice(0, 12)}…).`);
