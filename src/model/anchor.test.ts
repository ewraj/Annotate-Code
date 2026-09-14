import { describe, expect, it } from 'vitest';
import {
  CONTEXT_LINES,
  createAnchor,
  hashLine,
  rebuildAnchor,
  resolveAnchor,
  toLines,
} from './anchor';

const SOURCE = `import { getRuntime } from './runtime';

export async function runJob(job) {
  const runtime = await getRuntime(job);
  await runtime.prepare();
  const result = await runtime.run();
  return result;
}`;

const base = toLines(SOURCE);

/** Line 5 — `const result = await runtime.run();`. The line the landing page annotates. */
const RUN_LINE = 5;
const RUN_TEXT = 'const result = await runtime.run();';

function anchorAtRunLine(symbol?: string) {
  return createAnchor(base, RUN_LINE, symbol);
}

describe('hashLine', () => {
  it('is stable for the same content', () => {
    expect(hashLine('const x = 1;')).toBe(hashLine('const x = 1;'));
  });

  it('ignores surrounding whitespace, so reindenting is not a change', () => {
    expect(hashLine('  const x = 1;')).toBe(hashLine('\t\tconst x = 1;   '));
  });

  it('changes when the content changes', () => {
    expect(hashLine('const x = 1;')).not.toBe(hashLine('const x = 2;'));
  });
});

describe('createAnchor', () => {
  it('captures the line and its surrounding context, trimmed', () => {
    const a = anchorAtRunLine();
    expect(a.line).toBe(RUN_LINE);
    expect(a.lineHash).toBe(hashLine(RUN_TEXT));
    expect(a.contextBefore).toEqual([
      'export async function runJob(job) {',
      'const runtime = await getRuntime(job);',
      'await runtime.prepare();',
    ]);
    expect(a.contextAfter).toEqual(['return result;', '}']);
  });

  it('truncates context at the start of the file', () => {
    const a = createAnchor(base, 0);
    expect(a.contextBefore).toEqual([]);
    expect(a.contextAfter).toHaveLength(CONTEXT_LINES);
  });

  it('truncates context at the end of the file', () => {
    const a = createAnchor(base, base.length - 1);
    expect(a.contextAfter).toEqual([]);
  });
});

describe('resolveAnchor — the ladder', () => {
  /**
   * Each case mutates the document and states where the annotation must end up. The
   * `text` expectation is the real assertion: it is not enough to resolve, it has to
   * resolve onto the right code.
   */
  const cases: Array<{
    name: string;
    lines: string[];
    expect: 'exact' | 'moved' | 'unresolved';
    text?: string;
  }> = [
    {
      name: 'unchanged file resolves exactly',
      lines: base,
      expect: 'exact',
      text: RUN_TEXT,
    },
    {
      name: 'lines inserted above shift the anchor down',
      lines: ['// @ts-check', "import assert from 'node:assert';", ...base],
      expect: 'moved',
      text: RUN_TEXT,
    },
    {
      name: 'a line deleted above shifts the anchor up',
      lines: base.filter((_, i) => i !== 1),
      expect: 'moved',
      text: RUN_TEXT,
    },
    {
      name: 'reindenting the anchored line is not a change at all',
      lines: base.map((l, i) => (i === RUN_LINE ? `      ${l.trim()}` : l)),
      expect: 'exact',
      text: RUN_TEXT,
    },
    {
      name: 'the anchored line itself edited, context intact, is placed by context',
      lines: base.map((l, i) =>
        i === RUN_LINE ? '  const result = await runtime.run(options);' : l,
      ),
      expect: 'moved',
      text: 'const result = await runtime.run(options);',
    },
    {
      name: 'a block moved far beyond the local search radius is found by context',
      lines: [...Array.from({ length: 80 }, (_, i) => `// filler ${i}`), ...base],
      expect: 'moved',
      text: RUN_TEXT,
    },
    {
      name: 'a wholly rewritten file gives up rather than guessing',
      lines: toLines('const a = 1;\nconst b = 2;\nconst c = 3;'),
      expect: 'unresolved',
    },
    {
      name: 'an empty document gives up',
      lines: [],
      expect: 'unresolved',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = resolveAnchor(anchorAtRunLine(), c.lines);
      expect(r.resolved).toBe(c.expect);
      if (c.text !== undefined) {
        expect(c.lines[r.line]?.trim()).toBe(c.text);
      }
    });
  }
});

describe('resolveAnchor — duplicate and weak lines', () => {
  it('picks the right duplicate when context agrees', () => {
    // The same call appears twice; only one of them has the annotated neighbourhood.
    const lines = toLines(`async function warmup(job) {
  const runtime = await getRuntime(job);
  await runtime.prepare();
  const result = await runtime.run();
  return null;
}

${SOURCE}`);

    const r = resolveAnchor(anchorAtRunLine(), lines);
    expect(r.resolved).toBe('moved');
    // The second copy — the one followed by `return result;`, not `return null;`.
    expect(lines[r.line + 1]?.trim()).toBe('return result;');
  });

  it('places a closing brace using its context, not its position', () => {
    const anchor = createAnchor(base, base.length - 1); // the final `}`
    const lines = toLines(`function noop() {
}

${SOURCE}`);

    const r = resolveAnchor(anchor, lines);
    expect(r.resolved).toBe('moved');
    expect(r.line).toBe(lines.length - 1);
    expect(lines[r.line - 1]?.trim()).toBe('return result;');
  });

  it('refuses to place a brace when nothing around it survives', () => {
    const anchor = createAnchor(base, base.length - 1); // the final `}`
    const lines = toLines(`function a() {
}
function b() {
}
function c() {
}`);

    // Three equally plausible braces and no surviving context. Guessing here would put
    // someone's handwriting on the wrong function.
    expect(resolveAnchor(anchor, lines).resolved).toBe('unresolved');
  });

  it('does not resolve by context when the context itself is ambiguous', () => {
    const block = `  const runtime = await getRuntime(job);
  await runtime.prepare();
  const CHANGED = 1;
  return result;
}`;
    // Two identical neighbourhoods: context can no longer single one out.
    const lines = toLines(`${block}\n\n${block}`);

    expect(resolveAnchor(anchorAtRunLine(), lines).resolved).toBe('unresolved');
  });
});

describe('resolveAnchor — symbol fallback', () => {
  const rewritten = toLines(`// rewritten from scratch
export async function runJob(payload) {
  return 1;
}`);

  it('uses a unique symbol when line and context are both gone', () => {
    const r = resolveAnchor(anchorAtRunLine('runJob'), rewritten);
    expect(r.resolved).toBe('moved');
    expect(rewritten[r.line]).toContain('runJob');
  });

  it('is unresolved without a symbol, given the same document', () => {
    expect(resolveAnchor(anchorAtRunLine(), rewritten).resolved).toBe('unresolved');
  });

  it('will not use a symbol that appears more than once', () => {
    const ambiguous = toLines(`runJob();
runJob();`);
    expect(resolveAnchor(anchorAtRunLine('runJob'), ambiguous).resolved).toBe('unresolved');
  });

  it('matches whole words only', () => {
    const lines = toLines(`// header\nrunJobLater();\nsomethingElse();`);
    expect(resolveAnchor(anchorAtRunLine('runJob'), lines).resolved).toBe('unresolved');
  });
});

describe('the promise: never silently misplaced', () => {
  /**
   * Whenever the ladder claims a position, that claim has to be backed by evidence —
   * either the line still reads the same, or its surroundings still agree. A resolution
   * supported by neither is exactly the bug this product cannot ship.
   */
  const mutations: Array<[string, string[]]> = [
    ['unchanged', base],
    ['prepended', ['a', 'b', 'c', ...base]],
    ['line removed', base.filter((_, i) => i !== 2)],
    ['reindented', base.map((l) => `    ${l}`)],
    ['shuffled', [...base].reverse()],
    ['truncated', base.slice(0, 3)],
    ['unrelated', toLines('print("hello")\nprint("world")')],
    ['duplicated', [...base, ...base]],
    ['empty', []],
  ];

  for (const [name, lines] of mutations) {
    it(`holds when the file is ${name}`, () => {
      const anchor = anchorAtRunLine('runJob');
      const r = resolveAnchor(anchor, lines);
      if (r.resolved === 'unresolved') return;

      const landed = lines[r.line];
      expect(landed).toBeDefined();

      const sameLine = hashLine(landed!) === anchor.lineHash;
      const neighbourAgrees =
        anchor.contextBefore.some((c, i) => {
          const at = r.line - anchor.contextBefore.length + i;
          return at >= 0 && lines[at]?.trim() === c;
        }) ||
        anchor.contextAfter.some((c, i) => lines[r.line + 1 + i]?.trim() === c);
      const symbolPresent = landed!.includes('runJob');

      expect(sameLine || neighbourAgrees || symbolPresent).toBe(true);
    });
  }
});

describe('rebuildAnchor', () => {
  it('re-captures context at the new position after an edit', () => {
    const lines = ['// added', ...base];
    const next = rebuildAnchor(anchorAtRunLine(), lines);

    expect(next).not.toBeNull();
    expect(next!.line).toBe(RUN_LINE + 1);
    expect(next!.resolved).toBe('moved');
    expect(next!.contextAfter).toEqual(['return result;', '}']);
  });

  it('returns null rather than a wrong anchor when resolution fails', () => {
    expect(rebuildAnchor(anchorAtRunLine(), toLines('nothing\nlike\nthe original'))).toBeNull();
  });

  it('is idempotent on an unchanged document', () => {
    const a = anchorAtRunLine();
    const b = rebuildAnchor(a, base)!;
    expect(b.line).toBe(a.line);
    expect(b.lineHash).toBe(a.lineHash);
    expect(b.resolved).toBe('exact');
  });
});
