import React, { useState, useMemo, useEffect } from "react";
import { FolderPlus, Plus } from "lucide-react";
import { Folder } from "../../types";
import { buildFolderTree } from "../../utils/folderTree";
import { FolderTreeItem } from "./FolderTreeItem";
import { CreateFolderModal } from "./CreateFolderModal";
import { RenameFolderModal } from "./RenameFolderModal";
import { MoveFolderModal } from "./MoveFolderModal";
import { DeleteFolderModal } from "./DeleteFolderModal";
import { Button } from "../common/Button";

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
        <div className="p-3 text-center rounded-lg border border-dashed border-vault-border bg-vault-bg/40">
          <FolderPlus className="w-6 h-6 mx-auto mb-1.5 text-vault-muted/70" />
          <p className="text-xs text-vault-secondary font-medium mb-1">
            No folders yet
          </p>
          <p className="text-[11px] text-vault-muted mb-2.5">
            Organize unfiled items into nested folders
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCreateParentId(null);
              setInternalCreateOpen(true);
            }}
            className="w-full text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            New Folder
          </Button>
        </div>
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
