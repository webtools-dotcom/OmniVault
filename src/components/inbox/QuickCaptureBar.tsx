import React, { useState, useRef } from "react";
import { Check, Loader2, Sparkles, CornerDownLeft, FileText } from "lucide-react";
import { ItemType, VaultItem } from "../../types";
import { cn } from "../../utils/cn";
import { StorageService, cacheLocalMedia } from "../../services/storageService";

export interface QuickCaptureBarProps {
  onCapture: (
    itemType: ItemType,
    title: string,
    content: string,
    metadata?: string,
    existingItem?: VaultItem,
  ) => Promise<void> | void;
  folderId?: string | null;
}

const CAPTURE_TYPES: { value: ItemType; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "ticker", label: "Ticker" },
  { value: "link", label: "Link" },
  { value: "image", label: "Photo" },
  { value: "file", label: "File" },
];

/** Uploads travel as base64 inside a 50 MB request, so this leaves headroom. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const QuickCaptureBar: React.FC<QuickCaptureBarProps> = ({
  onCapture,
  folderId: _folderId = null,
}) => {
  const [itemType, setItemType] = useState<ItemType>("note");
  const [title, setTitle] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<{ name: string; sizeStr: string } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [justSynced, setJustSynced] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleCapture = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmittingRef.current) return;

    const cleanTitle = title.trim();
    if (!cleanTitle && !imagePreview && !pendingFile) return;
    if (itemType === "file" && !pendingFile) {
      docInputRef.current?.click();
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setCaptureError(null);

    try {
      let metadata: string | null = null;
      let finalTitle = cleanTitle;
      let finalContent = cleanTitle;

      if (itemType === "file" && pendingFile) {
        const uploadRes = await StorageService.uploadMedia(pendingFile, {
          title: cleanTitle || pendingFile.name,
          folderId: _folderId,
          fileName: pendingFile.name,
        });
        if (!uploadRes?.item) {
          throw new Error("Files need the desktop app, or a browser paired with it.");
        }
        setTitle("");
        setPendingFile(null);
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 2000);
        await onCapture(
          "file",
          uploadRes.item.title,
          uploadRes.item.content,
          uploadRes.item.metadata || undefined,
          uploadRes.item,
        );
        return;
      }

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
                uploadRes.item,
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
      // Tell the user; otherwise a failed capture looks like a slow one.
      console.error("Quick capture failed:", err);
      setCaptureError(err instanceof Error ? err.message : "Could not save that. Try again.");
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

  const handleDocChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setCaptureError(
        `${file.name} is ${formatFileSize(file.size)}. Files up to 25 MB can be stored.`,
      );
      return;
    }
    setCaptureError(null);
    setPendingFile(file);
    setItemType("file");
  };

  return (
    <div
      className={cn(
        "bg-vault-card transition-shadow",
        // Phone: parked at the bottom edge, clear of the home indicator.
        "fixed inset-x-0 bottom-0 z-30 px-3 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(9,10,13,0.5)]",
        // Anything wider: back in the flow above the list.
        "sm:static sm:rounded-xl sm:px-3 sm:py-2 sm:mb-4 sm:shadow-none sm:ring-1 sm:ring-vault-border sm:focus-within:ring-vault-border-active",
      )}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />
      <input ref={docInputRef} type="file" onChange={handleDocChange} className="hidden" />

      <form
        onSubmit={handleCapture}
        className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-2.5"
      >
        <Sparkles className="hidden sm:block w-3.5 h-3.5 text-vault-muted select-none shrink-0" />

        {/* Our own control, not the platform's: a native select drops a
            system-styled menu into the middle of the design. */}
        <div
          className="order-1 sm:order-none flex items-center gap-0.5 shrink-0"
          role="group"
          aria-label="What are you capturing?"
        >
          {CAPTURE_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={itemType === t.value}
              onClick={() => {
                setItemType(t.value);
                if (t.value !== "file") setPendingFile(null);
                if (t.value === "image") {
                  fileInputRef.current?.click();
                } else if (t.value === "file") {
                  docInputRef.current?.click();
                }
              }}
              className={cn(
                "h-7 px-2.5 rounded-lg text-xs transition-colors cursor-pointer",
                itemType === t.value
                  ? "bg-vault-elevated text-vault-primary font-medium"
                  : "text-vault-muted hover:text-vault-secondary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Unified rapid capture input */}
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            itemType === "ticker"
              ? "Ticker symbol — NVDA, BTC…"
              : itemType === "link"
                ? "Paste a link…"
                : itemType === "image"
                  ? "Choose a photo, or paste one…"
                  : itemType === "file"
                    ? pendingFile
                      ? "Name it, or leave it as the file name…"
                      : "Choose a PDF, spreadsheet, any file…"
                    : "Capture a thought, a link, a ticker…"
          }
          className="order-3 sm:order-none basis-full sm:basis-auto flex-1 min-w-0 h-8 sm:h-auto bg-vault-elevated sm:bg-transparent rounded-lg sm:rounded-none px-2.5 sm:px-0 text-[0.8125rem] text-vault-primary placeholder:text-vault-subtle focus:outline-none"
          disabled={isSubmitting}
        />

        {/* Image preview badge if loaded */}
        {imagePreview && (
          <div className="order-1 sm:order-none flex items-center gap-1.5 px-2 py-1 rounded-lg bg-vault-elevated text-vault-primary text-xs shrink-0">
            <img src={imagePreview} alt="Preview" className="w-4 h-4 rounded object-cover" />
            <span className="max-w-[100px] truncate">{imageInfo?.name || "Photo attached"}</span>
            <button
              type="button"
              onClick={() => {
                setImagePreview(null);
                setImageInfo(null);
              }}
              className="text-vault-secondary hover:text-vault-primary ml-1 cursor-pointer text-xs"
              title="Remove photo"
            >
              ×
            </button>
          </div>
        )}

        {pendingFile && (
          <div className="order-1 sm:order-none flex items-center gap-1.5 px-2 py-1 rounded-lg bg-vault-elevated text-vault-primary text-xs shrink-0">
            <FileText className="w-3.5 h-3.5 text-vault-secondary" />
            <span className="max-w-[140px] truncate">{pendingFile.name}</span>
            <span className="text-vault-muted">{formatFileSize(pendingFile.size)}</span>
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              className="text-vault-secondary hover:text-vault-primary ml-1 cursor-pointer text-xs"
              title="Remove file"
            >
              ×
            </button>
          </div>
        )}

        {/* Capture button */}
        <button
          type="submit"
          disabled={isSubmitting || (!title.trim() && !imagePreview && !pendingFile)}
          className="order-2 sm:order-none ml-auto sm:ml-0 h-8 sm:h-7 px-3 bg-vault-accent hover:bg-vault-accent-hover disabled:opacity-30 text-vault-ink rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-vault-ink" />
              <span className="hidden sm:inline">Saving...</span>
            </>
          ) : justSynced ? (
            <>
              <Check className="w-3.5 h-3.5 text-vault-ink" />
              <span className="font-semibold">Saved</span>
            </>
          ) : (
            <>
              <span>Capture</span>
              <CornerDownLeft className="hidden sm:block w-3 h-3" />
            </>
          )}
        </button>
      </form>

      {captureError && <div className="mt-2 text-xs text-vault-error">{captureError}</div>}

      {/* Uploading progress status bar for large photos */}
      {isSubmitting && itemType === "image" && (
        <div className="mt-2 flex items-center justify-between text-xs text-vault-secondary">
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin text-vault-secondary" />
            <span>Compressing and sending the photo…</span>
          </div>
          {imageInfo?.sizeStr && (
            <span className="text-vault-secondary/80">{imageInfo.sizeStr}</span>
          )}
        </div>
      )}
    </div>
  );
};
