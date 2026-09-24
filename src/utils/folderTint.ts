/**
 * Folder colours: a small, low-chroma set so a folder mark never competes with
 * the note beside it. Colours saved before this palette map to the nearest one.
 */
export const FOLDER_TINTS = ["#7E9E86", "#7D8CA8", "#9E86A0"] as const;

export type FolderTint = (typeof FOLDER_TINTS)[number];

/** Stable per folder, so a folder keeps the same mark across devices. */
export function folderTint(folder: { id: string; color?: string | null }): FolderTint {
  const stored = folder.color?.toUpperCase();
  const exact = FOLDER_TINTS.find((t) => t.toUpperCase() === stored);
  if (exact) return exact;

  let hash = 0;
  for (let i = 0; i < folder.id.length; i += 1) {
    hash = (hash * 31 + folder.id.charCodeAt(i)) >>> 0;
  }
  return FOLDER_TINTS[hash % FOLDER_TINTS.length];
}
