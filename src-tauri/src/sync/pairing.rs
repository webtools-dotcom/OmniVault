use std::collections::HashMap;
use std::sync::Arc;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use uuid::Uuid;

pub const PAIRING_PIN_TTL_SECONDS: i64 = 120; // 2 minutes

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairedDevice {
    pub device_id: String,
    pub device_name: String,
    pub auth_token: String,
    pub paired_at: i64,
    pub last_sync_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct PendingPairing {
    pub peer_device_id: String,
    pub peer_name: String,
    pub pin: String,
    pub expires_at: i64,
}

#[derive(Debug)]
pub enum PairingError {
    Db(rusqlite::Error),
    InvalidPin,
    Expired,
    NotFound,
}

impl std::fmt::Display for PairingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PairingError::Db(e) => write!(f, "Database error: {}", e),
            PairingError::InvalidPin => write!(f, "Invalid PIN provided"),
            PairingError::Expired => write!(f, "Pairing PIN expired"),
            PairingError::NotFound => write!(f, "Pending pairing request not found"),
        }
    }
}

impl std::error::Error for PairingError {}

impl From<rusqlite::Error> for PairingError {
    fn from(e: rusqlite::Error) -> Self {
        PairingError::Db(e)
    }
}

#[derive(Clone, Default)]
pub struct PairingManager {
    pending: Arc<RwLock<HashMap<String, PendingPairing>>>,
}

impl PairingManager {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Generates a deterministic-length 6-digit PIN and stores pending session
    pub async fn create_pairing_request(&self, peer_device_id: &str, peer_name: &str) -> String {
        let now = Utc::now().timestamp();
        // Generate pseudo-random 6-digit pin from UUID entropy
        let entropy = Uuid::new_v4().as_u128();
        let pin = format!("{:06}", (entropy % 900_000) + 100_000);

        let mut lock = self.pending.write().await;
        lock.insert(
            peer_device_id.to_string(),
            PendingPairing {
                peer_device_id: peer_device_id.to_string(),
                peer_name: peer_name.to_string(),
                pin: pin.clone(),
                expires_at: now + PAIRING_PIN_TTL_SECONDS,
            },
        );

        pin
    }

    /// Verifies the 6-digit PIN and authorizes the peer
    pub async fn verify_and_pair(
        &self,
        conn: &Connection,
        peer_device_id: &str,
        pin_attempt: &str,
    ) -> std::result::Result<PairedDevice, PairingError> {
        let now = Utc::now().timestamp();
        let pending = {
            let mut lock = self.pending.write().await;
            lock.remove(peer_device_id).ok_or(PairingError::NotFound)?
        };

        if now > pending.expires_at {
            return Err(PairingError::Expired);
        }

        if pending.pin != pin_attempt.trim() {
            return Err(PairingError::InvalidPin);
        }

        // Generate persistent auth token (SHA-256 of high entropy UUID)
        let token_seed = format!("{}:{}:{}", peer_device_id, Uuid::new_v4(), now);
        let mut hasher = Sha256::new();
        hasher.update(token_seed.as_bytes());
        let auth_token = format!("{:x}", hasher.finalize());

        let now_ms = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO paired_devices (device_id, device_name, auth_token, paired_at, last_sync_at)
             VALUES (?1, ?2, ?3, ?4, NULL)
             ON CONFLICT(device_id) DO UPDATE SET
                device_name = excluded.device_name,
                auth_token = excluded.auth_token,
                paired_at = excluded.paired_at",
            params![peer_device_id, pending.peer_name, auth_token, now_ms],
        )?;

        Ok(PairedDevice {
            device_id: peer_device_id.to_string(),
            device_name: pending.peer_name,
            auth_token,
            paired_at: now_ms,
            last_sync_at: None,
        })
    }
}

// ---------------------------------------------------------------------------
// Database Queries for Paired Devices
// ---------------------------------------------------------------------------

pub fn store_paired_device(
    conn: &Connection,
    device_id: &str,
    device_name: &str,
    auth_token: &str,
) -> Result<PairedDevice> {
    let now = Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO paired_devices (device_id, device_name, auth_token, paired_at, last_sync_at)
         VALUES (?1, ?2, ?3, ?4, NULL)
         ON CONFLICT(device_id) DO UPDATE SET
            device_name = excluded.device_name,
            auth_token = excluded.auth_token",
        params![device_id, device_name, auth_token, now],
    )?;

    Ok(PairedDevice {
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        auth_token: auth_token.to_string(),
        paired_at: now,
        last_sync_at: None,
    })
}

pub fn is_device_paired(conn: &Connection, device_id: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM paired_devices WHERE device_id = ?1",
        [device_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn validate_peer_auth_token(conn: &Connection, device_id: &str, token: &str) -> Result<bool> {
    let stored_token: Option<String> = conn
        .query_row(
            "SELECT auth_token FROM paired_devices WHERE device_id = ?1",
            [device_id],
            |row| row.get(0),
        )
        .optional()?;

    Ok(match stored_token {
        Some(t) => t == token,
        None => false,
    })
}

pub fn update_peer_last_sync(conn: &Connection, device_id: &str) -> Result<()> {
    let now = Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE paired_devices SET last_sync_at = ?1 WHERE device_id = ?2",
        params![now, device_id],
    )?;
    Ok(())
}

pub fn list_paired_devices(conn: &Connection) -> Result<Vec<PairedDevice>> {
    let mut stmt = conn.prepare(
        "SELECT device_id, device_name, auth_token, paired_at, last_sync_at
         FROM paired_devices ORDER BY paired_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(PairedDevice {
            device_id: row.get(0)?,
            device_name: row.get(1)?,
            auth_token: row.get(2)?,
            paired_at: row.get(3)?,
            last_sync_at: row.get(4)?,
        })
    })?;

    let mut devices = Vec::new();
    for d in rows {
        devices.push(d?);
    }
    Ok(devices)
}

pub fn unpair_device(conn: &Connection, device_id: &str) -> Result<()> {
    conn.execute("DELETE FROM paired_devices WHERE device_id = ?1", [device_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::initialize_schema;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        conn
    }

    #[tokio::test]
    async fn test_pairing_handshake_flow() {
        let conn = setup_test_db();
        let manager = PairingManager::new();

        let peer_id = "phone-dev-123";
        let peer_name = "iPhone 15";

        // 1. Initiate pairing request -> returns 6-digit PIN
        let pin = manager.create_pairing_request(peer_id, peer_name).await;
        assert_eq!(pin.len(), 6);
        assert!(pin.chars().all(|c| c.is_ascii_digit()));

        // 2. Reject incorrect PIN
        let bad_attempt = manager.verify_and_pair(&conn, peer_id, "000000").await;
        assert!(matches!(bad_attempt, Err(PairingError::InvalidPin)));

        // Re-create request for valid verify
        let valid_pin = manager.create_pairing_request(peer_id, peer_name).await;

        // 3. Confirm with valid PIN
        let paired = manager.verify_and_pair(&conn, peer_id, &valid_pin).await.unwrap();
        assert_eq!(paired.device_id, peer_id);
        assert_eq!(paired.device_name, peer_name);
        assert!(!paired.auth_token.is_empty());

        // 4. Verify device is recorded as paired in DB
        assert!(is_device_paired(&conn, peer_id).unwrap());

        // 5. Verify cryptographic auth token validation
        assert!(validate_peer_auth_token(&conn, peer_id, &paired.auth_token).unwrap());
        assert!(!validate_peer_auth_token(&conn, peer_id, "invalid-token").unwrap());

        // 6. Update last sync timestamp
        update_peer_last_sync(&conn, peer_id).unwrap();
        let list = list_paired_devices(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].last_sync_at.is_some());

        // 7. Unpair device
        unpair_device(&conn, peer_id).unwrap();
        assert!(!is_device_paired(&conn, peer_id).unwrap());
    }
}
