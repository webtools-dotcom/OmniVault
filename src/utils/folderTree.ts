import { Folder, FolderTreeNode } from "../types";

/**
 * Builds a hierarchical folder tree structure from a flat array of folders.
 */
export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  const activeFolders = folders.filter((f) => !f.is_deleted);
  const nodeMap = new Map<string, FolderTreeNode>();

  // Create node wrappers
  for (const folder of activeFolders) {
    nodeMap.set(folder.id, {
      folder,
      children: [],
      depth: 0,
    });
  }

  const rootNodes: FolderTreeNode[] = [];

  // Wire children and roots
  for (const folder of activeFolders) {
    const node = nodeMap.get(folder.id)!;
    if (folder.parent_id && nodeMap.has(folder.parent_id)) {
      const parentNode = nodeMap.get(folder.parent_id)!;
      parentNode.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Calculate depths and sort alphabetically
  function assignDepthAndSort(nodes: FolderTreeNode[], depth: number) {
    nodes.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    for (const node of nodes) {
      node.depth = depth;
      assignDepthAndSort(node.children, depth + 1);
    }
  }

  assignDepthAndSort(rootNodes, 0);
  return rootNodes;
}

/**
 * Returns the ordered path of folders from root down to the specified folder.
 */
export function getFolderPath(folderId: string, folders: Folder[]): Folder[] {
  const folderMap = new Map<string, Folder>(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  const visited = new Set<string>();

  let currentId: string | null = folderId;
  while (currentId && folderMap.has(currentId) && !visited.has(currentId)) {
    visited.add(currentId);
    const item: Folder | undefined = folderMap.get(currentId);
    if (!item) break;
    path.unshift(item);
    currentId = item.parent_id;
  }

  return path;
}

/**
 * Returns true if potentialDescendantId is equal to folderId or is a descendant of folderId.
 * Used to prevent circular references when moving folders.
 */
export function isSelfOrDescendant(
  folderId: string,
  potentialDescendantId: string | null,
  folders: Folder[],
): boolean {
  if (!potentialDescendantId) return false;
  if (folderId === potentialDescendantId) return true;

  const folderMap = new Map<string, Folder>(folders.map((f) => [f.id, f]));
  const visited = new Set<string>();

  let currentId: string | null = potentialDescendantId;
  while (currentId && folderMap.has(currentId) && !visited.has(currentId)) {
    visited.add(currentId);
    if (currentId === folderId) return true;
    const item: Folder | undefined = folderMap.get(currentId);
    if (!item) break;
    currentId = item.parent_id;
  }

  return false;
}
