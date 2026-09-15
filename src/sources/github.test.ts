import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubAdapter, openGithubSource, parseRepoUrl } from './github';
import { SourceError } from './types';

describe('parseRepoUrl', () => {
  const cases: Array<[string, { owner: string; repo: string; ref?: string }]> = [
    ['https://github.com/facebook/react', { owner: 'facebook', repo: 'react' }],
    ['http://github.com/facebook/react', { owner: 'facebook', repo: 'react' }],
    ['https://www.github.com/facebook/react', { owner: 'facebook', repo: 'react' }],
    ['github.com/facebook/react', { owner: 'facebook', repo: 'react' }],
    ['https://github.com/facebook/react/', { owner: 'facebook', repo: 'react' }],
    ['https://github.com/facebook/react.git', { owner: 'facebook', repo: 'react' }],
    ['git@github.com:facebook/react.git', { owner: 'facebook', repo: 'react' }],
    ['facebook/react', { owner: 'facebook', repo: 'react' }],
    ['  facebook/react  ', { owner: 'facebook', repo: 'react' }],
    [
      'https://github.com/facebook/react/tree/v18.3.1',
      { owner: 'facebook', repo: 'react', ref: 'v18.3.1' },
    ],
    [
      'https://github.com/vercel/next.js/tree/release/canary',
      { owner: 'vercel', repo: 'next.js', ref: 'release/canary' },
    ],
    [
      'https://github.com/facebook/react/blob/main/README.md',
      { owner: 'facebook', repo: 'react', ref: 'main/README.md' },
    ],
  ];

  for (const [input, expected] of cases) {
    it(`parses ${input.trim()}`, () => {
      expect(parseRepoUrl(input)).toEqual(expected);
    });
  }

  it('rejects an empty string with something actionable', () => {
    expect(() => parseRepoUrl('   ')).toThrow(SourceError);
  });

  it('rejects a bare owner with no repository', () => {
    expect(() => parseRepoUrl('https://github.com/facebook')).toThrow(/does not look like a repository/);
  });

  it('rejects a URL from somewhere else', () => {
    expect(() => parseRepoUrl('https://gitlab.com/a/b')).toThrow(/not a GitHub URL/);
  });
});

// ---------------------------------------------------------------------------

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input))));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const TREE = {
  truncated: false,
  tree: [
    { path: 'README.md', type: 'blob', sha: 'a1', size: 100 },
    { path: 'src', type: 'tree', sha: 'd1' },
    { path: 'src/index.ts', type: 'blob', sha: 'a2', size: 200 },
    { path: 'src/logo.png', type: 'blob', sha: 'a3', size: 5000 },
    { path: 'node_modules/left-pad/index.js', type: 'blob', sha: 'a4', size: 50 },
    { path: 'package-lock.json', type: 'blob', sha: 'a5', size: 90000 },
    { path: 'dist/bundle.min.js', type: 'blob', sha: 'a6', size: 400 },
    { path: 'huge.ts', type: 'blob', sha: 'a7', size: 5 * 1024 * 1024 },
    { path: 'sub', type: 'commit', sha: 'c1' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openGithubSource', () => {
  it('opens a repository in exactly two API calls', async () => {
    const fetchSpy = mockFetch((url) =>
      url.includes('/git/trees/') ? json(TREE) : json({ default_branch: 'trunk' }),
    );

    const result = await openGithubSource('facebook/react');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.source.origin).toEqual({ owner: 'facebook', repo: 'react', ref: 'trunk' });
    expect(result.source.name).toBe('facebook/react');
  });

  it('skips the branch lookup when the URL already names a ref', async () => {
    const fetchSpy = mockFetch(() => json(TREE));

    const result = await openGithubSource('https://github.com/facebook/react/tree/v18');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.source.origin?.ref).toBe('v18');
  });

  it('keeps only readable source files', async () => {
    mockFetch((url) => (url.includes('/git/trees/') ? json(TREE) : json({ default_branch: 'main' })));

    const { files } = await openGithubSource('facebook/react');

    expect(files.map((f) => f.path)).toEqual(['README.md', 'src/index.ts']);
  });

  it('reports what it hid, rather than hiding it silently', async () => {
    mockFetch((url) => (url.includes('/git/trees/') ? json(TREE) : json({ default_branch: 'main' })));

    const { warnings } = await openGithubSource('facebook/react');

    expect(warnings.join(' ')).toMatch(/hidden/);
  });

  it('warns when GitHub truncates the tree', async () => {
    mockFetch((url) =>
      url.includes('/git/trees/') ? json({ ...TREE, truncated: true }) : json({ default_branch: 'main' }),
    );

    const { warnings } = await openGithubSource('facebook/react');

    expect(warnings[0]).toMatch(/too large/);
  });

  it('explains a 404 instead of leaking a status code', async () => {
    mockFetch(() => json({}, { status: 404 }));

    await expect(openGithubSource('nobody/nothing')).rejects.toThrow(/No such repository/);
  });

  it('explains an exhausted rate limit, with when it resets', async () => {
    mockFetch(() =>
      json(
        {},
        {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor((Date.now() + 10 * 60_000) / 1000)),
          },
        },
      ),
    );

    await expect(openGithubSource('facebook/react')).rejects.toMatchObject({
      message: expect.stringMatching(/rate limit/i),
      hint: expect.stringMatching(/10 minutes/),
    });
  });

  it('distinguishes a forbidden repository from a rate limit', async () => {
    mockFetch(() => json({}, { status: 403, headers: { 'x-ratelimit-remaining': '55' } }));

    await expect(openGithubSource('facebook/react')).rejects.toThrow(/refused/);
  });

  it('says so when a repository holds nothing readable', async () => {
    mockFetch((url) =>
      url.includes('/git/trees/')
        ? json({ truncated: false, tree: [{ path: 'a.png', type: 'blob', sha: 'x', size: 1 }] })
        : json({ default_branch: 'main' }),
    );

    await expect(openGithubSource('facebook/react')).rejects.toThrow(/Nothing to read/);
  });

  it('turns a network failure into a sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    await expect(openGithubSource('facebook/react')).rejects.toThrow(/Could not reach GitHub/);
  });
});

describe('GithubAdapter.readFile', () => {
  const source = {
    id: 's',
    kind: 'github' as const,
    name: 'facebook/react',
    origin: { owner: 'facebook', repo: 'react', ref: 'main' },
    createdAt: 0,
    lastOpenedAt: 0,
  };
  const files = [
    {
      id: 'f1',
      sourceId: 's',
      path: 'src/index.ts',
      size: 10,
      edited: false,
      contentHash: '',
      updatedAt: 0,
    },
  ];

  it('reads content from raw.githubusercontent, never the API', async () => {
    const fetchSpy = mockFetch(() => new Response('export const x = 1;'));

    const text = await new GithubAdapter(source, files).readFile('f1');

    expect(text).toBe('export const x = 1;');
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toBe('https://raw.githubusercontent.com/facebook/react/main/src/index.ts');
    expect(url).not.toContain('api.github.com');
  });

  it('caches, so scrolling back to a file costs nothing', async () => {
    const fetchSpy = mockFetch(() => new Response('x'));
    const adapter = new GithubAdapter(source, files);

    await adapter.readFile('f1');
    await adapter.readFile('f1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a file that is not part of the repository', async () => {
    await expect(new GithubAdapter(source, files).readFile('nope')).rejects.toThrow(/not part of/);
  });
});
