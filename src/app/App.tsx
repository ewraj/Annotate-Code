/**
 * The application shell.
 *
 * Toolbar across the top, collapsible tree on the left, document everywhere else. The
 * code is the centrepiece and is deliberately not surrounded by UI — every control that
 * is not needed to read is either in the toolbar or in the floating palette.
 *
 * Phase 2 mounts the ink surfaces onto the scroller `CodeView` hands back.
 */

import { useEffect, useState } from 'react';
import { isInkTool, usePalette } from '@/store/palette';
import { useSession } from '@/store/session';
import { FileTree } from '@/ui/FileTree/FileTree';
import { OpenScreen } from '@/ui/Open/OpenScreen';
import { CodeView } from '@/ui/Reader/CodeView';
import { languageName } from '@/ui/Reader/language';
import { ToolPalette } from '@/ui/ToolPalette/ToolPalette';

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const status = useSession((s) => s.status);
  const source = useSession((s) => s.source);
  const activeFile = useSession((s) => s.activeFile);
  const content = useSession((s) => s.content);
  const fileError = useSession((s) => s.fileError);
  const loadingFile = useSession((s) => s.loadingFile);
  const pendingLine = useSession((s) => s.pendingLine);
  const consumePendingLine = useSession((s) => s.consumePendingLine);
  const rememberLine = useSession((s) => s.rememberLine);
  const close = useSession((s) => s.close);

  const activeTool = usePalette((s) => s.activeTool);
  const clearTool = usePalette((s) => s.clearTool);

  // Escape disarms the current tool — the fastest way back to plain reading.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && usePalette.getState().activeTool) clearTool();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearTool]);

  if (status !== 'ready' || !source) {
    return (
      <div className="ac-app">
        <header className="ac-toolbar">
          <a className="ac-wordmark" href="/">
            AnnotateCode
          </a>
        </header>
        <div className="ac-body">
          <main className="ac-document">
            <OpenScreen />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="ac-app">
      <header className="ac-toolbar">
        <button
          type="button"
          className="ac-icon-button"
          aria-label={sidebarOpen ? 'Hide files' : 'Show files'}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
            <path d="M9.5 4.5 V19.5" />
          </svg>
        </button>

        <button type="button" className="ac-source" onClick={close} title="Open something else">
          {source.name}
        </button>

        <span className="ac-path" aria-live="polite">
          {activeFile ? activeFile.path : 'Pick a file'}
        </span>

        <div className="ac-toolbar-right">
          {activeFile && <span className="ac-lang">{languageName(activeFile.path) ?? 'Text'}</span>}
          <button
            type="button"
            className={`ac-mode ${activeTool ? '' : 'is-active'}`}
            onClick={clearTool}
            aria-pressed={!activeTool}
          >
            Read
          </button>
        </div>
      </header>

      <div className="ac-body">
        <aside className={`ac-sidebar ${sidebarOpen ? '' : 'is-collapsed'}`} aria-label="Files">
          <FileTree />
        </aside>

        <main className={`ac-document ${activeTool && isInkTool(activeTool) ? 'is-armed' : ''}`}>
          {fileError ? (
            <div className="ac-empty ac-empty-center">
              <p className="ac-empty-title">{fileError.message}</p>
              {fileError.hint && <p className="ac-muted">{fileError.hint}</p>}
            </div>
          ) : content !== null && activeFile ? (
            <CodeView
              fileId={activeFile.id}
              path={activeFile.path}
              text={content}
              initialLine={pendingLine}
              onInitialLineUsed={consumePendingLine}
              onLineChange={rememberLine}
            />
          ) : (
            <div className="ac-empty ac-empty-center">
              <p className="ac-muted">{loadingFile ? 'Opening…' : 'Choose a file to start reading.'}</p>
            </div>
          )}
        </main>
      </div>

      <ToolPalette />
    </div>
  );
}
