use image::{ImageFormat, Rgba, RgbaImage};
use rusqlite::Connection;
use std::fs;
use std::io::Cursor;
use uuid::Uuid;

use omnivault_lib::db::media::{read_media_bytes, save_image_media};
use omnivault_lib::db::models::{Folder, MediaFile, VaultItem};
use omnivault_lib::db::schema::initialize_schema;
use omnivault_lib::db::storage::{
    create_folder, create_item, delete_folder, get_or_create_device_id, list_folders,
    list_inbox_items, list_items_by_folder, move_item,
};

fn create_sample_png_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut img = RgbaImage::new(width, height);
    for x in 0..width {
        for y in 0..height {
            img.put_pixel(x, y, Rgba([47, 129, 247, 255]));
        }
    }
    let mut bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .unwrap();
    bytes
}

#[test]
fn test_storage_integration_e2e_workflow() {
    // 1. Initialize SQLite database in memory
    let mut conn = Connection::open_in_memory().expect("failed to open memory db");
    initialize_schema(&conn).expect("schema initialization failed");

    let device_id = get_or_create_device_id(&conn).expect("failed to get device id");
    assert!(!device_id.is_empty());

    // 2. Build 5-Level Deep Hierarchical Folder Tree
    // Product Ideas -> SaaS -> AI Image Generator -> Models -> Prompts
    let l1 = create_folder(
        &mut conn,
        "Product Ideas",
        None,
        Some("#2F81F7"),
        &device_id,
    )
    .unwrap();
    let l2 = create_folder(&mut conn, "SaaS", Some(&l1.id), None, &device_id).unwrap();
    let l3 = create_folder(
        &mut conn,
        "AI Image Generator",
        Some(&l2.id),
        None,
        &device_id,
    )
    .unwrap();
    let l4 = create_folder(&mut conn, "Models", Some(&l3.id), None, &device_id).unwrap();
    let l5 = create_folder(&mut conn, "Prompts", Some(&l4.id), None, &device_id).unwrap();

    let all_folders = list_folders(&conn, false).unwrap();
    assert_eq!(all_folders.len(), 5);
    assert_eq!(l5.parent_id, Some(l4.id.clone()));

    // 3. Quick Capture: Drop an idea into Quick Inbox (folder_id is None)
    let inbox_item = create_item(
        &mut conn,
        None,
        "note",
        "Hyperrealistic Stock Visualizer Prompt",
        "Generate 4k candlestick chart with neon breakout lines and orderbook depth heatmap",
        Some(r#"{"tags":["saas","ai","prompt"]}"#),
        &device_id,
    )
    .unwrap();

    let inbox_list = list_inbox_items(&conn).unwrap();
    assert_eq!(inbox_list.len(), 1);
    assert_eq!(inbox_list[0].id, inbox_item.id);

    // 4. Laptop Triage: Move item from Quick Inbox to deep nested folder (L5 "Prompts")
    let moved_item = move_item(&mut conn, &inbox_item.id, Some(&l5.id), &device_id).unwrap();
    assert_eq!(moved_item.folder_id, Some(l5.id.clone()));

    // Inbox is now clean!
    let inbox_after = list_inbox_items(&conn).unwrap();
    assert_eq!(inbox_after.len(), 0);

    // Item is now present inside folder L5
    let folder_items = list_items_by_folder(&conn, &l5.id).unwrap();
    assert_eq!(folder_items.len(), 1);
    assert_eq!(folder_items[0].id, inbox_item.id);

    // 5. Attach Media to the filed item (WebP compression & disk storage)
    let temp_storage = std::env::temp_dir().join(format!("omnivault_e2e_{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_storage).unwrap();

    let sample_png = create_sample_png_bytes(64, 64);
    let media = save_image_media(
        &mut conn,
        &temp_storage,
        &moved_item.id,
        &sample_png,
        &device_id,
    )
    .unwrap();
    assert_eq!(media.mime_type, "image/webp");
    assert_eq!(media.width, Some(64));
    assert_eq!(media.height, Some(64));

    // Verify disk content
    let read_back = read_media_bytes(&temp_storage, &media.relative_path).unwrap();
    assert!(!read_back.is_empty());

    // 6. Delete a folder (L4, which cascades to child L5 and re-parents item to Quick Inbox)
    delete_folder(&mut conn, &l4.id, &device_id).unwrap();
    let remaining_folders = list_folders(&conn, false).unwrap();
    assert_eq!(
        remaining_folders.len(),
        3,
        "L4 and child L5 must be recursively soft-deleted"
    );

    // Verify child item was preserved in Quick Inbox
    let rescued_inbox = list_inbox_items(&conn).unwrap();
    assert_eq!(
        rescued_inbox.len(),
        1,
        "Child item must be safely rescued to Quick Inbox"
    );
    assert_eq!(rescued_inbox[0].id, moved_item.id);

    // 7. Audit Complete Revision Stream for Store-and-Forward Sync
    let mut rev_stmt = conn
        .prepare(
            "SELECT id, entity_type, entity_id, device_id, change_type, payload, timestamp
         FROM revisions ORDER BY id ASC",
        )
        .unwrap();

    let revisions: Vec<(i64, String, String, String, String, String, i64)> = rev_stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    // Expected revision count:
    // 5 folder creations (L1..L5)
    // 1 item creation (Inbox)
    // 1 item move (Inbox -> L5)
    // 1 media file creation
    // 2 folder deletions (L4, L5)
    // 1 item re-parent move (L5 -> Inbox)
    // Total = 11 revisions
    assert_eq!(
        revisions.len(),
        11,
        "Expected exactly 11 revisions in delta audit"
    );

    // Assert revision timestamps are valid and monotonic
    for i in 1..revisions.len() {
        assert!(
            revisions[i].6 >= revisions[i - 1].6,
            "Revision timestamps must be non-decreasing"
        );
    }

    // Assert all revisions belong to the originating device
    for rev in &revisions {
        assert_eq!(rev.3, device_id, "Device ID must match originating device");
    }

    // Verify deserialization of folder, item, and media payloads
    let l1_payload: Folder = serde_json::from_str(&revisions[0].5).unwrap();
    assert_eq!(l1_payload.name, "Product Ideas");

    let item_payload: VaultItem = serde_json::from_str(&revisions[5].5).unwrap();
    assert_eq!(item_payload.title, "Hyperrealistic Stock Visualizer Prompt");

    let media_payload: MediaFile = serde_json::from_str(&revisions[7].5).unwrap();
    assert_eq!(media_payload.mime_type, "image/webp");

    println!("✅ E2E Storage & Revision Audit Self-Check passed with 9 valid revisions!");

    // Clean up temporary disk files
    let _ = fs::remove_dir_all(&temp_storage);
}
