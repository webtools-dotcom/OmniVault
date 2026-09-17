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
        <div className="flex-1 min-h-0 flex items-start justify-center pt-16 sm:pt-24">
          <div className="max-w-sm text-center px-6">
            <h2 className="font-display text-xl font-semibold text-vault-primary tracking-[-0.015em]">
              {searchQuery ? "Nothing matches that" : "Nothing here yet"}
            </h2>
            <p className="mt-3 text-[0.8125rem] leading-relaxed text-vault-muted">
              {searchQuery
                ? `No capture contains “${searchQuery}”. Try a shorter word, or clear the search.`
                : "Anything you capture lands here first — a thought, a link, a ticker, a screenshot pasted with Ctrl+V. File it into a folder later, or leave it."}
            </p>
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
