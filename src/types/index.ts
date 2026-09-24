// TypeScript types matching OmniVault Rust core models and UI state

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  created_at: number;
  updated_at: number;
  is_deleted: boolean;
}

export interface FolderTreeNode {
  folder: Folder;
  children: FolderTreeNode[];
  depth: number;
}

export type ItemType = "note" | "image" | "link" | "ticker" | "file";

export interface VaultItem {
  id: string;
  folder_id: string | null; // null represents Quick Inbox
  item_type: ItemType;
  title: string;
  content: string;
  metadata: string | null; // JSON string
  is_pinned: boolean;
  is_archived: boolean;
  is_deleted: boolean;
  created_at: number;
  updated_at: number;
}

export interface MediaFile {
  id: string;
  item_id: string;
  file_hash: string;
  relative_path: string;
  mime_type: string;
  byte_size: number;
  width?: number;
  height?: number;
  created_at: number;
}

export type ActiveView =
  | { type: "inbox" }
  | { type: "folder"; folderId: string }
  | { type: "trash" }
  | { type: "settings" };

export interface BreadcrumbItem {
  id: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
}

export type MeshSyncStatus = "standby" | "discovering" | "syncing" | "synced" | "error";

export interface PeerInfo {
  device_id: string;
  device_name: string;
  sync_port: number;
  addr: string;
  last_seen: number;
}

export interface MeshSyncState {
  status: MeshSyncStatus;
  peerCount: number;
  lastSyncTimestamp?: number;
  errorMessage?: string;
  peers?: PeerInfo[];
  /** Every device this vault has ever paired with. Not who is here now. */
  pairedDeviceIds?: string[];
  /** Devices present now: mesh peers plus paired devices seen recently. */
  presentDeviceIds?: string[];
}
