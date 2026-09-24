/**
 * Restricts a link to schemes that are safe in an `href`. Notes can arrive
 * from paired devices and the Android share sheet, and React does not sanitise
 * `href`, so a `javascript:` link would otherwise run inside the app.
 *
 * Returns null when the URL should not be linked.
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
