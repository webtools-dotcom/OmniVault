import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const rootDir = process.cwd();
const releaseExePath = path.resolve(rootDir, "src-tauri/target/release/omnivault.exe");
const releaseDistDir = path.resolve(rootDir, "release/omnivault-v0.1.0-windows-x64");
const targetExePath = path.resolve(releaseDistDir, "omnivault.exe");
const zipPath = path.resolve(rootDir, "release/omnivault-v0.1.0-windows-x64.zip");
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

// 2. Size budget check (< 15MB target from APP.md / DECISIONS.md)
const MAX_BUDGET_MB = 15;
if (stats.size > MAX_BUDGET_MB * 1024 * 1024) {
  console.error(`❌ Binary size exceeds ${MAX_BUDGET_MB} MB budget! Actual: ${sizeMB} MB`);
  process.exit(1);
}
console.log(`[2/5] Size budget check passed (< ${MAX_BUDGET_MB} MB budget): ✅ PASS`);

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
  checksumLines += `${zipHash}  omnivault-v0.1.0-windows-x64.zip\n`;
}

fs.writeFileSync(shaSumsPath, checksumLines, "utf-8");

const releaseNotesContent = `# OmniVault v0.1.0 - Initial Release 🚀

OmniVault is a private, local-first cross-device personal workspace with nested folders, instant capture, and asynchronous store-and-forward mesh synchronization over local Wi-Fi.

## ✨ Highlights
- **100% Offline & Decentralized:** Pure local SQLite storage; zero third-party cloud servers or account signups.
- **Ultra-Compact Binary:** Standalone Windows executable (~6.1 MB) with zero external runtime requirements.
- **Cross-Device Zero-Install Web App (PWA):** Embedded Rust HTTP server (port 42420) and instant QR code connection modal for iPhones, iPads, and Android devices.
- **Deep Hierarchical Folders:** Infinite nesting, tree explorer sidebar, drag-and-drop filing, and 1-click triage modal.
- **Fast 1-Tap Quick Inbox:** Instant capture bar for notes, tickers, and links with Ctrl+Enter persistence.
- **Smart Market Launcher:** Auto-detects cashtag and ticker symbols with 1-click TradingView and Yahoo Finance launchers.
- **Rich Media & Lightbox:** Global clipboard screenshot interceptor (Ctrl+V), local WebP conversion, and pan-and-zoom lightbox.
- **Store-and-Forward Mesh Sync:** mDNS zero-configuration discovery, 6-digit PIN pairing, and bidirectional TCP delta sync with LWW conflict resolution.

## 📦 Assets
- omnivault-v0.1.0-windows-x64.zip (Portable release archive)
- omnivault.exe (Standalone executable)
- SHA256SUMS.txt (Cryptographic verification checksums)
`;

fs.writeFileSync(releaseNotesPath, releaseNotesContent, "utf-8");

console.log(`[5/5] Generated SHA-256 checksums & GitHub Release Notes:`);
console.log(`      Saved to: ${shaSumsPath}`);
console.log(`      Saved to: ${releaseNotesPath}\n`);

console.log("-------------------------------------------------------");
console.log(`✅ Standalone Windows release package ready in release/!`);
console.log("=======================================================\n");
