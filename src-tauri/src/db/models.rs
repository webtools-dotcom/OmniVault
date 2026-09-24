use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultItem {
    pub id: String,
    pub folder_id: Option<String>, // None = Quick Inbox
    pub item_type: String,
    pub title: String,
    pub content: String,
    pub metadata: Option<String>, // JSON string
    pub is_pinned: bool,
    pub is_archived: bool,
    pub is_deleted: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaFile {
    pub id: String,
    pub item_id: String,
    pub file_hash: String,
    pub relative_path: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Revision {
    pub id: i64,
    pub entity_type: String, // "folder", "vault_item", "media_file"
    pub entity_id: String,
    pub device_id: String,
    pub change_type: String, // "created", "updated", "deleted", "moved"
    pub payload: Option<String>,
    pub timestamp: i64,
}
