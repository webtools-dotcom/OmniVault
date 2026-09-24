//! Restores a vault from an archive written by `export`.
//!
//! A restore is a merge, not a file copy: every row in the archive is applied
//! the way a peer's revision is, so Last-Write-Wins resolves each collision and
//! a restore never overwrites work done after the backup was taken.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::Connection;

use crate::db::models::{Folder, MediaFile, Revision, VaultItem};
use crate::sync::protocol::apply_remote_revisions;

#[derive(Debug)]
pub enum ImportError {
    Db(rusqlite::Error),
    Io(std::io::Error),
    /// The file is not an archive this app can read, and the message says why
    /// in words a person can act on.
    Archive(String),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportError::Db(e) => write!(f, "The vault would not accept the restore: {e}"),
            ImportError::Io(e) => write!(f, "Could not read the backup: {e}"),
            ImportError::Archive(m) => write!(f, "{m}"),
        }
    }
}

impl From<rusqlite::Error> for ImportError {
    fn from(e: rusqlite::Error) -> Self {
        ImportError::Db(e)
    }
}

impl From<std::io::Error> for ImportError {
    fn from(e: std::io::Error) -> Self {
        ImportError::Io(e)
    }
}

/// The largest archive a restore will take in. Generous next to a real backup —
/// an 18-note vault with seven images came to 8.8 MB — and small enough that a
/// mistaken pick cannot run a phone out of memory.
pub const MAX_ARCHIVE_BYTES: usize = 512 * 1024 * 1024;

/// The smallest thing that could even be a zip: an empty archive's end-of-
/// central-directory record.
pub const MIN_ARCHIVE_BYTES: usize = 22;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportSummary {
    /// Rows the vault actually took — a row the local copy already had in a
    /// newer form is read and then declined, and is not counted here.
    pub applied: usize,
    pub notes_in_backup: usize,
    pub media_added: usize,
    /// Notes from the backup that are live in this vault now. Counted after
    /// the merge, so it answers the question a person is actually asking —
    /// "are my notes back" — rather than how many rows changed hands.
    pub notes_present: usize,
    /// Notes in the backup that were deleted on this device after the backup was
    /// taken, and so were not restored. Reported so the summary explains why fewer
    /// notes came back than the archive holds.
    pub notes_left_deleted: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackupFile {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub modified_ms: i64,
}

// ---------------------------------------------------------------------------
// Reading the archive
// ---------------------------------------------------------------------------

struct Entry {
    name: String,
    method: u16,
    data_offset: usize,
    compressed: usize,
    uncompressed: usize,
}

fn u16_at(b: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([b[i], b[i + 1]])
}

fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

/// Walks the central directory, which is the authoritative index of a zip —
/// scanning for local headers instead would trip over any file whose *contents*
/// happen to contain the signature.
fn read_directory(bytes: &[u8]) -> Result<Vec<Entry>, ImportError> {
    if bytes.len() < 22 {
        return Err(ImportError::Archive(
            "That file is too small to be a backup.".into(),
        ));
    }
    // The end-of-central-directory record sits at the very end, after a comment
    // of up to 64 KB, so it is found by scanning backwards.
    let scan_from = bytes.len().saturating_sub(22 + 65_535);
    let eocd = (scan_from..=bytes.len() - 22)
        .rev()
        .find(|&i| u32_at(bytes, i) == 0x0605_4b50)
        .ok_or_else(|| {
            ImportError::Archive("That file is not a zip archive, or it is incomplete.".into())
        })?;

    let count = u16_at(bytes, eocd + 10) as usize;
    let mut pos = u32_at(bytes, eocd + 16) as usize;
    let mut entries = Vec::with_capacity(count);

    for _ in 0..count {
        if pos + 46 > bytes.len() || u32_at(bytes, pos) != 0x0201_4b50 {
            return Err(ImportError::Archive(
                "The backup's index is damaged.".into(),
            ));
        }
        let method = u16_at(bytes, pos + 10);
        let compressed = u32_at(bytes, pos + 20) as usize;
        let uncompressed = u32_at(bytes, pos + 24) as usize;
        let name_len = u16_at(bytes, pos + 28) as usize;
        let extra_len = u16_at(bytes, pos + 30) as usize;
        let comment_len = u16_at(bytes, pos + 32) as usize;
        let local_offset = u32_at(bytes, pos + 42) as usize;
        let name = String::from_utf8_lossy(&bytes[pos + 46..pos + 46 + name_len]).to_string();

        if local_offset + 30 > bytes.len() || u32_at(bytes, local_offset) != 0x0403_4b50 {
            return Err(ImportError::Archive(format!(
                "The entry '{name}' is damaged."
            )));
        }
        let l_name = u16_at(bytes, local_offset + 26) as usize;
        let l_extra = u16_at(bytes, local_offset + 28) as usize;
        let data_offset = local_offset + 30 + l_name + l_extra;

        entries.push(Entry {
            name,
            method,
            data_offset,
            compressed,
            uncompressed,
        });
        pos += 46 + name_len + extra_len + comment_len;
    }
    Ok(entries)
}

fn read_entry(bytes: &[u8], e: &Entry) -> Result<Vec<u8>, ImportError> {
    let end = e.data_offset + e.compressed;
    if end > bytes.len() {
        return Err(ImportError::Archive(format!(
            "'{}' runs past the end of the file.",
            e.name
        )));
    }
    let raw = &bytes[e.data_offset..end];
    match e.method {
        0 => Ok(raw.to_vec()),
        8 => {
            // Our own exports are stored, but a person who unzipped and rezipped
            // a backup by hand has a deflated one, and it is still their vault.
            let mut out = Vec::with_capacity(e.uncompressed);
            flate2::read::DeflateDecoder::new(raw)
                .read_to_end(&mut out)
                .map_err(|_| {
                    ImportError::Archive(format!("'{}' could not be unpacked.", e.name))
                })?;
            Ok(out)
        }
        other => Err(ImportError::Archive(format!(
            "'{}' uses compression this app cannot read (method {other}).",
            e.name
        ))),
    }
}

// ---------------------------------------------------------------------------
// Offering the archive's rows to the vault
// ---------------------------------------------------------------------------

/// Restores `archive` into the vault at `base_dir`.
pub fn import_vault(
    conn: &mut Connection,
    base_dir: &Path,
    archive: &Path,
) -> Result<ImportSummary, ImportError> {
    import_vault_bytes(conn, base_dir, &fs::read(archive)?)
}

/// Restores from an archive already in memory. Android's document picker
/// provides a stream rather than a readable path, so the bytes arrive without a
/// file name on this filesystem.
pub fn import_vault_bytes(
    conn: &mut Connection,
    base_dir: &Path,
    bytes: &[u8],
) -> Result<ImportSummary, ImportError> {
    let entries = read_directory(bytes)?;

    let db_entry = entries
        .iter()
        .find(|e| e.name == "omnivault.db")
        .ok_or_else(|| {
            ImportError::Archive(
                "That zip has no omnivault.db in it, so it is not an OmniVault backup.".into(),
            )
        })?;

    // The archived database is opened as its own connection in a scratch
    // directory; nothing is read out of the live vault's files.
    let scratch = std::env::temp_dir().join(format!("ov-restore-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&scratch)?;
    let scratch_db = scratch.join("backup.db");
    fs::write(&scratch_db, read_entry(bytes, db_entry)?)?;

    let result = (|| -> Result<ImportSummary, ImportError> {
        let old = Connection::open(&scratch_db).map_err(|_| {
            ImportError::Archive("The database inside that backup could not be opened.".into())
        })?;

        let folders = read_folders(&old)?;
        let items = read_items(&old)?;
        let media_rows = read_media_rows(&old)?;
        let notes_in_backup = items.iter().filter(|i| !i.is_deleted).count();

        // Recorded with the current time so peers see them as new and pull the
        // restored notes; Last-Write-Wins still compares each row's own
        // updated_at, which travels inside the payload.
        let now = Utc::now().timestamp_millis();
        let mut revisions: Vec<Revision> = Vec::with_capacity(folders.len() + items.len());
        for f in &folders {
            revisions.push(Revision {
                id: 0,
                entity_type: "folder".into(),
                entity_id: f.id.clone(),
                device_id: "restore".into(),
                change_type: "updated".into(),
                payload: Some(serde_json::to_string(f).unwrap_or_default()),
                timestamp: now,
            });
        }
        for i in &items {
            revisions.push(Revision {
                id: 0,
                entity_type: "vault_item".into(),
                entity_id: i.id.clone(),
                device_id: "restore".into(),
                change_type: if i.is_deleted {
                    "deleted".into()
                } else {
                    "updated".into()
                },
                payload: Some(serde_json::to_string(i).unwrap_or_default()),
                timestamp: now,
            });
        }
        for m in &media_rows {
            revisions.push(Revision {
                id: 0,
                entity_type: "media_file".into(),
                entity_id: m.id.clone(),
                device_id: "restore".into(),
                change_type: "created".into(),
                payload: Some(serde_json::to_string(m).unwrap_or_default()),
                timestamp: now,
            });
        }

        let applied = apply_remote_revisions(conn, &revisions)?;

        // Blobs are named by content hash, so one already on disk is the same
        // bytes by definition and is left alone.
        let media_dir = base_dir.join("media");
        fs::create_dir_all(&media_dir)?;
        let present: HashSet<String> = fs::read_dir(&media_dir)
            .map(|rd| {
                rd.flatten()
                    .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let mut media_added = 0usize;
        for e in &entries {
            let name = match e.name.strip_prefix("media/") {
                Some(n) => n,
                None => continue,
            };
            // A name from the archive must not be able to point outside the
            // media folder.
            if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
                continue;
            }
            if present.contains(name) {
                continue;
            }
            fs::write(media_dir.join(name), read_entry(bytes, e)?)?;
            media_added += 1;
        }

        // What the merge actually left behind, asked of the vault rather than
        // inferred from the revision count.
        let mut present = 0usize;
        let mut left_deleted = 0usize;
        {
            let mut stmt = conn.prepare("SELECT is_deleted FROM vault_items WHERE id = ?1")?;
            for i in items.iter().filter(|i| !i.is_deleted) {
                match stmt.query_row([&i.id], |r| r.get::<_, i64>(0)) {
                    Ok(0) => present += 1,
                    Ok(_) => left_deleted += 1,
                    Err(_) => {}
                }
            }
        }

        Ok(ImportSummary {
            applied,
            notes_in_backup,
            media_added,
            notes_present: present,
            notes_left_deleted: left_deleted,
        })
    })();

    let _ = fs::remove_dir_all(&scratch);
    result
}

fn read_folders(conn: &Connection) -> Result<Vec<Folder>, ImportError> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, name, color, created_at, updated_at, is_deleted FROM folders",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Folder {
            id: r.get(0)?,
            parent_id: r.get(1)?,
            name: r.get(2)?,
            color: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
            is_deleted: r.get::<_, i64>(6)? != 0,
        })
    })?;
    Ok(rows.flatten().collect())
}

fn read_items(conn: &Connection) -> Result<Vec<VaultItem>, ImportError> {
    let mut stmt = conn.prepare(
        "SELECT id, folder_id, item_type, title, content, metadata, is_pinned, is_archived,
                is_deleted, created_at, updated_at
         FROM vault_items",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(VaultItem {
            id: r.get(0)?,
            folder_id: r.get(1)?,
            item_type: r.get(2)?,
            title: r.get(3)?,
            content: r.get(4)?,
            metadata: r.get(5)?,
            is_pinned: r.get::<_, i64>(6)? != 0,
            is_archived: r.get::<_, i64>(7)? != 0,
            is_deleted: r.get::<_, i64>(8)? != 0,
            created_at: r.get(9)?,
            updated_at: r.get(10)?,
        })
    })?;
    Ok(rows.flatten().collect())
}

fn read_media_rows(conn: &Connection) -> Result<Vec<MediaFile>, ImportError> {
    let mut stmt = conn.prepare(
        "SELECT id, item_id, file_hash, relative_path, mime_type, byte_size, width, height, created_at
         FROM media_files",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(MediaFile {
            id: r.get(0)?,
            item_id: r.get(1)?,
            file_hash: r.get(2)?,
            relative_path: r.get(3)?,
            mime_type: r.get(4)?,
            byte_size: r.get(5)?,
            width: r.get(6)?,
            height: r.get(7)?,
            created_at: r.get(8)?,
        })
    })?;
    Ok(rows.flatten().collect())
}

/// Backups this app can see without a file picker: the ones it wrote, in the
/// folder it writes them to.
pub fn list_backups(dirs: &[PathBuf]) -> Vec<BackupFile> {
    let mut found: Vec<BackupFile> = Vec::new();
    for dir in dirs {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if !name.starts_with("omnivault-backup-") || !name.ends_with(".zip") {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let modified_ms = meta
                .modified()
                .ok()
                .map(|t| chrono::DateTime::<Utc>::from(t).timestamp_millis())
                .unwrap_or(0);
            found.push(BackupFile {
                path: path.to_string_lossy().to_string(),
                name,
                bytes: meta.len(),
                modified_ms,
            });
        }
    }
    found.sort_by_key(|b| std::cmp::Reverse(b.modified_ms));
    found
}
