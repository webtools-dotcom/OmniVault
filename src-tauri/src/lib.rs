pub mod db;

#[tauri::command]
fn get_system_status() -> String {
    "OmniVault Core Ready".into()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_system_status])
        .run(tauri::generate_context!())
        .expect("error while running omnivault application");
}
