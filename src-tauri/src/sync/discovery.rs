use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;
use tokio::sync::RwLock;

pub const DISCOVERY_PORT: u16 = 42424;
pub const MULTICAST_IPV4: Ipv4Addr = Ipv4Addr::new(239, 255, 42, 99);
pub const PROTOCOL_IDENTIFIER: &str = "omnivault-v1";
pub const PEER_EXPIRY_SECONDS: i64 = 15;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryBeacon {
    pub protocol: String,
    pub device_id: String,
    pub device_name: String,
    pub sync_port: u16,
    pub timestamp: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PeerInfo {
    pub device_id: String,
    pub device_name: String,
    pub sync_port: u16,
    pub addr: IpAddr,
    pub last_seen: i64,
}

#[derive(Clone, Default)]
pub struct PeerRegistry {
    peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
}

impl PeerRegistry {
    pub fn new() -> Self {
        Self {
            peers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register_or_update(&self, peer: PeerInfo) {
        let mut lock = self.peers.write().await;
        lock.insert(peer.device_id.clone(), peer);
    }

    pub async fn get_active_peers(&self) -> Vec<PeerInfo> {
        let now = Utc::now().timestamp();
        let mut lock = self.peers.write().await;
        // Purge expired peers
        lock.retain(|_, p| (now - p.last_seen) < PEER_EXPIRY_SECONDS);
        lock.values().cloned().collect()
    }

    pub async fn get_peer(&self, device_id: &str) -> Option<PeerInfo> {
        let lock = self.peers.read().await;
        lock.get(device_id).cloned()
    }

    pub async fn peer_count(&self) -> usize {
        let lock = self.peers.read().await;
        lock.len()
    }

    pub fn try_get_active_peers(&self) -> Vec<PeerInfo> {
        let now = Utc::now().timestamp();
        if let Ok(lock) = self.peers.try_read() {
            lock.values()
                .filter(|p| (now - p.last_seen) < PEER_EXPIRY_SECONDS)
                .cloned()
                .collect()
        } else {
            Vec::new()
        }
    }
}

pub fn create_multicast_socket(port: u16) -> std::io::Result<std::net::UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;

    #[cfg(all(unix, not(target_os = "android")))]
    {
        let _ = socket.set_reuse_port(true);
    }

    socket.set_broadcast(true)?;
    socket.set_multicast_loop_v4(true)?;

    let bind_addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port);
    socket.bind(&bind_addr.into())?;

    // Join multicast group
    let _ = socket.join_multicast_v4(&MULTICAST_IPV4, &Ipv4Addr::UNSPECIFIED);

    socket.set_nonblocking(true)?;
    Ok(socket.into())
}

pub struct DiscoveryService {
    device_id: String,
    device_name: String,
    sync_port: u16,
    registry: PeerRegistry,
}

impl DiscoveryService {
    pub fn new(device_id: String, device_name: String, sync_port: u16) -> Self {
        Self {
            device_id,
            device_name,
            sync_port,
            registry: PeerRegistry::new(),
        }
    }

    pub fn registry(&self) -> PeerRegistry {
        self.registry.clone()
    }

    pub fn build_beacon(&self) -> DiscoveryBeacon {
        DiscoveryBeacon {
            protocol: PROTOCOL_IDENTIFIER.to_string(),
            device_id: self.device_id.clone(),
            device_name: self.device_name.clone(),
            sync_port: self.sync_port,
            timestamp: Utc::now().timestamp_millis(),
        }
    }

    pub async fn run_broadcaster(
        device_id: String,
        device_name: String,
        sync_port: u16,
        interval_secs: u64,
        stop_rx: tokio::sync::watch::Receiver<bool>,
    ) -> std::io::Result<()> {
        let socket = UdpSocket::bind("0.0.0.0:0").await?;
        socket.set_broadcast(true)?;

        let multicast_target = SocketAddr::V4(SocketAddrV4::new(MULTICAST_IPV4, DISCOVERY_PORT));
        let broadcast_target = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::BROADCAST, DISCOVERY_PORT));

        let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));
        let mut stop = stop_rx;

        while !*stop.borrow() {
            tokio::select! {
                _ = interval.tick() => {
                    let beacon = DiscoveryBeacon {
                        protocol: PROTOCOL_IDENTIFIER.to_string(),
                        device_id: device_id.clone(),
                        device_name: device_name.clone(),
                        sync_port,
                        timestamp: Utc::now().timestamp_millis(),
                    };

                    if let Ok(bytes) = serde_json::to_vec(&beacon) {
                        // Send over multicast
                        let _ = socket.send_to(&bytes, multicast_target).await;
                        // Also send over standard LAN broadcast for networks with multicast filtering
                        let _ = socket.send_to(&bytes, broadcast_target).await;
                    }
                }
                _ = stop.changed() => {
                    if *stop.borrow() {
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    pub async fn run_listener(
        my_device_id: String,
        registry: PeerRegistry,
        stop_rx: tokio::sync::watch::Receiver<bool>,
    ) -> std::io::Result<()> {
        let std_socket = create_multicast_socket(DISCOVERY_PORT)?;
        let socket = UdpSocket::from_std(std_socket)?;
        let mut buf = vec![0u8; 4096];
        let mut stop = stop_rx;

        while !*stop.borrow() {
            tokio::select! {
                recv_res = socket.recv_from(&mut buf) => {
                    if let Ok((len, src_addr)) = recv_res {
                        if let Ok(beacon) = serde_json::from_slice::<DiscoveryBeacon>(&buf[..len]) {
                            if beacon.protocol == PROTOCOL_IDENTIFIER && beacon.device_id != my_device_id {
                                let peer = PeerInfo {
                                    device_id: beacon.device_id,
                                    device_name: beacon.device_name,
                                    sync_port: beacon.sync_port,
                                    addr: src_addr.ip(),
                                    last_seen: Utc::now().timestamp(),
                                };
                                registry.register_or_update(peer).await;
                            }
                        }
                    }
                }
                _ = stop.changed() => {
                    if *stop.borrow() {
                        break;
                    }
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_beacon_serialization() {
        let beacon = DiscoveryBeacon {
            protocol: PROTOCOL_IDENTIFIER.to_string(),
            device_id: "phone-uuid-123".to_string(),
            device_name: "Pixel 9 Pro".to_string(),
            sync_port: 42425,
            timestamp: 1725800000000,
        };

        let json = serde_json::to_string(&beacon).unwrap();
        assert!(json.contains("omnivault-v1"));
        assert!(json.contains("Pixel 9 Pro"));

        let decoded: DiscoveryBeacon = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, beacon);
    }

    #[tokio::test]
    async fn test_peer_registry_expiry() {
        let registry = PeerRegistry::new();
        let now = Utc::now().timestamp();

        let active_peer = PeerInfo {
            device_id: "laptop-1".to_string(),
            device_name: "Dev Laptop".to_string(),
            sync_port: 42424,
            addr: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 50)),
            last_seen: now,
        };

        let stale_peer = PeerInfo {
            device_id: "old-tablet".to_string(),
            device_name: "Old Tablet".to_string(),
            sync_port: 42424,
            addr: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 99)),
            last_seen: now - 30, // 30s ago (exceeds 15s PEER_EXPIRY_SECONDS)
        };

        registry.register_or_update(active_peer.clone()).await;
        registry.register_or_update(stale_peer).await;

        assert_eq!(registry.peer_count().await, 2);

        // get_active_peers should purge the stale peer
        let active_list = registry.get_active_peers().await;
        assert_eq!(active_list.len(), 1);
        assert_eq!(active_list[0].device_id, "laptop-1");
        assert_eq!(registry.peer_count().await, 1);
    }

    #[tokio::test]
    async fn test_simulated_peer_discovery() {
        let registry = PeerRegistry::new();
        let my_device_id = "device-a";

        // Simulate incoming beacon from Device B
        let beacon_b = DiscoveryBeacon {
            protocol: PROTOCOL_IDENTIFIER.to_string(),
            device_id: "device-b".to_string(),
            device_name: "Mobile Phone".to_string(),
            sync_port: 42426,
            timestamp: Utc::now().timestamp_millis(),
        };

        // If beacon arrives from self, it should be filtered out
        let beacon_self = DiscoveryBeacon {
            protocol: PROTOCOL_IDENTIFIER.to_string(),
            device_id: my_device_id.to_string(),
            device_name: "Laptop".to_string(),
            sync_port: 42424,
            timestamp: Utc::now().timestamp_millis(),
        };

        // Ingest beacons into registry with self-filter
        for b in [beacon_b, beacon_self] {
            if b.protocol == PROTOCOL_IDENTIFIER && b.device_id != my_device_id {
                registry.register_or_update(PeerInfo {
                    device_id: b.device_id,
                    device_name: b.device_name,
                    sync_port: b.sync_port,
                    addr: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 120)),
                    last_seen: Utc::now().timestamp(),
                }).await;
            }
        }

        let peers = registry.get_active_peers().await;
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].device_id, "device-b");
        assert_eq!(peers[0].device_name, "Mobile Phone");
        assert_eq!(peers[0].sync_port, 42426);
    }
}
