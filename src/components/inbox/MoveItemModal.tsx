import React, { useState, useEffect, useMemo } from "react";
import { Folder as FolderIcon, FolderInput, Inbox, Search, X } from "lucide-react";
import { Folder, VaultItem } from "../../types";
import { Button } from "../common/Button";
import { Badge } from "../common/Badge";
import { getFolderPath } from "../../utils/folderTree";
import { cn } from "../../utils/cn";

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
  const [searchFilter, setSearchFilter] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && item) {
      setSelectedFolderId(item.folder_id);
      setSearchFilter("");
      setIsSubmitting(false);
      setError(null);
    }
  }, [isOpen, item]);

  const activeFolders = useMemo(
    () => folders.filter((f) => !f.is_deleted),
    [folders]
  );

  // Compute full hierarchical path name for each folder: e.g. "Work / Projects / OmniVault"
  const folderPaths = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of activeFolders) {
      const path = getFolderPath(folder.id, folders);
      map.set(folder.id, path.map((p) => p.name).join(" / "));
    }
    return map;
  }, [activeFolders, folders]);

  // Filtered folder list for quick 1-click selection
  const filteredFolders = useMemo(() => {
    if (!searchFilter.trim()) return activeFolders;
    const q = searchFilter.toLowerCase();
    return activeFolders.filter((f) => {
      const fullPath = folderPaths.get(f.id) || f.name;
      return fullPath.toLowerCase().includes(q);
    });
  }, [activeFolders, folderPaths, searchFilter]);

  if (!isOpen || !item) return null;

  // Direct 1-Click Filing Handler
  const handleDirectMove = async (targetFolderId: string | null) => {
    if (targetFolderId === item.folder_id) {
      onClose();
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onMove(item.id, targetFolderId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move item");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleDirectMove(selectedFolderId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs select-none">
      <div
        className="w-full max-w-md bg-vault-card border border-vault-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-item-title"
      >
        {/* Header */}
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

        {/* Item Summary Pill */}
        <div className="px-5 py-2.5 bg-vault-bg/50 border-b border-vault-border/60 flex items-center justify-between text-xs">
          <div className="truncate text-vault-secondary">
            Filing: <span className="font-semibold text-vault-primary">{item.title || "Untitled Capture"}</span>
          </div>
          <Badge variant="default" size="sm">
            {item.folder_id ? "Filed" : "Inbox"}
          </Badge>
        </div>

        {/* Search / Filter bar for rapid triage */}
        <div className="p-4 border-b border-vault-border/40">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-vault-muted" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search destination folders..."
              className="w-full h-8 pl-8 pr-3 bg-vault-bg border border-vault-border rounded-lg text-xs text-vault-primary placeholder:text-vault-muted focus:outline-none focus:border-vault-border-active transition-colors"
            />
          </div>
        </div>

        {/* 1-Click Filing Destination List */}
        <div className="max-h-56 overflow-y-auto px-4 py-2 space-y-1">
          {/* Quick Inbox Option */}
          <button
            type="button"
            onClick={() => handleDirectMove(null)}
            disabled={isSubmitting}
            className={cn(
              "w-full flex items-center justify-between p-2 rounded-lg text-xs transition-colors text-left",
              item.folder_id === null
                ? "bg-vault-elevated text-vault-primary font-medium border border-vault-border"
                : "text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated/60"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Inbox className="w-3.5 h-3.5 text-vault-accent shrink-0" />
              <span className="truncate">📥 Quick Inbox (Unfiled)</span>
            </div>
            {item.folder_id === null && (
              <span className="text-[10px] text-vault-muted">Current</span>
            )}
          </button>

          {/* Folder List with Full Ancestry Path */}
          {filteredFolders.map((folder) => {
            const isCurrent = item.folder_id === folder.id;
            const fullPath = folderPaths.get(folder.id) || folder.name;

            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => handleDirectMove(folder.id)}
                disabled={isSubmitting}
                className={cn(
                  "w-full flex items-center justify-between p-2 rounded-lg text-xs transition-colors text-left",
                  isCurrent
                    ? "bg-vault-elevated text-vault-primary font-medium border border-vault-border"
                    : "text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated/60"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FolderIcon
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: folder.color || undefined }}
                  />
                  <span className="truncate" title={fullPath}>
                    {fullPath}
                  </span>
                </div>
                {isCurrent && (
                  <span className="text-[10px] text-vault-muted">Current</span>
                )}
              </button>
            );
          })}

          {filteredFolders.length === 0 && searchFilter && (
            <p className="text-center py-4 text-xs text-vault-muted">
              No matching folders found
            </p>
          )}
        </div>

        {error && (
          <div className="px-5 py-2 text-xs text-vault-error bg-vault-error/10 border-t border-vault-error/20">
            {error}
          </div>
        )}

        {/* Modal Footer */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-vault-border flex items-center justify-between bg-vault-bg/30">
          <span className="text-[11px] text-vault-muted">
            Click any folder to file instantly
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-xs"
          >
            Cancel
          </Button>
        </form>
      </div>
    </div>
  );
};
