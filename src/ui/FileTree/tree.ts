/**
 * Turning a flat list of paths into a tree, and a tree into rows.
 *
 * Kept separate from the component and free of React on purpose: this is the part with
 * edge cases (deep nesting, duplicate names at different depths, files and directories
 * sharing a name), and it is far easier to test as a function than as a rendered list.
 *
 * `flatten` produces exactly the rows that are visible given what is expanded, which is
 * what makes windowed rendering possible — the list component never walks the tree.
 */

import type { FileEntry } from '@/model/types';

export interface TreeNode {
  name: string;
  /** Full path from the source root. Also the identity used for expansion state. */
  path: string;
  kind: 'dir' | 'file';
  /** Files only. */
  fileId?: string;
  /** Directories only, always sorted. */
  children?: TreeNode[];
}

export interface Row {
  node: TreeNode;
  depth: number;
}

/** Directories before files, then case-insensitive alphabetical. Standard, and expected. */
function compare(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] };
  // Index by path so intermediate directories are created exactly once.
  const dirs = new Map<string, TreeNode>([['', root]]);

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    if (segments.length === 0) continue;

    let parent = root;
    let prefix = '';

    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!;
      prefix = prefix ? `${prefix}/${name}` : name;

      let dir = dirs.get(prefix);
      if (!dir) {
        dir = { name, path: prefix, kind: 'dir', children: [] };
        dirs.set(prefix, dir);
        parent.children!.push(dir);
      }
      parent = dir;
    }

    const name = segments[segments.length - 1]!;
    parent.children!.push({
      name,
      path: file.path,
      kind: 'file',
      fileId: file.id,
    });
  }

  sortInPlace(root);
  return root.children!;
}

function sortInPlace(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort(compare);
  for (const child of node.children) sortInPlace(child);
}

/** The rows currently on screen, in order. */
export function flatten(nodes: TreeNode[], expanded: ReadonlySet<string>, depth = 0): Row[] {
  const rows: Row[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === 'dir' && expanded.has(node.path) && node.children) {
      rows.push(...flatten(node.children, expanded, depth + 1));
    }
  }
  return rows;
}

/**
 * A sensible starting state: walk down while there is exactly one directory and nothing
 * else, so a repository wrapped in `src/main/java/...` opens at something useful rather
 * than at a column of single arrows. Stops as soon as there is a real choice to make.
 */
export function initialExpanded(nodes: TreeNode[]): Set<string> {
  const expanded = new Set<string>();
  let level = nodes;

  while (level.length === 1 && level[0]!.kind === 'dir') {
    expanded.add(level[0]!.path);
    level = level[0]!.children ?? [];
  }

  return expanded;
}

/** Every directory on the way to a file, so that revealing it actually reveals it. */
export function ancestorsOf(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  const out: string[] = [];
  let prefix = '';
  for (let i = 0; i < segments.length - 1; i++) {
    prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]!;
    out.push(prefix);
  }
  return out;
}
