import React, { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  MoreVertical,
  Edit2,
  FolderInput,
  Trash2,
} from "lucide-react";
import { Folder, FolderTreeNode } from "../../types";
import { cn } from "../../utils/cn";

export interface FolderTreeItemProps {
  node: FolderTreeNode;
  activeFolderId: string | null;
  expandedFolderIds: Set<string>;
  onToggleExpand: (folderId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onOpenCreateSubfolder: (parentFolderId: string) => void;
  onOpenRename: (folder: Folder) => void;
  onOpenMove: (folder: Folder) => void;
  onOpenDelete: (folder: Folder) => void;
  onMoveItem?: (itemId: string, targetFolderId: string | null) => Promise<void> | void;
}

export const FolderTreeItem: React.FC<FolderTreeItemProps> = ({
  node,
  activeFolderId,
  expandedFolderIds,
  onToggleExpand,
  onSelectFolder,
  onOpenCreateSubfolder,
  onOpenRename,
  onOpenMove,
  onOpenDelete,
  onMoveItem,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragHoverTimerRef = useRef<number | null>(null);

  const { folder, children, depth } = node;
  const hasChildren = children.length > 0;
  const isExpanded = expandedFolderIds.has(folder.id);
  const isActive = activeFolderId === folder.id;

  // Close context menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Clean up drag hover expand timer on unmount
  useEffect(() => {
    return () => {
      if (dragHoverTimerRef.current) {
        clearTimeout(dragHoverTimerRef.current);
      }
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes("application/x-omnivault-item") ||
      e.dataTransfer.types.includes("text/plain")
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!isDragOver) {
        setIsDragOver(true);
        // Auto-expand folder after hovering for 500ms if it has children and is collapsed
        if (hasChildren && !isExpanded) {
          dragHoverTimerRef.current = window.setTimeout(() => {
            onToggleExpand(folder.id);
          }, 500);
        }
      }
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      if (dragHoverTimerRef.current) {
        clearTimeout(dragHoverTimerRef.current);
        dragHoverTimerRef.current = null;
      }
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (dragHoverTimerRef.current) {
      clearTimeout(dragHoverTimerRef.current);
      dragHoverTimerRef.current = null;
    }
    const itemId =
      e.dataTransfer.getData("application/x-omnivault-item") ||
      e.dataTransfer.getData("text/plain");
    if (itemId && onMoveItem) {
      await onMoveItem(itemId, folder.id);
    }
  };

  return (
    <div className="select-none">
      {/* Folder Row */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "group relative flex items-center h-8 pr-1.5 rounded-lg text-xs transition-all duration-150 cursor-pointer",
          isDragOver
            ? "bg-vault-accent/20 text-vault-primary font-medium ring-2 ring-vault-accent shadow-[0_0_12px_rgba(59,130,246,0.3)] scale-[1.01]"
            : isActive
            ? "bg-vault-accent-subtle text-vault-primary font-semibold ring-1 ring-vault-accent/30 shadow-xs"
            : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
        )}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onClick={() => onSelectFolder(folder.id)}
      >
        {/* Expand / Collapse Chevron */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) {
              onToggleExpand(folder.id);
            }
          }}
          className={cn(
            "w-4 h-4 mr-0.5 flex items-center justify-center rounded transition-colors text-vault-muted hover:text-vault-secondary focus:outline-none",
            !hasChildren && "invisible pointer-events-none"
          )}
          aria-label={isExpanded ? "Collapse subfolders" : "Expand subfolders"}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Folder Icon */}
        <FolderIcon
          className={cn(
            "w-3.5 h-3.5 mr-2 shrink-0 transition-colors",
            isActive ? "text-vault-accent" : "text-vault-muted group-hover:text-vault-secondary"
          )}
          style={folder.color ? { color: folder.color } : undefined}
        />

        {/* Folder Name */}
        <span className="truncate flex-1 pr-1" title={folder.name}>
          {folder.name}
        </span>

        {/* Child count indicator when collapsed */}
        {hasChildren && !isExpanded && (
          <span className="text-[10px] text-vault-muted px-1 mr-1">
            {children.length}
          </span>
        )}

        {/* Action Menu & Quick Trigger */}
        <div
          className={cn(
            "flex items-center gap-0.5 transition-opacity",
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quick Create Subfolder button */}
          <button
            type="button"
            onClick={() => onOpenCreateSubfolder(folder.id)}
            title="Create subfolder"
            className="w-5 h-5 flex items-center justify-center rounded text-vault-muted hover:text-vault-primary hover:bg-vault-card transition-colors"
          >
            <FolderPlus className="w-3 h-3" />
          </button>

          {/* Context Menu Trigger */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              title="Folder options"
              className={cn(
                "w-5 h-5 flex items-center justify-center rounded text-vault-muted hover:text-vault-primary hover:bg-vault-card transition-colors",
                menuOpen && "bg-vault-card text-vault-primary"
              )}
            >
              <MoreVertical className="w-3 h-3" />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 w-40 bg-vault-card/95 border border-white/[0.12] rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] py-1.5 z-30 backdrop-blur-md ring-1 ring-white/[0.05] animate-in fade-in zoom-in-95 duration-100"
                role="menu"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenCreateSubfolder(folder.id);
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2.5 text-xs text-vault-secondary hover:text-vault-primary hover:bg-white/[0.06] text-left transition-colors cursor-pointer"
                  role="menuitem"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-blue-400" />
                  <span>New Subfolder</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenRename(folder);
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2.5 text-xs text-vault-secondary hover:text-vault-primary hover:bg-white/[0.06] text-left transition-colors cursor-pointer"
                  role="menuitem"
                >
                  <Edit2 className="w-3.5 h-3.5 text-vault-muted" />
                  <span>Rename</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenMove(folder);
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2.5 text-xs text-vault-secondary hover:text-vault-primary hover:bg-white/[0.06] text-left transition-colors cursor-pointer"
                  role="menuitem"
                >
                  <FolderInput className="w-3.5 h-3.5 text-vault-muted" />
                  <span>Move</span>
                </button>

                <div className="my-1 border-t border-white/[0.06]" />

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenDelete(folder);
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2.5 text-xs text-rose-400 hover:bg-rose-500/10 text-left transition-colors cursor-pointer"
                  role="menuitem"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Render Children Recursively if Expanded */}
      {hasChildren && isExpanded && (
        <div className="space-y-0.5">
          {children.map((childNode) => (
            <FolderTreeItem
              key={childNode.folder.id}
              node={childNode}
              activeFolderId={activeFolderId}
              expandedFolderIds={expandedFolderIds}
              onToggleExpand={onToggleExpand}
              onSelectFolder={onSelectFolder}
              onOpenCreateSubfolder={onOpenCreateSubfolder}
              onOpenRename={onOpenRename}
              onOpenMove={onOpenMove}
              onOpenDelete={onOpenDelete}
              onMoveItem={onMoveItem}
            />
          ))}
        </div>
      )}
    </div>
  );
};
