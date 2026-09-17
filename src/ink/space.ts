/**
 * The coordinate space ink lives in.
 *
 * This is the load-bearing module of the ink engine. Everything else draws pretty curves;
 * this is what keeps them welded to the code.
 *
 * A stroke is stored relative to the top-left corner of its **anchor line** — the line the
 * stroke started on — and never in pixels of anything else. That is what `InkPoint` means
 * in the data model, and it has two consequences worth stating plainly:
 *
 *   - A stroke spanning twenty lines moves as one rigid body when the code reflows. It does
 *     not deform to follow individual lines, because a stroke torn across a line insertion
 *     is worse than a stroke that moved.
 *   - Nothing here reads `scrollTop`. Every screen position is asked of CodeMirror itself
 *     (`documentTop`, `lineBlockAt`), so ink and text can never disagree about where a line
 *     is — which is the failure mode the implementation plan calls the project's highest
 *     risk.
 */

import type { EditorView } from '@codemirror/view';

/**
 * Everything needed to convert between stored and screen space, read once per redraw.
 *
 * Read it inside a CodeMirror measure phase. Reading it at other times is not wrong, only
 * a layout-thrash risk.
 */
export interface Frame {
  /** Client X of the left edge of the content, i.e. just right of the gutter. */
  contentLeft: number;
  /** Client Y of the top of the document. Negative once scrolled down. */
  documentTop: number;
  /** Client X/Y of the canvas origin, so client coords can be rebased onto the canvas. */
  canvasLeft: number;
  canvasTop: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
}

export function frameOf(view: EditorView, canvas: HTMLElement): Frame {
  const content = view.contentDOM.getBoundingClientRect();
  const box = canvas.getBoundingClientRect();
  return {
    contentLeft: content.left,
    documentTop: view.documentTop,
    canvasLeft: box.left,
    canvasTop: box.top,
    width: box.width,
    height: box.height,
  };
}

/**
 * The document-relative Y of a line's top edge, or `null` if the line is out of range.
 *
 * Document-relative means "measured from the top of the content", which is CodeMirror's own
 * vertical space and is stable under scrolling. Add `frame.documentTop` for client coords.
 */
export function lineTop(view: EditorView, line: number): number | null {
  const doc = view.state.doc;
  const n = line + 1; // Anchors are 0-indexed; CodeMirror's doc is 1-indexed.
  if (n < 1 || n > doc.lines) return null;
  return view.lineBlockAt(doc.line(n).from).top;
}

/** The 0-indexed line under a client point. Clipped to the document, never null. */
export function lineAtClient(view: EditorView, clientX: number, clientY: number): number {
  const pos = view.posAtCoords({ x: clientX, y: clientY }, false);
  return view.state.doc.lineAt(pos).number - 1;
}

/**
 * Client point → a point in the anchor line's space, which is what gets persisted.
 *
 * `top` is the anchor line's document-relative top, from `lineTop`.
 */
export function toLineSpace(
  frame: Frame,
  top: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return {
    x: clientX - frame.contentLeft,
    y: clientY - (frame.documentTop + top),
  };
}

/** A stored point → canvas coordinates, for drawing. The exact inverse of `toLineSpace`. */
export function toCanvas(
  frame: Frame,
  top: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: frame.contentLeft - frame.canvasLeft + x,
    y: frame.documentTop + top - frame.canvasTop + y,
  };
}

/** A client point → canvas coordinates, for the in-progress stroke. */
export function clientToCanvas(
  frame: Frame,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return { x: clientX - frame.canvasLeft, y: clientY - frame.canvasTop };
}

/**
 * The band of lines worth drawing, widened past the rendered viewport.
 *
 * The margin exists because a stroke is anchored to the line it *started* on: one that
 * begins above the viewport can still reach into it, and culling on the bare viewport would
 * pop it out of existence as you scroll.
 */
export function visibleLines(view: EditorView, margin = 80): { from: number; to: number } {
  const doc = view.state.doc;
  const { from, to } = view.viewport;
  return {
    from: Math.max(0, doc.lineAt(from).number - 1 - margin),
    to: Math.min(doc.lines - 1, doc.lineAt(to).number - 1 + margin),
  };
}
