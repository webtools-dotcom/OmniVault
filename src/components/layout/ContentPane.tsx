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
  return (
    <main className="flex-1 flex flex-col min-w-0 bg-[#0E0E11] overflow-hidden">
      {/* Top Header / Navigation Bar (BridgeMind 44px unified shell) */}
      <header className="h-11 px-3 sm:px-4 border-b border-white/[0.07] flex items-center justify-between gap-3 shrink-0 bg-[#121216] z-10 select-none">
        {/* Left: Sidebar Toggle & Location Breadcrumbs */}
        <div className="flex items-center gap-2 min-w-0">
          {(!isSidebarOpen || isMobile) && (
            <button
              onClick={onToggleSidebar}
              title="Open Sidebar (Ctrl+B)"
              aria-label="Open sidebar"
              className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0 cursor-pointer"
            >
              {isMobile ? <Menu className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            </button>
          )}

          <Breadcrumbs items={breadcrumbs} onNavigateHome={onNavigateHome} />

          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.05] text-zinc-400 shrink-0 hidden md:inline-block">
            {itemCount}
          </span>
        </div>

        {/* Center: BridgeMind Segmented Switcher [ Stream | Notes | Markets ] */}
        {onStreamFilterChange && (
          <div className="hidden md:flex items-center bg-[#18181D] p-0.5 rounded-lg border border-white/[0.08] shadow-xs">
            <button
              type="button"
              onClick={() => onStreamFilterChange("stream")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                streamFilter === "stream"
                  ? "bg-[#27272F] text-white shadow-xs font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              Stream
            </button>
            <button
              type="button"
              onClick={() => onStreamFilterChange("notes")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                streamFilter === "notes"
                  ? "bg-[#27272F] text-white shadow-xs font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              Notes
            </button>
            <button
              type="button"
              onClick={() => onStreamFilterChange("markets")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                streamFilter === "markets"
                  ? "bg-[#27272F] text-white shadow-xs font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              Markets
            </button>
          </div>
        )}

        {/* Right: Quick Search & Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative hidden sm:block w-40 lg:w-56">
            <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search captures..."
              className="w-full h-7 pl-7.5 pr-6 bg-[#18181D] border border-white/[0.08] rounded-lg text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-white/20 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                aria-label="Clear filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {headerActions}
        </div>
      </header>

      {/* Content Viewport */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5">
        <div className="w-full h-full">
          {children}
        </div>
      </div>
    </main>
  );
};
