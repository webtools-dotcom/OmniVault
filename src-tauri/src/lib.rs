use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use tauri::State;

pub mod db;
pub mod sync;
pub mod http_server;

use crate::db::media;
use crate::db::models::{Folder, MediaFile, VaultItem};
use crate::db::schema;
use crate::db::storage;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub device_id: String,
    pub server_port: u16,
    pub base_dir: std::path::PathBuf,
    pub peer_registry: sync::discovery::PeerRegistry,
}

#[tauri::command]
fn get_system_status() -> String {
    "OmniVault Core Ready".into()
}

#[tauri::command]
async fn get_discovered_peers_cmd(state: State<'_, AppState>) -> Result<Vec<sync::discovery::PeerInfo>, String> {
    Ok(state.peer_registry.get_active_peers().await)
}

#[tauri::command]
async fn trigger_mesh_sync_cmd(state: State<'_, AppState>) -> Result<usize, String> {
    let peers = state.peer_registry.get_active_peers().await;
    let mut total_applied = 0;
    for peer in peers {
        let db = state.db.clone();
        let dev_id = state.device_id.clone();
        let b_dir = state.base_dir.clone();
        let p = peer.clone();
        if let Ok(applied) = tokio::task::spawn_blocking(move || {
            sync::mesh_sync::sync_with_peer(db, &dev_id, &p, &b_dir)
        }).await.unwrap_or_else(|e| Err(e.to_string())) {
            total_applied += applied;
        }
    }
    Ok(total_applied)
}

#[tauri::command]
async fn get_mesh_sync_status_cmd(state: State<'_, AppState>) -> Result<sync::mesh_sync::MeshSyncStatus, String> {
    let peers = state.peer_registry.get_active_peers().await;
    let (last_sync_at, paired_device_ids) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let last = conn.query_row(
            "SELECT MAX(last_sync_at) FROM paired_devices",
            [],
            |r| r.get(0),
        ).unwrap_or(None);
        let paired = sync::pairing::list_paired_devices(&conn)
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.device_id)
            .collect();
        (last, paired)
    };
    Ok(sync::mesh_sync::MeshSyncStatus {
        is_syncing: false,
        last_sync_at,
        peer_count: peers.len(),
        peers,
        paired_device_ids,
    })
}

#[tauri::command]
async fn pair_with_peer_cmd(
    state: State<'_, AppState>,
    peer_ip: String,
    peer_port: u16,
    pin: String,
) -> Result<sync::pairing::PairedDevice, String> {
    let db = state.db.clone();
    let dev_id = state.device_id.clone();
    #[cfg(target_os = "android")]
    let dev_name = format!("OmniVault Mobile ({})", &dev_id[..6.min(dev_id.len())]);
    #[cfg(not(target_os = "android"))]
    let dev_name = format!("OmniVault Desktop ({})", &dev_id[..6.min(dev_id.len())]);

    tokio::task::spawn_blocking(move || {
        sync::mesh_sync::pair_with_remote_peer(
            db,
            &dev_id,
            &dev_name,
            &peer_ip,
            peer_port,
            &pin,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Folder Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn list_folders_cmd(state: State<AppState>) -> Result<Vec<Folder>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::list_folders(&conn, false).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_folder_cmd(
    state: State<AppState>,
    name: String,
    parent_id: Option<String>,
    color: Option<String>,
) -> Result<Folder, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::create_folder(
        &mut conn,
        &name,
        parent_id.as_deref(),
        color.as_deref(),
        &state.device_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_folder_cmd(
    state: State<AppState>,
    id: String,
    name: String,
) -> Result<Folder, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::rename_folder(&mut conn, &id, &name, &state.device_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_folder_cmd(
    state: State<AppState>,
    id: String,
    parent_id: Option<String>,
) -> Result<Folder, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::move_folder(&mut conn, &id, parent_id.as_deref(), &state.device_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_folder_cmd(state: State<AppState>, id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::delete_folder(&mut conn, &id, &state.device_id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Item Commands (Quick Inbox & Folders)
// ---------------------------------------------------------------------------

#[tauri::command]
fn list_inbox_items_cmd(state: State<AppState>) -> Result<Vec<VaultItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::list_inbox_items(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_folder_items_cmd(state: State<AppState>, folder_id: String) -> Result<Vec<VaultItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::list_items_by_folder(&conn, &folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_item_cmd(
    state: State<AppState>,
    folder_id: Option<String>,
    item_type: String,
    title: String,
    content: String,
    metadata: Option<String>,
) -> Result<VaultItem, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::create_item(
        &mut conn,
        folder_id.as_deref(),
        &item_type,
        &title,
        &content,
        metadata.as_deref(),
        &state.device_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_item_cmd(
    state: State<AppState>,
    id: String,
    title: String,
    content: String,
    metadata: Option<String>,
) -> Result<VaultItem, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::update_item(
        &mut conn,
        &id,
        &title,
        &content,
        metadata.as_deref(),
        &state.device_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn move_item_cmd(
    state: State<AppState>,
    id: String,
    folder_id: Option<String>,
) -> Result<VaultItem, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::move_item(&mut conn, &id, folder_id.as_deref(), &state.device_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_pin_item_cmd(state: State<AppState>, id: String) -> Result<VaultItem, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::toggle_pin_item(&mut conn, &id, &state.device_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_item_cmd(state: State<AppState>, id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::delete_item(&mut conn, &id, &state.device_id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Media Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn save_image_media_cmd(
    state: State<AppState>,
    item_id: String,
    raw_bytes: Vec<u8>,
) -> Result<MediaFile, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    media::save_image_media(&mut conn, &state.base_dir, &item_id, &raw_bytes, &state.device_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_item_media_cmd(
    state: State<AppState>,
    item_id: String,
) -> Result<Vec<MediaFile>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    media::get_media_by_item_id(&conn, &item_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_lan_connection_info_cmd(state: State<AppState>) -> http_server::LanConnectionInfo {
    http_server::get_lan_connection_info(state.server_port)
}

#[tauri::command]
fn save_media_to_downloads_cmd(
    state: State<AppState>,
    media_url_or_hash: String,
    suggested_filename: Option<String>,
) -> Result<String, String> {
    let _ = &state;
    let clean_hash = media_url_or_hash
        .split('?')
        .next()
        .unwrap_or(&media_url_or_hash)
        .rsplit('/')
        .next()
        .unwrap_or(&media_url_or_hash)
        .trim_end_matches(".webp")
        .trim();

    if clean_hash.is_empty() {
        return Err("Invalid media hash or URL".into());
    }

    let src_path = http_server::find_media_file(clean_hash, None)
        .ok_or_else(|| format!("Media file for hash '{}' not found on disk", clean_hash))?;

    #[cfg(target_os = "android")]
    let downloads_dir = {
        let pub_dl = std::path::PathBuf::from("/sdcard/Download");
        if pub_dl.exists() {
            pub_dl
        } else {
            let emulated = std::path::PathBuf::from("/storage/emulated/0/Download");
            if emulated.exists() {
                emulated
            } else {
                state.base_dir.join("downloads")
            }
        }
    };
    #[cfg(not(target_os = "android"))]
    let downloads_dir = std::env::var("USERPROFILE")
        .map(|p| std::path::PathBuf::from(p).join("Downloads"))
        .or_else(|_| std::env::var("HOME").map(|p| std::path::PathBuf::from(p).join("Downloads")))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    if !downloads_dir.exists() {
        let _ = std::fs::create_dir_all(&downloads_dir);
    }

    let base_name = suggested_filename
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.chars()
                .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
                .collect::<String>()
        })
        .unwrap_or_else(|| {
            let short = if clean_hash.len() > 12 { &clean_hash[..12] } else { clean_hash };
            format!("omnivault_{}", short)
        });

    let mut dest_path = downloads_dir.join(format!("{}.webp", base_name));
    let mut counter = 1;
    let clean_name = format!("{}.webp", base_name);
    let stem = clean_name.trim_end_matches(".webp");
    while dest_path.exists() {
        dest_path = downloads_dir.join(format!("{} ({}).webp", stem, counter));
        counter += 1;
    }

    std::fs::copy(&src_path, &dest_path)
        .map_err(|e| format!("Failed to copy media file to Downloads: {}", e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_file_in_folder_cmd(file_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", file_path))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(parent) = std::path::Path::new(&file_path).parent() {
            let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        }
        Ok(())
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct PendingShareResult {
    pub count: usize,
    pub items: Vec<VaultItem>,
}

#[tauri::command]
fn check_and_process_pending_shares_cmd(state: State<AppState>) -> Result<PendingShareResult, String> {
    let mut processed_items = Vec::new();
    let shares_dir = state.base_dir.join("incoming_shares");
    if !shares_dir.exists() {
        return Ok(PendingShareResult { count: 0, items: processed_items });
    }

    let entries = match std::fs::read_dir(&shares_dir) {
        Ok(e) => e,
        Err(_) => return Ok(PendingShareResult { count: 0, items: processed_items }),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    let share_type = v.get("type").and_then(|s| s.as_str()).unwrap_or("text");
                    let title = v.get("title").and_then(|s| s.as_str()).unwrap_or("Shared capture");
                    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

                    if share_type == "text" {
                        let text = v.get("content").and_then(|s| s.as_str()).unwrap_or("");
                        let item_type = if text.starts_with("http://") || text.starts_with("https://") {
                            "link"
                        } else {
                            "note"
                        };
                        if let Ok(item) = storage::create_item(
                            &mut conn,
                            None,
                            item_type,
                            title,
                            text,
                            None,
                            &state.device_id,
                        ) {
                            processed_items.push(item);
                        }
                    } else if share_type == "image" {
                        if let Some(bin_file) = v.get("bin_file").and_then(|s| s.as_str()) {
                            let bin_path = std::path::PathBuf::from(bin_file);
                            if bin_path.exists() {
                                if let Ok(raw_bytes) = std::fs::read(&bin_path) {
                                    if let Ok(item) = storage::create_item(
                                        &mut conn,
                                        None,
                                        "image",
                                        title,
                                        "",
                                        None,
                                        &state.device_id,
                                    ) {
                                        let _ = media::save_image_media(
                                            &mut conn,
                                            &state.base_dir,
                                            &item.id,
                                            &raw_bytes,
                                            &state.device_id,
                                        );
                                        processed_items.push(item);
                                    }
                                }
                                let _ = std::fs::remove_file(&bin_path);
                            }
                        }
                    }
                }
            }
            let _ = std::fs::remove_file(&path);
        }
    }

    Ok(PendingShareResult {
        count: processed_items.len(),
        items: processed_items,
    })
}

pub fn resolve_app_base_dir() -> std::path::PathBuf {
    #[cfg(target_os = "android")]
    {
        let primary_dir = std::path::PathBuf::from("/data/data/com.omnivault.app/files");
        if let Ok(_) = std::fs::create_dir_all(&primary_dir) {
            if primary_dir.exists() {
                return primary_dir;
            }
        }
        let fallback_user0 = std::path::PathBuf::from("/data/user/0/com.omnivault.app/files");
        if let Ok(_) = std::fs::create_dir_all(&fallback_user0) {
            if fallback_user0.exists() {
                return fallback_user0;
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            if parent.join("omnivault.db").exists() || parent.join("media").exists() {
                return parent.to_path_buf();
            }
            return parent.to_path_buf();
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let release_dir = cwd.join("release");
        if release_dir.join("omnivault.db").exists() || release_dir.join("media").exists() {
            return release_dir;
        }
        return cwd;
    }
    std::path::PathBuf::from(".")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base_dir = resolve_app_base_dir();
    let media_dir = base_dir.join("media");
    let _ = std::fs::create_dir_all(&media_dir);

    let db_path = base_dir.join("omnivault.db");

    let mut conn = Connection::open(&db_path)
        .or_else(|_| Connection::open("omnivault.db"))
        .or_else(|_| Connection::open_in_memory())
        .expect("failed to open database");
    schema::initialize_schema(&conn).expect("failed to init schema");
    let device_id = storage::get_or_create_device_id(&conn).expect("failed to get device_id");
    let _ = storage::seed_defaults_if_empty(&mut conn, &device_id);

    let db = Arc::new(Mutex::new(conn));

    // Start P2P Mesh Discovery on background thread with Tokio runtime
    let peer_registry = sync::discovery::PeerRegistry::new();
    let peer_reg_clone = peer_registry.clone();
    let peer_reg_sync = peer_registry.clone();

    // Start embedded HTTP server on background thread (default port 42420)
    let server_port = match http_server::start_http_server_with_peers(
        db.clone(),
        device_id.clone(),
        42420,
        Some(peer_registry.clone()),
    ) {
        Ok(handle) => handle.port,
        Err(err) => {
            eprintln!("Warning: Failed to start embedded http server: {err}");
            42420
        }
    };

    let dev_id_broadcaster = device_id.clone();
    let dev_id_listener = device_id.clone();
    let dev_id_sync = device_id.clone();
    let db_sync = db.clone();
    let base_dir_sync = base_dir.clone();

    #[cfg(target_os = "android")]
    let dev_name = format!("OmniVault Mobile ({})", &device_id[..6.min(device_id.len())]);
    #[cfg(not(target_os = "android"))]
    let dev_name = format!("OmniVault Desktop ({})", &device_id[..6.min(device_id.len())]);

    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Warning: Failed to create Tokio runtime for discovery: {e}");
                return;
            }
        };

        rt.block_on(async move {
            let (_stop_tx, stop_rx1) = tokio::sync::watch::channel(false);
            let stop_rx2 = stop_rx1.clone();
            let stop_rx3 = stop_rx1.clone();

            let b_dev_name = dev_name.clone();
            tokio::spawn(async move {
                let _ = sync::discovery::DiscoveryService::run_broadcaster(
                    dev_id_broadcaster,
                    b_dev_name,
                    server_port,
                    5,
                    stop_rx1,
                ).await;
            });

            tokio::spawn(async move {
                let _ = sync::discovery::DiscoveryService::run_listener(
                    dev_id_listener,
                    peer_reg_clone,
                    stop_rx2,
                ).await;
            });

            tokio::spawn(async move {
                sync::mesh_sync::run_mesh_sync_loop(
                    db_sync,
                    dev_id_sync,
                    peer_reg_sync,
                    base_dir_sync,
                    stop_rx3,
                ).await;
            });

            // Keep discovery runtime alive indefinitely
            std::future::pending::<()>().await;
        });
    });

    let state = AppState {
        db: db.clone(),
        device_id,
        server_port,
        base_dir,
        peer_registry,
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_system_status,
            get_discovered_peers_cmd,
            trigger_mesh_sync_cmd,
            get_mesh_sync_status_cmd,
            pair_with_peer_cmd,
            list_folders_cmd,
            create_folder_cmd,
            rename_folder_cmd,
            move_folder_cmd,
            delete_folder_cmd,
            list_inbox_items_cmd,
            list_folder_items_cmd,
            create_item_cmd,
            update_item_cmd,
            move_item_cmd,
            toggle_pin_item_cmd,
            delete_item_cmd,
            save_image_media_cmd,
            get_item_media_cmd,
            get_lan_connection_info_cmd,
            save_media_to_downloads_cmd,
            open_file_in_folder_cmd,
            check_and_process_pending_shares_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running omnivault application");
}
