/**
 * Persistence.
 *
 * One IndexedDB database, one object store per entity in the data model. IndexedDB is the
 * only browser store that can hold a repository's worth of text, and `idb` is a thin
 * promise wrapper over it rather than an ORM — the schema below is the whole abstraction.
 *
 * Two rules this module exists to enforce:
 *
 *   - No viewport state is ever written. A reading position is a line number.
 *   - Every record is exportable, because export-to-JSON is the backstop for every
 *     storage risk (eviction, quota, a browser that forgets).
 */

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Annotation,
  Bookmark,
  FileEntry,
  FsHandleRecord,
  Layer,
  MetaRecord,
  ReadingPosition,
  Source,
} from '@/model/types';

const DB_NAME = 'annotatecode';
const DB_VERSION = 1;

interface AnnotateCodeDB extends DBSchema {
  sources: { key: string; value: Source };
  files: {
    key: string;
    value: FileEntry;
    indexes: { 'by-source': string; 'by-source-path': [string, string] };
  };
  layers: { key: string; value: Layer; indexes: { 'by-source': string } };
  annotations: {
    key: string;
    value: Annotation;
    indexes: { 'by-file': string; 'by-layer': string };
  };
  bookmarks: {
    key: string;
    value: Bookmark;
    indexes: { 'by-source': string; 'by-file': string };
  };
  readingPositions: { key: string; value: ReadingPosition; indexes: { 'by-source': string } };
  fsHandles: { key: string; value: FsHandleRecord };
  meta: { key: string; value: MetaRecord };
}

let dbPromise: Promise<IDBPDatabase<AnnotateCodeDB>> | null = null;

export function db(): Promise<IDBPDatabase<AnnotateCodeDB>> {
  dbPromise ??= openDB<AnnotateCodeDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      // Migrations are additive and keyed off `oldVersion`; each version's block runs for
      // every database older than it.
      if (oldVersion < 1) {
        database.createObjectStore('sources', { keyPath: 'id' });

        const files = database.createObjectStore('files', { keyPath: 'id' });
        files.createIndex('by-source', 'sourceId');
        files.createIndex('by-source-path', ['sourceId', 'path'], { unique: true });

        const layers = database.createObjectStore('layers', { keyPath: 'id' });
        layers.createIndex('by-source', 'sourceId');

        const annotations = database.createObjectStore('annotations', { keyPath: 'id' });
        annotations.createIndex('by-file', 'fileId');
        annotations.createIndex('by-layer', 'layerId');

        const bookmarks = database.createObjectStore('bookmarks', { keyPath: 'id' });
        bookmarks.createIndex('by-source', 'sourceId');
        bookmarks.createIndex('by-file', 'fileId');

        const positions = database.createObjectStore('readingPositions', { keyPath: 'fileId' });
        positions.createIndex('by-source', 'sourceId');

        database.createObjectStore('fsHandles', { keyPath: 'key' });
        database.createObjectStore('meta', { keyPath: 'key' });
      }
    },
  });
  return dbPromise;
}

/**
 * Release the connection. An open connection blocks both `deleteDatabase` and any future
 * version upgrade, so anything that wants to tear the database down has to come through
 * here first.
 */
export async function closeDb(): Promise<void> {
  const open = dbPromise;
  dbPromise = null;
  if (open) (await open).close();
}

/** Drops the database entirely. Used by tests, and by "forget everything" in settings. */
export async function deleteDatabase(): Promise<void> {
  await closeDb();
  await deleteDB(DB_NAME);
}

/**
 * Ask the browser not to evict this origin's storage. Called on the first write of a
 * session; a user's handwritten annotations should not disappear under storage pressure.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function storageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function putSource(source: Source): Promise<void> {
  await (await db()).put('sources', source);
}

export async function getSource(id: string): Promise<Source | undefined> {
  return (await db()).get('sources', id);
}

/** Most recently opened first — this is the "recent sources" list on /app. */
export async function listSources(): Promise<Source[]> {
  const all = await (await db()).getAll('sources');
  return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

/** Removes a source and everything anchored to it. */
export async function deleteSource(sourceId: string): Promise<void> {
  const database = await db();
  const files = await database.getAllFromIndex('files', 'by-source', sourceId);

  const tx = database.transaction(
    ['sources', 'files', 'layers', 'annotations', 'bookmarks', 'readingPositions'],
    'readwrite',
  );

  for (const file of files) {
    const annotations = await tx.objectStore('annotations').index('by-file').getAllKeys(file.id);
    for (const key of annotations) await tx.objectStore('annotations').delete(key);
    await tx.objectStore('files').delete(file.id);
    await tx.objectStore('readingPositions').delete(file.id);
  }

  for (const store of ['layers', 'bookmarks'] as const) {
    const keys = await tx.objectStore(store).index('by-source').getAllKeys(sourceId);
    for (const key of keys) await tx.objectStore(store).delete(key);
  }

  await tx.objectStore('sources').delete(sourceId);
  await tx.done;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function putFile(file: FileEntry): Promise<void> {
  await (await db()).put('files', file);
}

export async function putFiles(files: FileEntry[]): Promise<void> {
  const tx = (await db()).transaction('files', 'readwrite');
  await Promise.all([...files.map((f) => tx.store.put(f)), tx.done]);
}

export async function getFile(id: string): Promise<FileEntry | undefined> {
  return (await db()).get('files', id);
}

export async function listFiles(sourceId: string): Promise<FileEntry[]> {
  return (await db()).getAllFromIndex('files', 'by-source', sourceId);
}

export async function deleteFile(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['files', 'annotations', 'bookmarks', 'readingPositions'], 'readwrite');

  const annotationKeys = await tx.objectStore('annotations').index('by-file').getAllKeys(id);
  for (const key of annotationKeys) await tx.objectStore('annotations').delete(key);

  const bookmarkKeys = await tx.objectStore('bookmarks').index('by-file').getAllKeys(id);
  for (const key of bookmarkKeys) await tx.objectStore('bookmarks').delete(key);

  await tx.objectStore('readingPositions').delete(id);
  await tx.objectStore('files').delete(id);
  await tx.done;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export async function putLayer(layer: Layer): Promise<void> {
  await (await db()).put('layers', layer);
}

export async function listLayers(sourceId: string): Promise<Layer[]> {
  const layers = await (await db()).getAllFromIndex('layers', 'by-source', sourceId);
  return layers.sort((a, b) => a.order - b.order);
}

export async function deleteLayer(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['layers', 'annotations'], 'readwrite');
  const keys = await tx.objectStore('annotations').index('by-layer').getAllKeys(id);
  for (const key of keys) await tx.objectStore('annotations').delete(key);
  await tx.objectStore('layers').delete(id);
  await tx.done;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/** Called on stroke end — never per pointer event. */
export async function putAnnotation(annotation: Annotation): Promise<void> {
  await (await db()).put('annotations', annotation);
}

export async function listAnnotations(fileId: string): Promise<Annotation[]> {
  return (await db()).getAllFromIndex('annotations', 'by-file', fileId);
}

export async function deleteAnnotation(id: string): Promise<void> {
  await (await db()).delete('annotations', id);
}

export async function deleteAnnotations(ids: string[]): Promise<void> {
  const tx = (await db()).transaction('annotations', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export async function putBookmark(bookmark: Bookmark): Promise<void> {
  await (await db()).put('bookmarks', bookmark);
}

export async function listBookmarks(sourceId: string): Promise<Bookmark[]> {
  return (await db()).getAllFromIndex('bookmarks', 'by-source', sourceId);
}

export async function deleteBookmark(id: string): Promise<void> {
  await (await db()).delete('bookmarks', id);
}

// ---------------------------------------------------------------------------
// Reading position
// ---------------------------------------------------------------------------

export async function putReadingPosition(position: ReadingPosition): Promise<void> {
  await (await db()).put('readingPositions', position);
}

export async function getReadingPosition(fileId: string): Promise<ReadingPosition | undefined> {
  return (await db()).get('readingPositions', fileId);
}

/**
 * The file this source was last read in. Resolved through the by-source index rather than
 * by asking about every file — a 5,000-file repository must not cost 5,000 lookups just
 * to work out where to land.
 */
export async function latestReadingPosition(
  sourceId: string,
): Promise<ReadingPosition | undefined> {
  const all = await (await db()).getAllFromIndex('readingPositions', 'by-source', sourceId);
  return all.reduce<ReadingPosition | undefined>(
    (best, p) => (!best || p.updatedAt > best.updatedAt ? p : best),
    undefined,
  );
}

// ---------------------------------------------------------------------------
// File System Access handles
// ---------------------------------------------------------------------------

export async function putFsHandle(record: FsHandleRecord): Promise<void> {
  await (await db()).put('fsHandles', record);
}

export async function getFsHandle(key: string): Promise<FsHandleRecord | undefined> {
  return (await db()).get('fsHandles', key);
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const record = await (await db()).get('meta', key);
  return record?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', { key, value });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface SourceExport {
  formatVersion: 1;
  exportedAt: number;
  source: Source;
  files: FileEntry[];
  layers: Layer[];
  annotations: Annotation[];
  bookmarks: Bookmark[];
}

/**
 * The escape hatch. Everything a user has written about one codebase, in a file they own.
 * It costs almost nothing and it is the answer to every storage risk.
 */
export async function exportSource(sourceId: string): Promise<SourceExport> {
  const source = await getSource(sourceId);
  if (!source) throw new Error(`No such source: ${sourceId}`);

  const files = await listFiles(sourceId);
  const annotations = (
    await Promise.all(files.map((f) => listAnnotations(f.id)))
  ).flat();

  return {
    formatVersion: 1,
    exportedAt: Date.now(),
    source,
    files,
    layers: await listLayers(sourceId),
    annotations,
    bookmarks: await listBookmarks(sourceId),
  };
}
