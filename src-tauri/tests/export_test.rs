//! Export tests. The zip writer is hand-rolled, so archives are read back with
//! Python's `zipfile`, an independent implementation that verifies every CRC.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use omnivault_lib::db::export::{export_filename, export_vault};
use omnivault_lib::db::media::save_image_media;
use omnivault_lib::db::schema::initialize_schema;
use omnivault_lib::db::storage::{create_folder, create_item, delete_item};
use rusqlite::Connection;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ov-export-{tag}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Reads the archive with Python, returning "name\tbytes" per entry. Python
/// raises on a bad CRC, so a clean listing is itself a checksum verification.
fn read_with_python(zip_path: &Path) -> Option<Vec<(String, usize)>> {
    let script = format!(
        "import zipfile,sys\n\
         z=zipfile.ZipFile(r'{}')\n\
         bad=z.testzip()\n\
         assert bad is None, bad\n\
         [sys.stdout.write(n+chr(9)+str(len(z.read(n)))+chr(10)) for n in z.namelist()]\n",
        zip_path.to_string_lossy()
    );
    let out = Command::new("python")
        .arg("-c")
        .arg(&script)
        .output()
        .ok()?;
    if !out.status.success() {
        panic!(
            "python could not read the archive: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Some(
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|l| {
                let (n, s) = l.split_once('\t')?;
                Some((n.to_string(), s.trim().parse().ok()?))
            })
            .collect(),
    )
}

fn png(size: u32) -> Vec<u8> {
    use std::io::Cursor;
    let mut buf = Vec::new();
    image::DynamicImage::ImageRgba8(image::RgbaImage::new(size, size))
        .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

#[test]
fn the_export_is_an_archive_any_other_tool_can_open() {
    let dir = temp_dir("open");
    let db_path = dir.join("omnivault.db");
    let mut conn = Connection::open(&db_path).unwrap();
    initialize_schema(&conn).unwrap();

    let folder = create_folder(&mut conn, "Market Setups", None, None, "dev").unwrap();
    create_item(
        &mut conn,
        Some(&folder.id),
        "note",
        "NVDA position review",
        "Bought at 357 on 11 August.",
        None,
        "dev",
    )
    .unwrap();
    create_item(
        &mut conn,
        None,
        "note",
        "Unfiled thought",
        "Stays in the inbox.",
        None,
        "dev",
    )
    .unwrap();

    let dest = dir.join(export_filename(chrono::Utc::now()));
    let summary = export_vault(&mut conn, &dir, &dest).unwrap();

    assert_eq!(summary.notes, 2);
    assert!(dest.is_file(), "no archive was written");

    let entries = read_with_python(&dest).expect("python is needed to verify the archive");
    let names: Vec<&str> = entries.iter().map(|(n, _)| n.as_str()).collect();

    assert!(
        names.contains(&"README.txt"),
        "missing the explanation: {names:?}"
    );
    assert!(
        names.contains(&"omnivault.db"),
        "missing the database: {names:?}"
    );
    assert!(
        names.iter().any(|n| n.starts_with("notes/Market Setups/")),
        "the folder tree did not survive: {names:?}"
    );
    assert!(
        names.iter().any(|n| n.starts_with("notes/Quick Inbox/")),
        "unfiled notes were dropped: {names:?}"
    );

    // Every entry must carry its bytes, not just its name.
    for (name, len) in &entries {
        if name.ends_with(".md") || name == "omnivault.db" || name == "README.txt" {
            assert!(*len > 0, "{name} came out empty");
        }
    }
}

#[test]
fn a_note_is_readable_without_the_app() {
    let dir = temp_dir("markdown");
    let db_path = dir.join("omnivault.db");
    let mut conn = Connection::open(&db_path).unwrap();
    initialize_schema(&conn).unwrap();

    create_item(
        &mut conn,
        None,
        "note",
        "Sync test / with a slash",
        "The body survives.",
        None,
        "dev",
    )
    .unwrap();

    let dest = dir.join("out.zip");
    export_vault(&mut conn, &dir, &dest).unwrap();

    let script = format!(
        "import zipfile,sys\n\
         z=zipfile.ZipFile(r'{}')\n\
         n=[x for x in z.namelist() if x.endswith('.md')][0]\n\
         sys.stdout.write(z.read(n).decode('utf-8'))\n",
        dest.to_string_lossy()
    );
    let out = Command::new("python")
        .arg("-c")
        .arg(&script)
        .output()
        .unwrap();
    let body = String::from_utf8_lossy(&out.stdout);

    assert!(
        body.contains("title: Sync test / with a slash"),
        "front matter lost: {body}"
    );
    assert!(
        body.contains("The body survives."),
        "the note itself is missing: {body}"
    );
    assert!(body.starts_with("---"), "not Markdown front matter: {body}");
}

#[test]
fn media_travels_with_the_notes_that_point_at_it() {
    let dir = temp_dir("media");
    let db_path = dir.join("omnivault.db");
    let mut conn = Connection::open(&db_path).unwrap();
    initialize_schema(&conn).unwrap();

    let item = create_item(&mut conn, None, "image", "A screenshot", "", None, "dev").unwrap();
    let media = save_image_media(&mut conn, &dir, &item.id, &png(4), "dev").unwrap();
    conn.execute(
        "UPDATE vault_items SET content = ?1 WHERE id = ?2",
        rusqlite::params![format!("/api/media/{}.webp", media.file_hash), item.id],
    )
    .unwrap();

    // A deleted item's blob is still worth keeping in a backup.
    let doomed = create_item(&mut conn, None, "image", "Deleted later", "", None, "dev").unwrap();
    save_image_media(&mut conn, &dir, &doomed.id, &png(8), "dev").unwrap();
    delete_item(&mut conn, &doomed.id, "dev").unwrap();

    let dest = dir.join("out.zip");
    let summary = export_vault(&mut conn, &dir, &dest).unwrap();
    assert_eq!(summary.media_files, 2, "a blob was left behind");

    let entries = read_with_python(&dest).unwrap();
    let blobs: Vec<&(String, usize)> = entries
        .iter()
        .filter(|(n, _)| n.starts_with("media/"))
        .collect();
    assert_eq!(blobs.len(), 2);
    for (name, len) in blobs {
        assert!(*len > 0, "{name} was archived empty");
    }

    // The image note must link to the blob by a path that resolves inside the
    // archive, so a Markdown viewer shows the picture.
    let script = format!(
        "import zipfile,sys\n\
         z=zipfile.ZipFile(r'{}')\n\
         n=[x for x in z.namelist() if x.endswith('.md')][0]\n\
         sys.stdout.write(z.read(n).decode('utf-8'))\n",
        dest.to_string_lossy()
    );
    let out = Command::new("python")
        .arg("-c")
        .arg(&script)
        .output()
        .unwrap();
    let body = String::from_utf8_lossy(&out.stdout);
    assert!(
        body.contains(&format!("](../../media/{}.webp)", media.file_hash)),
        "the image link does not resolve from notes/<folder>/ inside the archive: {body}"
    );
}

#[test]
fn the_newest_note_is_in_the_database_that_gets_exported() {
    // In WAL mode a committed write can live only in the -wal file; the export
    // must checkpoint before copying the database.
    let dir = temp_dir("wal");
    let db_path = dir.join("omnivault.db");
    let mut conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
    initialize_schema(&conn).unwrap();

    create_item(
        &mut conn,
        None,
        "note",
        "Written seconds ago",
        "Must be in the backup.",
        None,
        "dev",
    )
    .unwrap();

    let dest = dir.join("out.zip");
    export_vault(&mut conn, &dir, &dest).unwrap();

    // Pull omnivault.db out of the archive and read it as a fresh database, with
    // no -wal beside it — exactly what a person restoring from this file has.
    let restored_dir = temp_dir("wal-restore");
    let script = format!(
        "import zipfile\n\
         z=zipfile.ZipFile(r'{}')\n\
         open(r'{}','wb').write(z.read('omnivault.db'))\n",
        dest.to_string_lossy(),
        restored_dir.join("restored.db").to_string_lossy()
    );
    let out = Command::new("python")
        .arg("-c")
        .arg(&script)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let restored = Connection::open(restored_dir.join("restored.db")).unwrap();
    let title: String = restored
        .query_row(
            "SELECT title FROM vault_items WHERE is_deleted = 0",
            [],
            |r| r.get(0),
        )
        .expect("the newest note never reached the exported database");
    assert_eq!(title, "Written seconds ago");
}
