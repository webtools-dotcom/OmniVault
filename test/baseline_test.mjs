import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

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
assert.ok(readmeContent.includes("OmniVault"), "README.md missing OmniVault title");
assert.ok(readmeContent.includes("Architecture"), "README.md missing Architecture section");
assert.ok(readmeContent.includes("Quick Start"), "README.md missing Quick Start section");
assert.ok(readmeContent.includes("Local REST API Reference"), "README.md missing REST API reference");
assert.ok(readmeContent.includes("Keyboard Shortcuts"), "README.md missing Keyboard Shortcuts table");

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
