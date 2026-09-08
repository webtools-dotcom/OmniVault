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
  const [pairingPin] = useState<string>(() => {
    // Generate deterministic session 6-digit PIN (e.g. 749 201)
    const num = Math.floor(100000 + Math.random() * 900000);
    return `${num.toString().slice(0, 3)} ${num.toString().slice(3)}`;
  });

  // Fetch LAN IP & Port on modal open
  useEffect(() => {
    if (isOpen) {
      StorageService.getLanConnectionInfo().then((info) => {
        setLanInfo(info);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none animate-in fade-in duration-150">
      <div
        className="w-full max-w-md bg-vault-card border border-vault-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-vault-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-vault-accent/15 border border-vault-accent/30 flex items-center justify-center text-vault-accent">
              <Smartphone className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 id="qr-modal-title" className="text-sm font-semibold text-vault-primary">
                Connect Mobile & Tablet
              </h2>
              <p className="text-[11px] text-vault-muted">
                Zero-install local access over Wi-Fi
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-vault-muted hover:text-vault-secondary rounded-lg p-1 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 flex flex-col items-center text-center space-y-5">
          {/* High-Contrast Crisp QR Code Card */}
          <div className="p-3 bg-white rounded-2xl border border-vault-border shadow-md">
            <svg
              viewBox={`-4 -4 ${viewBoxSize} ${viewBoxSize}`}
              className="w-44 h-44 shape-rendering-crispEdges block"
              aria-label={`QR code for ${lanInfo.url}`}
            >
              <rect x="-4" y="-4" width={viewBoxSize} height={viewBoxSize} fill="#FFFFFF" />
              <path d={qrPath} fill="#0D1117" />
            </svg>
          </div>

          {/* Connection URL Pill with 1-Click Copy */}
          <div className="w-full space-y-1.5">
            <div className="text-[11px] font-medium text-vault-secondary flex items-center justify-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-vault-success" />
              <span>Local Network URL</span>
            </div>
            <div className="flex items-center gap-1.5 p-1.5 pl-3 bg-vault-bg border border-vault-border rounded-xl">
              <span className="text-xs font-mono text-vault-accent flex-1 truncate text-left select-all">
                {lanInfo.url}
              </span>
              <Button
                variant={copied ? "secondary" : "ghost"}
                size="sm"
                onClick={handleCopyUrl}
                className="h-7 px-2.5 text-xs shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1 text-vault-success" />
                    <span className="text-vault-success font-medium">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-1 text-vault-secondary" />
                    <span>Copy</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* 6-Digit Device Pairing PIN */}
          <div className="w-full p-3 bg-vault-elevated/40 border border-vault-border rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-left">
              <ShieldCheck className="w-4 h-4 text-vault-accent shrink-0" />
              <div>
                <span className="font-medium text-vault-primary block">
                  Peer Authorization PIN
                </span>
                <span className="text-[10px] text-vault-muted">
                  Required once for encrypted peer sync
                </span>
              </div>
            </div>
            <div className="px-2.5 py-1 bg-vault-card border border-vault-border rounded-lg font-mono font-bold text-sm text-vault-primary tracking-widest">
              {pairingPin}
            </div>
          </div>

          {/* Step-by-Step Instructions */}
          <div className="w-full bg-vault-card/60 border border-vault-border/60 rounded-xl p-3.5 text-left space-y-2 text-xs">
            <div className="flex items-start gap-2 text-vault-secondary">
              <span className="w-4 h-4 rounded-full bg-vault-elevated text-vault-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <span>Connect phone/tablet to the same Wi-Fi or mobile hotspot.</span>
            </div>
            <div className="flex items-start gap-2 text-vault-secondary">
              <span className="w-4 h-4 rounded-full bg-vault-elevated text-vault-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <span>Open the Camera app and scan the QR code above.</span>
            </div>
            <div className="flex items-start gap-2 text-vault-secondary">
              <span className="w-4 h-4 rounded-full bg-vault-elevated text-vault-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <span>
                Dump unfiled notes, tickers, and screenshots directly into your vault.
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-vault-border bg-vault-bg/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-vault-success animate-pulse" />
            <span className="text-[11px] text-vault-muted">
              HTTP Server on Port {lanInfo.port}
            </span>
          </div>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};
