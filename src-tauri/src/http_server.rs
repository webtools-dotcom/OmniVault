use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db::models::VaultItem;
use crate::db::storage;

/// Returns the preferred local non-loopback IPv4 address on the active LAN/Wi-Fi interface.
pub fn get_local_lan_ip() -> String {
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(local_addr) = socket.local_addr() {
                let ip = local_addr.ip();
                if !ip.is_loopback() {
                    return ip.to_string();
                }
            }
        }
    }
    "127.0.0.1".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LanConnectionInfo {
    pub ip: String,
    pub port: u16,
    pub url: String,
}

pub fn get_lan_connection_info(port: u16) -> LanConnectionInfo {
    let ip = get_local_lan_ip();
    let url = format!("http://{}:{}", ip, port);
    LanConnectionInfo { ip, port, url }
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub app: &'static str,
    pub version: &'static str,
    pub device_id: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateItemRequest {
    pub folder_id: Option<String>,
    #[serde(default = "default_item_type")]
    pub item_type: String,
    pub title: String,
    pub content: String,
    pub metadata: Option<String>,
}

fn default_item_type() -> String {
    "note".to_string()
}

/// Discovers the compiled frontend static directory (`dist/`).
pub fn find_dist_dir() -> Option<PathBuf> {
    let candidates = ["dist", "../dist", "../../dist"];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.exists() && path.is_dir() && path.join("index.html").exists() {
            return Some(path);
        }
    }
    None
}

/// Determines the Content-Type header based on file extension.
fn get_mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

pub struct HttpServerHandle {
    pub port: u16,
    pub stop_sender: Sender<()>,
}

/// Spawns the embedded HTTP server on a background thread.
pub fn start_http_server(
    db: Arc<Mutex<Connection>>,
    device_id: String,
    preferred_port: u16,
) -> std::io::Result<HttpServerHandle> {
    let (listener, actual_port) = bind_listener(preferred_port)?;
    listener.set_nonblocking(true)?;

    let (stop_sender, stop_receiver) = channel::<()>();
    let dist_dir = find_dist_dir();

    thread::spawn(move || {
        run_server_loop(listener, stop_receiver, db, device_id, dist_dir);
    });

    Ok(HttpServerHandle {
        port: actual_port,
        stop_sender,
    })
}

fn bind_listener(preferred_port: u16) -> std::io::Result<(TcpListener, u16)> {
    if preferred_port > 0 {
        if let Ok(listener) = TcpListener::bind(format!("0.0.0.0:{}", preferred_port)) {
            let port = listener.local_addr()?.port();
            return Ok((listener, port));
        }
        for p in (preferred_port + 1)..(preferred_port + 10) {
            if let Ok(listener) = TcpListener::bind(format!("0.0.0.0:{}", p)) {
                let port = listener.local_addr()?.port();
                return Ok((listener, port));
            }
        }
    }
    let listener = TcpListener::bind("0.0.0.0:0")?;
    let port = listener.local_addr()?.port();
    Ok((listener, port))
}

fn run_server_loop(
    listener: TcpListener,
    stop_receiver: Receiver<()>,
    db: Arc<Mutex<Connection>>,
    device_id: String,
    dist_dir: Option<PathBuf>,
) {
    loop {
        // Check for shutdown signal
        if stop_receiver.try_recv().is_ok() {
            break;
        }

        match listener.accept() {
            Ok((stream, _addr)) => {
                let db_clone = db.clone();
                let dev_id_clone = device_id.clone();
                let dist_clone = dist_dir.clone();

                thread::spawn(move || {
                    let _ = handle_connection(stream, db_clone, &dev_id_clone, dist_clone.as_deref());
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(20));
            }
            Err(_) => {
                break;
            }
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    db: Arc<Mutex<Connection>>,
    device_id: &str,
    dist_dir: Option<&Path>,
) -> std::io::Result<()> {
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }

    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(());
    }

    let method = parts[0];
    let raw_target = parts[1];

    let (path, query) = if let Some(idx) = raw_target.find('?') {
        (&raw_target[..idx], Some(&raw_target[idx + 1..]))
    } else {
        (raw_target, None)
    };

    // Parse headers
    let mut headers = HashMap::new();
    let mut content_length: usize = 0;

    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            let key = k.trim().to_lowercase();
            let val = v.trim().to_string();
            if key == "content-length" {
                if let Ok(len) = val.parse::<usize>() {
                    content_length = len;
                }
            }
            headers.insert(key, val);
        }
    }

    // Read body if Content-Length specified
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    // Preflight CORS OPTIONS
    if method == "OPTIONS" {
        send_response(
            &mut stream,
            204,
            "No Content",
            "text/plain",
            b"",
            &[("Access-Control-Max-Age", "86400")],
        )?;
        return Ok(());
    }

    // API Routes
    if path == "/api/health" {
        let resp = HealthResponse {
            status: "ok",
            app: "OmniVault",
            version: "0.1.0",
            device_id: device_id.to_string(),
        };
        let json = serde_json::to_vec(&resp).unwrap_or_default();
        send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
        return Ok(());
    }

    if path == "/api/lan-info" {
        let info = get_lan_connection_info(stream.local_addr()?.port());
        let json = serde_json::to_vec(&info).unwrap_or_default();
        send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
        return Ok(());
    }

    if path == "/api/folders" {
        if method == "GET" {
            let conn = db.lock().unwrap();
            let folders = storage::list_folders(&conn, false).unwrap_or_default();
            let json = serde_json::to_vec(&folders).unwrap_or_default();
            send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
            return Ok(());
        } else if method == "POST" {
            if let Ok(req) = serde_json::from_slice::<CreateFolderRequest>(&body) {
                let mut conn = db.lock().unwrap();
                match storage::create_folder(
                    &mut conn,
                    &req.name,
                    req.parent_id.as_deref(),
                    req.color.as_deref(),
                    device_id,
                ) {
                    Ok(folder) => {
                        let json = serde_json::to_vec(&folder).unwrap_or_default();
                        send_response(&mut stream, 201, "Created", "application/json", &json, &[])?;
                    }
                    Err(e) => {
                        let err_json = serde_json::json!({ "error": e.to_string() });
                        send_response(
                            &mut stream,
                            400,
                            "Bad Request",
                            "application/json",
                            &err_json.to_string().into_bytes(),
                            &[],
                        )?;
                    }
                }
                return Ok(());
            }
        }
    }

    if path == "/api/items/inbox" || path == "/api/items" {
        if method == "GET" {
            let conn = db.lock().unwrap();
            let folder_id = query.and_then(|q| {
                for pair in q.split('&') {
                    if let Some((k, v)) = pair.split_once('=') {
                        if k == "folder_id" && !v.is_empty() {
                            return Some(v.to_string());
                        }
                    }
                }
                None
            });

            let items: Vec<VaultItem> = if let Some(fid) = folder_id {
                storage::list_items_by_folder(&conn, &fid).unwrap_or_default()
            } else {
                storage::list_inbox_items(&conn).unwrap_or_default()
            };

            let json = serde_json::to_vec(&items).unwrap_or_default();
            send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
            return Ok(());
        } else if method == "POST" {
            if let Ok(req) = serde_json::from_slice::<CreateItemRequest>(&body) {
                let mut conn = db.lock().unwrap();
                match storage::create_item(
                    &mut conn,
                    req.folder_id.as_deref(),
                    &req.item_type,
                    &req.title,
                    &req.content,
                    req.metadata.as_deref(),
                    device_id,
                ) {
                    Ok(item) => {
                        let json = serde_json::to_vec(&item).unwrap_or_default();
                        send_response(&mut stream, 201, "Created", "application/json", &json, &[])?;
                    }
                    Err(e) => {
                        let err_json = serde_json::json!({ "error": e.to_string() });
                        send_response(
                            &mut stream,
                            400,
                            "Bad Request",
                            "application/json",
                            &err_json.to_string().into_bytes(),
                            &[],
                        )?;
                    }
                }
                return Ok(());
            }
        }
    }

    // Media Serving: /media/<hash> or /api/media/<hash>
    let media_prefix = if path.starts_with("/api/media/") {
        Some(&path["/api/media/".len()..])
    } else if path.starts_with("/media/") {
        Some(&path["/media/".len()..])
    } else {
        None
    };

    if let Some(media_hash) = media_prefix {
        let clean_hash = media_hash.trim_end_matches(".webp");
        let media_path = PathBuf::from("media").join(format!("{}.webp", clean_hash));
        if media_path.exists() {
            if let Ok(bytes) = fs::read(&media_path) {
                send_response(&mut stream, 200, "OK", "image/webp", &bytes, &[])?;
                return Ok(());
            }
        }
        send_response(
            &mut stream,
            404,
            "Not Found",
            "text/plain",
            b"Media not found",
            &[],
        )?;
        return Ok(());
    }

    // Static Assets & SPA Fallback Serving
    if let Some(dist) = dist_dir {
        let relative_path = path.trim_start_matches('/');
        let target_file = if relative_path.is_empty() {
            dist.join("index.html")
        } else {
            dist.join(relative_path)
        };

        if target_file.exists() && target_file.is_file() {
            if let Ok(bytes) = fs::read(&target_file) {
                let mime = get_mime_type(&target_file);
                send_response(&mut stream, 200, "OK", mime, &bytes, &[])?;
                return Ok(());
            }
        }

        // SPA Fallback: Serve index.html for all client-side routes
        let fallback_index = dist.join("index.html");
        if fallback_index.exists() {
            if let Ok(bytes) = fs::read(&fallback_index) {
                send_response(&mut stream, 200, "OK", "text/html; charset=utf-8", &bytes, &[])?;
                return Ok(());
            }
        }
    }

    // Built-in Static Welcome Page Fallback if dist/ not yet generated
    let fallback_html = br#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>OmniVault</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { background: #0D1117; color: #F0F6FC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #161B22; border: 1px solid #30363D; border-radius: 16px; padding: 2.5rem 2rem; max-width: 480px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; color: #58A6FF; }
    p { margin: 0 0 1.25rem 0; color: #8B949E; font-size: 0.875rem; line-height: 1.5; }
    .badge { display: inline-block; background: rgba(56, 139, 253, 0.15); border: 1px solid rgba(56, 139, 253, 0.4); color: #58A6FF; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 9999px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Local Mesh Server Active</div>
    <h1>OmniVault</h1>
    <p>Private, local-first cross-device sync workspace.<br>Desktop core is running and ready for LAN connections.</p>
  </div>
</body>
</html>"#;

    send_response(
        &mut stream,
        200,
        "OK",
        "text/html; charset=utf-8",
        fallback_html,
        &[],
    )?;

    Ok(())
}

fn send_response(
    stream: &mut TcpStream,
    status_code: u16,
    status_text: &str,
    content_type: &str,
    body: &[u8],
    extra_headers: &[(&str, &str)],
) -> std::io::Result<()> {
    let mut header_str = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
         Connection: close\r\n",
        status_code,
        status_text,
        content_type,
        body.len()
    );

    for (k, v) in extra_headers {
        header_str.push_str(&format!("{}: {}\r\n", k, v));
    }
    header_str.push_str("\r\n");

    stream.write_all(header_str.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn setup_test_db() -> (Arc<Mutex<Connection>>, String) {
        let conn = Connection::open_in_memory().unwrap();
        schema::initialize_schema(&conn).unwrap();
        let device_id = storage::get_or_create_device_id(&conn).unwrap();
        (Arc::new(Mutex::new(conn)), device_id)
    }

    #[test]
    fn test_lan_ip_resolution() {
        let ip = get_local_lan_ip();
        assert!(!ip.is_empty(), "LAN IP should not be empty");
        let info = get_lan_connection_info(42420);
        assert_eq!(info.port, 42420);
        assert!(info.url.starts_with("http://"));
    }

    #[test]
    fn test_http_server_endpoints() {
        let (db, device_id) = setup_test_db();
        let handle = start_http_server(db, device_id, 0).expect("failed to start server");
        let port = handle.port;

        // 1. Test GET /api/health
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("200 OK"));
        assert!(resp.contains("\"status\":\"ok\""));
        assert!(resp.contains("OmniVault"));

        // 2. Test GET /api/lan-info
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /api/lan-info HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("200 OK"));
        assert!(resp.contains("\"port\":"));

        // 3. Test POST /api/folders
        let folder_payload = br##"{"name":"Mobile Research","parent_id":null,"color":"#58A6FF"}"##;
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        let req = format!(
            "POST /api/folders HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            folder_payload.len(),
            std::str::from_utf8(folder_payload).unwrap()
        );
        stream.write_all(req.as_bytes()).unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("201 Created"));
        assert!(resp.contains("Mobile Research"));

        // 4. Test POST /api/items (Inbox Capture)
        let item_payload = br#"{"title":"Quick phone idea","content":"NVDA setup at 140","item_type":"ticker","folder_id":null}"#;
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        let req = format!(
            "POST /api/items HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            item_payload.len(),
            std::str::from_utf8(item_payload).unwrap()
        );
        stream.write_all(req.as_bytes()).unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("201 Created"));
        assert!(resp.contains("Quick phone idea"));

        // 5. Test GET /api/items/inbox
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /api/items/inbox HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("200 OK"));
        assert!(resp.contains("Quick phone idea"));

        // 6. Test Static Fallback (SPA routing)
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /some/custom/path HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("200 OK"));
        assert!(resp.contains("text/html"));

        // Clean shutdown
        let _ = handle.stop_sender.send(());
    }
}
