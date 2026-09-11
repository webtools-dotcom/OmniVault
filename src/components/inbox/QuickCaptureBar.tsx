import React, { useState, useRef } from "react";
import { ItemType } from "../../types";
import { StorageService } from "../../services/storageService";

export interface QuickCaptureBarProps {
  onCapture: (itemType: ItemType, title: string, content: string, metadata?: string) => Promise<void> | void;
  folderId?: string | null;
}

export const QuickCaptureBar: React.FC<QuickCaptureBarProps> = ({ onCapture, folderId: _folderId = null }) => {
  const [itemType, setItemType] = useState<ItemType>("note");
  const [title, setTitle] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCapture = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanTitle = title.trim();

    if (!cleanTitle && !imagePreview) return;

    try {
      setIsSubmitting(true);
      let metadata: string | null = null;
      let finalTitle = cleanTitle;
      let finalContent = cleanTitle;

      if (itemType === "ticker") {
        const tickerSymbol = cleanTitle.replace(/^\$/, "").toUpperCase();
        finalTitle = `$${tickerSymbol}`;
        metadata = JSON.stringify({ ticker: tickerSymbol });
      } else if (itemType === "link") {
        finalTitle = cleanTitle.replace(/^https?:\/\//i, "").split("/")[0] || "Saved Link";
        finalContent = cleanTitle;
        metadata = JSON.stringify({ url: cleanTitle });
      } else if (itemType === "image") {
        finalTitle = cleanTitle || "Screenshot / Image Capture";
        if (imagePreview) {
          const uploadRes = await StorageService.uploadMedia(imagePreview, {
            title: finalTitle,
            folderId: _folderId,
          });
          if (uploadRes && uploadRes.url) {
            finalContent = uploadRes.url;
            metadata = JSON.stringify({
              isImage: true,
              mimeType: "image/webp",
              fileHash: uploadRes.file_hash,
              byteSize: (uploadRes as any).byte_size,
              width: (uploadRes as any).width,
              height: (uploadRes as any).height,
              capturedAt: Date.now(),
            });
          } else {
            finalContent = imagePreview;
            metadata = JSON.stringify({
              isImage: true,
              mimeType: "image/webp",
              capturedAt: Date.now(),
            });
          }
        }
      }

      await onCapture(itemType, finalTitle, finalContent, metadata || undefined);
      setTitle("");
      setImagePreview(null);
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
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="bg-[#141419] border border-white/[0.08] hover:border-white/[0.16] rounded-xl px-3 py-2 transition-all shadow-xs mb-3">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />

      <form onSubmit={handleCapture} className="flex items-center gap-2.5">
        <span className="text-emerald-400 font-mono text-sm font-bold select-none shrink-0">❯</span>

        {/* Format selector pill */}
        <select
          value={itemType}
          onChange={(e) => {
            const next = e.target.value as ItemType;
            setItemType(next);
            if (next === "image") {
              fileInputRef.current?.click();
            }
          }}
          className="bg-[#1C1C23] text-zinc-300 text-xs font-mono px-2 py-1 rounded-md border border-white/[0.08] focus:outline-none cursor-pointer shrink-0"
        >
          <option value="note">Note</option>
          <option value="ticker">$ Ticker</option>
          <option value="link">Link</option>
          <option value="image">Screenshot</option>
        </select>

        {/* Unified rapid capture input */}
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCapture();
            }
          }}
          placeholder={
            itemType === "ticker"
              ? "Enter ticker symbol (e.g. $NVDA, BTC)..."
              : itemType === "link"
              ? "Paste web link (e.g. https://...)..."
              : itemType === "image"
              ? "Click to choose image or press Ctrl+V to paste..."
              : "Capture note, task, or fleeting thought (press Enter)..."
          }
          className="flex-1 bg-transparent text-xs sm:text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none font-sans"
          disabled={isSubmitting}
        />

        {/* Image preview badge if loaded */}
        {imagePreview && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[11px] font-mono shrink-0">
            <span>Image Ready</span>
            <button
              type="button"
              onClick={() => setImagePreview(null)}
              className="text-zinc-400 hover:text-white ml-1 cursor-pointer"
            >
              ×
            </button>
          </div>
        )}

        {/* Capture button */}
        <button
          type="submit"
          disabled={isSubmitting || (!title.trim() && !imagePreview)}
          className="h-7 px-2.5 bg-[#202028] hover:bg-[#282834] disabled:opacity-30 text-zinc-200 hover:text-white rounded-lg text-xs font-medium border border-white/10 transition-all cursor-pointer flex items-center gap-1.5 shrink-0 shadow-xs"
        >
          <span>Capture</span>
          <kbd className="font-mono text-[10px] text-zinc-400">↵</kbd>
        </button>
      </form>
    </div>
  );
};
