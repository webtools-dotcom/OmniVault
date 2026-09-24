use rusqlite::{Connection, Result};

pub const SCHEMA_VERSION: i32 = 1;

pub const CREATE_TABLES_SQL: &str = r#"
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- Folders: Hierarchical nested folder tree
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY NOT NULL,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_updated ON folders(updated_at);
CREATE INDEX IF NOT EXISTS idx_folders_deleted ON folders(is_deleted);

-- Vault Items: Notes, Images, Links, and Stock Tickers
CREATE TABLE IF NOT EXISTS vault_items (
    id TEXT PRIMARY KEY NOT NULL,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    item_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    metadata TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_items_folder ON vault_items(folder_id);
CREATE INDEX IF NOT EXISTS idx_vault_items_type ON vault_items(item_type);
CREATE INDEX IF NOT EXISTS idx_vault_items_updated ON vault_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_vault_items_deleted ON vault_items(is_deleted);

-- Media Files: WebP compressed screenshots and image attachments
CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
    file_hash TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_files_item ON media_files(item_id);
CREATE INDEX IF NOT EXISTS idx_media_files_hash ON media_files(file_hash);

-- Revisions: Append-only delta log for store-and-forward mesh sync
CREATE TABLE IF NOT EXISTS revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    change_type TEXT NOT NULL,
    payload TEXT,
    timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revisions_timestamp ON revisions(timestamp);
CREATE INDEX IF NOT EXISTS idx_revisions_entity ON revisions(entity_type, entity_id);

-- Device Meta: Key-value configuration (device ID, name, schema version)
CREATE TABLE IF NOT EXISTS device_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

-- Paired Devices: Authorized mesh peer instances
CREATE TABLE IF NOT EXISTS paired_devices (
    device_id TEXT PRIMARY KEY NOT NULL,
    device_name TEXT NOT NULL,
    auth_token TEXT NOT NULL,
    paired_at INTEGER NOT NULL,
    last_sync_at INTEGER
);
"#;

pub fn initialize_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(CREATE_TABLES_SQL)?;

    // Record or update schema version
    conn.execute(
        "INSERT INTO device_meta (key, value) VALUES ('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [SCHEMA_VERSION.to_string()],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_schema_in_memory() {
        let conn = Connection::open_in_memory().expect("failed to open memory db");
        initialize_schema(&conn).expect("schema initialization failed");

        // Verify tables exist
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert!(tables.contains(&"device_meta".to_string()));
        assert!(tables.contains(&"folders".to_string()));
        assert!(tables.contains(&"media_files".to_string()));
        assert!(tables.contains(&"revisions".to_string()));
        assert!(tables.contains(&"vault_items".to_string()));

        // Verify schema version is recorded
        let version: String = conn
            .query_row(
                "SELECT value FROM device_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "1");
    }

    #[test]
    fn test_foreign_keys_and_nesting() {
        let conn = Connection::open_in_memory().expect("failed to open memory db");
        initialize_schema(&conn).expect("schema initialization failed");

        // 1. Insert parent folder
        conn.execute(
            "INSERT INTO folders (id, parent_id, name, created_at, updated_at) VALUES ('f1', NULL, 'Product Ideas', 1000, 1000)",
            [],
        ).unwrap();

        // 2. Insert child folder
        conn.execute(
            "INSERT INTO folders (id, parent_id, name, created_at, updated_at) VALUES ('f2', 'f1', 'SaaS', 1001, 1001)",
            [],
        ).unwrap();

        // 3. Insert grandchild folder
        conn.execute(
            "INSERT INTO folders (id, parent_id, name, created_at, updated_at) VALUES ('f3', 'f2', 'AI Image Generator', 1002, 1002)",
            [],
        ).unwrap();

        // 4. Insert note inside grandchild folder
        conn.execute(
            "INSERT INTO vault_items (id, folder_id, item_type, title, content, created_at, updated_at)
             VALUES ('item1', 'f3', 'note', 'Pricing Plan', 'Pay as you go tokens', 1003, 1003)",
            [],
        ).unwrap();

        // Verify item is linked to f3
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM vault_items WHERE folder_id = 'f3'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        // 5. Test Quick Inbox item (folder_id IS NULL)
        conn.execute(
            "INSERT INTO vault_items (id, folder_id, item_type, title, content, created_at, updated_at)
             VALUES ('item2', NULL, 'ticker', '$NVDA', 'Breakout watch at 135', 1004, 1004)",
            [],
        ).unwrap();

        let inbox_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM vault_items WHERE folder_id IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(inbox_count, 1);
    }
}
