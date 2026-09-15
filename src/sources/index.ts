/**
 * Opening and reopening sources.
 *
 * Two jobs live here. The first is turning a user's gesture — a pasted URL, a picked
 * folder — into a persisted `Source` plus an adapter. The second is the caching layer
 * that makes reopening cheap.
 *
 * Content is cached in IndexedDB on first read, never eagerly. That single decision
 * gives us three things at once: a repository opened yesterday reads instantly, a
 * rate-limited user can still read what they have already seen, and the annotations
 * attached to a file always have the exact text they were anchored against.
 */

import { hashText } from '@/model/anchor';
import type { FileEntry, Source } from '@/model/types';
import {
  deleteSource,
  getFile,
  getFsHandle,
  listFiles,
  listSources,
  putFile,
  putFiles,
  putFsHandle,
  putSource,
  requestPersistence,
} from '@/db';
import { GithubAdapter, openGithubSource } from './github';
import {
  LocalAdapter,
  openDirectoryPicker,
  openFileList,
  supportsDirectoryPicker,
  walkDirectory,
} from './local';
import { SourceError, type OpenResult, type SourceAdapter } from './types';

export { SourceError, supportsDirectoryPicker };
export type { SourceAdapter };

/**
 * Serves stored content when there is any, and writes through when there is not.
 *
 * Wrapping rather than teaching each adapter to cache keeps the adapters honest: they
 * describe where code comes from, and nothing else.
 */
class CachingAdapter implements SourceAdapter {
  constructor(
    readonly source: Source,
    private readonly inner: SourceAdapter,
  ) {}

  listFiles(): Promise<FileEntry[]> {
    return this.inner.listFiles();
  }

  async readFile(id: string): Promise<string> {
    const stored = await getFile(id);
    if (stored?.content !== undefined) return stored.content;

    const text = await this.inner.readFile(id);

    if (stored) {
      await putFile({ ...stored, content: text, contentHash: hashText(text), updatedAt: Date.now() });
    }
    return text;
  }
}

/**
 * The adapter for a source reopened from a previous session with no live backing — an
 * uploaded folder, whose File handles died with the tab. Whatever was read then is still
 * readable now; the rest needs the folder again.
 */
class StoredAdapter implements SourceAdapter {
  constructor(
    readonly source: Source,
    private readonly files: FileEntry[],
  ) {}

  async listFiles(): Promise<FileEntry[]> {
    return this.files;
  }

  async readFile(id: string): Promise<string> {
    const stored = await getFile(id);
    if (stored?.content !== undefined) return stored.content;

    throw new SourceError(
      'This file was never opened, and the folder is no longer connected.',
      'Open the folder again to read the rest of it.',
    );
  }
}

async function persist(result: OpenResult): Promise<void> {
  await requestPersistence();
  await putSource(result.source);

  // Preserve content already cached for these ids from a previous open.
  const existing = new Map((await listFiles(result.source.id)).map((f) => [f.id, f]));
  await putFiles(
    result.files.map((file) => {
      const previous = existing.get(file.id);
      return previous?.content !== undefined
        ? { ...file, content: previous.content, contentHash: previous.contentHash }
        : file;
    }),
  );
}

export interface Opened {
  source: Source;
  files: FileEntry[];
  adapter: SourceAdapter;
  warnings: string[];
}

export async function openGithub(url: string): Promise<Opened> {
  const result = await openGithubSource(url);
  await persist(result);

  return {
    source: result.source,
    files: result.files,
    warnings: result.warnings,
    adapter: new CachingAdapter(result.source, new GithubAdapter(result.source, result.files)),
  };
}

export async function openFolder(): Promise<Opened> {
  const result = await openDirectoryPicker();
  await persist(result);
  await putFsHandle({ key: result.source.id, handle: result.handle });

  return {
    source: result.source,
    files: result.files,
    warnings: result.warnings,
    adapter: new CachingAdapter(
      result.source,
      new LocalAdapter(result.source, result.files, result.blobs),
    ),
  };
}

export async function openUpload(list: FileList): Promise<Opened> {
  const result = openFileList(list);
  await persist(result);

  return {
    source: result.source,
    files: result.files,
    warnings: result.warnings,
    adapter: new CachingAdapter(
      result.source,
      new LocalAdapter(result.source, result.files, result.blobs),
    ),
  };
}

/**
 * Reopen something from the recents list.
 *
 * GitHub sources come back whole, offline included — the tree is stored and content is
 * cached. A folder picked with the File System Access API comes back after a one-click
 * permission re-grant. An uploaded folder comes back only as far as it was read.
 */
export async function reopen(source: Source): Promise<Opened> {
  const files = await listFiles(source.id);
  if (files.length === 0) {
    throw new SourceError('That codebase is no longer stored.', 'Open it again to read it.');
  }

  const touched: Source = { ...source, lastOpenedAt: Date.now() };
  await putSource(touched);

  if (source.kind === 'github') {
    return {
      source: touched,
      files,
      warnings: [],
      adapter: new CachingAdapter(touched, new GithubAdapter(touched, files)),
    };
  }

  if (source.kind === 'local-fs' && source.fsHandleKey) {
    const record = await getFsHandle(source.fsHandleKey);
    if (record) {
      const handle = record.handle as FileSystemDirectoryHandle & {
        queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
        requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
      };

      let state = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
      if (state === 'prompt') {
        state = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
      }

      if (state === 'granted') {
        // Re-walk rather than trust the stored tree: files change on disk between visits.
        const fresh = await walkDirectory(handle, touched);
        await persist({ source: touched, files: fresh.files, warnings: fresh.warnings });
        return {
          source: touched,
          files: fresh.files,
          warnings: fresh.warnings,
          adapter: new CachingAdapter(
            touched,
            new LocalAdapter(touched, fresh.files, fresh.blobs),
          ),
        };
      }
    }
  }

  return {
    source: touched,
    files,
    warnings: [
      source.kind === 'local-fs'
        ? 'Reading from what was saved — grant access to the folder again to see current files.'
        : 'Reading from what was saved. Files never opened are not available until you pick the folder again.',
    ],
    adapter: new StoredAdapter(touched, files),
  };
}

export async function recentSources(): Promise<Source[]> {
  return listSources();
}

export async function forgetSource(sourceId: string): Promise<void> {
  await deleteSource(sourceId);
}
