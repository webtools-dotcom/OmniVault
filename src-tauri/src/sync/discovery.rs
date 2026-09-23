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
const MAX_TRACKED_PEERS: usize = 64;
const MAX_PEER_NAME_CHARS: usize = 64;
/// At the 5 s beacon interval, a full sweep every 30 s.
const SWEEP_EVERY_TICKS: u64 = 6;

/// Every host address in `ip`'s /24 and its neighbouring /24 — that is, its
/// /23 — which covers home routers, phone hotspots and most shared Wi-Fi.
// ponytail: assumes the LAN is at most a /23; read the real netmask if a
// larger campus network needs it.
pub fn sweep_targets(ip: Ipv4Addr) -> Vec<Ipv4Addr> {
    let [a, b, c, _] = ip.octets();
    [c & !1, c | 1]
        .into_iter()
        .flat_map(|c| (1..=254).map(move |d| Ipv4Addr::new(a, b, c, d)))
        .collect()
}

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

    pub async fn register_or_update(&self, mut peer: PeerInfo) {
        // Beacons are unauthenticated by nature, so anything in one is a claim,
        // not a fact: a name is truncated before it reaches the UI, and the
        // registry is capped so a flood of invented device ids cannot grow it
        // without bound or point the sync loop at hundreds of made-up peers.
        if peer.device_name.chars().count() > MAX_PEER_NAME_CHARS {
            peer.device_name = peer.device_name.chars().take(MAX_PEER_NAME_CHARS).collect();
        }

        let mut lock = self.peers.write().await;
        if !lock.contains_key(&peer.device_id) && lock.len() >= MAX_TRACKED_PEERS {
            let now = Utc::now().timestamp();
            lock.retain(|_, p| (now - p.last_seen) < PEER_EXPIRY_SECONDS);
            if lock.len() >= MAX_TRACKED_PEERS {
                return;
            }
        }
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

    /// Announces this device every `interval_secs`.
    ///
    /// Multicast and broadcast alone are not enough: large shared Wi-Fi (a
    /// hostel, a campus, an office) commonly drops both between clients while
    /// passing ordinary unicast, and there the two apps never heard of each
    /// other and the only way to connect was typing an IP address. So every
    /// tick also goes directly to each peer already known, which keeps it from
    /// expiring, and every `SWEEP_EVERY_TICKS` the beacon goes directly to
    /// every address on the local network. A device that hears from someone new
    /// answers directly (see `run_listener`), so one sweep introduces both
    /// sides. See D-090.
    pub async fn run_broadcaster(
        device_id: String,
        device_name: String,
        sync_port: u16,
        interval_secs: u64,
        registry: PeerRegistry,
        stop_rx: tokio::sync::watch::Receiver<bool>,
    ) -> std::io::Result<()> {
        let socket = UdpSocket::bind("0.0.0.0:0").await?;
        socket.set_broadcast(true)?;

        let multicast_target = SocketAddr::V4(SocketAddrV4::new(MULTICAST_IPV4, DISCOVERY_PORT));
        let broadcast_target = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::BROADCAST, DISCOVERY_PORT));

        let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));
        let mut stop = stop_rx;
        let mut tick: u64 = 0;

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

                        for peer in registry.get_active_peers().await {
                            let _ = socket.send_to(&bytes, SocketAddr::new(peer.addr, DISCOVERY_PORT)).await;
                        }

                        if tick % SWEEP_EVERY_TICKS == 0 {
                            let own_ip = crate::http_server::find_local_lan_ip()
                                .and_then(|ip| ip.parse::<Ipv4Addr>().ok());
                            if let Some(ip) = own_ip {
                                for target in sweep_targets(ip) {
                                    let _ = socket
                                        .send_to(&bytes, SocketAddr::V4(SocketAddrV4::new(target, DISCOVERY_PORT)))
                                        .await;
                                }
                            }
                        }
                    }
                    tick += 1;
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

    /// Records every device whose beacon arrives, and answers a device heard
    /// from for the first time directly, so a sweep that reaches us introduces
    /// us back even where broadcasts are dropped. Only a first contact is
    /// answered, so two devices cannot keep replying to each other.
    pub async fn run_listener(
        my_beacon: DiscoveryBeacon,
        registry: PeerRegistry,
        stop_rx: tokio::sync::watch::Receiver<bool>,
    ) -> std::io::Result<()> {
        let my_device_id = my_beacon.device_id.clone();
        let reply = serde_json::to_vec(&my_beacon).unwrap_or_default();
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
                                if registry.get_peer(&beacon.device_id).await.is_none() {
                                    let _ = socket.send_to(&reply, SocketAddr::new(src_addr.ip(), DISCOVERY_PORT)).await;
                                }
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
    fn a_sweep_covers_both_halves_of_the_slash_23_and_nothing_else() {
        // The hostel network this was found on: laptop .1.145, tablet .1.233,
        // and the /23 also holds 172.17.0.x.
        let targets = sweep_targets(Ipv4Addr::new(172, 17, 1, 145));
        assert_eq!(targets.len(), 508);
        assert!(targets.contains(&Ipv4Addr::new(172, 17, 1, 233)));
        assert!(targets.contains(&Ipv4Addr::new(172, 17, 0, 7)));
        assert!(!targets.contains(&Ipv4Addr::new(172, 17, 2, 7)));
        assert!(!targets.iter().any(|t| t.octets()[3] == 0 || t.octets()[3] == 255));
        // An even third octet sweeps the same pair from the other side.
        assert_eq!(sweep_targets(Ipv4Addr::new(172, 17, 0, 9)), targets);
    }

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

    #[tokio::test]
    async fn a_beacon_flood_cannot_grow_the_registry_without_bound() {
        let registry = PeerRegistry::new();
        let now = Utc::now().timestamp();
        for i in 0..500 {
            registry
                .register_or_update(PeerInfo {
                    device_id: format!("spoofed-{i}"),
                    device_name: "x".repeat(4000),
                    sync_port: 42420,
                    addr: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
                    last_seen: now,
                })
                .await;
        }
        assert_eq!(registry.peer_count().await, MAX_TRACKED_PEERS);
        let peers = registry.get_active_peers().await;
        assert!(peers.iter().all(|p| p.device_name.chars().count() <= MAX_PEER_NAME_CHARS));
    }
}
