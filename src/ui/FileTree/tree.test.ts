import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@/model/types';
import { ancestorsOf, buildTree, flatten, initialExpanded } from './tree';

function entries(...paths: string[]): FileEntry[] {
  return paths.map((path, i) => ({
    id: `f${i}`,
    sourceId: 's',
    path,
    size: 0,
    edited: false,
    contentHash: '',
    updatedAt: 0,
  }));
}

/** A compact view of a tree, for assertions that read like the thing they describe. */
function shape(nodes: ReturnType<typeof buildTree>, depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.name}${n.kind === 'dir' ? '/' : ''}`,
    ...(n.children ? shape(n.children, depth + 1) : []),
  ]);
}

describe('buildTree', () => {
  it('nests paths into directories', () => {
    const tree = buildTree(entries('src/a.ts', 'src/b.ts', 'README.md'));

    expect(shape(tree)).toEqual(['src/', '  a.ts', '  b.ts', 'README.md']);
  });

  it('creates each intermediate directory exactly once', () => {
    const tree = buildTree(entries('a/b/c/one.ts', 'a/b/c/two.ts', 'a/b/three.ts'));

    expect(shape(tree)).toEqual(['a/', '  b/', '    c/', '      one.ts', '      two.ts', '    three.ts']);
  });

  it('puts directories before files, then sorts alphabetically', () => {
    const tree = buildTree(entries('zeta.ts', 'alpha.ts', 'beta/x.ts', 'Alpha/y.ts'));

    expect(shape(tree).filter((l) => !l.startsWith(' '))).toEqual([
      'Alpha/',
      'beta/',
      'alpha.ts',
      'zeta.ts',
    ]);
  });

  it('sorts numerically, so step10 comes after step2', () => {
    const tree = buildTree(entries('step2.ts', 'step10.ts', 'step1.ts'));

    expect(tree.map((n) => n.name)).toEqual(['step1.ts', 'step2.ts', 'step10.ts']);
  });

  it('keeps the same filename at different depths apart', () => {
    const tree = buildTree(entries('a/index.ts', 'b/index.ts'));

    expect(tree.flatMap((n) => n.children!.map((c) => c.path))).toEqual([
      'a/index.ts',
      'b/index.ts',
    ]);
  });

  it('carries the file id through, so a row can open a file', () => {
    const tree = buildTree(entries('src/a.ts'));

    expect(tree[0]!.children![0]!.fileId).toBe('f0');
    expect(tree[0]!.fileId).toBeUndefined();
  });

  it('handles an empty source', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('ignores a path that is nothing but slashes', () => {
    expect(buildTree(entries('///'))).toEqual([]);
  });
});

describe('flatten', () => {
  const tree = buildTree(entries('src/deep/a.ts', 'src/b.ts', 'README.md'));

  it('shows only top-level rows when nothing is expanded', () => {
    expect(flatten(tree, new Set()).map((r) => r.node.name)).toEqual(['src', 'README.md']);
  });

  it('reveals children of an expanded directory', () => {
    const rows = flatten(tree, new Set(['src']));

    expect(rows.map((r) => r.node.name)).toEqual(['src', 'deep', 'b.ts', 'README.md']);
  });

  it('reports depth for indentation', () => {
    const rows = flatten(tree, new Set(['src', 'src/deep']));

    expect(rows.map((r) => [r.node.name, r.depth])).toEqual([
      ['src', 0],
      ['deep', 1],
      ['a.ts', 2],
      ['b.ts', 1],
      ['README.md', 0],
    ]);
  });

  it('does not reveal a grandchild whose parent is collapsed', () => {
    const rows = flatten(tree, new Set(['src/deep']));

    expect(rows.map((r) => r.node.name)).toEqual(['src', 'README.md']);
  });
});

describe('initialExpanded', () => {
  it('walks down a single-directory chain so the tree opens at something useful', () => {
    const tree = buildTree(entries('src/main/java/App.java', 'src/main/java/Util.java'));

    expect([...initialExpanded(tree)]).toEqual(['src', 'src/main', 'src/main/java']);
  });

  it('stops as soon as there is a real choice', () => {
    const tree = buildTree(entries('src/a.ts', 'test/b.ts'));

    expect([...initialExpanded(tree)]).toEqual([]);
  });

  it('stops when a directory also contains a file', () => {
    const tree = buildTree(entries('src/deep/a.ts', 'src/b.ts'));

    expect([...initialExpanded(tree)]).toEqual(['src']);
  });

  it('handles an empty tree', () => {
    expect([...initialExpanded([])]).toEqual([]);
  });
});

describe('ancestorsOf', () => {
  it('lists every directory on the way to a file', () => {
    expect(ancestorsOf('a/b/c/file.ts')).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('is empty for a file at the root', () => {
    expect(ancestorsOf('file.ts')).toEqual([]);
  });
});
