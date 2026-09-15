/**
 * What is open right now.
 *
 * One codebase, one file, one reading position. The store holds the document being read
 * and nothing about how it is drawn — no scroll offsets, no measurements, no viewport.
 *
 * Reading position is saved as a *line number*, debounced, and restored on reopen. That
 * is the whole of "I came back to exactly where I left off", and it survives a font-size
 * change, a window resize, and a file that grew by ten lines while you were away.
 */

import { create } from 'zustand';
import type { FileEntry, Source } from '@/model/types';
import { getReadingPosition, latestReadingPosition, putReadingPosition } from '@/db';
import {
  forgetSource,
  openFolder,
  openGithub,
  openUpload,
  recentSources,
  reopen,
  SourceError,
  type SourceAdapter,
} from '@/sources';
import { ancestorsOf, buildTree, initialExpanded, type TreeNode } from '@/ui/FileTree/tree';

export interface Failure {
  message: string;
  hint?: string;
}

function asFailure(error: unknown): Failure {
  if (error instanceof SourceError) {
    return error.hint ? { message: error.message, hint: error.hint } : { message: error.message };
  }
  return {
    message: 'Something went wrong opening that.',
    hint: error instanceof Error ? error.message : undefined,
  };
}

interface SessionState {
  status: 'empty' | 'opening' | 'ready';
  error: Failure | null;
  warnings: string[];

  source: Source | null;
  adapter: SourceAdapter | null;
  files: FileEntry[];
  tree: TreeNode[];
  expanded: Set<string>;

  activeFile: FileEntry | null;
  content: string | null;
  fileError: Failure | null;
  loadingFile: boolean;
  /** Line to scroll to once the document is rendered; cleared when consumed. */
  pendingLine: number | null;

  recents: Source[];

  loadRecents: () => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  pickFolder: () => Promise<void>;
  uploadFolder: (list: FileList) => Promise<void>;
  reopenSource: (source: Source) => Promise<void>;
  forget: (sourceId: string) => Promise<void>;
  close: () => void;
  dismissError: () => void;

  toggleDirectory: (path: string) => void;
  openFile: (fileId: string) => Promise<void>;
  consumePendingLine: () => void;
  rememberLine: (line: number) => void;
}

let positionTimer: ReturnType<typeof setTimeout> | undefined;

export const useSession = create<SessionState>()((set, get) => {
  /** Shared tail of every open path, so the four entry points cannot drift apart. */
  async function adopt(opened: {
    source: Source;
    files: FileEntry[];
    adapter: SourceAdapter;
    warnings: string[];
  }) {
    const tree = buildTree(opened.files);

    set({
      status: 'ready',
      error: null,
      warnings: opened.warnings,
      source: opened.source,
      adapter: opened.adapter,
      files: opened.files,
      tree,
      expanded: initialExpanded(tree),
      activeFile: null,
      content: null,
      fileError: null,
      pendingLine: null,
    });

    void get().loadRecents();

    // Land the reader where it was left, rather than on an empty pane.
    const last = await latestReadingPosition(opened.source.id);
    if (last && opened.files.some((f) => f.id === last.fileId)) {
      await get().openFile(last.fileId);
    }
  }

  async function guard(work: () => Promise<void>) {
    set({ status: 'opening', error: null });
    try {
      await work();
    } catch (error) {
      // A dismissed folder picker is a non-event, not a failure to report.
      if (error instanceof SourceError && error.message === 'Cancelled.') {
        set({ status: get().source ? 'ready' : 'empty' });
        return;
      }
      set({ status: get().source ? 'ready' : 'empty', error: asFailure(error) });
    }
  }

  return {
    status: 'empty',
    error: null,
    warnings: [],
    source: null,
    adapter: null,
    files: [],
    tree: [],
    expanded: new Set(),
    activeFile: null,
    content: null,
    fileError: null,
    loadingFile: false,
    pendingLine: null,
    recents: [],

    loadRecents: async () => {
      set({ recents: await recentSources() });
    },

    openUrl: (url) => guard(async () => adopt(await openGithub(url))),
    pickFolder: () => guard(async () => adopt(await openFolder())),
    uploadFolder: (list) => guard(async () => adopt(await openUpload(list))),
    reopenSource: (source) => guard(async () => adopt(await reopen(source))),

    forget: async (sourceId) => {
      await forgetSource(sourceId);
      if (get().source?.id === sourceId) get().close();
      await get().loadRecents();
    },

    close: () => {
      set({
        status: 'empty',
        source: null,
        adapter: null,
        files: [],
        tree: [],
        expanded: new Set(),
        activeFile: null,
        content: null,
        fileError: null,
        warnings: [],
        pendingLine: null,
      });
      void get().loadRecents();
    },

    dismissError: () => set({ error: null }),

    toggleDirectory: (path) =>
      set((s) => {
        const next = new Set(s.expanded);
        if (!next.delete(path)) next.add(path);
        return { expanded: next };
      }),

    openFile: async (fileId) => {
      const { adapter, files, activeFile } = get();
      if (!adapter) return;
      if (activeFile?.id === fileId) return;

      const file = files.find((f) => f.id === fileId);
      if (!file) return;

      set({
        activeFile: file,
        content: null,
        fileError: null,
        loadingFile: true,
        // Reveal the file in the tree, so "where am I" is never a question.
        expanded: new Set([...get().expanded, ...ancestorsOf(file.path)]),
      });

      try {
        const [text, position] = await Promise.all([
          adapter.readFile(fileId),
          getReadingPosition(fileId),
        ]);

        // A slower read for a file the user has since navigated away from must not win.
        if (get().activeFile?.id !== fileId) return;

        set({ content: text, loadingFile: false, pendingLine: position?.line ?? null });
      } catch (error) {
        if (get().activeFile?.id !== fileId) return;
        set({ content: null, loadingFile: false, fileError: asFailure(error) });
      }
    },

    consumePendingLine: () => set({ pendingLine: null }),

    rememberLine: (line) => {
      const { activeFile, source } = get();
      if (!activeFile || !source) return;

      // Debounced: scrolling a long file should not write to IndexedDB per frame.
      clearTimeout(positionTimer);
      positionTimer = setTimeout(() => {
        void putReadingPosition({
          fileId: activeFile.id,
          sourceId: source.id,
          line,
          updatedAt: Date.now(),
        });
      }, 500);
    },
  };
});
