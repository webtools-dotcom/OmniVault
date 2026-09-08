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
  "src/components/folders/DeleteFolderModal.tsx"
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

console.log("✅ All baseline structure assertions passed successfully!");
