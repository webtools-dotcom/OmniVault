/**
 * The text to put on the clipboard for a note. The title is included only
 * when the body does not already start with it, which is the usual shape of a
 * quick capture.
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
