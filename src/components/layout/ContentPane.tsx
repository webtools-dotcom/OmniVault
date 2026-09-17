import React from "react";
import { Menu, PanelLeft, Search, X } from "lucide-react";
import { BreadcrumbItem } from "../../types";
import { Breadcrumbs } from "./Breadcrumbs";
import { cn } from "../../utils/cn";

export interface ContentPaneProps {
  breadcrumbs: BreadcrumbItem[];
  onNavigateHome?: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isMobile: boolean;
  title: string;
  itemCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  headerActions?: React.ReactNode;
  streamFilter?: "stream" | "notes" | "markets";
  onStreamFilterChange?: (filter: "stream" | "notes" | "markets") => void;
  children: React.ReactNode;
}

export const ContentPane: React.FC<ContentPaneProps> = ({
  breadcrumbs,
  onNavigateHome,
  isSidebarOpen,
  onToggleSidebar,
  isMobile,
  title: _title,
  itemCount,
  searchQuery,
  onSearchChange,
  headerActions,
  streamFilter = "stream",
  onStreamFilterChange,
  children,
}) => {
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-vault-bg overflow-hidden">
      {/* Top Header / Navigation Bar */}
      <header className="h-14 px-4 flex items-center justify-between gap-3 shrink-0 bg-vault-bg z-10 select-none">
        {/* Left: Sidebar Toggle & Location Breadcrumbs */}
        <div className="flex items-center gap-2 min-w-0">
          {(!isSidebarOpen || isMobile) && (
            <button
              onClick={onToggleSidebar}
              title="Open Sidebar (Ctrl+B)"
              aria-label="Open sidebar"
              className="w-6.5 h-6.5 flex items-center justify-center rounded-md text-vault-secondary hover:text-vault-primary hover:bg-vault-primary/[0.06] transition-colors shrink-0 cursor-pointer"
            >
              {isMobile ? <Menu className="w-3.5 h-3.5" /> : <PanelLeft className="w-3.5 h-3.5" />}
            </button>
          )}

          <Breadcrumbs items={breadcrumbs} onNavigateHome={onNavigateHome} />

          <span className="text-xs text-vault-subtle shrink-0 hidden md:inline-block">
            {itemCount}
          </span>
        </div>

        {/* Center: Segmented Switcher [ Stream | Notes | Markets ] */}
        {onStreamFilterChange && (
          <div className="hidden md:flex items-center bg-vault-card p-0.5 rounded-lg border border-white/[0.08] shadow-xs">
            <button
              type="button"
              onClick={() => onStreamFilterChange("stream")}
              className={cn(
                "px-2.5 py-0.5 rounded-md text-xs font-medium transition-all cursor-pointer",
                streamFilter === "stream"
                  ? "bg-vault-primary/[0.08] text-vault-primary shadow-xs font-semibold"
                  : "text-vault-secondary hover:text-vault-primary"
              )}
            >
              Stream
            </button>
            <button
              type="button"
              onClick={() => onStreamFilterChange("notes")}
              className={cn(
                "px-2.5 py-0.5 rounded-md text-xs font-medium transition-all cursor-pointer",
                streamFilter === "notes"
                  ? "bg-vault-primary/[0.08] text-vault-primary shadow-xs font-semibold"
                  : "text-vault-secondary hover:text-vault-primary"
              )}
            >
              Notes
            </button>
            <button
              type="button"
              onClick={() => onStreamFilterChange("markets")}
              className={cn(
                "px-2.5 py-0.5 rounded-md text-xs font-medium transition-all cursor-pointer",
                streamFilter === "markets"
                  ? "bg-vault-primary/[0.08] text-vault-primary shadow-xs font-semibold"
                  : "text-vault-secondary hover:text-vault-primary"
              )}
            >
              Markets
            </button>
          </div>
        )}

        {/* Right: Quick Search & Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative hidden sm:block w-32 md:w-36 lg:w-52 shrink">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-vault-muted pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search..."
              className="w-full h-7 pl-8 pr-7.5 bg-vault-card border border-white/[0.08] rounded-lg text-xs text-vault-primary placeholder:text-vault-muted focus:outline-none focus:border-vault-border-active/50 transition-colors font-sans"
            />
            {searchQuery ? (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-vault-muted hover:text-vault-secondary p-0.5 cursor-pointer"
                aria-label="Clear filter"
              >
                <X className="w-3 h-3" />
              </button>
            ) : (
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[0.667rem] text-vault-subtle bg-vault-primary/[0.03] px-1 py-0.2 rounded border border-white/[0.05] pointer-events-none">
                ⌘K
              </kbd>
            )}
          </div>

          {headerActions}
        </div>
      </header>

      {/* Content Viewport */}
      <div className="flex-1 overflow-y-auto p-2.5 sm:p-3.5 lg:p-4">
        <div className="w-full h-full pb-24 sm:pb-0">
          {children}
        </div>
      </div>
    </main>
  );
};
