import React, { useState } from "react";
import {
  Inbox,
  PanelLeftClose,
  Plus,
  QrCode,
  ShieldCheck,
  Wifi,
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
  folders = [],
  inboxCount,
  meshState,
  onOpenPairing,
}) => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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
      <div className="h-14 px-4 border-b border-vault-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-vault-accent/15 border border-vault-accent/30 flex items-center justify-center text-vault-accent">
            <ShieldCheck className="w-4.5 h-4.5 text-vault-accent" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm tracking-tight text-vault-primary">
                OmniVault
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-vault-elevated text-vault-secondary border border-vault-border">
                v0.1.0
              </span>
            </div>
            <div className="text-[11px] text-vault-muted leading-none mt-0.5">
              Local-first Mesh
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
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left",
              isInboxActive
                ? "bg-vault-elevated text-vault-primary font-medium border-l-2 border-vault-accent shadow-xs"
                : "text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated/60"
            )}
          >
            <Inbox
              className={cn(
                "w-4 h-4 shrink-0",
                isInboxActive ? "text-vault-accent" : "text-vault-secondary"
              )}
            />
            <span className="flex-1">Quick Inbox</span>
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
            isCreateModalOpen={isCreateOpen}
            onCloseCreateModal={() => setIsCreateOpen(false)}
          />
        </div>
      </div>

      {/* Sync Status Footer */}
      <div className="p-3 border-t border-vault-border bg-vault-card shrink-0 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex items-center justify-center shrink-0">
            <Wifi
              className={cn(
                "w-3.5 h-3.5",
                meshState.status === "synced" && "text-vault-success",
                meshState.status === "syncing" && "text-vault-pending animate-pulse",
                meshState.status === "standby" && "text-vault-success",
                meshState.status === "discovering" && "text-vault-accent animate-pulse",
                meshState.status === "error" && "text-vault-error"
              )}
            />
            {meshState.status === "standby" && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-vault-success" />
            )}
          </div>
          <div className="truncate">
            <span className="text-vault-secondary block truncate text-[11px]">
              {meshState.peerCount > 0
                ? `${meshState.peerCount} peer${meshState.peerCount > 1 ? "s" : ""} online`
                : "Local Mesh: Standby"}
            </span>
          </div>
        </div>

        {onOpenPairing && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenPairing}
            title="Pair device via PIN / QR code"
            className="h-7 w-7 text-vault-secondary hover:text-vault-primary"
          >
            <QrCode className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </aside>
  );
};
