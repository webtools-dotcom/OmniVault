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
import { Badge } from "../common/Badge";
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
        "group relative bg-vault-card border rounded-xl p-4 transition-all duration-150 shadow-xs hover:shadow-md cursor-pointer",
        isDragging
          ? "opacity-40 ring-2 ring-vault-accent/50 scale-[0.98]"
          : item.is_pinned
          ? "border-vault-accent/40 bg-vault-card/90"
          : "border-vault-border hover:border-vault-border-active/60"
      )}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Drag Handle */}
          <div
            className="text-vault-muted/40 group-hover:text-vault-muted cursor-grab active:cursor-grabbing p-0.5 -ml-1 transition-colors shrink-0"
            title="Drag to file into folder"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* Format Icon */}
          <div
            className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center shrink-0",
              isTicker && "bg-vault-success/15 text-vault-success",
              isLink && "bg-vault-pending/15 text-vault-pending",
              isImage && "bg-purple-500/15 text-purple-400",
              !isTicker && !isLink && !isImage && "bg-vault-accent/15 text-vault-accent"
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

          <h3 className="font-semibold text-sm text-vault-primary truncate">
            {item.title || "Untitled Capture"}
          </h3>

          {item.is_pinned && (
            <Badge variant="accent" size="sm">
              Pinned
            </Badge>
          )}
        </div>

        {/* Header Right / Pin & Timestamp */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <span className="text-[11px] text-vault-muted">
            {formatRelativeTime(item.updated_at)}
          </span>

          <button
            type="button"
            onClick={() => onTogglePin(item.id)}
            title={item.is_pinned ? "Unpin item" : "Pin to top"}
            className={cn(
              "w-6 h-6 rounded flex items-center justify-center transition-colors",
              item.is_pinned
                ? "text-vault-accent hover:bg-vault-elevated"
                : "text-vault-muted hover:text-vault-secondary opacity-0 group-hover:opacity-100"
            )}
          >
            <Pin className={cn("w-3.5 h-3.5", item.is_pinned && "fill-current")} />
          </button>
        </div>
      </div>

      {/* Image Thumbnail Preview */}
      {isImage && item.content && (
        <div
          className="relative mb-3 rounded-lg overflow-hidden border border-vault-border bg-vault-bg/60 group/img max-h-48 flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            onViewImage?.(item.content, item.title);
          }}
        >
          <img
            src={item.content}
            alt={item.title}
            className="w-full h-auto max-h-48 object-cover rounded"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-medium backdrop-blur-xs">
            <Maximize2 className="w-4 h-4" />
            <span>Click to Zoom</span>
          </div>
        </div>
      )}

      {/* Card Text Content (if not an image or if note) */}
      {!isImage && item.content && (
        <p className="text-xs text-vault-secondary line-clamp-3 leading-relaxed mb-2 font-normal">
          {item.content}
        </p>
      )}

      {/* Smart Ticker & Link Launchers (Auto-detected) */}
      {(detectedTickers.length > 0 || detectedLinks.length > 0) && (
        <div className="mb-2">
          <SmartMarketLauncher tickers={detectedTickers} links={detectedLinks} />
        </div>
      )}

      {/* Footer Triage Toolbar */}
      <div
        className="flex items-center justify-between pt-2.5 border-t border-vault-border/50 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenMove(item)}
          className="text-vault-secondary hover:text-vault-primary h-7 px-2 text-xs"
        >
          <FolderInput className="w-3.5 h-3.5 mr-1 text-vault-accent" />
          <span>File to Folder</span>
        </Button>

        <button
          type="button"
          onClick={() => onDeleteItem(item.id)}
          title="Delete item"
          className="w-7 h-7 rounded flex items-center justify-center text-vault-muted hover:text-vault-error hover:bg-vault-elevated transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
