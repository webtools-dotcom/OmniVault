import React, { useState, useEffect, useRef } from "react";
import { Download, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "../common/Button";

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
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Reset zoom & pan when opening
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
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
      className="fixed inset-0 z-50 flex flex-col bg-vault-bg/95 backdrop-blur-md select-none animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      {/* Top Header Controls */}
      <div className="h-14 px-4 sm:px-6 border-b border-vault-border flex items-center justify-between shrink-0 bg-vault-card/80">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-semibold text-vault-primary truncate max-w-[200px] sm:max-w-md">
            {title}
          </h2>
          {metadata?.byteSize && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-vault-elevated text-vault-secondary border border-vault-border hidden sm:inline-block">
              {formatSize(metadata.byteSize)} WebP
            </span>
          )}
        </div>

        {/* Zoom & Action Toolbar */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-vault-bg rounded-md border border-vault-border p-0.5">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              className="w-7 h-7 flex items-center justify-center rounded text-vault-secondary hover:text-vault-primary disabled:opacity-30 transition-colors"
              title="Zoom Out (-)"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>

            <span className="text-[11px] font-mono text-vault-primary px-2 min-w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>

            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 4}
              className="w-7 h-7 flex items-center justify-center rounded text-vault-secondary hover:text-vault-primary disabled:opacity-30 transition-colors"
              title="Zoom In (+)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleResetZoom}
              className="w-7 h-7 flex items-center justify-center rounded text-vault-secondary hover:text-vault-primary transition-colors border-l border-vault-border/60 ml-0.5"
              title="Reset Zoom (0)"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>

          <a
            href={imageUrl}
            download={title.endsWith(".webp") ? title : `${title}.webp`}
            className="w-8 h-8 rounded-md bg-vault-elevated hover:bg-vault-card border border-vault-border flex items-center justify-center text-vault-secondary hover:text-vault-primary transition-colors ml-1"
            title="Download Image"
          >
            <Download className="w-4 h-4" />
          </a>

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-vault-secondary hover:text-vault-primary ml-1"
            aria-label="Close lightbox"
          >
            <X className="w-5 h-5" />
          </Button>
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
          src={imageUrl}
          alt={title}
          draggable={false}
          className="max-w-full max-h-full object-contain transition-transform duration-75 shadow-2xl rounded"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        />
      </div>

      {/* Footer Info */}
      <div className="h-9 px-6 border-t border-vault-border bg-vault-card/60 flex items-center justify-between text-[11px] text-vault-muted shrink-0">
        <div className="flex items-center gap-2">
          {metadata?.fileHash && (
            <span className="font-mono truncate max-w-[180px] sm:max-w-xs">
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
