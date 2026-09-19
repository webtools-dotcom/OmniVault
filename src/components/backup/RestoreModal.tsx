import React, { useEffect, useRef, useState } from "react";
import { Archive, Check, FolderOpen, Loader2, X } from "lucide-react";
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

/**
 * Tauri rejects a failed command with a plain string, not an Error, so the
 * usual `err instanceof Error` check throws away every message the Rust side
 * took the trouble to write and leaves the person with a generic one. That is
 * how "That zip has no omnivault.db in it" reached the screen as "could not be
 * read". See D-077.
 */
function messageFrom(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export const RestoreModal: React.FC<RestoreModalProps> = ({ isOpen, onClose, onRestored }) => {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const onAndroid = deviceKind(isTauriEnvironment()) === "tablet" || deviceKind(isTauriEnvironment()) === "phone";

  useEffect(() => {
    if (!isOpen) return;
    setDone(null);
    setError(null);
    setSelected(null);
    StorageService.listBackups()
      .then(setBackups)
      .catch((err) => setError(messageFrom(err, "Could not look for backups.")));
  }, [isOpen]);

  if (!isOpen) return null;

  /**
   * Restores a file the person pointed at, rather than one the app found.
   *
   * A plain file input, because the webview turns it into the system picker
   * and the system picker is the only way an Android app may read a file it
   * did not write. The bytes are read here and handed over whole; there is no
   * path involved on that platform. See D-077.
   */
  const handlePicked = async (file: File | undefined) => {
    if (!file || isWorking) return;
    setIsWorking(true);
    setError(null);
    try {
      const summary = await StorageService.importVaultBytes(file);
      setDone(summary);
      onRestored();
    } catch (err) {
      setError(messageFrom(err, "That file could not be read."));
    } finally {
      setIsWorking(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleRestore = async () => {
    if (!selected || isWorking) return;
    setIsWorking(true);
    setError(null);
    try {
      const summary = await StorageService.importVault(selected);
      setDone(summary);
      onRestored();
    } catch (err) {
      setError(messageFrom(err, "The restore did not finish."));
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
                {done.notes_present} of {done.notes_in_backup} note
                {done.notes_in_backup === 1 ? "" : "s"} from that backup{" "}
                {done.notes_present === 1 ? "is" : "are"} here
                {done.media_added > 0 &&
                  `, and ${done.media_added} image${done.media_added === 1 ? "" : "s"} copied back`}
                .
              </p>
              {done.notes_left_deleted > 0 && (
                <p className="mt-2 text-xs leading-relaxed text-vault-muted">
                  The other {done.notes_left_deleted === 1 ? "one" : done.notes_left_deleted}{" "}
                  {done.notes_left_deleted === 1 ? "was" : "were"} deleted on this device after the
                  backup was taken, so{" "}
                  {done.notes_left_deleted === 1 ? "it was" : "they were"} left deleted. A restore
                  never undoes a deletion that came after the backup.
                </p>
              )}
            </div>
          ) : backups.length === 0 ? (
            <div className="rounded-xl bg-vault-elevated px-4 py-4 text-xs leading-relaxed text-vault-muted">
              {onAndroid ? (
                <>
                  Nothing here this app can list on its own. Android only lets an app see
                  files in your downloads folder that it created itself, so a backup from
                  before the app was reinstalled is invisible to it even though the file
                  is sitting right there.
                  <span className="block mt-2 text-vault-secondary">
                    Use <strong className="font-medium">Choose a file</strong> below and
                    point at it — handing it over yourself is what gives the app
                    permission to read it.
                  </span>
                </>
              ) : (
                <>
                  No backups found in your downloads folder. Use{" "}
                  <strong className="text-vault-secondary font-medium">Back up</strong> first,
                  or <strong className="text-vault-secondary font-medium">Choose a file</strong>{" "}
                  to point at one kept somewhere else.
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

          <div className="flex items-center gap-2 pt-4">
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => handlePicked(e.target.files?.[0])}
            />
            {!done && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={isWorking}
                className="h-9 px-3 rounded-lg text-xs text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated disabled:opacity-40 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Choose a file
              </button>
            )}
            <div className="flex-1" />
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
