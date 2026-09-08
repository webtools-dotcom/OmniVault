use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CHUNK_SIZE: usize = 16 * 1024; // 16 KB streaming buffer

#[derive(Debug)]
pub enum BlobStreamError {
    Io(std::io::Error),
    Json(serde_json::Error),
    NotFound(String),
    Unauthorized,
    IntegrityMismatch { expected: String, actual: String },
    Protocol(String),
}

impl std::fmt::Display for BlobStreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlobStreamError::Io(e) => write!(f, "IO error: {}", e),
            BlobStreamError::Json(e) => write!(f, "JSON serialization error: {}", e),
            BlobStreamError::NotFound(h) => write!(f, "Blob with hash {} not found", h),
            BlobStreamError::Unauthorized => write!(f, "Unauthorized blob request"),
            BlobStreamError::IntegrityMismatch { expected, actual } => {
                write!(f, "SHA-256 integrity mismatch: expected {}, got {}", expected, actual)
            }
            BlobStreamError::Protocol(s) => write!(f, "Protocol error: {}", s),
        }
    }
}

impl std::error::Error for BlobStreamError {}

impl From<std::io::Error> for BlobStreamError {
    fn from(e: std::io::Error) -> Self {
        BlobStreamError::Io(e)
    }
}

impl From<serde_json::Error> for BlobStreamError {
    fn from(e: serde_json::Error) -> Self {
        BlobStreamError::Json(e)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct BlobRequest {
    pub file_hash: String,
    pub auth_token: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum BlobResponseStatus {
    Ok,
    NotFound,
    Unauthorized,
    Error(String),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct BlobResponseHeader {
    pub status: BlobResponseStatus,
    pub file_hash: String,
    pub byte_size: u64,
}

fn write_length_prefixed_json<W: Write, T: Serialize>(writer: &mut W, data: &T) -> Result<(), BlobStreamError> {
    let json_bytes = serde_json::to_vec(data)?;
    let len = json_bytes.len() as u32;
    writer.write_all(&len.to_be_bytes())?;
    writer.write_all(&json_bytes)?;
    writer.flush()?;
    Ok(())
}

fn read_length_prefixed_json<R: Read, T: for<'a> Deserialize<'a>>(reader: &mut R) -> Result<T, BlobStreamError> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf)?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > 64 * 1024 {
        return Err(BlobStreamError::Protocol("Header JSON exceeds 64KB limit".to_string()));
    }
    let mut json_buf = vec![0u8; len];
    reader.read_exact(&mut json_buf)?;
    let val: T = serde_json::from_slice(&json_buf)?;
    Ok(val)
}

/// Handles an incoming blob request on a stream, authenticates, and streams the media file if present.
pub fn handle_blob_request<R: Read, W: Write, P: AsRef<Path>, F: Fn(&str) -> bool>(
    reader: &mut R,
    writer: &mut W,
    storage_dir: P,
    validate_token: F,
) -> Result<(), BlobStreamError> {
    let req: BlobRequest = read_length_prefixed_json(reader)?;

    if !validate_token(&req.auth_token) {
        let header = BlobResponseHeader {
            status: BlobResponseStatus::Unauthorized,
            file_hash: req.file_hash,
            byte_size: 0,
        };
        write_length_prefixed_json(writer, &header)?;
        return Ok(());
    }

    // Locate the file on disk under storage_dir/media/<file_hash>.webp or <file_hash>
    let media_dir = storage_dir.as_ref().join("media");
    let candidate_path = media_dir.join(format!("{}.webp", req.file_hash));
    let final_path = if candidate_path.exists() {
        candidate_path
    } else {
        media_dir.join(&req.file_hash)
    };

    if !final_path.exists() || !final_path.is_file() {
        let header = BlobResponseHeader {
            status: BlobResponseStatus::NotFound,
            file_hash: req.file_hash,
            byte_size: 0,
        };
        write_length_prefixed_json(writer, &header)?;
        return Ok(());
    }

    let mut file = File::open(&final_path)?;
    let metadata = file.metadata()?;
    let byte_size = metadata.len();

    let header = BlobResponseHeader {
        status: BlobResponseStatus::Ok,
        file_hash: req.file_hash,
        byte_size,
    };
    write_length_prefixed_json(writer, &header)?;

    // Stream the binary payload in chunks
    let mut buffer = [0u8; CHUNK_SIZE];
    let mut remaining = byte_size;

    while remaining > 0 {
        let to_read = (remaining as usize).min(CHUNK_SIZE);
        let n = file.read(&mut buffer[..to_read])?;
        if n == 0 {
            return Err(BlobStreamError::Protocol("Unexpected EOF reading local media file".to_string()));
        }
        writer.write_all(&buffer[..n])?;
        remaining -= n as u64;
    }

    writer.flush()?;
    Ok(())
}

/// Requests a media blob by its SHA-256 hash from a peer stream and verifies integrity before saving.
pub fn receive_blob_request<R: Read, W: Write, P: AsRef<Path>>(
    reader: &mut R,
    writer: &mut W,
    file_hash: &str,
    auth_token: &str,
    storage_dir: P,
) -> Result<PathBuf, BlobStreamError> {
    let req = BlobRequest {
        file_hash: file_hash.to_string(),
        auth_token: auth_token.to_string(),
    };
    write_length_prefixed_json(writer, &req)?;

    let header: BlobResponseHeader = read_length_prefixed_json(reader)?;

    match header.status {
        BlobResponseStatus::Ok => {}
        BlobResponseStatus::NotFound => return Err(BlobStreamError::NotFound(file_hash.to_string())),
        BlobResponseStatus::Unauthorized => return Err(BlobStreamError::Unauthorized),
        BlobResponseStatus::Error(msg) => return Err(BlobStreamError::Protocol(msg)),
    }

    let media_dir = storage_dir.as_ref().join("media");
    fs::create_dir_all(&media_dir)?;

    let target_filename = format!("{}.webp", file_hash);
    let target_path = media_dir.join(&target_filename);
    let temp_path = media_dir.join(format!("{}.tmp.{}", file_hash, uuid::Uuid::new_v4()));

    let mut temp_file = File::create(&temp_path)?;
    let mut hasher = Sha256::new();
    let mut remaining = header.byte_size;
    let mut buffer = [0u8; CHUNK_SIZE];

    while remaining > 0 {
        let to_read = (remaining as usize).min(CHUNK_SIZE);
        let n = reader.read(&mut buffer[..to_read])?;
        if n == 0 {
            let _ = fs::remove_file(&temp_path);
            return Err(BlobStreamError::Protocol("Unexpected EOF while receiving blob stream".to_string()));
        }
        hasher.update(&buffer[..n]);
        temp_file.write_all(&buffer[..n])?;
        remaining -= n as u64;
    }

    temp_file.flush()?;
    drop(temp_file);

    let actual_hash = format!("{:x}", hasher.finalize());
    if actual_hash != file_hash {
        let _ = fs::remove_file(&temp_path);
        return Err(BlobStreamError::IntegrityMismatch {
            expected: file_hash.to_string(),
            actual: actual_hash,
        });
    }

    // Atomically rename temp file to target path
    if let Err(e) = fs::rename(&temp_path, &target_path) {
        // Fallback for cross-device renames if any
        if let Ok(_) = fs::copy(&temp_path, &target_path) {
            let _ = fs::remove_file(&temp_path);
        } else {
            let _ = fs::remove_file(&temp_path);
            return Err(BlobStreamError::Io(e));
        }
    }

    Ok(target_path)
}

/// Connects to a peer's TCP address and streams down a media blob, saving it to `storage_dir/media/<hash>.webp`.
pub fn download_blob_over_tcp<P: AsRef<Path>>(
    peer_addr: &str,
    file_hash: &str,
    auth_token: &str,
    storage_dir: P,
) -> Result<PathBuf, BlobStreamError> {
    let mut stream = TcpStream::connect(peer_addr)?;
    let mut reader = stream.try_clone()?;
    receive_blob_request(&mut reader, &mut stream, file_hash, auth_token, storage_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;
    use crate::db::media::compute_sha256;

    fn setup_test_media_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("omnivault_blob_test_{}_{}", name, uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("media")).unwrap();
        dir
    }

    #[test]
    fn test_blob_streaming_success_over_tcp() {
        let server_dir = setup_test_media_dir("server");
        let client_dir = setup_test_media_dir("client");

        // Create a 64KB synthetic media file on server
        let test_data = vec![0xAB; 64 * 1024];
        let file_hash = compute_sha256(&test_data);
        let server_file_path = server_dir.join("media").join(format!("{}.webp", file_hash));
        fs::write(&server_file_path, &test_data).unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let server_addr = listener.local_addr().unwrap();
        let valid_token = "valid_auth_token_999";

        let s_dir = server_dir.clone();
        let v_token = valid_token.to_string();
        let server_handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = stream.try_clone().unwrap();
            handle_blob_request(&mut reader, &mut stream, &s_dir, |tok| tok == v_token).unwrap();
        });

        // Client downloads over TCP
        let downloaded_path = download_blob_over_tcp(
            &server_addr.to_string(),
            &file_hash,
            valid_token,
            &client_dir,
        ).unwrap();

        server_handle.join().unwrap();

        assert!(downloaded_path.exists());
        let downloaded_bytes = fs::read(&downloaded_path).unwrap();
        assert_eq!(downloaded_bytes.len(), 64 * 1024);
        assert_eq!(compute_sha256(&downloaded_bytes), file_hash);

        // Cleanup
        let _ = fs::remove_dir_all(&server_dir);
        let _ = fs::remove_dir_all(&client_dir);
    }

    #[test]
    fn test_blob_streaming_unauthorized() {
        let server_dir = setup_test_media_dir("server_auth");
        let client_dir = setup_test_media_dir("client_auth");

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let server_addr = listener.local_addr().unwrap();

        let s_dir = server_dir.clone();
        let server_handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = stream.try_clone().unwrap();
            handle_blob_request(&mut reader, &mut stream, &s_dir, |tok| tok == "good_token").unwrap();
        });

        let res = download_blob_over_tcp(
            &server_addr.to_string(),
            "dummyhash",
            "wrong_token",
            &client_dir,
        );

        server_handle.join().unwrap();

        match res {
            Err(BlobStreamError::Unauthorized) => {}
            other => panic!("Expected Unauthorized, got: {:?}", other),
        }

        let _ = fs::remove_dir_all(&server_dir);
        let _ = fs::remove_dir_all(&client_dir);
    }

    #[test]
    fn test_blob_streaming_not_found() {
        let server_dir = setup_test_media_dir("server_nf");
        let client_dir = setup_test_media_dir("client_nf");

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let server_addr = listener.local_addr().unwrap();

        let s_dir = server_dir.clone();
        let server_handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = stream.try_clone().unwrap();
            handle_blob_request(&mut reader, &mut stream, &s_dir, |_| true).unwrap();
        });

        let res = download_blob_over_tcp(
            &server_addr.to_string(),
            "missing_file_hash_123",
            "token",
            &client_dir,
        );

        server_handle.join().unwrap();

        match res {
            Err(BlobStreamError::NotFound(h)) => assert_eq!(h, "missing_file_hash_123"),
            other => panic!("Expected NotFound, got: {:?}", other),
        }

        let _ = fs::remove_dir_all(&server_dir);
        let _ = fs::remove_dir_all(&client_dir);
    }

    #[test]
    fn test_blob_streaming_integrity_mismatch_rejected() {
        let client_dir = setup_test_media_dir("client_tamper");

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let server_addr = listener.local_addr().unwrap();

        let honest_hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

        let server_handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = stream.try_clone().unwrap();
            let _req: BlobRequest = read_length_prefixed_json(&mut reader).unwrap();

            // Deliberately send header claiming honest_hash, but send corrupted bytes!
            let header = BlobResponseHeader {
                status: BlobResponseStatus::Ok,
                file_hash: honest_hash.to_string(),
                byte_size: 16,
            };
            write_length_prefixed_json(&mut stream, &header).unwrap();
            let corrupted_bytes = vec![0xFF; 16];
            stream.write_all(&corrupted_bytes).unwrap();
            stream.flush().unwrap();
        });

        let res = download_blob_over_tcp(
            &server_addr.to_string(),
            honest_hash,
            "token",
            &client_dir,
        );

        server_handle.join().unwrap();

        match res {
            Err(BlobStreamError::IntegrityMismatch { expected, actual }) => {
                assert_eq!(expected, honest_hash);
                assert_ne!(actual, honest_hash);
            }
            other => panic!("Expected IntegrityMismatch, got: {:?}", other),
        }

        // Verify corrupted file was NOT saved in media/
        let target_path = client_dir.join("media").join(format!("{}.webp", honest_hash));
        assert!(!target_path.exists());

        let _ = fs::remove_dir_all(&client_dir);
    }
}
