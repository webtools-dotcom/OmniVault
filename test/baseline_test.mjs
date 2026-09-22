import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

console.log("Running OmniVault baseline test suite...");

// 1. Verify file presence
const requiredFiles = [
  "APP.md",
  "AGENTS.md",
  "DECISIONS.md",
  "TASKS.md",
  "PROJECT_STATE.md",
  "design/DESIGN_TOKENS.md",
  "package.json",
  "vite.config.ts",
  "tailwind.config.js",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/main.rs",
  "src-tauri/src/lib.rs",
  "src/App.tsx",
  "src/main.tsx",
  "src/index.css",
  "src/types/index.ts",
  "src/components/layout/AppLayout.tsx",
  "src/components/layout/Sidebar.tsx",
  "src/components/layout/Breadcrumbs.tsx",
  "src/components/layout/ContentPane.tsx",
  "src/components/common/Button.tsx",
  "src/components/common/Badge.tsx",
  "src/utils/folderTree.ts",
  "src/services/storageService.ts",
  "src/components/folders/FolderTree.tsx",
  "src/components/folders/FolderTreeItem.tsx",
  "src/components/folders/CreateFolderModal.tsx",
  "src/components/folders/RenameFolderModal.tsx",
  "src/components/folders/MoveFolderModal.tsx",
  "src/components/folders/DeleteFolderModal.tsx",
  "src/components/inbox/QuickCaptureBar.tsx",
  "src/components/inbox/QuickInboxItemCard.tsx",
  "src/components/inbox/MoveItemModal.tsx",
  "src/components/inbox/QuickInboxView.tsx",
  "src/utils/markdown.tsx",
  "src/components/editor/MarkdownToolbar.tsx",
  "src/components/editor/NoteEditorModal.tsx",
  "src/components/media/ImageLightbox.tsx",
  "src/hooks/useClipboardPaste.ts",
  "src/utils/tickerDetector.ts",
  "src/utils/linkDetector.ts",
  "src/components/research/SmartMarketLauncher.tsx",
  "src-tauri/src/http_server.rs",
  "src/utils/qrCode.ts",
  "src/components/pairing/QrConnectModal.tsx",
  "public/manifest.json",
  "public/sw.js",
  "scripts/package_windows.mjs",
  "README.md",
  "LICENSE"
];

for (const relPath of requiredFiles) {
  const fullPath = path.resolve(process.cwd(), relPath);
  assert.ok(fs.existsSync(fullPath), `Required file missing: ${relPath}`);
}

// 2. Verify design tokens file has WCAG AA compliant colors defined
const tokensContent = fs.readFileSync(path.resolve(process.cwd(), "design/DESIGN_TOKENS.md"), "utf-8");
assert.ok(tokensContent.includes("#0D1117"), "Token #0D1117 missing");
assert.ok(tokensContent.includes("#F0F6FC"), "Token #F0F6FC missing");

// 3. Verify tauri.conf.json identifier and product name
const tauriConfig = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf-8"));
assert.strictEqual(tauriConfig.productName, "OmniVault");
assert.strictEqual(tauriConfig.identifier, "com.omnivault.app");

// 4. Verify P4-T03 drag-and-drop triage and filing capabilities
const itemCardContent = fs.readFileSync(path.resolve(process.cwd(), "src/components/inbox/QuickInboxItemCard.tsx"), "utf-8");
assert.ok(itemCardContent.includes("draggable"), "QuickInboxItemCard missing draggable attribute");
assert.ok(itemCardContent.includes("application/x-omnivault-item"), "QuickInboxItemCard missing drag data type");

const treeItemContent = fs.readFileSync(path.resolve(process.cwd(), "src/components/folders/FolderTreeItem.tsx"), "utf-8");
assert.ok(treeItemContent.includes("onDragOver"), "FolderTreeItem missing onDragOver drop target handler");
assert.ok(treeItemContent.includes("onDrop"), "FolderTreeItem missing onDrop drop target handler");
assert.ok(treeItemContent.includes("onMoveItem"), "FolderTreeItem missing onMoveItem prop");

const moveModalContent = fs.readFileSync(path.resolve(process.cwd(), "src/components/inbox/MoveItemModal.tsx"), "utf-8");
assert.ok(moveModalContent.includes("handleDirectMove"), "MoveItemModal missing 1-click handleDirectMove triage handler");
assert.ok(moveModalContent.includes("folderPaths"), "MoveItemModal missing hierarchical folderPaths computation");

// 5. Verify P5-T01 Embedded HTTP server capabilities
const httpServerContent = fs.readFileSync(path.resolve(process.cwd(), "src-tauri/src/http_server.rs"), "utf-8");
assert.ok(httpServerContent.includes("start_http_server"), "http_server.rs missing start_http_server function");
assert.ok(httpServerContent.includes("get_lan_connection_info"), "http_server.rs missing get_lan_connection_info function");
assert.ok(httpServerContent.includes("/api/lan-info"), "http_server.rs missing /api/lan-info route");
assert.ok(httpServerContent.includes("/api/health"), "http_server.rs missing /api/health route");

const libContent = fs.readFileSync(path.resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf-8");
assert.ok(libContent.includes("get_lan_connection_info_cmd"), "lib.rs missing get_lan_connection_info_cmd Tauri command");
assert.ok(libContent.includes("start_http_server"), "lib.rs missing start_http_server call");

// 6. Verify P5-T02 QR code connection modal capabilities
const qrCodeContent = fs.readFileSync(path.resolve(process.cwd(), "src/utils/qrCode.ts"), "utf-8");
assert.ok(qrCodeContent.includes("generateQrMatrix"), "qrCode.ts missing generateQrMatrix function");
assert.ok(qrCodeContent.includes("generateQrPath"), "qrCode.ts missing generateQrPath function");

const qrModalContent = fs.readFileSync(path.resolve(process.cwd(), "src/components/pairing/QrConnectModal.tsx"), "utf-8");
assert.ok(qrModalContent.includes("QrConnectModal"), "QrConnectModal.tsx missing QrConnectModal component");
assert.ok(qrModalContent.includes("generateQrMatrix"), "QrConnectModal.tsx missing QR matrix generator integration");
assert.ok(qrModalContent.includes("handleCopyUrl"), "QrConnectModal.tsx missing 1-click handleCopyUrl action");

const appContent = fs.readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf-8");
assert.ok(appContent.includes("QrConnectModal"), "App.tsx missing QrConnectModal invocation");
assert.ok(appContent.includes("isQrModalOpen"), "App.tsx missing isQrModalOpen state");

// 7. Verify P5-T03 Mobile PWA & Touch Gestures
const manifestContent = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/manifest.json"), "utf-8"));
assert.strictEqual(manifestContent.display, "standalone", "manifest.json missing standalone display mode");
assert.ok(manifestContent.share_target, "manifest.json missing share_target definition");
assert.ok(manifestContent.icons.length >= 2, "manifest.json must have at least 2 icon sizes");

const swContent = fs.readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf-8");
assert.ok(swContent.includes("addEventListener(\"fetch\""), "sw.js missing fetch listener for offline caching");
assert.ok(swContent.includes("caches.open"), "sw.js missing cache opening logic");

const indexHtmlContent = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
assert.ok(indexHtmlContent.includes("rel=\"manifest\""), "index.html missing manifest link");
assert.ok(indexHtmlContent.includes("viewport-fit=cover"), "index.html missing viewport-fit=cover for mobile display");

const appLayoutContent = fs.readFileSync(path.resolve(process.cwd(), "src/components/layout/AppLayout.tsx"), "utf-8");
assert.ok(appLayoutContent.includes("touchstart"), "AppLayout missing touch gesture listener");

assert.ok(appContent.includes("sharedTitle") || appContent.includes("sharedUrl"), "App.tsx missing mobile share target ingestion handler");

// 8. Verify P6-T01 Windows Release Packaging
const cargoTomlContent = fs.readFileSync(path.resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf-8");
assert.ok(cargoTomlContent.includes("[profile.release]"), "Cargo.toml missing [profile.release]");
assert.ok(cargoTomlContent.includes("opt-level = 3"), "Cargo.toml missing opt-level = 3");
assert.ok(cargoTomlContent.includes("lto = true"), "Cargo.toml missing lto = true");
assert.ok(cargoTomlContent.includes("strip = true"), "Cargo.toml missing strip = true");

const tauriConfContent = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf-8"));
assert.ok(tauriConfContent.bundle.icon && tauriConfContent.bundle.icon.length > 0, "tauri.conf.json missing bundle.icon list");
assert.strictEqual(tauriConfContent.productName, "OmniVault", "tauri.conf.json incorrect productName");

const pkgContent = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"));
assert.ok(pkgContent.scripts["build:release"], "package.json missing build:release script");
assert.ok(pkgContent.scripts["package:windows"], "package.json missing package:windows script");

const releaseExe = path.resolve(process.cwd(), "src-tauri/target/release/omnivault.exe");
if (fs.existsSync(releaseExe)) {
  const stat = fs.statSync(releaseExe);
  assert.ok(stat.size < 15 * 1024 * 1024, `Release binary must be < 15MB. Actual: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);
}

// 9. Verify P6-T02 V1 Release & Documentation Preparation
const readmeContent = fs.readFileSync(path.resolve(process.cwd(), "README.md"), "utf-8");
// These assert on substance rather than on heading strings. The original
// version matched literal titles ("Architecture", "Quick Start", "Local REST
// API Reference"), which pinned the document's marketing-era wording: renaming
// a heading to plain English broke the build while removing nothing. What has
// to stay true is that the README still explains the shape of the thing, how
// to build it, how to check it, what the API is, and which keys do what.
assert.ok(readmeContent.includes("OmniVault"), "README.md missing OmniVault title");
assert.ok(/SQLite/.test(readmeContent) && /42420/.test(readmeContent), "README.md no longer explains how the app is put together");
assert.ok(/npm install/.test(readmeContent), "README.md no longer says how to build it");
assert.ok(/npm test/.test(readmeContent), "README.md no longer says how to verify it");
assert.ok(/\/api\/health/.test(readmeContent), "README.md no longer documents the local HTTP API");
assert.ok(/Ctrl \+ Enter/.test(readmeContent), "README.md no longer documents the keyboard shortcuts");

const licenseContent = fs.readFileSync(path.resolve(process.cwd(), "LICENSE"), "utf-8");
assert.ok(licenseContent.includes("MIT License"), "LICENSE missing MIT License header");

const verifyScriptContent = fs.readFileSync(path.resolve(process.cwd(), "scripts/verify.mjs"), "utf-8");
assert.ok(verifyScriptContent.includes("Windows Release Packaging"), "verify.mjs missing release packaging verification step");

console.log("✅ All baseline structure, triage, HTTP server, QR modal, PWA, packaging, and V1 release assertions passed successfully!");





// 10. Regression guard: Tailwind utilities that compile to nothing.
// The UI was authored with Tailwind v4 class names (h-9.5, shadow-xs, ...) while
// the project pins v3.4, so those utilities silently produced no CSS and every
// toolbar height, icon box and shadow they controlled was dropped on the floor.
// Any class used in src/ must exist in the compiled bundle.
const distDir = path.resolve(process.cwd(), "dist/assets");
const cssFiles = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter((f) => f.endsWith(".css"))
  : [];
assert.ok(cssFiles.length > 0, "No compiled CSS found in dist/assets — run the build first");
const compiledCss = cssFiles
  .map((f) => fs.readFileSync(path.join(distDir, f), "utf-8"))
  .join("\n");

const sourceFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|html)$/.test(entry.name)) sourceFiles.push(full);
  }
})(path.resolve(process.cwd(), "src"));
const sourceText = sourceFiles.map((f) => fs.readFileSync(f, "utf-8")).join("\n");

const fragileUtilities = new Set();
const spacingPattern =
  /\b(?:w|h|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|min-w|max-w|min-h|max-h|top|left|right|bottom|inset|size)-\d+\.\d+\b/g;
for (const match of sourceText.matchAll(spacingPattern)) fragileUtilities.add(match[0]);
for (const name of ["shadow-xs", "backdrop-blur-xs", "scrollbar-none"]) {
  if (sourceText.includes(name)) fragileUtilities.add(name);
}

// Tailwind escapes the dot in class selectors (".h-9\.5"), so build the needle
// with an explicit backslash char code rather than a source-level escape.
const BACKSLASH = String.fromCharCode(92);
const missingUtilities = [...fragileUtilities].filter(
  (cls) => !compiledCss.includes("." + cls.split(".").join(BACKSLASH + "."))
);
assert.deepStrictEqual(
  missingUtilities,
  [],
  `Tailwind utilities used in src/ but absent from the compiled CSS (they render as nothing): ${missingUtilities.join(", ")}`
);

// CSS `zoom` does not compensate viewport units, so h-screen/w-screen under a
// zoomed root leaves dead strips at the right and bottom edges. Density must
// scale the root rem instead.
const appSource = fs.readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf-8");
assert.ok(
  !/style\s*(?:as any)?\)?\.zoom\s*=\s*String\(/.test(appSource),
  "App.tsx must not drive UI density with CSS zoom — scale --ui-scale (root rem) instead"
);
const indexCss = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf-8");
assert.ok(indexCss.includes("--ui-scale"), "index.css must scale the root font-size via --ui-scale");

console.log("✅ Tailwind utility compilation and UI-density scaling regression guards passed!");

// 11. Regression guard: the editor's autosave effect must not depend on `onSave`.
// `App.handleSaveEditorItem` is a plain const, so it gets a new identity on every
// App render. With `onSave` in the dependency array, each completed save
// re-triggered the effect, which re-armed the 600ms debounce — the editor
// re-saved ~1.5x/second for as long as it stayed open, wrote a revision row every
// time (D-012), and the status badge could never settle on "Saved". The callback
// is held in a ref instead; see D-055.
const editorSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/editor/NoteEditorModal.tsx"),
  "utf-8"
);
const autosaveDeps = editorSource.match(/\},\s*\[title,\s*content[^\]]*\]\s*\);/);
assert.ok(autosaveDeps, "Could not locate the autosave effect's dependency array in NoteEditorModal.tsx");
assert.ok(
  !/\bonSave\b/.test(autosaveDeps[0]),
  `The autosave effect must not depend on onSave — it is recreated every App render, which makes each save schedule the next one. Found: ${autosaveDeps[0]}`
);
assert.ok(
  editorSource.includes("onSaveRef.current("),
  "The autosave effect must call onSave through a ref so it always uses the latest callback without re-running"
);

console.log("✅ Editor autosave-loop regression guard passed!");

// 12. Regression guard: no panic paths in the LAN-facing request handler.
// The release profile sets panic = "abort" (D-030), so a panic on any connection
// thread kills the whole app, and a panic while holding a lock poisons it so
// every later request aborts too. Locks in the request path must recover from
// poisoning; see D-056. Test-module unwraps are fine and are excluded.
const serverSource = fs.readFileSync(
  path.resolve(process.cwd(), "src-tauri/src/http_server.rs"),
  "utf-8"
);
const testModuleAt = serverSource.indexOf("#[cfg(test)]");
const requestPath = testModuleAt === -1 ? serverSource : serverSource.slice(0, testModuleAt);
const panicCalls = requestPath.split("\n").filter((l) => l.includes(".unwrap()"));
assert.deepStrictEqual(
  panicCalls.map((l) => l.trim()),
  [],
  "http_server.rs request path must contain no .unwrap() — under panic = \"abort\" one bad request would kill the app. Use lock_recover() for mutexes and return an HTTP error otherwise."
);
assert.ok(
  requestPath.includes("fn lock_recover"),
  "http_server.rs must define lock_recover() so a poisoned mutex cannot abort every later request"
);

console.log("✅ Request-path panic guard passed!");

// 13. Regression guard: no dynamic href may bypass the scheme whitelist.
// Note content arrives from paired devices and the Android share sheet, and
// React does not sanitise href — `[x](javascript:...)` in a synced note would
// render a working anchor with reach into the Tauri IPC surface. See D-061.
const dynamicHrefFiles = ["src/utils/markdown.tsx", "src/components/research/SmartMarketLauncher.tsx"];
for (const rel of dynamicHrefFiles) {
  const src = fs.readFileSync(path.resolve(process.cwd(), rel), "utf-8");
  const dynamicHrefs = (src.match(/href=\{(?!`https|"https)/g) || []).length;
  if (dynamicHrefs === 0) continue;
  assert.ok(
    src.includes("safeHref"),
    `${rel} builds an href from data but never calls safeHref()`
  );
  const guardCalls = (src.match(/safeHref\(/g) || []).length;
  assert.ok(
    guardCalls >= dynamicHrefs,
    `${rel} has ${dynamicHrefs} dynamic href(s) but only ${guardCalls} safeHref() call(s)`
  );
}
const safeUrlSrc = fs.readFileSync(path.resolve(process.cwd(), "src/utils/safeUrl.ts"), "utf-8");
for (const scheme of ["http", "https", "mailto"]) {
  assert.ok(safeUrlSrc.includes(`"${scheme}"`), `safeUrl must allow ${scheme}`);
}
assert.ok(
  !/"javascript"|'javascript'/.test(safeUrlSrc),
  "safeUrl must never allow the javascript: scheme"
);

console.log("✅ Link scheme guard passed!");

// 14. Regression guard: a pasted image must go through the media pipeline.
// Handing the data URL straight to createItem writes the whole image into the
// database and into a revision row, which is the base64 bloat D-035 removed.
const appSrc = fs.readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf-8");
const pasteHandler = appSrc.slice(
  appSrc.indexOf("onPasteImage"),
  appSrc.indexOf("onPasteImage") + 1400
);
assert.ok(
  pasteHandler.includes("uploadMedia"),
  "the clipboard paste handler must upload the image rather than inline it"
);

// Upload failures must not degrade silently into an inline copy on a device
// that has somewhere to put the file.
const storageSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/services/storageService.ts"),
  "utf-8"
);
const uploadFn = storageSrc.slice(
  storageSrc.indexOf("async uploadMedia"),
  storageSrc.indexOf("async uploadMedia") + 2600
);
assert.ok(
  uploadFn.includes("VaultWriteError"),
  "a failed media upload must raise rather than return null on a paired device"
);

console.log("✅ Media capture path guards passed!");

// 15. Regression guard: the Android release build must be allowed to load its
// own images. A release APK sets usesCleartextTraffic=false, which blocks the
// WebView from reading anything over plain HTTP - including the vault server on
// loopback - so every picture rendered as a broken thumbnail while the same
// code worked in a debug build. See D-069.
const androidRes = path.resolve(
  process.cwd(),
  "src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml"
);
assert.ok(fs.existsSync(androidRes), "android network security config is missing");
const netCfg = fs.readFileSync(androidRes, "utf-8");
assert.ok(
  /<domain[^>]*>127\.0\.0\.1<\/domain>/.test(netCfg),
  "loopback must be allowed to serve the app its own media over http"
);
assert.ok(
  /<base-config[^>]*cleartextTrafficPermitted="false"/.test(netCfg),
  "cleartext must stay off for everything that is not loopback"
);
const androidManifest = fs.readFileSync(
  path.resolve(process.cwd(), "src-tauri/gen/android/app/src/main/AndroidManifest.xml"),
  "utf-8"
);
assert.ok(
  androidManifest.includes("@xml/network_security_config"),
  "the manifest must reference the network security config, or it does nothing"
);

console.log("✅ Android cleartext policy guard passed!");

// 16. Regression guard: the interface carries no colour of its own.
// Every neutral comes from the tinted ramp in tailwind.config.js, and the only
// chromatic tokens are the ones that carry meaning — synced, lost, and the
// three folder marks. A raw Tailwind palette class is how the slop gets back
// in, one indigo button at a time. See D-070.
const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|decoration|placeholder|shadow)-(?:indigo|violet|purple|blue|emerald|green|teal|cyan|amber|yellow|orange|red|rose|pink|fuchsia|sky|lime|zinc|slate|gray|neutral|stone)-[0-9]{2,3}\b/g;
const uiFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx|ts)$/.test(entry.name)) uiFiles.push(full);
  }
};
walk(path.resolve(process.cwd(), "src"));
const offenders = [];
for (const file of uiFiles) {
  const hits = fs.readFileSync(file, "utf-8").match(PALETTE_CLASS);
  if (hits) offenders.push(`${path.relative(process.cwd(), file)}: ${[...new Set(hits)].join(", ")}`);
}
assert.strictEqual(
  offenders.length,
  0,
  "stock palette colours are back in the UI: " + offenders.join(" | ")
);

// The tokens those classes would have bypassed must actually exist.
const tw = fs.readFileSync(path.resolve(process.cwd(), "tailwind.config.js"), "utf-8");
for (const token of ["#0D0E11", "#E9EAEF", "#79C2A4", "#DE8A80", "#12131A"]) {
  assert.ok(tw.includes(token), `tailwind.config.js lost the ${token} token`);
}
assert.ok(tw.includes("Archivo") && tw.includes("Fraunces"), "the type system is not wired up");

// Both faces are bundled, so the vault looks the same with the Wi-Fi off.
for (const font of ["archivo-latin.woff2", "fraunces-latin.woff2"]) {
  assert.ok(
    fs.existsSync(path.resolve(process.cwd(), "public/fonts", font)),
    `${font} is not bundled — the UI would fall back to a system face offline`
  );
}

console.log("✅ Palette and type-system guards passed!");

// 17. Regression guard: no emoji standing in for an icon, and no terminal
// costume. Both render differently on every platform and neither is the
// product's voice. See D-070.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const costume = [];
for (const file of uiFiles) {
  const src = fs.readFileSync(file, "utf-8");
  const rel = path.relative(process.cwd(), file);
  if (EMOJI.test(src)) costume.push(rel + ": emoji in the UI");
  if (src.includes("vault://")) costume.push(rel + ": fake terminal chrome");
}
assert.strictEqual(costume.length, 0, "interface costume is back: " + costume.join(" | "));

console.log("✅ Interface voice guard passed!");

// 18. Regression guard: one version number, in three places that must agree.
// A drifting APP_VERSION makes the update check wrong in the one direction
// that matters — it would stop offering an update that exists, silently. And a
// tauri.conf.json that disagrees ships an installer labelled as something it
// is not. See D-074.
const pkgVersion = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")).version;
const tauriVersion = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf-8")
).version;
const updatesSrc = fs.readFileSync(path.resolve(process.cwd(), "src/services/updates.ts"), "utf-8");
const appVersion = (updatesSrc.match(/APP_VERSION = "([^"]+)"/) || [])[1];

assert.strictEqual(
  tauriVersion,
  pkgVersion,
  `tauri.conf.json says ${tauriVersion} and package.json says ${pkgVersion}`
);
assert.strictEqual(
  appVersion,
  pkgVersion,
  `APP_VERSION says ${appVersion} and package.json says ${pkgVersion} — the update check would be wrong`
);

// The signing key note must keep recording a fingerprint, because the harness
// reads it from there to check what the APK was actually signed with.
const signingNote = fs.readFileSync(path.resolve(process.cwd(), "SIGNING-KEY.md"), "utf-8");
assert.ok(
  /\b[0-9a-f]{64}\b/.test(signingNote),
  "SIGNING-KEY.md no longer records a certificate fingerprint, so nothing checks the APK"
);

console.log("✅ Version and signing-key guards passed!");

// 19. Regression guard: the README may not promise what the code does not do.
//
// It shipped claiming sync ran "over encrypted TCP streams" while the only
// occurrence of "encrypt" in the Rust tree was a comment saying the backup is
// not encrypted — and while its own threat model, 246 lines further down, said
// plainly there is no TLS. A privacy tool that overstates its privacy in the
// paragraph most people read is worse than one that says nothing. It also
// listed iPhone and iPad among supported devices, named mDNS for what is UDP
// multicast, and sent people to a releases page that does not exist. See D-080.
const readme = fs.readFileSync(path.resolve(process.cwd(), "README.md"), "utf-8");
const overclaims = [
  [/encrypted\s+(?:TCP|tcp|streams?|transport|sync|channel|connection)/i, "claims the transport is encrypted; there is no TLS"],
  [/end-to-end\s+encrypt/i, "claims end-to-end encryption"],
  [/\bmDNS\b/i, "says mDNS; discovery is UDP multicast on 239.255.42.99"],
];
const promises = [];
for (const [pattern, why] of overclaims) {
  if (pattern.test(readme)) promises.push(why);
}

// Apple platforms need a claim, not a mention: "there is no iOS build" is
// the honest sentence this guard exists to protect, so banning the token
// outright would forbid the truth along with the lie. Flag the word only in
// a sentence that is not denying it.
for (const sentence of readme.split(/(?<=[.!])\s|\r?\n/)) {
  if (!/\b(?:iPhone|iPad|iOS|macOS)\b/.test(sentence)) continue;
  if (/\b(?:no|not|never|without|lacks?)\b/i.test(sentence)) continue;
  promises.push("claims an Apple platform; there is no iOS or macOS build");
  break;
}
if (EMOJI.test(readme)) promises.push("emoji are back in the README");

// Do not send people to a download page that does not exist. The update check
// is wired to RELEASES_REPO and stays deliberately empty until publication;
// while it is empty, the README must not link to releases either.
const releasesRepo = (updatesSrc.match(/RELEASES_REPO = "([^"]*)"/) || [])[1];
if (!releasesRepo && /github\.com\/[^\s)]+\/releases/i.test(readme)) {
  promises.push("links to a releases page while RELEASES_REPO is empty");
}

assert.strictEqual(
  promises.length,
  0,
  "the README promises what the code does not do: " + promises.join(" | ")
);

console.log("✅ README honesty guard passed!");

// 20. Regression guard: the QR code has to be a QR code.
//
// It shipped unscannable for three independent reasons, and nothing caught it
// because a wrong QR still looks exactly like a QR. A phone camera found the
// finder patterns and then decoded nothing, which reads to a person as the
// scanner being broken rather than the code being wrong. See D-081.
//
// The golden hashes below were produced from matrices that OpenCV's decoder
// read back correctly. If one changes, the encoder changed: re-verify against
// a real decoder before updating it, do not simply paste the new hash in.
const esbuild = await import("esbuild");
const qrSource = fs.readFileSync(path.resolve(process.cwd(), "src/utils/qrCode.ts"), "utf-8");
const qrJs = esbuild.transformSync(qrSource, { loader: "ts", format: "esm" }).code;
const qrMod = await import(
  "data:text/javascript;base64," + Buffer.from(qrJs, "utf-8").toString("base64")
);

const QR_GOLDEN = [
  ["http://192.168.1.5:42420", 25, "d46ccc1b7a3cdc9b"],
  ["http://10.0.0.2:42420", 25, "e1f405c444cf29da"],
];

for (const [url, expectedSize, expectedHash] of QR_GOLDEN) {
  const m = qrMod.generateQrMatrix(url);
  assert.strictEqual(m.length, expectedSize, `QR for ${url} changed size`);

  // Finder patterns: a 7x7 ring in three corners.
  for (const [r0, c0] of [[0, 0], [0, m.length - 7], [m.length - 7, 0]]) {
    assert.ok(m[r0][c0] && m[r0 + 6][c0] && m[r0][c0 + 6], `finder pattern missing at ${r0},${c0}`);
    assert.ok(m[r0 + 3][c0 + 3], `finder centre missing at ${r0},${c0}`);
    assert.ok(!m[r0 + 1][c0 + 1], `finder ring not hollow at ${r0},${c0}`);
  }

  // The single alignment pattern for versions 2-4 sits at (c, c), not on the
  // timing row. Reading the spec's coordinate list as a coordinate put it at
  // (6, c), which is what made every code undecodable.
  const centre = { 25: 18, 29: 22, 33: 26 }[m.length];
  if (centre) {
    assert.ok(m[centre][centre], `alignment centre missing at ${centre},${centre}`);
    assert.ok(!m[centre - 1][centre], "alignment pattern is not a ring");
    assert.ok(m[centre - 2][centre], "alignment pattern outer ring missing");
  }

  // Timing row must alternate all the way across, so nothing may be drawn on it.
  for (let i = 8; i < m.length - 8; i++) {
    assert.strictEqual(m[6][i], i % 2 === 0, `timing row broken at column ${i}`);
    assert.strictEqual(m[i][6], i % 2 === 0, `timing column broken at row ${i}`);
  }

  const bits = m.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")).join("");
  const hash = crypto.createHash("sha256").update(bits).digest("hex").slice(0, 16);
  assert.strictEqual(
    hash,
    expectedHash,
    `the QR encoder changed for ${url}. Re-verify with a real decoder before updating this hash.`
  );
}

// A note copied out of the vault must not repeat its own first line, which is
// the ordinary shape of a quick capture.
const copySource = fs.readFileSync(path.resolve(process.cwd(), "src/utils/copyText.ts"), "utf-8");
const copyJs = esbuild.transformSync(copySource, { loader: "ts", format: "esm" }).code;
const { copyableText } = await import(
  "data:text/javascript;base64," + Buffer.from(copyJs, "utf-8").toString("base64")
);
assert.strictEqual(copyableText("Exited JAINREC.NS", "Exited JAINREC.NS at 294"), "Exited JAINREC.NS at 294");
assert.strictEqual(copyableText("Trade log", "Exited at 294"), "Trade log\n\nExited at 294");
assert.strictEqual(copyableText("Only a title", ""), "Only a title");
assert.strictEqual(copyableText("", "Only a body"), "Only a body");

console.log("✅ QR code and copy-out guards passed!");

// 21. Regression guard: the shell is sized to the visible window.
//
// `100vh` on a mobile browser is the height the page would have with the
// address bar hidden. A shell sized to it puts its own last row under the
// browser chrome, and because the shell is overflow-hidden there is no way to
// scroll to it — which hid the entire device panel (device name, Back up,
// version, update check) on a tablet reading the vault through a browser.
// See D-082.
const appLayout = fs.readFileSync(path.resolve(process.cwd(), "src/components/layout/AppLayout.tsx"), "utf-8");
const appCss = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf-8");
const shellLine = (appLayout.match(/^.*app-viewport.*$/m) || [""])[0];
assert.ok(
  shellLine,
  "the app shell no longer uses .app-viewport, so its height is back to the browser's guess"
);
assert.ok(
  !/\bh-screen\b/.test(shellLine),
  "the app shell is sized with h-screen again, which is 100vh and hides its last row on a phone"
);
assert.ok(
  /\.app-viewport\s*\{[^}]*100dvh/.test(appCss),
  ".app-viewport must resolve to 100dvh so it follows the space actually on screen"
);
assert.ok(
  /\.app-viewport\s*\{[^}]*100vh/.test(appCss),
  ".app-viewport must keep a 100vh line first, as the fallback for browsers without dvh"
);

console.log("✅ Viewport sizing guard passed!");

// 22. Regression guards: things that only break on a phone.
//
// None of these show up on a developer's desktop, which is why all three
// shipped. See D-083.
const cardSrc = fs.readFileSync(path.resolve(process.cwd(), "src/components/inbox/QuickInboxItemCard.tsx"), "utf-8");
const pairSrc = fs.readFileSync(path.resolve(process.cwd(), "src/components/pairing/QrConnectModal.tsx"), "utf-8");
const guideSrc = fs.readFileSync(path.resolve(process.cwd(), "src/components/pairing/PairingGuide.tsx"), "utf-8");
const editorSrc = fs.readFileSync(path.resolve(process.cwd(), "src/components/editor/NoteEditorModal.tsx"), "utf-8");

// A control revealed only by hover does not exist on a touchscreen. Copy, pin,
// move and delete were all unreachable on the device most captures are made on.
const actionRow = (cardSrc.match(/^.*group-hover:opacity-100.*$/m) || [""])[0];
assert.ok(
  /\[@media\(hover:none\)\]:opacity-100/.test(actionRow),
  "the card's actions are hover-only again, so they are invisible on a phone"
);

// Deleting is immediate and cannot be undone. On touch the actions are always
// visible and Delete sits beside the action used most, so it asks twice.
assert.ok(
  /armedToDelete/.test(cardSrc) && /hover: none/.test(cardSrc),
  "the two-tap delete for touch devices is gone; a mis-tap now loses a note with no undo"
);

// A browser client is never issued a PIN (D-051), so it must never print one.
// A hardcoded placeholder was displayed as if it were real.
const pinPlaceholder = pairSrc.match(/useState<string[^>]*>\((["'])(\d{3}\s?\d{3})\1\)/);
assert.ok(
  !pinPlaceholder,
  `the pairing modal starts with a hardcoded PIN again (${pinPlaceholder && pinPlaceholder[2]}), which a browser would show as real`
);
assert.ok(
  /showsOwnPin/.test(guideSrc) && /showsOwnPin=\{/.test(pairSrc),
  "the pairing steps no longer distinguish a device that issues a PIN from one that does not"
);

// Side by side splits a phone screen into two unusable columns.
assert.ok(
  /innerWidth\s*<\s*768\s*\?\s*"edit"/.test(editorSrc),
  "the editor defaults to the split view again, which is two ~190px columns on a phone"
);

console.log("✅ Touch and small-screen guards passed!");
