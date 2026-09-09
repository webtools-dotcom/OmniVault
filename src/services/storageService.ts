import { Folder, ItemType, VaultItem } from "../types";

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

const DEFAULT_ITEMS: VaultItem[] = [
  {
    id: "item-init-1",
    folder_id: null, // Quick Inbox
    item_type: "note",
    title: "OmniVault Offline Mesh Architecture",
    content: "Capture notes instantly without internet connectivity. Revisions sync asynchronously via mDNS & local TCP mesh when peers reconnect.",
    metadata: null,
    is_pinned: true,
    is_archived: false,
    is_deleted: false,
    created_at: Date.now() - 1200000,
    updated_at: Date.now() - 1200000,
  },
  {
    id: "item-init-2",
    folder_id: null, // Quick Inbox
    item_type: "ticker",
    title: "$NVDA",
    content: "AI infrastructure demand acceleration. Potential consolidation setup near weekly highs.",
    metadata: JSON.stringify({ ticker: "NVDA", exchange: "NASDAQ" }),
    is_pinned: false,
    is_archived: false,
    is_deleted: false,
    created_at: Date.now() - 3600000,
    updated_at: Date.now() - 3600000,
  },
  {
    id: "item-init-3",
    folder_id: null, // Quick Inbox
    item_type: "link",
    title: "Local-First Software Foundations",
    content: "https://www.inkandswitch.com/local-first/",
    metadata: JSON.stringify({ url: "https://www.inkandswitch.com/local-first/" }),
    is_pinned: false,
    is_archived: false,
    is_deleted: false,
    created_at: Date.now() - 5400000,
    updated_at: Date.now() - 5400000,
  },
];

const STORAGE_KEY_PAIRED = "omnivault_paired";
const STORAGE_KEY_AUTH_TOKEN = "omnivault_auth_token";
const STORAGE_KEY_PEER_ID = "omnivault_peer_id";

// Helper to check if Tauri runtime is present
export function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// Check if running in browser capable of HTTP API fetch
function canUseHttpApi(): boolean {
  return typeof window !== "undefined" && !isTauriEnvironment() && typeof fetch !== "undefined";
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  if (!canUseHttpApi()) return null;
  try {
    const res = await fetch(path, options);
    if (!res.ok) {
      console.warn(`HTTP ${res.status} from ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`Network error fetching ${path}:`, err);
    return null;
  }
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
    // Ignore quota errors
  }
}

function getLocalItems(): VaultItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ITEMS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(DEFAULT_ITEMS));
      return DEFAULT_ITEMS;
    }
    return JSON.parse(raw);
  } catch {
    return DEFAULT_ITEMS;
  }
}

function saveLocalItems(items: VaultItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
  } catch {
    // Ignore quota errors
  }
}

// Unified Storage API
export const StorageService = {
  // -------------------------------------------------------------------------
  // Device Pairing Helpers (for Mobile & Tablet Web Peers)
  // -------------------------------------------------------------------------
  isPaired(): boolean {
    if (isTauriEnvironment()) return true;
    try {
      return localStorage.getItem(STORAGE_KEY_PAIRED) === "true";
    } catch {
      return false;
    }
  },

  async pairDevice(pin: string, deviceName?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const cleanPin = pin.trim().replace(/\s+/g, "");
      if (cleanPin.length < 4) {
        return { success: false, error: "Please enter a valid authorization PIN" };
      }
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: cleanPin,
          device_name: deviceName || "Tablet Peer",
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return { success: false, error: errJson.error || "Failed to authenticate PIN" };
      }
      const data = await res.json();
      localStorage.setItem(STORAGE_KEY_PAIRED, "true");
      if (data.auth_token) localStorage.setItem(STORAGE_KEY_AUTH_TOKEN, data.auth_token);
      if (data.device_id) localStorage.setItem(STORAGE_KEY_PEER_ID, data.device_id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Network request failed" };
    }
  },

  unpair(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_PAIRED);
      localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
      localStorage.removeItem(STORAGE_KEY_PEER_ID);
    } catch {
      // Ignore
    }
  },

  // -------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------
  async getFolders(): Promise<Folder[]> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<Folder[]>("list_folders_cmd");
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverFolders = await apiFetch<Folder[]>("/api/folders");
      if (serverFolders && Array.isArray(serverFolders)) {
        saveLocalFolders(serverFolders);
        return serverFolders.filter((f) => !f.is_deleted);
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
    } else {
      const serverFolder = await apiFetch<Folder>("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parent_id: parentId, color }),
      });
      if (serverFolder && serverFolder.id) {
        const folders = getLocalFolders().filter((f) => f.id !== serverFolder.id);
        folders.push(serverFolder);
        saveLocalFolders(folders);
        return serverFolder;
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
    } else {
      const serverFolder = await apiFetch<Folder>("/api/folders/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folderId, name: newName.trim() }),
      });
      if (serverFolder && serverFolder.id) {
        const folders = getLocalFolders().map((f) => (f.id === folderId ? serverFolder : f));
        saveLocalFolders(folders);
        return serverFolder;
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
    } else {
      const serverFolder = await apiFetch<Folder>("/api/folders/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folderId, parent_id: newParentId }),
      });
      if (serverFolder && serverFolder.id) {
        const folders = getLocalFolders().map((f) => (f.id === folderId ? serverFolder : f));
        saveLocalFolders(folders);
        return serverFolder;
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
    } else {
      await apiFetch("/api/folders/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folderId }),
      });
    }

    const folders = getLocalFolders();
    const now = Date.now();

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

  // -------------------------------------------------------------------------
  // Vault Items (Quick Inbox & Folder Items)
  // -------------------------------------------------------------------------
  async getInboxItems(): Promise<VaultItem[]> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<VaultItem[]>("list_inbox_items_cmd");
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverItems = await apiFetch<VaultItem[]>("/api/items/inbox");
      if (serverItems && Array.isArray(serverItems)) {
        saveLocalItems(serverItems);
        return serverItems;
      }
    }
    const items = getLocalItems();
    return items
      .filter((item) => item.folder_id === null && !item.is_deleted && !item.is_archived)
      .sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        return b.updated_at - a.updated_at;
      });
  },

  async getFolderItems(folderId: string): Promise<VaultItem[]> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<VaultItem[]>("list_folder_items_cmd", { folderId });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverItems = await apiFetch<VaultItem[]>(`/api/items?folder_id=${encodeURIComponent(folderId)}`);
      if (serverItems && Array.isArray(serverItems)) {
        return serverItems;
      }
    }
    const items = getLocalItems();
    return items
      .filter((item) => item.folder_id === folderId && !item.is_deleted)
      .sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        return b.updated_at - a.updated_at;
      });
  },

  async createItem(
    folderId: string | null,
    itemType: ItemType,
    title: string,
    content: string,
    metadata: string | null = null
  ): Promise<VaultItem> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<VaultItem>("create_item_cmd", {
          folderId,
          itemType,
          title,
          content,
          metadata,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverItem = await apiFetch<VaultItem>("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: folderId,
          item_type: itemType,
          title: title.trim(),
          content: content.trim(),
          metadata,
        }),
      });
      if (serverItem && serverItem.id) {
        const items = getLocalItems().filter((i) => i.id !== serverItem.id);
        items.unshift(serverItem);
        saveLocalItems(items);
        return serverItem;
      }
    }

    const items = getLocalItems();
    const now = Date.now();
    const newItem: VaultItem = {
      id: `item-${now}-${Math.random().toString(36).slice(2, 7)}`,
      folder_id: folderId,
      item_type: itemType,
      title: title.trim(),
      content: content.trim(),
      metadata,
      is_pinned: false,
      is_archived: false,
      is_deleted: false,
      created_at: now,
      updated_at: now,
    };

    items.unshift(newItem);
    saveLocalItems(items);
    return newItem;
  },

  async updateItem(
    itemId: string,
    title: string,
    content: string,
    metadata: string | null = null
  ): Promise<VaultItem> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<VaultItem>("update_item_cmd", {
          id: itemId,
          title,
          content,
          metadata,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverItem = await apiFetch<VaultItem>("/api/items/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: itemId,
          title: title.trim(),
          content: content.trim(),
          metadata,
        }),
      });
      if (serverItem && serverItem.id) {
        const items = getLocalItems().map((i) => (i.id === itemId ? serverItem : i));
        saveLocalItems(items);
        return serverItem;
      }
    }

    const items = getLocalItems();
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new Error("Item not found");

    item.title = title.trim();
    item.content = content.trim();
    item.metadata = metadata;
    item.updated_at = Date.now();
    saveLocalItems(items);
    return item;
  },

  async moveItem(itemId: string, newFolderId: string | null): Promise<VaultItem> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<VaultItem>("move_item_cmd", {
          id: itemId,
          folderId: newFolderId,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverItem = await apiFetch<VaultItem>("/api/items/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: itemId,
          folder_id: newFolderId,
        }),
      });
      if (serverItem && serverItem.id) {
        const items = getLocalItems().map((i) => (i.id === itemId ? serverItem : i));
        saveLocalItems(items);
        return serverItem;
      }
    }

    const items = getLocalItems();
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new Error("Item not found");

    item.folder_id = newFolderId;
    item.updated_at = Date.now();
    saveLocalItems(items);
    return item;
  },

  async togglePinItem(itemId: string): Promise<VaultItem> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<VaultItem>("toggle_pin_item_cmd", { id: itemId });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverItem = await apiFetch<VaultItem>("/api/items/toggle-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId }),
      });
      if (serverItem && serverItem.id) {
        const items = getLocalItems().map((i) => (i.id === itemId ? serverItem : i));
        saveLocalItems(items);
        return serverItem;
      }
    }

    const items = getLocalItems();
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new Error("Item not found");

    item.is_pinned = !item.is_pinned;
    item.updated_at = Date.now();
    saveLocalItems(items);
    return item;
  },

  async deleteItem(itemId: string): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("delete_item_cmd", { id: itemId });
        return;
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      await apiFetch("/api/items/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId }),
      });
    }

    const items = getLocalItems();
    const item = items.find((i) => i.id === itemId);
    if (item) {
      item.is_deleted = true;
      item.updated_at = Date.now();
      saveLocalItems(items);
    }
  },

  async getLanConnectionInfo(): Promise<{ ip: string; port: number; url: string }> {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<{ ip: string; port: number; url: string }>("get_lan_connection_info_cmd");
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to window host:", err);
      }
    }

    const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
    const port = typeof window !== "undefined" && window.location.port ? parseInt(window.location.port, 10) : 42420;
    const ip = host === "localhost" || host === "127.0.0.1" ? "127.0.0.1" : host;
    return {
      ip,
      port,
      url: typeof window !== "undefined" && window.location.origin ? window.location.origin : `http://${ip}:${port}`,
    };
  },
};
