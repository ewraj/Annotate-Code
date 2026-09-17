import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import { lineMapper } from './reflow';

const SOURCE = ['one', 'two', 'three', 'four', 'five'].join('\n');

/** Apply an edit and return the mapper across it, the way a ViewUpdate would. */
function edit(source: string, spec: Parameters<typeof ChangeSet.of>[0]) {
  const before = Text.of(source.split('\n'));
  const changes = ChangeSet.of(spec, before.length);
  const after = changes.apply(before);
  return { map: lineMapper(before, after, changes), after };
}

describe('lineMapper', () => {
  it('leaves every line alone when nothing changed', () => {
    const { map } = edit(SOURCE, []);
    for (let i = 0; i < 5; i++) expect(map(i)).toBe(i);
  });

  it('pushes lines down when a line is inserted above them', () => {
    // Insert a line before "three".
    const at = SOURCE.indexOf('three');
    const { map } = edit(SOURCE, { from: at, insert: 'inserted\n' });

    expect(map(0)).toBe(0);
    expect(map(1)).toBe(1);
    expect(map(2)).toBe(3); // "three" is now the fourth line
    expect(map(4)).toBe(5);
  });

  it('pulls lines up when a line above them is deleted', () => {
    const from = SOURCE.indexOf('two');
    const { map } = edit(SOURCE, { from, to: SOURCE.indexOf('three') });

    expect(map(0)).toBe(0);
    expect(map(2)).toBe(1); // "three" moved up into "two"'s place
    expect(map(4)).toBe(3);
  });

  it('is unmoved by an edit below it', () => {
    const from = SOURCE.indexOf('five');
    const { map } = edit(SOURCE, { from, insert: 'tail\n' });
    expect(map(0)).toBe(0);
    expect(map(2)).toBe(2);
  });

  it('leaves a line where it is when the line itself is edited in place', () => {
    const from = SOURCE.indexOf('three');
    const { map } = edit(SOURCE, { from, to: from + 5, insert: 'THREE' });
    expect(map(2)).toBe(2);
  });

  it('collapses onto the surviving line when its own line is deleted', () => {
    const from = SOURCE.indexOf('three');
    const { map, after } = edit(SOURCE, { from, to: from + 6 });
    // The stroke has to land somewhere real; what matters is that it stays in range.
    const line = map(2);
    expect(line).toBeGreaterThanOrEqual(0);
    expect(line).toBeLessThan(after.lines);
  });

  it('handles several edits in one change set', () => {
    const { map } = edit(SOURCE, [
      { from: 0, insert: 'top\n' },
      { from: SOURCE.indexOf('four'), insert: 'mid\n' },
    ]);
    expect(map(0)).toBe(1); // "one" pushed down by the first insert
    expect(map(3)).toBe(5); // "four" pushed by both
  });

  it('never returns a line outside the new document', () => {
    const { map, after } = edit(SOURCE, { from: 0, to: SOURCE.length, insert: 'only' });
    for (let i = 0; i < 5; i++) {
      expect(map(i)).toBeGreaterThanOrEqual(0);
      expect(map(i)).toBeLessThan(after.lines);
    }
  });

  it('ignores a line number that was never in the old document', () => {
    const { map } = edit(SOURCE, []);
    expect(map(99)).toBe(99);
    expect(map(-1)).toBe(-1);
  });
});
