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
  /** Shown in the footer so an item says where it lives, not how long it is. */
  folderName?: string | null;
  folderTint?: string | null;
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
  folderName,
  folderTint,
  onTogglePin,
  onOpenMove,
  onDeleteItem,
  onSelectItem,
  onViewImage,
}) => {
  const [isDragging, setIsDragging] = useState(false);
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
        "group relative rounded-xl transition-colors duration-150 cursor-pointer flex flex-col",
        // A photo needs no panel: the picture is the item. Text sits one step
        // above the ground instead of inside a bordered box. D-070.
        isImage ? "bg-transparent" : "bg-vault-card hover:bg-vault-card-hover",
        isDragging && "opacity-30 scale-[0.98]"
      )}
    >
      {isImage && item.content ? (
        <div
          className="relative rounded-xl overflow-hidden bg-vault-card group/img"
          onClick={(e) => {
            e.stopPropagation();
            onViewImage?.(resolveMediaUrl(item.content), item.title);
          }}
        >
          <img
            src={resolveMediaUrl(item.content)}
            alt={item.title}
            className="w-full h-auto max-h-64 object-cover block"
          />
          <div className="absolute inset-0 bg-vault-bg/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-vault-primary text-xs font-medium">
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Open</span>
          </div>
        </div>
      ) : (
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-start gap-2">
            <h3 className="flex-1 min-w-0 text-sm font-semibold text-vault-primary leading-snug line-clamp-2">
              {item.title || "Untitled"}
            </h3>
            {item.is_pinned && (
              <Pin className="w-3.5 h-3.5 mt-0.5 shrink-0 fill-current text-vault-primary" />
            )}
          </div>

          {item.content && (
            <p className="mt-2 text-[0.8125rem] text-vault-secondary leading-relaxed line-clamp-3">
              {item.content}
            </p>
          )}

          {(detectedTickers.length > 0 || detectedLinks.length > 0) && (
            <div className="mt-3">
              <SmartMarketLauncher tickers={detectedTickers} links={detectedLinks} />
            </div>
          )}
        </div>
      )}

      {/* Folder and age. Nothing else — a character count told nobody anything. */}
      <div
        className={cn(
          "flex items-center gap-2 select-none text-xs text-vault-muted",
          isImage ? "px-0.5 pt-2.5" : "px-4 pb-3"
        )}
      >
        {isImage && (
          <span className="flex-1 min-w-0 truncate text-vault-secondary">
            {item.title || "Untitled"}
          </span>
        )}
        {!isImage && folderName && (
          <>
            <span
              className="w-1.5 h-1.5 rounded-sm shrink-0"
              style={{ backgroundColor: folderTint || "#7D8CA8" }}
            />
            <span className="flex-1 min-w-0 truncate">{folderName}</span>
          </>
        )}
        {!isImage && !folderName && <span className="flex-1 min-w-0 truncate">Quick Inbox</span>}
        <span className="shrink-0 text-vault-subtle">{formatRelativeTime(item.updated_at)}</span>
      </div>

      {/* Actions stay out of the way until the item is actually under the cursor. */}
      <div
        className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-6.5 h-6.5 flex items-center justify-center rounded-md bg-vault-overlay text-vault-secondary cursor-grab active:cursor-grabbing"
          title="Drag to a folder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <button
          type="button"
          onClick={() => onTogglePin(item.id)}
          title={item.is_pinned ? "Unpin" : "Pin to the top"}
          className={cn(
            "w-6.5 h-6.5 flex items-center justify-center rounded-md bg-vault-overlay transition-colors cursor-pointer",
            item.is_pinned ? "text-vault-primary" : "text-vault-secondary hover:text-vault-primary"
          )}
        >
          <Pin className={cn("w-3.5 h-3.5", item.is_pinned && "fill-current")} />
        </button>
        <button
          type="button"
          onClick={() => onOpenMove(item)}
          title="Move to a folder"
          className="w-6.5 h-6.5 flex items-center justify-center rounded-md bg-vault-overlay text-vault-secondary hover:text-vault-primary transition-colors cursor-pointer"
        >
          <FolderInput className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDeleteItem(item.id)}
          title="Delete"
          className="w-6.5 h-6.5 flex items-center justify-center rounded-md bg-vault-overlay text-vault-secondary hover:text-vault-error transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
