import React, { useState, useEffect, useRef } from "react";
import { FolderPlus, X } from "lucide-react";
import { Folder } from "../../types";
import { Button } from "../common/Button";

export interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, parentId: string | null, color: string | null) => Promise<void> | void;
  initialParentId?: string | null;
  folders: Folder[];
}

const PRESET_COLORS = [
  { label: "Blue", value: "#2F81F7" },
  { label: "Green", value: "#238636" },
  { label: "Amber", value: "#D29922" },
  { label: "Purple", value: "#A371F7" },
  { label: "Red", value: "#F85149" },
  { label: "Slate", value: "#8B949E" },
];

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  initialParentId = null,
  folders,
}) => {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [selectedColor, setSelectedColor] = useState<string | null>("#2F81F7");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setParentId(initialParentId);
      setSelectedColor("#2F81F7");
      setError(null);
      setIsSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialParentId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Folder name is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      await onCreate(trimmed, parentId, selectedColor);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeFolders = folders.filter((f) => !f.is_deleted);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs select-none">
      <div
        className="w-full max-w-md bg-vault-card border border-vault-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-folder-title"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-vault-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-vault-primary font-semibold text-sm">
            <FolderPlus className="w-4 h-4 text-vault-accent" />
            <span id="create-folder-title">Create New Folder</span>
          </div>
          <button
            onClick={onClose}
            className="text-vault-muted hover:text-vault-secondary rounded p-1 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Folder Name */}
          <div>
            <label className="block text-xs font-medium text-vault-secondary mb-1.5">
              Folder Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Market Research, Daily Logs"
              className="w-full h-9 px-3 bg-vault-bg border border-vault-border rounded-md text-sm text-vault-primary placeholder-vault-muted focus:outline-none focus:border-vault-border-active transition-colors"
              disabled={isSubmitting}
            />
            {error && <p className="text-xs text-vault-error mt-1">{error}</p>}
          </div>

          {/* Parent Folder */}
          <div>
            <label className="block text-xs font-medium text-vault-secondary mb-1.5">
              Location (Parent Folder)
            </label>
            <select
              value={parentId || ""}
              onChange={(e) => setParentId(e.target.value ? e.target.value : null)}
              className="w-full h-9 px-3 bg-vault-bg border border-vault-border rounded-md text-xs text-vault-primary focus:outline-none focus:border-vault-border-active transition-colors"
              disabled={isSubmitting}
            >
              <option value="">📁 Root (Top Level)</option>
              {activeFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  📁 {folder.name}
                </option>
              ))}
            </select>
          </div>

          {/* Color Selector */}
          <div>
            <label className="block text-xs font-medium text-vault-secondary mb-1.5">
              Color Tag
            </label>
            <div className="flex items-center gap-2">
              {PRESET_COLORS.map((c) => {
                const isSelected = selectedColor === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setSelectedColor(c.value)}
                    className="w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:outline-none"
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  >
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-white shadow-xs" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-vault-border/60">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSubmitting || !name.trim()}
            >
              {isSubmitting ? "Creating..." : "Create Folder"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
