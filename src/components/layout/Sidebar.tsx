import React, { useState } from "react";
import {
  Inbox,
  Laptop,
  PanelLeftClose,
  Plus,
  QrCode,
  ShieldCheck,
  Tablet,
  X,
} from "lucide-react";
import { ActiveView, Folder, MeshSyncState } from "../../types";
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
  zoomScale?: number;
  onCycleZoom?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
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
  zoomScale = 1,
  onCycleZoom,
}) => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isInboxDragOver, setIsInboxDragOver] = useState(false);
  const isInboxActive = activeView.type === "inbox";
  const activeFolderId = activeView.type === "folder" ? activeView.folderId : null;

  return (
    <aside
      className={cn(
        "flex flex-col bg-vault-sidebar border-r border-white/[0.08] h-full transition-transform duration-200 select-none",
        isMobile
          ? cn(
              "fixed inset-y-0 left-0 z-50 w-72 shadow-2xl",
              isOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
            )
          : "w-56 shrink-0"
      )}
    >
      {/* Brand & App Header */}
      <div className="h-9.5 px-3 border-b border-white/[0.06] flex items-center justify-between shrink-0 bg-vault-sidebar/90">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-xs tracking-tight text-zinc-100">
            OmniVault
          </span>
          <span className="text-[0.667rem] font-mono px-1 py-0.2 rounded bg-white/[0.04] text-zinc-400 border border-white/[0.06]">
            v0.1
          </span>
        </div>

        {/* Desktop Collapse / Mobile Close */}
        {isMobile ? (
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={onToggleCollapse}
            title="Collapse Sidebar (Ctrl+B)"
            aria-label="Collapse sidebar"
            className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2.5 scrollbar-none">
        {/* Workspaces Header & Quick Inbox */}
        <div>
          <div className="px-2 py-1 text-[0.741rem] font-bold uppercase tracking-wider text-zinc-500">
            Workspaces
          </div>
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
              "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-150 text-left cursor-pointer",
              isInboxDragOver
                ? "bg-blue-500/20 text-white font-medium ring-1 ring-blue-500/50"
                : isInboxActive
                ? "bg-vault-card-hover text-white font-medium shadow-xs"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
            )}
          >
            <Inbox
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-colors",
                isInboxActive ? "text-blue-400" : "text-zinc-500"
              )}
            />
            <span className="flex-1 truncate">
              {isInboxDragOver ? "Drop to unfile" : "Quick Inbox"}
            </span>
            <span className="text-[0.741rem] font-mono px-1.5 py-0.2 rounded bg-white/[0.06] text-zinc-400">
              {inboxCount}
            </span>
          </button>
        </div>

        {/* Folders Section with Hierarchical Tree */}
        <div>
          <div className="flex items-center justify-between px-2 py-1 mb-0.5">
            <span className="text-[0.741rem] font-bold uppercase tracking-wider text-zinc-500">
              Folders
            </span>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              title="Create new folder"
              className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
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

      {/* Node Profile & Mesh Status Dock */}
      <div className="h-11 px-3 border-t border-white/[0.06] bg-vault-sidebar shrink-0 flex items-center justify-between text-xs select-none">
        <div
          onClick={onOpenPairing}
          className={cn("flex items-center gap-2.5 min-w-0 flex-1 mr-1", onOpenPairing && "cursor-pointer hover:opacity-90")}
          title={onOpenPairing ? "Manage Device Pairing & Mesh Sync" : undefined}
        >
          <div className="w-6.5 h-6.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-300 shrink-0 shadow-xs">
            {isMobile ? <Tablet className="w-3.5 h-3.5" /> : <Laptop className="w-3.5 h-3.5" />}
          </div>
          <div className="truncate min-w-0">
            <span className="text-zinc-200 text-xs font-medium block truncate leading-tight">
              {isMobile ? "Tablet Node" : "Desktop Vault"}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  meshState.peerCount > 0
                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                    : "bg-zinc-500"
                )}
              />
              <span className="text-[0.741rem] text-zinc-400 truncate">
                {meshState.peerCount > 0 ? `${meshState.peerCount} connected` : "Standalone"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onCycleZoom && (
            <button
              type="button"
              onClick={onCycleZoom}
              title={`UI Density: ${Math.round(zoomScale * 100)}% (Click to cycle)`}
              className="px-1.5 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[0.667rem] font-mono text-zinc-400 hover:text-zinc-200 border border-white/[0.06] transition-colors cursor-pointer"
            >
              {Math.round(zoomScale * 100)}%
            </button>
          )}

          {onOpenPairing && (
            <button
              type="button"
              onClick={onOpenPairing}
              title="Pairing & Network Settings"
              className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
