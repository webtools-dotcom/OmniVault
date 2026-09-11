import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Check,
  Copy,
  Laptop,
  Radio,
  RefreshCw,
  ShieldCheck,
  Tablet,
  Wifi,
  X,
  QrCode,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { Button } from "../common/Button";
import { generateQrMatrix, generateQrPath } from "../../utils/qrCode";
import { StorageService } from "../../services/storageService";
import { PeerInfo, MeshSyncState } from "../../types";

export interface QrConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncTriggered?: () => void;
}

export const QrConnectModal: React.FC<QrConnectModalProps> = ({
  isOpen,
  onClose,
  onSyncTriggered,
}) => {
  const [activeTab, setActiveTab] = useState<"mesh" | "browser">("mesh");
  const [lanInfo, setLanInfo] = useState<{ ip: string; port: number; url: string }>({
    ip: "127.0.0.1",
    port: 42420,
    url: "http://localhost:42420",
  });
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPin, setCopiedPin] = useState(false);
  const [pairingPin, setPairingPin] = useState<string>("749 201");

  // Mesh peer state
  const [meshState, setMeshState] = useState<MeshSyncState>({
    status: "standby",
    peerCount: 0,
    peers: [],
    pairedDeviceIds: [],
  });
  const [isSyncingManual, setIsSyncingManual] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Inline pairing form state per peer device_id
  const [pairingPeerId, setPairingPeerId] = useState<string | null>(null);
  const [peerPinInput, setPeerPinInput] = useState<string>("");
  const [isPairingSubmit, setIsPairingSubmit] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairSuccess, setPairSuccess] = useState<string | null>(null);

  const fetchMeshStatus = useCallback(async () => {
    try {
      const state = await StorageService.getMeshSyncStatus();
      setMeshState(state);
    } catch {
      // Ignore
    }
  }, []);

  // Fetch initial info on open
  useEffect(() => {
    if (isOpen) {
      StorageService.getLanConnectionInfo().then((info) => {
        setLanInfo(info);
      });
      StorageService.getPairingSession().then((session) => {
        if (session && session.pin) {
          setPairingPin(session.pin);
        }
      });
      fetchMeshStatus();
      setCopiedUrl(false);
      setCopiedPin(false);
      setSyncFeedback(null);
      setPairingPeerId(null);
      setPairError(null);
      setPairSuccess(null);
    }
  }, [isOpen, fetchMeshStatus]);

  // Periodic poll for mesh status while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      fetchMeshStatus();
    }, 2500);
    return () => clearInterval(interval);
  }, [isOpen, fetchMeshStatus]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Generate QR Matrix and SVG Path
  const { qrPath, size } = useMemo(() => {
    try {
      const matrix = generateQrMatrix(lanInfo.url);
      const path = generateQrPath(matrix);
      return { qrPath: path, size: matrix.length };
    } catch {
      return { qrPath: "", size: 21 };
    }
  }, [lanInfo.url]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(lanInfo.url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (err) {
      console.warn("Failed to copy URL:", err);
    }
  };

  const handleCopyPin = async () => {
    try {
      await navigator.clipboard.writeText(pairingPin.replace(/\s+/g, ""));
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 2000);
    } catch (err) {
      console.warn("Failed to copy PIN:", err);
    }
  };

  const handleManualSync = async () => {
    setIsSyncingManual(true);
    setSyncFeedback(null);
    try {
      const count = await StorageService.triggerMeshSync();
      await fetchMeshStatus();
      onSyncTriggered?.();
      setSyncFeedback(count > 0 ? `Synced ${count} item${count > 1 ? "s" : ""}!` : "Vault is up to date");
    } catch (err) {
      setSyncFeedback("Sync check complete");
    } finally {
      setIsSyncingManual(false);
      setTimeout(() => setSyncFeedback(null), 3000);
    }
  };

  const handlePairPeer = async (peer: PeerInfo) => {
    const pin = peerPinInput.trim();
    if (!pin) {
      setPairError("Please enter the 6-digit PIN shown on the remote device");
      return;
    }

    setIsPairingSubmit(true);
    setPairError(null);
    setPairSuccess(null);

    const res = await StorageService.pairWithPeer(peer.addr, peer.sync_port, pin);
    setIsPairingSubmit(false);

    if (res.success) {
      setPairSuccess(`Paired with ${peer.device_name}!`);
      setPairingPeerId(null);
      setPeerPinInput("");
      await StorageService.triggerMeshSync();
      await fetchMeshStatus();
      onSyncTriggered?.();
      setTimeout(() => setPairSuccess(null), 3500);
    } else {
      setPairError(res.error || "Pairing failed. Check the PIN and try again.");
    }
  };

  if (!isOpen) return null;

  const viewBoxSize = size + 8;
  const activePeers = meshState.peers || [];
  const pairedIds = meshState.pairedDeviceIds || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg bg-vault-card/95 border border-white/[0.12] rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl ring-1 ring-white/[0.05] overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.18)]">
              <Wifi className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 id="qr-modal-title" className="text-sm font-bold text-vault-primary tracking-tight">
                Connect & Sync Devices
              </h2>
              <p className="text-[11px] text-vault-muted font-medium">
                Local Wi-Fi mesh network • Zero cloud dependence
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-vault-muted hover:text-vault-primary rounded-lg p-1.5 hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 pb-0 border-b border-white/[0.06] bg-white/[0.01] flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("mesh")}
            className={`flex items-center gap-2 pb-2.5 px-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === "mesh"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-vault-muted hover:text-vault-secondary"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Mesh Network</span>
            {activePeers.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-blue-500/20 text-blue-300 text-[10px] font-bold rounded-full">
                {activePeers.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("browser")}
            className={`flex items-center gap-2 pb-2.5 px-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === "browser"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-vault-muted hover:text-vault-secondary"
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Browser Access (QR)</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {activeTab === "mesh" ? (
            <>
              {/* Mesh Header & Sync All Action */}
              <div className="flex items-center justify-between p-3.5 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                    <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-40" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-vault-primary block">
                      Wi-Fi Discovery Active
                    </span>
                    <span className="text-[10px] text-vault-muted">
                      {activePeers.length > 0
                        ? `${activePeers.length} device${activePeers.length > 1 ? "s" : ""} online on local network`
                        : "Listening for local OmniVault devices via UDP"}
                    </span>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleManualSync}
                  disabled={isSyncingManual}
                  className="h-8 px-3 text-xs font-semibold shrink-0 gap-1.5"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncingManual ? "animate-spin text-blue-400" : ""}`} />
                  <span>{isSyncingManual ? "Syncing..." : "Sync All"}</span>
                </Button>
              </div>

              {/* Sync Feedback Toast */}
              {syncFeedback && (
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium">{syncFeedback}</span>
                </div>
              )}

              {pairSuccess && (
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium">{pairSuccess}</span>
                </div>
              )}

              {pairError && (
                <div className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium">{pairError}</span>
                </div>
              )}

              {/* Discovered LAN Peers List */}
              <div className="space-y-2.5">
                <div className="text-[11px] font-semibold text-vault-secondary uppercase tracking-wider flex items-center justify-between">
                  <span>Discovered Wi-Fi Peers</span>
                  <span className="text-[10px] text-vault-muted font-normal">
                    {activePeers.length} discovered
                  </span>
                </div>

                {activePeers.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] text-center space-y-2">
                    <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto text-blue-400">
                      <Radio className="w-5 h-5 animate-pulse" />
                    </div>
                    <h3 className="text-xs font-semibold text-vault-primary">
                      Searching local Wi-Fi mesh...
                    </h3>
                    <p className="text-[11px] text-vault-muted max-w-xs mx-auto leading-relaxed">
                      Connect your laptop, tablet, and phone to the same Wi-Fi or mobile hotspot. Devices discover each other automatically.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activePeers.map((peer) => {
                      const isPaired = pairedIds.includes(peer.device_id);
                      const isDesktop = peer.device_name.toLowerCase().includes("desktop");
                      const isPairingThis = pairingPeerId === peer.device_id;

                      return (
                        <div
                          key={peer.device_id}
                          className="p-3.5 bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.08] rounded-2xl transition-all space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-vault-secondary">
                                {isDesktop ? (
                                  <Laptop className="w-4 h-4 text-blue-400" />
                                ) : (
                                  <Tablet className="w-4 h-4 text-emerald-400" />
                                )}
                              </div>
                              <div className="text-left">
                                <div className="text-xs font-semibold text-vault-primary flex items-center gap-1.5">
                                  <span>{peer.device_name}</span>
                                  {isPaired && (
                                    <span className="px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold rounded-md">
                                      Paired
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono text-vault-muted">
                                  {peer.addr}:{peer.sync_port}
                                </div>
                              </div>
                            </div>

                            <div>
                              {isPaired ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-[11px] font-medium rounded-xl border border-emerald-500/20">
                                  <Check className="w-3 h-3" />
                                  <span>Auto-Syncing</span>
                                </span>
                              ) : (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => {
                                    setPairingPeerId(isPairingThis ? null : peer.device_id);
                                    setPeerPinInput("");
                                    setPairError(null);
                                  }}
                                  className="h-7 px-2.5 text-xs font-semibold rounded-lg"
                                >
                                  {isPairingThis ? "Cancel" : "Pair Device"}
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Inline PIN Entry for Unpaired Device */}
                          {isPairingThis && !isPaired && (
                            <div className="pt-2 border-t border-white/[0.06] space-y-2 animate-in fade-in">
                              <label className="text-[10px] font-mono text-vault-muted block">
                                ENTER PIN SHOWN ON {peer.device_name.toUpperCase()}
                              </label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="e.g. 749 201"
                                  value={peerPinInput}
                                  onChange={(e) => setPeerPinInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handlePairPeer(peer);
                                  }}
                                  className="flex-1 h-8 px-3 text-xs font-mono font-semibold bg-vault-bg/90 border border-white/[0.1] rounded-lg text-vault-primary placeholder-vault-muted focus:outline-hidden focus:border-blue-500/50"
                                />
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handlePairPeer(peer)}
                                  disabled={isPairingSubmit || !peerPinInput.trim()}
                                  className="h-8 px-3 text-xs font-semibold rounded-lg gap-1 shrink-0"
                                >
                                  {isPairingSubmit ? (
                                    "Pairing..."
                                  ) : (
                                    <>
                                      <span>Authorize</span>
                                      <ArrowRight className="w-3 h-3" />
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Local Device's Authorization PIN Card */}
              <div className="p-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-semibold text-vault-primary">
                      This Device's Pairing PIN
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyPin}
                    className="text-[11px] font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedPin ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy PIN</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between p-2.5 bg-vault-bg/80 border border-white/[0.06] rounded-xl">
                  <span className="text-base font-mono font-bold text-vault-primary tracking-widest pl-1">
                    {pairingPin}
                  </span>
                  <span className="text-[10px] text-vault-muted">
                    Valid for Wi-Fi peers
                  </span>
                </div>
                <p className="text-[11px] text-vault-muted leading-relaxed">
                  When pairing from another phone or tablet, enter this 6-digit PIN on that device to authorize peer sync.
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Browser Access Tab */}
              <div className="flex flex-col items-center text-center space-y-5">
                {/* High-Contrast Crisp QR Code Card */}
                <div className="p-3.5 bg-white rounded-2xl shadow-[0_0_30px_rgba(255,255,255,0.06)] ring-4 ring-white/10">
                  <svg
                    viewBox={`-4 -4 ${viewBoxSize} ${viewBoxSize}`}
                    className="w-44 h-44 shape-rendering-crispEdges block"
                    aria-label={`QR code for ${lanInfo.url}`}
                  >
                    <rect x="-4" y="-4" width={viewBoxSize} height={viewBoxSize} fill="#FFFFFF" />
                    <path d={qrPath} fill="#080B0F" />
                  </svg>
                </div>

                {/* Connection URL Pill with 1-Click Copy */}
                <div className="w-full space-y-2">
                  <div className="text-[11px] font-semibold text-vault-secondary flex items-center justify-center gap-1.5 uppercase tracking-wider">
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Local Network URL</span>
                  </div>
                  <div className="flex items-center gap-2 p-1.5 pl-3.5 bg-vault-bg/90 border border-white/[0.08] rounded-xl shadow-inner">
                    <span className="text-xs font-mono text-blue-400 flex-1 truncate text-left select-all font-medium">
                      {lanInfo.url}
                    </span>
                    <Button
                      variant={copiedUrl ? "secondary" : "ghost"}
                      size="sm"
                      onClick={handleCopyUrl}
                      className="h-8 px-3 text-xs shrink-0 rounded-lg hover:bg-white/[0.08]"
                    >
                      {copiedUrl ? (
                        <>
                          <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                          <span className="text-emerald-400 font-semibold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 mr-1 text-vault-secondary" />
                          <span>Copy URL</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Step-by-Step Instructions */}
                <div className="w-full bg-white/[0.02] border border-white/[0.06] rounded-2xl p-4 text-left space-y-2.5 text-xs">
                  <div className="flex items-start gap-2.5 text-vault-secondary">
                    <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      1
                    </span>
                    <span className="leading-snug">Connect phone/tablet to the same Wi-Fi or mobile hotspot.</span>
                  </div>
                  <div className="flex items-start gap-2.5 text-vault-secondary">
                    <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      2
                    </span>
                    <span className="leading-snug">Open camera and scan the QR code above.</span>
                  </div>
                  <div className="flex items-start gap-2.5 text-vault-secondary">
                    <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      3
                    </span>
                    <span className="leading-snug">
                      Open in Safari or Chrome for instant zero-install vault access.
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-white/[0.08] bg-vault-bg/40 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
            <span className="text-[11px] text-vault-muted font-medium">
              LAN Port {lanInfo.port} • Local Mesh Only
            </span>
          </div>
          <Button variant="primary" size="sm" onClick={onClose} className="rounded-xl px-4 py-1.5 font-semibold">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};

