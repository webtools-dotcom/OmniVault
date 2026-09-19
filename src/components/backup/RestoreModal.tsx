import React, { useEffect, useState } from "react";
import { Archive, Check, Loader2, X } from "lucide-react";
import {
  BackupFile,
  ImportSummary,
  StorageService,
  isTauriEnvironment,
} from "../../services/storageService";
import { cn } from "../../utils/cn";
import { deviceKind } from "../../utils/platform";

export interface RestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestored: () => void;
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatWhen(ms: number): string {
  if (!ms) return "";
  const then = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  const stamp = then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (days <= 0) return `today, ${then.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "yesterday";
  return `${stamp} · ${days} days ago`;
}

export const RestoreModal: React.FC<RestoreModalProps> = ({ isOpen, onClose, onRestored }) => {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onAndroid = deviceKind(isTauriEnvironment()) === "tablet" || deviceKind(isTauriEnvironment()) === "phone";

  useEffect(() => {
    if (!isOpen) return;
    setDone(null);
    setError(null);
    setSelected(null);
    StorageService.listBackups()
      .then(setBackups)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not look for backups."));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRestore = async () => {
    if (!selected || isWorking) return;
    setIsWorking(true);
    setError(null);
    try {
      const summary = await StorageService.importVault(selected);
      setDone(summary);
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The restore did not finish.");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-vault-bg/80 select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-title"
        className="w-full max-w-lg bg-vault-card rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          <div className="w-8 h-8 rounded-lg bg-vault-elevated flex items-center justify-center text-vault-secondary shrink-0">
            <Archive className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="restore-title"
              className="font-display text-base font-semibold tracking-[-0.01em] text-vault-primary"
            >
              Restore from a backup
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-vault-muted">
              Nothing already here is deleted, and anything you have edited since the backup was
              taken keeps the newer version.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5">
          {done ? (
            <div className="rounded-xl bg-vault-elevated px-4 py-3.5">
              <div className="flex items-center gap-2 text-vault-success text-sm font-medium">
                <Check className="w-4 h-4" />
                Restored
              </div>
              <p className="mt-2 text-xs leading-relaxed text-vault-secondary">
                {done.applied} record{done.applied === 1 ? "" : "s"} taken from a backup holding{" "}
                {done.notes_in_backup} note{done.notes_in_backup === 1 ? "" : "s"}
                {done.media_added > 0 && `, and ${done.media_added} image${done.media_added === 1 ? "" : "s"} copied back`}
                . Anything newer on this device was left as it was.
              </p>
            </div>
          ) : backups.length === 0 ? (
            <div className="rounded-xl bg-vault-elevated px-4 py-4 text-xs leading-relaxed text-vault-muted">
              {onAndroid ? (
                <>
                  No backups this app can open. Android only lets an app read files in
                  your downloads folder that it created itself, so a backup made before
                  the app was reinstalled — or copied here from elsewhere — is invisible
                  to it, even though you can see the file.
                  <span className="block mt-2 text-vault-secondary">
                    To get that vault back: restore it on a computer running OmniVault,
                    then pair this device and let it sync across.
                  </span>
                </>
              ) : (
                <>
                  No backups found in your downloads folder. Use{" "}
                  <strong className="text-vault-secondary font-medium">Back up</strong> first,
                  or copy a backup there from another device.
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {backups.map((b) => (
                <button
                  key={b.path}
                  type="button"
                  onClick={() => setSelected(b.path)}
                  className={cn(
                    "text-left rounded-xl px-3.5 py-3 transition-colors cursor-pointer",
                    selected === b.path
                      ? "bg-vault-overlay text-vault-primary"
                      : "bg-vault-elevated text-vault-secondary hover:bg-vault-overlay"
                  )}
                >
                  <div className="text-[0.8125rem] font-medium text-vault-primary truncate">
                    {b.name}
                  </div>
                  <div className="mt-0.5 text-xs text-vault-muted">
                    {formatWhen(b.modified_ms)} · {formatSize(b.bytes)}
                  </div>
                </button>
              ))}
            </div>
          )}

          {error && <p className="mt-3 text-xs leading-relaxed text-vault-error">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg text-xs text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated transition-colors cursor-pointer"
            >
              {done ? "Done" : "Cancel"}
            </button>
            {!done && (
              <button
                type="button"
                onClick={handleRestore}
                disabled={!selected || isWorking}
                className="h-9 px-4 rounded-lg bg-vault-accent hover:bg-vault-accent-hover disabled:opacity-40 text-vault-ink text-xs font-semibold transition-colors cursor-pointer flex items-center gap-2"
              >
                {isWorking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isWorking ? "Restoring…" : "Restore"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
