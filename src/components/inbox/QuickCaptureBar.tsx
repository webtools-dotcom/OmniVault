import React, { useState, useRef } from "react";
import { FileText, Image as ImageIcon, Link2, Plus, Sparkles, TrendingUp } from "lucide-react";
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
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCapture = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanTitle = title.trim();
    const cleanContent = content.trim();

    if (!cleanTitle && !cleanContent && !imagePreview) return;

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
      } else if (itemType === "image") {
        if (!finalTitle) finalTitle = "Screenshot / Image Capture";
        finalContent = imagePreview || cleanContent;
        metadata = JSON.stringify({
          isImage: true,
          mimeType: "image/webp",
          capturedAt: Date.now(),
        });
      } else if (!finalTitle && finalContent) {
        finalTitle = finalContent.slice(0, 40) + (finalContent.length > 40 ? "..." : "");
      }

      await onCapture(itemType, finalTitle, finalContent, metadata || undefined);
      setTitle("");
      setContent("");
      setImagePreview(null);
      setIsExpanded(false);
      inputRef.current?.focus();
    } catch (err) {
      console.error("Quick capture failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setImagePreview(dataUrl);
        setItemType("image");
        if (!title.trim()) {
          setTitle(file.name.replace(/\.[^/.]+$/, ""));
        }
        setIsExpanded(true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !isExpanded)) {
      e.preventDefault();
      handleCapture();
    }
  };

  return (
    <div className="bg-vault-card/90 border border-white/[0.08] rounded-2xl p-3.5 sm:p-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.04] mb-6 backdrop-blur-md transition-all duration-200">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Type Selector Tabs */}
      <div className="flex items-center gap-1.5 mb-3 pb-2.5 border-b border-white/[0.06] overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => {
            setItemType("note");
            setImagePreview(null);
          }}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer min-h-[32px] shrink-0",
            itemType === "note"
              ? "bg-white/[0.08] text-vault-primary font-semibold ring-1 ring-white/[0.15] shadow-xs"
              : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
          )}
        >
          <FileText className="w-3.5 h-3.5 text-blue-400" />
          <span>Note</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setItemType("ticker");
            setImagePreview(null);
          }}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer min-h-[32px] shrink-0",
            itemType === "ticker"
              ? "bg-white/[0.08] text-vault-primary font-semibold ring-1 ring-white/[0.15] shadow-xs"
              : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
          )}
        >
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          <span>Ticker ($)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setItemType("link");
            setImagePreview(null);
          }}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer min-h-[32px] shrink-0",
            itemType === "link"
              ? "bg-white/[0.08] text-vault-primary font-semibold ring-1 ring-white/[0.15] shadow-xs"
              : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
          )}
        >
          <Link2 className="w-3.5 h-3.5 text-amber-400" />
          <span>Link</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setItemType("image");
            fileInputRef.current?.click();
          }}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer min-h-[32px] shrink-0",
            itemType === "image"
              ? "bg-white/[0.08] text-vault-primary font-semibold ring-1 ring-white/[0.15] shadow-xs"
              : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
          )}
        >
          <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
          <span>Screenshot</span>
        </button>

        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-vault-muted hidden sm:flex shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span>{folderId ? "Direct Capture" : "Ctrl+V to Paste Screenshot"}</span>
        </div>
      </div>

      {/* Image Preview Thumbnail if selected */}
      {imagePreview && (
        <div className="mb-3 p-2.5 rounded-xl bg-vault-bg/90 border border-white/[0.08] flex items-center gap-3">
          <img
            src={imagePreview}
            alt="Upload Preview"
            className="w-16 h-12 object-cover rounded-lg border border-white/[0.1] shrink-0 shadow-xs"
          />
          <div className="min-w-0 flex-1 text-xs">
            <span className="text-vault-primary font-semibold block truncate">
              Image ready to capture
            </span>
            <span className="text-[11px] text-vault-muted">
              Auto-compresses to WebP on save
            </span>
          </div>
          <button
            type="button"
            onClick={() => setImagePreview(null)}
            className="text-vault-muted hover:text-rose-400 text-xs px-2.5 py-1 rounded-md hover:bg-rose-500/10 transition-colors"
          >
            Remove
          </button>
        </div>
      )}

      {/* Inputs */}
      <form onSubmit={handleCapture} className="space-y-2.5">
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
                : itemType === "image"
                ? "Image caption or title..."
                : "Quick capture note title or thought..."
            }
            className="flex-1 h-10 px-3.5 bg-vault-bg/90 border border-white/[0.08] rounded-xl text-xs sm:text-sm text-vault-primary placeholder-vault-muted focus:outline-none focus:border-vault-accent focus:ring-1 focus:ring-vault-accent/30 transition-all duration-150"
            disabled={isSubmitting}
          />

          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isSubmitting || (!title.trim() && !content.trim() && !imagePreview)}
            className="h-10 px-4.5 rounded-xl font-semibold shrink-0 shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-all duration-150 active:scale-95"
          >
            <Plus className="w-4 h-4 mr-1" />
            <span>Capture</span>
          </Button>
        </div>

        {/* Detailed Body Area (Expanded for notes / links) */}
        {(isExpanded || itemType === "link") && itemType !== "image" && (
          <div className="space-y-2 animate-in fade-in duration-150">
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
              className="w-full p-3 bg-vault-bg/90 border border-white/[0.08] rounded-xl text-xs sm:text-sm text-vault-primary placeholder-vault-muted focus:outline-none focus:border-vault-accent focus:ring-1 focus:ring-vault-accent/30 transition-all duration-150 resize-none font-sans"
              disabled={isSubmitting}
            />

            <div className="flex items-center justify-between text-[11px] text-vault-muted pt-0.5">
              <span>Press <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px] font-mono">Ctrl+Enter</kbd> to save</span>
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="text-vault-secondary hover:text-vault-primary transition-colors cursor-pointer"
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
