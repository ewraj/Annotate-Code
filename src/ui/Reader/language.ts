/**
 * Grammars, loaded on demand.
 *
 * `@codemirror/language-data` knows about every language the gist names and many it does
 * not, but importing them all would put megabytes in the bundle for a reader that will
 * open two or three languages in a session. Each grammar is fetched the first time a file
 * of that type is opened, and remembered after that.
 *
 * A language we cannot resolve is not an error. Plain text with line numbers is still a
 * perfectly good thing to annotate.
 */

import type { Extension } from '@codemirror/state';
import { languages } from '@codemirror/language-data';

const loaded = new Map<string, Extension | null>();

/** Names CodeMirror's own extension matching does not cover. */
const BY_FILENAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'shell',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  brewfile: 'ruby',
  'cmakelists.txt': 'cmake',
};

function descriptionFor(path: string) {
  const name = (path.slice(path.lastIndexOf('/') + 1) || path).toLowerCase();

  const byName = BY_FILENAME[name];
  if (byName) {
    const match = languages.find((l) => l.name.toLowerCase() === byName || l.alias.includes(byName));
    if (match) return match;
  }

  // CodeMirror matches on the full filename, including dotfiles and multi-part extensions.
  return languages.find((l) => l.extensions.some((ext) => name.endsWith(`.${ext}`)));
}

/** The display name for a path's language, for the toolbar. Cheap, no loading. */
export function languageName(path: string): string | null {
  return descriptionFor(path)?.name ?? null;
}

export async function grammarFor(path: string): Promise<Extension | null> {
  const description = descriptionFor(path);
  if (!description) return null;

  const cached = loaded.get(description.name);
  if (cached !== undefined) return cached;

  try {
    const support = await description.load();
    loaded.set(description.name, support);
    return support;
  } catch {
    // A grammar that fails to load costs us highlighting, nothing more.
    loaded.set(description.name, null);
    return null;
  }
}
