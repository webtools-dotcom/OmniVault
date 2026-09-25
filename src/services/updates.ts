import { isTauriEnvironment } from "./storageService";
import { invoke } from "@tauri-apps/api/core";

/** Repository whose GitHub releases the update check reads, as `owner/repo`. */
export const RELEASES_REPO = "webtools-dotcom/OmniVault";

/** Must match package.json, tauri.conf.json and Cargo.toml (checked by the tests). */
export const APP_VERSION = "0.2.1";

export type UpdateStatus = "unconfigured" | "current" | "available" | "failed";

export interface UpdateCheck {
  status: UpdateStatus;
  latest?: string;
  url?: string;
  message?: string;
}

/** `1.2.10` sorts after `1.2.9`, which a string comparison gets wrong. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(/[.\-+]/)
      .map((p) => Number.parseInt(p, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Checks once whether a newer release exists. This is the app's only outbound
 * request, made only when the user asks; nothing about the vault is sent.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!RELEASES_REPO) {
    return {
      status: "unconfigured",
      message: "No update channel is set up yet — releases are not published anywhere.",
    };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      return {
        status: "failed",
        message:
          res.status === 404
            ? "No releases have been published yet."
            : `Could not reach the releases page (HTTP ${res.status}).`,
      };
    }
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = (body.tag_name || "").replace(/^v/i, "");
    const url = body.html_url || `https://github.com/${RELEASES_REPO}/releases`;
    if (latest && isNewer(latest, APP_VERSION)) {
      return { status: "available", latest, url };
    }
    return { status: "current", latest: latest || APP_VERSION, url };
  } catch {
    return {
      status: "failed",
      message: "Could not reach the internet. Nothing else about the app needs it.",
    };
  }
}

/** Opens a link outside the app. Desktop only; elsewhere the caller copies it. */
export async function openExternal(url: string): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  try {
    await invoke("open_url_cmd", { url });
    return true;
  } catch {
    return false;
  }
}
