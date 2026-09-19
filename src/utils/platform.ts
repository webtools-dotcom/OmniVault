/**
 * What kind of machine this is, for wording rather than layout.
 *
 * The sidebar used the responsive `isMobile` flag to choose between "This
 * tablet" and "This computer", so a tablet in landscape — wide enough to get
 * the desktop layout — called itself a computer. Layout breakpoints answer
 * "how much room is there", which is a different question from "what am I".
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
