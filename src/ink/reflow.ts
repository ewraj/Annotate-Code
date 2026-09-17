/**
 * Carrying annotations across an edit.
 *
 * When the text changes, every stroke anchored below the change has to move with it. The
 * naive approach is to re-run the anchor ladder against the new document, but during a live
 * session that would be discarding the best information available: CodeMirror's change set
 * records exactly which positions moved and by how much. The ladder is for the other case,
 * where no such record exists — a file edited between sessions, or somewhere else entirely.
 */

import type { ChangeDesc, Text } from '@codemirror/state';

/**
 * A function from a line in `before` to the same line in `after`.
 *
 * Lines are 0-indexed here, as anchors are, and 1-indexed inside CodeMirror — the conversion
 * is the reason this is worth having in one place.
 *
 * Positions map with an association of 1, biasing toward the text *after* an insertion at the
 * line start. Inserting a line above a stroke therefore pushes the stroke down, which is what
 * someone typing above their own note expects; the opposite bias would leave the note behind
 * on the newly inserted blank line.
 */
export function lineMapper(
  before: Text,
  after: Text,
  changes: ChangeDesc,
): (line: number) => number {
  return (line) => {
    if (line < 0 || line + 1 > before.lines) return line;
    const mapped = changes.mapPos(before.line(line + 1).from, 1);
    return after.lineAt(mapped).number - 1;
  };
}
