import React, { useState, useMemo } from "react";
import {
  FileText,
  FolderInput,
  GripVertical,
  Image as ImageIcon,
  Link2,
  Maximize2,
  Pin,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { VaultItem } from "../../types";
import { Button } from "../common/Button";
import { cn } from "../../utils/cn";
import { extractTickers } from "../../utils/tickerDetector";
import { extractLinks } from "../../utils/linkDetector";
import { SmartMarketLauncher } from "../research/SmartMarketLauncher";

export interface QuickInboxItemCardProps {
  item: VaultItem;
  onTogglePin: (itemId: string) => Promise<void> | void;
  onOpenMove: (item: VaultItem) => void;
  onDeleteItem: (itemId: string) => Promise<void> | void;
  onSelectItem?: (item: VaultItem) => void;
  onViewImage?: (imageUrl: string, title?: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const QuickInboxItemCard: React.FC<QuickInboxItemCardProps> = ({
  item,
  onTogglePin,
  onOpenMove,
  onDeleteItem,
  onSelectItem,
  onViewImage,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const isTicker = item.item_type === "ticker";
  const isLink = item.item_type === "link";
  const isImage = item.item_type === "image";

  // Auto-detect any stock/crypto tickers and web links in the item
  const detectedTickers = useMemo(() => {
    return extractTickers(`${item.title} ${item.content}`);
  }, [item.title, item.content]);

  const detectedLinks = useMemo(() => {
    return extractLinks(item.content);
  }, [item.content]);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/x-omnivault-item", item.id);
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onSelectItem?.(item)}
      className={cn(
        "group relative bg-vault-card/90 border rounded-2xl p-4 sm:p-5 transition-all duration-200 shadow-xs hover:shadow-[0_12px_32px_rgba(0,0,0,0.4)] cursor-pointer hover:-translate-y-0.5",
        isDragging
          ? "opacity-40 ring-2 ring-vault-accent/60 scale-[0.98]"
          : item.is_pinned
          ? "border-amber-500/30 bg-amber-500/[0.02] ring-1 ring-amber-500/20"
          : "border-white/[0.08] hover:border-white/[0.18]"
      )}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {/* Drag Handle */}
          <div
            className="text-vault-muted/40 group-hover:text-vault-muted cursor-grab active:cursor-grabbing p-1 -ml-1 transition-colors shrink-0 rounded hover:bg-white/[0.04]"
            title="Drag to file into folder"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* Format Icon Badge */}
          <div
            className={cn(
              "w-6 h-6 rounded-lg flex items-center justify-center shrink-0 shadow-xs",
              isTicker && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
              isLink && "bg-amber-500/15 text-amber-400 border border-amber-500/20",
              isImage && "bg-purple-500/15 text-purple-400 border border-purple-500/20",
              !isTicker && !isLink && !isImage && "bg-blue-500/15 text-blue-400 border border-blue-500/20"
            )}
          >
            {isTicker ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : isLink ? (
              <Link2 className="w-3.5 h-3.5" />
            ) : isImage ? (
              <ImageIcon className="w-3.5 h-3.5" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
          </div>

          <h3 className="font-semibold text-sm text-vault-primary truncate tracking-tight">
            {item.title || "Untitled Capture"}
          </h3>

          {item.is_pinned && (
            <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25 shrink-0">
              Pinned
            </span>
          )}
        </div>

        {/* Header Right / Pin & Timestamp */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <span className="text-[11px] text-vault-muted font-medium">
            {formatRelativeTime(item.updated_at)}
          </span>

          <button
            type="button"
            onClick={() => onTogglePin(item.id)}
            title={item.is_pinned ? "Unpin item" : "Pin to top"}
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 cursor-pointer",
              item.is_pinned
                ? "text-amber-400 hover:bg-amber-500/10"
                : "text-vault-muted hover:text-vault-primary opacity-60 sm:opacity-0 group-hover:opacity-100 hover:bg-white/[0.06]"
            )}
          >
            <Pin className={cn("w-3.5 h-3.5", item.is_pinned && "fill-current")} />
          </button>
        </div>
      </div>

      {/* Image Thumbnail Preview */}
      {isImage && item.content && (
        <div
          className="relative mb-3 rounded-xl overflow-hidden border border-white/[0.08] bg-vault-bg/60 group/img max-h-48 flex items-center justify-center shadow-xs"
          onClick={(e) => {
            e.stopPropagation();
            onViewImage?.(item.content, item.title);
          }}
        >
          <img
            src={item.content}
            alt={item.title}
            className="w-full h-auto max-h-48 object-cover rounded-xl transition-transform duration-300 group-hover/img:scale-[1.02]"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold backdrop-blur-xs">
            <Maximize2 className="w-4 h-4" />
            <span>Click to Zoom</span>
          </div>
        </div>
      )}

      {/* Card Text Content (if not an image or if note) */}
      {!isImage && item.content && (
        <p className="text-xs sm:text-sm text-vault-secondary line-clamp-3 leading-relaxed mb-3 font-normal">
          {item.content}
        </p>
      )}

      {/* Smart Ticker & Link Launchers (Auto-detected) */}
      {(detectedTickers.length > 0 || detectedLinks.length > 0) && (
        <div className="mb-3">
          <SmartMarketLauncher tickers={detectedTickers} links={detectedLinks} />
        </div>
      )}

      {/* Footer Triage Toolbar */}
      <div
        className="flex items-center justify-between pt-3 border-t border-white/[0.06] text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenMove(item)}
          className="text-vault-secondary hover:text-vault-primary hover:bg-white/[0.06] h-7.5 px-2.5 rounded-lg text-xs font-medium transition-colors"
        >
          <FolderInput className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
          <span>File to Folder</span>
        </Button>

        <button
          type="button"
          onClick={() => onDeleteItem(item.id)}
          title="Delete item"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-vault-muted hover:text-rose-400 hover:bg-rose-500/10 transition-all opacity-60 sm:opacity-0 group-hover:opacity-100 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
