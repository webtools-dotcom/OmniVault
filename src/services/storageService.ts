import { invoke } from "@tauri-apps/api/core";
import { Folder, ItemType, VaultItem, PeerInfo, MeshSyncState } from "../types";

const STORAGE_KEY_FOLDERS = "omnivault_folders_v1";
const STORAGE_KEY_ITEMS = "omnivault_items_v1";

const DEFAULT_FOLDERS: Folder[] = [];
const DEFAULT_ITEMS: VaultItem[] = [];

const DUMMY_ITEM_IDS = new Set(["item-init-1", "item-init-2", "item-init-3"]);
const DUMMY_FOLDER_IDS = new Set(["fld-research", "fld-sub-saas", "fld-trading", "fld-crypto", "fld-ideas"]);
const DUMMY_TITLES = new Set([
  "OmniVault Offline Mesh Architecture",
  "OmniVault Local Mesh Architecture",
  "$NVDA",
  "NVIDIA Corp ($NVDA)",
  "Bitcoin ($BTC)",
  "TradingView Advanced Financial Charts",
  "TradingView Charts",
  "Quick Capture & Hotkeys",
  "Quick Capture Guide",
  "Local-First Software Foundations",
]);

const STORAGE_KEY_PAIRED = "omnivault_paired";
const STORAGE_KEY_AUTH_TOKEN = "omnivault_auth_token";
const STORAGE_KEY_PEER_ID = "omnivault_peer_id";

function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
    const deviceId = localStorage.getItem(STORAGE_KEY_PEER_ID);
    if (token && deviceId) {
      return { "X-Auth-Token": token, "X-Device-Id": deviceId };
    }
  } catch {
    // localStorage unavailable; fall through unauthenticated
  }
  return {};
}

let cachedServerPort: number = 42420;

// Helper to check if Tauri runtime is present
export function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// Query LAN port if in Tauri
if (typeof window !== "undefined" && isTauriEnvironment()) {
  try {
    invoke<{ ip: string; port: number; url: string }>("get_lan_connection_info_cmd")
      .then((info) => {
        if (info && info.port) {
          cachedServerPort = info.port;
        }
      })
      .catch(() => {});
  } catch {
    // ignore
  }
}

// Fast in-memory cache for recently captured/uploaded images to avoid re-fetching large blobs across Wi-Fi
const localMediaCache = new Map<string, string>();
let hasRunDataUrlMigration = false;

export function cacheLocalMedia(key: string, dataUrl: string): void {
  if (!key || !dataUrl) return;
  localMediaCache.set(key, dataUrl);
  const clean = key.startsWith("/") ? key : `/${key}`;
  localMediaCache.set(clean, dataUrl);
  const withoutExt = clean.replace(/\.webp$/i, "");
  localMediaCache.set(withoutExt, dataUrl);
  const justHash = clean.split("/").pop()?.replace(/\.webp$/i, "");
  if (justHash) {
    localMediaCache.set(justHash, dataUrl);
    localMediaCache.set(`/api/media/${justHash}.webp`, dataUrl);
  }
}

/**
 * Resolves a media URL to an absolute or relative URL accessible by the current runtime.
 * Handles fast local memory cache, desktop Tauri (translates /api/media/... to http://127.0.0.1:42420/api/media/...),
 * tablet/mobile web (relative to current origin), and raw data URLs.
 */
export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  ) {
    return url;
  }
  const clean = url.startsWith("/") ? url : `/${url}`;
  if (localMediaCache.has(clean)) {
    return localMediaCache.get(clean)!;
  }
  const justHash = clean.split("/").pop()?.replace(/\.webp$/i, "");
  if (justHash && localMediaCache.has(justHash)) {
    return localMediaCache.get(justHash)!;
  }
  if (isTauriEnvironment()) {
    return `http://127.0.0.1:${cachedServerPort}${clean}`;
  }
  try {
    const token = localStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
    const deviceId = localStorage.getItem(STORAGE_KEY_PEER_ID);
    if (token && deviceId) {
      const sep = clean.includes("?") ? "&" : "?";
      return `${clean}${sep}device_id=${encodeURIComponent(deviceId)}&auth_token=${encodeURIComponent(token)}`;
    }
  } catch {
    // fall through to the bare URL
  }
  return clean;
}

// Check if running in browser capable of HTTP API fetch
function canUseHttpApi(): boolean {
  return typeof window !== "undefined" && !isTauriEnvironment() && typeof fetch !== "undefined";
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  if (!canUseHttpApi()) return null;
  try {
    const res = await fetch(path, {
      ...options,
      headers: { ...authHeaders(), ...(options?.headers || {}) },
    });
    if (!res.ok) {
      console.warn(`HTTP ${res.status} from ${path}`);
      if (res.status === 401) {
        // The server no longer accepts this device. Without saying so, the app
        // would fall back to empty local storage and present an empty vault as
        // though the notes were gone. Drop the stale credential and ask the
        // app to prompt for re-pairing. See D-061.
        try {
          localStorage.removeItem(STORAGE_KEY_PAIRED);
          localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
          localStorage.removeItem(STORAGE_KEY_PEER_ID);
          window.dispatchEvent(new CustomEvent("omnivault:unauthorized"));
        } catch {
          // Non-browser context; nothing to clear or notify.
        }
      }
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`Network error fetching ${path}:`, err);
    return null;
  }
}

/**
 * Thrown when the server rejected or could not receive a write and this client
 * is paired, meaning the desktop vault — not this browser — is the source of
 * truth. Falling back to localStorage here would look like success while the
 * note silently failed to leave the device.
 */
export class VaultWriteError extends Error {
  constructor(operation: string) {
    super(`Could not save to the vault (${operation}). Your device may have lost the connection.`);
    this.name = "VaultWriteError";
  }
}

/** Fails a paired write rather than letting it degrade into a local-only copy. */
function assertServerWrite<T>(result: T | null, operation: string): T {
  if (result === null || result === undefined) {
    if (StorageService.isPaired()) {
      throw new VaultWriteError(operation);
    }
    // Unpaired "Browse Local" session: local-only is the intended mode (D-021).
    return null as unknown as T;
  }
  return result;
}

// Local storage fallback helpers
function getLocalFolders(): Folder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FOLDERS);
    if (!raw) {
      return DEFAULT_FOLDERS;
    }
    const parsed = JSON.parse(raw) as Folder[];
    const cleaned = parsed.filter(
      (f) =>
        !DUMMY_FOLDER_IDS.has(f.id) &&
        ![
          "Research & Notes",
          "Research & Architecture",
          "SaaS Infrastructure",
          "SaaS Architecture",
          "Market Setups & Charts",
          "Crypto Trends",
          "Product Ideas",
          "Product Roadmaps",
        ].includes(f.name)
    );
    if (cleaned.length !== parsed.length) {
      saveLocalFolders(cleaned);
    }
    return cleaned;
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
      return DEFAULT_ITEMS;
    }
    const parsed = JSON.parse(raw) as VaultItem[];
    const cleaned = parsed.filter(
      (item) => !DUMMY_ITEM_IDS.has(item.id) && !DUMMY_TITLES.has(item.title)
    );
    if (cleaned.length !== parsed.length) {
      saveLocalItems(cleaned);
    }
    return cleaned;
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

  /** Whether this device serves the browser client. Desktop-only setting. */
  async getBrowserAccess(): Promise<boolean> {
    if (!isTauriEnvironment()) return true;
    try {
      return await invoke<boolean>("get_browser_access_cmd");
    } catch {
      return false;
    }
  },

  async setBrowserAccess(enabled: boolean): Promise<boolean> {
    if (!isTauriEnvironment()) return true;
    try {
      return await invoke<boolean>("set_browser_access_cmd", { enabled });
    } catch (err) {
      console.warn("Failed to change browser access:", err);
      return !enabled;
    }
  },

  async getPairingSession(): Promise<{ pin: string; expires_in: number } | null> {
    // The PIN is only ever issued locally, over IPC. A browser client never
    // displays a PIN — it types one the user read off the desktop screen — so
    // there is deliberately no network path here. See D-051.
    if (!isTauriEnvironment()) return null;
    try {
      const session = await invoke<{ pin: string; expires_at: number }>("get_pairing_session_cmd");
      const expiresIn = Math.max(1, Math.round((session.expires_at - Date.now()) / 1000));
      return { pin: session.pin, expires_in: expiresIn };
    } catch (err) {
      console.warn("Failed to get pairing session:", err);
      return null;
    }
  },

  async getDiscoveredPeers(): Promise<PeerInfo[]> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<PeerInfo[]>("get_discovered_peers_cmd");
      } catch (err) {
        console.warn("Failed to get discovered peers:", err);
        return [];
      }
    } else {
      const res = await apiFetch<{ peers: PeerInfo[]; count: number }>("/api/sync/peers");
      return res?.peers || [];
    }
  },

  async getMeshSyncStatus(): Promise<MeshSyncState> {
    if (isTauriEnvironment()) {
      try {
        const raw = await invoke<{
          is_syncing: boolean;
          last_sync_at: number | null;
          peer_count: number;
          peers: PeerInfo[];
          paired_device_ids?: string[];
        }>("get_mesh_sync_status_cmd");
        return {
          status: raw.is_syncing ? "syncing" : raw.peer_count > 0 ? "synced" : "standby",
          peerCount: raw.peer_count,
          lastSyncTimestamp: raw.last_sync_at || undefined,
          peers: raw.peers,
          pairedDeviceIds: raw.paired_device_ids || [],
        };
      } catch {
        return { status: "standby", peerCount: 0 };
      }
    } else {
      const res = await apiFetch<{
        status: string;
        paired_devices_count: number;
        paired_device_ids?: string[];
      }>("/api/sync/status");
      const peersRes = await apiFetch<{ peers: PeerInfo[]; count: number }>("/api/sync/peers");
      const peers = peersRes?.peers || [];
      return {
        status: peers.length > 0 ? "synced" : "standby",
        peerCount: peers.length || (res?.paired_devices_count ?? 0),
        peers,
        pairedDeviceIds: res?.paired_device_ids || [],
      };
    }
  },

  async triggerMeshSync(): Promise<number> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<number>("trigger_mesh_sync_cmd");
      } catch (err) {
        console.warn("Trigger mesh sync failed:", err);
        return 0;
      }
    }
    return 0;
  },

  async pairWithPeer(ip: string, port: number, pin: string): Promise<{ success: boolean; error?: string }> {
    if (isTauriEnvironment()) {
      try {
        await invoke("pair_with_peer_cmd", { peerIp: ip, peerPort: port, pin });
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    } else {
      return this.pairDevice(pin);
    }
  },

  // -------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------
  async getFolders(): Promise<Folder[]> {
    if (isTauriEnvironment()) {
      try {
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
        return await invoke<Folder>("create_folder_cmd", {
          name,
          parentId,
          color,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverFolder = assertServerWrite(await apiFetch<Folder>("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parent_id: parentId, color }),
      }), "create folder");
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
        return await invoke<Folder>("rename_folder_cmd", {
          id: folderId,
          name: newName,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverFolder = assertServerWrite(await apiFetch<Folder>("/api/folders/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folderId, name: newName.trim() }),
      }), "rename folder");
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
        return await invoke<Folder>("move_folder_cmd", {
          id: folderId,
          parentId: newParentId,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverFolder = assertServerWrite(await apiFetch<Folder>("/api/folders/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folderId, parent_id: newParentId }),
      }), "move folder");
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
        await invoke("delete_folder_cmd", { id: folderId });
        return;
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      assertServerWrite(
        await apiFetch<{ status: string }>("/api/folders/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: folderId }),
        }),
        "delete folder"
      );
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

    // Re-parent items inside deleted folders to Quick Inbox (folder_id = null)
    const items = getLocalItems();
    let itemsChanged = false;
    for (const item of items) {
      if (item.folder_id && toDeleteIds.has(item.folder_id)) {
        item.folder_id = null;
        item.updated_at = now;
        itemsChanged = true;
      }
    }
    if (itemsChanged) {
      saveLocalItems(items);
    }
  },

  // -------------------------------------------------------------------------
  // Media Upload & Attachment Handling
  // -------------------------------------------------------------------------
  /**
   * Uploads an image (File, Blob, or base64/dataURL string) to the local backend.
   * Compresses the image to WebP on disk and returns its relative media URL.
   */
  async uploadMedia(
    data: File | Blob | string,
    options?: {
      itemId?: string;
      folderId?: string | null;
      title?: string;
    }
  ): Promise<{ url: string; file_hash: string; item?: VaultItem } | null> {
    try {
      let b64Data: string;

      if (typeof data === "string") {
        b64Data = data;
      } else {
        b64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(data);
        });
      }

      const payload = {
        item_id: options?.itemId,
        folder_id: options?.folderId,
        title: options?.title || (data instanceof File ? data.name.replace(/\.[^/.]+$/, "") : undefined),
        data: b64Data,
      };

      const endpoint = isTauriEnvironment()
        ? `http://127.0.0.1:${cachedServerPort}/api/media/upload`
        : "/api/media/upload";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.warn(`Failed to upload media, status: ${res.status}`);
        return null;
      }

      const result = await res.json();
      if (result && result.url) {
        cacheLocalMedia(result.url, b64Data);
        if (result.file_hash) {
          cacheLocalMedia(result.file_hash, b64Data);
        }
      }
      if (result && result.item) {
        const items = getLocalItems().filter((i) => i.id !== result.item.id);
        items.unshift(result.item);
        saveLocalItems(items);
      }
      return result;
    } catch (err) {
      console.warn("Upload media error:", err);
      return null;
    }
  },

  // -------------------------------------------------------------------------
  // Vault Items (Quick Inbox & Folder Items)
  // -------------------------------------------------------------------------
  async getInboxItems(): Promise<VaultItem[]> {
    // Background migration of any legacy stuck base64 data-URL items (runs at most once per session)
    if (typeof window !== "undefined" && !hasRunDataUrlMigration) {
      hasRunDataUrlMigration = true;
      setTimeout(() => {
        try {
          const items = getLocalItems();
          for (const item of items) {
            if (item.item_type === "image" && item.content.startsWith("data:")) {
              StorageService.uploadMedia(item.content, {
                itemId: item.id,
                folderId: item.folder_id,
                title: item.title,
              }).then((res) => {
                if (res && res.url) {
                  item.content = res.url;
                  saveLocalItems(items);
                }
              }).catch(() => {});
            }
          }
        } catch {
          // ignore
        }
      }, 500);
    }

    if (isTauriEnvironment()) {
      try {
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
    // If it's an image and contains a raw base64 data URL, upload to disk storage first
    if (itemType === "image" && content.startsWith("data:")) {
      try {
        const uploadRes = await StorageService.uploadMedia(content, {
          folderId,
          title,
        });
        if (uploadRes) {
          if (uploadRes.item) {
            return uploadRes.item;
          }
          if (uploadRes.url) {
            content = uploadRes.url;
          }
        }
      } catch (err) {
        console.warn("Auto-upload of data URL during createItem failed:", err);
      }
    }
    if (isTauriEnvironment()) {
      try {
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
      const serverItem = assertServerWrite(
        await apiFetch<VaultItem>("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folder_id: folderId,
            item_type: itemType,
            title: title.trim(),
            content: content.trim(),
            metadata,
          }),
        }),
        "create note"
      );
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
      const serverItem = assertServerWrite(
        await apiFetch<VaultItem>("/api/items/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: itemId,
            title: title.trim(),
            content: content.trim(),
            metadata,
          }),
        }),
        "update note"
      );
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
        return await invoke<VaultItem>("move_item_cmd", {
          id: itemId,
          folderId: newFolderId,
        });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverItem = assertServerWrite(
        await apiFetch<VaultItem>("/api/items/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: itemId,
            folder_id: newFolderId,
          }),
        }),
        "move note"
      );
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
        return await invoke<VaultItem>("toggle_pin_item_cmd", { id: itemId });
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      const serverItem = assertServerWrite(await apiFetch<VaultItem>("/api/items/toggle-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId }),
      }), "pin note");
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
        await invoke("delete_item_cmd", { id: itemId });
        return;
      } catch (err) {
        console.warn("Tauri invoke failed, falling back to local storage:", err);
      }
    } else {
      assertServerWrite(
        await apiFetch<{ status: string }>("/api/items/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: itemId }),
        }),
        "delete note"
      );
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

  async saveMediaToDownloads(
    mediaUrlOrHash: string,
    suggestedFilename?: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    if (isTauriEnvironment()) {
      try {
        const filePath = await invoke<string>("save_media_to_downloads_cmd", {
          mediaUrlOrHash,
          suggestedFilename: suggestedFilename || null,
        });
        return { success: true, filePath };
      } catch (err) {
        console.warn("Tauri save_media_to_downloads_cmd failed, falling back to browser download:", err);
      }
    }

    // Web / Tablet fallback via Blob URL
    try {
      const targetUrl = resolveMediaUrl(mediaUrlOrHash);
      const res = await fetch(targetUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const base = (suggestedFilename || "omnivault_image").replace(/[/\\?%*:|"<>]/g, "_").trim();
      a.download = base.toLowerCase().endsWith(".webp") ? base : `${base}.webp`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 2000);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Download failed" };
    }
  },

  async openFileInFolder(filePath: string): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        await invoke("open_file_in_folder_cmd", { filePath });
      } catch (err) {
        console.warn("Failed to open file in folder:", err);
      }
    }
  },

  async checkPendingShares(): Promise<VaultItem[]> {
    if (isTauriEnvironment()) {
      try {
        const res = await invoke<{ count: number; items: VaultItem[] }>("check_and_process_pending_shares_cmd");
        if (res && res.count > 0 && Array.isArray(res.items)) {
          return res.items;
        }
      } catch (err) {
        console.warn("Failed to check pending shares via Tauri IPC:", err);
      }
    }
    return [];
  },
};
