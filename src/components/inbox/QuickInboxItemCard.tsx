import React, { useState, useMemo } from "react";
import {
  FolderInput,
  GripVertical,
  Maximize2,
  Pin,
  Trash2,
} from "lucide-react";
import { VaultItem } from "../../types";
import { cn } from "../../utils/cn";
import { extractTickers } from "../../utils/tickerDetector";
import { extractLinks } from "../../utils/linkDetector";
import { SmartMarketLauncher } from "../research/SmartMarketLauncher";
import { resolveMediaUrl } from "../../services/storageService";

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
        "group relative bg-vault-card/90 hover:bg-vault-card border rounded-xl overflow-hidden transition-all duration-150 shadow-sm hover:shadow-xl cursor-pointer flex flex-col",
        isDragging
          ? "opacity-30 ring-1 ring-indigo-500 scale-[0.98]"
          : item.is_pinned
          ? "border-amber-500/30 bg-vault-card ring-1 ring-amber-500/20"
          : "border-white/[0.08] hover:border-white/[0.18]"
      )}
    >
      {/* Modern Card Header */}
      <div className="h-8 px-3 border-b border-white/[0.06] bg-vault-panel/60 flex items-center justify-between select-none text-xs shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          {/* Status Badge */}
          <span
            className={cn(
              "text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0",
              item.is_pinned
                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                : isTicker
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : isLink
                ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
                : isImage
                ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
                : "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
            )}
          >
            {isTicker ? "Market" : isImage ? "Photo" : isLink ? "Link" : "Note"}
          </span>

          <h3 className="font-sans text-xs font-semibold text-zinc-100 truncate">
            {item.title || "Untitled"}
          </h3>
        </div>

        {/* Header Right Actions */}
        <div
          className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag Handle */}
          <div
            className="text-zinc-500 hover:text-zinc-300 cursor-grab active:cursor-grabbing p-0.5 transition-colors"
            title="Drag to folder"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          <button
            type="button"
            onClick={() => onTogglePin(item.id)}
            title={item.is_pinned ? "Unpin" : "Pin to top"}
            className={cn(
              "w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer",
              item.is_pinned && "text-amber-400 hover:text-amber-300"
            )}
          >
            <Pin className={cn("w-3.5 h-3.5", item.is_pinned && "fill-current")} />
          </button>

          <button
            type="button"
            onClick={() => onOpenMove(item)}
            title="Move to folder"
            className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <FolderInput className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onDeleteItem(item.id)}
            title="Delete"
            className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Card Content Body */}
      <div className="p-3 text-xs flex-1 flex flex-col justify-between">
        {/* Image Thumbnail */}
        {isImage && item.content && (
          <div
            className="relative mb-2.5 rounded-lg overflow-hidden border border-white/[0.08] bg-vault-bg group/img max-h-40 flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              onViewImage?.(resolveMediaUrl(item.content), item.title);
            }}
          >
            <img
              src={resolveMediaUrl(item.content)}
              alt={item.title}
              className="w-full h-auto max-h-40 object-cover rounded-lg transition-transform duration-200 group-hover/img:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-medium">
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Zoom</span>
            </div>
          </div>
        )}

        {/* Text Content */}
        {!isImage && item.content && (
          <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed mb-2 font-sans font-normal">
            {item.content}
          </p>
        )}

        {/* Smart Ticker & Link Launchers */}
        {(detectedTickers.length > 0 || detectedLinks.length > 0) && (
          <div className="mb-1.5">
            <SmartMarketLauncher tickers={detectedTickers} links={detectedLinks} />
          </div>
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="h-6.5 px-3 border-t border-white/[0.04] bg-vault-panel/40 flex items-center justify-between text-[11px] text-zinc-500 select-none shrink-0 font-sans">
        <span>{formatRelativeTime(item.updated_at)}</span>
        <span>{item.content?.length ? `${item.content.length} chars` : ""}</span>
      </div>
    </div>
  );
};
