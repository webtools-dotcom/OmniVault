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

use crate::db::media;
use crate::db::models::VaultItem;
use crate::db::storage;

thread_local! {
    /// CORS origin permitted for the request currently being handled on this
    /// thread, or None when the caller's Origin is not recognised.
    ///
    /// This is a thread-local rather than a parameter because `send_response`
    /// has 60 call sites; threading an argument through all of them would make
    /// the security change impossible to review. It is sound here because
    /// `run_server_loop` spawns exactly one thread per connection and
    /// `handle_connection` sets this once, before any response is written.
    static CORS_ALLOW_ORIGIN: std::cell::RefCell<Option<String>> =
        const { std::cell::RefCell::new(None) };
}

/// Ceiling on concurrently handled connections.
///
/// The accept loop spawns one thread per connection. Unbounded, a caller on the
/// LAN could open sockets faster than they complete and exhaust threads and
/// memory — the listener is on 0.0.0.0, so this needs no credentials to attempt.
/// Excess connections are closed immediately rather than queued. See D-061.
const MAX_CONCURRENT_CONNECTIONS: usize = 64;
static LIVE_CONNECTIONS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Decrements the live-connection count when a handler thread ends, however it ends.
struct ConnectionSlot;
impl Drop for ConnectionSlot {
    fn drop(&mut self) {
        LIVE_CONNECTIONS.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Whether this device serves the browser client (the SPA and its assets).
///
/// The sync API always listens, because mesh sync reaches a peer on this very
/// port — turning the listener off entirely would disable the product's core
/// feature rather than harden it. What is optional is serving a *browser* a UI,
/// which is the surface that makes a hand-written HTTP parser face unknown
/// clients. Off by default; see D-059.
static BROWSER_ACCESS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_browser_access(enabled: bool) {
    BROWSER_ACCESS.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

pub fn browser_access_enabled() -> bool {
    BROWSER_ACCESS.load(std::sync::atomic::Ordering::Relaxed)
}

/// Failed pairing attempts per source address, as (count, window_start_ms).
static PAIR_ATTEMPTS: std::sync::OnceLock<Mutex<HashMap<std::net::IpAddr, (u32, i64)>>> =
    std::sync::OnceLock::new();

/// How many wrong PINs one address may submit inside `PAIR_WINDOW_MS`.
const PAIR_MAX_ATTEMPTS: u32 = 5;
const PAIR_WINDOW_MS: i64 = 60_000;

fn pair_attempts(
) -> std::sync::MutexGuard<'static, HashMap<std::net::IpAddr, (u32, i64)>> {
    lock_recover(PAIR_ATTEMPTS.get_or_init(|| Mutex::new(HashMap::new())))
}

/// True once an address has burned its budget of wrong PINs for this window.
///
/// Without this the 900,000-value PIN space is walkable inside a session's
/// 120-second lifetime, which makes the length of the PIN irrelevant.
fn pair_attempts_exhausted(ip: std::net::IpAddr, now: i64) -> bool {
    let mut map = pair_attempts();
    match map.get(&ip) {
        Some(&(count, started)) if now - started < PAIR_WINDOW_MS => count >= PAIR_MAX_ATTEMPTS,
        Some(_) => {
            map.remove(&ip);
            false
        }
        None => false,
    }
}

fn record_failed_pair_attempt(ip: std::net::IpAddr, now: i64) {
    let mut map = pair_attempts();
    let entry = map.entry(ip).or_insert((0, now));
    if now - entry.1 >= PAIR_WINDOW_MS {
        *entry = (0, now);
    }
    entry.0 += 1;
}

fn clear_pair_attempts(ip: std::net::IpAddr) {
    pair_attempts().remove(&ip);
}

/// Locks a mutex, recovering from poisoning rather than aborting the process.
///
/// The release profile sets `panic = "abort"` (D-030), so a panic on any
/// connection thread kills the whole application. A panic while a lock is held
/// also poisons it, which would turn every later request into a second abort —
/// one bad request could take the app down and keep it down. Recovering the
/// inner value keeps the server answering; the data behind these locks is
/// SQLite handles and a pairing session, neither of which is left in a
/// half-written state by a panicking request handler.
fn lock_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The desktop webview's own origins. Matched exactly: a suffix test would also
/// accept `http://evil.tauri.localhost`, which a caller can obtain simply by
/// sending a matching Host header.
const TAURI_ORIGINS: [&str; 3] = [
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
];

/// Decides which origin, if any, may read this response.
///
/// Same-origin callers are matched against the request's own `Host` header so
/// the tablet browser works on any LAN address without hardcoding one. The
/// Tauri origins are the desktop app's webview, which uploads media
/// cross-origin to 127.0.0.1 and would otherwise fail its CORS preflight.
fn allowed_cors_origin(origin: Option<&str>, host: Option<&str>) -> Option<String> {
    let origin = origin?.trim();
    if origin.is_empty() {
        return None;
    }

    if TAURI_ORIGINS.contains(&origin) {
        return Some(origin.to_string());
    }

    if let Some(host) = host {
        let host = host.trim();
        if !host.is_empty()
            && (origin == format!("http://{}", host) || origin == format!("https://{}", host))
        {
            return Some(origin.to_string());
        }
    }

    None
}

/// Routes reachable without a token. `/api/pair` is the handshake that issues
/// tokens, so requiring one would make pairing impossible; the other two return
/// nothing the caller does not already know.
const PUBLIC_API_ROUTES: [&str; 3] = ["/api/health", "/api/lan-info", "/api/pair"];

/// Pulls the caller's device id and token from either the `x-device-id` /
/// `x-auth-token` headers or the `device_id` / `auth_token` query parameters.
///
/// The query-string form exists because media URLs are consumed by `<img src>`,
/// which cannot set headers. It is accepted for every route rather than only
/// media so that one rule covers all callers.
fn extract_caller_credentials(
    headers: &HashMap<String, String>,
    query: Option<&str>,
) -> (Option<String>, Option<String>) {
    let mut device_id = headers.get("x-device-id").cloned();
    let mut token = headers.get("x-auth-token").cloned();

    if let Some(q) = query {
        for pair in q.split('&') {
            match pair.split_once('=') {
                Some(("device_id", v)) if device_id.is_none() && !v.is_empty() => {
                    device_id = Some(v.to_string());
                }
                Some(("auth_token", v)) if token.is_none() && !v.is_empty() => {
                    token = Some(v.to_string());
                }
                _ => {}
            }
        }
    }

    (device_id, token)
}

/// How good an address is as something to hand to another device.
///
/// Link-local (169.254.x) is what Windows assigns an interface whose DHCP
/// request went unanswered, and a machine can carry several at once — this
/// developer's laptop has four alongside one real address. They are ranked
/// below a genuine private address so a dead adapter never wins, but kept above
/// nothing at all, because a direct cable between two machines uses them.
fn address_rank(ip: std::net::Ipv4Addr) -> u8 {
    if ip.is_private() {
        2
    } else if ip.is_link_local() {
        1
    } else {
        0
    }
}

/// Returns this machine's address on the network it is currently attached to,
/// or `None` when it is not on one.
///
/// This asks the routing table which local address would be used to reach a
/// given destination, by opening a UDP socket and connecting it — which sends
/// nothing, it only forces a route lookup.
///
/// It used to ask that question about `8.8.8.8` alone, so an app whose whole
/// premise is that it needs no internet could only find its own address when it
/// had one. On a phone hotspot with mobile data off, or any network without a
/// default route, the lookup failed and the caller fell back to `127.0.0.1` —
/// and a loopback address handed to a phone points the phone at itself, which
/// is why the page "kept reloading" and never connected. The private ranges are
/// tried too, so the answer comes from the network in the room rather than from
/// the existence of an internet connection. See D-081.
pub fn find_local_lan_ip() -> Option<String> {
    // The internet route first: on an ordinary Wi-Fi network it gives the right
    // interface immediately. The private ranges cover the case with no internet.
    const PROBES: [&str; 4] = [
        "8.8.8.8:80",
        "192.168.0.1:9",
        "10.0.0.1:9",
        "172.16.0.1:9",
    ];

    let mut best: Option<(u8, String)> = None;

    for probe in PROBES {
        let socket = match UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(_) => continue,
        };
        if socket.connect(probe).is_err() {
            continue;
        }
        let ip = match socket.local_addr() {
            Ok(a) => a.ip(),
            Err(_) => continue,
        };
        if ip.is_loopback() || ip.is_unspecified() {
            continue;
        }
        let rank = match ip {
            std::net::IpAddr::V4(v4) => address_rank(v4),
            // The mesh and this server are IPv4 throughout, so a v6 answer is
            // no use to the device being handed the address.
            std::net::IpAddr::V6(_) => continue,
        };
        // A real private address ends the search; anything weaker is held in
        // case nothing better turns up.
        if rank == 2 {
            return Some(ip.to_string());
        }
        if best.as_ref().map(|(r, _)| rank > *r).unwrap_or(true) {
            best = Some((rank, ip.to_string()));
        }
    }

    best.map(|(_, ip)| ip)
}

/// Returns the preferred local non-loopback IPv4 address on the active LAN/Wi-Fi interface.
///
/// Callers that need to tell the difference between "this machine is at X" and
/// "this machine is not on a network" should use [`find_local_lan_ip`]; this
/// keeps the old loopback answer for the places that just need a string.
pub fn get_local_lan_ip() -> String {
    find_local_lan_ip().unwrap_or_else(|| "127.0.0.1".to_string())
}

/// How long a paired device counts as present after it was last heard from.
///
/// Mesh peers expire from discovery on their own; a browser client is only
/// visible while it is making requests, and a person reading a note makes none.
/// Ninety seconds is long enough to survive that quiet and short enough that a
/// device carried out of the house stops being reported as here.
pub const DEVICE_PRESENCE_WINDOW_MS: i64 = 90_000;

/// The devices that are actually present: mesh peers discovered over UDP, plus
/// paired devices that have made a request recently, counted once each.
///
/// This exists because the two surfaces used to answer the question from two
/// different sources and disagree on screen. The sidebar read live mesh peers
/// and said "No devices yet"; the browser fell back to the number of rows in
/// `paired_devices` and said "Synced (5)", which was five pairings accumulated
/// over weeks of testing rather than five devices in the room. See D-082.
pub fn present_device_ids(
    conn: &Connection,
    mesh_peers: &[crate::sync::discovery::PeerInfo],
) -> Vec<String> {
    let now = chrono::Utc::now().timestamp_millis();
    let mut ids: Vec<String> = mesh_peers.iter().map(|p| p.device_id.clone()).collect();
    if let Ok(paired) = crate::sync::pairing::list_paired_devices(conn) {
        for device in paired {
            let recent = device
                .last_sync_at
                .map(|seen| now.saturating_sub(seen) < DEVICE_PRESENCE_WINDOW_MS)
                .unwrap_or(false);
            if recent && !ids.contains(&device.device_id) {
                ids.push(device.device_id);
            }
        }
    }
    ids
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LanConnectionInfo {
    pub ip: String,
    pub port: u16,
    pub url: String,
    /// False when this machine is not on a network another device could reach.
    /// The UI must not offer an address to scan in that case: a loopback URL
    /// sends the phone to itself and looks like the app is broken.
    pub reachable: bool,
}

pub fn get_lan_connection_info(port: u16) -> LanConnectionInfo {
    match find_local_lan_ip() {
        Some(ip) => {
            let url = format!("http://{}:{}", ip, port);
            LanConnectionInfo { ip, port, url, reachable: true }
        }
        None => LanConnectionInfo {
            ip: "127.0.0.1".to_string(),
            port,
            url: format!("http://127.0.0.1:{}", port),
            reachable: false,
        },
    }
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

#[derive(Debug, Deserialize)]
pub struct IdRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct RenameFolderRequest {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct MoveFolderRequest {
    pub id: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MoveItemRequest {
    pub id: String,
    pub folder_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateItemRequest {
    pub id: String,
    pub title: String,
    pub content: String,
    pub metadata: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PairRequest {
    pub pin: String,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MediaUploadRequest {
    pub item_id: Option<String>,
    pub folder_id: Option<String>,
    pub title: Option<String>,
    pub data: Option<String>,
    pub base64: Option<String>,
}

/// Robust base64 decoder supporting data-URL prefixes and padding.
pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let clean = input.trim();
    let clean = if let Some(idx) = clean.find(',') {
        &clean[idx + 1..]
    } else {
        clean
    };
    let mut clean = clean.replace(['\r', '\n', ' ', '\t'], "");

    fn char_val(c: u8) -> Result<u8, String> {
        match c {
            b'A'..=b'Z' => Ok(c - b'A'),
            b'a'..=b'z' => Ok(c - b'a' + 26),
            b'0'..=b'9' => Ok(c - b'0' + 52),
            b'+' | b'-' => Ok(62),
            b'/' | b'_' => Ok(63),
            b'=' => Ok(0),
            _ => Err(format!("Invalid base64 character: {}", c as char)),
        }
    }

    if clean.is_empty() {
        return Ok(Vec::new());
    }

    // Modern browsers and canvas data URLs may omit trailing '=' padding.
    // Pad clean string with '=' until its length is a multiple of 4.
    let remainder = clean.len() % 4;
    if remainder != 0 {
        let pad_needed = 4 - remainder;
        clean.extend(std::iter::repeat('=').take(pad_needed));
    }

    let bytes = clean.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks_exact(4) {
        let b0 = char_val(chunk[0])?;
        let b1 = char_val(chunk[1])?;
        let b2 = char_val(chunk[2])?;
        let b3 = char_val(chunk[3])?;

        let triple = ((b0 as u32) << 18) | ((b1 as u32) << 12) | ((b2 as u32) << 6) | (b3 as u32);
        out.push(((triple >> 16) & 0xFF) as u8);
        if chunk[2] != b'=' {
            out.push(((triple >> 8) & 0xFF) as u8);
        }
        if chunk[3] != b'=' {
            out.push((triple & 0xFF) as u8);
        }
    }
    Ok(out)
}

pub fn get_storage_base_dir() -> PathBuf {
    crate::resolve_app_base_dir()
}

pub fn find_media_file(clean_hash: &str, dist_dir: Option<&Path>) -> Option<PathBuf> {
    // Path traversal defense: clean_hash must strictly be non-empty ASCII alphanumeric, hyphen, or underscore
    if clean_hash.is_empty()
        || clean_hash.contains("..")
        || clean_hash.contains('/')
        || clean_hash.contains('\\')
        || !clean_hash.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }

    let filename = format!("{}.webp", clean_hash);
    let mut candidates = Vec::new();

    let base_dir = get_storage_base_dir();
    candidates.push(base_dir.join("media").join(&filename));
    candidates.push(PathBuf::from("media").join(&filename));
    candidates.push(PathBuf::from("release").join("media").join(&filename));

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("media").join(&filename));
            if let Some(p2) = parent.parent() {
                candidates.push(p2.join("media").join(&filename));
                candidates.push(p2.join("release").join("media").join(&filename));
            }
        }
    }

    if let Some(dist) = dist_dir {
        if let Some(parent) = dist.parent() {
            candidates.push(parent.join("media").join(&filename));
        }
    }

    for candidate in candidates {
        if candidate.is_file() && candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// Discovers the compiled frontend static directory (`dist/`).
pub fn find_dist_dir() -> Option<PathBuf> {
    // 1. Check relative to current running executable (traversing up to 8 parent levels)
    if let Ok(exe) = std::env::current_exe() {
        let mut curr = exe.parent();
        for _ in 0..8 {
            if let Some(dir) = curr {
                let direct = dir.join("dist");
                if direct.is_dir() && direct.join("index.html").exists() {
                    return Some(direct);
                }
                let release_dist = dir.join("release").join("dist");
                if release_dist.is_dir() && release_dist.join("index.html").exists() {
                    return Some(release_dist);
                }
                curr = dir.parent();
            } else {
                break;
            }
        }
    }

    // 2. Check relative to current working directory (traversing up to 8 parent levels)
    if let Ok(cwd) = std::env::current_dir() {
        let mut curr = Some(cwd.as_path());
        for _ in 0..8 {
            if let Some(dir) = curr {
                let direct = dir.join("dist");
                if direct.is_dir() && direct.join("index.html").exists() {
                    return Some(direct);
                }
                let release_dist = dir.join("release").join("dist");
                if release_dist.is_dir() && release_dist.join("index.html").exists() {
                    return Some(release_dist);
                }
                curr = dir.parent();
            } else {
                break;
            }
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
    /// Shared with the server thread so the desktop app can issue a pairing PIN
    /// locally over IPC. The PIN is never served over HTTP — see D-051.
    pub pairing_session: Arc<Mutex<Option<ActivePairingSession>>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ActivePairingSession {
    pub pin: String,
    pub expires_at: i64,
}

/// Spawns the embedded HTTP server on a background thread.
pub fn start_http_server(
    db: Arc<Mutex<Connection>>,
    device_id: String,
    preferred_port: u16,
) -> std::io::Result<HttpServerHandle> {
    start_http_server_with_peers(db, device_id, preferred_port, None)
}

pub fn start_http_server_with_peers(
    db: Arc<Mutex<Connection>>,
    device_id: String,
    preferred_port: u16,
    peer_registry: Option<crate::sync::discovery::PeerRegistry>,
) -> std::io::Result<HttpServerHandle> {
    let (listener, actual_port) = bind_listener(preferred_port)?;
    listener.set_nonblocking(true)?;

    let (stop_sender, stop_receiver) = channel::<()>();
    let dist_dir = find_dist_dir();
    let pairing_session = Arc::new(Mutex::new(None));
    let pairing_session_for_thread = pairing_session.clone();

    thread::spawn(move || {
        run_server_loop(listener, stop_receiver, db, device_id, dist_dir, pairing_session_for_thread, peer_registry);
    });

    Ok(HttpServerHandle {
        port: actual_port,
        stop_sender,
        pairing_session,
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
    pairing_session: Arc<Mutex<Option<ActivePairingSession>>>,
    peer_registry: Option<crate::sync::discovery::PeerRegistry>,
) {
    loop {
        // Check for shutdown signal
        if stop_receiver.try_recv().is_ok() {
            break;
        }

        match listener.accept() {
            Ok((stream, _addr)) => {
                // Refuse rather than queue: a queue under flood is just a
                // slower way to run out of memory.
                if LIVE_CONNECTIONS.load(std::sync::atomic::Ordering::SeqCst)
                    >= MAX_CONCURRENT_CONNECTIONS
                {
                    drop(stream);
                    continue;
                }
                LIVE_CONNECTIONS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

                let db_clone = db.clone();
                let dev_id_clone = device_id.clone();
                let dist_clone = dist_dir.clone();
                let pair_clone = pairing_session.clone();
                let reg_clone = peer_registry.clone();

                thread::spawn(move || {
                    // Released even if the handler panics or returns early.
                    let _slot = ConnectionSlot;
                    let _ = handle_connection(stream, db_clone, &dev_id_clone, dist_clone.as_deref(), pair_clone, reg_clone);
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
    pairing_session: Arc<Mutex<Option<ActivePairingSession>>>,
    peer_registry: Option<crate::sync::discovery::PeerRegistry>,
) -> std::io::Result<()> {
    // Windows inherits non-blocking mode from the listener to accepted streams.
    // Explicitly restore blocking mode with timeouts so multi-packet LAN requests
    // and large static asset streaming do not abort with WouldBlock.
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(15)));

    let dist_fallback;
    let dist_dir = match dist_dir {
        Some(d) => Some(d),
        None => {
            dist_fallback = find_dist_dir();
            dist_fallback.as_deref()
        }
    };

    let mut reader = BufReader::new(&stream);
    // Bounded like the header lines below. Reading this unbounded let a caller
    // on the LAN grow the buffer without limit by sending a long request line
    // and never a newline — memory exhaustion from one socket. See D-061.
    let mut request_line = String::new();
    if (&mut reader).take(8192).read_line(&mut request_line)? == 0 {
        return Ok(());
    }
    if request_line.len() >= 8192 && !request_line.ends_with('\n') {
        send_response(
            &mut stream,
            414,
            "URI Too Long",
            "text/plain",
            b"Request line too long",
            &[],
        )?;
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

    // Parse headers with strict limits: max 100 headers, max 8KB per header line
    let mut headers = HashMap::new();
    let mut content_length: usize = 0;
    let mut header_count = 0;

    loop {
        let mut line = String::new();
        let bytes_read = (&mut reader).take(8192).read_line(&mut line)?;
        if bytes_read == 0 {
            break;
        }
        if line.len() >= 8192 && !line.ends_with('\n') {
            send_response(
                &mut stream,
                431,
                "Request Header Fields Too Large",
                "text/plain",
                b"Request Header Fields Too Large",
                &[],
            )?;
            return Ok(());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        header_count += 1;
        if header_count > 100 {
            send_response(
                &mut stream,
                431,
                "Request Header Fields Too Large",
                "text/plain",
                b"Too many request headers",
                &[],
            )?;
            return Ok(());
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

    // Decide CORS before any response can be written on this thread.
    let cors_origin = allowed_cors_origin(
        headers.get("origin").map(|s| s.as_str()),
        headers.get("host").map(|s| s.as_str()),
    );
    CORS_ALLOW_ORIGIN.with(|slot| {
        *slot.borrow_mut() = cors_origin.clone();
    });

    // Authorize API access. Static assets stay public so a tablet can load the
    // page in order to pair; only vault data is gated.
    if path.starts_with("/api/") && !PUBLIC_API_ROUTES.contains(&path) {
        // The desktop app's own webview talks to 127.0.0.1 and has no pairing
        // token for itself. A browser cannot forge Origin, so a hostile page
        // cannot use this path; a local native process could, but it can already
        // read the SQLite file directly, so nothing is lost by allowing it.
        let from_loopback = stream
            .peer_addr()
            .map(|a| a.ip().is_loopback())
            .unwrap_or(false);

        let is_desktop_self = from_loopback
            && cors_origin
                .as_deref()
                .map(|o| TAURI_ORIGINS.contains(&o))
                .unwrap_or(false);

        // A plain `<img src>` is a no-CORS request, so the browser sends no
        // `Origin` header at all - which meant the app's own webview, desktop and
        // Android alike, was answered 401 for every one of its own pictures. Only
        // freshly captured images rendered, because those are still in the
        // in-memory cache; everything older showed a broken thumbnail. Reading a
        // blob back over loopback exposes nothing a local process could not get
        // from the media folder directly, and a foreign page still cannot read
        // the pixels: it would need the 64-hex hash and it gets no CORS grant.
        let is_local_media_read =
            from_loopback && method == "GET" && path.starts_with("/api/media/");

        if !is_desktop_self && !is_local_media_read {
            let (caller_id, caller_token) = extract_caller_credentials(&headers, query);
            // Absent credentials are a rejection, never a skipped check.
            let authorized = match (caller_id.as_deref(), caller_token.as_deref()) {
                (Some(id), Some(tok)) => {
                    let conn = lock_recover(&db);
                    let ok = crate::sync::pairing::validate_peer_auth_token(&conn, id, tok)
                        .unwrap_or(false);
                    // A paired device talking to this server is a device that
                    // is here now. Without recording that, a tablet using the
                    // vault through a browser left no trace at all and the
                    // desktop kept saying "No devices yet" while it was plainly
                    // in use. Mesh peers announce themselves over UDP; browser
                    // clients only ever arrive as HTTP requests, so this is the
                    // only place their presence can be observed. See D-082.
                    if ok {
                        let _ = crate::sync::pairing::update_peer_last_sync(&conn, id);
                    }
                    ok
                }
                _ => false,
            };

            if !authorized {
                let err = serde_json::json!({ "error": "Unauthorized: pair this device first" });
                send_response(
                    &mut stream,
                    401,
                    "Unauthorized",
                    "application/json",
                    &err.to_string().into_bytes(),
                    &[],
                )?;
                return Ok(());
            }
        }
    }

    // Enforce Content-Length bounds: max 50MB for media upload, max 2MB for standard endpoints
    let max_allowed_body = if path == "/api/vault/restore" {
        crate::db::import::MAX_ARCHIVE_BYTES
    } else if path == "/api/media/upload" || path == "/api/media" {
        50 * 1024 * 1024 // 50 MB
    } else {
        2 * 1024 * 1024 // 2 MB
    };

    if content_length > max_allowed_body {
        let err_json = serde_json::json!({ "error": "Payload Too Large: exceeds maximum permitted size" });
        send_response(
            &mut stream,
            413,
            "Payload Too Large",
            "application/json",
            &err_json.to_string().into_bytes(),
            &[],
        )?;
        return Ok(());
    }

    // Read the body without trusting Content-Length for the allocation: a
    // header claiming 50 MB used to reserve 50 MB before a single byte
    // arrived, so 64 such claims could ask for 3 GB from a LAN peer that then
    // sends nothing. Grow with what actually arrives, capped by the bound
    // already enforced above.
    let mut body = Vec::with_capacity(content_length.min(64 * 1024));
    if content_length > 0 {
        let read = std::io::Read::by_ref(&mut reader)
            .take(content_length as u64)
            .read_to_end(&mut body)?;
        if read != content_length {
            let err = serde_json::json!({ "error": "Incomplete request body" });
            send_response(
                &mut stream,
                400,
                "Bad Request",
                "application/json",
                &err.to_string().into_bytes(),
                &[],
            )?;
            return Ok(());
        }
    }

    // Preflight CORS OPTIONS
    if method == "OPTIONS" {
        if cors_origin.is_none() {
            send_response(&mut stream, 403, "Forbidden", "text/plain", b"", &[])?;
            return Ok(());
        }
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
            let conn = lock_recover(&db);
            let folders = storage::list_folders(&conn, false).unwrap_or_default();
            let json = serde_json::to_vec(&folders).unwrap_or_default();
            send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
            return Ok(());
        } else if method == "POST" {
            let req = match serde_json::from_slice::<CreateFolderRequest>(&body) {
                Ok(r) => r,
                Err(err) => {
                    let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                    send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                    return Ok(());
                }
            };
            let mut conn = lock_recover(&db);
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

    if path == "/api/items/inbox" || path == "/api/items" {
        if method == "GET" {
            let conn = lock_recover(&db);
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
            let req = match serde_json::from_slice::<CreateItemRequest>(&body) {
                Ok(r) => r,
                Err(err) => {
                    let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                    send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                    return Ok(());
                }
            };
            let mut conn = lock_recover(&db);
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

    if path == "/api/items/toggle-pin" && method == "POST" {
        let req = match serde_json::from_slice::<IdRequest>(&body) {
            Ok(r) => r,
            Err(err) => {
                let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        };
        let mut conn = lock_recover(&db);
        match storage::toggle_pin_item(&mut conn, &req.id, device_id) {
            Ok(item) => {
                let json = serde_json::to_vec(&item).unwrap_or_default();
                send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
            }
            Err(e) => {
                let err_json = serde_json::json!({ "error": e.to_string() });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
            }
        }
        return Ok(());
    }

    if path == "/api/items/delete" && method == "POST" {
        let req = match serde_json::from_slice::<IdRequest>(&body) {
            Ok(r) => r,
            Err(err) => {
                let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        };
        let mut conn = lock_recover(&db);
        match storage::delete_item(&mut conn, &req.id, device_id) {
            Ok(()) => {
                send_response(&mut stream, 200, "OK", "application/json", b"{\"status\":\"deleted\"}", &[])?;
            }
            Err(e) => {
                let err_json = serde_json::json!({ "error": e.to_string() });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
            }
        }
        return Ok(());
    }

    if path == "/api/items/move" && method == "POST" {
        let req = match serde_json::from_slice::<MoveItemRequest>(&body) {
            Ok(r) => r,
            Err(err) => {
                let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        };
        let mut conn = lock_recover(&db);
        match storage::move_item(&mut conn, &req.id, req.folder_id.as_deref(), device_id) {
            Ok(item) => {
                let json = serde_json::to_vec(&item).unwrap_or_default();
                send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
            }
            Err(e) => {
                let err_json = serde_json::json!({ "error": e.to_string() });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
            }
        }
        return Ok(());
    }

    if path == "/api/items/update" && method == "POST" {
        let req = match serde_json::from_slice::<UpdateItemRequest>(&body) {
            Ok(r) => r,
            Err(err) => {
                let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        };
        let mut conn = lock_recover(&db);
        match storage::update_item(
            &mut conn,
            &req.id,
            &req.title,
            &req.content,
            req.metadata.as_deref(),
            device_id,
        ) {
            Ok(item) => {
                let json = serde_json::to_vec(&item).unwrap_or_default();
                send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
            }
            Err(e) => {
                let err_json = serde_json::json!({ "error": e.to_string() });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
            }
        }
        return Ok(());
    }

    if path == "/api/folders/rename" && method == "POST" {
        let req = match serde_json::from_slice::<RenameFolderRequest>(&body) {
            Ok(r) => r,
            Err(err) => {
                let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        };
        let mut conn = lock_recover(&db);
        match storage::rename_folder(&mut conn, &req.id, &req.name, device_id) {
            Ok(folder) => {
                let json = serde_json::to_vec(&folder).unwrap_or_default();
                send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
            }
            Err(e) => {
                let err_json = serde_json::json!({ "error": e.to_string() });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
            }
        }
        return Ok(());
    }

    if path == "/api/folders/move" && method == "POST" {
        let req = match serde_json::from_slice::<MoveFolderRequest>(&body) {
            Ok(r) => r,
            Err(err) => {
                let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        };
        let mut conn = lock_recover(&db);
        match storage::move_folder(&mut conn, &req.id, req.parent_id.as_deref(), device_id) {
            Ok(folder) => {
                let json = serde_json::to_vec(&folder).unwrap_or_default();
                send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
            }
            Err(e) => {
                let err_json = serde_json::json!({ "error": e.to_string() });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
            }
        }
        return Ok(());
    }

    if path == "/api/folders/delete" && method == "POST" {
        let req = match serde_json::from_slice::<IdRequest>(&body) {
            Ok(r) => r,
            Err(err) => {
                let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        };
        let mut conn = lock_recover(&db);
        match storage::delete_folder(&mut conn, &req.id, device_id) {
            Ok(()) => {
                send_response(&mut stream, 200, "OK", "application/json", b"{\"status\":\"deleted\"}", &[])?;
            }
            Err(e) => {
                let err_json = serde_json::json!({ "error": e.to_string() });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
            }
        }
        return Ok(());
    }

    if path == "/api/pair" && method == "POST" {
        let req = match serde_json::from_slice::<PairRequest>(&body) {
            Ok(r) => r,
            Err(err) => {
                let err_json = serde_json::json!({ "error": format!("Invalid JSON payload: {}", err) });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        };
        let clean_pin = req.pin.replace(' ', "");
        if clean_pin.len() < 4 {
            let err_json = serde_json::json!({ "error": "Invalid PIN format" });
            send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
            return Ok(());
        }

        let now = chrono::Utc::now().timestamp_millis();

        // Throttle before doing any comparison, so the 900,000-value PIN space
        // cannot be walked during a session's 120-second lifetime.
        let peer_ip = stream.peer_addr().map(|a| a.ip()).ok();
        if let Some(ip) = peer_ip {
            if pair_attempts_exhausted(ip, now) {
                let err_json = serde_json::json!({
                    "error": "Too many pairing attempts. Wait a minute and request a new PIN on the desktop."
                });
                send_response(&mut stream, 429, "Too Many Requests", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        }

        let mut session_lock = lock_recover(&pairing_session);

        // A PIN is only valid against a session the desktop actually issued.
        // This previously fell back to `true` when no session existed, which
        // meant any caller could pair with any PIN whenever the user had not
        // opened Connect Device — a complete bypass of the API gate. See D-057.
        let is_valid = match *session_lock {
            Some(ref active) if now <= active.expires_at => {
                clean_pin == active.pin.replace(' ', "")
            }
            _ => false,
        };

        if !is_valid {
            if let Some(ip) = peer_ip {
                record_failed_pair_attempt(ip, now);
            }
            let err_json = serde_json::json!({ "error": "Invalid or expired authorization PIN. Please check the PIN displayed on the desktop." });
            send_response(&mut stream, 401, "Unauthorized", "application/json", &err_json.to_string().into_bytes(), &[])?;
            return Ok(());
        }

        // Burn the session: a PIN authorises exactly one device. Leaving it live
        // for the rest of its 120 seconds would let anyone who glimpsed the
        // screen pair a second device afterwards.
        *session_lock = None;
        drop(session_lock);
        if let Some(ip) = peer_ip {
            clear_pair_attempts(ip);
        }

        let dev_name = req.device_name.unwrap_or_else(|| "Tablet Peer".to_string());
        let peer_id = req.device_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let auth_token = uuid::Uuid::new_v4().to_string();
        let conn = lock_recover(&db);
        let _ = conn.execute(
            "INSERT OR REPLACE INTO paired_devices (device_id, device_name, auth_token, paired_at, last_sync_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![peer_id, dev_name, auth_token, now, None::<i64>],
        );
        let resp = serde_json::json!({
            "status": "authorized",
            "device_id": peer_id,
            "auth_token": auth_token,
            "server_device_id": device_id,
        });
        send_response(&mut stream, 200, "OK", "application/json", &resp.to_string().into_bytes(), &[])?;
        return Ok(());
    }

    // Delta Sync Query: GET /api/sync/deltas?since=...&device_id=...&auth_token=...
    if path == "/api/sync/deltas" && method == "GET" {
        let since: i64 = query
            .and_then(|q| {
                for pair in q.split('&') {
                    if let Some((k, v)) = pair.split_once('=') {
                        if k == "since" {
                            return v.parse::<i64>().ok();
                        }
                    }
                }
                None
            })
            .unwrap_or(0);

        let caller_device_id = query.and_then(|q| {
            for pair in q.split('&') {
                if let Some((k, v)) = pair.split_once('=') {
                    if k == "device_id" {
                        return Some(v.to_string());
                    }
                }
            }
            None
        }).or_else(|| headers.get("x-device-id").cloned());

        // Authorization already happened in the central gate above.
let conn = lock_recover(&db);

        let revisions = crate::sync::protocol::query_revisions_since(&conn, since, caller_device_id.as_deref()).unwrap_or_default();
        let latest_ts = revisions.last().map(|r| r.timestamp).unwrap_or(since);

        let resp = serde_json::json!({
            "device_id": device_id,
            "revisions": revisions,
            "latest_timestamp": latest_ts,
        });

        let json = serde_json::to_vec(&resp).unwrap_or_default();
        send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
        return Ok(());
    }

    // Delta Sync Apply: POST /api/sync/deltas
    if path == "/api/sync/deltas" && method == "POST" {
        #[derive(Deserialize)]
        struct DeltaApplyRequest {
            device_id: String,
            #[allow(dead_code)]
            auth_token: Option<String>,
            revisions: Vec<crate::db::models::Revision>,
        }

        let req = match serde_json::from_slice::<DeltaApplyRequest>(&body) {
            Ok(r) => r,
            Err(err) => {
                let err_json = serde_json::json!({ "error": format!("Invalid JSON delta payload: {}", err) });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        };

        let mut conn = lock_recover(&db);

        let applied = crate::sync::protocol::apply_remote_revisions(&mut conn, &req.revisions).unwrap_or(0);
        let _ = crate::sync::pairing::update_peer_last_sync(&conn, &req.device_id);

        let resp = serde_json::json!({
            "status": "ok",
            "applied": applied,
            "received_count": req.revisions.len(),
        });
        let json = serde_json::to_vec(&resp).unwrap_or_default();
        send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
        return Ok(());
    }

    // Sync Status & Discovered Peers: GET /api/sync/status and GET /api/sync/peers
    if path == "/api/sync/status" && method == "GET" {
        let conn = lock_recover(&db);
        let paired = crate::sync::pairing::list_paired_devices(&conn).unwrap_or_default();
        let paired_ids: Vec<String> = paired.iter().map(|p| p.device_id.clone()).collect();
        let mesh_peers = peer_registry
            .as_ref()
            .map(|reg| reg.try_get_active_peers())
            .unwrap_or_default();
        // `paired_devices_count` is every pairing this vault has ever made and
        // says nothing about who is here now. Clients used to fall back to it
        // when no mesh peer was visible, which reported weeks of accumulated
        // test pairings as connected devices. See D-082.
        let present = present_device_ids(&conn, &mesh_peers);
        let resp = serde_json::json!({
            "status": "ready",
            "device_id": device_id,
            "paired_devices_count": paired.len(),
            "paired_devices": paired,
            "paired_device_ids": paired_ids,
            "present_device_ids": present,
            "present_count": present.len(),
        });
        let json = serde_json::to_vec(&resp).unwrap_or_default();
        send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
        return Ok(());
    }

    if path == "/api/sync/peers" && method == "GET" {
        let active_peers = if let Some(ref reg) = peer_registry {
            reg.try_get_active_peers()
        } else {
            Vec::new()
        };
        let resp = serde_json::json!({
            "peers": active_peers,
            "count": active_peers.len(),
        });
        let json = serde_json::to_vec(&resp).unwrap_or_default();
        send_response(&mut stream, 200, "OK", "application/json", &json, &[])?;
        return Ok(());
    }

    // Media Upload Route: POST /api/media/upload or POST /api/media
    // A restore, with the archive as the request body.
    //
    // This does not go over Tauri's command IPC because on Android it cannot:
    // Tauri's own transport says so — "on Android we never use it because
    // Android does not have support to reading the request body" — so every
    // invoke there is a JSON string through postMessage, and 8.8 MB of zip is
    // not a JSON string. The app already posts image bytes to this same server
    // from its own webview, so this is the road that is known to carry binary
    // on the device. The gate above has already established the caller is this
    // app's own webview on loopback. See D-077.
    if method == "POST" && path == "/api/vault/restore" {
        if body.len() < crate::db::import::MIN_ARCHIVE_BYTES {
            let err = serde_json::json!({ "error": "That file is too small to be a backup." });
            send_response(&mut stream, 400, "Bad Request", "application/json", &err.to_string().into_bytes(), &[])?;
            return Ok(());
        }
        let base_dir = get_storage_base_dir();
        let mut conn = lock_recover(&db);
        match crate::db::import::import_vault_bytes(&mut conn, &base_dir, &body) {
            Ok(summary) => {
                let payload = serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string());
                send_response(&mut stream, 200, "OK", "application/json", &payload.into_bytes(), &[])?;
            }
            Err(e) => {
                let err = serde_json::json!({ "error": e.to_string() });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err.to_string().into_bytes(), &[])?;
            }
        }
        return Ok(());
    }

    if method == "POST" && (path == "/api/media/upload" || path == "/api/media") {
        let upload_item_id: Option<String>;
        let upload_folder_id: Option<String>;
        let upload_title: Option<String>;
        let raw_bytes: Vec<u8>;

        let is_json = headers
            .get("content-type")
            .map(|ct| ct.contains("application/json"))
            .unwrap_or(false)
            || (body.starts_with(b"{") && body.ends_with(b"}"));

        if is_json {
            if let Ok(req) = serde_json::from_slice::<MediaUploadRequest>(&body) {
                upload_item_id = req.item_id;
                upload_folder_id = req.folder_id;
                upload_title = req.title;
                let b64_str = req.data.or(req.base64).unwrap_or_default();
                match decode_base64(&b64_str) {
                    Ok(b) => raw_bytes = b,
                    Err(e) => {
                        let err_json = serde_json::json!({ "error": format!("Base64 decode error: {}", e) });
                        send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                        return Ok(());
                    }
                }
            } else {
                let err_json = serde_json::json!({ "error": "Invalid JSON payload for media upload" });
                send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        } else {
            upload_item_id = None;
            upload_folder_id = None;
            upload_title = None;
            raw_bytes = body;
        }

        if raw_bytes.is_empty() {
            let err_json = serde_json::json!({ "error": "No media bytes received" });
            send_response(&mut stream, 400, "Bad Request", "application/json", &err_json.to_string().into_bytes(), &[])?;
            return Ok(());
        }

        let base_dir = get_storage_base_dir();
        let _ = fs::create_dir_all(base_dir.join("media"));
        let _ = fs::create_dir_all("media");

        let mut conn = lock_recover(&db);

        // Ensure item exists in vault_items for foreign key constraint
        let existing_item: Option<VaultItem> = if let Some(ref iid) = upload_item_id {
            conn.query_row(
                "SELECT id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at
                 FROM vault_items WHERE id = ?1",
                [iid],
                |row| {
                    Ok(VaultItem {
                        id: row.get(0)?,
                        folder_id: row.get(1)?,
                        item_type: row.get(2)?,
                        title: row.get(3)?,
                        content: row.get(4)?,
                        metadata: row.get(5)?,
                        is_pinned: row.get::<_, i64>(6)? != 0,
                        is_archived: row.get::<_, i64>(7)? != 0,
                        is_deleted: row.get::<_, i64>(8)? != 0,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                },
            ).ok()
        } else {
            None
        };

        let file_hash = media::compute_sha256(&raw_bytes);

        let target_item_id = if let Some(item) = existing_item {
            item.id
        } else {
            // Deduplication: If this exact image was uploaded within the last 5 seconds without an item_id,
            // reuse the existing item to avoid duplicate records from rapid double-clicks or touch events.
            let five_sec_ago = chrono::Utc::now().timestamp_millis() - 5000;
            let recent_item_id: Option<String> = conn.query_row(
                "SELECT v.id
                 FROM vault_items v
                 JOIN media_files m ON m.item_id = v.id
                 WHERE m.file_hash = ?1 AND v.created_at >= ?2 AND v.is_deleted = 0
                 ORDER BY v.created_at DESC LIMIT 1",
                rusqlite::params![&file_hash, five_sec_ago],
                |row| row.get(0),
            ).ok();

            if let Some(reused_id) = recent_item_id {
                reused_id
            } else {
                let item_title = upload_title.unwrap_or_else(|| {
                    let now = chrono::Local::now();
                    format!("Screenshot ({})", now.format("%H:%M"))
                });
                match storage::create_item(
                    &mut conn,
                    upload_folder_id.as_deref(),
                    "image",
                    &item_title,
                    "",
                    None,
                    device_id,
                ) {
                    Ok(item) => item.id,
                    Err(e) => {
                        let err_json = serde_json::json!({ "error": format!("Failed to create item for media: {}", e) });
                        send_response(&mut stream, 500, "Internal Server Error", "application/json", &err_json.to_string().into_bytes(), &[])?;
                        return Ok(());
                    }
                }
            }
        };

        match media::save_image_media(&mut conn, &base_dir, &target_item_id, &raw_bytes, device_id) {
            Ok(media_file) => {
                let media_url = format!("/api/media/{}.webp", media_file.file_hash);
                let meta = serde_json::json!({
                    "isImage": true,
                    "mimeType": "image/webp",
                    "fileHash": media_file.file_hash,
                    "byteSize": media_file.byte_size,
                    "width": media_file.width,
                    "height": media_file.height,
                });

                let current_title: String = conn
                    .query_row("SELECT title FROM vault_items WHERE id = ?1", [&target_item_id], |row| row.get(0))
                    .unwrap_or_else(|_| "Screenshot".to_string());

                let _ = storage::update_item(
                    &mut conn,
                    &target_item_id,
                    &current_title,
                    &media_url,
                    Some(&meta.to_string()),
                    device_id,
                );

                let item = conn.query_row(
                    "SELECT id, folder_id, item_type, title, content, metadata, is_pinned, is_archived, is_deleted, created_at, updated_at
                     FROM vault_items WHERE id = ?1",
                    [&target_item_id],
                    |row| {
                        Ok(VaultItem {
                            id: row.get(0)?,
                            folder_id: row.get(1)?,
                            item_type: row.get(2)?,
                            title: row.get(3)?,
                            content: row.get(4)?,
                            metadata: row.get(5)?,
                            is_pinned: row.get::<_, i64>(6)? != 0,
                            is_archived: row.get::<_, i64>(7)? != 0,
                            is_deleted: row.get::<_, i64>(8)? != 0,
                            created_at: row.get(9)?,
                            updated_at: row.get(10)?,
                        })
                    },
                ).ok();

                let resp = serde_json::json!({
                    "status": "ok",
                    "url": media_url,
                    "file_hash": media_file.file_hash,
                    "byte_size": media_file.byte_size,
                    "width": media_file.width,
                    "height": media_file.height,
                    "item": item,
                });
                let json = serde_json::to_vec(&resp).unwrap_or_default();
                send_response(&mut stream, 201, "Created", "application/json", &json, &[])?;
                return Ok(());
            }
            Err(e) => {
                let err_json = serde_json::json!({ "error": format!("Failed to save image media: {}", e) });
                send_response(&mut stream, 500, "Internal Server Error", "application/json", &err_json.to_string().into_bytes(), &[])?;
                return Ok(());
            }
        }
    }

    // Media Serving: GET /media/<hash> or GET /api/media/<hash>
    if method == "GET" && (path.starts_with("/api/media/") || path.starts_with("/media/")) {
        let media_hash = if path.starts_with("/api/media/") {
            &path["/api/media/".len()..]
        } else {
            &path["/media/".len()..]
        };

        if media_hash != "upload" && !media_hash.is_empty() {
            let clean_hash = media_hash.trim_end_matches(".webp");
            if let Some(media_file_path) = find_media_file(clean_hash, dist_dir) {
                if let Ok(bytes) = fs::read(&media_file_path) {
                    let mime = if bytes.starts_with(b"RIFF") {
                        "image/webp"
                    } else if bytes.starts_with(b"\x89PNG") {
                        "image/png"
                    } else if bytes.starts_with(b"\xFF\xD8\xFF") {
                        "image/jpeg"
                    } else {
                        "image/webp"
                    };
                    let is_download = query.map(|q| q.contains("download")).unwrap_or(false);
                    let disposition_val;
                    let mut extra_headers: Vec<(&str, &str)> = vec![
                        ("Cache-Control", "public, max-age=31536000, immutable"),
                    ];
                    if is_download {
                        disposition_val = format!("attachment; filename=\"{}.webp\"", clean_hash);
                        extra_headers.push(("Content-Disposition", &disposition_val));
                    }
                    send_response(
                        &mut stream,
                        200,
                        "OK",
                        mime,
                        &bytes,
                        &extra_headers,
                    )?;
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
    }

    // Catch unhandled API routes: never let any /api/* route fall through to static index.html
    if path.starts_with("/api/") {
        let err_json = serde_json::json!({ "error": format!("API endpoint not found or method not allowed: {} {}", method, path) });
        send_response(
            &mut stream,
            404,
            "Not Found",
            "application/json",
            &err_json.to_string().into_bytes(),
            &[],
        )?;
        return Ok(());
    }

    // Static Assets & SPA Fallback Serving
    if let Some(dist) = dist_dir {
        if !browser_access_enabled() {
            // Everything above this point — health, pairing and the sync API —
            // stays reachable, so mesh sync is unaffected. Only the browser UI
            // is withheld.
            send_response(
                &mut stream,
                403,
                "Forbidden",
                "text/plain; charset=utf-8",
                b"Browser access is turned off on this device. Enable it under Connect Device in the desktop app.",
                &[],
            )?;
            return Ok(());
        }

        let relative_path = path.trim_start_matches('/');

        // Path traversal defense: block any traversal attempts
        if relative_path.contains("..") || relative_path.contains('\\') {
            send_response(
                &mut stream,
                403,
                "Forbidden",
                "text/plain",
                b"Access Denied: Path traversal is forbidden",
                &[],
            )?;
            return Ok(());
        }

        let target_file = if relative_path.is_empty() {
            dist.join("index.html")
        } else {
            dist.join(relative_path)
        };

        // Canonical verification: ensure resolved path is strictly contained within dist directory
        let is_safe = if let (Ok(canonical_target), Ok(canonical_dist)) = (target_file.canonicalize(), dist.canonicalize()) {
            canonical_target.starts_with(&canonical_dist)
        } else {
            false
        };

        if is_safe && target_file.exists() && target_file.is_file() {
            if let Ok(bytes) = fs::read(&target_file) {
                let mime = get_mime_type(&target_file);
                send_response(&mut stream, 200, "OK", mime, &bytes, &[])?;
                return Ok(());
            }
        }

        // SPA Fallback: Serve index.html for client-side GET routes (never API calls)
        if method == "GET" && !path.starts_with("/api/") {
            let fallback_index = dist.join("index.html");
            if fallback_index.exists() {
                if let Ok(bytes) = fs::read(&fallback_index) {
                    send_response(&mut stream, 200, "OK", "text/html; charset=utf-8", &bytes, &[])?;
                    return Ok(());
                }
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
    let cors_headers = CORS_ALLOW_ORIGIN.with(|slot| match slot.borrow().as_deref() {
        Some(origin) => format!(
            "Access-Control-Allow-Origin: {}\r\n\
             Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n\
             Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token\r\n\
             Vary: Origin\r\n",
            origin
        ),
        None => "Vary: Origin\r\n".to_string(),
    });

    let mut header_str = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         {}\
         Connection: close\r\n",
        status_code,
        status_text,
        content_type,
        body.len(),
        cors_headers
    );

    for (k, v) in extra_headers {
        header_str.push_str(&format!("{}: {}\r\n", k, v));
    }
    header_str.push_str("\r\n");

    stream.write_all(header_str.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()?;
    let _ = stream.shutdown(std::net::Shutdown::Both);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    /// A response is readable cross-origin only if the browser is told so.
    /// Returning `*` here let any page the user visited read the vault through
    /// 127.0.0.1, so these cases are a security boundary, not a formality.
    #[test]
    fn cors_grants_only_same_origin_and_the_tauri_webview() {
        let host = Some("192.168.31.187:42420");

        // The real browser attack shape: the browser sets Host to the target it
        // is calling and Origin to the page making the call, so a hostile page
        // always presents a foreign Origin against a legitimate Host.
        assert_eq!(allowed_cors_origin(Some("http://evil.example"), host), None);
        assert_eq!(allowed_cors_origin(Some("null"), host), None);
        assert_eq!(allowed_cors_origin(Some(""), host), None);
        assert_eq!(allowed_cors_origin(None, host), None);

        // A prefix match must not be enough, or evil.com.attacker.net passes.
        assert_eq!(
            allowed_cors_origin(Some("http://192.168.31.187:42420.evil.example"), host),
            None
        );

        // The tablet browser, served from this server on any LAN address.
        assert_eq!(
            allowed_cors_origin(Some("http://192.168.31.187:42420"), host),
            Some("http://192.168.31.187:42420".to_string())
        );

        // The desktop webview, which uploads media cross-origin to 127.0.0.1.
        for origin in ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"] {
            assert_eq!(
                allowed_cors_origin(Some(origin), Some("127.0.0.1:42420")),
                Some(origin.to_string())
            );
        }
    }

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

    /// The address the UI hands out must be one another device can dial.
    ///
    /// Loopback is the specific wrong answer: handed to a phone it points the
    /// phone at itself, which looks exactly like the app failing to respond.
    #[test]
    fn a_lan_address_is_never_offered_as_loopback() {
        let info = get_lan_connection_info(42420);
        if info.reachable {
            assert!(
                !info.ip.starts_with("127."),
                "a reachable address must not be loopback, got {}",
                info.ip
            );
            assert!(
                info.url.contains(&info.ip) && info.url.ends_with(":42420"),
                "url and ip disagree: {} vs {}",
                info.url,
                info.ip
            );
        } else {
            // Not on a network is a legitimate answer, and must be reported as
            // such rather than dressed up as an address.
            assert_eq!(info.ip, "127.0.0.1");
        }
    }

    /// Finding our own address must not depend on having an internet route,
    /// because the whole app is built to work without one.
    #[test]
    fn the_private_ranges_are_probed_not_just_the_internet() {
        let src = include_str!("http_server.rs");
        let body = src
            .split("pub fn find_local_lan_ip()")
            .nth(1)
            .expect("find_local_lan_ip must exist");
        let head = &body[..body.len().min(1200)];
        for probe in ["192.168", "10.0.0", "172.16"] {
            assert!(
                head.contains(probe),
                "a private-range probe for {probe} is missing, so a network                  without internet would yield no address"
            );
        }
    }

    /// A dead adapter must never outrank a working one.
    ///
    /// Windows hands an interface a 169.254 address when its DHCP request goes
    /// unanswered, and a laptop can hold several at once. Offering one of those
    /// as the address to scan points the phone at a network nobody is on.
    #[test]
    fn a_real_private_address_beats_an_apipa_one() {
        use std::net::Ipv4Addr;
        assert!(
            address_rank(Ipv4Addr::new(172, 17, 1, 145)) > address_rank(Ipv4Addr::new(169, 254, 87, 87)),
            "a DHCP-assigned address must outrank a link-local one"
        );
        assert!(
            address_rank(Ipv4Addr::new(169, 254, 87, 87)) > address_rank(Ipv4Addr::new(203, 0, 113, 5)),
            "link-local is still better than a public address for a LAN handoff"
        );
    }

    /// "Connected" must mean present, not ever-paired.
    ///
    /// The desktop sidebar said "No devices yet" while the tablet browsing the
    /// same vault said "Synced (5)". Both read the truth and asked different
    /// questions: one counted live mesh peers, the other fell back to the
    /// number of rows in `paired_devices`, which was weeks of accumulated test
    /// pairings. See D-082.
    #[test]
    fn presence_counts_who_is_here_not_who_ever_paired() {
        use crate::db::schema::initialize_schema;
        use crate::sync::pairing::{store_paired_device, update_peer_last_sync};

        let conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();

        // Three devices paired at some point in the past.
        for (id, name) in [("dev-a", "Tablet"), ("dev-b", "Phone"), ("dev-c", "Old laptop")] {
            store_paired_device(&conn, id, name, "token").unwrap();
        }

        // None has spoken since pairing, so none is present.
        let present = present_device_ids(&conn, &[]);
        assert!(
            present.is_empty(),
            "pairing history is not presence, got {present:?}"
        );

        // One of them makes a request now.
        update_peer_last_sync(&conn, "dev-a").unwrap();
        let present = present_device_ids(&conn, &[]);
        assert_eq!(present, vec!["dev-a".to_string()], "the device in use should be the only one present");

        // A device heard from longer ago than the window has gone.
        let stale = chrono::Utc::now().timestamp_millis() - DEVICE_PRESENCE_WINDOW_MS - 1;
        conn.execute(
            "UPDATE paired_devices SET last_sync_at = ?1 WHERE device_id = 'dev-a'",
            rusqlite::params![stale],
        )
        .unwrap();
        assert!(
            present_device_ids(&conn, &[]).is_empty(),
            "a device silent past the window must stop counting as present"
        );
    }

    #[test]
    fn private_addresses_outrank_everything_else() {
        use std::net::Ipv4Addr;
        for ip in [
            Ipv4Addr::new(192, 168, 1, 5),
            Ipv4Addr::new(10, 0, 0, 2),
            Ipv4Addr::new(172, 16, 4, 9),
        ] {
            assert_eq!(address_rank(ip), 2, "{ip} is a LAN address");
        }
        assert_eq!(address_rank(Ipv4Addr::new(169, 254, 3, 3)), 1, "link-local is a fallback");
        assert_eq!(address_rank(Ipv4Addr::new(8, 8, 8, 8)), 0);
        assert_eq!(address_rank(Ipv4Addr::new(172, 32, 0, 1)), 0, "outside 172.16/12");
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
            "POST /api/folders HTTP/1.1\r\nHost: localhost\r\nOrigin: http://tauri.localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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
            "POST /api/items HTTP/1.1\r\nHost: localhost\r\nOrigin: http://tauri.localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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
            .write_all(b"GET /api/items/inbox HTTP/1.1\r\nHost: localhost\r\nOrigin: http://tauri.localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("200 OK"));
        assert!(resp.contains("Quick phone idea"));

        // 6. Test Static Fallback (SPA routing).
        // Browser access is off by default (D-059), so the UI must be withheld
        // until it is explicitly enabled — while the API tested above stays
        // reachable throughout, because mesh sync depends on it.
        set_browser_access(false);
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /some/custom/path HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(
            resp.contains("403 Forbidden"),
            "the browser UI must not be served while browser access is off: {resp}"
        );

        set_browser_access(true);
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /some/custom/path HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("200 OK"));
        assert!(resp.contains("text/html"));

        // 7. Test decode_base64
        let test_b64 = "SGVsbG8gV29ybGQ=";
        let decoded = decode_base64(test_b64).unwrap();
        assert_eq!(decoded, b"Hello World");

        // 8. Test POST /api/media/upload with a small 1x1 PNG
        let red_png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let upload_payload = format!(
            r#"{{"title":"Test Upload","data":"{}"}}"#,
            red_png_b64
        );
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        let req = format!(
            "POST /api/media/upload HTTP/1.1\r\nHost: localhost\r\nOrigin: http://tauri.localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            upload_payload.len(),
            upload_payload
        );
        stream.write_all(req.as_bytes()).unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("201 Created"));
        assert!(resp.contains(r#""status":"ok""#));
        assert!(resp.contains("/api/media/"));

        // 9. Test Path Traversal Protection (must be 403 Forbidden)
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /../../Cargo.toml HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("403 Forbidden"), "Path traversal attempt should be rejected with 403 Forbidden");

        // 10. Test Unpadded Base64 Decoding
        let unpadded_b64 = "SGVsbG8"; // "Hello" without '='
        let decoded = decode_base64(unpadded_b64).unwrap();
        assert_eq!(decoded, b"Hello");

        // 11. Test Invalid JSON POST returning 400 Bad Request
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"POST /api/folders HTTP/1.1\r\nHost: localhost\r\nOrigin: http://tauri.localhost\r\nContent-Type: application/json\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{invalid_json}")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("400 Bad Request"), "Malformed JSON payload must return 400 Bad Request");
        assert!(!resp.contains("<!DOCTYPE"), "Malformed JSON must never fall through to HTML");

        // 12. Test Unknown API Route returning 404 Not Found
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /api/nonexistent-route HTTP/1.1\r\nHost: localhost\r\nOrigin: http://tauri.localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("404 Not Found"), "Unknown API route must return 404 Not Found");
        assert!(!resp.contains("<!DOCTYPE"), "Unknown API route must never fall through to HTML");

        // 13. Test Unpaired Caller without Origin is Rejected with 401 Unauthorized
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /api/folders HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(resp.contains("401 Unauthorized"), "Unauthenticated call without origin must return 401 Unauthorized");

        // 14. A lookalike origin must not reach the desktop-self exemption.
        // That exemption trusts a Tauri Origin arriving on loopback. Matching it
        // by suffix would admit any caller that sends Host: evil.tauri.localhost
        // with an Origin to match, because same-origin requests are approved
        // against the request's own Host.
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /api/folders HTTP/1.1\r\nHost: evil.tauri.localhost\r\nOrigin: http://evil.tauri.localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(
            resp.contains("401 Unauthorized"),
            "A lookalike *.tauri.localhost origin must not be treated as the desktop app"
        );

        // 15. Pairing must be impossible when the desktop has issued no PIN.
        // This previously fell back to accepting ANY pin whenever no session
        // existed — i.e. whenever the user had not opened Connect Device — so a
        // caller could mint itself a permanent token and walk straight past the
        // API gate. The test server starts with no session, which is exactly
        // that state.
        let pair_payload = br#"{"pin":"000000","device_name":"attacker","device_id":"attacker-device"}"#;
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        let req = format!(
            "POST /api/pair HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            pair_payload.len(),
            std::str::from_utf8(pair_payload).unwrap()
        );
        stream.write_all(req.as_bytes()).unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(
            !resp.contains("auth_token"),
            "Pairing with no active session must never issue a token: {resp}"
        );
        assert!(
            resp.contains("401 Unauthorized"),
            "Pairing with no active session must be rejected, got: {resp}"
        );

        // 16. A body that never arrives must not be believed. The declared
        // Content-Length used to size the buffer up front, so a peer could
        // claim megabytes, send nothing, and still cost the allocation.
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(
                b"POST /api/folders HTTP/1.1
Host: localhost
Origin: http://tauri.localhost
Content-Type: application/json
Content-Length: 1048576
Connection: close

{}",
            )
            .unwrap();
        stream.shutdown(std::net::Shutdown::Write).unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(
            resp.contains("400 Bad Request"),
            "A truncated body must be rejected, got: {resp}"
        );

        // 17. A `<img src>` from the app's own webview carries no Origin header,
        // because a plain image load is a no-CORS request. It used to be answered
        // 401, so every picture older than the current session showed as broken.
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(
                b"GET /api/media/0000000000000000000000000000000000000000000000000000000000000000.webp HTTP/1.1
Host: localhost
Connection: close

",
            )
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(
            !resp.contains("401 Unauthorized"),
            "a loopback media read must not be rejected for having no Origin: {resp}"
        );
        // 404 is the right answer for a hash that does not exist; the point is
        // that the request reached the media route at all.
        assert!(resp.contains("404 Not Found"), "expected the media route, got: {resp}");

        // The exemption is loopback-only: everything else still needs a token.
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET /api/items HTTP/1.1
Host: localhost
Connection: close

")
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        assert!(
            resp.contains("401 Unauthorized"),
            "the media exemption must not widen to the rest of the API: {resp}"
        );

        // Clean shutdown
        let _ = handle.stop_sender.send(());
    }
}
