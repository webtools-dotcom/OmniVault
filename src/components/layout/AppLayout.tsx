import React, { useEffect, useState } from "react";
import { cn } from "../../utils/cn";

export interface AppLayoutProps {
  sidebar: (props: {
    isOpen: boolean;
    isMobile: boolean;
    onClose: () => void;
    onToggleCollapse: () => void;
  }) => React.ReactNode;
  children: (props: {
    isSidebarOpen: boolean;
    isMobile: boolean;
    onToggleSidebar: () => void;
  }) => React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ sidebar, children }) => {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth < 768;
    }
    return false;
  });

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 768;
    }
    return true;
  });

  // Handle responsive breakpoint changes
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile && sidebarOpen) {
        // Auto-close overlay on initial switch to mobile
        setSidebarOpen(false);
      } else if (!mobile && !sidebarOpen) {
        // Auto-open on desktop expansion
        setSidebarOpen(true);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keyboard shortcut Ctrl+B / Cmd+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCloseSidebar = () => setSidebarOpen(false);
  const handleToggleSidebar = () => setSidebarOpen((prev) => !prev);

  return (
    <div className="flex h-screen w-screen bg-vault-bg text-vault-primary overflow-hidden font-sans">
      {/* Mobile Backdrop Overlay */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden transition-opacity"
          onClick={handleCloseSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Pane (Desktop toggleable or Mobile drawer) */}
      <div
        className={cn(
          "h-full transition-all duration-200 ease-in-out",
          isMobile
            ? (sidebarOpen ? "translate-x-0" : "-translate-x-full pointer-events-none")
            : (sidebarOpen ? "w-64" : "w-0 overflow-hidden")
        )}
      >
        {sidebar({
          isOpen: sidebarOpen,
          isMobile,
          onClose: handleCloseSidebar,
          onToggleCollapse: handleToggleSidebar,
        })}
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        {children({
          isSidebarOpen: sidebarOpen,
          isMobile,
          onToggleSidebar: handleToggleSidebar,
        })}
      </div>
    </div>
  );
};
