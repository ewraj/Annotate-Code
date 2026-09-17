import { describe, expect, it } from 'vitest';
import type { Annotation } from '@/model/types';
import { emptyStacks, invert, popRedo, popUndo, push, type Entry } from './history';
import type { Placed } from './store';

function stroke(id: string): Placed {
  return {
    line: 1,
    annotation: { id } as Annotation,
  };
}

const add = (id: string): Entry => ({ kind: 'add', strokes: [stroke(id)] });

describe('push', () => {
  it('records onto the undo stack', () => {
    expect(push(emptyStacks(), add('a')).undo).toHaveLength(1);
  });

  it('discards the redo future, as every editor does', () => {
    const undone = popUndo(push(emptyStacks(), add('a')))!;
    expect(undone.stacks.redo).toHaveLength(1);
    expect(push(undone.stacks, add('b')).redo).toHaveLength(0);
  });

  it('caps the stack, keeping the most recent entries', () => {
    let stacks = emptyStacks();
    for (let i = 0; i < 150; i++) stacks = push(stacks, add(`s${i}`));

    expect(stacks.undo).toHaveLength(100);
    expect(stacks.undo.at(-1)!.strokes[0]!.annotation.id).toBe('s149');
    expect(stacks.undo[0]!.strokes[0]!.annotation.id).toBe('s50');
  });
});

describe('invert', () => {
  it('turns an add into an erase and back', () => {
    const entry = add('a');
    expect(invert(entry).kind).toBe('erase');
    expect(invert(invert(entry))).toEqual(entry);
  });

  it('carries the same strokes across', () => {
    expect(invert(add('a')).strokes[0]!.annotation.id).toBe('a');
  });
});

describe('popUndo / popRedo', () => {
  it('return nothing when there is nothing to undo or redo', () => {
    expect(popUndo(emptyStacks())).toBeNull();
    expect(popRedo(emptyStacks())).toBeNull();
  });

  it('move an entry from one stack to the other, and back', () => {
    const start = push(emptyStacks(), add('a'));

    const undone = popUndo(start)!;
    expect(undone.entry.strokes[0]!.annotation.id).toBe('a');
    expect(undone.stacks).toEqual({ undo: [], redo: [undone.entry] });

    const redone = popRedo(undone.stacks)!;
    expect(redone.entry).toBe(undone.entry);
    expect(redone.stacks).toEqual(start);
  });

  it('unwind in last-in-first-out order', () => {
    const stacks = push(push(emptyStacks(), add('a')), add('b'));
    expect(popUndo(stacks)!.entry.strokes[0]!.annotation.id).toBe('b');
  });
});
