/**
 * Stroke geometry.
 *
 * Input points in, a fillable outline out. Pure functions over numbers — no canvas, no DOM,
 * no CodeMirror — which is what makes the geometry testable without a browser.
 */

import { getStroke } from 'perfect-freehand';
import type { InkGeometry, InkPoint, InkTool } from '@/model/types';

/**
 * Per-tool feel. These are the numbers that decide whether the pen reads as a pen.
 *
 * `streamline` smooths the input path; `thinning` is how much pressure narrows the line.
 * The highlighter sets `thinning: 0` and flat caps because a real highlighter is a chisel
 * of constant width — pressure-tapered highlighter ends look like a mistake.
 */
const TUNING: Record<InkTool, Parameters<typeof getStroke>[1]> = {
  pen: {
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  },
  highlighter: {
    thinning: 0,
    smoothing: 0.4,
    streamline: 0.35,
    start: { taper: 0, cap: false },
    end: { taper: 0, cap: false },
  },
};

/** The outline polygon of a stroke, in whatever space the input points were in. */
export function outlineOf(points: InkPoint[], tool: InkTool, width: number): number[][] {
  if (points.length === 0) return [];
  return getStroke(
    points.map((p) => [p.x, p.y, p.p]),
    { size: width, simulatePressure: false, ...TUNING[tool] },
  ) as number[][];
}

/**
 * An outline polygon as a fillable path.
 *
 * Drawn through midpoints with quadratic segments rather than straight lines: at highlighter
 * widths a raw polygon shows visible facets on the curves.
 */
export function pathOf(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length < 2) return path;

  const first = outline[0]!;
  path.moveTo(first[0]!, first[1]!);

  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    path.quadraticCurveTo(a[0]!, a[1]!, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2);
  }

  path.closePath();
  return path;
}

/**
 * Bounding box of the *outline*, not of the input points.
 *
 * Culling against the input path would clip strokes by up to half their width at the edge of
 * the viewport, which is visible as ink that fades in late on scroll.
 */
export function bboxOf(outline: number[][]): InkGeometry['bbox'] {
  if (outline.length === 0) return { x: 0, y: 0, w: 0, h: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of outline) {
    const x = p[0]!;
    const y = p[1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Build the persisted geometry for a finished stroke. */
export function geometryOf(points: InkPoint[], tool: InkTool, width: number): InkGeometry {
  return { points, bbox: bboxOf(outlineOf(points, tool, width)) };
}

/** Squared distance from a point to a line segment. Squared, to keep the hot loop sqrt-free. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  // A degenerate segment is a point.
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));

  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/**
 * Does an eraser of `radius` at (x, y) touch this stroke?
 *
 * Tested against the stroke's centreline widened by half its width, not against the filled
 * outline: the model erases whole strokes, so "did you touch it" is the only question, and
 * a centreline test is both cheaper and more forgiving than a fill hit-test.
 */
export function hits(
  geometry: InkGeometry,
  width: number,
  x: number,
  y: number,
  radius: number,
): boolean {
  const { bbox, points } = geometry;
  if (points.length === 0) return false;

  // Cheap rejection first — most strokes on screen are nowhere near the eraser.
  const pad = radius;
  if (
    x < bbox.x - pad ||
    x > bbox.x + bbox.w + pad ||
    y < bbox.y - pad ||
    y > bbox.y + bbox.h + pad
  ) {
    return false;
  }

  const reach = radius + width / 2;
  const reachSq = reach * reach;

  if (points.length === 1) {
    const p = points[0]!;
    return (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) <= reachSq;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= reachSq) return true;
  }

  return false;
}
