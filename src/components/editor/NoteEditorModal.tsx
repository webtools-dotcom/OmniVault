import React, { useState, useEffect, useRef, useMemo } from "react";
import { Check, Columns2, Eye, FileText, Pin, Trash2, X } from "lucide-react";
import { Folder, ItemType, VaultItem } from "../../types";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { renderMarkdown } from "../../utils/markdown";
import { extractTickers } from "../../utils/tickerDetector";
import { extractLinks } from "../../utils/linkDetector";
import { SmartMarketLauncher } from "../research/SmartMarketLauncher";
import { Button } from "../common/Button";
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
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [isPinned, setIsPinned] = useState(false);

  const [currentId, setCurrentId] = useState<string | null>(item?.id || null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const isInitialMount = useRef(true);

  // Initialize or reset state when modal opens or item changes
  useEffect(() => {
    if (isOpen) {
      if (item) {
        setCurrentId(item.id);
        setTitle(item.title);
        setContent(item.content);
        setFolderId(item.folder_id);
        setItemType(item.item_type as ItemType);
        setIsPinned(item.is_pinned);
      } else {
        setCurrentId(null);
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

  // `onSave` is recreated on every App render, so depending on it directly made
  // each completed save schedule the next one: the editor re-saved roughly
  // every 600ms for as long as it stayed open, writing a revision each time and
  // never letting the status badge settle. Hold the latest callback in a ref so
  // the effect re-runs only when the note itself changes.
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Writing the note is its own function so that closing the editor can flush a
  // save that is still inside the debounce window. The effect cleanup cancels
  // that pending timer, so typing and closing within 600ms used to drop the
  // last edit without a word.
  const persist = async (): Promise<boolean> => {
    try {
      const finalTitle = title.trim() || "Untitled Note";
      const saved = await onSaveRef.current(
        currentId,
        finalTitle,
        content,
        folderId,
        itemType
      );
      if (saved && saved.id) {
        setCurrentId(saved.id);
      }
      setSaveStatus("saved");
      return true;
    } catch (err) {
      console.error("Auto-save failed:", err);
      setSaveStatus("error");
      return false;
    }
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;

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

    saveTimeoutRef.current = window.setTimeout(() => {
      void persistRef.current();
    }, 600);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [title, content, folderId, itemType, isOpen, currentId]);

  const detectedTickers = useMemo(() => extractTickers(`${title} ${content}`), [title, content]);
  const detectedLinks = useMemo(() => extractLinks(content), [content]);

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

  const handleRequestClose = async () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    // A save still inside the debounce window is finished here rather than
    // thrown away by the effect cleanup.
    const stillUnsaved = saveStatus === "saving" ? !(await persist()) : saveStatus === "error";
    if (stillUnsaved) {
      const discard = window.confirm(
        "This note has not been saved to the vault. Close anyway and lose the unsaved changes?"
      );
      if (!discard) return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md select-none">
      <div
        className="w-full max-w-5xl h-[92vh] max-h-[860px] bg-vault-card/95 border border-vault-border rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.75)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl"
        role="dialog"
        aria-modal="true"
      >
        {/* Editor Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-vault-border flex items-center justify-between gap-3 shrink-0 bg-vault-card/90">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-vault-accent/15 border border-vault-accent/30 flex items-center justify-center text-vault-accent shrink-0 shadow-[0_0_12px_rgba(59,130,246,0.2)]">
              <FileText className="w-4 h-4 text-vault-accent" />
            </div>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note Title..."
              className="w-full font-semibold text-sm sm:text-base text-vault-primary bg-transparent focus:outline-none placeholder-vault-muted transition-colors tracking-tight"
            />
          </div>

          {/* Destination Folder Selector */}
          <div className="hidden md:flex items-center gap-1.5 shrink-0">
            <select
              value={folderId || ""}
              onChange={(e) => setFolderId(e.target.value ? e.target.value : null)}
              className="h-8 px-2.5 bg-vault-bg border border-vault-border rounded-lg text-xs text-vault-primary focus:outline-none focus:border-vault-accent/50 transition-colors cursor-pointer"
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
          <div className="flex items-center gap-1 bg-vault-bg p-1 rounded-xl border border-vault-border shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("edit")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs transition-all font-medium cursor-pointer",
                viewMode === "edit"
                  ? "bg-vault-card text-vault-primary shadow-xs"
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
                "px-2.5 py-1 rounded-lg text-xs transition-all font-medium hidden sm:flex items-center gap-1.5 cursor-pointer",
                viewMode === "split"
                  ? "bg-vault-card text-vault-primary shadow-xs"
                  : "text-vault-muted hover:text-vault-secondary"
              )}
              title="Split View"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs transition-all font-medium flex items-center gap-1.5 cursor-pointer",
                viewMode === "preview"
                  ? "bg-vault-card text-vault-primary shadow-xs"
                  : "text-vault-muted hover:text-vault-secondary"
              )}
              title="Preview only"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
          </div>

          {/* Auto-save Status Badge */}
          <div className="shrink-0 flex items-center">
            {saveStatus === "saving" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[0.815rem] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span>Saving</span>
              </span>
            ) : saveStatus === "error" ? (
              <span
                title="This note has not reached the vault. Keep this window open and check your connection — typing again retries."
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[0.815rem] font-medium bg-rose-500/10 text-rose-300 border border-rose-500/30"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                <span>Not saved</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.815rem] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Check className="w-3 h-3" />
                <span>Saved</span>
              </span>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleRequestClose}
            className="w-8 h-8 flex items-center justify-center text-vault-muted hover:text-vault-primary hover:bg-vault-elevated rounded-lg transition-colors shrink-0 cursor-pointer"
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
                className="w-full h-full p-4 sm:p-6 bg-transparent text-vault-primary text-xs sm:text-sm font-sans placeholder-vault-muted resize-none focus:outline-none leading-relaxed selection:bg-vault-accent/30 selection:text-white"
              />
            </div>
          )}

          {/* Markdown Preview (Preview or Split) */}
          {viewMode !== "edit" && (
            <div
              className={cn(
                "h-full p-4 sm:p-6 overflow-y-auto bg-vault-card/40",
                viewMode === "split" ? "w-1/2" : "w-full"
              )}
            >
              {content.trim() ? (
                <div className="prose prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-slate-100 prose-p:text-slate-300 prose-p:leading-relaxed prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-code:text-sky-300 prose-code:bg-vault-elevated prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-blockquote:border-l prose-blockquote:border-vault-accent/40 prose-blockquote:text-slate-400 prose-blockquote:bg-vault-elevated/50 prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:rounded-r-xl">
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
          <div className="px-4 sm:px-6 py-2.5 border-t border-vault-border/60 bg-vault-bg/60 flex items-center gap-3">
            <span className="text-[0.815rem] font-semibold text-vault-muted uppercase tracking-wider shrink-0">
              Detected Symbols:
            </span>
            <div className="flex-1 overflow-x-auto">
              <SmartMarketLauncher tickers={detectedTickers} links={detectedLinks} />
            </div>
          </div>
        )}

        {/* Editor Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-vault-border bg-vault-card flex items-center justify-between text-xs text-vault-secondary shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[0.815rem]">{wordCount} words</span>
            <span className="text-vault-muted">•</span>
            <span className="font-mono text-[0.815rem]">{charCount} characters</span>
            {item && onTogglePin && (
              <>
                <span className="text-vault-muted">•</span>
                <button
                  type="button"
                  onClick={() => {
                    setIsPinned(!isPinned);
                    onTogglePin(item.id);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors cursor-pointer",
                    isPinned
                      ? "text-amber-400 bg-amber-400/10 font-medium"
                      : "text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated"
                  )}
                >
                  <Pin className={cn("w-3.5 h-3.5", isPinned && "fill-current")} />
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
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                <span>Delete</span>
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleRequestClose}
              className="font-medium"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
