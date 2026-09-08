import React, { useState, useEffect, useRef } from "react";
import { Edit2, X } from "lucide-react";
import { Folder } from "../../types";
import { Button } from "../common/Button";

export interface RenameFolderModalProps {
  folder: Folder | null;
  isOpen: boolean;
  onClose: () => void;
  onRename: (folderId: string, newName: string) => Promise<void> | void;
}

export const RenameFolderModal: React.FC<RenameFolderModalProps> = ({
  folder,
  isOpen,
  onClose,
  onRename,
}) => {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && folder) {
      setName(folder.name);
      setError(null);
      setIsSubmitting(false);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, folder]);

  if (!isOpen || !folder) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Folder name cannot be empty.");
      return;
    }
    if (trimmed === folder.name) {
      onClose();
      return;
    }

    try {
      setIsSubmitting(true);
      await onRename(folder.id, trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename folder");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs select-none">
      <div
        className="w-full max-w-sm bg-vault-card border border-vault-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-folder-title"
      >
        <div className="px-5 py-4 border-b border-vault-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-vault-primary font-semibold text-sm">
            <Edit2 className="w-4 h-4 text-vault-accent" />
            <span id="rename-folder-title">Rename Folder</span>
          </div>
          <button
            onClick={onClose}
            className="text-vault-muted hover:text-vault-secondary rounded p-1 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-vault-secondary mb-1.5">
              New Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              className="w-full h-9 px-3 bg-vault-bg border border-vault-border rounded-md text-sm text-vault-primary focus:outline-none focus:border-vault-border-active transition-colors"
              disabled={isSubmitting}
            />
            {error && <p className="text-xs text-vault-error mt-1">{error}</p>}
          </div>

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
              disabled={isSubmitting || !name.trim() || name.trim() === folder.name}
            >
              {isSubmitting ? "Saving..." : "Save Name"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
