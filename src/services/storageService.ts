import { Folder, VaultItem } from "../types";

const STORAGE_KEY_FOLDERS = "omnivault_folders_v1";
const STORAGE_KEY_ITEMS = "omnivault_items_v1";

const DEFAULT_FOLDERS: Folder[] = [
  {
    id: "fld-research",
    parent_id: null,
    name: "Research & Notes",
    color: "#2F81F7",
    created_at: Date.now() - 7200000,
    updated_at: Date.now() - 7200000,
    is_deleted: false,
  },
  {
    id: "fld-sub-saas",
    parent_id: "fld-research",
    name: "SaaS Architecture",
    color: "#388BFD",
    created_at: Date.now() - 3600000,
    updated_at: Date.now() - 3600000,
    is_deleted: false,
  },
  {
    id: "fld-trading",
    parent_id: null,
    name: "Market Setups & Charts",
    color: "#238636",
    created_at: Date.now() - 10800000,
    updated_at: Date.now() - 10800000,
    is_deleted: false,
  },
  {
    id: "fld-crypto",
    parent_id: "fld-trading",
    name: "Crypto Trends",
    color: "#D29922",
    created_at: Date.now() - 1800000,
    updated_at: Date.now() - 1800000,
    is_deleted: false,
  },
  {
    id: "fld-ideas",
    parent_id: null,
    name: "Product Ideas",
    color: "#A371F7",
    created_at: Date.now() - 14400000,
    updated_at: Date.now() - 14400000,
    is_deleted: false,
  },
];

// Helper to check if Tauri runtime is present
export function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// Local storage fallback helpers
function getLocalFolders(): Folder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FOLDERS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(DEFAULT_FOLDERS));
      return DEFAULT_FOLDERS;
    }
    return JSON.parse(raw);
  } catch {
    return DEFAULT_FOLDERS;
  }
}

function saveLocalFolders(folders: Folder[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
  } catch {
    // Ignore localStorage quota errors
  }
}

// Unified Folder Storage API
export const StorageService = {
  async getFolders(): Promise<Folder[]> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<Folder[]>("list_folders_cmd");
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    }
    return getLocalFolders().filter((f) => !f.is_deleted);
  },

  async createFolder(
    name: string,
    parentId: string | null = null,
    color: string | null = "#2F81F7"
  ): Promise<Folder> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<Folder>("create_folder_cmd", {
          name,
          parentId,
          color,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    }

    const folders = getLocalFolders();
    const newFolder: Folder = {
      id: `fld-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      parent_id: parentId,
      name: name.trim(),
      color,
      created_at: Date.now(),
      updated_at: Date.now(),
      is_deleted: false,
    };

    folders.push(newFolder);
    saveLocalFolders(folders);
    return newFolder;
  },

  async renameFolder(folderId: string, newName: string): Promise<Folder> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<Folder>("rename_folder_cmd", {
          id: folderId,
          name: newName,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    }

    const folders = getLocalFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) throw new Error("Folder not found");

    folder.name = newName.trim();
    folder.updated_at = Date.now();
    saveLocalFolders(folders);
    return folder;
  },

  async moveFolder(
    folderId: string,
    newParentId: string | null
  ): Promise<Folder> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<Folder>("move_folder_cmd", {
          id: folderId,
          parentId: newParentId,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    }

    const folders = getLocalFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) throw new Error("Folder not found");

    folder.parent_id = newParentId;
    folder.updated_at = Date.now();
    saveLocalFolders(folders);
    return folder;
  },

  async deleteFolder(folderId: string): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("delete_folder_cmd", { id: folderId });
        return;
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    }

    const folders = getLocalFolders();
    const now = Date.now();

    // Mark folder and any descendants as soft deleted
    const toDeleteIds = new Set<string>([folderId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of folders) {
        if (f.parent_id && toDeleteIds.has(f.parent_id) && !toDeleteIds.has(f.id)) {
          toDeleteIds.add(f.id);
          added = true;
        }
      }
    }

    for (const f of folders) {
      if (toDeleteIds.has(f.id)) {
        f.is_deleted = true;
        f.updated_at = now;
      }
    }

    saveLocalFolders(folders);
  },

  // Vault Items (Inbox / Folder items)
  async getInboxItems(): Promise<VaultItem[]> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ITEMS);
      if (!raw) return [];
      const items: VaultItem[] = JSON.parse(raw);
      return items.filter((item) => item.folder_id === null && !item.is_deleted);
    } catch {
      return [];
    }
  },

  async getFolderItems(folderId: string): Promise<VaultItem[]> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ITEMS);
      if (!raw) return [];
      const items: VaultItem[] = JSON.parse(raw);
      return items.filter((item) => item.folder_id === folderId && !item.is_deleted);
    } catch {
      return [];
    }
  },
};
