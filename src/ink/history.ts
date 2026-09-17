/**
 * Undo and redo for ink.
 *
 * Scoped to one file and deliberately not persisted: reopening a file should give you your
 * annotations, not a rewindable session from last week. The plan says so, and a persisted
 * undo stack would also need its own conflict story in Phase 6 for no real benefit.
 *
 * An entry holds whole annotations rather than diffs, because every operation in Phase 2 is
 * either "this appeared" or "these disappeared". Storing the records themselves makes undo a
 * re-insert rather than a reconstruction.
 */

import type { Placed } from './store';

/**
 * Entries carry `Placed`, not bare annotations, so undoing an erase can put a stroke back on
 * the line it was actually drawn on without walking the anchor ladder again.
 */
export type Entry =
  | { kind: 'add'; strokes: Placed[] }
  | { kind: 'erase'; strokes: Placed[] };

/** Enough to cover a working session; far short of anything that pressures memory. */
const LIMIT = 100;

export interface Stacks {
  undo: Entry[];
  redo: Entry[];
}

export function emptyStacks(): Stacks {
  return { undo: [], redo: [] };
}

/** Record a new action. Any redo future is discarded, as it is in every editor. */
export function push(stacks: Stacks, entry: Entry): Stacks {
  const undo = [...stacks.undo, entry];
  return { undo: undo.length > LIMIT ? undo.slice(undo.length - LIMIT) : undo, redo: [] };
}

/** The inverse of an entry: what undoing it does, expressed as another entry. */
export function invert(entry: Entry): Entry {
  return entry.kind === 'add'
    ? { kind: 'erase', strokes: entry.strokes }
    : { kind: 'add', strokes: entry.strokes };
}

export function popUndo(stacks: Stacks): { entry: Entry; stacks: Stacks } | null {
  const entry = stacks.undo.at(-1);
  if (!entry) return null;
  return {
    entry,
    stacks: { undo: stacks.undo.slice(0, -1), redo: [...stacks.redo, entry] },
  };
}

export function popRedo(stacks: Stacks): { entry: Entry; stacks: Stacks } | null {
  const entry = stacks.redo.at(-1);
  if (!entry) return null;
  return {
    entry,
    stacks: { undo: [...stacks.undo, entry], redo: stacks.redo.slice(0, -1) },
  };
}
