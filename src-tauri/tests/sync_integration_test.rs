use std::fs;
use std::io::Cursor;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use image::{ImageFormat, Rgba, RgbaImage};
use rusqlite::Connection;
use uuid::Uuid;

use omnivault_lib::db::media::{compute_sha256, read_media_bytes, save_image_media};
use omnivault_lib::db::schema::initialize_schema;
use omnivault_lib::db::storage::{
    create_folder, create_item, get_item_by_id, list_folders, list_inbox_items,
    list_items_by_folder, update_item,
};
use omnivault_lib::sync::blob_stream::{download_blob_over_tcp, handle_blob_request};
use omnivault_lib::sync::discovery::{PeerInfo, PeerRegistry};
use omnivault_lib::sync::pairing::{is_device_paired, store_paired_device, PairingManager};
use omnivault_lib::sync::protocol::{apply_remote_revisions, query_revisions_since};

fn create_synthetic_png_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut img = RgbaImage::new(width, height);
    for x in 0..width {
        for y in 0..height {
            img.put_pixel(x, y, Rgba([47, 129, 247, 255]));
        }
    }
    let mut bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).unwrap();
    bytes
}

struct TestNode {
    pub device_id: String,
    pub device_name: String,
    pub conn: Connection,
    pub storage_dir: std::path::PathBuf,
}

impl TestNode {
    fn new(name: &str) -> Self {
        let conn = Connection::open_in_memory().expect("open memory db");
        initialize_schema(&conn).expect("schema init");
        let storage_dir = std::env::temp_dir().join(format!("omnivault_sync_{}_{}", name, Uuid::new_v4()));
        fs::create_dir_all(storage_dir.join("media")).expect("create media dir");

        Self {
            device_id: format!("device-id-{}", name),
            device_name: format!("OmniVault {}", name),
            conn,
            storage_dir,
        }
    }
}

impl Drop for TestNode {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.storage_dir);
    }
}

#[tokio::test]
async fn test_headless_two_node_sync_e2e() {
    // -------------------------------------------------------------
    // STAGE 0: Initialize two isolated independent nodes (Phone & Laptop)
    // -------------------------------------------------------------
    let mut phone = TestNode::new("phone");
    let mut laptop = TestNode::new("laptop");

    // -------------------------------------------------------------
    // STAGE 1: Offline Capture on Phone (User outside)
    // -------------------------------------------------------------
    // 1.1 Create nested folder tree: "Research" -> "Breakouts"
    let f_research = create_folder(&mut phone.conn, "Research", None, Some("#2F81F7"), &phone.device_id).unwrap();
    let f_breakouts = create_folder(&mut phone.conn, "Breakouts", Some(&f_research.id), None, &phone.device_id).unwrap();

    // 1.2 Capture item in "Breakouts" folder
    let item_nvda = create_item(
        &mut phone.conn,
        Some(&f_breakouts.id),
        "ticker",
        "$NVDA Breakout",
        "Volume expansion on 15m chart with RSI confirmation",
        Some(r#"{"ticker":"NVDA"}"#),
        &phone.device_id,
    ).unwrap();

    // 1.3 Attach WebP screenshot chart to NVDA item
    let chart_png = create_synthetic_png_bytes(80, 80);
    let media_chart = save_image_media(
        &mut phone.conn,
        &phone.storage_dir,
        &item_nvda.id,
        &chart_png,
        &phone.device_id,
    ).unwrap();

    // 1.4 Quick Capture into Inbox: unfiled idea
    let _inbox_idea = create_item(
        &mut phone.conn,
        None,
        "note",
        "Market Open Checklist",
        "Review pre-market gaps, check VIX, verify open orders",
        None,
        &phone.device_id,
    ).unwrap();

    // Verify Phone has 2 folders, 2 items, 1 media file, and 5 revisions
    assert_eq!(list_folders(&phone.conn, false).unwrap().len(), 2);
    assert_eq!(list_inbox_items(&phone.conn).unwrap().len(), 1);
    let phone_revisions = query_revisions_since(&phone.conn, 0, None).unwrap();
    assert_eq!(phone_revisions.len(), 5); // 2 folders + 2 items + 1 media_file

    // Verify Laptop is completely empty initially
    assert_eq!(list_folders(&laptop.conn, false).unwrap().len(), 0);
    assert_eq!(list_inbox_items(&laptop.conn).unwrap().len(), 0);

    // -------------------------------------------------------------
    // STAGE 2: Local Peer Discovery Simulation
    // -------------------------------------------------------------
    let laptop_registry = PeerRegistry::new();
    laptop_registry.register_or_update(PeerInfo {
        device_id: phone.device_id.clone(),
        device_name: phone.device_name.clone(),
        sync_port: 42425,
        addr: "192.168.1.50".parse().unwrap(),
        last_seen: chrono::Utc::now().timestamp(),
    }).await;

    let active_peers = laptop_registry.get_active_peers().await;
    assert_eq!(active_peers.len(), 1);
    assert_eq!(active_peers[0].device_id, phone.device_id);

    // -------------------------------------------------------------
    // STAGE 3: 6-Digit PIN Pairing Handshake
    // -------------------------------------------------------------
    let phone_pairing_mgr = PairingManager::new();
    let pin = phone_pairing_mgr.create_pairing_request(&laptop.device_id, &laptop.device_name).await;
    assert_eq!(pin.len(), 6);

    // Phone confirms submitted PIN and issues persistent auth token
    let paired_device = phone_pairing_mgr
        .verify_and_pair(&phone.conn, &laptop.device_id, &pin)
        .await
        .expect("PIN verification failed");
    let auth_token = paired_device.auth_token;
    assert_eq!(auth_token.len(), 64); // SHA-256 token

    // Laptop stores the mutual pairing token
    store_paired_device(&laptop.conn, &phone.device_id, &phone.device_name, &auth_token).unwrap();

    assert!(is_device_paired(&phone.conn, &laptop.device_id).unwrap());
    assert!(is_device_paired(&laptop.conn, &phone.device_id).unwrap());

    // -------------------------------------------------------------
    // STAGE 4: Delta Sync Catchup (Phone -> Laptop)
    // -------------------------------------------------------------
    let phone_deltas = query_revisions_since(&phone.conn, 0, None).unwrap();
    let applied_count = apply_remote_revisions(&mut laptop.conn, &phone_deltas).unwrap();
    assert_eq!(applied_count, 5);

    // Assert Laptop database now matches Phone identically!
    let laptop_folders = list_folders(&laptop.conn, false).unwrap();
    assert_eq!(laptop_folders.len(), 2);
    let l_breakouts = laptop_folders.iter().find(|f| f.name == "Breakouts").unwrap();
    assert_eq!(l_breakouts.parent_id, Some(f_research.id.clone()));

    let laptop_items = list_items_by_folder(&laptop.conn, &l_breakouts.id).unwrap();
    assert_eq!(laptop_items.len(), 1);
    assert_eq!(laptop_items[0].title, "$NVDA Breakout");

    let laptop_inbox = list_inbox_items(&laptop.conn).unwrap();
    assert_eq!(laptop_inbox.len(), 1);
    assert_eq!(laptop_inbox[0].title, "Market Open Checklist");

    // -------------------------------------------------------------
    // STAGE 5: TCP Media Blob Streaming & Verification
    // -------------------------------------------------------------
    // Laptop has media metadata in SQLite, but disk media file does not exist yet
    let laptop_media_target = laptop.storage_dir.join(&media_chart.relative_path);
    assert!(!laptop_media_target.exists());

    // Spin up TCP listener on Phone side for blob transfers
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let phone_tcp_addr = listener.local_addr().unwrap();
    let phone_storage = phone.storage_dir.clone();
    let valid_token = auth_token.clone();

    let server_running = Arc::new(AtomicBool::new(true));
    let server_flag = server_running.clone();

    let server_handle = thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        while server_flag.load(Ordering::Relaxed) {
            if let Ok((mut stream, _)) = listener.accept() {
                stream.set_nonblocking(false).unwrap();
                let mut reader = stream.try_clone().unwrap();
                let _ = handle_blob_request(&mut reader, &mut stream, &phone_storage, |t| t == valid_token);
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
    });

    // Laptop requests and downloads media blob from Phone over TCP
    let downloaded_path = download_blob_over_tcp(
        &phone_tcp_addr.to_string(),
        &media_chart.file_hash,
        &auth_token,
        &laptop.storage_dir,
    ).expect("failed to download blob over TCP");

    server_running.store(false, Ordering::Relaxed);
    let _ = server_handle.join();

    assert!(downloaded_path.exists());
    let laptop_blob_bytes = read_media_bytes(&laptop.storage_dir, &media_chart.relative_path).unwrap();
    let phone_blob_bytes = read_media_bytes(&phone.storage_dir, &media_chart.relative_path).unwrap();
    assert_eq!(laptop_blob_bytes, phone_blob_bytes);
    assert_eq!(compute_sha256(&laptop_blob_bytes), media_chart.file_hash);

    // -------------------------------------------------------------
    // STAGE 6: Bidirectional Offline Convergence (Laptop -> Phone)
    // -------------------------------------------------------------
    // While disconnected, Laptop captures a new note in Quick Inbox
    let laptop_note = create_item(
        &mut laptop.conn,
        None,
        "note",
        "End of Day Journal",
        "Logged trading executions and updated risk metrics",
        None,
        &laptop.device_id,
    ).unwrap();

    // Phone pulls deltas since its last sync timestamp
    let last_phone_sync_ts = phone_deltas.last().unwrap().timestamp;
    let laptop_deltas = query_revisions_since(&laptop.conn, last_phone_sync_ts, Some(&phone.device_id)).unwrap();
    assert_eq!(laptop_deltas.len(), 1);
    assert_eq!(laptop_deltas[0].entity_id, laptop_note.id);

    // Phone applies Laptop's revisions
    let phone_applied = apply_remote_revisions(&mut phone.conn, &laptop_deltas).unwrap();
    assert_eq!(phone_applied, 1);

    // Verify Phone now also contains the Laptop's note in Quick Inbox!
    let phone_inbox_all = list_inbox_items(&phone.conn).unwrap();
    assert_eq!(phone_inbox_all.len(), 2);
    assert!(phone_inbox_all.iter().any(|item| item.title == "End of Day Journal"));
    assert!(phone_inbox_all.iter().any(|item| item.title == "Market Open Checklist"));

    // -------------------------------------------------------------
    // STAGE 7: Concurrent Edit & LWW Conflict Resolution
    // -------------------------------------------------------------
    // Node A modifies NVDA note at T = now
    update_item(
        &mut phone.conn,
        &item_nvda.id,
        "$NVDA Breakout (Phone Edit)",
        "Volume expansion on 15m chart with RSI confirmation",
        Some(r#"{"ticker":"NVDA"}"#),
        &phone.device_id,
    ).unwrap();

    // Sleep briefly to ensure distinct millisecond timestamp
    thread::sleep(Duration::from_millis(20));

    // Node B modifies same item with newer timestamp
    update_item(
        &mut laptop.conn,
        &item_nvda.id,
        "$NVDA Breakout (Laptop Newest Edit)",
        "Volume expansion on 15m chart with RSI confirmation",
        Some(r#"{"ticker":"NVDA"}"#),
        &laptop.device_id,
    ).unwrap();

    // Exchange deltas both ways
    let phone_new_deltas = query_revisions_since(&phone.conn, last_phone_sync_ts, None).unwrap();
    let laptop_new_deltas = query_revisions_since(&laptop.conn, last_phone_sync_ts, None).unwrap();

    apply_remote_revisions(&mut phone.conn, &laptop_new_deltas).unwrap();
    apply_remote_revisions(&mut laptop.conn, &phone_new_deltas).unwrap();

    // Both nodes MUST deterministically converge on Laptop's newer edit
    let final_nvda_on_phone = get_item_by_id(&phone.conn, &item_nvda.id).unwrap().unwrap();
    let final_nvda_on_laptop = get_item_by_id(&laptop.conn, &item_nvda.id).unwrap().unwrap();

    assert_eq!(final_nvda_on_phone.title, "$NVDA Breakout (Laptop Newest Edit)");
    assert_eq!(final_nvda_on_laptop.title, "$NVDA Breakout (Laptop Newest Edit)");
}
