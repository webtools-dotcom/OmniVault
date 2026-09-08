import { FolderGit2, Inbox, ShieldCheck, Wifi } from "lucide-react";

export function App() {
  return (
    <div className="flex h-screen w-screen bg-vault-bg text-vault-primary overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-vault-border bg-vault-card flex flex-col">
        <div className="p-4 border-b border-vault-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-vault-accent" />
            <span className="font-semibold text-base tracking-tight">OmniVault</span>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded bg-vault-elevated text-vault-secondary border border-vault-border">
            v0.1.0
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-vault-elevated text-vault-primary font-medium text-sm">
            <Inbox className="w-4 h-4 text-vault-accent" />
            <span>Quick Inbox</span>
            <span className="ml-auto text-xs px-1.5 py-0.2 bg-vault-card rounded text-vault-secondary">
              0
            </span>
          </button>
          
          <div className="pt-4 pb-2 px-3 text-xs font-semibold text-vault-secondary uppercase tracking-wider">
            Folders
          </div>
          
          <div className="px-3 py-4 text-center text-xs text-vault-muted border border-dashed border-vault-border rounded-md">
            No folders yet.<br />Ready for Phase 1.
          </div>
        </nav>

        {/* Sync Status Footer */}
        <div className="p-3 border-t border-vault-border flex items-center gap-2 text-xs text-vault-secondary bg-vault-card">
          <Wifi className="w-4 h-4 text-vault-success" />
          <span>Local Mesh: Standby</span>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col bg-vault-bg">
        <header className="h-14 border-b border-vault-border px-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-vault-secondary">
            <span>OmniVault</span>
            <span>/</span>
            <span className="text-vault-primary font-medium">Quick Inbox</span>
          </div>
        </header>

        <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-vault-card border border-vault-border flex items-center justify-center mb-4 text-vault-accent shadow-sm">
            <FolderGit2 className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-semibold text-vault-primary mb-1">OmniVault Workspace Initialized</h2>
          <p className="text-sm text-vault-secondary max-w-md mb-6">
            Private, local-first store-and-forward sync across mobile, tablet, and laptop. All data stored on local hardware.
          </p>
          <div className="flex items-center gap-2 text-xs text-vault-muted">
            <span className="w-2 h-2 rounded-full bg-vault-success inline-block"></span>
            <span>Frontend & Rust scaffolding verified</span>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
