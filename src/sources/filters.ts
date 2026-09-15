/**
 * What not to open.
 *
 * A repository contains a great deal that nobody wants to read: build output, vendored
 * dependencies, lockfiles, images, compiled binaries. Filtering aggressively at import is
 * the cheapest performance win available — every file excluded here is one the tree never
 * renders, the database never stores and the LRU cache never holds.
 *
 * The bias is deliberate: exclude generously. A reader who wants a lockfile can still
 * find it in the repository. A reader drowning in 40,000 `node_modules` entries has lost
 * the thing this product is for.
 */

/** Directory names skipped wherever they appear in a path. */
const SKIP_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.parcel-cache',
  '.turbo',
  'coverage',
  '.nyc_output',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.gradle',
  '.idea',
  '.vscode',
  'Pods',
  'DerivedData',
]);

/** Extensions that are never source, so never worth a tree row. */
const SKIP_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'icns', 'webp', 'avif', 'tiff', 'psd',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // audio and video
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'mp4', 'webm', 'mov', 'avi', 'mkv',
  // archives
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war',
  // compiled and binary
  'exe', 'dll', 'so', 'dylib', 'o', 'a', 'obj', 'lib', 'class', 'pyc', 'pyo', 'wasm',
  'bin', 'dat', 'db', 'sqlite', 'sqlite3',
  // documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // maps and lockfiles — generated, enormous, and nobody reads them
  'map', 'lock',
]);

/** Specific filenames that are generated rather than written. */
const SKIP_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',
  '.DS_Store',
  'Thumbs.db',
]);

/** Past this, a "source file" is generated, minified, or a database in disguise. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export interface SkipReason {
  skipped: true;
  reason: 'directory' | 'extension' | 'filename' | 'size' | 'minified';
}

export type FilterResult = SkipReason | { skipped: false };

export function shouldSkip(path: string, size?: number): FilterResult {
  const segments = path.split('/');

  // The last segment is the filename; everything before it is a directory.
  for (let i = 0; i < segments.length - 1; i++) {
    if (SKIP_DIRS.has(segments[i]!)) return { skipped: true, reason: 'directory' };
  }

  const name = segments[segments.length - 1] ?? '';
  if (SKIP_FILES.has(name)) return { skipped: true, reason: 'filename' };
  if (SKIP_EXTENSIONS.has(extensionOf(path))) return { skipped: true, reason: 'extension' };

  // `.min.js` and friends are machine output wearing a source extension.
  if (/\.min\.(js|css|mjs|cjs)$/i.test(name)) return { skipped: true, reason: 'minified' };

  if (size !== undefined && size > MAX_FILE_BYTES) return { skipped: true, reason: 'size' };

  return { skipped: false };
}

/**
 * Null-byte sniff over the first 8KB — the standard cheap test, and the same one `git`
 * uses. Only applies to local files, where we hold the bytes before deciding.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/** A one-line summary of what import threw away, for the tree header. */
export function summariseSkips(counts: Map<SkipReason['reason'], number>): string | null {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const parts: string[] = [];
  const inDirs = counts.get('directory') ?? 0;
  const size = counts.get('size') ?? 0;
  const binary = (counts.get('extension') ?? 0) + (counts.get('minified') ?? 0);
  const generated = counts.get('filename') ?? 0;

  if (inDirs) parts.push(`${inDirs} in ignored folders`);
  if (binary) parts.push(`${binary} binary`);
  if (size) parts.push(`${size} over 2MB`);
  if (generated) parts.push(`${generated} generated`);

  return parts.length > 0
    ? `${total} files hidden (${parts.join(', ')})`
    : `${total} files hidden`;
}
