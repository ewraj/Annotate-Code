/**
 * The persisted data model.
 *
 * Every record carries `id` and `updatedAt` from day one so that cloud sync is later a
 * transport change rather than a rewrite. Nothing here may reference viewport pixels,
 * window size, or scroll offset — those are render-time inputs, never stored state.
 */

export type SourceKind = 'local-fs' | 'local-upload' | 'github' | 'scratch';

/** One opened codebase. */
export interface Source {
  id: string;
  kind: SourceKind;
  /** "facebook/react" or "my-project" */
  name: string;
  /** github only */
  origin?: { owner: string; repo: string; ref: string };
  /** key into the fsHandles store (local-fs only) */
  fsHandleKey?: string;
  createdAt: number;
  lastOpenedAt: number;
}

export interface FileEntry {
  /** stable across renames */
  id: string;
  sourceId: string;
  /** "src/services/runner.ts" */
  path: string;
  size: number;
  /** resolved lazily from the extension */
  lang?: string;
  /** github only — lets us skip a refetch */
  blobSha?: string;
  /** absent until loaded */
  content?: string;
  /** the user has local modifications */
  edited: boolean;
  /** hash of content at last save */
  contentHash: string;
  updatedAt: number;
}

export interface Layer {
  id: string;
  sourceId: string;
  /** "My Notes", "Questions" */
  name: string;
  visible: boolean;
  color?: string;
  order: number;
  updatedAt: number;
}

export type Tool = 'pen' | 'highlighter' | 'eraser';

/** Tools that lay down ink. The eraser is a tool but never a stroke style. */
export type InkTool = Exclude<Tool, 'eraser'>;

export type AnchorResolution = 'exact' | 'moved' | 'unresolved';

/**
 * How an annotation finds its way back to the right code.
 *
 * Line numbers alone are not enough — code changes. See `resolveAnchor` for the ladder
 * that turns this into a position, and for why `unresolved` is a first-class outcome.
 */
export interface Anchor {
  /** 0-indexed line at time of creation */
  line: number;
  /** hash of that line's trimmed text */
  lineHash: string;
  /** up to 3 preceding lines, trimmed */
  contextBefore: string[];
  /** up to 3 following lines, trimmed */
  contextAfter: string[];
  /** enclosing function/class name, when cheaply known */
  symbol?: string;
  /** computed at load, never persisted */
  resolved?: AnchorResolution;
}

export interface InkPoint {
  /** relative to the top-left of the anchor line — see the anchoring section of the plan */
  x: number;
  y: number;
  /** pressure, 0..1 */
  p: number;
}

export interface InkGeometry {
  points: InkPoint[];
  /** in the same line-relative space, for cheap culling */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface StrokeStyle {
  tool: InkTool;
  color: string;
  width: number;
  opacity: number;
}

export type AnnotationKind = 'ink' | 'note' | 'mark';

export interface Annotation {
  id: string;
  layerId: string;
  fileId: string;
  kind: AnnotationKind;
  anchor: Anchor;
  /** kind === 'ink' */
  geometry?: InkGeometry;
  /** kind === 'note' */
  text?: string;
  /** kind === 'mark' — a highlight over a text range */
  range?: { from: number; to: number };
  style: StrokeStyle;
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}

export interface Bookmark {
  id: string;
  sourceId: string;
  fileId: string;
  line: number;
  name?: string;
  color?: string;
  anchor: Anchor;
  createdAt: number;
}

export interface ReadingPosition {
  /** one per file; the fileId is the key */
  fileId: string;
  sourceId: string;
  /** a line number, never a scrollTop */
  line: number;
  updatedAt: number;
}

/** Persisted File System Access handles, so a returning user re-grants rather than re-picks. */
export interface FsHandleRecord {
  key: string;
  handle: FileSystemDirectoryHandle;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}
