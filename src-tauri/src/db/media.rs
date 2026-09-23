use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::Path;

use image::ImageFormat;
use rusqlite::{params, Connection, Result};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::models::MediaFile;

#[derive(Debug)]
pub enum MediaError {
    Db(rusqlite::Error),
    Io(std::io::Error),
    Image(image::ImageError),
    Invalid(String),
}

impl std::fmt::Display for MediaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MediaError::Db(e) => write!(f, "Database error: {}", e),
            MediaError::Io(e) => write!(f, "IO error: {}", e),
            MediaError::Image(e) => write!(f, "Image error: {}", e),
            MediaError::Invalid(s) => write!(f, "Invalid media: {}", s),
        }
    }
}

impl std::error::Error for MediaError {}

impl From<rusqlite::Error> for MediaError {
    fn from(e: rusqlite::Error) -> Self {
        MediaError::Db(e)
    }
}

impl From<std::io::Error> for MediaError {
    fn from(e: std::io::Error) -> Self {
        MediaError::Io(e)
    }
}

impl From<image::ImageError> for MediaError {
    fn from(e: image::ImageError) -> Self {
        MediaError::Image(e)
    }
}

pub fn compute_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub fn save_image_media<P: AsRef<Path>>(
    conn: &mut Connection,
    storage_dir: P,
    item_id: &str,
    raw_bytes: &[u8],
    device_id: &str,
) -> Result<MediaFile, MediaError> {
    // Attempt to parse and compress as WebP
    let (final_bytes, mime_type, width, height) = match image::load_from_memory(raw_bytes) {
        Ok(img) => {
            let rgba = img.to_rgba8();
            let w = rgba.width();
            let h = rgba.height();
            let mut webp_buf = Vec::new();
            let dynamic = image::DynamicImage::ImageRgba8(rgba);
            match dynamic.write_to(&mut Cursor::new(&mut webp_buf), ImageFormat::WebP) {
                Ok(_) => (webp_buf, "image/webp".to_string(), Some(w), Some(h)),
                Err(_) => {
                    // Fallback to PNG encode
                    let mut png_buf = Vec::new();
                    if dynamic.write_to(&mut Cursor::new(&mut png_buf), ImageFormat::Png).is_ok() {
                        (png_buf, "image/png".to_string(), Some(w), Some(h))
                    } else {
                        (raw_bytes.to_vec(), "application/octet-stream".to_string(), Some(w), Some(h))
                    }
                }
            }
        }
        Err(_) => {
            // Raw binary or unsupported image format preserved as is
            (raw_bytes.to_vec(), "application/octet-stream".to_string(), None, None)
        }
    };

    store_media(conn, storage_dir, item_id, &final_bytes, "webp", &mime_type, width, height, device_id)
}

/// A document kept exactly as it arrived: no transcoding, named
/// `<hash>.<ext>` so the extension survives sync, backup and download.
pub fn save_file_media<P: AsRef<Path>>(
    conn: &mut Connection,
    storage_dir: P,
    item_id: &str,
    raw_bytes: &[u8],
    file_name: &str,
    device_id: &str,
) -> Result<MediaFile, MediaError> {
    let ext = file_extension(file_name);
    let mime = crate::http_server::mime_for_extension(&ext);
    store_media(conn, storage_dir, item_id, raw_bytes, &ext, mime, None, None, device_id)
}

/// The lowercase extension of a file name, or `bin` when it has none that is
/// safe to put in a path and a URL.
pub fn file_extension(file_name: &str) -> String {
    match file_name.rsplit_once('.') {
        Some((_, ext))
            if !ext.is_empty() && ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            ext.to_ascii_lowercase()
        }
        _ => "bin".to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn store_media<P: AsRef<Path>>(
    conn: &mut Connection,
    storage_dir: P,
    item_id: &str,
    final_bytes: &[u8],
    ext: &str,
    mime_type: &str,
    width: Option<u32>,
    height: Option<u32>,
    device_id: &str,
) -> Result<MediaFile, MediaError> {
    let now = crate::db::storage::next_write_timestamp(conn);
    let media_dir = storage_dir.as_ref().join("media");
    fs::create_dir_all(&media_dir)?;
    let mime_type = mime_type.to_string();

    let file_hash = compute_sha256(final_bytes);
    let filename = format!("{}.{}", file_hash, ext);
    let full_path = media_dir.join(&filename);
    let relative_path = format!("media/{}", filename);

    // Save to disk if not already present (content-addressed deduplication)
    if !full_path.exists() {
        let mut file = File::create(&full_path)?;
        file.write_all(final_bytes)?;
        file.flush()?;
    }

    let byte_size = final_bytes.len() as i64;
    let media_id = Uuid::new_v4().to_string();

    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO media_files (id, item_id, file_hash, relative_path, mime_type, byte_size, width, height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![media_id, item_id, file_hash, relative_path, mime_type, byte_size, width, height, now],
    )?;

    let media_file = MediaFile {
        id: media_id.clone(),
        item_id: item_id.to_string(),
        file_hash,
        relative_path,
        mime_type,
        byte_size,
        width,
        height,
        created_at: now,
    };

    let payload = serde_json::to_string(&media_file).unwrap_or_default();
    tx.execute(
        "INSERT INTO revisions (entity_type, entity_id, device_id, change_type, payload, timestamp)
         VALUES ('media_file', ?1, ?2, 'created', ?3, ?4)",
        params![media_id, device_id, payload, now],
    )?;

    tx.commit()?;
    Ok(media_file)
}

pub fn get_media_by_item_id(conn: &Connection, item_id: &str) -> Result<Vec<MediaFile>> {
    let mut stmt = conn.prepare(
        "SELECT id, item_id, file_hash, relative_path, mime_type, byte_size, width, height, created_at
         FROM media_files WHERE item_id = ?1 ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map([item_id], |row| {
        Ok(MediaFile {
            id: row.get(0)?,
            item_id: row.get(1)?,
            file_hash: row.get(2)?,
            relative_path: row.get(3)?,
            mime_type: row.get(4)?,
            byte_size: row.get(5)?,
            width: row.get(6)?,
            height: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;

    let mut list = Vec::new();
    for item in rows {
        list.push(item?);
    }
    Ok(list)
}

pub fn read_media_bytes<P: AsRef<Path>>(storage_dir: P, relative_path: &str) -> std::io::Result<Vec<u8>> {
    let full_path = storage_dir.as_ref().join(relative_path);
    let mut file = File::open(full_path)?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

/// Deletes media blobs nothing points at any more.
///
/// Deleting an item only flips `is_deleted`; the `media/<hash>.webp` it pointed
/// at stayed on disk forever, so a vault used as an image scratchpad grows
/// without bound even when the user empties it. A blob is live while any
/// undeleted item references it - through `content` or through `media_files` -
/// and blobs younger than the grace window are spared so an upload that has not
/// yet had its item row written is never swept out from under itself.
pub fn purge_orphan_media<P: AsRef<Path>>(
    conn: &Connection,
    storage_dir: P,
    grace: std::time::Duration,
) -> Result<usize, MediaError> {
    let media_dir = storage_dir.as_ref().join("media");
    if !media_dir.is_dir() {
        return Ok(0);
    }

    let mut live: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut stmt = conn.prepare(
        "SELECT content FROM vault_items WHERE is_deleted = 0 AND content LIKE '%/api/media/%'",
    )?;
    for row in stmt.query_map([], |r| r.get::<_, String>(0))? {
        let content = row?;
        let mut rest = content.as_str();
        while let Some(at) = rest.find("/api/media/") {
            rest = &rest[at + "/api/media/".len()..];
            let end = rest
                .find(|c: char| !c.is_ascii_alphanumeric())
                .unwrap_or(rest.len());
            if end > 0 {
                live.insert(rest[..end].to_string());
            }
            rest = &rest[end..];
        }
    }

    let mut stmt = conn.prepare(
        "SELECT m.file_hash FROM media_files m
         JOIN vault_items i ON i.id = m.item_id
         WHERE i.is_deleted = 0",
    )?;
    for row in stmt.query_map([], |r| r.get::<_, String>(0))? {
        live.insert(row?);
    }

    let mut removed = 0usize;
    for entry in fs::read_dir(&media_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let hash = match path.file_stem().and_then(|s| s.to_str()) {
            Some(h) => h.to_string(),
            None => continue,
        };
        if live.contains(&hash) {
            continue;
        }
        let young = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| t.elapsed().map(|age| age < grace).unwrap_or(true))
            .unwrap_or(true);
        if young {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }

    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::initialize_schema;
    use crate::db::storage::create_item;
    use image::{Rgba, RgbaImage};

    fn create_test_png_bytes(width: u32, height: u32) -> Vec<u8> {
        let mut img = RgbaImage::new(width, height);
        for x in 0..width {
            for y in 0..height {
                img.put_pixel(x, y, Rgba([47, 129, 247, 255])); // #2F81F7
            }
        }
        let mut bytes = Vec::new();
        img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).unwrap();
        bytes
    }

    #[test]
    fn documents_are_stored_verbatim_under_their_own_extension() {
        let mut conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        let item = create_item(&mut conn, None, "file", "Budget", "", None, "dev").unwrap();
        let temp_dir = std::env::temp_dir().join(format!("omnivault_test_{}", Uuid::new_v4()));

        let bytes = b"PK\x03\x04 not really a spreadsheet".to_vec();
        let media = save_file_media(&mut conn, &temp_dir, &item.id, &bytes, "Q3 Budget.XLSX", "dev").unwrap();

        assert_eq!(media.relative_path, format!("media/{}.xlsx", media.file_hash));
        assert_eq!(read_media_bytes(&temp_dir, &media.relative_path).unwrap(), bytes);
        assert_eq!(compute_sha256(&bytes), media.file_hash);

        // Nothing unsafe for a path or URL survives as an extension.
        assert_eq!(file_extension("report.pdf"), "pdf");
        assert_eq!(file_extension("no-extension"), "bin");
        assert_eq!(file_extension("evil./..\\x"), "bin");
        assert_eq!(file_extension("trailing."), "bin");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_media_save_and_webp_compression() {
        let mut conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        let dev_id = "test-device-1";

        // Create an item to attach media to
        let item = create_item(&mut conn, None, "image", "Stock Chart", "", None, dev_id).unwrap();

        // Create a temporary storage directory
        let temp_dir = std::env::temp_dir().join(format!("omnivault_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();

        let png_bytes = create_test_png_bytes(100, 100);
        let media = save_image_media(&mut conn, &temp_dir, &item.id, &png_bytes, dev_id).unwrap();

        assert_eq!(media.item_id, item.id);
        assert_eq!(media.mime_type, "image/webp");
        assert_eq!(media.width, Some(100));
        assert_eq!(media.height, Some(100));
        assert!(media.file_hash.len() == 64);

        // Verify disk file exists and is readable
        let disk_bytes = read_media_bytes(&temp_dir, &media.relative_path).unwrap();
        assert!(!disk_bytes.is_empty());
        assert_eq!(compute_sha256(&disk_bytes), media.file_hash);

        // Verify media_files query
        let item_media = get_media_by_item_id(&conn, &item.id).unwrap();
        assert_eq!(item_media.len(), 1);
        assert_eq!(item_media[0].id, media.id);

        // Verify revision log entry
        let rev_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM revisions WHERE entity_type = 'media_file'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(rev_count, 1);

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }
}

/// One-shot repair that moves inline `data:image/...;base64,...` payloads out of
/// `vault_items.content` and onto disk as content-addressed WebP.
///
/// Architecture Rule 3 and D-003 put media on disk precisely so the database
/// stays small and sync stays cheap, but the D-035 migration to disk-backed
/// WebP only changed the write path — rows created before it kept their inline
/// payloads. Those rows bloat every delta that touches them and had grown the
/// active database past its 15 MB budget. See D-058.
///
/// Returns the number of items migrated. Safe to call on every startup: it
/// selects only rows that still carry a data URL, so a clean vault does nothing.
pub fn migrate_inline_media_to_disk<P: AsRef<Path>>(
    conn: &mut Connection,
    storage_dir: P,
    device_id: &str,
) -> Result<usize, MediaError> {
    let pending: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, title, content FROM vault_items
             WHERE is_deleted = 0 AND content LIKE 'data:image/%'",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.flatten().collect()
    };

    let mut migrated = 0usize;
    for (item_id, title, content) in pending {
        let bytes = match crate::http_server::decode_base64(&content) {
            Ok(b) if !b.is_empty() => b,
            // A payload we cannot decode is left exactly as it is: dropping it
            // would destroy the only copy of the user's image.
            _ => {
                eprintln!("[media] item {item_id} has an undecodable inline payload; left untouched");
                continue;
            }
        };

        let media = match save_image_media(conn, storage_dir.as_ref(), &item_id, &bytes, device_id) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[media] item {item_id} could not be written to disk ({e:?}); left untouched");
                continue;
            }
        };

        // Only rewrite the row once the bytes are safely on disk, so an
        // interrupted run can never leave an item pointing at a missing file.
        let new_content = format!("/api/media/{}.webp", media.file_hash);
        if let Err(e) = crate::db::storage::update_item(
            conn,
            &item_id,
            &title,
            &new_content,
            None,
            device_id,
        ) {
            eprintln!("[media] item {item_id} saved to disk but the row was not updated ({e:?})");
            continue;
        }
        migrated += 1;
    }

    Ok(migrated)
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    use crate::db::schema::initialize_schema;
    use crate::db::storage::{create_item, get_item_by_id};
    use image::{Rgba, RgbaImage};

    fn png_bytes() -> Vec<u8> {
        let mut img = RgbaImage::new(8, 8);
        for p in img.pixels_mut() {
            *p = Rgba([10, 120, 220, 255]);
        }
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
            .unwrap();
        buf
    }

    fn b64(bytes: &[u8]) -> String {
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for c in bytes.chunks(3) {
            let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
            let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
            out.push(T[(n >> 18) as usize & 63] as char);
            out.push(T[(n >> 12) as usize & 63] as char);
            out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
            out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
        }
        out
    }

    #[test]
    fn inline_payloads_move_to_disk_and_plain_notes_are_left_alone() {
        let dir = std::env::temp_dir().join(format!("ov_mig_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        let dev = "test-device";

        let data_url = format!("data:image/png;base64,{}", b64(&png_bytes()));
        let image_item = create_item(&mut conn, None, "image", "inline shot", &data_url, None, dev).unwrap();
        let note_item = create_item(&mut conn, None, "note", "just text", "not a data url", None, dev).unwrap();

        let moved = migrate_inline_media_to_disk(&mut conn, &dir, dev).unwrap();
        assert_eq!(moved, 1, "exactly the one inline payload should migrate");

        let migrated = get_item_by_id(&conn, &image_item.id).unwrap().unwrap();
        assert!(
            migrated.content.starts_with("/api/media/") && migrated.content.ends_with(".webp"),
            "content should now reference a file on disk, got: {}",
            migrated.content
        );
        let hash = migrated.content.trim_start_matches("/api/media/").trim_end_matches(".webp");
        assert!(
            dir.join("media").join(format!("{hash}.webp")).exists(),
            "the referenced blob must actually exist on disk before the row is rewritten"
        );

        let untouched = get_item_by_id(&conn, &note_item.id).unwrap().unwrap();
        assert_eq!(untouched.content, "not a data url", "non-image rows must not be touched");

        // Idempotent: a second pass has nothing left to do.
        assert_eq!(migrate_inline_media_to_disk(&mut conn, &dir, dev).unwrap(), 0);

        let _ = fs::remove_dir_all(&dir);
    }
}

/// Replaces inline `data:image/...` payloads inside historical revision rows
/// with a reference to the same bytes on disk.
///
/// The revision log is append-only and is the substrate mesh sync replays
/// (D-012, D-017), so rows are never deleted here — only the oversized
/// `content` field inside a payload is swapped for `/api/media/<hash>.webp`
/// pointing at bytes that are written to disk first. A peer replaying such a
/// revision now receives a reference and pulls the blob through the
/// self-healing media path (D-055/P9-T02) instead of carrying megabytes of
/// base64 through every delta. Causality, ordering and timestamps are
/// untouched, so Last-Write-Wins convergence is unaffected. See D-058.
pub fn compact_inline_media_in_revisions<P: AsRef<Path>>(
    conn: &mut Connection,
    storage_dir: P,
) -> Result<usize, MediaError> {
    let pending: Vec<(i64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, payload FROM revisions WHERE payload LIKE '%data:image/%'",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.flatten().collect()
    };

    let media_dir = storage_dir.as_ref().join("media");
    fs::create_dir_all(&media_dir)?;

    let mut compacted = 0usize;
    for (rev_id, payload) in pending {
        let mut json: serde_json::Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let Some(content) = json.get("content").and_then(|c| c.as_str()) else {
            continue;
        };
        if !content.starts_with("data:image/") {
            continue;
        }

        let Ok(bytes) = crate::http_server::decode_base64(content) else {
            continue;
        };
        if bytes.is_empty() {
            continue;
        }

        // Encode to WebP before hashing, so `<hash>.webp` keeps its meaning:
        // the SHA-256 of the file's own bytes (D-013/D-018). Writing raw PNG
        // into a .webp name would still verify, but it would quietly break the
        // convention every other reader relies on. Re-encoding the same source
        // through the same pipeline yields the same hash the live row already
        // points at, so this de-duplicates rather than adding a second copy.
        let Ok(decoded) = image::load_from_memory(&bytes) else {
            continue;
        };
        let mut webp_bytes = Vec::new();
        if image::DynamicImage::ImageRgba8(decoded.to_rgba8())
            .write_to(&mut Cursor::new(&mut webp_bytes), ImageFormat::WebP)
            .is_err()
        {
            continue;
        }

        // Write the bytes out before rewriting the row, so the reference can
        // never point at something that is not there.
        let hash = compute_sha256(&webp_bytes);
        let blob_path = media_dir.join(format!("{hash}.webp"));
        if !blob_path.exists() {
            let mut f = File::create(&blob_path)?;
            f.write_all(&webp_bytes)?;
        }

        json["content"] = serde_json::Value::String(format!("/api/media/{hash}.webp"));
        let rewritten = json.to_string();
        conn.execute(
            "UPDATE revisions SET payload = ?1 WHERE id = ?2",
            params![rewritten, rev_id],
        )?;
        compacted += 1;
    }

    Ok(compacted)
}

/// Collapses runs of consecutive `vault_item/updated` revisions that describe
/// the same state, keeping the newest of each run.
///
/// The autosave loop fixed in D-055 re-saved an open note roughly every 600 ms,
/// producing thousands of snapshots that differ only in `updated_at`. They carry
/// no information — the note did not change — but they are replayed to every
/// peer and had grown the revision log to 13 MB across 5,276 rows.
///
/// This is deliberately narrow. Only consecutive duplicates within one entity
/// are removed, and the newest of each run survives, so every state the item
/// ever actually held is still represented and in order. Last-Write-Wins
/// convergence depends on the newest revision per entity (D-017), which is
/// always kept. Nothing is removed for folders, media, creations or deletions.
/// See D-058.
pub fn compact_redundant_item_revisions(conn: &mut Connection) -> Result<usize, MediaError> {
    /// The fields that describe an item's actual state, ignoring `updated_at`.
    fn state_signature(payload: &str) -> Option<String> {
        let v: serde_json::Value = serde_json::from_str(payload).ok()?;
        let field = |k: &str| v.get(k).map(|x| x.to_string()).unwrap_or_default();
        Some([
            field("title"),
            field("content"),
            field("folder_id"),
            field("item_type"),
            field("metadata"),
            field("is_pinned"),
            field("is_archived"),
        ]
        .join("\u{1f}"))
    }

    let rows: Vec<(i64, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, entity_id, payload FROM revisions
             WHERE entity_type = 'vault_item' AND change_type = 'updated' AND payload IS NOT NULL
             ORDER BY entity_id ASC, timestamp ASC, id ASC",
        )?;
        let mapped = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        mapped.flatten().collect()
    };

    // Walk each entity's history and mark all but the last of each identical run.
    let mut doomed: Vec<i64> = Vec::new();
    let mut run: Vec<i64> = Vec::new();
    let mut run_key: Option<(String, String)> = None;
    let flush = |run: &mut Vec<i64>, doomed: &mut Vec<i64>| {
        if run.len() > 1 {
            doomed.extend(run.drain(..run.len() - 1));
        }
        run.clear();
    };

    for (id, entity_id, payload) in rows {
        let Some(sig) = state_signature(&payload) else { continue };
        let key = (entity_id, sig);
        if run_key.as_ref() != Some(&key) {
            flush(&mut run, &mut doomed);
            run_key = Some(key);
        }
        run.push(id);
    }
    flush(&mut run, &mut doomed);

    if doomed.is_empty() {
        return Ok(0);
    }

    let tx = conn.transaction()?;
    for chunk in doomed.chunks(400) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        tx.execute(
            &format!("DELETE FROM revisions WHERE id IN ({placeholders})"),
            rusqlite::params_from_iter(chunk.iter()),
        )?;
    }
    tx.commit()?;

    Ok(doomed.len())
}

#[cfg(test)]
mod revision_compaction_tests {
    use super::*;
    use crate::db::schema::initialize_schema;

    fn insert_rev(conn: &Connection, entity: &str, change: &str, content: &str, updated_at: i64, ts: i64) {
        let payload = format!(
            r#"{{"id":"{entity}","title":"n","content":"{content}","folder_id":null,"item_type":"note","metadata":null,"is_pinned":false,"is_archived":false,"updated_at":{updated_at}}}"#
        );
        conn.execute(
            "INSERT INTO revisions (entity_type, entity_id, device_id, change_type, payload, timestamp)
             VALUES ('vault_item', ?1, 'dev', ?2, ?3, ?4)",
            params![entity, change, payload, ts],
        )
        .unwrap();
    }

    fn remaining(conn: &Connection, change: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT payload FROM revisions WHERE change_type = ?1 ORDER BY timestamp ASC")
            .unwrap();
        let rows = stmt.query_map([change], |r| r.get::<_, String>(0)).unwrap();
        rows.flatten().collect()
    }

    #[test]
    fn collapses_autosave_duplicates_but_keeps_every_real_state() {
        let mut conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();

        // One creation, then the autosave loop's signature: the same state
        // written over and over with only updated_at moving, a genuine edit,
        // then more duplicates of the new state.
        insert_rev(&conn, "item-a", "created", "hello", 100, 100);
        for (i, ts) in [101, 102, 103, 104].iter().enumerate() {
            insert_rev(&conn, "item-a", "updated", "hello", 100 + i as i64 + 1, *ts);
        }
        insert_rev(&conn, "item-a", "updated", "hello world", 200, 200);
        insert_rev(&conn, "item-a", "updated", "hello world", 201, 201);
        // A second item must not be confused with the first.
        insert_rev(&conn, "item-b", "updated", "other", 300, 300);
        insert_rev(&conn, "item-a", "deleted", "hello world", 400, 400);

        let removed = compact_redundant_item_revisions(&mut conn).unwrap();
        assert_eq!(removed, 4, "three redundant 'hello' plus one redundant 'hello world'");

        let updates = remaining(&conn, "updated");
        assert_eq!(updates.len(), 3, "one per distinct state per item");
        assert!(updates[0].contains(r#""content":"hello""#) && updates[0].contains(r#""updated_at":104"#),
            "the newest of a duplicate run must survive, not the oldest: {}", updates[0]);
        assert!(updates[1].contains(r#""content":"hello world""#) && updates[1].contains(r#""updated_at":201"#));
        assert!(updates[2].contains(r#""content":"other""#), "the other item is untouched");

        assert_eq!(remaining(&conn, "created").len(), 1, "creations are never removed");
        assert_eq!(remaining(&conn, "deleted").len(), 1, "deletions are never removed");

        // Idempotent.
        assert_eq!(compact_redundant_item_revisions(&mut conn).unwrap(), 0);
    }
}


#[cfg(test)]
mod orphan_sweep_tests {
    use super::*;
    use crate::db::schema::initialize_schema;
    use crate::db::storage::{create_item, delete_item};

    fn png(size: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::new(size, size));
        img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png).unwrap();
        buf
    }

    #[test]
    fn deleting_an_item_frees_its_blob_but_spares_a_shared_one() {
        let dir = std::env::temp_dir().join(format!("ov-sweep-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();

        let doomed = create_item(&mut conn, None, "image", "Doomed", "", None, "dev").unwrap();
        let kept = create_item(&mut conn, None, "image", "Kept", "", None, "dev").unwrap();
        let m1 = save_image_media(&mut conn, &dir, &doomed.id, &png(1), "dev").unwrap();
        let m2 = save_image_media(&mut conn, &dir, &kept.id, &png(4), "dev").unwrap();
        assert_ne!(m1.file_hash, m2.file_hash);

        delete_item(&mut conn, &doomed.id, "dev").unwrap();

        // Nothing is swept while the blobs are still inside the grace window.
        let day = std::time::Duration::from_secs(24 * 60 * 60);
        assert_eq!(purge_orphan_media(&conn, &dir, day).unwrap(), 0);

        // With no grace, exactly the deleted item's blob goes.
        let swept = purge_orphan_media(&conn, &dir, std::time::Duration::ZERO).unwrap();
        assert_eq!(swept, 1, "expected only the orphan to be swept");
        assert!(!dir.join(&m1.relative_path).exists(), "orphan blob survived");
        assert!(dir.join(&m2.relative_path).exists(), "live blob was deleted");

        fs::remove_dir_all(&dir).ok();
    }
}
