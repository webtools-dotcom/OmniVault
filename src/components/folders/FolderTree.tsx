import React, { useState, useMemo, useEffect } from "react";
import { Plus } from "lucide-react";
import { Folder } from "../../types";
import { buildFolderTree } from "../../utils/folderTree";
import { FolderTreeItem } from "./FolderTreeItem";
import { CreateFolderModal } from "./CreateFolderModal";
import { RenameFolderModal } from "./RenameFolderModal";
import { MoveFolderModal } from "./MoveFolderModal";
import { DeleteFolderModal } from "./DeleteFolderModal";

export interface FolderTreeProps {
  folders: Folder[];
  activeFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onCreateFolder: (name: string, parentId: string | null, color: string | null) => Promise<void> | void;
  onRenameFolder: (folderId: string, newName: string) => Promise<void> | void;
  onMoveFolder: (folderId: string, newParentId: string | null) => Promise<void> | void;
  onDeleteFolder: (folderId: string) => Promise<void> | void;
  onMoveItem?: (itemId: string, targetFolderId: string | null) => Promise<void> | void;
  isCreateModalOpen?: boolean;
  onCloseCreateModal?: () => void;
}

export const FolderTree: React.FC<FolderTreeProps> = ({
  folders,
  activeFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onMoveItem,
  isCreateModalOpen = false,
  onCloseCreateModal,
}) => {
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());

  // Modal states
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [targetRenameFolder, setTargetRenameFolder] = useState<Folder | null>(null);
  const [targetMoveFolder, setTargetMoveFolder] = useState<Folder | null>(null);
  const [targetDeleteFolder, setTargetDeleteFolder] = useState<Folder | null>(null);

  // Sync external create modal trigger
  useEffect(() => {
    if (isCreateModalOpen) {
      setCreateParentId(null);
      setInternalCreateOpen(true);
    }
  }, [isCreateModalOpen]);

  // Build hierarchical tree
  const treeNodes = useMemo(() => buildFolderTree(folders), [folders]);

  // Auto-expand all folders with children by default on load
  useEffect(() => {
    const ids = new Set<string>();
    folders.forEach((f) => {
      if (folders.some((child) => child.parent_id === f.id && !child.is_deleted)) {
        ids.add(f.id);
      }
    });
    setExpandedFolderIds(ids);
  }, [folders.length]);

  const handleToggleExpand = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleOpenCreateSubfolder = (parentFolderId: string) => {
    setCreateParentId(parentFolderId);
    setInternalCreateOpen(true);
    // Expand parent folder so newly created child will be visible
    setExpandedFolderIds((prev) => new Set(prev).add(parentFolderId));
  };

  const handleCloseCreate = () => {
    setInternalCreateOpen(false);
    setCreateParentId(null);
    onCloseCreateModal?.();
  };

  const activeFolders = folders.filter((f) => !f.is_deleted);

  return (
    <div className="space-y-1">
      {activeFolders.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            setCreateParentId(null);
            setInternalCreateOpen(true);
          }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-vault-muted hover:text-vault-secondary hover:bg-vault-primary/[0.04] transition-colors text-left cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-vault-muted" />
          <span>Add first folder</span>
        </button>
      ) : (
        <div className="space-y-0.5">
          {treeNodes.map((node) => (
            <FolderTreeItem
              key={node.folder.id}
              node={node}
              activeFolderId={activeFolderId}
              expandedFolderIds={expandedFolderIds}
              onToggleExpand={handleToggleExpand}
              onSelectFolder={onSelectFolder}
              onOpenCreateSubfolder={handleOpenCreateSubfolder}
              onOpenRename={setTargetRenameFolder}
              onOpenMove={setTargetMoveFolder}
              onOpenDelete={setTargetDeleteFolder}
              onMoveItem={onMoveItem}
            />
          ))}
        </div>
      )}

      {/* Create Folder Modal */}
      <CreateFolderModal
        isOpen={internalCreateOpen}
        onClose={handleCloseCreate}
        onCreate={onCreateFolder}
        initialParentId={createParentId}
        folders={folders}
      />

      {/* Rename Folder Modal */}
      <RenameFolderModal
        folder={targetRenameFolder}
        isOpen={!!targetRenameFolder}
        onClose={() => setTargetRenameFolder(null)}
        onRename={onRenameFolder}
      />

      {/* Move Folder Modal */}
      <MoveFolderModal
        folder={targetMoveFolder}
        isOpen={!!targetMoveFolder}
        onClose={() => setTargetMoveFolder(null)}
        onMove={onMoveFolder}
        folders={folders}
      />

      {/* Delete Folder Modal */}
      <DeleteFolderModal
        folder={targetDeleteFolder}
        isOpen={!!targetDeleteFolder}
        onClose={() => setTargetDeleteFolder(null)}
        onDelete={onDeleteFolder}
      />
    </div>
  );
};
