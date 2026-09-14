import { beforeEach, describe, expect, it } from 'vitest';
import { createAnchor, toLines } from '@/model/anchor';
import type { Annotation, Bookmark, FileEntry, Layer, Source } from '@/model/types';
import {
  deleteFile,
  deleteLayer,
  deleteSource,
  exportSource,
  getFile,
  getReadingPosition,
  getSource,
  listAnnotations,
  listBookmarks,
  listFiles,
  listLayers,
  listSources,
  putAnnotation,
  putBookmark,
  putFile,
  putLayer,
  putReadingPosition,
  putSource,
  deleteDatabase,
} from './index';

const lines = toLines('function a() {\n  return 1;\n}');

function source(id: string, lastOpenedAt = 1): Source {
  return { id, kind: 'github', name: `owner/${id}`, createdAt: 1, lastOpenedAt };
}

function file(id: string, sourceId: string, path = `${id}.ts`): FileEntry {
  return { id, sourceId, path, size: 10, edited: false, contentHash: 'h', updatedAt: 1 };
}

function layer(id: string, sourceId: string, order = 0): Layer {
  return { id, sourceId, name: id, visible: true, order, updatedAt: 1 };
}

function annotation(id: string, fileId: string, layerId: string): Annotation {
  return {
    id,
    fileId,
    layerId,
    kind: 'ink',
    anchor: createAnchor(lines, 1),
    geometry: { points: [{ x: 0, y: 0, p: 0.5 }], bbox: { x: 0, y: 0, w: 1, h: 1 } },
    style: { tool: 'pen', color: '#000', width: 2, opacity: 1 },
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 1,
  };
}

function bookmark(id: string, sourceId: string, fileId: string): Bookmark {
  return { id, sourceId, fileId, line: 1, anchor: createAnchor(lines, 1), createdAt: 1 };
}

beforeEach(async () => {
  // A fresh in-memory database per test, so ordering never matters. This has to close
  // the previous connection first — an open one blocks the delete indefinitely.
  await deleteDatabase();
});

describe('round trips', () => {
  it('stores and reads back every entity', async () => {
    await putSource(source('s1'));
    await putFile(file('f1', 's1'));
    await putLayer(layer('l1', 's1'));
    await putAnnotation(annotation('a1', 'f1', 'l1'));
    await putBookmark(bookmark('b1', 's1', 'f1'));
    await putReadingPosition({ fileId: 'f1', sourceId: 's1', line: 42, updatedAt: 1 });

    expect((await getSource('s1'))?.name).toBe('owner/s1');
    expect((await getFile('f1'))?.path).toBe('f1.ts');
    expect(await listLayers('s1')).toHaveLength(1);
    expect(await listAnnotations('f1')).toHaveLength(1);
    expect(await listBookmarks('s1')).toHaveLength(1);
    expect((await getReadingPosition('f1'))?.line).toBe(42);
  });

  it('preserves ink geometry and the anchor exactly', async () => {
    await putAnnotation(annotation('a1', 'f1', 'l1'));
    const [stored] = await listAnnotations('f1');

    expect(stored?.geometry?.points).toEqual([{ x: 0, y: 0, p: 0.5 }]);
    expect(stored?.anchor.contextBefore).toEqual(['function a() {']);
    expect(stored?.schemaVersion).toBe(1);
  });

  it('lists sources most recently opened first', async () => {
    await putSource(source('old', 100));
    await putSource(source('new', 300));
    await putSource(source('mid', 200));

    expect((await listSources()).map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });

  it('orders layers by their explicit order, not insertion', async () => {
    await putLayer(layer('third', 's1', 3));
    await putLayer(layer('first', 's1', 1));
    await putLayer(layer('second', 's1', 2));

    expect((await listLayers('s1')).map((l) => l.id)).toEqual(['first', 'second', 'third']);
  });

  it('scopes files to their source', async () => {
    await putFile(file('f1', 's1'));
    await putFile(file('f2', 's2'));

    expect(await listFiles('s1')).toHaveLength(1);
  });
});

describe('cascading deletes', () => {
  it('takes a file’s annotations, bookmarks and position with it', async () => {
    await putFile(file('f1', 's1'));
    await putAnnotation(annotation('a1', 'f1', 'l1'));
    await putBookmark(bookmark('b1', 's1', 'f1'));
    await putReadingPosition({ fileId: 'f1', sourceId: 's1', line: 9, updatedAt: 1 });

    await deleteFile('f1');

    expect(await getFile('f1')).toBeUndefined();
    expect(await listAnnotations('f1')).toHaveLength(0);
    expect(await listBookmarks('s1')).toHaveLength(0);
    expect(await getReadingPosition('f1')).toBeUndefined();
  });

  it('takes a layer’s annotations with it, but leaves other layers alone', async () => {
    await putLayer(layer('l1', 's1'));
    await putLayer(layer('l2', 's1'));
    await putAnnotation(annotation('a1', 'f1', 'l1'));
    await putAnnotation(annotation('a2', 'f1', 'l2'));

    await deleteLayer('l1');

    expect(await listLayers('s1')).toHaveLength(1);
    expect((await listAnnotations('f1')).map((a) => a.id)).toEqual(['a2']);
  });

  it('removes everything belonging to a deleted source', async () => {
    await putSource(source('s1'));
    await putFile(file('f1', 's1'));
    await putLayer(layer('l1', 's1'));
    await putAnnotation(annotation('a1', 'f1', 'l1'));
    await putBookmark(bookmark('b1', 's1', 'f1'));

    // A second source that must survive untouched.
    await putSource(source('s2'));
    await putFile(file('f2', 's2'));

    await deleteSource('s1');

    expect(await getSource('s1')).toBeUndefined();
    expect(await listFiles('s1')).toHaveLength(0);
    expect(await listLayers('s1')).toHaveLength(0);
    expect(await listAnnotations('f1')).toHaveLength(0);
    expect(await listBookmarks('s1')).toHaveLength(0);

    expect(await getSource('s2')).toBeDefined();
    expect(await listFiles('s2')).toHaveLength(1);
  });
});

describe('export', () => {
  it('captures everything a user wrote about one codebase', async () => {
    await putSource(source('s1'));
    await putFile(file('f1', 's1'));
    await putLayer(layer('l1', 's1'));
    await putAnnotation(annotation('a1', 'f1', 'l1'));
    await putBookmark(bookmark('b1', 's1', 'f1'));

    const dump = await exportSource('s1');

    expect(dump.formatVersion).toBe(1);
    expect(dump.source.id).toBe('s1');
    expect(dump.files).toHaveLength(1);
    expect(dump.layers).toHaveLength(1);
    expect(dump.annotations).toHaveLength(1);
    expect(dump.bookmarks).toHaveLength(1);
  });

  it('refuses to export a source that does not exist', async () => {
    await expect(exportSource('nope')).rejects.toThrow(/No such source/);
  });
});
