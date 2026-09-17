import React, { useState, useMemo } from "react";
import { Folder, ItemType, VaultItem } from "../../types";
import { QuickCaptureBar } from "./QuickCaptureBar";
import { QuickInboxItemCard } from "./QuickInboxItemCard";
import { MoveItemModal } from "./MoveItemModal";

export interface QuickInboxViewProps {
  items: VaultItem[];
  folders: Folder[];
  onCapture: (
    itemType: ItemType,
    title: string,
    content: string,
    metadata?: string,
    existingItem?: VaultItem
  ) => Promise<void> | void;
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

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter((item) => {
      const matchesTitle = item.title.toLowerCase().includes(query);
      const matchesContent = item.content.toLowerCase().includes(query);
      return matchesTitle || matchesContent;
    });
  }, [items, searchQuery]);

  return (
    <div className="w-full h-full flex flex-col gap-3">
      {/* 1-Tap Quick Capture Bar */}
      <QuickCaptureBar onCapture={onCapture} />

      {/* Inbox Items Grid */}
      {filteredItems.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="w-full max-w-2xl border border-white/[0.08] rounded-xl bg-vault-panel overflow-hidden shadow-xs">
          <div className="h-8 px-3.5 border-b border-white/[0.06] bg-vault-card flex items-center justify-between text-xs select-none">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-vault-success shadow-[0_0_6px_rgba(121,194,164,0.35)]" />
              <span className="text-xs text-vault-secondary">vault://stream</span>
              <span className="text-[0.741rem] px-1.5 py-0.2 rounded bg-vault-primary/[0.05] text-vault-secondary">ready</span>
            </div>
            <span className="text-[0.741rem] text-vault-muted">local mesh • 42420</span>
          </div>
          <div className="p-4 sm:p-5 text-xs space-y-3">
            <div className="text-vault-secondary font-semibold flex items-center gap-2">
              <span className="text-vault-success">❯</span>
              <span>omnivault stream initialized</span>
            </div>
            <p className="text-vault-muted text-[0.815rem] leading-relaxed">
              {searchQuery
                ? `No captures matching "${searchQuery}". Clear query or try another keyword.`
                : "Your local knowledge stream is clear. All data is persisted locally in SQLite with zero cloud dependencies."}
            </p>
            {!searchQuery && (
              <div className="pt-3 border-t border-white/[0.06] flex flex-col gap-1 text-[0.815rem] leading-relaxed text-vault-muted">
                <span>
                  <span className="text-vault-secondary">💡 Tip:</span> Type above to save notes, paste screenshots with Ctrl+V, or drop images directly.
                </span>
                <span className="text-vault-subtle">Press Enter to capture</span>
              </div>
            )}
          </div>
        </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4 items-start">
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
