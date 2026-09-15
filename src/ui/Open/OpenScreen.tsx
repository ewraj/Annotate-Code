/**
 * Opening a codebase.
 *
 * Deliberately one screen with one field. GitHub leads because it is the only path that
 * works on a tablet — no iOS browser can pick a directory — and because pasting a URL is
 * less work than any picker.
 *
 * Recents are the real feature here. The product's promise is that you come back to a
 * codebase you were part-way through, so the list of what you were reading deserves more
 * room than the controls for starting something new.
 */

import { useEffect, useState } from 'react';
import type { Source } from '@/model/types';
import { supportsDirectoryPicker } from '@/sources';
import { useSession } from '@/store/session';
import './open.css';

function relativeTime(then: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function kindLabel(source: Source): string {
  if (source.kind === 'github') return source.origin ? `github · ${source.origin.ref}` : 'github';
  return source.kind === 'local-fs' ? 'folder' : 'uploaded folder';
}

export function OpenScreen() {
  const status = useSession((s) => s.status);
  const error = useSession((s) => s.error);
  const recents = useSession((s) => s.recents);
  const openUrl = useSession((s) => s.openUrl);
  const pickFolder = useSession((s) => s.pickFolder);
  const uploadFolder = useSession((s) => s.uploadFolder);
  const reopenSource = useSession((s) => s.reopenSource);
  const forget = useSession((s) => s.forget);
  const loadRecents = useSession((s) => s.loadRecents);
  const dismissError = useSession((s) => s.dismissError);

  const [url, setUrl] = useState('');
  const busy = status === 'opening';

  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);

  // The landing page hands off a pasted repository as ?repo=, so the URL is typed once.
  useEffect(() => {
    const repo = new URLSearchParams(location.search).get('repo');
    if (!repo) return;

    history.replaceState(null, '', location.pathname);
    setUrl(repo);
    void openUrl(repo);
  }, [openUrl]);

  return (
    <div className="ac-open">
      <div className="ac-open-inner">
        <h1>Open a codebase</h1>

        <form
          className="ac-open-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void openUrl(url);
          }}
        >
          <input
            type="text"
            value={url}
            placeholder="github.com/facebook/react"
            aria-label="GitHub repository URL"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) dismissError();
            }}
          />
          <button type="submit" className="ac-primary" disabled={busy || !url.trim()}>
            {busy ? 'Opening…' : 'Open'}
          </button>
        </form>

        <p className="ac-open-aside">
          Any public repository. No sign-in.{' '}
          {supportsDirectoryPicker() ? (
            <button type="button" className="ac-link" disabled={busy} onClick={() => void pickFolder()}>
              Or open a folder from this computer
            </button>
          ) : (
            <label className="ac-link">
              Or upload a folder
              <input
                type="file"
                // Non-standard, but the only directory upload Firefox and Safari support.
                {...{ webkitdirectory: '', directory: '' }}
                onChange={(e) => {
                  if (e.target.files?.length) void uploadFolder(e.target.files);
                }}
              />
            </label>
          )}
        </p>

        {error && (
          <div className="ac-open-error" role="alert">
            <strong>{error.message}</strong>
            {error.hint && <span>{error.hint}</span>}
          </div>
        )}

        {recents.length > 0 && (
          <section className="ac-recents">
            <h2>Continue reading</h2>
            <ul>
              {recents.map((source) => (
                <li key={source.id}>
                  <button type="button" className="ac-recent" disabled={busy} onClick={() => void reopenSource(source)}>
                    <span className="ac-recent-name">{source.name}</span>
                    <span className="ac-recent-meta">
                      {kindLabel(source)} · {relativeTime(source.lastOpenedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ac-forget"
                    aria-label={`Forget ${source.name}`}
                    title="Forget this codebase and its annotations"
                    onClick={() => void forget(source.id)}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 4 L12 12 M12 4 L4 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
