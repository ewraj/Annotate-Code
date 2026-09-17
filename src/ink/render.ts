/**
 * How ink looks on the canvas.
 *
 * Two tools, two genuinely different materials. The pen lays down opaque ink that varies in
 * width with pressure. The highlighter is translucent and composites with `multiply`, which
 * is what makes it darken the code underneath instead of washing it out — the difference
 * between a highlighter and a marker pen.
 */

import type { InkPoint, StrokeStyle } from '@/model/types';
import { outlineOf, pathOf } from './stroke';

/** Set up a canvas for the current device pixel ratio. Returns the context, or `null`. */
export function prepare(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));

  // Assigning width/height clears the canvas, so only do it when the size really changed.
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d', options);
  if (!ctx) return null;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function clear(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/**
 * Draw one stroke. Points must already be in canvas coordinates.
 *
 * The caller owns culling — by the time a stroke reaches here it is assumed to be worth
 * drawing.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: InkPoint[],
  style: StrokeStyle,
): void {
  const outline = outlineOf(points, style.tool, style.width);
  if (outline.length < 2) return;

  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.globalCompositeOperation = style.tool === 'highlighter' ? 'multiply' : 'source-over';
  ctx.fillStyle = style.color;
  ctx.fill(pathOf(outline));
  ctx.restore();
}

/**
 * The eraser's reach, drawn as a ring under the cursor.
 *
 * Whole-stroke erase is invisible until something vanishes, so the ring is the only feedback
 * telling you what you are about to remove.
 */
export function drawEraserRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(23, 23, 23, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(23, 23, 23, 0.04)';
  ctx.fill();
  ctx.restore();
}
