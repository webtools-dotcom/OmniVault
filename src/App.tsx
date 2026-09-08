import { useState, useMemo, useEffect, useCallback } from "react";
import { FolderGit2, Inbox, Plus, Sparkles } from "lucide-react";
import { ActiveView, BreadcrumbItem, Folder, MeshSyncState } from "./types";
import { AppLayout } from "./components/layout/AppLayout";
import { Sidebar } from "./components/layout/Sidebar";
import { ContentPane } from "./components/layout/ContentPane";
import { Button } from "./components/common/Button";
import { getFolderPath } from "./utils/folderTree";
import { StorageService } from "./services/storageService";

export function App() {
  const [activeView, setActiveView] = useState<ActiveView>({ type: "inbox" });
  const [folders, setFolders] = useState<Folder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [inboxCount] = useState(0);
  const [meshState] = useState<MeshSyncState>({
    status: "standby",
    peerCount: 0,
  });

  // Load initial folders from storage service
  const refreshFolders = useCallback(async () => {
    try {
      const data = await StorageService.getFolders();
      setFolders(data);
    } catch (err) {
      console.error("Failed to load folders:", err);
    }
  }, []);

  useEffect(() => {
    refreshFolders();
  }, [refreshFolders]);

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

  const handleSelectInbox = () => {
    setActiveView({ type: "inbox" });
  };

  const handleSelectFolder = (folderId: string) => {
    setActiveView({ type: "folder", folderId });
  };

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
          folders={folders}
          inboxCount={inboxCount}
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
          itemCount={activeView.type === "inbox" ? inboxCount : 0}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          headerActions={
            <Button
              variant="primary"
              size="sm"
              onClick={() => {}}
              className="font-medium"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span>New Note</span>
            </Button>
          }
        >
          {/* Content Body */}
          {activeView.type === "inbox" ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-vault-card border border-vault-border flex items-center justify-center mb-4 text-vault-accent shadow-sm">
                <Inbox className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-semibold text-vault-primary mb-1">
                Quick Inbox is Empty
              </h2>
              <p className="text-sm text-vault-secondary max-w-md mb-6">
                Capture quick thoughts, links, and screenshots in under 2 seconds. Items stay here until you triage them into folders.
              </p>
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="md" onClick={() => {}}>
                  <Sparkles className="w-4 h-4 text-vault-accent mr-1.5" />
                  <span>Capture Note</span>
                </Button>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-vault-card border border-vault-border flex items-center justify-center mb-4 text-vault-accent shadow-sm">
                <FolderGit2 className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-semibold text-vault-primary mb-1">
                {activeFolder?.name || "Folder"} is Empty
              </h2>
              <p className="text-sm text-vault-secondary max-w-md mb-6">
                No items in this folder yet. Create notes, save links, or drag items here from Quick Inbox.
              </p>
              <Button variant="secondary" size="md" onClick={() => {}}>
                <Plus className="w-4 h-4 text-vault-accent mr-1.5" />
                <span>Add Item to Folder</span>
              </Button>
            </div>
          )}
        </ContentPane>
      )}
    </AppLayout>
  );
}

export default App;
