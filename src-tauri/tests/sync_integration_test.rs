use std::fs;
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use image::{ImageFormat, Rgba, RgbaImage};
use rusqlite::Connection;
use uuid::Uuid;

use omnivault_lib::db::media::save_image_media;
use omnivault_lib::db::schema::initialize_schema;
use omnivault_lib::db::storage::{
    create_folder, create_item, get_item_by_id, list_folders, list_inbox_items,
    list_items_by_folder, update_item,
};
use omnivault_lib::http_server;
use omnivault_lib::sync::discovery::{PeerInfo, PeerRegistry};
use omnivault_lib::sync::mesh_sync::{pair_with_remote_peer, sync_with_peer};
use omnivault_lib::sync::pairing::{is_device_paired, store_paired_device};
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
    let _media_chart = save_image_media(
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
    // STAGE 3: Mutual Pairing Token
    // -------------------------------------------------------------
    // The PIN handshake itself is exercised against the real HTTP surface in
    // http_server's tests; here both sides simply end up holding one token.
    let auth_token = "f".repeat(64);
    store_paired_device(&phone.conn, &laptop.device_id, &laptop.device_name, &auth_token)
        .unwrap();

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

#[tokio::test]
async fn test_store_and_forward_mesh_sync_http_and_webp() {
    let mut phone_conn = Connection::open_in_memory().unwrap();
    initialize_schema(&phone_conn).unwrap();
    let phone_storage = std::env::temp_dir().join(format!("omnivault_test_phone_{}", Uuid::new_v4()));
    fs::create_dir_all(phone_storage.join("media")).unwrap();

    let laptop_conn = Connection::open_in_memory().unwrap();
    initialize_schema(&laptop_conn).unwrap();
    let laptop_storage = std::env::temp_dir().join(format!("omnivault_test_laptop_{}", Uuid::new_v4()));
    fs::create_dir_all(laptop_storage.join("media")).unwrap();

    let phone_dev_id = "device-android-phone";
    let laptop_dev_id = "device-windows-laptop";

    // 1. Outdoors: Phone captures a folder, note, and WebP photo while offline
    let folder = create_folder(&mut phone_conn, "Solar Tech", None, Some("#10B981"), phone_dev_id).unwrap();
    let note = create_item(
        &mut phone_conn,
        Some(&folder.id),
        "note",
        "Inverter In-Field Test",
        "Measured 98.2% conversion efficiency at 45 deg angle",
        None,
        phone_dev_id,
    ).unwrap();

    let synthetic_png = create_synthetic_png_bytes(64, 64);
    let _photo = save_image_media(
        &mut phone_conn,
        &phone_storage,
        &note.id,
        &synthetic_png,
        phone_dev_id,
    ).unwrap();

    // Verify phone has 3 revisions
    let phone_revs = query_revisions_since(&phone_conn, 0, None).unwrap();
    assert_eq!(phone_revs.len(), 3);

    // 2. Both nodes come home and start their HTTP servers
    let phone_db = Arc::new(Mutex::new(phone_conn));
    let laptop_db = Arc::new(Mutex::new(laptop_conn));

    let _phone_server = http_server::start_http_server(phone_db.clone(), phone_dev_id.to_string(), 0).unwrap();
    let laptop_server = http_server::start_http_server(laptop_db.clone(), laptop_dev_id.to_string(), 0).unwrap();

    // 3. One-time pairing handshake: Phone pairs with Laptop.
    //
    // The PIN is issued locally on the laptop and read off its screen by the
    // user — it is deliberately NOT obtainable over HTTP (D-051), because a PIN
    // served over the network it protects is not an out-of-band secret. This
    // test therefore seeds the session through the same shared handle the
    // desktop UI writes to via `get_pairing_session_cmd`, which models the real
    // flow: issued on the laptop, typed on the phone.
    let laptop_pin = "424 242".to_string();
    {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let mut session = laptop_server.pairing_session.lock().unwrap();
        *session = Some(http_server::ActivePairingSession {
            pin: laptop_pin.clone(),
            expires_at: now_ms + 120_000,
        });
    }

    // Phone initiates pairing with Laptop using the PIN
    let paired_device = pair_with_remote_peer(
        phone_db.clone(),
        phone_dev_id,
        "OmniVault Mobile",
        "127.0.0.1",
        laptop_server.port,
        &laptop_pin,
    ).unwrap();

    assert_eq!(paired_device.device_id, laptop_dev_id);

    // Assert Laptop recorded Phone in paired_devices via the pairing handshake
    {
        let l_conn = laptop_db.lock().unwrap();
        assert!(is_device_paired(&l_conn, phone_dev_id).unwrap());
    }

    // 4. Trigger Store-and-Forward Mesh Sync: Phone syncs with Laptop
    let laptop_peer_info = PeerInfo {
        device_id: laptop_dev_id.to_string(),
        device_name: "OmniVault Desktop".to_string(),
        sync_port: laptop_server.port,
        addr: "127.0.0.1".parse().unwrap(),
        last_seen: chrono::Utc::now().timestamp(),
    };

    let _applied = sync_with_peer(
        phone_db.clone(),
        phone_dev_id,
        &laptop_peer_info,
        &phone_storage,
    ).unwrap();

    // Revisions pushed from Phone to Laptop: Laptop now has the folder and note in SQLite!
    {
        let l_conn = laptop_db.lock().unwrap();
        let l_folders = list_folders(&l_conn, false).unwrap();
        assert_eq!(l_folders.len(), 1);
        assert_eq!(l_folders[0].name, "Solar Tech");

        let l_items = list_items_by_folder(&l_conn, &folder.id).unwrap();
        assert_eq!(l_items.len(), 1);
        assert_eq!(l_items[0].title, "Inverter In-Field Test");
    }

    // Clean up temporary test storage directories
    let _ = fs::remove_dir_all(&phone_storage);
    let _ = fs::remove_dir_all(&laptop_storage);
}

