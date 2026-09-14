use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairedDevice {
    pub device_id: String,
    pub device_name: String,
    pub auth_token: String,
    pub paired_at: i64,
    pub last_sync_at: Option<i64>,
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

    // Compare in constant time: `==` returns on the first differing byte, and
    // this token is the only thing standing between a LAN peer and the vault.
    Ok(match stored_token {
        Some(t) => {
            let a = t.as_bytes();
            let b = token.as_bytes();
            let mut diff = (a.len() ^ b.len()) as u8;
            for i in 0..a.len().max(b.len()) {
                diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(1);
            }
            diff == 0
        }
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

    /// The lifecycle of a paired device, through the same functions the
    /// running app uses. The PIN handshake itself lives in http_server.
    #[test]
    fn a_paired_device_can_be_stored_validated_and_removed() {
        let conn = setup_test_db();
        let peer_id = "phone-dev-123";
        let token = "a".repeat(64);

        assert!(!is_device_paired(&conn, peer_id).unwrap());
        store_paired_device(&conn, peer_id, "Pad Go", &token).unwrap();
        assert!(is_device_paired(&conn, peer_id).unwrap());

        assert!(validate_peer_auth_token(&conn, peer_id, &token).unwrap());
        assert!(!validate_peer_auth_token(&conn, peer_id, "invalid-token").unwrap());
        // A prefix of the real token must not pass.
        assert!(!validate_peer_auth_token(&conn, peer_id, &"a".repeat(63)).unwrap());
        assert!(!validate_peer_auth_token(&conn, "someone-else", &token).unwrap());

        update_peer_last_sync(&conn, peer_id).unwrap();
        let list = list_paired_devices(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].last_sync_at.is_some());

        unpair_device(&conn, peer_id).unwrap();
        assert!(!is_device_paired(&conn, peer_id).unwrap());
        assert!(!validate_peer_auth_token(&conn, peer_id, &token).unwrap());
    }
}
