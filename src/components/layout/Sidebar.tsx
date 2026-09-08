import React, { useState } from "react";
import {
  Inbox,
  PanelLeftClose,
  Plus,
  QrCode,
  ShieldCheck,
  X,
} from "lucide-react";
import { ActiveView, Folder, MeshSyncState } from "../../types";
import { Badge } from "../common/Badge";
import { Button } from "../common/Button";
import { FolderTree } from "../folders/FolderTree";
import { cn } from "../../utils/cn";

export interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
  isMobile: boolean;
  activeView: ActiveView;
  onSelectInbox: () => void;
  onSelectFolder: (folderId: string) => void;
  onCreateFolder: (name: string, parentId: string | null, color: string | null) => Promise<void> | void;
  onRenameFolder: (folderId: string, newName: string) => Promise<void> | void;
  onMoveFolder: (folderId: string, newParentId: string | null) => Promise<void> | void;
  onDeleteFolder: (folderId: string) => Promise<void> | void;
  onMoveItem?: (itemId: string, targetFolderId: string | null) => Promise<void> | void;
  folders?: Folder[];
  inboxCount: number;
  meshState: MeshSyncState;
  onOpenPairing?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen: _isOpen,
  onClose,
  onToggleCollapse,
  isMobile,
  activeView,
  onSelectInbox,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onMoveItem,
  folders = [],
  inboxCount,
  meshState,
  onOpenPairing,
}) => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isInboxDragOver, setIsInboxDragOver] = useState(false);
  const isInboxActive = activeView.type === "inbox";
  const activeFolderId = activeView.type === "folder" ? activeView.folderId : null;

  return (
    <aside
      className={cn(
        "flex flex-col bg-vault-card border-r border-vault-border h-full transition-all duration-200 select-none",
        isMobile
          ? "fixed inset-y-0 left-0 z-50 w-72 shadow-2xl"
          : "w-64 shrink-0"
      )}
    >
      {/* Brand & App Header */}
      <div className="h-14 px-4 border-b border-vault-border flex items-center justify-between shrink-0 bg-vault-card/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-vault-accent/15 border border-vault-accent/30 flex items-center justify-center text-vault-accent shadow-[0_0_12px_rgba(59,130,246,0.15)]">
            <ShieldCheck className="w-4.5 h-4.5 text-vault-accent" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm tracking-tight text-vault-primary">
                OmniVault
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-white/[0.04] text-vault-secondary border border-white/[0.08]">
                v0.1.0
              </span>
            </div>
            <div className="text-[11px] text-vault-muted leading-none mt-0.5 font-medium">
              Private P2P Mesh
            </div>
          </div>
        </div>

        {/* Desktop Collapse / Mobile Close */}
        {isMobile ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close sidebar"
            className="text-vault-secondary hover:text-vault-primary"
          >
            <X className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            title="Collapse Sidebar (Ctrl+B)"
            aria-label="Collapse sidebar"
            className="text-vault-secondary hover:text-vault-primary"
          >
            <PanelLeftClose className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Quick Inbox */}
        <div>
          <button
            onClick={onSelectInbox}
            onDragOver={(e) => {
              if (
                e.dataTransfer.types.includes("application/x-omnivault-item") ||
                e.dataTransfer.types.includes("text/plain")
              ) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setIsInboxDragOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsInboxDragOver(false);
              }
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setIsInboxDragOver(false);
              const itemId =
                e.dataTransfer.getData("application/x-omnivault-item") ||
                e.dataTransfer.getData("text/plain");
              if (itemId && onMoveItem) {
                await onMoveItem(itemId, null);
              }
            }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 text-left cursor-pointer",
              isInboxDragOver
                ? "bg-vault-accent/20 text-vault-primary font-medium ring-2 ring-vault-accent shadow-[0_0_16px_rgba(59,130,246,0.25)] scale-[1.01]"
                : isInboxActive
                ? "bg-vault-accent-subtle text-vault-primary font-medium ring-1 ring-vault-accent/30 shadow-xs"
                : "text-vault-secondary hover:text-vault-primary hover:bg-white/[0.04]"
            )}
          >
            <Inbox
              className={cn(
                "w-4 h-4 shrink-0 transition-colors",
                isInboxDragOver || isInboxActive ? "text-vault-accent" : "text-vault-secondary"
              )}
            />
            <span className="flex-1 font-medium">
              {isInboxDragOver ? "Drop to unfile" : "Quick Inbox"}
            </span>
            <Badge
              variant={inboxCount > 0 ? "accent" : "default"}
              size="sm"
            >
              {inboxCount}
            </Badge>
          </button>
        </div>

        {/* Folders Section with Hierarchical Tree */}
        <div>
          <div className="flex items-center justify-between px-2 py-1 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-vault-muted">
              Folders
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsCreateOpen(true)}
              title="Create new folder"
              className="h-6 w-6 text-vault-secondary hover:text-vault-primary"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>

          <FolderTree
            folders={folders}
            activeFolderId={activeFolderId}
            onSelectFolder={onSelectFolder}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onMoveFolder={onMoveFolder}
            onDeleteFolder={onDeleteFolder}
            onMoveItem={onMoveItem}
            isCreateModalOpen={isCreateOpen}
            onCloseCreateModal={() => setIsCreateOpen(false)}
          />
        </div>
      </div>

      {/* Sync Status Footer */}
      <div className="p-3 border-t border-vault-border bg-vault-card/80 shrink-0 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex items-center justify-center shrink-0">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                meshState.status === "standby" || meshState.status === "synced"
                  ? "bg-vault-success shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                  : meshState.status === "error"
                  ? "bg-vault-error shadow-[0_0_8px_rgba(239,68,68,0.7)]"
                  : "bg-vault-accent shadow-[0_0_8px_rgba(59,130,246,0.7)]"
              )}
            />
            {(meshState.status === "syncing" || meshState.status === "discovering") && (
              <span className="absolute w-3.5 h-3.5 rounded-full bg-vault-accent/40 animate-ping" />
            )}
          </div>
          <div className="truncate">
            <span className="text-vault-primary font-medium block truncate text-[11px]">
              {meshState.peerCount > 0
                ? `${meshState.peerCount} peer${meshState.peerCount > 1 ? "s" : ""} connected`
                : "Local Mesh Active"}
            </span>
            <span className="text-vault-muted block text-[10px]">
              {meshState.peerCount > 0 ? "Real-time sync" : "Standby • Port 42420"}
            </span>
          </div>
        </div>

        {onOpenPairing && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenPairing}
            title="Connect Mobile / QR Pairing"
            className="h-7 w-7 text-vault-secondary hover:text-vault-primary hover:bg-white/[0.08] transition-colors"
          >
            <QrCode className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </aside>
  );
};
