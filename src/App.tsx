import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Plus, Radio } from "lucide-react";
import { ActiveView, BreadcrumbItem, Folder, ItemType, MeshSyncState, VaultItem } from "./types";
import { AppLayout } from "./components/layout/AppLayout";
import { Sidebar } from "./components/layout/Sidebar";
import { ContentPane } from "./components/layout/ContentPane";
import { getFolderPath } from "./utils/folderTree";
import { StorageService, isTauriEnvironment } from "./services/storageService";
import { QuickInboxView } from "./components/inbox/QuickInboxView";
import { QuickInboxItemCard } from "./components/inbox/QuickInboxItemCard";
import { MoveItemModal } from "./components/inbox/MoveItemModal";
import { QuickCaptureBar } from "./components/inbox/QuickCaptureBar";
import { NoteEditorModal } from "./components/editor/NoteEditorModal";
import { ImageLightbox } from "./components/media/ImageLightbox";
import { QrConnectModal } from "./components/pairing/QrConnectModal";
import { PeerPinModal } from "./components/pairing/PeerPinModal";
import { useClipboardPaste } from "./hooks/useClipboardPaste";

export function App() {
  const [activeView, setActiveView] = useState<ActiveView>({ type: "inbox" });
  const [folders, setFolders] = useState<Folder[]>([]);
  const [inboxItems, setInboxItems] = useState<VaultItem[]>([]);
  const [folderItems, setFolderItems] = useState<VaultItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetMoveFolderItem, setTargetMoveFolderItem] = useState<VaultItem | null>(null);

  // Note Editor State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorItem, setEditorItem] = useState<VaultItem | null>(null);

  // Lightbox State
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);

  // QR Mobile Connect Modal State (Desktop host)
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  // Web Peer / Tablet Pairing Modal State
  const [isPeerPinModalOpen, setIsPeerPinModalOpen] = useState(() => {
    return !isTauriEnvironment() && !StorageService.isPaired();
  });
  const [isPaired, setIsPaired] = useState(() => StorageService.isPaired());

  // BridgeMind Stream Filter State (Stream | Notes | Markets)
  const [streamFilter, setStreamFilter] = useState<"stream" | "notes" | "markets">("stream");

  // UI Density / Zoom Scaling (0.80, 0.88, 0.96, 1.04)
  const [zoomScale, setZoomScale] = useState<number>(() => {
    const saved = localStorage.getItem("omnivault_ui_scale");
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0.7 && parsed <= 1.5) {
        return parsed;
      }
    }
    return 0.88; // Default to crisp, high-density native scale
  });

  useEffect(() => {
    (document.documentElement.style as any).zoom = "";
    document.documentElement.style.setProperty("--ui-scale", String(zoomScale));
    localStorage.setItem("omnivault_ui_scale", String(zoomScale));
  }, [zoomScale]);

  const handleCycleZoom = useCallback(() => {
    setZoomScale((prev) => {
      if (prev <= 0.82) return 0.88;
      if (prev <= 0.90) return 0.96;
      if (prev <= 1.00) return 1.08;
      return 0.80;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          setZoomScale((prev) => Math.max(0.72, Math.round((prev - 0.08) * 100) / 100));
        } else if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          setZoomScale((prev) => Math.min(1.28, Math.round((prev + 0.08) * 100) / 100));
        } else if (e.key === "0") {
          e.preventDefault();
          setZoomScale(0.88);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const [meshState, setMeshState] = useState<MeshSyncState>({
    status: "standby",
    peerCount: 0,
  });

  // Load folders and items with shallow diffing to prevent unnecessary UI renders
  const refreshFolders = useCallback(async () => {
    try {
      const data = await StorageService.getFolders();
      setFolders((prev) => {
        if (
          prev.length === data.length &&
          prev.every((p, idx) => p.id === data[idx]?.id && p.updated_at === data[idx]?.updated_at)
        ) {
          return prev;
        }
        return data;
      });
    } catch (err) {
      console.error("Failed to load folders:", err);
    }
  }, []);

  const refreshInboxItems = useCallback(async () => {
    try {
      const items = await StorageService.getInboxItems();
      setInboxItems((prev) => {
        if (
          prev.length === items.length &&
          prev.every((p, idx) => p.id === items[idx]?.id && p.updated_at === items[idx]?.updated_at)
        ) {
          return prev;
        }
        return items;
      });
    } catch (err) {
      console.error("Failed to load inbox items:", err);
    }
  }, []);

  const refreshFolderItems = useCallback(async (folderId: string) => {
    try {
      const items = await StorageService.getFolderItems(folderId);
      setFolderItems((prev) => {
        if (
          prev.length === items.length &&
          prev.every((p, idx) => p.id === items[idx]?.id && p.updated_at === items[idx]?.updated_at)
        ) {
          return prev;
        }
        return items;
      });
    } catch (err) {
      console.error("Failed to load folder items:", err);
    }
  }, []);

  useEffect(() => {
    refreshFolders();
    refreshInboxItems();
  }, [refreshFolders, refreshInboxItems]);

  useEffect(() => {
    if (activeView.type === "folder") {
      refreshFolderItems(activeView.folderId);
    }
  }, [activeView, refreshFolderItems]);

  const isPollingRef = useRef(false);

  // Real-time Auto-Sync: 2.5-second background polling + window focus revalidation + Android shares
  useEffect(() => {
    const handleRevalidate = async () => {
      // Avoid interrupting active note drafting or stacking up overlapping polls
      if (isEditorOpen || isPollingRef.current) return;
      isPollingRef.current = true;
      try {
        await StorageService.checkPendingShares();
        const syncStatus = await StorageService.getMeshSyncStatus();
        setMeshState(syncStatus);
        await refreshInboxItems();
        if (activeView.type === "folder") {
          await refreshFolderItems(activeView.folderId);
        }
        await refreshFolders();
      } finally {
        isPollingRef.current = false;
      }
    };

    // Global Android Share Target callback
    (window as unknown as { __onOmniVaultShare?: () => void }).__onOmniVaultShare = () => {
      handleRevalidate();
    };

    window.addEventListener("focus", handleRevalidate);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleRevalidate();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const interval = setInterval(handleRevalidate, 2500);

    return () => {
      delete (window as unknown as { __onOmniVaultShare?: () => void }).__onOmniVaultShare;
      window.removeEventListener("focus", handleRevalidate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [isEditorOpen, activeView, refreshInboxItems, refreshFolderItems, refreshFolders]);

  // Find active folder details if folder view
  const activeFolder = useMemo(() => {
    if (activeView.type === "folder") {
      return folders.find((f) => f.id === activeView.folderId && !f.is_deleted) || null;
    }
    return null;
  }, [activeView, folders]);

  // Compute breadcrumbs hierarchy based on active view and folder ancestry
  const breadcrumbs: BreadcrumbItem[] = useMemo(() => {
    if (activeView.type === "inbox") {
      return [{ id: "inbox", label: "Quick Inbox", active: true }];
    }

    if (activeView.type === "folder" && activeFolder) {
      const path = getFolderPath(activeFolder.id, folders);
      return path.map((folder, index) => ({
        id: folder.id,
        label: folder.name,
        active: index === path.length - 1,
        onClick:
          index < path.length - 1
            ? () => setActiveView({ type: "folder", folderId: folder.id })
            : undefined,
      }));
    }

    return [{ id: "root", label: "Workspace", active: true }];
  }, [activeView, activeFolder, folders]);

  // View title
  const viewTitle = useMemo(() => {
    if (activeView.type === "inbox") return "Quick Inbox";
    if (activeView.type === "folder" && activeFolder) return activeFolder.name;
    return "OmniVault Workspace";
  }, [activeView, activeFolder]);

  // Navigation handlers
  const handleSelectInbox = () => {
    setActiveView({ type: "inbox" });
  };

  const handleSelectFolder = (folderId: string) => {
    setActiveView({ type: "folder", folderId });
  };

  // Folder CRUD handlers
  const handleCreateFolder = async (
    name: string,
    parentId: string | null,
    color: string | null
  ) => {
    const created = await StorageService.createFolder(name, parentId, color);
    await refreshFolders();
    setActiveView({ type: "folder", folderId: created.id });
  };

  const handleRenameFolder = async (folderId: string, newName: string) => {
    await StorageService.renameFolder(folderId, newName);
    await refreshFolders();
  };

  const handleMoveFolder = async (
    folderId: string,
    newParentId: string | null
  ) => {
    await StorageService.moveFolder(folderId, newParentId);
    await refreshFolders();
  };

  const handleDeleteFolder = async (folderId: string) => {
    await StorageService.deleteFolder(folderId);
    await refreshFolders();
    if (activeView.type === "folder" && activeView.folderId === folderId) {
      setActiveView({ type: "inbox" });
    }
  };

  // Item CRUD handlers
  const handleCaptureItem = async (
    itemType: ItemType,
    title: string,
    content: string,
    metadata?: string,
    existingItem?: VaultItem
  ) => {
    const currentFolderId = activeView.type === "folder" ? activeView.folderId : null;
    if (existingItem) {
      // Item was already created by media upload; update UI state immediately with 0ms delay
      if (currentFolderId) {
        setFolderItems((prev) => [existingItem, ...prev.filter((i) => i.id !== existingItem.id)]);
      } else {
        setInboxItems((prev) => [existingItem, ...prev.filter((i) => i.id !== existingItem.id)]);
      }
      return;
    }

    const created = await StorageService.createItem(
      currentFolderId,
      itemType,
      title,
      content,
      metadata || null
    );

    if (created) {
      if (currentFolderId) {
        setFolderItems((prev) => [created, ...prev.filter((i) => i.id !== created.id)]);
      } else {
        setInboxItems((prev) => [created, ...prev.filter((i) => i.id !== created.id)]);
      }
    }
  };

  // Mobile Web Share Target: ingest shared links or text from mobile OS share sheet
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sharedTitle = params.get("title");
    const sharedText = params.get("text");
    const sharedUrl = params.get("url");

    if (sharedTitle || sharedText || sharedUrl) {
      const title = sharedTitle || (sharedUrl ? "Shared Link" : "Shared Note");
      const contentParts: string[] = [];
      if (sharedText) contentParts.push(sharedText);
      if (sharedUrl) contentParts.push(sharedUrl);
      const content = contentParts.join("\n\n");
      const itemType = sharedUrl && !sharedText ? "link" : "note";

      handleCaptureItem(itemType, title, content).then(() => {
        // Clean up URL parameters after capture without reloading
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      });
    }
  }, []);

  // Automatic Clipboard Paste Listener: capture pasted screenshot directly
  useClipboardPaste({
    enabled: !isEditorOpen && !lightboxImage,
    onPasteImage: async (dataUrl, file) => {
      const now = new Date();
      const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
      const title = `Pasted Screenshot (${timeStr})`;
      await handleCaptureItem(
        "image",
        title,
        dataUrl,
        JSON.stringify({
          originalName: file.name,
          byteSize: file.size,
          mimeType: "image/webp",
        })
      );
    },
  });

  const handleTogglePin = async (itemId: string) => {
    await StorageService.togglePinItem(itemId);
    if (activeView.type === "folder") {
      await refreshFolderItems(activeView.folderId);
    } else {
      await refreshInboxItems();
    }
  };

  const handleMoveItem = async (itemId: string, newFolderId: string | null) => {
    await StorageService.moveItem(itemId, newFolderId);
    await refreshInboxItems();
    if (activeView.type === "folder") {
      await refreshFolderItems(activeView.folderId);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    await StorageService.deleteItem(itemId);
    if (activeView.type === "folder") {
      await refreshFolderItems(activeView.folderId);
    } else {
      await refreshInboxItems();
    }
  };

  // Editor Save handler
  const handleSaveEditorItem = async (
    itemId: string | null,
    title: string,
    content: string,
    targetFolderId: string | null,
    itemType: ItemType,
    metadata?: string | null
  ): Promise<VaultItem | void> => {
    let resultItem: VaultItem | null = null;
    if (itemId) {
      const updated = await StorageService.updateItem(itemId, title, content, metadata);
      if (updated.folder_id !== targetFolderId) {
        resultItem = await StorageService.moveItem(itemId, targetFolderId);
      } else {
        resultItem = updated;
      }
    } else {
      resultItem = await StorageService.createItem(
        targetFolderId,
        itemType,
        title,
        content,
        metadata || null
      );
    }

    await refreshInboxItems();
    if (activeView.type === "folder") {
      await refreshFolderItems(activeView.folderId);
    }
    return resultItem || undefined;
  };

  const filteredInboxItems = useMemo(() => {
    return inboxItems.filter((item) => {
      if (streamFilter === "notes") return item.item_type === "note";
      if (streamFilter === "markets") return item.item_type === "ticker" || item.item_type === "link";
      return true;
    });
  }, [inboxItems, streamFilter]);

  const displayedFolderItems = useMemo(() => {
    return folderItems.filter((item) => {
      if (streamFilter === "notes" && item.item_type !== "note") return false;
      if (streamFilter === "markets" && item.item_type !== "ticker" && item.item_type !== "link") return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return item.title.toLowerCase().includes(q) || item.content.toLowerCase().includes(q);
    });
  }, [folderItems, streamFilter, searchQuery]);

  const currentItemCount =
    activeView.type === "inbox" ? filteredInboxItems.length : displayedFolderItems.length;

  return (
    <AppLayout
      sidebar={({ isOpen, isMobile, onClose, onToggleCollapse }) => (
        <Sidebar
          isOpen={isOpen}
          isMobile={isMobile}
          onClose={onClose}
          onToggleCollapse={onToggleCollapse}
          activeView={activeView}
          onSelectInbox={handleSelectInbox}
          onSelectFolder={handleSelectFolder}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onMoveFolder={handleMoveFolder}
          onDeleteFolder={handleDeleteFolder}
          onMoveItem={handleMoveItem}
          folders={folders}
          inboxCount={inboxItems.length}
          meshState={meshState}
          onOpenPairing={() => setIsQrModalOpen(true)}
          zoomScale={zoomScale}
          onCycleZoom={handleCycleZoom}
        />
      )}
    >
      {({ isSidebarOpen, isMobile, onToggleSidebar }) => (
        <ContentPane
          breadcrumbs={breadcrumbs}
          onNavigateHome={handleSelectInbox}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={onToggleSidebar}
          isMobile={isMobile}
          title={viewTitle}
          itemCount={currentItemCount}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          streamFilter={streamFilter}
          onStreamFilterChange={setStreamFilter}
          headerActions={
            <div className="flex items-center gap-2">
              {isPaired || (meshState.pairedDeviceIds && meshState.pairedDeviceIds.length > 0) ? (
                <button
                  type="button"
                  onClick={() => setIsQrModalOpen(true)}
                  title="Vault Synced • Tap to view mesh devices"
                  className="h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/25 rounded-lg transition-all cursor-pointer shadow-xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                  <span>{meshState.peerCount > 0 ? `Synced (${meshState.peerCount})` : "Synced"}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsQrModalOpen(true)}
                  title="Tap to connect & pair with desktop or phone"
                  className="h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-all cursor-pointer shadow-xs animate-pulse"
                >
                  <Radio className="w-3.5 h-3.5 text-amber-400" />
                  <span>Connect Device</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditorItem(null);
                  setIsEditorOpen(true);
                }}
                className="h-7 px-3 flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-all cursor-pointer shadow-sm hover:shadow-[0_0_12px_rgba(99,102,241,0.4)]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Note</span>
              </button>
            </div>
          }
        >
          {/* Content Body */}
          {activeView.type === "inbox" ? (
            <QuickInboxView
              items={filteredInboxItems}
              folders={folders}
              onCapture={handleCaptureItem}
              onTogglePin={handleTogglePin}
              onMoveItem={handleMoveItem}
              onDeleteItem={handleDeleteItem}
              onSelectItem={(item) => {
                if (item.item_type === "image") {
                  setLightboxImage({ url: item.content, title: item.title });
                } else {
                  setEditorItem(item);
                  setIsEditorOpen(true);
                }
              }}
              onViewImage={(url, title) =>
                setLightboxImage({ url, title: title || "Image Preview" })
              }
              searchQuery={searchQuery}
            />
          ) : (
            <div className="w-full h-full flex flex-col gap-3">
              {/* Direct Folder Capture Bar */}
              <QuickCaptureBar
                onCapture={handleCaptureItem}
                folderId={activeFolder?.id}
              />

              {/* Folder Items Grid */}
              {displayedFolderItems.length === 0 ? (
                <div className="flex-1 min-h-0 flex items-center justify-center">
                <div className="w-full max-w-2xl border border-white/[0.08] rounded-xl bg-vault-panel overflow-hidden shadow-xs">
                  <div className="h-8 px-3.5 border-b border-white/[0.06] bg-vault-card flex items-center justify-between text-xs select-none">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
                      <span className="font-mono text-xs text-zinc-300">
                        vault://folder/{activeFolder?.name?.toLowerCase().replace(/\s+/g, "-") || "unnamed"}
                      </span>
                      <span className="text-[0.741rem] font-mono px-1.5 py-0.2 rounded bg-white/[0.05] text-zinc-400">
                        directory
                      </span>
                    </div>
                    <span className="font-mono text-[0.741rem] text-zinc-500">0 items</span>
                  </div>
                  <div className="p-4 sm:p-5 font-mono text-xs space-y-2">
                    <div className="text-zinc-300 font-semibold flex items-center gap-2">
                      <span className="text-amber-400">❯</span>
                      <span>directory empty</span>
                    </div>
                    <p className="text-zinc-500 text-[0.815rem] leading-relaxed">
                      Capture notes, tickers, and charts directly into this folder above, or drag unfiled captures here from Quick Inbox.
                    </p>
                  </div>
                </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
                  {displayedFolderItems.map((item) => (
                    <QuickInboxItemCard
                      key={item.id}
                      item={item}
                      onTogglePin={handleTogglePin}
                      onOpenMove={setTargetMoveFolderItem}
                      onDeleteItem={handleDeleteItem}
                      onSelectItem={(item) => {
                        if (item.item_type === "image") {
                          setLightboxImage({ url: item.content, title: item.title });
                        } else {
                          setEditorItem(item);
                          setIsEditorOpen(true);
                        }
                      }}
                      onViewImage={(url, title) =>
                        setLightboxImage({ url, title: title || "Image Preview" })
                      }
                    />
                  ))}
                </div>
              )}

              {/* Move Item Modal */}
              <MoveItemModal
                item={targetMoveFolderItem}
                isOpen={!!targetMoveFolderItem}
                onClose={() => setTargetMoveFolderItem(null)}
                onMove={handleMoveItem}
                folders={folders}
              />
            </div>
          )}

          {/* Dedicated Note & Idea Editor Modal */}
          <NoteEditorModal
            item={editorItem}
            isOpen={isEditorOpen}
            onClose={() => {
              setIsEditorOpen(false);
              setEditorItem(null);
            }}
            onSave={handleSaveEditorItem}
            onDelete={handleDeleteItem}
            onTogglePin={handleTogglePin}
            folders={folders}
            initialFolderId={activeView.type === "folder" ? activeView.folderId : null}
          />

          {/* High-Res Chart & Image Lightbox with Zoom */}
          <ImageLightbox
            isOpen={!!lightboxImage}
            onClose={() => setLightboxImage(null)}
            imageUrl={lightboxImage?.url || ""}
            title={lightboxImage?.title}
          />

          {/* QR Code Mobile & Tablet Connection Modal */}
          <QrConnectModal
            isOpen={isQrModalOpen}
            onClose={() => setIsQrModalOpen(false)}
            onSyncTriggered={() => {
              refreshFolders();
              refreshInboxItems();
            }}
          />

          {/* Tablet & Mobile Web Peer PIN Authorization Modal */}
          <PeerPinModal
            isOpen={isPeerPinModalOpen}
            onClose={() => setIsPeerPinModalOpen(false)}
            onPaired={() => {
              setIsPaired(true);
              refreshFolders();
              refreshInboxItems();
            }}
          />
        </ContentPane>
      )}
    </AppLayout>
  );
}

export default App;
