import React, { useState, useEffect, useRef } from "react";
import { Check, Download, ExternalLink, Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { resolveMediaUrl, StorageService } from "../../services/storageService";

export interface ImageLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title?: string;
  metadata?: {
    fileHash?: string;
    byteSize?: number;
    width?: number;
    height?: number;
  };
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  isOpen,
  onClose,
  imageUrl,
  title = "Screenshot / Image Preview",
  metadata,
}) => {
  const resolvedUrl = resolveMediaUrl(imageUrl);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<{ text: string; filePath?: string } | null>(
    null,
  );
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Reset zoom, pan, & download status when opening
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setDownloadStatus(null);
    }
  }, [isOpen]);

  // Keyboard navigation (+, -, 0, Esc)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(z + 0.25, 4));
      } else if (e.key === "-") {
        setZoom((z) => Math.max(z - 0.25, 0.5));
      } else if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 4));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleDownload = async (e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadStatus(null);
    try {
      const res = await StorageService.saveMediaToDownloads(imageUrl, title);
      if (res.success) {
        setDownloadStatus({
          text: "Saved to Downloads",
          filePath: res.filePath,
        });
      } else {
        setDownloadStatus({ text: res.error || "Download failed" });
      }
    } catch (err) {
      console.error("Failed to download image:", err);
      setDownloadStatus({ text: "Failed to download" });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPan({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const formatSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-vault-bg/95 backdrop-blur-xl select-none animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      {/* Top Header Controls */}
      <div className="h-14 px-4 sm:px-6 border-b border-vault-border flex items-center justify-between shrink-0 bg-vault-card/90">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-vault-primary truncate max-w-[160px] sm:max-w-md">
            {title}
          </h2>
          {metadata?.byteSize && (
            <span className="text-[0.815rem] px-2.5 py-0.5 rounded-lg bg-vault-elevated text-vault-secondary border border-vault-border hidden sm:inline-block">
              {formatSize(metadata.byteSize)} WebP
            </span>
          )}
        </div>

        {/* Zoom & Action Toolbar */}
        <div className="flex items-center gap-2">
          {/* Download Status Notification */}
          {downloadStatus && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-vault-success/15 border border-vault-success/30 text-vault-success text-xs animate-in fade-in duration-200">
              <Check className="w-3 h-3 text-vault-success shrink-0" />
              <span className="truncate max-w-[120px] sm:max-w-none">{downloadStatus.text}</span>
              {downloadStatus.filePath && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    StorageService.openFileInFolder(downloadStatus.filePath!);
                  }}
                  className="ml-1 px-1.5 py-0.5 rounded bg-vault-success/25 hover:bg-vault-success/40 text-[0.741rem] text-vault-primary flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                  title="Open in File Explorer"
                >
                  <span>Show</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )}

          <div className="flex items-center bg-vault-bg rounded-xl border border-vault-border p-1 shadow-xs">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-vault-secondary hover:text-vault-primary disabled:opacity-30 transition-all active:scale-90 cursor-pointer"
              title="Zoom Out (-)"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>

            <span className="text-[0.815rem] text-vault-primary px-2.5 min-w-11 text-center select-none">
              {Math.round(zoom * 100)}%
            </span>

            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 4}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-vault-secondary hover:text-vault-primary disabled:opacity-30 transition-all active:scale-90 cursor-pointer"
              title="Zoom In (+)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleResetZoom}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-vault-secondary hover:text-vault-primary transition-all border-l border-vault-border/60 ml-1 active:scale-90 cursor-pointer"
              title="Reset Zoom (0)"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className="h-8 px-2.5 rounded-xl bg-vault-elevated hover:bg-vault-card border border-vault-border flex items-center gap-1.5 text-vault-secondary hover:text-vault-primary transition-all active:scale-90 cursor-pointer shadow-xs disabled:opacity-50"
            title="Download Image to Computer"
          >
            {isDownloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-vault-secondary" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span className="text-xs font-medium hidden sm:inline">Save image</span>
          </button>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-vault-elevated flex items-center justify-center text-vault-secondary hover:text-vault-primary transition-all cursor-pointer"
            aria-label="Close lightbox"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Image Viewport with Pan & Zoom */}
      <div
        className="flex-1 overflow-hidden relative flex items-center justify-center p-4 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={resolvedUrl}
          alt={title}
          draggable={false}
          onContextMenu={(e) => {
            e.preventDefault();
            handleDownload(e);
          }}
          className="max-w-full max-h-full object-contain transition-transform duration-75 shadow-2xl rounded"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        />
      </div>

      {/* Footer Info */}
      <div className="h-9 px-6 border-t border-vault-border bg-vault-card/60 flex items-center justify-between text-[0.815rem] text-vault-muted shrink-0">
        <div className="flex items-center gap-2">
          {metadata?.fileHash && (
            <span className="truncate max-w-[180px] sm:max-w-xs">
              SHA: {metadata.fileHash.slice(0, 16)}...
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline">Use mouse drag to pan when zoomed</span>
          <span>Press Esc to close</span>
        </div>
      </div>
    </div>
  );
};
