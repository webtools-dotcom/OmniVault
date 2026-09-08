use std::sync::Mutex;
use rusqlite::Connection;
use tauri::State;

pub mod db;
pub mod sync;

use crate::db::models::{Folder, VaultItem};
use crate::db::schema;
use crate::db::storage;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub device_id: String,
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
fn delete_item_cmd(state: State<AppState>, id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    storage::delete_item(&mut conn, &id, &state.device_id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = Connection::open("omnivault.db")
        .or_else(|_| Connection::open_in_memory())
        .expect("failed to open database");
    schema::initialize_schema(&conn).expect("failed to init schema");
    let device_id = storage::get_or_create_device_id(&conn).expect("failed to get device_id");

    let state = AppState {
        db: Mutex::new(conn),
        device_id,
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
            delete_item_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running omnivault application");
}
