import React, { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Folder } from "../../types";
import { Button } from "../common/Button";

export interface DeleteFolderModalProps {
  folder: Folder | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (folderId: string) => Promise<void> | void;
}

export const DeleteFolderModal: React.FC<DeleteFolderModalProps> = ({
  folder,
  isOpen,
  onClose,
  onDelete,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !folder) return null;

  const handleConfirm = async () => {
    try {
      setIsDeleting(true);
      setError(null);
      await onDelete(folder.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete folder");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none">
      <div
        className="w-full max-w-sm bg-vault-card/95 border border-vault-border rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.7)] backdrop-blur-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-folder-title"
      >
        <div className="px-5 py-4 border-b border-vault-border flex items-center justify-between bg-vault-card/90">
          <div className="flex items-center gap-2.5 text-vault-error font-semibold text-sm">
            <div className="w-7 h-7 rounded-lg bg-vault-error/15 border border-vault-error/30 flex items-center justify-center text-vault-error shrink-0">
              <AlertTriangle className="w-4 h-4 text-vault-error" />
            </div>
            <span id="delete-folder-title">Delete folder</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-vault-muted hover:text-vault-primary hover:bg-vault-elevated rounded-lg transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-vault-primary leading-relaxed">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-vault-primary">"{folder.name}"</span>?
          </p>
          <p className="text-xs text-vault-muted leading-relaxed">
            Subfolders and items inside this folder will be soft-deleted. Changes will be synced
            across your local mesh network.
          </p>
          {error && <p className="text-xs text-vault-error mt-2">{error}</p>}
        </div>

        <div className="px-5 py-3.5 bg-vault-bg/60 border-t border-vault-border flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Folder"}
          </Button>
        </div>
      </div>
    </div>
  );
};
