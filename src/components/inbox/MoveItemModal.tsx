import React, { useState, useEffect } from "react";
import { FolderInput, X } from "lucide-react";
import { Folder, VaultItem } from "../../types";
import { Button } from "../common/Button";

export interface MoveItemModalProps {
  item: VaultItem | null;
  isOpen: boolean;
  onClose: () => void;
  onMove: (itemId: string, targetFolderId: string | null) => Promise<void> | void;
  folders: Folder[];
}

export const MoveItemModal: React.FC<MoveItemModalProps> = ({
  item,
  isOpen,
  onClose,
  onMove,
  folders,
}) => {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && item) {
      setSelectedFolderId(item.folder_id);
      setIsSubmitting(false);
      setError(null);
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFolderId === item.folder_id) {
      onClose();
      return;
    }

    try {
      setIsSubmitting(true);
      await onMove(item.id, selectedFolderId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move item");
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeFolders = folders.filter((f) => !f.is_deleted);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs select-none">
      <div
        className="w-full max-w-sm bg-vault-card border border-vault-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-item-title"
      >
        <div className="px-5 py-4 border-b border-vault-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-vault-primary font-semibold text-sm">
            <FolderInput className="w-4 h-4 text-vault-accent" />
            <span id="move-item-title">File / Move Item</span>
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
              Destination Folder
            </label>
            <select
              value={selectedFolderId || ""}
              onChange={(e) => {
                setSelectedFolderId(e.target.value ? e.target.value : null);
                if (error) setError(null);
              }}
              className="w-full h-9 px-3 bg-vault-bg border border-vault-border rounded-md text-xs text-vault-primary focus:outline-none focus:border-vault-border-active transition-colors"
              disabled={isSubmitting}
            >
              <option value="">📥 Quick Inbox (Unfiled)</option>
              {activeFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  📁 {folder.name}
                </option>
              ))}
            </select>
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
              disabled={isSubmitting || selectedFolderId === item.folder_id}
            >
              {isSubmitting ? "Filing..." : "Move Item"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
