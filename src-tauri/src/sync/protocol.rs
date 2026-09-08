use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

use crate::db::models::{Folder, MediaFile, Revision, VaultItem};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum SyncMessage {
    Hello {
        device_id: String,
        auth_token: String,
        latest_timestamp: i64,
    },
    HelloAck {
        device_id: String,
        accepted: bool,
        latest_timestamp: i64,
    },
    GetDeltas {
        since_timestamp: i64,
    },
    Deltas {
        revisions: Vec<Revision>,
    },
    SyncComplete,
    Error {
        message: String,
    },
}

/// Queries all revisions recorded after `since_timestamp`.
/// Optionally excludes revisions originating from `exclude_device` to prevent echo.
pub fn query_revisions_since(
    conn: &Connection,
    since_timestamp: i64,
    exclude_device: Option<&str>,
) -> Result<Vec<Revision>> {
    let (sql, params_vec): (&str, Vec<rusqlite::types::Value>) = match exclude_device {
        Some(dev) => (
            "SELECT id, entity_type, entity_id, device_id, change_type, payload, timestamp
             FROM revisions
             WHERE timestamp > ?1 AND device_id != ?2
             ORDER BY timestamp ASC, id ASC",
            vec![since_timestamp.into(), dev.to_string().into()],
        ),
        None => (
            "SELECT id, entity_type, entity_id, device_id, change_type, payload, timestamp
             FROM revisions
             WHERE timestamp > ?1
             ORDER BY timestamp ASC, id ASC",
            vec![since_timestamp.into()],
        ),
    };

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), |row| {
        Ok(Revision {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            entity_id: row.get(2)?,
            device_id: row.get(3)?,
            change_type: row.get(4)?,
            payload: row.get(5)?,
            timestamp: row.get(6)?,
        })
    })?;

    let mut revisions = Vec::new();
    for r in rows {
        revisions.push(r?);
    }
    Ok(revisions)
}

/// Applies a sequence of remote revisions from a peer into the local SQLite database.
/// Uses Last-Write-Wins based on timestamps to guarantee convergence.
pub fn apply_remote_revisions(
    conn: &mut Connection,
    revisions: &[Revision],
) -> Result<usize> {
    let tx = conn.transaction()?;
    let mut applied_count = 0;

    for rev in revisions {
        match rev.entity_type.as_str() {
            "folder" => {
                if let Some(payload_str) = &rev.payload {
                    if let Ok(folder) = serde_json::from_str::<Folder>(payload_str) {
                        // Check local updated_at timestamp
                        let local_updated: Option<i64> = tx
                            .query_row(
                                "SELECT updated_at FROM folders WHERE id = ?1",
                                [&folder.id],
                                |r| r.get(0),
                            )
                            .ok();

                        let should_apply = match local_updated {
                            Some(local_ts) => folder.updated_at >= local_ts,
                            None => true,
                        };

                        if should_apply {
                            tx.execute(
                                "INSERT INTO folders (id, parent_id, name, color, created_at, updated_at, is_deleted)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                                 ON CONFLICT(id) DO UPDATE SET
                                    parent_id = excluded.parent_id,
                                    name = excluded.name,
                                    color = excluded.color,
                                    updated_at = excluded.updated_at,
                                    is_deleted = excluded.is_deleted
                                 WHERE excluded.updated_at >= folders.updated_at",
                                params![
                                    folder.id,
                                    folder.parent_id,
                                    folder.name,
                                    folder.color,
                                    folder.created_at,
                                    folder.updated_at,
                                    if folder.is_deleted { 1 } else { 0 },
                                ],
                            )?;
                            applied_count += 1;
                        }
                    }
                }
            }

            "vault_item" => {
                if let Some(payload_str) = &rev.payload {
                    if let Ok(item) = serde_json::from_str::<VaultItem>(payload_str) {
                        let local_updated: Option<i64> = tx
                            .query_row(
                                "SELECT updated_at FROM vault_items WHERE id = ?1",
                                [&item.id],
                                |r| r.get(0),
                            )
                            .ok();

                        let should_apply = match local_updated {
                            Some(local_ts) => item.updated_at >= local_ts,
                            None => true,
                        };

                        if should_apply {
                            tx.execute(
                                "INSERT INTO vault_items (id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                                 ON CONFLICT(id) DO UPDATE SET
                                    folder_id = excluded.folder_id,
                                    item_type = excluded.item_type,
                                    title = excluded.title,
                                    content = excluded.content,
                                    metadata = excluded.metadata,
                                    is_pinned = excluded.is_pinned,
                                    is_archived = excluded.is_archived,
                                    is_deleted = excluded.is_deleted,
                                    updated_at = excluded.updated_at
                                 WHERE excluded.updated_at >= vault_items.updated_at",
                                params![
                                    item.id,
                                    item.folder_id,
                                    item.item_type,
                                    item.title,
                                    item.content,
                                    item.metadata,
                                    if item.is_pinned { 1 } else { 0 },
                                    if item.is_archived { 1 } else { 0 },
                                    if item.is_deleted { 1 } else { 0 },
                                    item.created_at,
                                    item.updated_at,
                                ],
                            )?;
                            applied_count += 1;
                        }
                    }
                }
            }

            "media_file" => {
                if let Some(payload_str) = &rev.payload {
                    if let Ok(media) = serde_json::from_str::<MediaFile>(payload_str) {
                        tx.execute(
                            "INSERT INTO media_files (id, item_id, file_hash, relative_path, mime_type, byte_size, width, height, created_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                             ON CONFLICT(id) DO NOTHING",
                            params![
                                media.id,
                                media.item_id,
                                media.file_hash,
                                media.relative_path,
                                media.mime_type,
                                media.byte_size,
                                media.width,
                                media.height,
                                media.created_at,
                            ],
                        )?;
                        applied_count += 1;
                    }
                }
            }

            _ => {}
        }

        // Record revision locally to track peer progress (without re-broadcasting locally)
        tx.execute(
            "INSERT INTO revisions (entity_type, entity_id, device_id, change_type, payload, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![rev.entity_type, rev.entity_id, rev.device_id, rev.change_type, rev.payload, rev.timestamp],
        )?;
    }

    tx.commit()?;
    Ok(applied_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::initialize_schema;
    use crate::db::storage::{create_folder, create_item, list_folders, list_inbox_items, list_items_by_folder};

    fn setup_node_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_delta_sync_across_two_nodes() {
        let mut node_a = setup_node_db();
        let mut node_b = setup_node_db();

        let dev_a = "device-phone-a";
        let dev_b = "device-laptop-b";

        // 1. On Node A (Phone while outside): User creates folder and items
        let folder = create_folder(&mut node_a, "Stock Research", None, Some("#2F81F7"), dev_a).unwrap();
        let _item_in_folder = create_item(
            &mut node_a,
            Some(&folder.id),
            "ticker",
            "$NVDA",
            "Target entry at 132.50",
            Some(r#"{"ticker":"NVDA"}"#),
            dev_a,
        ).unwrap();
        let _inbox_item = create_item(
            &mut node_a,
            None,
            "note",
            "Coffee Machine Idea",
            "Smart timer with bluetooth",
            None,
            dev_a,
        ).unwrap();

        // Node B initially has 0 folders and 0 items
        assert_eq!(list_folders(&node_b, false).unwrap().len(), 0);
        assert_eq!(list_inbox_items(&node_b).unwrap().len(), 0);

        // 2. Query deltas from Node A since timestamp 0
        let deltas_a = query_revisions_since(&node_a, 0, None).unwrap();
        assert_eq!(deltas_a.len(), 3); // 1 folder + 2 items

        // 3. Node B applies the delta stream from Node A
        let applied = apply_remote_revisions(&mut node_b, &deltas_a).unwrap();
        assert_eq!(applied, 3);

        // 4. Verify Node B now has the EXACT identical state!
        let b_folders = list_folders(&node_b, false).unwrap();
        assert_eq!(b_folders.len(), 1);
        assert_eq!(b_folders[0].name, "Stock Research");

        let b_folder_items = list_items_by_folder(&node_b, &folder.id).unwrap();
        assert_eq!(b_folder_items.len(), 1);
        assert_eq!(b_folder_items[0].title, "$NVDA");

        let b_inbox = list_inbox_items(&node_b).unwrap();
        assert_eq!(b_inbox.len(), 1);
        assert_eq!(b_inbox[0].title, "Coffee Machine Idea");

        // 5. Subsequent delta pull with updated timestamp returns 0 changes (clean up-to-date)
        let latest_ts = deltas_a.last().unwrap().timestamp;
        let new_deltas = query_revisions_since(&node_a, latest_ts, None).unwrap();
        assert_eq!(new_deltas.len(), 0);
    }
}
