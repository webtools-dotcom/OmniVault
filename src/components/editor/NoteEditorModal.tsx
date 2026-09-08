import React, { useState, useEffect, useRef, useMemo } from "react";
import { Check, Columns2, Eye, FileText, Pin, Trash2, X } from "lucide-react";
import { Folder, ItemType, VaultItem } from "../../types";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { renderMarkdown } from "../../utils/markdown";
import { extractTickers } from "../../utils/tickerDetector";
import { extractLinks } from "../../utils/linkDetector";
import { SmartMarketLauncher } from "../research/SmartMarketLauncher";
import { Button } from "../common/Button";
import { Badge } from "../common/Badge";
import { cn } from "../../utils/cn";

export interface NoteEditorModalProps {
  item: VaultItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    itemId: string | null,
    title: string,
    content: string,
    folderId: string | null,
    itemType: ItemType,
    metadata?: string | null
  ) => Promise<VaultItem | void>;
  onDelete?: (itemId: string) => Promise<void> | void;
  onTogglePin?: (itemId: string) => Promise<void> | void;
  folders: Folder[];
  initialFolderId?: string | null;
}

type EditorViewMode = "edit" | "split" | "preview";

export const NoteEditorModal: React.FC<NoteEditorModalProps> = ({
  item,
  isOpen,
  onClose,
  onSave,
  onDelete,
  onTogglePin,
  folders,
  initialFolderId = null,
}) => {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folderId, setFolderId] = useState<string | null>(initialFolderId);
  const [itemType, setItemType] = useState<ItemType>("note");
  const [viewMode, setViewMode] = useState<EditorViewMode>("split");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");
  const [isPinned, setIsPinned] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const isInitialMount = useRef(true);

  // Initialize or reset state when modal opens or item changes
  useEffect(() => {
    if (isOpen) {
      if (item) {
        setTitle(item.title);
        setContent(item.content);
        setFolderId(item.folder_id);
        setItemType(item.item_type as ItemType);
        setIsPinned(item.is_pinned);
      } else {
        setTitle("");
        setContent("");
        setFolderId(initialFolderId);
        setItemType("note");
        setIsPinned(false);
      }
      setSaveStatus("saved");
      isInitialMount.current = true;
    }
  }, [isOpen, item, initialFolderId]);

  // Debounced auto-save effect
  useEffect(() => {
    if (!isOpen) return;

    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    setSaveStatus("saving");

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        const finalTitle = title.trim() || "Untitled Note";
        await onSave(
          item ? item.id : null,
          finalTitle,
          content,
          folderId,
          itemType
        );
        setSaveStatus("saved");
      } catch (err) {
        console.error("Auto-save failed:", err);
      }
    }, 600);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [title, content, folderId, itemType, isOpen, item, onSave]);

  if (!isOpen) return null;

  const handleInsertSyntax = (prefix: string, suffix: string = "", defaultPlaceholder: string = "") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = textarea.value;

    const selectedText = currentText.substring(start, end) || defaultPlaceholder;
    const replacement = `${prefix}${selectedText}${suffix}`;

    const nextText = currentText.substring(0, start) + replacement + currentText.substring(end);
    setContent(nextText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selectedText.length
      );
    }, 10);
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;
  const activeFolders = folders.filter((f) => !f.is_deleted);

  const detectedTickers = useMemo(() => extractTickers(`${title} ${content}`), [title, content]);
  const detectedLinks = useMemo(() => extractLinks(content), [content]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-xs select-none">
      <div
        className="w-full max-w-4xl h-[90vh] max-h-[800px] bg-vault-card border border-vault-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Editor Header */}
        <div className="px-4 py-3 border-b border-vault-border flex items-center justify-between gap-3 shrink-0 bg-vault-card">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-7 h-7 rounded-lg bg-vault-accent/15 border border-vault-accent/30 flex items-center justify-center text-vault-accent shrink-0">
              <FileText className="w-4 h-4 text-vault-accent" />
            </div>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note Title..."
              className="w-full font-semibold text-sm sm:text-base text-vault-primary bg-transparent focus:outline-none placeholder-vault-muted"
            />
          </div>

          {/* Destination Folder Selector */}
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <select
              value={folderId || ""}
              onChange={(e) => setFolderId(e.target.value ? e.target.value : null)}
              className="h-7 px-2 bg-vault-bg border border-vault-border rounded text-xs text-vault-primary focus:outline-none focus:border-vault-border-active"
            >
              <option value="">📥 Quick Inbox</option>
              {activeFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  📁 {f.name}
                </option>
              ))}
            </select>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 bg-vault-bg p-0.5 rounded border border-vault-border shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("edit")}
              className={cn(
                "px-2 py-1 rounded text-xs transition-colors",
                viewMode === "edit"
                  ? "bg-vault-card text-vault-primary font-medium"
                  : "text-vault-muted hover:text-vault-secondary"
              )}
              title="Edit only"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setViewMode("split")}
              className={cn(
                "px-2 py-1 rounded text-xs transition-colors hidden sm:flex items-center gap-1",
                viewMode === "split"
                  ? "bg-vault-card text-vault-primary font-medium"
                  : "text-vault-muted hover:text-vault-secondary"
              )}
              title="Split View"
            >
              <Columns2 className="w-3 h-3" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={cn(
                "px-2 py-1 rounded text-xs transition-colors flex items-center gap-1",
                viewMode === "preview"
                  ? "bg-vault-card text-vault-primary font-medium"
                  : "text-vault-muted hover:text-vault-secondary"
              )}
              title="Preview only"
            >
              <Eye className="w-3 h-3" />
              <span>Preview</span>
            </button>
          </div>

          {/* Auto-save Status Badge */}
          <div className="shrink-0 flex items-center">
            {saveStatus === "saving" ? (
              <Badge variant="pending" size="sm" className="gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-vault-pending animate-pulse" />
                <span>Saving</span>
              </Badge>
            ) : (
              <Badge variant="success" size="sm" className="gap-1">
                <Check className="w-3 h-3" />
                <span>Saved</span>
              </Badge>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="text-vault-muted hover:text-vault-secondary rounded p-1 transition-colors shrink-0"
            aria-label="Close editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Markdown Toolbar (visible in edit or split mode) */}
        {viewMode !== "preview" && (
          <MarkdownToolbar onInsertSyntax={handleInsertSyntax} />
        )}

        {/* Editor Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Textarea Input (Edit or Split) */}
          {viewMode !== "preview" && (
            <div
              className={cn(
                "h-full flex flex-col bg-vault-bg",
                viewMode === "split" ? "w-1/2 border-r border-vault-border" : "w-full"
              )}
            >
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your note in Markdown... Press $ to detect stock tickers automatically."
                className="w-full h-full p-4 bg-transparent text-vault-primary text-xs sm:text-sm font-sans placeholder-vault-muted resize-none focus:outline-none leading-relaxed"
              />
            </div>
          )}

          {/* Markdown Preview (Preview or Split) */}
          {viewMode !== "edit" && (
            <div
              className={cn(
                "h-full p-4 overflow-y-auto bg-vault-card/40",
                viewMode === "split" ? "w-1/2" : "w-full"
              )}
            >
              {content.trim() ? (
                <div className="prose prose-invert max-w-none">
                  {renderMarkdown(content)}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-vault-muted italic">
                  Markdown preview will render here...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Detected Market Symbols Bar */}
        {(detectedTickers.length > 0 || detectedLinks.length > 0) && (
          <div className="px-4 py-2 border-t border-vault-border/60 bg-vault-bg/40 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-vault-muted uppercase tracking-wider shrink-0">
              Detected Symbols:
            </span>
            <div className="flex-1 overflow-x-auto">
              <SmartMarketLauncher tickers={detectedTickers} links={detectedLinks} />
            </div>
          </div>
        )}

        {/* Editor Footer */}
        <div className="px-4 py-2.5 border-t border-vault-border bg-vault-card flex items-center justify-between text-xs text-vault-secondary shrink-0">
          <div className="flex items-center gap-3">
            <span>{wordCount} words</span>
            <span>•</span>
            <span>{charCount} characters</span>
            {item && onTogglePin && (
              <>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => {
                    setIsPinned(!isPinned);
                    onTogglePin(item.id);
                  }}
                  className={cn(
                    "flex items-center gap-1 transition-colors",
                    isPinned ? "text-vault-accent" : "hover:text-vault-primary"
                  )}
                >
                  <Pin className={cn("w-3 h-3", isPinned && "fill-current")} />
                  <span>{isPinned ? "Pinned" : "Pin"}</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {item && onDelete && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (window.confirm("Are you sure you want to delete this note?")) {
                    onDelete(item.id);
                    onClose();
                  }
                }}
                className="h-7 text-xs"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                <span>Delete</span>
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={onClose}
              className="h-7 text-xs font-medium"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
