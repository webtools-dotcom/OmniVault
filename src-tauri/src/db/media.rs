use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::Path;
use chrono::Utc;
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
    let now = Utc::now().timestamp_millis();
    let media_dir = storage_dir.as_ref().join("media");
    fs::create_dir_all(&media_dir)?;

    // Attempt to parse and compress as WebP
    let (final_bytes, mime_type, width, height) = match image::load_from_memory(raw_bytes) {
        Ok(img) => {
            let w = img.width();
            let h = img.height();
            let mut webp_buf = Vec::new();
            match img.write_to(&mut Cursor::new(&mut webp_buf), ImageFormat::WebP) {
                Ok(_) => (webp_buf, "image/webp".to_string(), Some(w), Some(h)),
                Err(_) => {
                    // Fallback to original bytes if WebP encode fails
                    (raw_bytes.to_vec(), "application/octet-stream".to_string(), Some(w), Some(h))
                }
            }
        }
        Err(_) => {
            // Raw binary or unsupported image format preserved as is
            (raw_bytes.to_vec(), "application/octet-stream".to_string(), None, None)
        }
    };

    let file_hash = compute_sha256(&final_bytes);
    let filename = format!("{}.webp", file_hash);
    let full_path = media_dir.join(&filename);
    let relative_path = format!("media/{}", filename);

    // Save to disk if not already present (content-addressed deduplication)
    if !full_path.exists() {
        let mut file = File::create(&full_path)?;
        file.write_all(&final_bytes)?;
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
