import React from "react";
import { Menu, PanelLeft, Search, X } from "lucide-react";
import { BreadcrumbItem } from "../../types";
import { Breadcrumbs } from "./Breadcrumbs";
import { Button } from "../common/Button";
import { Badge } from "../common/Badge";

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
  children: React.ReactNode;
}

export const ContentPane: React.FC<ContentPaneProps> = ({
  breadcrumbs,
  onNavigateHome,
  isSidebarOpen,
  onToggleSidebar,
  isMobile,
  title,
  itemCount,
  searchQuery,
  onSearchChange,
  headerActions,
  children,
}) => {
  return (
    <main className="flex-1 flex flex-col min-w-0 bg-vault-bg overflow-hidden">
      {/* Top Header / Navigation Bar */}
      <header className="h-14 px-4 sm:px-6 border-b border-vault-border flex items-center justify-between gap-3 shrink-0 bg-vault-bg">
        <div className="flex items-center gap-2 min-w-0">
          {/* Mobile/Tablet Menu or Desktop Restore Toggle */}
          {(!isSidebarOpen || isMobile) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSidebar}
              title="Open Sidebar"
              aria-label="Open sidebar"
              className="text-vault-secondary hover:text-vault-primary shrink-0"
            >
              {isMobile ? <Menu className="w-5 h-5" /> : <PanelLeft className="w-4 h-4" />}
            </Button>
          )}

          <Breadcrumbs items={breadcrumbs} onNavigateHome={onNavigateHome} />
        </div>

        {/* Quick Search & Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative hidden sm:block w-48 lg:w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-vault-muted pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter items..."
              className="w-full h-8 pl-8 pr-7 bg-vault-card border border-vault-border rounded-md text-xs text-vault-primary placeholder-vault-muted focus:outline-none focus:border-vault-border-active transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-vault-muted hover:text-vault-secondary"
                aria-label="Clear filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {headerActions}
        </div>
      </header>

      {/* Sub-toolbar for Mobile Search (if screen is narrow) */}
      <div className="sm:hidden px-4 py-2 border-b border-vault-border bg-vault-card/40">
        <div className="relative w-full">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-vault-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter items..."
            className="w-full h-8 pl-8 pr-7 bg-vault-card border border-vault-border rounded-md text-xs text-vault-primary placeholder-vault-muted focus:outline-none focus:border-vault-border-active transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-vault-muted hover:text-vault-secondary"
              aria-label="Clear filter"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* View Header Info */}
      <div className="px-4 sm:px-6 py-3 border-b border-vault-border/60 bg-vault-bg/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-base sm:text-lg font-semibold text-vault-primary tracking-tight">
            {title}
          </h1>
          <Badge variant="default" size="sm">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </Badge>
        </div>
      </div>

      {/* Content Viewport */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {children}
      </div>
    </main>
  );
};
