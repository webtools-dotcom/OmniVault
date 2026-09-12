use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::models::Revision;
use crate::sync::discovery::{PeerInfo, PeerRegistry};
use crate::sync::pairing::{is_device_paired, store_paired_device, update_peer_last_sync, PairedDevice};
use crate::sync::protocol::{apply_remote_revisions, query_revisions_since};

/// Upper bound on blobs pulled in a single sync pass so a large backlog cannot
/// stall one cycle; the remainder is picked up by the next pass.
// ponytail: fixed cap, make it adaptive only if cold-start catchup feels slow.
const MAX_MEDIA_FETCH_PER_SYNC: usize = 25;

/// Pull the `<hash>` out of a `/api/media/<hash>.webp` reference.
fn extract_media_hash(content: &str) -> Option<String> {
    let start = content.rfind("/api/media/")? + "/api/media/".len();
    let hash = content[start..].split(".webp").next()?;
    if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(hash.to_string())
    } else {
        None
    }
}

/// Every media hash this vault references but has no file on disk for.
/// Reading from local state (rather than the current delta batch) makes media
/// sync self-healing: a blob missed on an earlier pass is retried every cycle
/// until it lands.
fn collect_missing_media_hashes(
    conn: &Connection,
    media_dir: &Path,
    limit: usize,
) -> Vec<String> {
    let mut hashes: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

    if let Ok(mut stmt) = conn.prepare("SELECT file_hash FROM media_files") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for hash in rows.flatten() {
                hashes.insert(hash);
            }
        }
    }

    if let Ok(mut stmt) = conn.prepare(
        "SELECT content FROM vault_items WHERE is_deleted = 0 AND content LIKE '%/api/media/%'",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for content in rows.flatten() {
                if let Some(hash) = extract_media_hash(&content) {
                    hashes.insert(hash);
                }
            }
        }
    }

    hashes
        .into_iter()
        .filter(|hash| !media_dir.join(format!("{}.webp", hash)).exists())
        .take(limit)
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshSyncStatus {
    pub is_syncing: bool,
    pub last_sync_at: Option<i64>,
    pub peer_count: usize,
    pub peers: Vec<PeerInfo>,
    #[serde(default)]
    pub paired_device_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

/// Lightweight, zero-dependency HTTP/1.1 client request over TCP.
/// Bounded by connect and read/write timeouts to prevent hanging during network transitions.
pub fn send_http_request(
    addr: SocketAddr,
    method: &str,
    path_and_query: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
    timeout: Duration,
) -> std::io::Result<HttpResponse> {
    let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;

    let host = addr.to_string();
    let body_bytes = body.unwrap_or(&[]);
    let content_len = body_bytes.len();

    let mut req_header = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Length: {}\r\n",
        method, path_and_query, host, content_len
    );

    for (k, v) in headers {
        req_header.push_str(&format!("{}: {}\r\n", k, v));
    }
    req_header.push_str("\r\n");

    stream.write_all(req_header.as_bytes())?;
    if !body_bytes.is_empty() {
        stream.write_all(body_bytes)?;
    }
    stream.flush()?;

    let mut reader = BufReader::new(stream);
    let mut status_line = String::new();
    reader.read_line(&mut status_line)?;

    // Parse status line, e.g. "HTTP/1.1 200 OK"
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);

    let mut resp_headers = HashMap::new();
    let mut resp_content_length: Option<usize> = None;

    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;
        if bytes_read == 0 {
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
                if let Ok(l) = val.parse::<usize>() {
                    resp_content_length = Some(l);
                }
            }
            resp_headers.insert(key, val);
        }
    }

    let mut resp_body = Vec::new();
    if let Some(len) = resp_content_length {
        resp_body.resize(len, 0);
        reader.read_exact(&mut resp_body)?;
    } else {
        reader.read_to_end(&mut resp_body)?;
    }

    Ok(HttpResponse {
        status,
        headers: resp_headers,
        body: resp_body,
    })
}

#[derive(Debug, Deserialize)]
struct DeltasResponse {
    pub revisions: Vec<Revision>,
}

#[derive(Debug, Serialize)]
struct PushDeltasRequest<'a> {
    pub device_id: &'a str,
    pub auth_token: Option<&'a str>,
    pub revisions: &'a [Revision],
}

/// Performs a full bidirectional store-and-forward synchronization round with an active peer.
/// 1. Pulls new remote revisions since last sync timestamp.
/// 2. Applies remote revisions via Last-Write-Wins (LWW).
/// 3. Streams down any missing WebP media attachments referenced in revisions.
/// 4. Pushes local revisions to the peer.
/// 5. Updates peer sync timestamp.
pub fn sync_with_peer(
    db: Arc<Mutex<Connection>>,
    self_device_id: &str,
    peer: &PeerInfo,
    base_dir: &Path,
) -> Result<usize, String> {
    let (auth_token, last_sync_at) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        if !is_device_paired(&conn, &peer.device_id).unwrap_or(false) {
            return Ok(0); // Skip unpaired peer until PIN authorized
        }

        let row_res: rusqlite::Result<(String, Option<i64>)> = conn.query_row(
            "SELECT auth_token, last_sync_at FROM paired_devices WHERE device_id = ?1",
            [&peer.device_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        );

        match row_res {
            Ok(pair) => pair,
            Err(_) => return Ok(0),
        }
    };

    let peer_addr = SocketAddr::new(peer.addr, peer.sync_port);
    let since_ts = last_sync_at.unwrap_or(0);
    let timeout = Duration::from_secs(5);

    // Step 1: Pull remote deltas from peer
    let pull_path = format!(
        "/api/sync/deltas?since={}&device_id={}&auth_token={}",
        since_ts, self_device_id, auth_token
    );
    let resp = send_http_request(
        peer_addr,
        "GET",
        &pull_path,
        &[("Accept", "application/json")],
        None,
        timeout,
    )
    .map_err(|e| format!("Failed to reach peer {} at {}: {}", peer.device_name, peer_addr, e))?;

    if resp.status != 200 {
        return Err(format!("Peer returned status {}: {}", resp.status, String::from_utf8_lossy(&resp.body)));
    }

    let deltas_resp: DeltasResponse = serde_json::from_slice(&resp.body)
        .map_err(|e| format!("Failed to parse peer deltas: {}", e))?;

    let mut applied_count = 0;
    // Step 2: Apply remote revisions to local SQLite database
    if !deltas_resp.revisions.is_empty() {
        let mut conn = db.lock().map_err(|e| e.to_string())?;
        applied_count = apply_remote_revisions(&mut conn, &deltas_resp.revisions)
            .map_err(|e| format!("Failed to apply remote revisions: {}", e))?;
    }

    // Step 3: Stream missing WebP media files from peer.
    // The set is derived from local state, never from this batch's revisions:
    // a blob whose fetch failed (peer asleep, timeout, truncated body) must be
    // retried later, but `since_ts` has already moved past its `media_file`
    // revision, so a batch-derived list would strand it as a permanent 404.
    let media_dir = base_dir.join("media");
    let _ = fs::create_dir_all(&media_dir);

    let missing_hashes = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        collect_missing_media_hashes(&conn, &media_dir, MAX_MEDIA_FETCH_PER_SYNC)
    };

    for hash in missing_hashes {
        let local_path = media_dir.join(format!("{}.webp", hash));
        let media_path = format!("/api/media/{}.webp", hash);
        match send_http_request(peer_addr, "GET", &media_path, &[], None, Duration::from_secs(10)) {
            Ok(media_resp) if media_resp.status == 200 && !media_resp.body.is_empty() => {
                let mut hasher = Sha256::new();
                hasher.update(&media_resp.body);
                let computed_hash = format!("{:x}", hasher.finalize());
                if computed_hash == hash {
                    let temp_path = media_dir.join(format!("{}.tmp.{}", hash, uuid::Uuid::new_v4()));
                    if let Ok(mut f) = File::create(&temp_path) {
                        if f.write_all(&media_resp.body).is_ok() {
                            let _ = fs::rename(&temp_path, &local_path);
                        } else {
                            let _ = fs::remove_file(&temp_path);
                        }
                    }
                } else {
                    eprintln!(
                        "[mesh_sync] media {} failed integrity check, will retry next sync",
                        hash
                    );
                }
            }
            Ok(media_resp) => eprintln!(
                "[mesh_sync] media {} unavailable from peer (HTTP {}), will retry next sync",
                hash, media_resp.status
            ),
            Err(e) => eprintln!(
                "[mesh_sync] media {} fetch failed ({}), will retry next sync",
                hash, e
            ),
        }
    }

    // Step 4: Push our local deltas to peer
    let local_revisions = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        query_revisions_since(&conn, since_ts, Some(&peer.device_id)).unwrap_or_default()
    };

    if !local_revisions.is_empty() {
        let push_payload = PushDeltasRequest {
            device_id: self_device_id,
            auth_token: Some(&auth_token),
            revisions: &local_revisions,
        };
        if let Ok(body_bytes) = serde_json::to_vec(&push_payload) {
            let _ = send_http_request(
                peer_addr,
                "POST",
                "/api/sync/deltas",
                &[("Content-Type", "application/json")],
                Some(&body_bytes),
                timeout,
            );
        }
    }

    // Step 5: Update peer last_sync_at timestamp
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let _ = update_peer_last_sync(&conn, &peer.device_id);
    }

    Ok(applied_count)
}

/// Initiates one-time 6-digit PIN pairing with a remote peer.
/// Exchanges auth tokens and records the peer in local `paired_devices`.
pub fn pair_with_remote_peer(
    db: Arc<Mutex<Connection>>,
    self_device_id: &str,
    self_device_name: &str,
    peer_addr_str: &str,
    peer_port: u16,
    pin: &str,
) -> Result<PairedDevice, String> {
    let clean_ip: IpAddr = peer_addr_str
        .trim()
        .parse()
        .map_err(|e| format!("Invalid IP address '{}': {}", peer_addr_str, e))?;
    let target_addr = SocketAddr::new(clean_ip, peer_port);

    #[derive(Serialize)]
    struct PairReq<'a> {
        pin: &'a str,
        device_id: Option<&'a str>,
        device_name: Option<&'a str>,
    }

    let payload = PairReq {
        pin,
        device_id: Some(self_device_id),
        device_name: Some(self_device_name),
    };

    let body_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let resp = send_http_request(
        target_addr,
        "POST",
        "/api/pair",
        &[("Content-Type", "application/json")],
        Some(&body_bytes),
        Duration::from_secs(6),
    )
    .map_err(|e| format!("Connection failed to {}: {}", target_addr, e))?;

    if resp.status != 200 {
        let err_msg = String::from_utf8_lossy(&resp.body);
        return Err(format!("Pairing failed (status {}): {}", resp.status, err_msg));
    }

    #[derive(Deserialize)]
    struct PairResp {
        auth_token: String,
        server_device_id: Option<String>,
        device_id: Option<String>,
    }

    let pair_resp: PairResp = serde_json::from_slice(&resp.body)
        .map_err(|e| format!("Failed to parse pairing response: {}", e))?;

    let peer_device_id = pair_resp
        .server_device_id
        .or(pair_resp.device_id)
        .ok_or_else(|| "Pairing response missing peer device ID".to_string())?;

    let conn = db.lock().map_err(|e| e.to_string())?;
    let peer_name = format!("OmniVault Peer ({})", &peer_device_id[..6.min(peer_device_id.len())]);
    let paired = store_paired_device(&conn, &peer_device_id, &peer_name, &pair_resp.auth_token)
        .map_err(|e| format!("Failed to store paired device: {}", e))?;

    Ok(paired)
}

/// Runs the continuous mesh synchronization loop on a background Tokio runtime.
/// Every 5 seconds, queries active peers discovered on local Wi-Fi and triggers store-and-forward catchup.
pub async fn run_mesh_sync_loop(
    db: Arc<Mutex<Connection>>,
    self_device_id: String,
    peer_registry: PeerRegistry,
    base_dir: std::path::PathBuf,
    mut stop_rx: tokio::sync::watch::Receiver<bool>,
) {
    let mut interval = tokio::time::interval(Duration::from_secs(5));

    while !*stop_rx.borrow() {
        tokio::select! {
            _ = interval.tick() => {
                let peers = peer_registry.get_active_peers().await;
                for peer in peers {
                    let db_clone = db.clone();
                    let dev_id = self_device_id.clone();
                    let p = peer.clone();
                    let b_dir = base_dir.clone();

                    let _ = tokio::task::spawn_blocking(move || {
                        let _ = sync_with_peer(db_clone, &dev_id, &p, &b_dir);
                    }).await;
                }
            }
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    #[test]
    fn extracts_hash_only_from_real_media_references() {
        let hash = "a".repeat(64);
        assert_eq!(
            extract_media_hash(&format!("/api/media/{}.webp", hash)),
            Some(hash.clone())
        );
        assert_eq!(extract_media_hash("just a plain note"), None);
        assert_eq!(extract_media_hash("/api/media/not-a-hash.webp"), None);
    }

    #[test]
    fn missing_media_is_rediscovered_after_the_delta_batch_is_gone() {
        let dir = std::env::temp_dir().join(format!("ov_media_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        schema::initialize_schema(&conn).unwrap();

        let present = "b".repeat(64);
        let absent = "c".repeat(64);
        std::fs::write(dir.join(format!("{}.webp", present)), b"blob").unwrap();

        // Two image items referencing blobs; only one is on disk. No revisions
        // are involved, mirroring a sync long after the media_file revision
        // scrolled past `since_ts`.
        for (id, hash) in [("i1", &present), ("i2", &absent)] {
            conn.execute(
                "INSERT INTO vault_items (id, folder_id, item_type, title, content, created_at, updated_at)
                 VALUES (?1, NULL, 'image', ?1, ?2, 0, 0)",
                rusqlite::params![id, format!("/api/media/{}.webp", hash)],
            )
            .unwrap();
        }

        let missing = collect_missing_media_hashes(&conn, &dir, 25);
        assert_eq!(missing, vec![absent.clone()], "only the blob absent from disk is refetched");

        // Once it lands it must drop out of the repair set.
        std::fs::write(dir.join(format!("{}.webp", absent)), b"blob").unwrap();
        assert!(collect_missing_media_hashes(&conn, &dir, 25).is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
