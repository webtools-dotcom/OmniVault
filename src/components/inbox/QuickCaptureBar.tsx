import React, { useState, useRef } from "react";
import { Check, Loader2, Sparkles, CornerDownLeft } from "lucide-react";
import { ItemType, VaultItem } from "../../types";
import { StorageService, cacheLocalMedia } from "../../services/storageService";

export interface QuickCaptureBarProps {
  onCapture: (
    itemType: ItemType,
    title: string,
    content: string,
    metadata?: string,
    existingItem?: VaultItem
  ) => Promise<void> | void;
  folderId?: string | null;
}

export const QuickCaptureBar: React.FC<QuickCaptureBarProps> = ({ onCapture, folderId: _folderId = null }) => {
  const [itemType, setItemType] = useState<ItemType>("note");
  const [title, setTitle] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<{ name: string; sizeStr: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [justSynced, setJustSynced] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleCapture = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmittingRef.current) return;

    const cleanTitle = title.trim();
    if (!cleanTitle && !imagePreview) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setCaptureError(null);

    try {
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
        finalTitle = cleanTitle || imageInfo?.name || "Screenshot / Image Capture";
        if (imagePreview) {
          const currentPreview = imagePreview;
          // Upload media to disk storage on host
          const uploadRes = await StorageService.uploadMedia(currentPreview, {
            title: finalTitle,
            folderId: _folderId,
          });

          if (uploadRes) {
            // Pre-cache preview in memory so the local image card renders in 0ms without re-downloading across Wi-Fi
            if (uploadRes.url) {
              cacheLocalMedia(uploadRes.url, currentPreview);
            }
            if (uploadRes.file_hash) {
              cacheLocalMedia(uploadRes.file_hash, currentPreview);
            }

            // Immediately clear inputs and indicate sync
            setTitle("");
            setImagePreview(null);
            setImageInfo(null);
            setJustSynced(true);
            setTimeout(() => setJustSynced(false), 2000);
            inputRef.current?.focus();

            // Hand off already-created item to parent for 0ms optimistic UI update (avoids duplicate POST)
            if (uploadRes.item) {
              await onCapture(
                "image",
                uploadRes.item.title,
                uploadRes.item.content,
                uploadRes.item.metadata || undefined,
                uploadRes.item
              );
            }
            return;
          } else {
            finalContent = currentPreview;
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
      setImageInfo(null);
      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 2000);
      inputRef.current?.focus();
    } catch (err) {
      // Silence here used to mean a failed capture looked identical to a
      // successful one apart from the text staying in the box.
      console.error("Quick capture failed:", err);
      setCaptureError(
        err instanceof Error ? err.message : "Could not save that. Try again."
      );
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageInfo({
      name: file.name.replace(/\.[^/.]+$/, ""),
      sizeStr: formatFileSize(file.size),
    });

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
    <div className="bg-vault-panel/80 border border-white/[0.08] hover:border-white/[0.16] rounded-xl px-3 py-2 transition-all shadow-sm mb-3 backdrop-blur-sm">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />

      <form onSubmit={handleCapture} className="flex items-center gap-2.5">
        <Sparkles className="w-3.5 h-3.5 text-indigo-400 select-none shrink-0" />

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
          className="bg-vault-card text-zinc-300 text-xs px-2 py-1 rounded-lg border border-white/[0.08] focus:outline-none focus:border-indigo-500/50 cursor-pointer shrink-0 font-sans"
        >
          <option value="note">Note</option>
          <option value="ticker">$ Ticker</option>
          <option value="link">Link</option>
          <option value="image">Photo</option>
        </select>

        {/* Unified rapid capture input */}
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            itemType === "ticker"
              ? "Enter ticker symbol (e.g. $NVDA, BTC)..."
              : itemType === "link"
              ? "Paste web link (e.g. https://...)..."
              : itemType === "image"
              ? "Click to choose photo or press Ctrl+V to paste..."
              : "Capture note, task, or fleeting thought (press Enter)..."
          }
          className="flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none font-sans"
          disabled={isSubmitting}
        />

        {/* Image preview badge if loaded */}
        {imagePreview && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs shrink-0">
            <img
              src={imagePreview}
              alt="Preview"
              className="w-4 h-4 rounded object-cover"
            />
            <span className="max-w-[100px] truncate">{imageInfo?.name || "Photo attached"}</span>
            <button
              type="button"
              onClick={() => {
                setImagePreview(null);
                setImageInfo(null);
              }}
              className="text-zinc-400 hover:text-white ml-1 cursor-pointer text-xs"
              title="Remove photo"
            >
              ×
            </button>
          </div>
        )}

        {/* Capture button */}
        <button
          type="submit"
          disabled={isSubmitting || (!title.trim() && !imagePreview)}
          className="h-7 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white rounded-lg text-xs font-medium border border-indigo-400/20 transition-all cursor-pointer flex items-center gap-1.5 shrink-0 shadow-sm"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-white" />
              <span className="hidden sm:inline">Saving...</span>
            </>
          ) : justSynced ? (
            <>
              <Check className="w-3.5 h-3.5 text-white" />
              <span className="text-white font-medium">Saved</span>
            </>
          ) : (
            <>
              <span>Capture</span>
              <CornerDownLeft className="w-3 h-3 text-indigo-200" />
            </>
          )}
        </button>
      </form>

      {captureError && (
        <div className="mt-2 pt-1.5 border-t border-white/[0.06] text-xs text-rose-300 font-sans">
          {captureError}
        </div>
      )}

      {/* Uploading progress status bar for large photos */}
      {isSubmitting && itemType === "image" && (
        <div className="mt-2 pt-1.5 border-t border-white/[0.06] flex items-center justify-between text-xs text-indigo-300 animate-pulse font-sans">
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
            <span>Compressing and syncing photo to mesh vault...</span>
          </div>
          {imageInfo?.sizeStr && <span className="text-indigo-400/80">{imageInfo.sizeStr}</span>}
        </div>
      )}
    </div>
  );
};
