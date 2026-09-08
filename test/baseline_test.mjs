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
  "src-tauri/src/http_server.rs"
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

console.log("✅ All baseline structure, triage, and embedded HTTP server assertions passed successfully!");


