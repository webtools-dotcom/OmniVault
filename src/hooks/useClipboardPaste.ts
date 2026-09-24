import { useEffect, useCallback } from "react";

export interface UseClipboardPasteOptions {
  onPasteImage?: (dataUrl: string, file: File) => void;
  enabled?: boolean;
}

export function useClipboardPaste({ onPasteImage, enabled = true }: UseClipboardPasteOptions) {
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (!enabled || !onPasteImage) return;

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      const items = clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = (event) => {
              const dataUrl = event.target?.result as string;
              if (dataUrl) {
                onPasteImage(dataUrl, file);
              }
            };
            reader.readAsDataURL(file);
            break;
          }
        }
      }
    },
    [enabled, onPasteImage],
  );

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);
}
