import React, { useState, useMemo } from "react";
import { Inbox, Sparkles, TrendingUp, Link2, FileText } from "lucide-react";
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
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSelectedTypeFilter("all")}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              selectedTypeFilter === "all"
                ? "bg-vault-elevated text-vault-primary border border-vault-border"
                : "text-vault-muted hover:text-vault-secondary hover:bg-vault-elevated/40"
            )}
          >
            All Items ({items.length})
          </button>

          <button
            type="button"
            onClick={() => setSelectedTypeFilter("note")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              selectedTypeFilter === "note"
                ? "bg-vault-elevated text-vault-primary border border-vault-border"
                : "text-vault-muted hover:text-vault-secondary hover:bg-vault-elevated/40"
            )}
          >
            <FileText className="w-3 h-3 text-vault-accent" />
            <span>Notes</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTypeFilter("ticker")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              selectedTypeFilter === "ticker"
                ? "bg-vault-elevated text-vault-primary border border-vault-border"
                : "text-vault-muted hover:text-vault-secondary hover:bg-vault-elevated/40"
            )}
          >
            <TrendingUp className="w-3 h-3 text-vault-success" />
            <span>Tickers</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTypeFilter("link")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              selectedTypeFilter === "link"
                ? "bg-vault-elevated text-vault-primary border border-vault-border"
                : "text-vault-muted hover:text-vault-secondary hover:bg-vault-elevated/40"
            )}
          >
            <Link2 className="w-3 h-3 text-vault-pending" />
            <span>Links</span>
          </button>
        </div>
      </div>

      {/* Inbox Items Grid / List */}
      {filteredItems.length === 0 ? (
        <div className="py-12 flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-vault-border bg-vault-card/30 p-8">
          <div className="w-14 h-14 rounded-2xl bg-vault-card border border-vault-border flex items-center justify-center mb-3 text-vault-accent shadow-xs">
            <Inbox className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-semibold text-vault-primary mb-1">
            {searchQuery ? "No matching items found" : "Inbox is completely empty"}
          </h3>
          <p className="text-xs text-vault-secondary max-w-sm mb-4">
            {searchQuery
              ? `No captures matching "${searchQuery}". Try another keyword.`
              : "Capture unfiled ideas, thoughts, tickers, or links above. Triage them into folders when ready."}
          </p>
          {!searchQuery && (
            <div className="flex items-center gap-2 text-xs text-vault-muted">
              <Sparkles className="w-3.5 h-3.5 text-vault-accent" />
              <span>Items save locally in sub-millisecond time</span>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredItems.map((item) => (
            <QuickInboxItemCard
              key={item.id}
              item={item}
              onTogglePin={onTogglePin}
              onOpenMove={setTargetMoveItem}
              onDeleteItem={onDeleteItem}
              onSelectItem={onSelectItem}
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
