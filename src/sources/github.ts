/**
 * The GitHub adapter.
 *
 * No OAuth — the gist forbids it. GitHub here is a *source of code*, not a Git feature:
 * no commits, no branches, no pull requests.
 *
 * The whole repository costs **two API calls**, regardless of size:
 *
 *   1. GET /repos/{owner}/{repo}                        -> the default branch
 *   2. GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1  -> every path at once
 *
 * File content then comes from raw.githubusercontent.com, which is not the API: it does
 * not consume rate limit and it sends permissive CORS headers. This matters because
 * unauthenticated GitHub allows 60 requests per hour per IP — fetching content through
 * the contents API would exhaust that in about a minute of reading.
 */

import type { FileEntry, Source } from '@/model/types';
import { shouldSkip, summariseSkips, type SkipReason } from './filters';
import { SourceError, type OpenResult, type SourceAdapter } from './types';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export interface RepoRef {
  owner: string;
  repo: string;
  /** Absent when the user did not name one; resolved to the default branch on open. */
  ref?: string;
}

/**
 * Accepts what people actually paste: a browser URL, a clone URL, a deep link to a file
 * or branch, or just `owner/repo`.
 */
export function parseRepoUrl(input: string): RepoRef {
  const text = input.trim();
  if (!text) throw new SourceError('Paste a GitHub repository URL.');

  let path = text;

  // Strip a scheme and host if present, so the same segment logic handles every form.
  const hostMatch = text.match(
    /^(?:https?:\/\/|git@)?(?:www\.)?github\.com[/:]+(.*)$/i,
  );
  if (hostMatch) {
    path = hostMatch[1]!;
  } else if (/^(?:https?:\/\/|git@)/i.test(text)) {
    throw new SourceError('That is not a GitHub URL.', 'AnnotateCode opens public GitHub repositories.');
  }

  const segments = path.replace(/\.git$/i, '').split('/').filter(Boolean);
  const [owner, repo, kind, ...rest] = segments;

  if (!owner || !repo) {
    throw new SourceError(
      'That does not look like a repository.',
      'Try something like https://github.com/facebook/react',
    );
  }

  // /tree/<ref>/... and /blob/<ref>/... both name a ref in the same position. A ref
  // containing slashes (release/2.0) is reassembled, at the cost of ambiguity with a
  // deep path — acceptable, since the tree listing corrects it.
  const ref = (kind === 'tree' || kind === 'blob') && rest.length > 0 ? rest.join('/') : undefined;

  return ref ? { owner, repo, ref } : { owner, repo };
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

async function api<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
    });
  } catch {
    throw new SourceError('Could not reach GitHub.', 'Check your connection and try again.');
  }

  if (response.ok) return response.json() as Promise<T>;

  if (response.status === 404) {
    throw new SourceError(
      'No such repository.',
      'It may be private, renamed, or misspelled. AnnotateCode can only open public repositories.',
    );
  }

  // 403 is both "forbidden" and "rate limited"; the remaining-quota header tells them apart.
  if (response.status === 403 || response.status === 429) {
    if (response.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const wait = Number.isFinite(reset)
        ? `Try again ${formatWait(reset * 1000 - Date.now())}.`
        : 'Try again shortly.';
      throw new SourceError(
        'GitHub rate limit reached.',
        `Anonymous access allows 60 requests an hour. ${wait} Repositories you have already opened still work offline.`,
      );
    }
    throw new SourceError('GitHub refused the request.', 'The repository may be private.');
  }

  throw new SourceError(`GitHub returned ${response.status}.`);
}

function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes === 1 ? 'in about a minute' : `in about ${minutes} minutes`;
}

/** Call 1 — resolve the default branch. Skipped entirely when the user named a ref. */
async function resolveRef(owner: string, repo: string): Promise<string> {
  const meta = await api<{ default_branch?: string }>(`${API}/repos/${owner}/${repo}`);
  return meta.default_branch ?? 'main';
}

/** Call 2 — the entire tree. */
async function fetchTree(
  owner: string,
  repo: string,
  ref: string,
): Promise<{ tree: TreeEntry[]; truncated: boolean }> {
  const data = await api<{ tree?: TreeEntry[]; truncated?: boolean }>(
    `${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  return { tree: data.tree ?? [], truncated: data.truncated === true };
}

export async function openGithubSource(input: string): Promise<OpenResult> {
  const parsed = parseRepoUrl(input);
  const { owner, repo } = parsed;
  const ref = parsed.ref ?? (await resolveRef(owner, repo));

  const { tree, truncated } = await fetchTree(owner, repo, ref);

  const now = Date.now();
  const sourceId = `github:${owner}/${repo}@${ref}`;

  const source: Source = {
    id: sourceId,
    kind: 'github',
    name: `${owner}/${repo}`,
    origin: { owner, repo, ref },
    createdAt: now,
    lastOpenedAt: now,
  };

  const skips = new Map<SkipReason['reason'], number>();
  const files: FileEntry[] = [];

  for (const entry of tree) {
    if (entry.type !== 'blob') continue;

    const verdict = shouldSkip(entry.path, entry.size);
    if (verdict.skipped) {
      skips.set(verdict.reason, (skips.get(verdict.reason) ?? 0) + 1);
      continue;
    }

    files.push({
      id: `${sourceId}:${entry.path}`,
      sourceId,
      path: entry.path,
      size: entry.size ?? 0,
      blobSha: entry.sha,
      edited: false,
      contentHash: '',
      updatedAt: now,
    });
  }

  const warnings: string[] = [];
  if (truncated) {
    warnings.push(
      'This repository is too large for GitHub to list in one response, so some files are missing.',
    );
  }
  const skipped = summariseSkips(skips);
  if (skipped) warnings.push(skipped);

  if (files.length === 0) {
    throw new SourceError(
      'Nothing to read in that repository.',
      'Every file was binary, generated, or in an ignored folder.',
    );
  }

  return { source, files, warnings };
}

export class GithubAdapter implements SourceAdapter {
  private readonly cache = new Map<string, string>();

  constructor(
    readonly source: Source,
    private readonly files: FileEntry[],
  ) {}

  async listFiles(): Promise<FileEntry[]> {
    return this.files;
  }

  async readFile(id: string): Promise<string> {
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;

    const file = this.files.find((f) => f.id === id);
    if (!file) throw new SourceError('That file is not part of this repository.');

    const origin = this.source.origin;
    if (!origin) throw new SourceError('This source has lost its GitHub origin.');

    // raw.githubusercontent, not the API — this call is not rate limited.
    const url = `${RAW}/${origin.owner}/${origin.repo}/${encodeURIComponent(origin.ref)}/${file.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new SourceError('Could not reach GitHub.', 'Check your connection and try again.');
    }

    if (!response.ok) {
      throw new SourceError(
        `Could not read ${file.path}.`,
        response.status === 404 ? 'The file may have been removed since the tree was listed.' : undefined,
      );
    }

    const text = await response.text();
    this.cache.set(id, text);
    return text;
  }
}
