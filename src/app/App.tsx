/**
 * The application shell.
 *
 * Toolbar across the top, collapsible tree on the left, document everywhere else. The
 * code is the centrepiece and is deliberately not surrounded by UI — every control that
 * is not needed to read is either in the toolbar or in the floating palette.
 *
 * The ink surfaces mount over the reader; the mode toggle decides whether the text itself
 * can be changed. A tool being armed always wins over edit mode — while you are holding a
 * pen, the keyboard should not be typing into the document underneath it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { isInkTool, usePalette } from '@/store/palette';
import { lineMapper } from '@/ink/reflow';
import { useInk } from '@/store/ink';
import { useSession } from '@/store/session';
import { FileTree } from '@/ui/FileTree/FileTree';
import { DisplacedTray } from '@/ui/Ink/DisplacedTray';
import { InkSurface } from '@/ui/Ink/InkSurface';
import { OpenScreen } from '@/ui/Open/OpenScreen';
import { CodeView } from '@/ui/Reader/CodeView';
import { languageName } from '@/ui/Reader/language';
import { ToolPalette } from '@/ui/ToolPalette/ToolPalette';

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [view, setView] = useState<EditorView | null>(null);

  const status = useSession((s) => s.status);
  const source = useSession((s) => s.source);
  const activeFile = useSession((s) => s.activeFile);
  const content = useSession((s) => s.content);
  const fileError = useSession((s) => s.fileError);
  const loadingFile = useSession((s) => s.loadingFile);
  const pendingLine = useSession((s) => s.pendingLine);
  const mode = useSession((s) => s.mode);
  const dirty = useSession((s) => s.dirty);
  const saving = useSession((s) => s.saving);
  const saveError = useSession((s) => s.saveError);
  const setMode = useSession((s) => s.setMode);
  const edit = useSession((s) => s.edit);
  const save = useSession((s) => s.save);
  const consumePendingLine = useSession((s) => s.consumePendingLine);
  const rememberLine = useSession((s) => s.rememberLine);
  const close = useSession((s) => s.close);

  const activeTool = usePalette((s) => s.activeTool);
  const clearTool = usePalette((s) => s.clearTool);

  const openInk = useInk((s) => s.open);
  const closeInk = useInk((s) => s.close);
  const undo = useInk((s) => s.undo);
  const redo = useInk((s) => s.redo);
  const canUndo = useInk((s) => s.stacks.undo.length > 0);
  const canRedo = useInk((s) => s.stacks.redo.length > 0);

  // Load this file's annotations, and resolve them against the text as it stands now.
  //
  // Once per file, not once per keystroke: `content` changes on every edit, and reloading
  // from the database mid-session would throw away strokes that have been moved to follow
  // the text but not yet saved.
  const fileId = activeFile?.id ?? null;
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!fileId || !source) {
      closeInk();
      loadedFor.current = null;
      return;
    }
    if (content === null || loadedFor.current === fileId) return;
    loadedFor.current = fileId;
    void openInk(fileId, source.id, content);
  }, [fileId, content, source, openInk, closeInk]);

  /**
   * Carry the ink across an edit.
   *
   * Each stroke's line is mapped through CodeMirror's own change set rather than guessed at.
   * Type a line above a stroke and it moves down by exactly one line, in the same frame the
   * text does — no re-resolution, no drift, nothing to reconcile afterwards.
   */
  const onDocChange = useCallback(
    (text: string, update: ViewUpdate) => {
      edit(text);

      useInk
        .getState()
        .shift(lineMapper(update.startState.doc, update.state.doc, update.changes));
    },
    [edit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape disarms the current tool — the fastest way back to plain reading.
      if (e.key === 'Escape' && usePalette.getState().activeTool) {
        clearTool();
        return;
      }

      const accel = e.metaKey || e.ctrlKey;
      if (accel && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void useSession.getState().save();
        return;
      }

      // Undo/redo belong to the ink whenever there is ink to undo. In edit mode with a clean
      // stack it falls through to CodeMirror's own history, which owns the text.
      if (accel && e.key.toLowerCase() === 'z') {
        const ink = useInk.getState();
        const hasInkHistory = e.shiftKey ? ink.stacks.redo.length > 0 : ink.stacks.undo.length > 0;
        if (!hasInkHistory) return;
        e.preventDefault();
        void (e.shiftKey ? ink.redo() : ink.undo());
      }
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
          {saveError && <span className="ac-save-error">{saveError.message}</span>}
          {activeFile?.edited && !dirty && (
            <span className="ac-badge" title="Saved here, not upstream">
              local
            </span>
          )}
          {activeFile && <span className="ac-lang">{languageName(activeFile.path) ?? 'Text'}</span>}

          {activeFile && (
            <div className="ac-modes" role="group" aria-label="Mode">
              <button
                type="button"
                className={`ac-mode ${mode === 'read' ? 'is-active' : ''}`}
                onClick={() => {
                  clearTool();
                  setMode('read');
                }}
                aria-pressed={mode === 'read'}
              >
                Read
              </button>
              <button
                type="button"
                className={`ac-mode ${mode === 'edit' ? 'is-active' : ''}`}
                onClick={() => {
                  clearTool();
                  setMode('edit');
                }}
                aria-pressed={mode === 'edit'}
              >
                Edit
              </button>
            </div>
          )}

          {mode === 'edit' && activeFile && (
            <button
              type="button"
              className="ac-save"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
          )}
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
            <>
              <CodeView
                fileId={activeFile.id}
                path={activeFile.path}
                text={content}
                initialLine={pendingLine}
                onInitialLineUsed={consumePendingLine}
                onLineChange={rememberLine}
                onViewReady={setView}
                editable={mode === 'edit' && !activeTool}
                onDocChange={onDocChange}
              />
              <InkSurface view={view} fileId={activeFile.id} text={content} />
              <DisplacedTray />
            </>
          ) : (
            <div className="ac-empty ac-empty-center">
              <p className="ac-muted">{loadingFile ? 'Opening…' : 'Choose a file to start reading.'}</p>
            </div>
          )}
        </main>
      </div>

      <ToolPalette
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
      />
    </div>
  );
}
