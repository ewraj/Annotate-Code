import { describe, expect, it } from 'vitest';
import type { InkPoint } from '@/model/types';
import { bboxOf, geometryOf, hits, outlineOf } from './stroke';

function line(from: [number, number], to: [number, number], steps = 10): InkPoint[] {
  const points: InkPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: from[0] + (to[0] - from[0]) * t,
      y: from[1] + (to[1] - from[1]) * t,
      p: 0.5,
    });
  }
  return points;
}

describe('outlineOf', () => {
  it('returns nothing for no points', () => {
    expect(outlineOf([], 'pen', 4)).toEqual([]);
  });

  it('produces a closed outline for a single point, so a tap leaves a dot', () => {
    expect(outlineOf([{ x: 5, y: 5, p: 0.5 }], 'pen', 4).length).toBeGreaterThan(2);
  });

  it('widens with the configured size', () => {
    const thin = bboxOf(outlineOf(line([0, 0], [50, 0]), 'pen', 2));
    const thick = bboxOf(outlineOf(line([0, 0], [50, 0]), 'pen', 20));
    expect(thick.h).toBeGreaterThan(thin.h);
  });
});

describe('bboxOf', () => {
  it('is empty for an empty outline', () => {
    expect(bboxOf([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('spans the extremes of the outline', () => {
    expect(bboxOf([[0, 0], [10, 4], [-2, 7]])).toEqual({ x: -2, y: 0, w: 12, h: 7 });
  });
});

describe('geometryOf', () => {
  it('keeps the input points verbatim', () => {
    const points = line([0, 0], [20, 20]);
    expect(geometryOf(points, 'pen', 3).points).toBe(points);
  });

  it('bounds the drawn outline, not the bare centreline', () => {
    // A perfectly horizontal stroke has zero height as a path and real height as ink.
    const { bbox } = geometryOf(line([0, 10], [40, 10]), 'highlighter', 16);
    expect(bbox.h).toBeGreaterThan(8);
  });
});

describe('hits', () => {
  const geometry = geometryOf(line([0, 0], [100, 0]), 'pen', 4);

  it('registers a touch on the stroke', () => {
    expect(hits(geometry, 4, 50, 0, 6)).toBe(true);
  });

  it('registers a touch just off the stroke, within the eraser radius', () => {
    expect(hits(geometry, 4, 50, 7, 6)).toBe(true);
  });

  it('ignores a point beyond the eraser radius', () => {
    expect(hits(geometry, 4, 50, 40, 6)).toBe(false);
  });

  it('ignores a point past the end of the stroke', () => {
    expect(hits(geometry, 4, 200, 0, 6)).toBe(false);
  });

  it('never matches an empty stroke', () => {
    expect(hits({ points: [], bbox: { x: 0, y: 0, w: 0, h: 0 } }, 4, 0, 0, 10)).toBe(false);
  });

  it('matches a single-point stroke within reach', () => {
    const dot = geometryOf([{ x: 10, y: 10, p: 0.5 }], 'pen', 4);
    expect(hits(dot, 4, 12, 12, 5)).toBe(true);
    expect(hits(dot, 4, 60, 60, 5)).toBe(false);
  });

  it('grows its reach with the eraser radius', () => {
    expect(hits(geometry, 4, 50, 25, 5)).toBe(false);
    expect(hits(geometry, 4, 50, 25, 30)).toBe(true);
  });
});
