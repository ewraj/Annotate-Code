/**
 * Ink session state.
 *
 * What is on the page right now, and what undo would do about it. Split out from the canvas
 * component because two very different things need it: the surface that draws strokes, and
 * the tool palette's undo/redo buttons, which live somewhere else entirely.
 *
 * Nothing here is persisted. The annotations themselves are already in IndexedDB — this is
 * the working set for one open file, rebuilt on every file open.
 */

import { create } from 'zustand';
import type { Annotation } from '@/model/types';
import * as history from '@/ink/history';
import {
  ensureDefaultLayer,
  eraseStrokes,
  loadForFile,
  restoreStrokes,
  type Placed,
} from '@/ink/store';

interface InkState {
  fileId: string | null;
  layerId: string | null;
  placed: Placed[];
  /** Annotations the anchor ladder could not justify a position for. */
  displaced: Annotation[];
  stacks: history.Stacks;
  /** Bumped whenever the drawn set changes, so the canvas knows to repaint. */
  revision: number;

  open: (fileId: string, sourceId: string, text: string) => Promise<void>;
  close: () => void;

  /** After a stroke has been saved. */
  added: (stroke: Placed) => void;
  /** After strokes have been deleted. */
  erased: (strokes: Placed[]) => void;

  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export const useInk = create<InkState>()((set, get) => ({
  fileId: null,
  layerId: null,
  placed: [],
  displaced: [],
  stacks: history.emptyStacks(),
  revision: 0,

  open: async (fileId, sourceId, text) => {
    // Clear first: a stale file's ink must never be visible over a new file's code, not even
    // for the frame or two the load takes.
    set({
      fileId,
      placed: [],
      displaced: [],
      stacks: history.emptyStacks(),
      revision: get().revision + 1,
    });

    const [layer, loaded] = await Promise.all([
      ensureDefaultLayer(sourceId),
      loadForFile(fileId, text),
    ]);

    // The user may have moved on while this was in flight.
    if (get().fileId !== fileId) return;

    set((s) => ({
      layerId: layer.id,
      placed: loaded.placed,
      displaced: loaded.displaced,
      revision: s.revision + 1,
    }));
  },

  close: () =>
    set((s) => ({
      fileId: null,
      placed: [],
      displaced: [],
      stacks: history.emptyStacks(),
      revision: s.revision + 1,
    })),

  added: (stroke) =>
    set((s) => ({
      placed: [...s.placed, stroke],
      stacks: history.push(s.stacks, { kind: 'add', strokes: [stroke] }),
      revision: s.revision + 1,
    })),

  erased: (strokes) => {
    if (strokes.length === 0) return;
    const ids = new Set(strokes.map((p) => p.annotation.id));
    set((s) => ({
      placed: s.placed.filter((p) => !ids.has(p.annotation.id)),
      stacks: history.push(s.stacks, { kind: 'erase', strokes }),
      revision: s.revision + 1,
    }));
  },

  undo: async () => {
    const popped = history.popUndo(get().stacks);
    if (!popped) return;
    await apply(set, history.invert(popped.entry), popped.stacks);
  },

  redo: async () => {
    const popped = history.popRedo(get().stacks);
    if (!popped) return;
    await apply(set, popped.entry, popped.stacks);
  },
}));

/**
 * Carry out an entry against both the database and the working set.
 *
 * The stacks are passed in already advanced, because undo and redo move them in opposite
 * directions and neither is a plain `push`.
 */
async function apply(
  set: (partial: (s: InkState) => Partial<InkState>) => void,
  entry: history.Entry,
  stacks: history.Stacks,
): Promise<void> {
  if (entry.kind === 'add') {
    await restoreStrokes(entry.strokes.map((p) => p.annotation));
    set((s) => ({ placed: [...s.placed, ...entry.strokes], stacks, revision: s.revision + 1 }));
  } else {
    await eraseStrokes(entry.strokes.map((p) => p.annotation.id));
    const ids = new Set(entry.strokes.map((p) => p.annotation.id));
    set((s) => ({
      placed: s.placed.filter((p) => !ids.has(p.annotation.id)),
      stacks,
      revision: s.revision + 1,
    }));
  }
}
