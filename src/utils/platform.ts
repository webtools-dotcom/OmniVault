/**
 * What kind of device this is, for wording such as "This tablet". Layout
 * breakpoints are the wrong signal: a landscape tablet gets the desktop layout.
 */
export type DeviceKind = "phone" | "tablet" | "computer" | "browser";

export function deviceKind(isTauri: boolean): DeviceKind {
  if (typeof navigator === "undefined") return isTauri ? "computer" : "browser";

  const ua = navigator.userAgent;
  const android = /Android/i.test(ua);
  const ios = /iPad|iPhone|iPod/i.test(ua);
  // An iPad reports itself as a Mac, and is told apart by having a touchscreen.
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;

  if (!isTauri && !android && !ios && !iPadOS) return "browser";
  if (ios && /iPhone|iPod/i.test(ua)) return "phone";
  if (iPadOS || /iPad/i.test(ua)) return "tablet";
  if (android) {
    // Android phones carry "Mobile" in the token; tablets leave it out.
    return /Mobile/i.test(ua) ? "phone" : "tablet";
  }
  return "computer";
}

export function deviceLabel(isTauri: boolean): string {
  switch (deviceKind(isTauri)) {
    case "phone":
      return "This phone";
    case "tablet":
      return "This tablet";
    case "browser":
      return "This browser";
    default:
      return "This computer";
  }
}

/** True where there is no physical keyboard to press Ctrl+V on. */
export function isTouchDevice(isTauri: boolean): boolean {
  const kind = deviceKind(isTauri);
  return kind === "phone" || kind === "tablet";
}
