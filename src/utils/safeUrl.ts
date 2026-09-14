/**
 * Restricts a link to schemes that are safe to put in an `href`.
 *
 * Note content is not necessarily written by the person reading it: notes
 * arrive from paired devices and from the Android share sheet. React does not
 * sanitise `href`, so `[click me](javascript:...)` in a synced note renders a
 * working anchor — and inside the Tauri webview that script reaches the app's
 * IPC surface, which can read and modify the vault. See D-061.
 *
 * Returns null when the URL should not be linked at all.
 */
export function safeHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = raw.trim();
  if (!url) return null;

  // Strip characters that browsers ignore when resolving a scheme, so
  // "java\tscript:" and friends cannot smuggle one past the check.
  const forScheme = url.replace(/[\u0000-\u0020]/g, "").toLowerCase();

  // Relative and anchor links carry no scheme and stay within the app.
  if (/^(\/|\.\/|\.\.\/|#|\?)/.test(url)) return url;

  const scheme = forScheme.match(/^([a-z][a-z0-9+.-]*):/);
  if (!scheme) {
    // Bare "example.com/page" — treat as https rather than letting the
    // browser guess.
    return `https://${url}`;
  }

  return ["http", "https", "mailto"].includes(scheme[1]) ? url : null;
}
