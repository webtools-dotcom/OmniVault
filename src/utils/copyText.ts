/**
 * What a note is worth pasting somewhere else.
 *
 * This exists because the round trip the app is for does not end at sync. A
 * note captured on a phone is usually on its way to something else on the
 * computer — a chat with an AI tool, a document, a terminal — and until there
 * was a copy button the only way to get the text out was to open the note,
 * select it by hand and copy.
 *
 * The title is included only when it is not already the opening of the body.
 * A quick capture turns its first line into the title, so repeating it would
 * paste a duplicated first line every time, which is exactly the case this is
 * used for most. See D-081.
 */
export function copyableText(title: string, content: string): string {
  const t = (title || "").trim();
  const c = (content || "").trim();
  if (!c) return t;
  if (!t) return c;
  const firstLine = c.split("\n", 1)[0].trim();
  if (firstLine === t || c.startsWith(t)) return c;
  return `${t}\n\n${c}`;
}
