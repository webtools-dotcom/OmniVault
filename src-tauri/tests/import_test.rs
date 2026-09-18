//! Holds the restore rules of P12-T02 to account.
//!
//! The one that matters most is rule 3: a restore must never overwrite work
//! done after the backup was taken. Everything else in a backup feature is
//! convenience; that one is the difference between a safety net and a way to
//! lose an afternoon.

use std::fs;
use std::path::PathBuf;

use omnivault_lib::db::export::export_vault;
use omnivault_lib::db::import::{import_vault, list_backups};
use omnivault_lib::db::media::save_image_media;
use omnivault_lib::db::schema::initialize_schema;
use omnivault_lib::db::storage::{create_folder, create_item, delete_item, list_inbox_items, update_item};
use rusqlite::Connection;

struct Vault {
    dir: PathBuf,
    conn: Connection,
}

fn vault(tag: &str) -> Vault {
    let dir = std::env::temp_dir().join(format!("ov-imp-{tag}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let conn = Connection::open(dir.join("omnivault.db")).unwrap();
    initialize_schema(&conn).unwrap();
    Vault { dir, conn }
}

fn png(size: u32) -> Vec<u8> {
    use std::io::Cursor;
    let mut buf = Vec::new();
    image::DynamicImage::ImageRgba8(image::RgbaImage::new(size, size))
        .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

fn title_of(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row("SELECT title FROM vault_items WHERE id = ?1", [id], |r| r.get(0))
        .ok()
}

#[test]
fn a_backup_restores_onto_an_empty_vault() {
    let mut source = vault("src");
    let folder = create_folder(&mut source.conn, "Market Setups", None, None, "dev").unwrap();
    create_item(
        &mut source.conn,
        Some(&folder.id),
        "note",
        "NVDA position review",
        "Bought at 357.",
        None,
        "dev",
    )
    .unwrap();
    create_item(&mut source.conn, None, "note", "Unfiled", "Inbox note.", None, "dev").unwrap();

    let archive = source.dir.join("omnivault-backup-test.zip");
    export_vault(&mut source.conn, &source.dir, &archive).unwrap();

    let mut fresh = vault("fresh");
    let summary = import_vault(&mut fresh.conn, &fresh.dir, &archive).unwrap();

    assert_eq!(summary.notes_in_backup, 2);
    assert!(summary.applied >= 3, "folder and both notes should have landed");

    let inbox = list_inbox_items(&fresh.conn).unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].title, "Unfiled");

    let folders: i64 = fresh
        .conn
        .query_row("SELECT COUNT(*) FROM folders WHERE is_deleted = 0", [], |r| r.get(0))
        .unwrap();
    assert_eq!(folders, 1, "the folder tree did not come back");
}

#[test]
fn a_restore_never_overwrites_newer_work() {
    // Rule 3. Back up, keep writing, then restore the older backup: the newer
    // words must survive, because otherwise a backup is a way to lose an
    // afternoon rather than a way to keep one.
    let mut v = vault("newer");
    let item = create_item(&mut v.conn, None, "note", "Plan", "First draft.", None, "dev").unwrap();

    let archive = v.dir.join("omnivault-backup-old.zip");
    export_vault(&mut v.conn, &v.dir, &archive).unwrap();

    std::thread::sleep(std::time::Duration::from_millis(5));
    update_item(&mut v.conn, &item.id, "Plan", "Second draft, written after the backup.", None, "dev")
        .unwrap();

    import_vault(&mut v.conn, &v.dir, &archive).unwrap();

    let content: String = v
        .conn
        .query_row("SELECT content FROM vault_items WHERE id = ?1", [&item.id], |r| r.get(0))
        .unwrap();
    assert_eq!(
        content, "Second draft, written after the backup.",
        "the restore rolled the note back to the backup's copy"
    );
}

#[test]
fn a_restore_adds_without_removing() {
    // Rule 1: a merge, never a mirror.
    let mut source = vault("merge-src");
    create_item(&mut source.conn, None, "note", "From the backup", "b", None, "dev").unwrap();
    let archive = source.dir.join("omnivault-backup-merge.zip");
    export_vault(&mut source.conn, &source.dir, &archive).unwrap();

    let mut target = vault("merge-dst");
    let local = create_item(&mut target.conn, None, "note", "Only on this device", "l", None, "dev")
        .unwrap();

    import_vault(&mut target.conn, &target.dir, &archive).unwrap();

    let titles: Vec<String> = list_inbox_items(&target.conn)
        .unwrap()
        .into_iter()
        .map(|i| i.title)
        .collect();
    assert!(titles.contains(&"From the backup".to_string()), "{titles:?}");
    assert!(
        titles.contains(&"Only on this device".to_string()),
        "the restore deleted a note it had never seen: {titles:?}"
    );
    assert!(title_of(&target.conn, &local.id).is_some());
}

#[test]
fn a_deletion_in_the_backup_is_a_fact_with_a_timestamp() {
    // Rule 4, both directions.
    let mut source = vault("del-src");
    let kept = create_item(&mut source.conn, None, "note", "Deleted in backup", "x", None, "dev")
        .unwrap();
    delete_item(&mut source.conn, &kept.id, "dev").unwrap();
    let archive = source.dir.join("omnivault-backup-del.zip");
    export_vault(&mut source.conn, &source.dir, &archive).unwrap();

    // A device that still has the note, untouched since: the deletion is newer.
    let mut stale = vault("del-stale");
    stale
        .conn
        .execute(
            "INSERT INTO vault_items (id, folder_id, item_type, title, content, is_pinned, is_archived, is_deleted, created_at, updated_at)
             VALUES (?1, NULL, 'note', 'Deleted in backup', 'x', 0, 0, 0, 1, 1)",
            [&kept.id],
        )
        .unwrap();
    import_vault(&mut stale.conn, &stale.dir, &archive).unwrap();
    let gone: i64 = stale
        .conn
        .query_row("SELECT is_deleted FROM vault_items WHERE id = ?1", [&kept.id], |r| r.get(0))
        .unwrap();
    assert_eq!(gone, 1, "a newer deletion in the backup should have applied");

    // A device that edited the same note after the backup: the edit wins.
    let mut edited = vault("del-edited");
    let future = chrono::Utc::now().timestamp_millis() + 60_000;
    edited
        .conn
        .execute(
            "INSERT INTO vault_items (id, folder_id, item_type, title, content, is_pinned, is_archived, is_deleted, created_at, updated_at)
             VALUES (?1, NULL, 'note', 'Edited after the backup', 'newer', 0, 0, 0, 1, ?2)",
            rusqlite::params![kept.id, future],
        )
        .unwrap();
    import_vault(&mut edited.conn, &edited.dir, &archive).unwrap();
    let still_here: i64 = edited
        .conn
        .query_row("SELECT is_deleted FROM vault_items WHERE id = ?1", [&kept.id], |r| r.get(0))
        .unwrap();
    assert_eq!(still_here, 0, "an edit made after the backup was undone by the restore");
}

#[test]
fn media_comes_back_and_existing_blobs_are_left_alone() {
    // Rule 5.
    let mut source = vault("media-src");
    let item = create_item(&mut source.conn, None, "image", "Shot", "", None, "dev").unwrap();
    let media = save_image_media(&mut source.conn, &source.dir, &item.id, &png(4), "dev").unwrap();
    let archive = source.dir.join("omnivault-backup-media.zip");
    export_vault(&mut source.conn, &source.dir, &archive).unwrap();

    let mut target = vault("media-dst");
    let summary = import_vault(&mut target.conn, &target.dir, &archive).unwrap();
    assert_eq!(summary.media_added, 1);
    let blob = target.dir.join("media").join(format!("{}.webp", media.file_hash));
    assert!(blob.is_file(), "the image did not come back");

    // Second restore: the blob is already there and is not rewritten.
    let before = fs::metadata(&blob).unwrap().modified().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    let again = import_vault(&mut target.conn, &target.dir, &archive).unwrap();
    assert_eq!(again.media_added, 0, "a blob already on disk was written again");
    assert_eq!(fs::metadata(&blob).unwrap().modified().unwrap(), before);
}

#[test]
fn a_restore_never_takes_on_the_backups_identity() {
    // Rule 6. Two devices sharing one device_id stop receiving each other's
    // changes, because sync excludes revisions from your own id — a failure
    // that looks like "sync just stopped working" and has no visible cause.
    let mut source = vault("id-src");
    let source_id: String = source
        .conn
        .query_row("SELECT value FROM device_meta WHERE key = 'device_id'", [], |r| r.get(0))
        .unwrap_or_else(|_| {
            source
                .conn
                .execute(
                    "INSERT INTO device_meta (key, value) VALUES ('device_id', 'backup-device')",
                    [],
                )
                .unwrap();
            "backup-device".to_string()
        });
    source
        .conn
        .execute(
            "INSERT INTO paired_devices (device_id, device_name, auth_token, paired_at)
             VALUES ('someone-elses-peer', 'Their laptop', 'secret-token', 1)",
            [],
        )
        .unwrap();
    create_item(&mut source.conn, None, "note", "n", "n", None, "dev").unwrap();
    let archive = source.dir.join("omnivault-backup-id.zip");
    export_vault(&mut source.conn, &source.dir, &archive).unwrap();

    let mut target = vault("id-dst");
    target
        .conn
        .execute("INSERT INTO device_meta (key, value) VALUES ('device_id', 'this-device')", [])
        .unwrap();
    import_vault(&mut target.conn, &target.dir, &archive).unwrap();

    let id_now: String = target
        .conn
        .query_row("SELECT value FROM device_meta WHERE key = 'device_id'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(id_now, "this-device", "the restore took on the backup's identity");
    assert_ne!(id_now, source_id);

    let pairings: i64 = target
        .conn
        .query_row("SELECT COUNT(*) FROM paired_devices", [], |r| r.get(0))
        .unwrap();
    assert_eq!(pairings, 0, "the restore imported someone else's pairing token");
}

#[test]
fn a_file_that_is_not_a_backup_says_so_plainly() {
    let mut v = vault("junk");
    let junk = v.dir.join("not-a-backup.zip");
    fs::write(&junk, b"this is not a zip file at all").unwrap();
    let err = import_vault(&mut v.conn, &v.dir, &junk).unwrap_err().to_string();
    assert!(
        err.contains("not a zip") || err.contains("too small"),
        "the message would not help anyone: {err}"
    );

    // A real zip with no vault in it is a different mistake, and says so.
    // Built by Python so the fixture is a genuine archive from another tool,
    // not something this code produced and can therefore flatter.
    let stripped = v.dir.join("holiday-photos.zip");
    let script = format!(
        "import zipfile\nz=zipfile.ZipFile(r'{}','w',zipfile.ZIP_DEFLATED)\nz.writestr('holiday/readme.txt','not a vault')\nz.close()\n",
        stripped.to_string_lossy()
    );
    let out = std::process::Command::new("python").arg("-c").arg(&script).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));

    let err = import_vault(&mut v.conn, &v.dir, &stripped).unwrap_err().to_string();
    assert!(err.contains("OmniVault backup"), "unhelpful message: {err}");
}

#[test]
fn backups_are_listed_newest_first() {
    let dir = std::env::temp_dir().join(format!("ov-list-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("omnivault-backup-2026-01-01-0900.zip"), b"a").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    fs::write(dir.join("omnivault-backup-2026-02-02-1000.zip"), b"b").unwrap();
    fs::write(dir.join("holiday-photos.zip"), b"c").unwrap();

    let found = list_backups(&[dir.clone()]);
    assert_eq!(found.len(), 2, "something that is not a backup was offered: {found:?}");
    assert!(found[0].name.contains("2026-02-02"), "not newest first: {found:?}");
    let _ = fs::remove_dir_all(&dir);
}
