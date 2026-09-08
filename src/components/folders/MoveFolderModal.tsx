import React, { useState, useEffect } from "react";
import { FolderInput, X } from "lucide-react";
import { Folder } from "../../types";
import { Button } from "../common/Button";
import { isSelfOrDescendant } from "../../utils/folderTree";

export interface MoveFolderModalProps {
  folder: Folder | null;
  isOpen: boolean;
  onClose: () => void;
  onMove: (folderId: string, newParentId: string | null) => Promise<void> | void;
  folders: Folder[];
}

export const MoveFolderModal: React.FC<MoveFolderModalProps> = ({
  folder,
  isOpen,
  onClose,
  onMove,
  folders,
}) => {
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && folder) {
      setSelectedParentId(folder.parent_id);
      setIsSubmitting(false);
      setError(null);
    }
  }, [isOpen, folder]);

  if (!isOpen || !folder) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedParentId === folder.parent_id) {
      onClose();
      return;
    }

    // Safety check against circular hierarchy
    if (isSelfOrDescendant(folder.id, selectedParentId, folders)) {
      setError("Cannot move a folder into itself or one of its subfolders.");
      return;
    }

    try {
      setIsSubmitting(true);
      await onMove(folder.id, selectedParentId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move folder");
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeFolders = folders.filter((f) => !f.is_deleted);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none">
      <div
        className="w-full max-w-md bg-vault-card/95 border border-vault-border rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.7)] backdrop-blur-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-folder-title"
      >
        <div className="px-5 py-4 border-b border-vault-border flex items-center justify-between bg-vault-card/90">
          <div className="flex items-center gap-2.5 text-vault-primary font-semibold text-sm">
            <div className="w-7 h-7 rounded-lg bg-vault-accent/15 border border-vault-accent/30 flex items-center justify-center text-vault-accent shrink-0">
              <FolderInput className="w-4 h-4 text-vault-accent" />
            </div>
            <span id="move-folder-title">Move "{folder.name}"</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-vault-muted hover:text-vault-primary hover:bg-vault-elevated rounded-lg transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-vault-secondary mb-1.5">
              Select Destination Parent Folder
            </label>
            <select
              value={selectedParentId || ""}
              onChange={(e) => {
                setSelectedParentId(e.target.value ? e.target.value : null);
                if (error) setError(null);
              }}
              className="w-full h-9 px-3 bg-vault-bg border border-vault-border rounded-xl text-xs sm:text-sm text-vault-primary focus:outline-none focus:border-vault-accent/50 transition-colors cursor-pointer"
              disabled={isSubmitting}
            >
              <option value="">📁 Root (Top Level Workspace)</option>
              {activeFolders.map((target) => {
                const isInvalid = isSelfOrDescendant(folder.id, target.id, folders);
                return (
                  <option
                    key={target.id}
                    value={target.id}
                    disabled={isInvalid}
                  >
                    📁 {target.name} {isInvalid ? "(Cannot move inside itself)" : ""}
                  </option>
                );
              })}
            </select>
            {error && <p className="text-xs text-rose-400 mt-1.5">{error}</p>}
          </div>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-vault-border/60">
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
              disabled={isSubmitting || selectedParentId === folder.parent_id}
            >
              {isSubmitting ? "Moving..." : "Move Folder"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
