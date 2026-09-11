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
}

#[tauri::command]
fn get_system_status() -> String {
    "OmniVault Core Ready".into()
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
    _state: State<AppState>,
    media_url_or_hash: String,
    suggested_filename: Option<String>,
) -> Result<String, String> {
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

    let clean_name = if base_name.to_lowercase().ends_with(".webp") {
        base_name
    } else {
        format!("{}.webp", base_name)
    };

    let mut dest_path = downloads_dir.join(&clean_name);
    let mut counter = 1;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let db_path = base_dir.join("omnivault.db");

    let mut conn = Connection::open(&db_path)
        .or_else(|_| Connection::open("omnivault.db"))
        .or_else(|_| Connection::open_in_memory())
        .expect("failed to open database");
    schema::initialize_schema(&conn).expect("failed to init schema");
    let device_id = storage::get_or_create_device_id(&conn).expect("failed to get device_id");
    let _ = storage::seed_defaults_if_empty(&mut conn, &device_id);

    let db = Arc::new(Mutex::new(conn));

    // Start embedded HTTP server on background thread (default port 42420)
    let server_port = match http_server::start_http_server(db.clone(), device_id.clone(), 42420) {
        Ok(handle) => handle.port,
        Err(err) => {
            eprintln!("Warning: Failed to start embedded http server: {err}");
            42420
        }
    };

    let state = AppState {
        db: db.clone(),
        device_id,
        server_port,
        base_dir,
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_system_status,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running omnivault application");
}
