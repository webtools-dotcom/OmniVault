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

/**
 * A note's Markdown as the plain lines a card preview shows: markers removed,
 * heading-only lines dropped when there is anything else to show.
 */
export function previewText(content: string): string {
  const lines = (content || "")
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .map((line) => {
      const heading = /^\s{0,3}#{1,6}\s+/.test(line);
      const text = line
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, "")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
        .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
        .trim();
      return { heading, text };
    })
    .filter((l) => l.text);
  const body = lines.filter((l) => !l.heading);
  return (body.length ? body : lines).map((l) => l.text).join("\n");
}
