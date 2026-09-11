use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result, Transaction};
use uuid::Uuid;

use crate::db::models::{Folder, VaultItem};

pub fn get_or_create_device_id(conn: &Connection) -> Result<String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM device_meta WHERE key = 'device_id'",
            [],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(id) = existing {
        Ok(id)
    } else {
        let new_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO device_meta (key, value) VALUES ('device_id', ?1)",
            [&new_id],
        )?;
        Ok(new_id)
    }
}

fn record_revision_tx(
    tx: &Transaction,
    entity_type: &str,
    entity_id: &str,
    device_id: &str,
    change_type: &str,
    payload: &str,
    timestamp: i64,
) -> Result<()> {
    tx.execute(
        "INSERT INTO revisions (entity_type, entity_id, device_id, change_type, payload, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![entity_type, entity_id, device_id, change_type, payload, timestamp],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Folder Operations
// ---------------------------------------------------------------------------

pub fn create_folder(
    conn: &mut Connection,
    name: &str,
    parent_id: Option<&str>,
    color: Option<&str>,
    device_id: &str,
) -> Result<Folder> {
    let now = Utc::now().timestamp_millis();
    let folder_id = Uuid::new_v4().to_string();

    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO folders (id, parent_id, name, color, created_at, updated_at, is_deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        params![folder_id, parent_id, name, color, now, now],
    )?;

    let folder = Folder {
        id: folder_id.clone(),
        parent_id: parent_id.map(|s| s.to_string()),
        name: name.to_string(),
        color: color.map(|s| s.to_string()),
        created_at: now,
        updated_at: now,
        is_deleted: false,
    };

    let payload = serde_json::to_string(&folder).unwrap_or_default();
    record_revision_tx(&tx, "folder", &folder_id, device_id, "created", &payload, now)?;

    tx.commit()?;
    Ok(folder)
}

pub fn rename_folder(
    conn: &mut Connection,
    folder_id: &str,
    new_name: &str,
    device_id: &str,
) -> Result<Folder> {
    let now = Utc::now().timestamp_millis();
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE folders SET name = ?1, updated_at = ?2 WHERE id = ?3 AND is_deleted = 0",
        params![new_name, now, folder_id],
    )?;

    let folder = tx.query_row(
        "SELECT id, parent_id, name, color, created_at, updated_at, is_deleted
         FROM folders WHERE id = ?1",
        [folder_id],
        |row| {
            Ok(Folder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                is_deleted: row.get::<_, i64>(6)? != 0,
            })
        },
    )?;

    let payload = serde_json::to_string(&folder).unwrap_or_default();
    record_revision_tx(&tx, "folder", folder_id, device_id, "updated", &payload, now)?;

    tx.commit()?;
    Ok(folder)
}

pub fn move_folder(
    conn: &mut Connection,
    folder_id: &str,
    new_parent_id: Option<&str>,
    device_id: &str,
) -> Result<Folder> {
    let now = Utc::now().timestamp_millis();
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE folders SET parent_id = ?1, updated_at = ?2 WHERE id = ?3 AND is_deleted = 0",
        params![new_parent_id, now, folder_id],
    )?;

    let folder = tx.query_row(
        "SELECT id, parent_id, name, color, created_at, updated_at, is_deleted
         FROM folders WHERE id = ?1",
        [folder_id],
        |row| {
            Ok(Folder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                is_deleted: row.get::<_, i64>(6)? != 0,
            })
        },
    )?;

    let payload = serde_json::to_string(&folder).unwrap_or_default();
    record_revision_tx(&tx, "folder", folder_id, device_id, "moved", &payload, now)?;

    tx.commit()?;
    Ok(folder)
}

pub fn delete_folder(
    conn: &mut Connection,
    folder_id: &str,
    device_id: &str,
) -> Result<()> {
    let now = Utc::now().timestamp_millis();
    let tx = conn.transaction()?;

    // 1. Recursively find all descendant subfolder IDs
    let mut descendant_folder_ids: Vec<String> = Vec::new();
    {
        let mut stmt = tx.prepare(
            "WITH RECURSIVE subfolders(id) AS (
                SELECT id FROM folders WHERE parent_id = ?1 AND is_deleted = 0
                UNION ALL
                SELECT f.id FROM folders f
                JOIN subfolders s ON f.parent_id = s.id
                WHERE f.is_deleted = 0
             )
             SELECT id FROM subfolders",
        )?;
        let rows = stmt.query_map(params![folder_id], |row| row.get(0))?;
        for r in rows {
            descendant_folder_ids.push(r?);
        }
    }

    // 2. Mark target folder and all descendant folders as deleted
    let mut all_folder_ids = descendant_folder_ids;
    all_folder_ids.push(folder_id.to_string());

    for fid in &all_folder_ids {
        tx.execute(
            "UPDATE folders SET is_deleted = 1, updated_at = ?1 WHERE id = ?2",
            params![now, fid],
        )?;
        record_revision_tx(&tx, "folder", fid, device_id, "deleted", "{}", now)?;
    }

    // 3. Re-parent child items across all deleted folders to Quick Inbox (folder_id = NULL)
    // so user notes and captures are never orphaned or permanently lost
    for fid in &all_folder_ids {
        let mut item_stmt = tx.prepare(
            "SELECT id FROM vault_items WHERE folder_id = ?1 AND is_deleted = 0",
        )?;
        let item_ids: Vec<String> = item_stmt
            .query_map(params![fid], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        for item_id in item_ids {
            tx.execute(
                "UPDATE vault_items SET folder_id = NULL, updated_at = ?1 WHERE id = ?2",
                params![now, &item_id],
            )?;
            record_revision_tx(
                &tx,
                "vault_item",
                &item_id,
                device_id,
                "moved",
                "{\"folder_id\":null}",
                now,
            )?;
        }
    }

    tx.commit()?;
    Ok(())
}

pub fn list_folders(conn: &Connection, include_deleted: bool) -> Result<Vec<Folder>> {
    let sql = if include_deleted {
        "SELECT id, parent_id, name, color, created_at, updated_at, is_deleted
         FROM folders ORDER BY name ASC"
    } else {
        "SELECT id, parent_id, name, color, created_at, updated_at, is_deleted
         FROM folders WHERE is_deleted = 0 ORDER BY name ASC"
    };

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(Folder {
            id: row.get(0)?,
            parent_id: row.get(1)?,
            name: row.get(2)?,
            color: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            is_deleted: row.get::<_, i64>(6)? != 0,
        })
    })?;

    let mut folders = Vec::new();
    for f in rows {
        folders.push(f?);
    }
    Ok(folders)
}

// ---------------------------------------------------------------------------
// Vault Item Operations (Notes, Links, Images, Tickers)
// ---------------------------------------------------------------------------

pub fn create_item(
    conn: &mut Connection,
    folder_id: Option<&str>, // None = Quick Inbox
    item_type: &str,
    title: &str,
    content: &str,
    metadata: Option<&str>,
    device_id: &str,
) -> Result<VaultItem> {
    let now = Utc::now().timestamp_millis();
    let item_id = Uuid::new_v4().to_string();

    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO vault_items (id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 0, ?7, ?8)",
        params![item_id, folder_id, item_type, title, content, metadata, now, now],
    )?;

    let item = VaultItem {
        id: item_id.clone(),
        folder_id: folder_id.map(|s| s.to_string()),
        item_type: item_type.to_string(),
        title: title.to_string(),
        content: content.to_string(),
        metadata: metadata.map(|s| s.to_string()),
        is_pinned: false,
        is_archived: false,
        is_deleted: false,
        created_at: now,
        updated_at: now,
    };

    let payload = serde_json::to_string(&item).unwrap_or_default();
    record_revision_tx(&tx, "vault_item", &item_id, device_id, "created", &payload, now)?;

    tx.commit()?;
    Ok(item)
}

pub fn update_item(
    conn: &mut Connection,
    item_id: &str,
    title: &str,
    content: &str,
    metadata: Option<&str>,
    device_id: &str,
) -> Result<VaultItem> {
    let now = Utc::now().timestamp_millis();
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE vault_items SET title = ?1, content = ?2, metadata = ?3, updated_at = ?4
         WHERE id = ?5 AND is_deleted = 0",
        params![title, content, metadata, now, item_id],
    )?;

    let item = tx.query_row(
        "SELECT id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at
         FROM vault_items WHERE id = ?1",
        [item_id],
        |row| {
            Ok(VaultItem {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                item_type: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                metadata: row.get(5)?,
                is_pinned: row.get::<_, i64>(6)? != 0,
                is_archived: row.get::<_, i64>(7)? != 0,
                is_deleted: row.get::<_, i64>(8)? != 0,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        },
    )?;

    let payload = serde_json::to_string(&item).unwrap_or_default();
    record_revision_tx(&tx, "vault_item", item_id, device_id, "updated", &payload, now)?;

    tx.commit()?;
    Ok(item)
}

pub fn move_item(
    conn: &mut Connection,
    item_id: &str,
    new_folder_id: Option<&str>, // None = Move to Quick Inbox
    device_id: &str,
) -> Result<VaultItem> {
    let now = Utc::now().timestamp_millis();
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE vault_items SET folder_id = ?1, updated_at = ?2 WHERE id = ?3 AND is_deleted = 0",
        params![new_folder_id, now, item_id],
    )?;

    let item = tx.query_row(
        "SELECT id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at
         FROM vault_items WHERE id = ?1",
        [item_id],
        |row| {
            Ok(VaultItem {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                item_type: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                metadata: row.get(5)?,
                is_pinned: row.get::<_, i64>(6)? != 0,
                is_archived: row.get::<_, i64>(7)? != 0,
                is_deleted: row.get::<_, i64>(8)? != 0,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        },
    )?;

    let payload = serde_json::to_string(&item).unwrap_or_default();
    record_revision_tx(&tx, "vault_item", item_id, device_id, "moved", &payload, now)?;

    tx.commit()?;
    Ok(item)
}

pub fn set_item_archive(
    conn: &mut Connection,
    item_id: &str,
    is_archived: bool,
    device_id: &str,
) -> Result<()> {
    let now = Utc::now().timestamp_millis();
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE vault_items SET is_archived = ?1, updated_at = ?2 WHERE id = ?3 AND is_deleted = 0",
        params![if is_archived { 1 } else { 0 }, now, item_id],
    )?;

    let action = if is_archived { "archived" } else { "unarchived" };
    record_revision_tx(&tx, "vault_item", item_id, device_id, action, "{}", now)?;

    tx.commit()?;
    Ok(())
}

pub fn set_item_pin(
    conn: &mut Connection,
    item_id: &str,
    is_pinned: bool,
    device_id: &str,
) -> Result<()> {
    let now = Utc::now().timestamp_millis();
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE vault_items SET is_pinned = ?1, updated_at = ?2 WHERE id = ?3 AND is_deleted = 0",
        params![if is_pinned { 1 } else { 0 }, now, item_id],
    )?;

    record_revision_tx(&tx, "vault_item", item_id, device_id, "pinned", "{}", now)?;

    tx.commit()?;
    Ok(())
}

pub fn toggle_pin_item(
    conn: &mut Connection,
    item_id: &str,
    device_id: &str,
) -> Result<VaultItem> {
    let now = Utc::now().timestamp_millis();
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE vault_items SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END, updated_at = ?1 WHERE id = ?2 AND is_deleted = 0",
        params![now, item_id],
    )?;

    let item = tx.query_row(
        "SELECT id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at
         FROM vault_items WHERE id = ?1",
        [item_id],
        |row| {
            Ok(VaultItem {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                item_type: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                metadata: row.get(5)?,
                is_pinned: row.get::<_, i64>(6)? != 0,
                is_archived: row.get::<_, i64>(7)? != 0,
                is_deleted: row.get::<_, i64>(8)? != 0,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        },
    )?;

    let payload = serde_json::to_string(&item).unwrap_or_default();
    record_revision_tx(&tx, "vault_item", item_id, device_id, "updated", &payload, now)?;

    tx.commit()?;
    Ok(item)
}

pub fn delete_item(
    conn: &mut Connection,
    item_id: &str,
    device_id: &str,
) -> Result<()> {
    let now = Utc::now().timestamp_millis();
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE vault_items SET is_deleted = 1, updated_at = ?1 WHERE id = ?2",
        params![now, item_id],
    )?;

    record_revision_tx(&tx, "vault_item", item_id, device_id, "deleted", "{}", now)?;

    tx.commit()?;
    Ok(())
}

pub fn list_inbox_items(conn: &Connection) -> Result<Vec<VaultItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at
         FROM vault_items
         WHERE folder_id IS NULL AND is_deleted = 0 AND is_archived = 0
         ORDER BY is_pinned DESC, updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(VaultItem {
            id: row.get(0)?,
            folder_id: row.get(1)?,
            item_type: row.get(2)?,
            title: row.get(3)?,
            content: row.get(4)?,
            metadata: row.get(5)?,
            is_pinned: row.get::<_, i64>(6)? != 0,
            is_archived: row.get::<_, i64>(7)? != 0,
            is_deleted: row.get::<_, i64>(8)? != 0,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item?);
    }
    Ok(items)
}

pub fn list_items_by_folder(conn: &Connection, folder_id: &str) -> Result<Vec<VaultItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at
         FROM vault_items
         WHERE folder_id = ?1 AND is_deleted = 0
         ORDER BY is_pinned DESC, updated_at DESC",
    )?;

    let rows = stmt.query_map([folder_id], |row| {
        Ok(VaultItem {
            id: row.get(0)?,
            folder_id: row.get(1)?,
            item_type: row.get(2)?,
            title: row.get(3)?,
            content: row.get(4)?,
            metadata: row.get(5)?,
            is_pinned: row.get::<_, i64>(6)? != 0,
            is_archived: row.get::<_, i64>(7)? != 0,
            is_deleted: row.get::<_, i64>(8)? != 0,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item?);
    }
    Ok(items)
}

pub fn get_item_by_id(conn: &Connection, item_id: &str) -> Result<Option<VaultItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at
         FROM vault_items WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map([item_id], |row| {
        Ok(VaultItem {
            id: row.get(0)?,
            folder_id: row.get(1)?,
            item_type: row.get(2)?,
            title: row.get(3)?,
            content: row.get(4)?,
            metadata: row.get(5)?,
            is_pinned: row.get::<_, i64>(6)? != 0,
            is_archived: row.get::<_, i64>(7)? != 0,
            is_deleted: row.get::<_, i64>(8)? != 0,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })?;

    match rows.next() {
        Some(item) => Ok(Some(item?)),
        None => Ok(None),
    }
}

pub fn seed_defaults_if_empty(_conn: &mut Connection, _device_id: &str) -> Result<()> {
    // Default test entries removed per user request. Fresh databases start completely clean.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::initialize_schema;

    fn setup_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_device_id_persists() {
        let conn = setup_memory_db();
        let dev1 = get_or_create_device_id(&conn).unwrap();
        let dev2 = get_or_create_device_id(&conn).unwrap();
        assert_eq!(dev1, dev2);
        assert!(!dev1.is_empty());
    }

    #[test]
    fn test_folder_crud_and_revisions() {
        let mut conn = setup_memory_db();
        let dev_id = "test-device-1";

        // 1. Create root folder "Product Ideas"
        let root = create_folder(&mut conn, "Product Ideas", None, Some("#2F81F7"), dev_id).unwrap();
        assert_eq!(root.name, "Product Ideas");
        assert_eq!(root.parent_id, None);

        // 2. Create nested child folder "SaaS"
        let child = create_folder(&mut conn, "SaaS", Some(&root.id), None, dev_id).unwrap();
        assert_eq!(child.parent_id, Some(root.id.clone()));

        // 3. Rename folder
        let renamed = rename_folder(&mut conn, &child.id, "SaaS Apps", dev_id).unwrap();
        assert_eq!(renamed.name, "SaaS Apps");

        // 4. Move folder to root
        let moved = move_folder(&mut conn, &child.id, None, dev_id).unwrap();
        assert_eq!(moved.parent_id, None);

        // 5. Delete folder
        delete_folder(&mut conn, &child.id, dev_id).unwrap();
        let active_folders = list_folders(&conn, false).unwrap();
        assert_eq!(active_folders.len(), 1);
        assert_eq!(active_folders[0].name, "Product Ideas");

        // 6. Verify revision log count: created root, created child, updated child, moved child, deleted child = 5
        let rev_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM revisions WHERE entity_type = 'folder'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(rev_count, 5);
    }

    #[test]
    fn test_vault_item_crud_and_inbox_triage() {
        let mut conn = setup_memory_db();
        let dev_id = "test-device-1";

        // 1. Create Quick Inbox item (folder_id is None)
        let item = create_item(
            &mut conn,
            None,
            "ticker",
            "$NVDA",
            "Watch 135 breakout",
            Some(r#"{"ticker":"NVDA"}"#),
            dev_id,
        ).unwrap();
        assert_eq!(item.folder_id, None);
        assert_eq!(item.title, "$NVDA");

        // Verify it appears in inbox
        let inbox = list_inbox_items(&conn).unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].id, item.id);

        // 2. Create a folder "Stock Research"
        let folder = create_folder(&mut conn, "Stock Research", None, None, dev_id).unwrap();

        // 3. Triage / Move item from Inbox to "Stock Research" folder
        let moved_item = move_item(&mut conn, &item.id, Some(&folder.id), dev_id).unwrap();
        assert_eq!(moved_item.folder_id, Some(folder.id.clone()));

        // Inbox is now empty!
        let inbox_after_move = list_inbox_items(&conn).unwrap();
        assert_eq!(inbox_after_move.len(), 0);

        // Folder now has the item
        let folder_items = list_items_by_folder(&conn, &folder.id).unwrap();
        assert_eq!(folder_items.len(), 1);
        assert_eq!(folder_items[0].title, "$NVDA");

        // 4. Update item content
        let updated = update_item(
            &mut conn,
            &item.id,
            "$NVDA (Bought)",
            "Bought 50 shares at 135.20",
            None,
            dev_id,
        ).unwrap();
        assert_eq!(updated.title, "$NVDA (Bought)");

        // 5. Archive item
        set_item_archive(&mut conn, &item.id, true, dev_id).unwrap();
        let active_in_folder: Vec<VaultItem> = list_items_by_folder(&conn, &folder.id)
            .unwrap()
            .into_iter()
            .filter(|i| !i.is_archived)
            .collect();
        assert_eq!(active_in_folder.len(), 0);

        // 6. Delete item
        delete_item(&mut conn, &item.id, dev_id).unwrap();
        let remaining_in_folder = list_items_by_folder(&conn, &folder.id).unwrap();
        assert_eq!(remaining_in_folder.len(), 0);

        // Verify revisions logged for vault_item:
        // 1: created, 2: moved, 3: updated, 4: archived, 5: deleted = 5
        let rev_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM revisions WHERE entity_type = 'vault_item'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(rev_count, 5);
    }

    #[test]
    fn test_recursive_folder_deletion_and_child_reparenting() {
        let mut conn = setup_memory_db();
        let dev_id = "test-device-1";

        // 1. Create nested hierarchy: Parent -> Sub -> Deep
        let parent = create_folder(&mut conn, "Parent", None, None, dev_id).unwrap();
        let sub = create_folder(&mut conn, "Sub", Some(&parent.id), None, dev_id).unwrap();
        let deep = create_folder(&mut conn, "Deep", Some(&sub.id), None, dev_id).unwrap();

        // 2. Add notes to each level of the hierarchy
        let item_parent = create_item(&mut conn, Some(&parent.id), "note", "Note in Parent", "p content", None, dev_id).unwrap();
        let item_sub = create_item(&mut conn, Some(&sub.id), "note", "Note in Sub", "s content", None, dev_id).unwrap();
        let item_deep = create_item(&mut conn, Some(&deep.id), "note", "Note in Deep", "d content", None, dev_id).unwrap();

        // Quick inbox should currently be empty (all items are filed)
        assert_eq!(list_inbox_items(&conn).unwrap().len(), 0);

        // 3. Delete root "Parent" folder
        delete_folder(&mut conn, &parent.id, dev_id).unwrap();

        // 4. Assert that ALL 3 folders are soft-deleted (0 active folders remain)
        let active_folders = list_folders(&conn, false).unwrap();
        assert_eq!(active_folders.len(), 0, "All descendant folders must be soft-deleted");

        // 5. Assert that ALL 3 items are safely re-parented to Quick Inbox (folder_id = NULL)
        let inbox_items = list_inbox_items(&conn).unwrap();
        assert_eq!(inbox_items.len(), 3, "All child items must be preserved in Quick Inbox");

        let inbox_ids: Vec<String> = inbox_items.into_iter().map(|i| i.id).collect();
        assert!(inbox_ids.contains(&item_parent.id));
        assert!(inbox_ids.contains(&item_sub.id));
        assert!(inbox_ids.contains(&item_deep.id));
    }
}
