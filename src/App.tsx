import { useState, useMemo, useEffect, useCallback } from "react";
import { FolderGit2, Plus } from "lucide-react";
import { ActiveView, BreadcrumbItem, Folder, ItemType, MeshSyncState, VaultItem } from "./types";
import { AppLayout } from "./components/layout/AppLayout";
import { Sidebar } from "./components/layout/Sidebar";
import { ContentPane } from "./components/layout/ContentPane";
import { Button } from "./components/common/Button";
import { getFolderPath } from "./utils/folderTree";
import { StorageService } from "./services/storageService";
import { QuickInboxView } from "./components/inbox/QuickInboxView";
import { QuickInboxItemCard } from "./components/inbox/QuickInboxItemCard";
import { MoveItemModal } from "./components/inbox/MoveItemModal";
import { QuickCaptureBar } from "./components/inbox/QuickCaptureBar";
import { NoteEditorModal } from "./components/editor/NoteEditorModal";
import { ImageLightbox } from "./components/media/ImageLightbox";
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

  const [meshState] = useState<MeshSyncState>({
    status: "standby",
    peerCount: 0,
  });

  // Load folders and items
  const refreshFolders = useCallback(async () => {
    try {
      const data = await StorageService.getFolders();
      setFolders(data);
    } catch (err) {
      console.error("Failed to load folders:", err);
    }
  }, []);

  const refreshInboxItems = useCallback(async () => {
    try {
      const items = await StorageService.getInboxItems();
      setInboxItems(items);
    } catch (err) {
      console.error("Failed to load inbox items:", err);
    }
  }, []);

  const refreshFolderItems = useCallback(async (folderId: string) => {
    try {
      const items = await StorageService.getFolderItems(folderId);
      setFolderItems(items);
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
    metadata?: string
  ) => {
    const currentFolderId = activeView.type === "folder" ? activeView.folderId : null;
    await StorageService.createItem(
      currentFolderId,
      itemType,
      title,
      content,
      metadata || null
    );
    if (currentFolderId) {
      await refreshFolderItems(currentFolderId);
    } else {
      await refreshInboxItems();
    }
  };

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
  ) => {
    if (itemId) {
      const updated = await StorageService.updateItem(itemId, title, content, metadata);
      if (updated.folder_id !== targetFolderId) {
        await StorageService.moveItem(itemId, targetFolderId);
      }
    } else {
      await StorageService.createItem(
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
  };

  const currentItemCount =
    activeView.type === "inbox" ? inboxItems.length : folderItems.length;

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
          headerActions={
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditorItem(null);
                setIsEditorOpen(true);
              }}
              className="font-medium"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span>New Note</span>
            </Button>
          }
        >
          {/* Content Body */}
          {activeView.type === "inbox" ? (
            <QuickInboxView
              items={inboxItems}
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
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Direct Folder Capture Bar */}
              <QuickCaptureBar
                onCapture={handleCaptureItem}
                folderId={activeFolder?.id}
              />

              {/* Folder Items Grid */}
              {folderItems.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-vault-border bg-vault-card/30 p-8">
                  <div className="w-14 h-14 rounded-2xl bg-vault-card border border-vault-border flex items-center justify-center mb-3 text-vault-accent shadow-xs">
                    <FolderGit2 className="w-7 h-7" />
                  </div>
                  <h3 className="text-sm font-semibold text-vault-primary mb-1">
                    {activeFolder?.name || "Folder"} is Empty
                  </h3>
                  <p className="text-xs text-vault-secondary max-w-sm mb-4">
                    Capture directly into this folder above, or file items here from your Quick Inbox.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {folderItems.map((item) => (
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
        </ContentPane>
      )}
    </AppLayout>
  );
}

export default App;
