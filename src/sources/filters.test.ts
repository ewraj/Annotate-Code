import { describe, expect, it } from 'vitest';
import { extensionOf, looksBinary, MAX_FILE_BYTES, shouldSkip, summariseSkips } from './filters';

describe('extensionOf', () => {
  it('reads the extension', () => {
    expect(extensionOf('src/a/b.TS')).toBe('ts');
  });

  it('has none for a file without one', () => {
    expect(extensionOf('Makefile')).toBe('');
  });

  it('treats a dotfile as having no extension, not as one big extension', () => {
    expect(extensionOf('.gitignore')).toBe('');
  });

  it('uses the last extension', () => {
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });
});

describe('shouldSkip', () => {
  const kept = [
    'src/index.ts',
    'README.md',
    'Makefile',
    '.gitignore',
    'lib/deep/nested/thing.py',
    'app/styles.css',
    'main.rs',
  ];

  for (const path of kept) {
    it(`keeps ${path}`, () => {
      expect(shouldSkip(path).skipped).toBe(false);
    });
  }

  const dropped: Array<[string, string]> = [
    ['node_modules/left-pad/index.js', 'directory'],
    ['a/b/node_modules/c.js', 'directory'],
    ['.git/config', 'directory'],
    ['dist/app.js', 'directory'],
    ['src/logo.png', 'extension'],
    ['fonts/x.woff2', 'extension'],
    ['bin/tool.exe', 'extension'],
    ['package-lock.json', 'filename'],
    ['Cargo.lock', 'filename'],
    ['vendor/jquery.min.js', 'directory'],
    ['scripts/jquery.min.js', 'minified'],
  ];

  for (const [path, reason] of dropped) {
    it(`drops ${path} for being ${reason}`, () => {
      expect(shouldSkip(path)).toEqual({ skipped: true, reason });
    });
  }

  it('drops a file over the size cap', () => {
    expect(shouldSkip('generated.ts', MAX_FILE_BYTES + 1)).toEqual({ skipped: true, reason: 'size' });
  });

  it('keeps a file exactly at the cap', () => {
    expect(shouldSkip('big.ts', MAX_FILE_BYTES).skipped).toBe(false);
  });

  it('does not mistake a directory name for a filename', () => {
    // A file genuinely called "dist" at the root is a file, not the build folder.
    expect(shouldSkip('dist').skipped).toBe(false);
  });
});

describe('looksBinary', () => {
  it('finds a null byte', () => {
    expect(looksBinary(new Uint8Array([0x68, 0x00, 0x69]))).toBe(true);
  });

  it('passes plain text', () => {
    expect(looksBinary(new TextEncoder().encode('const x = 1;\n'))).toBe(false);
  });

  it('passes UTF-8 that is not ASCII', () => {
    expect(looksBinary(new TextEncoder().encode('const π = 3.14; // 日本語'))).toBe(false);
  });

  it('only sniffs the first 8KB', () => {
    const bytes = new Uint8Array(10000);
    bytes.fill(0x61);
    bytes[9000] = 0;
    expect(looksBinary(bytes)).toBe(false);
  });

  it('handles an empty file', () => {
    expect(looksBinary(new Uint8Array())).toBe(false);
  });
});

describe('summariseSkips', () => {
  it('says nothing when nothing was skipped', () => {
    expect(summariseSkips(new Map())).toBeNull();
  });

  it('counts every category in the total', () => {
    const summary = summariseSkips(
      new Map([
        ['directory', 4000],
        ['extension', 12],
        ['size', 1],
      ] as const),
    );
    expect(summary).toContain('4013 files hidden');
    expect(summary).toContain('4000 in ignored folders');
    expect(summary).toContain('12 binary');
    expect(summary).toContain('1 over 2MB');
  });
});
