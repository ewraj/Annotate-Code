/**
 * The local adapter.
 *
 * Two ways in, because no single API works everywhere:
 *
 *   - `showDirectoryPicker()` (Chromium) gives a real directory handle that can be
 *     persisted, so a returning user re-grants access with one click instead of
 *     re-picking the folder. This is also the path that Phase 3 will write through.
 *   - `<input webkitdirectory>` (Firefox, Safari) gives a one-off snapshot of File
 *     objects. Readable, never writable, gone when the tab closes unless cached.
 *
 * Neither works on iOS Safari. That is why Phase 1 leads with GitHub — on an iPad, which
 * is the product's flagship scenario, a local-only reader could not run at all.
 */

import type { FileEntry, Source } from '@/model/types';
import { looksBinary, shouldSkip, summariseSkips, type SkipReason } from './filters';
import { SourceError, type OpenResult, type SourceAdapter } from './types';

export function supportsDirectoryPicker(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** Directories whose contents we never even walk into — the big win on a local project. */
function skipWholeDirectory(name: string): boolean {
  return shouldSkip(`${name}/x`).skipped;
}

type Blobs = Map<string, { file?: File; handle?: FileSystemFileHandle }>;

interface Collected {
  files: FileEntry[];
  blobs: Blobs;
  skips: Map<SkipReason['reason'], number>;
}

function collect(
  sourceId: string,
  entries: Array<{ path: string; size: number; file?: File; handle?: FileSystemFileHandle }>,
): Collected {
  const now = Date.now();
  const files: FileEntry[] = [];
  const blobs: Blobs = new Map();
  const skips = new Map<SkipReason['reason'], number>();

  for (const entry of entries) {
    const verdict = shouldSkip(entry.path, entry.size);
    if (verdict.skipped) {
      skips.set(verdict.reason, (skips.get(verdict.reason) ?? 0) + 1);
      continue;
    }

    const id = `${sourceId}:${entry.path}`;
    files.push({
      id,
      sourceId,
      path: entry.path,
      size: entry.size,
      edited: false,
      contentHash: '',
      updatedAt: now,
    });
    blobs.set(id, entry.handle ? { handle: entry.handle } : { file: entry.file! });
  }

  return { files, blobs, skips };
}

function finish(source: Source, collected: Collected): OpenResult & { blobs: Blobs } {
  if (collected.files.length === 0) {
    throw new SourceError(
      'Nothing to read in that folder.',
      'Every file was binary, generated, or in an ignored folder.',
    );
  }

  const warnings: string[] = [];
  const skipped = summariseSkips(collected.skips);
  if (skipped) warnings.push(skipped);

  return { source, files: collected.files, warnings, blobs: collected.blobs };
}

/**
 * Walk a directory handle we already hold — on a first pick, and again on every reopen.
 * Re-walking rather than trusting the stored tree is deliberate: files on disk change
 * between visits, and a stale tree would show the user a codebase that no longer exists.
 */
export async function walkDirectory(
  root: FileSystemDirectoryHandle,
  source: Source,
): Promise<OpenResult & { blobs: Blobs }> {
  const entries: Array<{ path: string; size: number; handle: FileSystemFileHandle }> = [];

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    // `entries()` is typed as yielding the FileSystemHandle base, which `kind` does not
    // narrow, so each branch asserts the concrete handle type it has already checked for.
    for await (const [name, handle] of dir.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;

      if (handle.kind === 'directory') {
        if (skipWholeDirectory(name)) continue;
        await walk(handle as FileSystemDirectoryHandle, path);
        continue;
      }

      // Cheap pre-filter before paying for getFile(), which stats the file.
      if (shouldSkip(path).skipped) continue;

      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      entries.push({ path, size: file.size, handle: fileHandle });
    }
  }

  await walk(root, '');
  return finish(source, collect(source.id, entries));
}

/** Chromium: a real, persistable directory handle. */
export async function openDirectoryPicker(): Promise<OpenResult & { blobs: Blobs; handle: FileSystemDirectoryHandle }> {
  const picker = (globalThis as {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;

  if (!picker) {
    throw new SourceError(
      'This browser cannot open a folder.',
      'Chrome or Edge on desktop can. Everywhere else, open a GitHub repository instead.',
    );
  }

  let root: FileSystemDirectoryHandle;
  try {
    root = await picker({ mode: 'readwrite' });
  } catch (error) {
    // The user dismissing the picker is not an error worth reporting.
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new SourceError('Cancelled.');
    }
    throw error;
  }

  const now = Date.now();
  // Keyed by folder name alone, so reopening the same folder returns to the same
  // annotations rather than starting a second, identical-looking codebase.
  const sourceId = `local:${root.name}`;
  const source: Source = {
    id: sourceId,
    kind: 'local-fs',
    name: root.name,
    fsHandleKey: sourceId,
    createdAt: now,
    lastOpenedAt: now,
  };

  return { ...(await walkDirectory(root, source)), handle: root };
}

/** Everywhere else: a read-only snapshot from `<input webkitdirectory>`. */
export function openFileList(list: FileList): OpenResult & { blobs: Blobs } {
  const all = Array.from(list);
  if (all.length === 0) throw new SourceError('That folder is empty.');

  // webkitRelativePath includes the chosen folder as its first segment.
  const rootName = (all[0]!.webkitRelativePath || all[0]!.name).split('/')[0] ?? 'folder';

  const entries = all.map((file) => ({
    path: (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name,
    size: file.size,
    file,
  }));

  const now = Date.now();
  const sourceId = `local:${rootName}`;
  const source: Source = {
    id: sourceId,
    kind: 'local-upload',
    name: rootName,
    createdAt: now,
    lastOpenedAt: now,
  };

  return finish(source, collect(sourceId, entries));
}

export class LocalAdapter implements SourceAdapter {
  private readonly cache = new Map<string, string>();

  /**
   * Present only when this source can actually write back.
   *
   * A picked directory hands us live handles and `showDirectoryPicker({ mode: 'readwrite' })`
   * already asked for permission. An uploaded folder gives `File` objects, which are
   * snapshots with nowhere to write to — so the method is genuinely absent there, and the
   * caching wrapper reads that absence as "keep the edit as a local overlay" rather than
   * having to catch an error and guess what it meant.
   */
  writeFile?: (id: string, text: string) => Promise<void>;

  constructor(
    readonly source: Source,
    private readonly files: FileEntry[],
    private readonly blobs: Blobs,
  ) {
    if (source.kind === 'local-fs') this.writeFile = this.writeThrough.bind(this);
  }

  private async writeThrough(id: string, text: string): Promise<void> {
    const handle = this.blobs.get(id)?.handle;
    if (!handle) throw new SourceError(`${this.pathOf(id)} is no longer connected.`);

    const writable = await handle.createWritable();
    try {
      await writable.write(text);
    } finally {
      await writable.close();
    }

    this.cache.set(id, text);
  }

  async listFiles(): Promise<FileEntry[]> {
    return this.files;
  }

  async readFile(id: string): Promise<string> {
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;

    const entry = this.blobs.get(id);
    if (!entry) throw new SourceError('That file is no longer available.');

    const file = entry.file ?? (await entry.handle!.getFile());
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Extension filtering catches most binaries; this catches the rest, and it is the
    // only check that can be certain.
    if (looksBinary(bytes)) {
      throw new SourceError(`${this.pathOf(id)} is a binary file.`, 'There is nothing to read.');
    }

    const text = new TextDecoder('utf-8').decode(bytes);
    this.cache.set(id, text);
    return text;
  }

  private pathOf(id: string): string {
    return this.files.find((f) => f.id === id)?.path ?? 'That file';
  }
}
