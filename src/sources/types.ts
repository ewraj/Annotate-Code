/**
 * Source adapters.
 *
 * Everything upstream of the reader speaks this interface, so the reader never knows
 * whether it is looking at a GitHub repository, a folder on disk, or a scratch file. Four
 * implementations, one shape.
 *
 * `listFiles` returns metadata only. Content is fetched lazily per file and cached — a
 * 5,000-file repository must reach a visible tree without loading a single byte of source.
 */

import type { FileEntry, Source } from '@/model/types';

export interface SourceAdapter {
  readonly source: Source;

  /** The tree. Metadata only — never content. */
  listFiles(): Promise<FileEntry[]>;

  /** Lazy, cached. */
  readFile(id: string): Promise<string>;

  // Phase 3. Adapters that cannot write simply do not implement these.
  writeFile?(id: string, text: string): Promise<void>;
  createFile?(path: string): Promise<FileEntry>;
  deleteFile?(id: string): Promise<void>;
  renameFile?(id: string, path: string): Promise<void>;
}

export interface OpenResult {
  source: Source;
  files: FileEntry[];
  /**
   * Things the user should know but that are not failures — a truncated tree, files
   * skipped for being binary or enormous. Shown once, in the tree header.
   */
  warnings: string[];
}

/**
 * A failure with a message worth showing verbatim. Anything the user can act on — a typo
 * in a URL, a private repository, an exhausted rate limit — should arrive as one of these
 * rather than as a stack trace.
 */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
