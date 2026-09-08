import React, { useState, useMemo } from "react";
import { Folder, ItemType, VaultItem } from "../../types";
import { QuickCaptureBar } from "./QuickCaptureBar";
import { QuickInboxItemCard } from "./QuickInboxItemCard";
import { MoveItemModal } from "./MoveItemModal";

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
    <div className="w-full space-y-3">
      {/* 1-Tap Quick Capture Bar */}
      <QuickCaptureBar onCapture={onCapture} />

      {/* Inbox Items Grid */}
      {filteredItems.length === 0 ? (
        <div className="border border-white/[0.08] rounded-xl bg-[#141418] overflow-hidden shadow-xs">
          <div className="h-8 px-3.5 border-b border-white/[0.06] bg-[#18181D] flex items-center justify-between text-xs select-none">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
              <span className="font-mono text-xs text-zinc-300">vault://stream</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.05] text-zinc-400">ready</span>
            </div>
            <span className="font-mono text-[10px] text-zinc-500">local mesh • 42420</span>
          </div>
          <div className="p-4 sm:p-5 font-mono text-xs space-y-3">
            <div className="text-zinc-300 font-semibold flex items-center gap-2">
              <span className="text-emerald-400">❯</span>
              <span>omnivault stream initialized</span>
            </div>
            <p className="text-zinc-500 text-[11px] leading-relaxed">
              {searchQuery
                ? `No captures matching "${searchQuery}". Clear query or try another keyword.`
                : "Your local knowledge stream is clear. All data is persisted locally in SQLite with zero cloud dependencies."}
            </p>
            {!searchQuery && (
              <div className="pt-2 border-t border-white/[0.06] grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => onCapture("note", "Quick Capture Guide", "- Type in the top prompt to save notes\n- Ctrl+V to paste screenshots\n- Pin cards to keep them at top")}
                  className="p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/[0.12] text-left transition-all cursor-pointer group"
                >
                  <span className="text-blue-400 group-hover:text-blue-300 block font-semibold mb-1 font-mono">↵ + Starter Note</span>
                  <span className="text-zinc-500 font-sans">Click to create a quick reference note in your stream.</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCapture("ticker", "$NVDA", "NVIDIA Corporation - Breakout watch above 135.")}
                  className="p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/[0.12] text-left transition-all cursor-pointer group"
                >
                  <span className="text-emerald-400 group-hover:text-emerald-300 block font-semibold mb-1 font-mono">$ + Watch $NVDA</span>
                  <span className="text-zinc-500 font-sans">Click to create an interactive TradingView chart card.</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCapture("link", "TradingView Charts", "https://www.tradingview.com")}
                  className="p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/[0.12] text-left transition-all cursor-pointer group"
                >
                  <span className="text-purple-400 group-hover:text-purple-300 block font-semibold mb-1 font-mono">🌐 + Web Link</span>
                  <span className="text-zinc-500 font-sans">Click to create a web link card with 1-click launcher.</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
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
