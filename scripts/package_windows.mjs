import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const rootDir = process.cwd();
const releaseExePath = path.resolve(rootDir, "src-tauri/target/release/omnivault.exe");
const releaseDistDir = path.resolve(rootDir, "release/omnivault-v0.1.0-windows-x64");
const targetExePath = path.resolve(releaseDistDir, "omnivault.exe");
const shaSumsPath = path.resolve(rootDir, "release/SHA256SUMS.txt");

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
console.log(`[1/4] Found release binary: ${releaseExePath}`);
console.log(`      Binary size: ${stats.size.toLocaleString()} bytes (${sizeMB} MB)`);

// 2. Size budget check (< 15MB target from APP.md / DECISIONS.md)
const MAX_BUDGET_MB = 15;
if (stats.size > MAX_BUDGET_MB * 1024 * 1024) {
  console.error(`❌ Binary size exceeds ${MAX_BUDGET_MB} MB budget! Actual: ${sizeMB} MB`);
  process.exit(1);
}
console.log(`[2/4] Size budget check passed (< ${MAX_BUDGET_MB} MB budget): ✅ PASS`);

// 3. Create release directory & copy standalone binary
fs.mkdirSync(releaseDistDir, { recursive: true });
fs.copyFileSync(releaseExePath, targetExePath);

const readmeContent = `OmniVault v0.1.0 - Windows Release (x86_64)
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
console.log(`[3/4] Staged release files to: ${releaseDistDir}`);

// 4. Generate SHA-256 checksum
const exeBuffer = fs.readFileSync(targetExePath);
const hash = crypto.createHash("sha256").update(exeBuffer).digest("hex");
const checksumLine = `${hash}  omnivault.exe\n`;
fs.writeFileSync(shaSumsPath, checksumLine, "utf-8");

console.log(`[4/4] Generated SHA-256 checksum:`);
console.log(`      ${hash}`);
console.log(`      Saved to: ${shaSumsPath}\n`);

console.log("-------------------------------------------------------");
console.log(`✅ Standalone Windows release package ready in release/!`);
console.log("=======================================================\n");
