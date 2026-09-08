export interface DetectedLink {
  url: string;
  domain: string;
}

export function extractLinks(text: string): DetectedLink[] {
  if (!text) return [];

  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const found = new Map<string, DetectedLink>();
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    const rawUrl = match[1].replace(/[.,;:!?)]+$/, "");
    try {
      const parsed = new URL(rawUrl);
      const domain = parsed.hostname.replace(/^www\./, "");
      if (!found.has(rawUrl)) {
        found.set(rawUrl, {
          url: rawUrl,
          domain,
        });
      }
    } catch {
      // Ignore malformed URLs
    }
  }

  return Array.from(found.values());
}
