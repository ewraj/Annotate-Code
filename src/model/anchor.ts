/**
 * The anchoring engine.
 *
 * Annotations are attached to *code*, not to pixels and not to bare line numbers. This
 * module turns a stored `Anchor` back into a line in a document that may have changed
 * since the annotation was written.
 *
 * The governing rule, from the product gist:
 *
 *   Never silently move someone's handwritten note to the wrong code.
 *
 * So `unresolved` is a real, expected outcome — not a failure to paper over. Every
 * heuristic below either produces a position it can justify, or gives up and says so.
 *
 * Everything here is pure and synchronous over strings, which is what makes it cheap to
 * test exhaustively. It should carry the densest test coverage in the codebase.
 */

import type { Anchor, AnchorResolution } from './types';

/** How many lines of surrounding context an anchor remembers, on each side. */
export const CONTEXT_LINES = 3;

/** How far from the original line number step 2 is willing to look. */
export const SEARCH_RADIUS = 50;

/**
 * A line this short carries no identity of its own — `}`, `{`, `);`, or blank. Finding a
 * matching hash for one of these means nothing without agreeing context.
 */
function isWeakLine(trimmed: string): boolean {
  return trimmed.length <= 2;
}

/**
 * FNV-1a, 32-bit. Not cryptographic and does not need to be: this detects *change*, not
 * tampering. It is a few nanoseconds per line, which matters when a 5,000-line file is
 * rehashed on every open.
 */
export function hashLine(text: string): string {
  let h = 0x811c9dc5;
  const s = text.trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Split source text into lines the way every function here expects. */
export function toLines(source: string): string[] {
  return source.split('\n');
}

function lineAt(lines: string[], i: number): string {
  return lines[i] ?? '';
}

function trimmedAt(lines: string[], i: number): string {
  return lineAt(lines, i).trim();
}

/** Capture an anchor for `line` against the document as it stands right now. */
export function createAnchor(lines: string[], line: number, symbol?: string): Anchor {
  const contextBefore: string[] = [];
  for (let i = Math.max(0, line - CONTEXT_LINES); i < line; i++) {
    contextBefore.push(trimmedAt(lines, i));
  }

  const contextAfter: string[] = [];
  for (let i = line + 1; i <= Math.min(lines.length - 1, line + CONTEXT_LINES); i++) {
    contextAfter.push(trimmedAt(lines, i));
  }

  const anchor: Anchor = {
    line,
    lineHash: hashLine(lineAt(lines, line)),
    contextBefore,
    contextAfter,
  };
  if (symbol) anchor.symbol = symbol;
  return anchor;
}

export interface Resolution {
  /** Meaningful only when `resolved` is 'exact' or 'moved'. */
  line: number;
  resolved: AnchorResolution;
}

/**
 * How many of the remembered context lines still sit where they should, if the anchored
 * line were at `candidate`. Used to break ties between identical-looking lines.
 */
function contextScore(anchor: Anchor, lines: string[], candidate: number): number {
  let score = 0;

  const before = anchor.contextBefore;
  for (let i = 0; i < before.length; i++) {
    // contextBefore[0] is the furthest back, so it sits at candidate - before.length.
    const at = candidate - before.length + i;
    if (at >= 0 && trimmedAt(lines, at) === before[i]) score++;
  }

  const after = anchor.contextAfter;
  for (let i = 0; i < after.length; i++) {
    const at = candidate + 1 + i;
    if (at < lines.length && trimmedAt(lines, at) === after[i]) score++;
  }

  return score;
}

/** Does the full remembered context sit exactly where it should, around `candidate`? */
function contextMatchesExactly(anchor: Anchor, lines: string[], candidate: number): boolean {
  const { contextBefore: before, contextAfter: after } = anchor;

  if (candidate - before.length < 0) return false;
  if (candidate + after.length > lines.length - 1) return false;

  for (let i = 0; i < before.length; i++) {
    if (trimmedAt(lines, candidate - before.length + i) !== before[i]) return false;
  }
  for (let i = 0; i < after.length; i++) {
    if (trimmedAt(lines, candidate + 1 + i) !== after[i]) return false;
  }

  return true;
}

/**
 * The resolution ladder. First rung that produces a justified position wins.
 *
 *   1. Exact        — the original line still hashes the same.
 *   2. Local search — the same line moved a little; nearby, disambiguated by context.
 *   3. Context      — the line itself changed, but its surroundings uniquely place it.
 *   4. Symbol       — the enclosing function or class appears exactly once.
 *   5. Unresolved   — say so. Do not guess.
 */
export function resolveAnchor(anchor: Anchor, lines: string[]): Resolution {
  if (lines.length === 0) return { line: anchor.line, resolved: 'unresolved' };

  // 1. Exact.
  if (anchor.line < lines.length && hashLine(lineAt(lines, anchor.line)) === anchor.lineHash) {
    return { line: anchor.line, resolved: 'exact' };
  }

  // 2. Local search, nearest-first so that ties naturally favour the smallest movement.
  const candidates: number[] = [];
  const lo = Math.max(0, anchor.line - SEARCH_RADIUS);
  const hi = Math.min(lines.length - 1, anchor.line + SEARCH_RADIUS);
  for (let d = 0; d <= SEARCH_RADIUS; d++) {
    for (const i of d === 0 ? [anchor.line] : [anchor.line - d, anchor.line + d]) {
      if (i < lo || i > hi) continue;
      if (hashLine(lineAt(lines, i)) === anchor.lineHash) candidates.push(i);
    }
  }

  if (candidates.length > 0) {
    let best = candidates[0]!;
    let bestScore = contextScore(anchor, lines, best);
    let tied = false;

    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i]!;
      const score = contextScore(anchor, lines, c);
      if (score > bestScore) {
        best = c;
        bestScore = score;
        tied = false;
      } else if (score === bestScore) {
        // `candidates` is nearest-first, so `best` is already the closer one.
        tied = true;
      }
    }

    // A distinctive line is its own evidence. A `}` is not — without agreeing context it
    // could be any of a hundred identical lines. Same for a tie between equally-plausible
    // candidates. In those cases demand that at least some context still lines up, and
    // fall through to the next rung rather than guess.
    const ambiguous = candidates.length > 1 && (tied || isWeakLine(trimmedAt(lines, best)));

    if (!ambiguous || bestScore > 0) {
      return { line: best, resolved: 'moved' };
    }
  }

  // 3. Context match — the anchored line itself was edited, but its neighbourhood is intact.
  if (anchor.contextBefore.length + anchor.contextAfter.length > 0) {
    let found = -1;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (contextMatchesExactly(anchor, lines, i)) {
        count++;
        if (count > 1) break;
        found = i;
      }
    }
    if (count === 1) return { line: found, resolved: 'moved' };
  }

  // 4. Symbol match — only when it is unambiguous.
  if (anchor.symbol) {
    const needle = new RegExp(`\\b${escapeRegExp(anchor.symbol)}\\b`);
    let found = -1;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (needle.test(lineAt(lines, i))) {
        count++;
        if (count > 1) break;
        found = i;
      }
    }
    if (count === 1) return { line: found, resolved: 'moved' };
  }

  // 5. Give up, loudly. The caller must route this to the displaced-notes tray and must
  //    not draw it over code.
  return { line: anchor.line, resolved: 'unresolved' };
}

/**
 * Re-capture an anchor against the current document, so that a note which survived an
 * edit does not have to walk the whole ladder again next time. Returns `null` when the
 * anchor could not be resolved — the caller keeps the original, untouched.
 */
export function rebuildAnchor(anchor: Anchor, lines: string[]): Anchor | null {
  const { line, resolved } = resolveAnchor(anchor, lines);
  if (resolved === 'unresolved') return null;
  const next = createAnchor(lines, line, anchor.symbol);
  next.resolved = resolved;
  return next;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
