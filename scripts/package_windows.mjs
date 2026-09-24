import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const rootDir = process.cwd();
// Artifact names derive from the version in package.json.
const VERSION = JSON.parse(fs.readFileSync(path.resolve(rootDir, "package.json"), "utf-8")).version;

const releaseExePath = path.resolve(rootDir, "src-tauri/target/release/omnivault.exe");
const releaseDistDir = path.resolve(rootDir, `release/omnivault-v${VERSION}-windows-x64`);
const targetExePath = path.resolve(releaseDistDir, "omnivault.exe");
const zipPath = path.resolve(rootDir, `release/omnivault-v${VERSION}-windows-x64.zip`);
const shaSumsPath = path.resolve(rootDir, "release/SHA256SUMS.txt");
const releaseNotesPath = path.resolve(rootDir, "release/RELEASE_NOTES.md");

console.log("\n=======================================================");
console.log("   OmniVault Windows Release Packaging & Verification");
console.log("=======================================================\n");

// 1. Verify release binary exists
if (!fs.existsSync(releaseExePath)) {
  console.error("❌ Release binary not found at:", releaseExePath);
  console.error("Run `npm run build:release` first.");
  process.exit(1);
}

const stats = fs.statSync(releaseExePath);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`[1/5] Found release binary: ${releaseExePath}`);
console.log(`      Binary size: ${stats.size.toLocaleString()} bytes (${sizeMB} MB)`);

// 2. Size budget: the binary must stay under 15 MB.
const MAX_BUDGET_MB = 15;
if (stats.size > MAX_BUDGET_MB * 1024 * 1024) {
  console.error(`❌ Binary size exceeds ${MAX_BUDGET_MB} MB budget! Actual: ${sizeMB} MB`);
  process.exit(1);
}
console.log(`[2/5] Size budget check passed (< ${MAX_BUDGET_MB} MB budget): ✅ PASS`);

// 3. Stage the binary and web assets. The staging directory is emptied
// first: Vite names output by content hash, so old bundles would pile up.
const staleAssets = path.resolve(releaseDistDir, "dist");
fs.rmSync(staleAssets, { recursive: true, force: true });
fs.rmSync(path.resolve(rootDir, "release/dist"), { recursive: true, force: true });
fs.mkdirSync(releaseDistDir, { recursive: true });
try {
  fs.copyFileSync(releaseExePath, targetExePath);
} catch (err) {
  if (err && err.code === "EBUSY") {
    console.warn(
      "⚠️ Notice: Target release executable is currently running and locked. Preserved running binary.",
    );
  } else {
    throw err;
  }
}

try {
  fs.copyFileSync(releaseExePath, path.resolve(rootDir, "release/omnivault.exe"));
} catch (err) {
  if (err && err.code === "EBUSY") {
    console.warn(
      "⚠️ Notice: release/omnivault.exe is currently running and locked. Preserved running binary.",
    );
  } else {
    throw err;
  }
}

// Copy compiled web assets (dist/) for embedded LAN server PWA
const sourceDistDir = path.resolve(rootDir, "dist");
if (fs.existsSync(sourceDistDir)) {
  fs.cpSync(sourceDistDir, path.resolve(releaseDistDir, "dist"), { recursive: true });
  fs.cpSync(sourceDistDir, path.resolve(rootDir, "release/dist"), { recursive: true });
  console.log("      Copied web PWA static assets (dist/) to release packages.");
}

const readmeContent = `OmniVault v${VERSION} - Windows Release (x86_64)
==============================================

OmniVault is a private, local-first cross-device personal workspace and knowledge vault
with nested folders, instant capture, and asynchronous store-and-forward mesh
synchronization over local Wi-Fi.

Requirements:
- Windows 10 / 11 (64-bit)
- Zero cloud account required
- Zero external runtime required (WebView2 is built into modern Windows)

Quick Start:
1. Double-click \`omnivault.exe\` to launch the desktop application.
2. Open Quick Inbox (Ctrl+Shift+I) to instantly capture ideas, notes, charts, and links.
3. Click "Connect Mobile" in the top bar to display the local Wi-Fi QR code.
4. Scan the QR code with your iPhone, iPad, or Android phone to access OmniVault
   over your local Wi-Fi with zero installation!

Documentation & Architecture:
- Embedded HTTP Server: http://0.0.0.0:42420
- Decentralized mDNS Discovery + TCP Delta Mesh Sync
- 100% Offline Capable & Private
`;

fs.writeFileSync(path.resolve(releaseDistDir, "README.txt"), readmeContent, "utf-8");
console.log(`[3/5] Staged release files to: ${releaseDistDir}`);

// 4. Create ZIP archive
try {
  const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${releaseDistDir}/*' -DestinationPath '${zipPath}' -Force"`;
  execSync(psCmd, { stdio: "pipe" });
  const zipStats = fs.statSync(zipPath);
  const zipMB = (zipStats.size / (1024 * 1024)).toFixed(2);
  console.log(`[4/5] Compressed release archive created: ${zipPath} (${zipMB} MB)`);
} catch (err) {
  console.warn("⚠️ Warning: Could not create zip archive via PowerShell:", err.message);
}

// 5. Generate SHA-256 checksums & GitHub Release Notes
const exeBuffer = fs.readFileSync(targetExePath);
const exeHash = crypto.createHash("sha256").update(exeBuffer).digest("hex");
let checksumLines = `${exeHash}  omnivault.exe\n`;

if (fs.existsSync(zipPath)) {
  const zipBuffer = fs.readFileSync(zipPath);
  const zipHash = crypto.createHash("sha256").update(zipBuffer).digest("hex");
  checksumLines += `${zipHash}  omnivault-v${VERSION}-windows-x64.zip\n`;
}

fs.writeFileSync(shaSumsPath, checksumLines, "utf-8");

// Release notes. Keep them consistent with the README: no platform or
// security claims the app does not meet.
const releaseNotesContent = `# OmniVault v${VERSION}

Send yourself a note from your phone and find it on your laptop, without
opening a browser tab that takes forty seconds and a gigabyte of memory.

Notes, links, screenshots and tickers, kept in folders you choose. Every
device holds its own complete copy. When two of them are awake on the same
Wi-Fi they find each other and exchange what changed.

## What it will not do

There is no server in between. A note written on your phone reaches your
laptop the next time both are open on the same network — not before. Sync
traffic is not encrypted; this is built for a network you control. See the
threat model in the README before using it on shared Wi-Fi.

## Installing

**Windows** — download the zip, extract it, run \`omnivault.exe\`. No installer
and no runtime to install. Windows will warn that the app is unrecognised,
because the binary is not code-signed.

**Android** — download the APK and open it. Android will ask you to allow
installs from your browser or file manager. One APK covers phones and tablets.

Both are unsigned by a paid authority, so both warn. That is the cost of not
paying a certificate authority, not a sign that something is wrong.

## Verifying what you downloaded

\`SHA256SUMS.txt\` lists the checksum of each file.

## Known limits

- Windows and Android only. There is no iOS or macOS build.
- Devices sync only while both are open on the same network.
- Deleting a note is immediate and cannot be undone.
`;

fs.writeFileSync(releaseNotesPath, releaseNotesContent, "utf-8");

console.log(`[5/5] Generated SHA-256 checksums & GitHub Release Notes:`);
console.log(`      Saved to: ${shaSumsPath}`);
console.log(`      Saved to: ${releaseNotesPath}\n`);

console.log("-------------------------------------------------------");
console.log(`✅ Standalone Windows release package ready in release/!`);
console.log("=======================================================\n");
