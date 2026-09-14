/**
 * The application shell.
 *
 * Phase 0: the frame, and nothing behind it. The file tree is empty, the centre pane has
 * no document, and the palette draws nothing. What this does establish is the layout the
 * rest of the phases fill in — toolbar across the top, collapsible tree on the left, and
 * the document occupying everything else, because the code is the centrepiece and should
 * not be surrounded by UI.
 */

import { useState } from 'react';
import { ToolPalette } from '@/ui/ToolPalette/ToolPalette';
import { isInkTool, usePalette } from '@/store/palette';

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const activeTool = usePalette((s) => s.activeTool);
  const clearTool = usePalette((s) => s.clearTool);

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

        <a className="ac-wordmark" href="/">
          AnnotateCode
        </a>

        <span className="ac-path" aria-live="polite">
          No codebase open
        </span>

        <div className="ac-toolbar-right">
          <button
            type="button"
            className={`ac-mode ${activeTool ? '' : 'is-active'}`}
            onClick={clearTool}
            aria-pressed={!activeTool}
          >
            Read
          </button>
          <span className="ac-mode-hint">
            {activeTool
              ? `${activeTool[0]!.toUpperCase()}${activeTool.slice(1)} armed`
              : 'Pick a tool to annotate'}
          </span>
        </div>
      </header>

      <div className="ac-body">
        <aside className={`ac-sidebar ${sidebarOpen ? '' : 'is-collapsed'}`} aria-label="Files">
          <div className="ac-empty">
            <p>No files yet.</p>
            <p className="ac-muted">
              Opening a codebase arrives in Phase&nbsp;1 — a GitHub URL, or a folder from
              this machine.
            </p>
          </div>
        </aside>

        <main className={`ac-document ${activeTool && isInkTool(activeTool) ? 'is-armed' : ''}`}>
          <div className="ac-empty ac-empty-center">
            <p className="ac-empty-title">Read code. Annotate it. That's it.</p>
            <p className="ac-muted">
              This is the shell. The reader lands in Phase&nbsp;1, ink in Phase&nbsp;2.
              <br />
              The palette below is real — pick a tool, tap it again for size and opacity.
            </p>
          </div>
        </main>
      </div>

      <ToolPalette />
    </div>
  );
}
