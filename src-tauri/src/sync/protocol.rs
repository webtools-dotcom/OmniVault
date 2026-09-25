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

/// Revisions with a local id above `after_id`, oldest first, excluding those
/// that originated on `exclude_device` (the caller already has them).
///
/// Ids follow insertion order on this device, including revisions relayed from
/// other devices, so an id cursor never skips a change the way a timestamp
/// cursor does when device clocks disagree.
pub fn query_revisions_after_id(
    conn: &Connection,
    after_id: i64,
    exclude_device: &str,
    limit: usize,
) -> Result<Vec<Revision>> {
    let mut stmt = conn.prepare(
        "SELECT id, entity_type, entity_id, device_id, change_type, payload, timestamp
         FROM revisions
         WHERE id > ?1 AND device_id != ?2
         ORDER BY id ASC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(
        rusqlite::params![after_id, exclude_device, limit as i64],
        |row| {
            Ok(Revision {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                device_id: row.get(3)?,
                change_type: row.get(4)?,
                payload: row.get(5)?,
                timestamp: row.get(6)?,
            })
        },
    )?;
    rows.collect()
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

/// A revision may reference a parent this device has not received yet (clock
/// skew, or the parent predates the batch). Foreign keys would abort the whole
/// transaction and stall sync, so the unresolvable link is dropped instead: the
/// item lands in the Quick Inbox or the folder at the root until a later
/// revision moves it.
fn resolve_parent(tx: &rusqlite::Transaction, table: &str, id: Option<&str>) -> Option<String> {
    let id = id?;
    let exists: i64 = tx
        .query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE id = ?1"),
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if exists > 0 {
        Some(id.to_string())
    } else {
        None
    }
}

/// Deterministic Last-Write-Wins.
///
/// Timestamps can tie. On a tie the row contents are compared, so both devices
/// pick the same winner and converge.
fn remote_wins(local: Option<(i64, String)>, remote_ts: i64, remote_key: &str) -> bool {
    match local {
        None => true,
        Some((local_ts, local_key)) => match remote_ts.cmp(&local_ts) {
            std::cmp::Ordering::Greater => true,
            std::cmp::Ordering::Less => false,
            std::cmp::Ordering::Equal => remote_key > local_key.as_str(),
        },
    }
}

fn folder_key(f: &Folder) -> String {
    format!(
        "{}|{}|{}|{}",
        f.parent_id.as_deref().unwrap_or(""),
        f.name,
        f.color.as_deref().unwrap_or(""),
        f.is_deleted as u8
    )
}

fn item_key(i: &VaultItem) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        i.folder_id.as_deref().unwrap_or(""),
        i.item_type,
        i.title,
        i.is_pinned as u8,
        i.is_archived as u8,
        i.is_deleted as u8,
        i.metadata.as_deref().unwrap_or(""),
        i.content
    )
}

/// Applies a sequence of remote revisions from a peer into the local SQLite database.
/// Uses Last-Write-Wins based on timestamps to guarantee convergence.
pub fn apply_remote_revisions(conn: &mut Connection, revisions: &[Revision]) -> Result<usize> {
    let tx = conn.transaction()?;
    let mut applied_count = 0;

    for rev in revisions {
        // A revision already held (received directly and again via another
        // peer) is skipped, so relayed changes cannot circulate forever.
        let already_held: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM revisions WHERE entity_type = ?1 AND entity_id = ?2
             AND device_id = ?3 AND change_type = ?4 AND timestamp = ?5)",
            params![
                rev.entity_type,
                rev.entity_id,
                rev.device_id,
                rev.change_type,
                rev.timestamp
            ],
            |row| row.get(0),
        )?;
        if already_held {
            continue;
        }

        match rev.entity_type.as_str() {
            "folder" => {
                if let Some(payload_str) = &rev.payload {
                    if let Ok(folder) = serde_json::from_str::<Folder>(payload_str) {
                        let local: Option<(i64, String)> = tx
                            .query_row(
                                "SELECT updated_at, parent_id, name, color, is_deleted FROM folders WHERE id = ?1",
                                [&folder.id],
                                |r| {
                                    Ok((
                                        r.get::<_, i64>(0)?,
                                        format!(
                                            "{}|{}|{}|{}",
                                            r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                                            r.get::<_, String>(2)?,
                                            r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                                            r.get::<_, i64>(4)?,
                                        ),
                                    ))
                                },
                            )
                            .ok();

                        let should_apply =
                            remote_wins(local, folder.updated_at, &folder_key(&folder));

                        if should_apply {
                            tx.execute(
                                "INSERT INTO folders (id, parent_id, name, color, created_at, updated_at, is_deleted)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                                 ON CONFLICT(id) DO UPDATE SET
                                    parent_id = excluded.parent_id,
                                    name = excluded.name,
                                    color = excluded.color,
                                    updated_at = excluded.updated_at,
                                    is_deleted = excluded.is_deleted",
                                params![
                                    folder.id,
                                    resolve_parent(&tx, "folders", folder.parent_id.as_deref()),
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
                        let local: Option<(i64, String)> = tx
                            .query_row(
                                "SELECT updated_at, folder_id, item_type, title, is_pinned, is_archived, is_deleted, metadata, content FROM vault_items WHERE id = ?1",
                                [&item.id],
                                |r| {
                                    Ok((
                                        r.get::<_, i64>(0)?,
                                        format!(
                                            "{}|{}|{}|{}|{}|{}|{}|{}",
                                            r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                                            r.get::<_, String>(2)?,
                                            r.get::<_, String>(3)?,
                                            r.get::<_, i64>(4)?,
                                            r.get::<_, i64>(5)?,
                                            r.get::<_, i64>(6)?,
                                            r.get::<_, Option<String>>(7)?.unwrap_or_default(),
                                            r.get::<_, String>(8)?,
                                        ),
                                    ))
                                },
                            )
                            .ok();

                        let should_apply = remote_wins(local, item.updated_at, &item_key(&item));

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
                                    updated_at = excluded.updated_at",
                                params![
                                    item.id,
                                    resolve_parent(&tx, "folders", item.folder_id.as_deref()),
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
                    // Same reasoning as resolve_parent: a media row whose item has
                    // not arrived would abort the batch. The blob is re-fetched by
                    // the missing-media sweep once the item lands.
                    let media = serde_json::from_str::<MediaFile>(payload_str)
                        .ok()
                        .filter(|m| resolve_parent(&tx, "vault_items", Some(&m.item_id)).is_some());
                    if let Some(media) = media {
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

        // Record the revision so it can be relayed to other peers.
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
    use crate::db::storage::{
        create_folder, create_item, list_folders, list_inbox_items, list_items_by_folder,
    };

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
        let _dev_b = "device-laptop-b";

        // 1. On Node A (Phone while outside): User creates folder and items
        let folder =
            create_folder(&mut node_a, "Stock Research", None, Some("#2F81F7"), dev_a).unwrap();
        let _item_in_folder = create_item(
            &mut node_a,
            Some(&folder.id),
            "ticker",
            "$NVDA",
            "Target entry at 132.50",
            Some(r#"{"ticker":"NVDA"}"#),
            dev_a,
        )
        .unwrap();
        let _inbox_item = create_item(
            &mut node_a,
            None,
            "note",
            "Coffee Machine Idea",
            "Smart timer with bluetooth",
            None,
            dev_a,
        )
        .unwrap();

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

    /// Same item, same millisecond, different edits on two devices. Under the
    /// old `>=` each device accepted the other and they diverged forever.
    #[test]
    fn same_millisecond_edits_converge_on_both_devices() {
        let mut node_a = setup_node_db();
        let mut node_b = setup_node_db();

        let ts = 1_700_000_000_000i64;
        let mk = |content: &str| VaultItem {
            id: "item-1".to_string(),
            folder_id: None,
            item_type: "note".to_string(),
            title: "Shared".to_string(),
            content: content.to_string(),
            metadata: None,
            is_pinned: false,
            is_archived: false,
            is_deleted: false,
            created_at: ts,
            updated_at: ts,
        };
        let rev = |dev: &str, item: &VaultItem| Revision {
            id: 0,
            entity_type: "vault_item".to_string(),
            entity_id: item.id.clone(),
            device_id: dev.to_string(),
            change_type: "updated".to_string(),
            payload: Some(serde_json::to_string(item).unwrap()),
            timestamp: ts,
        };

        let from_a = mk("edit made on the laptop");
        let from_b = mk("edit made on the tablet");

        // Each device starts holding only its own edit...
        apply_remote_revisions(&mut node_a, &[rev("a", &from_a)]).unwrap();
        apply_remote_revisions(&mut node_b, &[rev("b", &from_b)]).unwrap();
        // ...then receives the other one.
        apply_remote_revisions(&mut node_a, &[rev("b", &from_b)]).unwrap();
        apply_remote_revisions(&mut node_b, &[rev("a", &from_a)]).unwrap();

        let read = |c: &Connection| -> String {
            c.query_row(
                "SELECT content FROM vault_items WHERE id = ?1",
                ["item-1"],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(
            read(&node_a),
            read(&node_b),
            "devices diverged on a timestamp tie"
        );
        // Deterministic winner: the lexicographically greater row.
        assert_eq!(read(&node_a), "edit made on the tablet");
    }

    /// A revision naming an unknown folder must not abort the batch.
    #[test]
    fn an_item_in_an_unknown_folder_still_lands_and_does_not_stall_the_batch() {
        let mut conn = setup_node_db();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();

        let ts = 1_700_000_000_000i64;
        let orphan = VaultItem {
            id: "item-orphan".to_string(),
            folder_id: Some("folder-nobody-has-seen".to_string()),
            item_type: "note".to_string(),
            title: "Arrived early".to_string(),
            content: "body".to_string(),
            metadata: None,
            is_pinned: false,
            is_archived: false,
            is_deleted: false,
            created_at: ts,
            updated_at: ts,
        };
        let revs = vec![
            Revision {
                id: 0,
                entity_type: "vault_item".to_string(),
                entity_id: orphan.id.clone(),
                device_id: "peer".to_string(),
                change_type: "created".to_string(),
                payload: Some(serde_json::to_string(&orphan).unwrap()),
                timestamp: ts,
            },
            Revision {
                id: 0,
                entity_type: "vault_item".to_string(),
                entity_id: "item-normal".to_string(),
                device_id: "peer".to_string(),
                change_type: "created".to_string(),
                payload: Some(
                    serde_json::to_string(&VaultItem {
                        id: "item-normal".to_string(),
                        folder_id: None,
                        title: "Behind the orphan".to_string(),
                        ..orphan.clone()
                    })
                    .unwrap(),
                ),
                timestamp: ts + 1,
            },
        ];

        let applied = apply_remote_revisions(&mut conn, &revs)
            .expect("an unresolvable folder must not fail the batch");
        assert_eq!(
            applied, 2,
            "the revision behind the orphan must still apply"
        );

        let folder_id: Option<String> = conn
            .query_row(
                "SELECT folder_id FROM vault_items WHERE id = ?1",
                ["item-orphan"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(folder_id, None, "the orphan should land in Quick Inbox");
    }
}
