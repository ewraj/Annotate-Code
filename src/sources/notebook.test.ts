import { describe, expect, it } from 'vitest';
import { isNotebook, notebookToSource, parseSource, sourceToNotebook } from './notebook';

const notebook = {
  cells: [
    { cell_type: 'markdown', id: 'a1', metadata: {}, source: ['# Fraud\n', '\n', 'Load the data.'] },
    {
      cell_type: 'code',
      id: 'b2',
      metadata: { scrolled: true },
      execution_count: 3,
      source: ['import pandas as pd\n', "df = pd.read_csv('x.csv')\n", 'df.head()'],
      outputs: [
        {
          output_type: 'execute_result',
          data: { 'text/html': ['<style scoped>\n', '.dataframe tbody tr th {\n'] },
        },
      ],
    },
    { cell_type: 'code', id: 'c3', metadata: {}, execution_count: 4, source: 'print(df.shape)', outputs: [] },
  ],
  metadata: { kernelspec: { name: 'python3', language: 'python' } },
  nbformat: 4,
  nbformat_minor: 5,
};
const raw = JSON.stringify(notebook);

describe('isNotebook', () => {
  it('recognises the extension', () => {
    expect(isNotebook('Phase-3/pbl_phase3.ipynb')).toBe(true);
    expect(isNotebook('Phase-3/pbl_phase3.py')).toBe(false);
  });
});

describe('notebookToSource', () => {
  it('shows code and markdown, and none of the outputs', () => {
    const text = notebookToSource(raw);
    expect(text).toBe(
      [
        '# %% [markdown]',
        '# # Fraud',
        '#',
        '# Load the data.',
        '',
        '# %%',
        'import pandas as pd',
        "df = pd.read_csv('x.csv')",
        'df.head()',
        '',
        '# %%',
        'print(df.shape)',
        '',
      ].join('\n'),
    );
    expect(text).not.toContain('dataframe');
  });

  it('leaves anything that is not a notebook alone, so it is safe to run twice', () => {
    const once = notebookToSource(raw);
    expect(notebookToSource(once)).toBe(once);
    expect(notebookToSource('{"not": "a notebook"}')).toBe('{"not": "a notebook"}');
  });
});

describe('parseSource', () => {
  it('reads cells back out of the view', () => {
    expect(parseSource(notebookToSource(raw))).toEqual([
      { type: 'markdown', source: '# Fraud\n\nLoad the data.' },
      { type: 'code', source: "import pandas as pd\ndf = pd.read_csv('x.csv')\ndf.head()" },
      { type: 'code', source: 'print(df.shape)' },
    ]);
  });

  it('keeps code typed above the first marker', () => {
    expect(parseSource('x = 1\n\n# %%\ny = 2\n')).toEqual([
      { type: 'code', source: 'x = 1' },
      { type: 'code', source: 'y = 2' },
    ]);
  });
});

describe('sourceToNotebook', () => {
  it('round-trips an unedited view without losing anything', () => {
    const back = JSON.parse(sourceToNotebook(notebookToSource(raw), raw));
    expect(back.cells.map((c: { id: string }) => c.id)).toEqual(['a1', 'b2', 'c3']);
    expect(back.cells[1].metadata).toEqual({ scrolled: true });
    expect(back.cells[1].outputs).toEqual(notebook.cells[1]!.outputs);
    expect(back.cells.map((c: { source: string[] }) => c.source.join(''))).toEqual([
      '# Fraud\n\nLoad the data.',
      "import pandas as pd\ndf = pd.read_csv('x.csv')\ndf.head()",
      'print(df.shape)',
    ]);
    expect(back.metadata).toEqual(notebook.metadata);
  });

  it('clears outputs only for the cells that changed', () => {
    const edited = notebookToSource(raw).replace('print(df.shape)', 'print(len(df))');
    const back = JSON.parse(sourceToNotebook(edited, raw));

    expect(back.cells[1].outputs).toHaveLength(1);
    expect(back.cells[1].execution_count).toBe(3);
    expect(back.cells[2].outputs).toEqual([]);
    expect(back.cells[2].execution_count).toBeNull();
    expect(back.cells[2].id).toBe('c3');
  });

  it('gives a new cell an id and empty outputs', () => {
    const back = JSON.parse(sourceToNotebook(`${notebookToSource(raw)}\n# %%\nx = 1\n`, raw));
    expect(back.cells).toHaveLength(4);
    expect(back.cells[3]).toMatchObject({ cell_type: 'code', source: ['x = 1'], outputs: [], execution_count: null });
    expect(typeof back.cells[3].id).toBe('string');
  });
});
