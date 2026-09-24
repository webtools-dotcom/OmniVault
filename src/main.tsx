import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { isTauriEnvironment } from "./services/storageService";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("OmniVault App crashed:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-[#0A0B0E] p-6 text-[#F4F4F7] select-none">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-vault-error mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-vault-error shadow-[0_0_8px_rgba(248,113,113,0.8)]" />
              <span className="text-xs font-medium">Workspace Runtime Exception</span>
            </div>
            <p className="text-xs text-vault-secondary mb-4 leading-relaxed font-sans">
              An unexpected runtime state occurred while rendering the workspace.
            </p>
            <div className="p-3 bg-[#18181D] border border-white/[0.06] rounded-xl text-[0.815rem] text-vault-secondary mb-4 break-all max-h-32 overflow-auto">
              {this.state.error?.message || "Unknown error"}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  window.location.reload();
                }}
                className="h-8 px-4 text-xs font-medium text-vault-ink bg-vault-accent hover:bg-vault-accent rounded-lg transition-colors cursor-pointer"
              >
                Reload Workspace
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// In desktop Tauri WebView2, ensure any rogue service workers are purged
if (isTauriEnvironment() && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().catch(() => {});
      }
    })
    .catch(() => {});
}

// Register PWA service worker ONLY in non-Tauri mobile / tablet browser environments
if (!isTauriEnvironment() && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("ServiceWorker registration failed:", err);
    });
  });
}
