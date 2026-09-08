import React, { useState, useMemo } from "react";
import { Inbox, TrendingUp, Link2, FileText, Image as ImageIcon } from "lucide-react";
import { Folder, ItemType, VaultItem } from "../../types";
import { QuickCaptureBar } from "./QuickCaptureBar";
import { QuickInboxItemCard } from "./QuickInboxItemCard";
import { MoveItemModal } from "./MoveItemModal";
import { cn } from "../../utils/cn";

export interface QuickInboxViewProps {
  items: VaultItem[];
  folders: Folder[];
  onCapture: (itemType: ItemType, title: string, content: string, metadata?: string) => Promise<void> | void;
  onTogglePin: (itemId: string) => Promise<void> | void;
  onMoveItem: (itemId: string, folderId: string | null) => Promise<void> | void;
  onDeleteItem: (itemId: string) => Promise<void> | void;
  onSelectItem?: (item: VaultItem) => void;
  onViewImage?: (imageUrl: string, title?: string) => void;
  searchQuery?: string;
}

export const QuickInboxView: React.FC<QuickInboxViewProps> = ({
  items,
  folders,
  onCapture,
  onTogglePin,
  onMoveItem,
  onDeleteItem,
  onSelectItem,
  onViewImage,
  searchQuery = "",
}) => {
  const [targetMoveItem, setTargetMoveItem] = useState<VaultItem | null>(null);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("all");

  // Filter items by type and search query
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Type filter
      if (selectedTypeFilter !== "all" && item.item_type !== selectedTypeFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesContent = item.content.toLowerCase().includes(query);
        return matchesTitle || matchesContent;
      }
      return true;
    });
  }, [items, selectedTypeFilter, searchQuery]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 1-Tap Quick Capture Bar */}
      <QuickCaptureBar onCapture={onCapture} />

      {/* Filter Chips Bar */}
      <div className="flex items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
          <button
            type="button"
            onClick={() => setSelectedTypeFilter("all")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0",
              selectedTypeFilter === "all"
                ? "bg-white/[0.08] text-vault-primary font-semibold ring-1 ring-white/[0.12] shadow-xs"
                : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
            )}
          >
            All Items ({items.length})
          </button>

          <button
            type="button"
            onClick={() => setSelectedTypeFilter("note")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0",
              selectedTypeFilter === "note"
                ? "bg-white/[0.08] text-vault-primary font-semibold ring-1 ring-white/[0.12] shadow-xs"
                : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
            )}
          >
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span>Notes</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTypeFilter("ticker")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0",
              selectedTypeFilter === "ticker"
                ? "bg-white/[0.08] text-vault-primary font-semibold ring-1 ring-white/[0.12] shadow-xs"
                : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
            )}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tickers</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTypeFilter("link")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0",
              selectedTypeFilter === "link"
                ? "bg-white/[0.08] text-vault-primary font-semibold ring-1 ring-white/[0.12] shadow-xs"
                : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
            )}
          >
            <Link2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Links</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTypeFilter("image")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0",
              selectedTypeFilter === "image"
                ? "bg-white/[0.08] text-vault-primary font-semibold ring-1 ring-white/[0.12] shadow-xs"
                : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
            )}
          >
            <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
            <span>Images</span>
          </button>
        </div>
      </div>

      {/* Inbox Items Grid / List */}
      {filteredItems.length === 0 ? (
        <div className="py-12 sm:py-16 flex flex-col items-center justify-center text-center rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.02] to-transparent p-6 sm:p-10 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4 text-blue-400 shadow-[0_0_24px_rgba(59,130,246,0.18)]">
            <Inbox className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-vault-primary mb-1.5 tracking-tight">
            {searchQuery ? "No matching captures found" : "Inbox Zero • All thoughts filed"}
          </h3>
          <p className="text-xs sm:text-sm text-vault-secondary max-w-md mb-6 leading-relaxed">
            {searchQuery
              ? `No captures matching "${searchQuery}". Clear your search query or try different terms.`
              : "Your staging ground is clear. Capture fleeting ideas above, paste screenshots from clipboard, or pair your phone over Wi-Fi."}
          </p>
          {!searchQuery && (
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-vault-muted">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
                <kbd className="font-mono text-blue-400 text-[11px]">Ctrl+V</kbd> Paste chart
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
                <kbd className="font-mono text-emerald-400 text-[11px]">Ctrl+Enter</kbd> Save note
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
                <kbd className="font-mono text-amber-400 text-[11px]">Ctrl+B</kbd> Toggle folders
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredItems.map((item) => (
            <QuickInboxItemCard
              key={item.id}
              item={item}
              onTogglePin={onTogglePin}
              onOpenMove={setTargetMoveItem}
              onDeleteItem={onDeleteItem}
              onSelectItem={onSelectItem}
              onViewImage={onViewImage}
            />
          ))}
        </div>
      )}

      {/* Move / Triage Item Modal */}
      <MoveItemModal
        item={targetMoveItem}
        isOpen={!!targetMoveItem}
        onClose={() => setTargetMoveItem(null)}
        onMove={onMoveItem}
        folders={folders}
      />
    </div>
  );
};
