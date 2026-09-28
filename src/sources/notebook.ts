/**
 * Jupyter notebooks, read as code.
 *
 * An `.ipynb` is JSON: every cell's source is an array of strings, and next to it sit the
 * outputs — rendered dataframes, base64 plots, whole stylesheets. Shown raw, a notebook is
 * mostly escaped HTML with the Python buried somewhere inside. Nobody opens one to read that.
 *
 * So a notebook is presented in the "percent" format that Jupytext, VS Code and Spyder
 * already understand: one `# %%` marker per cell, markdown cells as comments, outputs gone.
 * What is left is a plain Python file, and it highlights, anchors and annotates like one.
 *
 * The conversion goes both ways. An edit saved to a folder on disk is folded back into the
 * original notebook: cells keep their metadata, and a cell keeps its outputs only while its
 * source is unchanged — a stale output under edited code would be a lie.
 */

import { extensionOf } from './filters';

type CellType = 'code' | 'markdown' | 'raw';

interface Cell {
  cell_type: CellType;
  source: string | string[];
  metadata?: Record<string, unknown>;
  id?: string;
  outputs?: unknown[];
  execution_count?: number | null;
  [key: string]: unknown;
}

interface Notebook {
  cells: Cell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
  [key: string]: unknown;
}

interface ParsedCell {
  type: CellType;
  source: string;
}

export function isNotebook(path: string): boolean {
  return extensionOf(path) === 'ipynb';
}

const MARKER = /^# %%(?:\s*\[(markdown|md|raw)\])?\s*$/;

function parseNotebook(raw: string): Notebook | null {
  try {
    const nb = JSON.parse(raw) as Notebook;
    return nb && Array.isArray(nb.cells) ? nb : null;
  } catch {
    return null;
  }
}

/** A cell's source as one string, without blank lines at either end. */
function joinSource(source: string | string[]): string {
  return (Array.isArray(source) ? source.join('') : source).replace(/^\n+|\n+$/g, '');
}

/** nbformat's own layout: one string per line, each keeping its newline except the last. */
function splitSource(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  return lines.map((line, i) => (i < lines.length - 1 ? `${line}\n` : line)).filter((l) => l !== '');
}

function comment(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '#' : `# ${line}`))
    .join('\n');
}

function uncomment(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('# ') ? line.slice(2) : line.startsWith('#') ? line.slice(1) : line))
    .join('\n');
}

/**
 * The readable view of a notebook.
 *
 * Anything that is not a notebook comes back untouched, so this is safe to run over text
 * that has already been converted — a cached view, or a file that only claims the extension.
 */
export function notebookToSource(raw: string): string {
  const nb = parseNotebook(raw);
  if (!nb) return raw;

  const blocks = nb.cells.map((cell) => {
    const source = joinSource(cell.source);
    if (cell.cell_type === 'markdown') return `# %% [markdown]\n${comment(source)}`;
    if (cell.cell_type === 'raw') return `# %% [raw]\n${comment(source)}`;
    return source === '' ? '# %%' : `# %%\n${source}`;
  });

  return `${blocks.join('\n\n')}\n`;
}

export function parseSource(text: string): ParsedCell[] {
  const cells: ParsedCell[] = [];
  let current: { type: CellType; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.lines.join('\n').replace(/^\n+|\n+$/g, '');
    cells.push({
      type: current.type,
      source: current.type === 'code' ? body : uncomment(body),
    });
  };

  for (const line of text.split('\n')) {
    const match = MARKER.exec(line);
    if (match) {
      flush();
      const kind = match[1];
      current = { type: kind === 'raw' ? 'raw' : kind ? 'markdown' : 'code', lines: [] };
      continue;
    }
    // Code typed above the first marker still belongs somewhere.
    if (!current) {
      if (line.trim() === '') continue;
      current = { type: 'code', lines: [] };
    }
    current.lines.push(line);
  }
  flush();

  return cells;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Fold an edited view back into the notebook it came from.
 *
 * Cells are matched by position and type. A match keeps its metadata and id; it keeps its
 * outputs only if its source did not change. Anything unmatched is a new cell.
 */
export function sourceToNotebook(text: string, originalRaw: string): string {
  const original = parseNotebook(originalRaw) ?? {
    cells: [],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  };
  const wantsIds = (original.nbformat ?? 4) > 4 || (original.nbformat_minor ?? 0) >= 5;

  const cells = parseSource(text).map((parsed, i): Cell => {
    const previous = original.cells[i];
    const same = previous?.cell_type === parsed.type ? previous : undefined;
    const unchanged = same !== undefined && joinSource(same.source) === parsed.source;

    const cell: Cell = {
      ...(same ?? {}),
      cell_type: parsed.type,
      metadata: same?.metadata ?? {},
      source: splitSource(parsed.source),
    };
    if (wantsIds && !cell.id) cell.id = newId();

    if (parsed.type === 'code') {
      if (!unchanged) {
        cell.outputs = [];
        cell.execution_count = null;
      } else {
        cell.outputs ??= [];
        cell.execution_count ??= null;
      }
    } else {
      delete cell.outputs;
      delete cell.execution_count;
    }
    return cell;
  });

  return `${JSON.stringify({ ...original, cells }, null, 1)}\n`;
}
