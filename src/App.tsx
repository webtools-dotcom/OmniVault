import { useState, useMemo } from "react";
import { FolderGit2, Inbox, Plus, Sparkles } from "lucide-react";
import { ActiveView, BreadcrumbItem, Folder, MeshSyncState } from "./types";
import { AppLayout } from "./components/layout/AppLayout";
import { Sidebar } from "./components/layout/Sidebar";
import { ContentPane } from "./components/layout/ContentPane";
import { Button } from "./components/common/Button";

// Initial folder hierarchy for scaffolding preview & navigation testing
const INITIAL_FOLDERS: Folder[] = [
  {
    id: "fld-research",
    parent_id: null,
    name: "Research & Notes",
    color: "#2F81F7",
    created_at: Date.now() - 3600000,
    updated_at: Date.now() - 3600000,
    is_deleted: false,
  },
  {
    id: "fld-trading",
    parent_id: null,
    name: "Market Setups & Charts",
    color: "#238636",
    created_at: Date.now() - 7200000,
    updated_at: Date.now() - 7200000,
    is_deleted: false,
  },
  {
    id: "fld-ideas",
    parent_id: null,
    name: "Product Ideas",
    color: "#D29922",
    created_at: Date.now() - 10800000,
    updated_at: Date.now() - 10800000,
    is_deleted: false,
  },
];

export function App() {
  const [activeView, setActiveView] = useState<ActiveView>({ type: "inbox" });
  const [folders, setFolders] = useState<Folder[]>(INITIAL_FOLDERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [inboxCount] = useState(0);
  const [meshState] = useState<MeshSyncState>({
    status: "standby",
    peerCount: 0,
  });

  // Find active folder details if folder view
  const activeFolder = useMemo(() => {
    if (activeView.type === "folder") {
      return folders.find((f) => f.id === activeView.folderId) || null;
    }
    return null;
  }, [activeView, folders]);

  // Compute breadcrumbs hierarchy based on active view
  const breadcrumbs: BreadcrumbItem[] = useMemo(() => {
    if (activeView.type === "inbox") {
      return [{ id: "inbox", label: "Quick Inbox", active: true }];
    }

    if (activeView.type === "folder" && activeFolder) {
      // If folder has parent, in future can traverse chain; currently single level
      return [
        {
          id: "folders",
          label: "Folders",
          onClick: () => setActiveView({ type: "inbox" }),
        },
        { id: activeFolder.id, label: activeFolder.name, active: true },
      ];
    }

    return [{ id: "root", label: "Workspace", active: true }];
  }, [activeView, activeFolder]);

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

  const handleCreateFolder = () => {
    const name = window.prompt("Folder name:");
    if (!name?.trim()) return;
    const newFolder: Folder = {
      id: `fld-${Date.now()}`,
      parent_id: null,
      name: name.trim(),
      color: "#2F81F7",
      created_at: Date.now(),
      updated_at: Date.now(),
      is_deleted: false,
    };
    setFolders((prev) => [...prev, newFolder]);
    setActiveView({ type: "folder", folderId: newFolder.id });
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
