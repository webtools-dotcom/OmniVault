//! Exports the whole vault to a single zip archive containing the database
//! (for an exact restore), the media files, and every note as plain Markdown.
//!
//! The archive is written by hand with stored (uncompressed) entries. The bulk
//! of a vault is already-compressed WebP, and avoiding a zip crate keeps the
//! Android cross-compile simple. The tests read every archive back with an
//! independent implementation.

use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Datelike, Timelike, Utc};
use rusqlite::Connection;

use crate::db::models::{Folder, VaultItem};
use crate::db::storage::{list_folders, list_inbox_items, list_items_by_folder};

#[derive(Debug)]
pub enum ExportError {
    Db(rusqlite::Error),
    Io(std::io::Error),
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportError::Db(e) => write!(f, "Could not read the vault: {e}"),
            ExportError::Io(e) => write!(f, "Could not write the export: {e}"),
        }
    }
}

impl From<rusqlite::Error> for ExportError {
    fn from(e: rusqlite::Error) -> Self {
        ExportError::Db(e)
    }
}

impl From<std::io::Error> for ExportError {
    fn from(e: std::io::Error) -> Self {
        ExportError::Io(e)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExportSummary {
    pub path: String,
    pub notes: usize,
    pub media_files: usize,
    pub bytes: u64,
}

// ---------------------------------------------------------------------------
// The archive writer
// ---------------------------------------------------------------------------

struct ZipEntry {
    name: String,
    crc: u32,
    size: u32,
    offset: u32,
}

/// A stored-only zip writer. Every entry's length is known before it is written,
/// so there are no data descriptors and no streaming edge cases.
struct ZipWriter<W: Write> {
    out: W,
    entries: Vec<ZipEntry>,
    offset: u32,
    dos_time: u16,
    dos_date: u16,
}

impl<W: Write> ZipWriter<W> {
    fn new(out: W, now: DateTime<Utc>) -> Self {
        // MS-DOS packs the date into 16 bits counting from 1980, with two-second
        // resolution on the time. Anything before 1980 cannot be represented.
        let year = now.year().max(1980) as u16;
        let dos_date = ((year - 1980) << 9) | ((now.month() as u16) << 5) | now.day() as u16;
        let dos_time =
            ((now.hour() as u16) << 11) | ((now.minute() as u16) << 5) | (now.second() as u16 / 2);
        Self {
            out,
            entries: Vec::new(),
            offset: 0,
            dos_time,
            dos_date,
        }
    }

    fn add(&mut self, name: &str, data: &[u8]) -> std::io::Result<()> {
        let crc = crc32(data);
        let size = data.len() as u32;
        let name_bytes = name.as_bytes();
        let offset = self.offset;

        self.out.write_all(&0x0403_4b50u32.to_le_bytes())?; // local file header
        self.out.write_all(&20u16.to_le_bytes())?; // version needed
        self.out.write_all(&0x0800u16.to_le_bytes())?; // bit 11: the name is UTF-8
        self.out.write_all(&0u16.to_le_bytes())?; // method: stored
        self.out.write_all(&self.dos_time.to_le_bytes())?;
        self.out.write_all(&self.dos_date.to_le_bytes())?;
        self.out.write_all(&crc.to_le_bytes())?;
        self.out.write_all(&size.to_le_bytes())?; // compressed
        self.out.write_all(&size.to_le_bytes())?; // uncompressed
        self.out
            .write_all(&(name_bytes.len() as u16).to_le_bytes())?;
        self.out.write_all(&0u16.to_le_bytes())?; // extra field length
        self.out.write_all(name_bytes)?;
        self.out.write_all(data)?;

        self.offset += 30 + name_bytes.len() as u32 + size;
        self.entries.push(ZipEntry {
            name: name.to_string(),
            crc,
            size,
            offset,
        });
        Ok(())
    }

    fn finish(mut self) -> std::io::Result<W> {
        let dir_start = self.offset;
        for e in &self.entries {
            let name_bytes = e.name.as_bytes();
            self.out.write_all(&0x0201_4b50u32.to_le_bytes())?; // central directory header
            self.out.write_all(&20u16.to_le_bytes())?; // version made by
            self.out.write_all(&20u16.to_le_bytes())?; // version needed
            self.out.write_all(&0x0800u16.to_le_bytes())?;
            self.out.write_all(&0u16.to_le_bytes())?;
            self.out.write_all(&self.dos_time.to_le_bytes())?;
            self.out.write_all(&self.dos_date.to_le_bytes())?;
            self.out.write_all(&e.crc.to_le_bytes())?;
            self.out.write_all(&e.size.to_le_bytes())?;
            self.out.write_all(&e.size.to_le_bytes())?;
            self.out
                .write_all(&(name_bytes.len() as u16).to_le_bytes())?;
            self.out.write_all(&0u16.to_le_bytes())?; // extra
            self.out.write_all(&0u16.to_le_bytes())?; // comment
            self.out.write_all(&0u16.to_le_bytes())?; // disk number
            self.out.write_all(&0u16.to_le_bytes())?; // internal attrs
            self.out.write_all(&0u32.to_le_bytes())?; // external attrs
            self.out.write_all(&e.offset.to_le_bytes())?;
            self.out.write_all(name_bytes)?;
        }
        let dir_size = self
            .entries
            .iter()
            .fold(0u32, |acc, e| acc + 46 + e.name.len() as u32);

        self.out.write_all(&0x0605_4b50u32.to_le_bytes())?; // end of central directory
        self.out.write_all(&0u16.to_le_bytes())?; // this disk
        self.out.write_all(&0u16.to_le_bytes())?; // disk with the directory
        self.out
            .write_all(&(self.entries.len() as u16).to_le_bytes())?;
        self.out
            .write_all(&(self.entries.len() as u16).to_le_bytes())?;
        self.out.write_all(&dir_size.to_le_bytes())?;
        self.out.write_all(&dir_start.to_le_bytes())?;
        self.out.write_all(&0u16.to_le_bytes())?; // comment length
        self.out.flush()?;
        Ok(self.out)
    }
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

// ---------------------------------------------------------------------------
// Turning a vault into files
// ---------------------------------------------------------------------------

/// Filenames have to survive Windows, Android and a zip listing, so anything
/// that is not plainly safe becomes a hyphen.
fn safe_name(raw: &str, fallback: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        if ch.is_alphanumeric() || ch == ' ' || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    let trimmed = out
        .trim_matches(|c: char| c == '-' || c == ' ' || c == '.')
        .to_string();
    let capped: String = trimmed.chars().take(60).collect();
    let capped = capped.trim_end().to_string();
    if capped.is_empty() {
        fallback.to_string()
    } else {
        capped
    }
}

fn iso(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .map(|t| t.to_rfc3339())
        .unwrap_or_else(|| ms.to_string())
}

/// One note as Markdown, with enough front matter that nothing is lost, and an
/// image link that resolves inside the archive itself.
fn note_markdown(item: &VaultItem, folder: Option<&Folder>, depth: usize) -> String {
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!("title: {}\n", item.title.replace('\n', " ")));
    out.push_str(&format!(
        "folder: {}\n",
        folder.map(|f| f.name.as_str()).unwrap_or("Quick Inbox")
    ));
    out.push_str(&format!("type: {}\n", item.item_type));
    out.push_str(&format!("created: {}\n", iso(item.created_at)));
    out.push_str(&format!("updated: {}\n", iso(item.updated_at)));
    if item.is_pinned {
        out.push_str("pinned: true\n");
    }
    if let Some(meta) = &item.metadata {
        if !meta.trim().is_empty() {
            out.push_str(&format!("metadata: {}\n", meta.replace('\n', " ")));
        }
    }
    out.push_str("---\n\n");
    out.push_str(&format!("# {}\n\n", item.title));

    if item.item_type == "image" {
        if let Some(hash) = item.content.rsplit('/').next() {
            let hash = hash.split('?').next().unwrap_or(hash);
            // Climb back out of notes/<folder>/ to reach media/ in the archive.
            let up = "../".repeat(depth);
            out.push_str(&format!("![{}]({}media/{})\n", item.title, up, hash));
        }
    } else if item.item_type == "file" {
        if let Some(name) = item.content.rsplit('/').next() {
            let name = name.split('?').next().unwrap_or(name);
            let up = "../".repeat(depth);
            out.push_str(&format!("[{}]({}media/{})\n", item.title, up, name));
        }
    } else {
        out.push_str(&item.content);
        out.push('\n');
    }
    out
}

const README: &str = "\
This is a complete copy of an OmniVault vault.

  notes/          Every note as plain Markdown, in the folders you filed them
                  under. These need no app at all — open them in any text
                  editor, now or in twenty years.

  media/          The images your notes point at, named by content hash. The
                  Markdown files link to them by relative path, so a Markdown
                  viewer will show them in place.

  omnivault.db    The vault itself, an ordinary SQLite database. This is what
                  OmniVault reads back on a restore, and it holds the sync
                  history the Markdown does not.

Nothing here is encrypted. Anyone holding this file can read everything in it,
so keep it where you would keep the notes themselves.
";

/// Writes the whole vault to `dest` as a single archive.
///
/// The WAL checkpoint comes first: in WAL mode committed writes can live only
/// in `omnivault.db-wal`, and a `.db` copied without it silently misses them.
pub fn export_vault(
    conn: &mut Connection,
    base_dir: &Path,
    dest: &Path,
) -> Result<ExportSummary, ExportError> {
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;

    let file = File::create(dest)?;
    let mut zip = ZipWriter::new(BufWriter::new(file), Utc::now());

    zip.add("README.txt", README.as_bytes())?;

    let folders = list_folders(conn, false)?;

    // Quick Inbox first, then one directory per folder.
    let mut notes = 0usize;
    let mut used: Vec<String> = Vec::new();
    let mut write_note = |zip: &mut ZipWriter<BufWriter<File>>,
                          item: &VaultItem,
                          folder: Option<&Folder>|
     -> Result<(), ExportError> {
        let dir = match folder {
            Some(f) => format!("notes/{}", safe_name(&f.name, "folder")),
            None => "notes/Quick Inbox".to_string(),
        };
        let depth = dir.matches('/').count() + 1;
        let stem = safe_name(&item.title, "untitled");
        let mut name = format!("{dir}/{stem}.md");
        let mut n = 2;
        while used.contains(&name) {
            name = format!("{dir}/{stem} ({n}).md");
            n += 1;
        }
        used.push(name.clone());
        zip.add(&name, note_markdown(item, folder, depth).as_bytes())?;
        Ok(())
    };

    for item in list_inbox_items(conn)? {
        write_note(&mut zip, &item, None)?;
        notes += 1;
    }
    for folder in &folders {
        for item in list_items_by_folder(conn, &folder.id)? {
            write_note(&mut zip, &item, Some(folder))?;
            notes += 1;
        }
    }

    // Every blob on disk, not only the ones a live note points at: this is a
    // backup, and an image whose note was deleted a minute ago is still the
    // sort of thing a person wants back.
    let mut media_files = 0usize;
    let media_dir = base_dir.join("media");
    if media_dir.is_dir() {
        let mut names: Vec<PathBuf> = fs::read_dir(&media_dir)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_file())
            .collect();
        names.sort();
        for path in names {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let mut bytes = Vec::new();
                File::open(&path)?.read_to_end(&mut bytes)?;
                zip.add(&format!("media/{name}"), &bytes)?;
                media_files += 1;
            }
        }
    }

    let db_path = base_dir.join("omnivault.db");
    if db_path.is_file() {
        let mut bytes = Vec::new();
        File::open(&db_path)?.read_to_end(&mut bytes)?;
        zip.add("omnivault.db", &bytes)?;
    }

    zip.finish()?
        .into_inner()
        .map_err(|e| ExportError::Io(e.into()))?;

    let bytes = fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    Ok(ExportSummary {
        path: dest.to_string_lossy().to_string(),
        notes,
        media_files,
        bytes,
    })
}

/// `omnivault-backup-2026-09-18-1432.zip`, stamped in the clock the user is
/// reading. A UTC name on a device showing 10:17 local came out as 0447, which
/// makes the newest backup hard to pick out of a list.
pub fn export_filename(now: DateTime<Utc>) -> String {
    let local = now.with_timezone(&chrono::Local);
    format!("omnivault-backup-{}.zip", local.format("%Y-%m-%d-%H%M"))
}
