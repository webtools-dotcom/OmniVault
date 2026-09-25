import React, { useState } from "react";
import {
  Archive,
  Download,
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
import { StorageService, isTauriEnvironment } from "../../services/storageService";
import { deviceLabel } from "../../utils/platform";
import { RestoreModal } from "../backup/RestoreModal";
import {
  APP_VERSION,
  InstallState,
  UpdateCheck,
  canInstallUpdate,
  checkForUpdate,
  installUpdate,
  openExternal,
} from "../../services/updates";
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
  onCreateFolder: (
    name: string,
    parentId: string | null,
    color: string | null,
  ) => Promise<void> | void;
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
  /** Called after a restore so the views pick the new rows up. */
  onVaultRestored?: () => void;
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
  onVaultRestored,
}) => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [exportState, setExportState] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [install, setInstall] = useState<{ state: InstallState; message?: string } | null>(null);

  // The app's only outbound request, made only when the user asks.
  const handleCheckForUpdate = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      setUpdate(await checkForUpdate());
    } finally {
      setIsCheckingUpdate(false);
    }
  };
  const [exportNote, setExportNote] = useState<string | null>(null);

  const handleExport = async () => {
    if (exportState === "working") return;
    setExportState("working");
    setExportNote(null);
    try {
      const summary = await StorageService.exportVault();
      const mb = summary.bytes / (1024 * 1024);
      const size =
        mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(summary.bytes / 1024))} KB`;
      setExportNote(
        `${summary.notes} note${summary.notes === 1 ? "" : "s"} saved to Downloads · ${size}`,
      );
      setExportState("done");
      window.setTimeout(() => {
        setExportState("idle");
        setExportNote(null);
      }, 6000);
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : "The export did not finish.");
      setExportState("failed");
    }
  };
  const [isInboxDragOver, setIsInboxDragOver] = useState(false);
  const isInboxActive = activeView.type === "inbox";
  const activeFolderId = activeView.type === "folder" ? activeView.folderId : null;

  return (
    <aside
      className={cn(
        "flex flex-col bg-vault-sidebar h-full transition-transform duration-200 select-none",
        isMobile
          ? cn(
              // The drawer is fixed to the screen edges, so it needs its own
              // safe-area padding to stay clear of the status and navigation bars.
              "fixed inset-y-0 left-0 z-50 w-72 shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
              isOpen ? "translate-x-0" : "-translate-x-full pointer-events-none",
            )
          : "w-56 shrink-0",
      )}
    >
      {/* Brand & App Header */}
      <div className="h-9.5 px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-vault-primary" />
          <span className="font-display font-semibold text-sm tracking-[-0.01em] text-vault-primary">
            OmniVault
          </span>
        </div>

        {/* Desktop Collapse / Mobile Close */}
        {isMobile ? (
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="w-6 h-6 flex items-center justify-center rounded text-vault-secondary hover:text-vault-primary hover:bg-vault-primary/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={onToggleCollapse}
            title="Collapse Sidebar (Ctrl+B)"
            aria-label="Collapse sidebar"
            className="w-6 h-6 flex items-center justify-center rounded text-vault-secondary hover:text-vault-primary hover:bg-vault-primary/[0.06] transition-colors cursor-pointer"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2.5 scrollbar-none">
        {/* Workspaces Header & Quick Inbox */}
        <div>
          <div className="px-2 py-1 text-xs text-vault-subtle">Workspaces</div>
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
                ? "bg-vault-accent/20 text-vault-primary font-medium ring-1 ring-vault-border-active/50"
                : isInboxActive
                  ? "bg-vault-card-hover text-vault-primary font-medium shadow-xs"
                  : "text-vault-secondary hover:text-vault-primary hover:bg-vault-primary/[0.04]",
            )}
          >
            <Inbox
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-colors",
                isInboxActive ? "text-vault-secondary" : "text-vault-muted",
              )}
            />
            <span className="flex-1 truncate">
              {isInboxDragOver ? "Drop to unfile" : "Quick Inbox"}
            </span>
            <span className="text-[0.741rem] px-1.5 py-0.2 rounded bg-vault-primary/[0.06] text-vault-secondary">
              {inboxCount}
            </span>
          </button>
        </div>

        {/* Folders Section with Hierarchical Tree */}
        <div>
          <div className="flex items-center justify-between px-2 py-1 mb-0.5">
            <span className="text-xs text-vault-subtle">Folders</span>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              title="Create new folder"
              className="w-5 h-5 flex items-center justify-center rounded text-vault-muted hover:text-vault-primary hover:bg-vault-primary/[0.06] transition-colors cursor-pointer"
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
      <div className="px-3 py-2.5 bg-vault-sidebar shrink-0 flex flex-col gap-2 text-xs select-none">
        <div
          onClick={onOpenPairing}
          className={cn(
            "flex items-center gap-2.5 min-w-0 w-full",
            onOpenPairing && "cursor-pointer hover:opacity-90",
          )}
          title={onOpenPairing ? "Connect a device" : undefined}
        >
          <div className="w-6.5 h-6.5 rounded-lg bg-vault-elevated flex items-center justify-center text-vault-secondary shrink-0">
            {isMobile ? <Tablet className="w-3.5 h-3.5" /> : <Laptop className="w-3.5 h-3.5" />}
          </div>
          <div className="truncate min-w-0">
            <span className="text-vault-primary text-xs font-medium block truncate leading-tight">
              {deviceLabel(isTauriEnvironment())}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  meshState.peerCount > 0 ? "bg-vault-success" : "bg-vault-muted",
                )}
              />
              <span className="text-[0.741rem] text-vault-secondary truncate">
                {meshState.peerCount > 0
                  ? `${meshState.peerCount} device${meshState.peerCount === 1 ? "" : "s"}`
                  : "No devices yet"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 pl-9">
          {onCycleZoom && (
            <button
              type="button"
              onClick={onCycleZoom}
              title="Text size — click to cycle"
              className="px-2 h-6 rounded-md bg-vault-elevated hover:bg-vault-overlay text-[0.6875rem] text-vault-secondary hover:text-vault-primary transition-colors cursor-pointer"
            >
              {Math.round(zoomScale * 100)}%
            </button>
          )}

          {isTauriEnvironment() && (
            <button
              type="button"
              onClick={handleExport}
              disabled={exportState === "working"}
              title="Save a copy of everything to Downloads"
              className="h-6 px-2 flex items-center gap-1.5 rounded-md bg-vault-elevated hover:bg-vault-overlay text-[0.6875rem] text-vault-secondary hover:text-vault-primary transition-colors cursor-pointer disabled:opacity-60"
            >
              <Download className="w-3 h-3" />
              <span className="whitespace-nowrap">
                {exportState === "working"
                  ? "Saving…"
                  : exportState === "done"
                    ? "Saved"
                    : "Back up"}
              </span>
            </button>
          )}

          {isTauriEnvironment() && (
            <button
              type="button"
              onClick={() => setIsRestoreOpen(true)}
              title="Bring a backup back in"
              aria-label="Restore from a backup"
              className="w-6 h-6 flex items-center justify-center rounded-md bg-vault-elevated hover:bg-vault-overlay text-vault-secondary hover:text-vault-primary transition-colors cursor-pointer"
            >
              <Archive className="w-3 h-3" />
            </button>
          )}

          {onOpenPairing && (
            <button
              type="button"
              onClick={onOpenPairing}
              title="Connect a device"
              className="w-6 h-6 flex items-center justify-center rounded-md text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated transition-colors cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-9 text-[0.6875rem] text-vault-subtle">
          <span>Version {APP_VERSION}</span>
          {!update && (
            <button
              type="button"
              onClick={handleCheckForUpdate}
              disabled={isCheckingUpdate}
              className="whitespace-nowrap text-vault-muted hover:text-vault-primary transition-colors cursor-pointer underline decoration-vault-border underline-offset-2"
            >
              {isCheckingUpdate ? "Checking…" : "Check for updates"}
            </button>
          )}
        </div>

        {update && (
          <div className="pl-9 text-[0.6875rem] leading-relaxed">
            {update.status === "available" ? (
              <div className="flex flex-col gap-1">
                <span className="text-vault-primary">Version {update.latest} is out.</span>
                {canInstallUpdate() && install?.state !== "failed" ? (
                  <div className="flex items-center gap-2">
                    {!install || install.state === "permission" ? (
                      <button
                        type="button"
                        onClick={() =>
                          installUpdate(update.latest!, (state, message) =>
                            setInstall({ state, message }),
                          )
                        }
                        className="text-vault-primary hover:text-vault-secondary transition-colors cursor-pointer underline decoration-vault-border underline-offset-2"
                      >
                        Update now
                      </button>
                    ) : (
                      <span className="text-vault-muted">
                        {install.state === "downloading"
                          ? "Downloading…"
                          : install.state === "restarting"
                            ? "Restarting…"
                            : "Confirm in the installer."}
                      </span>
                    )}
                    {!install && <span className="text-vault-subtle">Back up first.</span>}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (update.url && !(await openExternal(update.url))) {
                          try {
                            await navigator.clipboard.writeText(update.url);
                            setUpdate({ ...update, message: "Link copied." });
                          } catch {
                            setUpdate({ ...update, message: update.url });
                          }
                        }
                      }}
                      className="text-vault-muted hover:text-vault-primary transition-colors cursor-pointer underline decoration-vault-border underline-offset-2"
                    >
                      Open the release page
                    </button>
                    <span className="text-vault-subtle">Back up first.</span>
                  </div>
                )}
                {install?.message && <span className="text-vault-muted">{install.message}</span>}
                {update.message && <span className="text-vault-muted">{update.message}</span>}
              </div>
            ) : update.status === "current" ? (
              <span className="text-vault-muted">This is the newest version.</span>
            ) : (
              <span className="text-vault-muted">{update.message}</span>
            )}
          </div>
        )}

        {exportNote && (
          <p
            className={cn(
              "text-[0.6875rem] leading-relaxed pl-9",
              exportState === "failed" ? "text-vault-error" : "text-vault-muted",
            )}
          >
            {exportNote}
          </p>
        )}
      </div>
      <RestoreModal
        isOpen={isRestoreOpen}
        onClose={() => setIsRestoreOpen(false)}
        onRestored={onVaultRestored ?? (() => undefined)}
      />
    </aside>
  );
};
