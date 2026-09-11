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
        "group relative bg-[#15151A] border rounded-xl overflow-hidden transition-all duration-150 shadow-xs hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)] cursor-pointer flex flex-col",
        isDragging
          ? "opacity-30 ring-1 ring-blue-500 scale-[0.98]"
          : item.is_pinned
          ? "border-amber-500/30 bg-[#16161C] ring-1 ring-amber-500/20"
          : "border-white/[0.08] hover:border-white/[0.18]"
      )}
    >
      {/* BridgeMind Terminal Card Header */}
      <div className="h-8 px-3 border-b border-white/[0.06] bg-[#18181E] flex items-center justify-between select-none text-xs shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          {/* Status Dot */}
          <span
            className={cn(
              "w-2 h-2 rounded-full shrink-0",
              item.is_pinned
                ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]"
                : isTicker
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                : isLink
                ? "bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.6)]"
                : isImage
                ? "bg-purple-400 shadow-[0_0_6px_rgba(192,132,252,0.6)]"
                : "bg-zinc-400"
            )}
          />

          <h3 className="font-mono text-xs font-semibold text-zinc-200 truncate">
            {item.title || "Untitled"}
          </h3>

          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-white/[0.04] text-zinc-400 border border-white/[0.06] shrink-0">
            {item.item_type}
          </span>
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
            <GripVertical className="w-3 h-3" />
          </div>

          <button
            type="button"
            onClick={() => onTogglePin(item.id)}
            title={item.is_pinned ? "Unpin" : "Pin to top"}
            className={cn(
              "w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-white transition-colors cursor-pointer",
              item.is_pinned && "text-amber-400"
            )}
          >
            <Pin className={cn("w-3 h-3", item.is_pinned && "fill-current")} />
          </button>

          <button
            type="button"
            onClick={() => onOpenMove(item)}
            title="Move to folder"
            className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <FolderInput className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => onDeleteItem(item.id)}
            title="Delete"
            className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Card Content Body */}
      <div className="p-3 text-xs flex-1 flex flex-col justify-between">
        {/* Image Thumbnail */}
        {isImage && item.content && (
          <div
            className="relative mb-2.5 rounded-lg overflow-hidden border border-white/[0.08] bg-[#0E0E11] group/img max-h-40 flex items-center justify-center"
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
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-[11px] font-mono">
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Zoom</span>
            </div>
          </div>
        )}

        {/* Text Content */}
        {!isImage && item.content && (
          <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed mb-2.5 font-sans font-normal">
            {item.content}
          </p>
        )}

        {/* Smart Ticker & Link Launchers */}
        {(detectedTickers.length > 0 || detectedLinks.length > 0) && (
          <div className="mb-2">
            <SmartMarketLauncher tickers={detectedTickers} links={detectedLinks} />
          </div>
        )}
      </div>

      {/* BridgeMind Terminal Footer Status Bar */}
      <div className="h-6.5 px-3 border-t border-white/[0.04] bg-[#121216] flex items-center justify-between text-[10px] font-mono text-zinc-500 select-none shrink-0">
        <span>{formatRelativeTime(item.updated_at)}</span>
        <span>{item.content?.length || 0} chars</span>
      </div>
    </div>
  );
};
