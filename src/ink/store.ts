/**
 * Where ink meets persistence and anchoring.
 *
 * The rendering layer should not know about IndexedDB and the anchor ladder should not know
 * about canvases, so the joins between them live here.
 */

import { createAnchor, resolveAnchor, toLines } from '@/model/anchor';
import type { Annotation, InkPoint, Layer, StrokeStyle } from '@/model/types';
import {
  deleteAnnotations,
  listAnnotations,
  listLayers,
  putAnnotation,
  putLayer,
  requestPersistence,
} from '@/db';
import { geometryOf } from './stroke';

/** An annotation together with the line the anchor ladder actually put it on. */
export interface Placed {
  annotation: Annotation;
  /** 0-indexed, and not necessarily `annotation.anchor.line` — the code may have moved. */
  line: number;
}

export interface Loaded {
  placed: Placed[];
  /** Anchors the ladder refused to guess at. These are shown in a tray, never over code. */
  displaced: Annotation[];
}

/**
 * Phase 2 has no layer UI, but every annotation needs a layer, so one is created on demand.
 * Phase 4 turns this list into something the user can see and manage.
 */
export async function ensureDefaultLayer(sourceId: string): Promise<Layer> {
  const existing = await listLayers(sourceId);
  if (existing.length > 0) return existing[0]!;

  const layer: Layer = {
    id: crypto.randomUUID(),
    sourceId,
    name: 'Notes',
    visible: true,
    order: 0,
    updatedAt: Date.now(),
  };
  await putLayer(layer);
  return layer;
}

/**
 * Every annotation on a file, resolved against the text as it stands now.
 *
 * `unresolved` is a real outcome, not an error: those annotations are handed back separately
 * so the caller can show them somewhere honest instead of drawing them over code that may
 * have nothing to do with them.
 */
export async function loadForFile(fileId: string, text: string): Promise<Loaded> {
  const annotations = await listAnnotations(fileId);
  const lines = toLines(text);

  const placed: Placed[] = [];
  const displaced: Annotation[] = [];

  for (const annotation of annotations) {
    const { line, resolved } = resolveAnchor(annotation.anchor, lines);
    if (resolved === 'unresolved') {
      displaced.push(annotation);
    } else {
      placed.push({ annotation: { ...annotation, anchor: { ...annotation.anchor, resolved } }, line });
    }
  }

  return { placed, displaced };
}

/**
 * Turn a finished stroke into a saved annotation.
 *
 * Called on stroke end and never per point — writing mid-stroke would put IndexedDB on the
 * path between the stylus and the screen.
 */
export async function saveStroke(params: {
  fileId: string;
  layerId: string;
  text: string;
  /** 0-indexed line the stroke started on; the anchor is captured against it. */
  line: number;
  points: InkPoint[];
  style: StrokeStyle;
}): Promise<Placed> {
  const { fileId, layerId, text, line, points, style } = params;
  const now = Date.now();

  const annotation: Annotation = {
    id: crypto.randomUUID(),
    layerId,
    fileId,
    kind: 'ink',
    anchor: createAnchor(toLines(text), line),
    geometry: geometryOf(points, style.tool, style.width),
    style,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  };

  await putAnnotation(annotation);
  // First write of the session is the moment to ask the browser not to evict this origin.
  void requestPersistence();

  return { annotation, line };
}

export async function eraseStrokes(ids: string[]): Promise<void> {
  if (ids.length > 0) await deleteAnnotations(ids);
}

/** Put erased annotations back, for undo. */
export async function restoreStrokes(annotations: Annotation[]): Promise<void> {
  await Promise.all(annotations.map((a) => putAnnotation(a)));
}

/**
 * Recapture every anchor against the text as it now stands.
 *
 * Called after a save, and deliberately not by walking the resolution ladder: during the
 * session the strokes were already carried to their new lines by mapping through
 * CodeMirror's own change set, which knows exactly what moved where. The ladder exists for
 * the case where that record is gone — a file edited somewhere else, between sessions. Using
 * it here would be throwing away better information in favour of a guess.
 */
export async function reanchorStrokes(placed: Placed[], text: string): Promise<Placed[]> {
  const lines = toLines(text);
  const now = Date.now();

  const updated = placed.map((p) => ({
    ...p,
    annotation: { ...p.annotation, anchor: createAnchor(lines, p.line), updatedAt: now },
  }));

  await Promise.all(updated.map((p) => putAnnotation(p.annotation)));
  return updated;
}
