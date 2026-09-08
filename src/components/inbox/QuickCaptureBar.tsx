import React, { useState, useRef } from "react";
import { FileText, Link2, Plus, Sparkles, TrendingUp } from "lucide-react";
import { ItemType } from "../../types";
import { Button } from "../common/Button";
import { cn } from "../../utils/cn";

export interface QuickCaptureBarProps {
  onCapture: (itemType: ItemType, title: string, content: string, metadata?: string) => Promise<void> | void;
  folderId?: string | null;
}

export const QuickCaptureBar: React.FC<QuickCaptureBarProps> = ({ onCapture, folderId = null }) => {
  const [itemType, setItemType] = useState<ItemType>("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCapture = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanTitle = title.trim();
    const cleanContent = content.trim();

    if (!cleanTitle && !cleanContent) return;

    try {
      setIsSubmitting(true);
      let metadata: string | null = null;
      let finalTitle = cleanTitle;
      let finalContent = cleanContent;

      if (itemType === "ticker") {
        const tickerSymbol = (cleanTitle || cleanContent).replace(/^\$/, "").toUpperCase();
        finalTitle = `$${tickerSymbol}`;
        metadata = JSON.stringify({ ticker: tickerSymbol });
      } else if (itemType === "link") {
        if (!finalTitle && finalContent) {
          finalTitle = finalContent.replace(/^https?:\/\//i, "").split("/")[0] || "Saved Link";
        }
        metadata = JSON.stringify({ url: cleanContent || cleanTitle });
      } else if (!finalTitle && finalContent) {
        finalTitle = finalContent.slice(0, 40) + (finalContent.length > 40 ? "..." : "");
      }

      await onCapture(itemType, finalTitle, finalContent, metadata || undefined);
      setTitle("");
      setContent("");
      setIsExpanded(false);
      inputRef.current?.focus();
    } catch (err) {
      console.error("Quick capture failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !isExpanded)) {
      e.preventDefault();
      handleCapture();
    }
  };

  return (
    <div className="bg-vault-card border border-vault-border rounded-xl p-3 shadow-md transition-all duration-150 mb-6">
      {/* Type Selector Tabs */}
      <div className="flex items-center gap-1.5 mb-2.5 pb-2 border-b border-vault-border/60">
        <button
          type="button"
          onClick={() => setItemType("note")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            itemType === "note"
              ? "bg-vault-elevated text-vault-primary border border-vault-border"
              : "text-vault-muted hover:text-vault-secondary hover:bg-vault-elevated/40"
          )}
        >
          <FileText className="w-3.5 h-3.5 text-vault-accent" />
          <span>Note</span>
        </button>

        <button
          type="button"
          onClick={() => setItemType("ticker")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            itemType === "ticker"
              ? "bg-vault-elevated text-vault-primary border border-vault-border"
              : "text-vault-muted hover:text-vault-secondary hover:bg-vault-elevated/40"
          )}
        >
          <TrendingUp className="w-3.5 h-3.5 text-vault-success" />
          <span>Ticker ($)</span>
        </button>

        <button
          type="button"
          onClick={() => setItemType("link")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            itemType === "link"
              ? "bg-vault-elevated text-vault-primary border border-vault-border"
              : "text-vault-muted hover:text-vault-secondary hover:bg-vault-elevated/40"
          )}
        >
          <Link2 className="w-3.5 h-3.5 text-vault-pending" />
          <span>Link</span>
        </button>

        <div className="ml-auto flex items-center gap-1 text-[11px] text-vault-muted hidden sm:flex">
          <Sparkles className="w-3 h-3 text-vault-accent" />
          <span>{folderId ? "Direct Capture" : "1-Tap Inbox Capture"}</span>
        </div>
      </div>

      {/* Inputs */}
      <form onSubmit={handleCapture} className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => setIsExpanded(true)}
            onKeyDown={handleKeyDown}
            placeholder={
              itemType === "ticker"
                ? "Ticker symbol (e.g. $NVDA, BTC)..."
                : itemType === "link"
                ? "Link title (optional)..."
                : "Quick capture note title or thought..."
            }
            className="flex-1 h-9 px-3 bg-vault-bg border border-vault-border rounded-md text-xs sm:text-sm text-vault-primary placeholder-vault-muted focus:outline-none focus:border-vault-border-active transition-colors"
            disabled={isSubmitting}
          />

          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isSubmitting || (!title.trim() && !content.trim())}
            className="h-9 px-4 font-medium shrink-0"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            <span>Capture</span>
          </Button>
        </div>

        {/* Detailed Body Area (Expanded for notes / links) */}
        {(isExpanded || itemType === "link") && (
          <div className="space-y-2 animate-in fade-in duration-100">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={itemType === "note" ? 3 : 2}
              placeholder={
                itemType === "link"
                  ? "https://..."
                  : itemType === "ticker"
                  ? "Thesis, levels, or rationale..."
                  : "Write note content (Markdown supported)..."
              }
              className="w-full p-2.5 bg-vault-bg border border-vault-border rounded-md text-xs text-vault-primary placeholder-vault-muted focus:outline-none focus:border-vault-border-active transition-colors resize-none"
              disabled={isSubmitting}
            />

            <div className="flex items-center justify-between text-[11px] text-vault-muted pt-1">
              <span>Press <kbd className="px-1 py-0.5 rounded bg-vault-elevated border border-vault-border text-[10px]">Ctrl+Enter</kbd> to save</span>
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="text-vault-secondary hover:text-vault-primary"
              >
                Collapse
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
