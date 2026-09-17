/**
 * The ink surfaces.
 *
 * Three canvases stacked over the editor, plus an eraser hit-test that needs no canvas:
 *
 *   - **highlighter** — saved highlighter strokes. Composited with `mix-blend-mode: multiply`
 *     so the ink darkens the code beneath it instead of covering it. This has to be a blend
 *     mode on the *element*: a `multiply` inside a canvas only blends against that canvas's
 *     own contents, not against the text on the page under it.
 *   - **pen** — saved pen strokes, over the top, composited normally. Pen ink is opaque and
 *     must hide what it crosses, which is exactly what multiply would not do.
 *   - **wet** — the stroke being drawn, plus the eraser ring. Cleared and repainted on every
 *     pointer event, and it takes the blend mode of whichever tool is armed.
 *
 * Never repaint the dry canvases mid-stroke. That is the entire trick, and it is why drawing
 * stays at pointer speed on a file with a thousand strokes in it.
 *
 * Both canvases cover the editor box, which does not scroll — they are viewport-sized, not
 * document-sized, because a document-sized canvas on a long file silently exceeds the
 * browser's maximum canvas dimension and simply stops rendering.
 *
 * Repaints go through `view.requestMeasure`, so reads of the editor's geometry happen in
 * CodeMirror's own measure phase and ink is positioned from the same numbers the text was.
 * Deriving positions from `scrollTop` instead is the desync the implementation plan calls the
 * highest risk in the project.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import type { InkPoint, StrokeStyle } from '@/model/types';
import { ERASER_WIDTHS, currentStrokeStyle, usePalette } from '@/store/palette';
import { useInk } from '@/store/ink';
import { canDraw, notePointerType, pressureOf, samplesOf } from '@/ink/pointer';
import { clear, drawEraserRing, drawStroke, prepare } from '@/ink/render';
import {
  clientToCanvas,
  frameOf,
  lineAtClient,
  lineTop,
  toLineSpace,
  visibleLines,
  type Frame,
} from '@/ink/space';
import { hits } from '@/ink/stroke';
import { eraseStrokes, saveStroke, type Placed } from '@/ink/store';
import './ink.css';

interface Props {
  view: EditorView | null;
  fileId: string;
  /** The document text, for capturing anchors against. */
  text: string;
}

/** One stroke in progress. */
interface Wet {
  pointerId: number;
  /** The line the stroke started on; all its points are relative to this line's origin. */
  line: number;
  points: InkPoint[];
  style: StrokeStyle;
}

/** An eraser pass in progress; whole strokes are collected and removed together on release. */
interface Erasing {
  pointerId: number;
  radius: number;
  taken: Placed[];
  x: number;
  y: number;
}

/** A dry stroke reduced to what painting needs: an origin and the geometry to draw at it. */
interface Renderable {
  ox: number;
  oy: number;
  points: InkPoint[];
  style: StrokeStyle;
}

/** One finger dragging the document while a tool is armed. */
interface Panning {
  pointerId: number;
  x: number;
  y: number;
}

/** Paint one tool's strokes into its own canvas, leaving the other tool's canvas alone. */
function paintInto(
  canvas: HTMLCanvasElement | null,
  frame: Frame,
  items: Renderable[],
  tool: StrokeStyle['tool'],
): void {
  if (!canvas) return;
  const ctx = prepare(canvas, frame.width, frame.height);
  if (!ctx) return;

  clear(ctx);
  for (const item of items) {
    if (item.style.tool !== tool) continue;
    ctx.save();
    ctx.translate(item.ox, item.oy);
    drawStroke(ctx, item.points, item.style);
    ctx.restore();
  }
}

export function InkSurface({ view, fileId, text }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLCanvasElement>(null);
  const penRef = useRef<HTMLCanvasElement>(null);
  const wetRef = useRef<HTMLCanvasElement>(null);

  const wet = useRef<Wet | null>(null);
  const erasing = useRef<Erasing | null>(null);
  const panning = useRef<Panning | null>(null);

  const activeTool = usePalette((s) => s.activeTool);
  const revision = useInk((s) => s.revision);

  // The hot paths read these through refs: a pointermove must never depend on React having
  // re-rendered first.
  const latest = useRef({ view, fileId, text, activeTool });
  latest.current = { view, fileId, text, activeTool };

  const armed = activeTool !== null;

  // ---- dry canvas --------------------------------------------------------

  const repaintDry = useCallback(() => {
    const v = latest.current.view;
    const layer = layerRef.current;
    if (!v || !layer) return;

    v.requestMeasure<{ frame: Frame; items: Renderable[] }>({
      // A stable key so that a burst of scroll events coalesces into one measure.
      key: layer,
      read: () => {
        const frame = frameOf(v, layer);
        const band = visibleLines(v);
        const items: Renderable[] = [];

        for (const { annotation, line } of useInk.getState().placed) {
          const geometry = annotation.geometry;
          if (!geometry || line < band.from || line > band.to) continue;

          const top = lineTop(v, line);
          if (top === null) continue;

          const ox = frame.contentLeft - frame.canvasLeft;
          const oy = frame.documentTop + top - frame.canvasTop;

          // Cull against the canvas box using the stroke's own bounds, so a long stroke
          // anchored far above still draws while any part of it is on screen.
          const { bbox } = geometry;
          if (oy + bbox.y + bbox.h < 0 || oy + bbox.y > frame.height) continue;

          items.push({ ox, oy, points: geometry.points, style: annotation.style });
        }

        return { frame, items };
      },
      write: ({ frame, items }) => {
        paintInto(hlRef.current, frame, items, 'highlighter');
        paintInto(penRef.current, frame, items, 'pen');
      },
    });
  }, []);

  // Repaint when the annotation set changes, and whenever the editor moves under it.
  useEffect(() => {
    repaintDry();
  }, [repaintDry, revision, fileId]);

  useEffect(() => {
    if (!view) return;

    const scroller = view.scrollDOM;
    scroller.addEventListener('scroll', repaintDry, { passive: true });

    const observer = new ResizeObserver(repaintDry);
    observer.observe(view.dom);

    return () => {
      scroller.removeEventListener('scroll', repaintDry);
      observer.disconnect();
    };
  }, [view, repaintDry]);

  // ---- wet canvas --------------------------------------------------------

  const repaintWet = useCallback(() => {
    const v = latest.current.view;
    const canvas = wetRef.current;
    const layer = layerRef.current;
    if (!v || !canvas || !layer) return;

    const frame = frameOf(v, layer);
    const ctx = prepare(canvas, frame.width, frame.height, { desynchronized: true });
    if (!ctx) return;
    clear(ctx);

    const stroke = wet.current;
    if (stroke) {
      const top = lineTop(v, stroke.line);
      if (top !== null) {
        ctx.save();
        ctx.translate(
          frame.contentLeft - frame.canvasLeft,
          frame.documentTop + top - frame.canvasTop,
        );
        drawStroke(ctx, stroke.points, stroke.style);
        ctx.restore();
      }
    }

    const erase = erasing.current;
    if (erase) {
      const at = clientToCanvas(frame, erase.x, erase.y);
      drawEraserRing(ctx, at.x, at.y, erase.radius);
    }
  }, []);

  // ---- input -------------------------------------------------------------

  const beginStroke = useCallback((event: React.PointerEvent<HTMLCanvasElement>, style: StrokeStyle) => {
    const v = latest.current.view;
    const layer = layerRef.current;
    if (!v || !layer) return;

    const frame = frameOf(v, layer);
    const line = lineAtClient(v, event.clientX, event.clientY);
    const top = lineTop(v, line);
    if (top === null) return;

    const at = toLineSpace(frame, top, event.clientX, event.clientY);
    wet.current = {
      pointerId: event.pointerId,
      line,
      style,
      points: [{ x: at.x, y: at.y, p: pressureOf(event.nativeEvent) }],
    };
    repaintWet();
  }, [repaintWet]);

  const extendStroke = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = wet.current;
    const v = latest.current.view;
    const layer = layerRef.current;
    if (!stroke || !v || !layer) return;

    const frame = frameOf(v, layer);
    const top = lineTop(v, stroke.line);
    if (top === null) return;

    // Every sample behind this event, not just the latest — the difference between a curve
    // and a polygon.
    for (const sample of samplesOf(event.nativeEvent)) {
      const at = toLineSpace(frame, top, sample.clientX, sample.clientY);
      stroke.points.push({ x: at.x, y: at.y, p: pressureOf(sample) });
    }

    repaintWet();
  }, [repaintWet]);

  const endStroke = useCallback(async () => {
    const stroke = wet.current;
    wet.current = null;
    repaintWet();

    if (!stroke || stroke.points.length === 0) return;

    const { fileId: id, text: source } = latest.current;
    const layerId = useInk.getState().layerId;
    if (!layerId) return;

    const placed = await saveStroke({
      fileId: id,
      layerId,
      text: source,
      line: stroke.line,
      points: stroke.points,
      style: stroke.style,
    });

    useInk.getState().added(placed);
  }, [repaintWet]);

  const eraseAt = useCallback((clientX: number, clientY: number) => {
    const session = erasing.current;
    const v = latest.current.view;
    const layer = layerRef.current;
    if (!session || !v || !layer) return;

    session.x = clientX;
    session.y = clientY;

    const frame = frameOf(v, layer);
    const already = new Set(session.taken.map((p) => p.annotation.id));

    for (const candidate of useInk.getState().placed) {
      const geometry = candidate.annotation.geometry;
      if (!geometry || already.has(candidate.annotation.id)) continue;

      const top = lineTop(v, candidate.line);
      if (top === null) continue;

      const local = toLineSpace(frame, top, clientX, clientY);
      if (hits(geometry, candidate.annotation.style.width, local.x, local.y, session.radius)) {
        session.taken.push(candidate);
      }
    }

    repaintWet();
  }, [repaintWet]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const tool = latest.current.activeTool;
    const v = latest.current.view;
    if (!tool || !v) return;

    notePointerType(event.pointerType);

    // A palm, or a finger after the stylus has been picked up. It scrolls instead — done by
    // hand because `touch-action: none` is what stops the browser doing it for us while a
    // tool is armed.
    if (!canDraw(event)) {
      panning.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'eraser') {
      const radius = ERASER_WIDTHS[usePalette.getState().eraserWidthStep] ?? ERASER_WIDTHS[1]!;
      erasing.current = {
        pointerId: event.pointerId,
        radius: radius / 2,
        taken: [],
        x: event.clientX,
        y: event.clientY,
      };
      eraseAt(event.clientX, event.clientY);
      return;
    }

    const style = currentStrokeStyle(usePalette.getState());
    if (style) beginStroke(event, style);
  }, [beginStroke, eraseAt]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const pan = panning.current;
    if (pan && pan.pointerId === event.pointerId) {
      const v = latest.current.view;
      if (v) {
        v.scrollDOM.scrollTop -= event.clientY - pan.y;
        v.scrollDOM.scrollLeft -= event.clientX - pan.x;
      }
      pan.x = event.clientX;
      pan.y = event.clientY;
      return;
    }

    if (erasing.current?.pointerId === event.pointerId) {
      eraseAt(event.clientX, event.clientY);
      return;
    }

    if (wet.current?.pointerId === event.pointerId) extendStroke(event);
  }, [eraseAt, extendStroke]);

  const onPointerUp = useCallback(async (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panning.current?.pointerId === event.pointerId) {
      panning.current = null;
      return;
    }

    const session = erasing.current;
    if (session?.pointerId === event.pointerId) {
      erasing.current = null;
      repaintWet();
      if (session.taken.length > 0) {
        await eraseStrokes(session.taken.map((p) => p.annotation.id));
        useInk.getState().erased(session.taken);
      }
      return;
    }

    if (wet.current?.pointerId === event.pointerId) await endStroke();
  }, [endStroke, repaintWet]);

  // A file swap mid-stroke would otherwise save ink onto the wrong document.
  useEffect(() => {
    wet.current = null;
    erasing.current = null;
    panning.current = null;
  }, [fileId]);

  return (
    <div className={`ac-ink-layer ${armed ? 'is-armed' : ''}`} ref={layerRef} aria-hidden="true">
      <canvas className="ac-ink ac-ink-highlighter" ref={hlRef} />
      <canvas className="ac-ink" ref={penRef} />
      <canvas
        className={`ac-ink ac-ink-wet ${activeTool === 'highlighter' ? 'is-highlighter' : ''}`}
        ref={wetRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
