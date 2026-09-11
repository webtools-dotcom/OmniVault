import React, { useState, useEffect, useMemo } from "react";
import { Check, Copy, ShieldCheck, Smartphone, Wifi, X } from "lucide-react";
import { Button } from "../common/Button";
import { generateQrMatrix, generateQrPath } from "../../utils/qrCode";
import { StorageService } from "../../services/storageService";

export interface QrConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QrConnectModal: React.FC<QrConnectModalProps> = ({ isOpen, onClose }) => {
  const [lanInfo, setLanInfo] = useState<{ ip: string; port: number; url: string }>({
    ip: "127.0.0.1",
    port: 42420,
    url: "http://localhost:42420",
  });
  const [copied, setCopied] = useState(false);
  const [pairingPin, setPairingPin] = useState<string>("749 201");

  // Fetch LAN IP, Port, and active backend pairing PIN on modal open
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
      setCopied(false);
    }
  }, [isOpen]);

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
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("Failed to copy to clipboard:", err);
    }
  };

  if (!isOpen) return null;

  // Add 4-module quiet zone border around QR code
  const viewBoxSize = size + 8;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none animate-in fade-in duration-150">
      <div
        className="w-full max-w-md bg-vault-card/95 border border-white/[0.12] rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl ring-1 ring-white/[0.05] overflow-hidden animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
      >
        {/* Modal Header */}
        <div className="px-6 py-4.5 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.18)]">
              <Smartphone className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 id="qr-modal-title" className="text-sm font-bold text-vault-primary tracking-tight">
                Connect Mobile & Tablet
              </h2>
              <p className="text-[11px] text-vault-muted font-medium">
                Zero-install local access over Wi-Fi
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

        {/* Modal Content */}
        <div className="p-6 flex flex-col items-center text-center space-y-5">
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
                variant={copied ? "secondary" : "ghost"}
                size="sm"
                onClick={handleCopyUrl}
                className="h-8 px-3 text-xs shrink-0 rounded-lg hover:bg-white/[0.08]"
              >
                {copied ? (
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

          {/* 6-Digit Device Pairing PIN */}
          <div className="w-full p-3.5 bg-white/[0.03] border border-white/[0.08] rounded-2xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5 text-left">
              <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
              <div>
                <span className="font-semibold text-vault-primary block text-xs">
                  Peer Authorization PIN
                </span>
                <span className="text-[10px] text-vault-muted">
                  One-time authentication for peer sync
                </span>
              </div>
            </div>
            <div className="px-3 py-1 bg-white/[0.06] border border-white/[0.1] rounded-xl font-mono font-bold text-sm text-vault-primary tracking-widest">
              {pairingPin}
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
                Install as PWA or capture unfiled notes, charts, and links on the go.
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-vault-bg/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
            <span className="text-[11px] text-vault-muted font-medium">
              LAN Server on Port {lanInfo.port}
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
