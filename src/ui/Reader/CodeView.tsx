/**
 * The reader.
 *
 * CodeMirror 6 in read-only mode. Phase 3 turns editing on; Phase 2 mounts the ink
 * surfaces over `view.scrollDOM`, which is why this component hands that element out
 * rather than hiding it.
 *
 * Two things here are load-bearing for later phases and should not be casually changed:
 *
 *   - The editor owns the scroller. Ink will be drawn in the same coordinate space, and
 *     the "code and annotations are one document" requirement depends on there being
 *     exactly one thing that scrolls.
 *   - Reading position is reported as a line number derived from the editor's own
 *     geometry, never as a scrollTop.
 */

import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { grammarFor } from './language';
import { paperTheme, paperHighlight } from './theme';

interface Props {
  /** Identity of what is being shown; a change means a different document entirely. */
  fileId: string;
  path: string;
  text: string;
  /** Scroll here once, on open. */
  initialLine: number | null;
  onInitialLineUsed: () => void;
  onLineChange: (line: number) => void;
  /** Handed to Phase 2 so the ink canvases can be mounted over the right element. */
  onScrollerReady?: (scroller: HTMLElement | null) => void;
}

const language = new Compartment();

function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    foldGutter(),
    drawSelection(),
    bracketMatching(),
    highlightSelectionMatches(),
    history(),
    search({ top: true }),
    syntaxHighlighting(paperHighlight, { fallback: true }),
    indentUnit.of('  '),
    // Reading, not editing — for now. Note `readOnly`, not `editable`: the document stays
    // focusable and selectable, which is the point of treating code as a document.
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    // No line wrapping: the gist asks for horizontal scrolling, and wrapped code would
    // also make ink anchored to a line ambiguous about which visual row it belongs to.
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    paperTheme,
  ];
}

export function CodeView({
  fileId,
  path,
  text,
  initialLine,
  onInitialLineUsed,
  onLineChange,
  onScrollerReady,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // Callbacks are read through a ref so that changing one never tears down the editor.
  const handlers = useRef({ onLineChange, onInitialLineUsed, onScrollerReady });
  handlers.current = { onLineChange, onInitialLineUsed, onScrollerReady };

  // One editor for the life of the component; the document is swapped below.
  useEffect(() => {
    if (!host.current) return;

    const editor = new EditorView({
      state: EditorState.create({ doc: '', extensions: [...baseExtensions(), language.of([])] }),
      parent: host.current,
    });
    view.current = editor;
    handlers.current.onScrollerReady?.(editor.scrollDOM);

    // The line at the top of the viewport *is* the reading position. Asked of the editor
    // in viewport coordinates rather than computed from scrollTop, so content padding,
    // folded ranges and (in Phase 5) Code Space blocks cannot skew it.
    const report = () => {
      const box = editor.scrollDOM.getBoundingClientRect();
      const pos = editor.posAtCoords({ x: box.left + 1, y: box.top + 1 }, false);
      handlers.current.onLineChange(editor.state.doc.lineAt(pos).number - 1);
    };
    editor.scrollDOM.addEventListener('scroll', report, { passive: true });

    return () => {
      editor.scrollDOM.removeEventListener('scroll', report);
      handlers.current.onScrollerReady?.(null);
      editor.destroy();
      view.current = null;
    };
  }, []);

  // Swap the document when the file changes.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;

    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
      selection: { anchor: 0 },
      scrollIntoView: false,
    });
    editor.scrollDOM.scrollTop = 0;

    let cancelled = false;

    void grammarFor(path).then((grammar) => {
      if (cancelled || !view.current) return;
      view.current.dispatch({ effects: language.reconfigure(grammar ?? []) });
    });

    return () => {
      cancelled = true;
    };
  }, [fileId, path, text]);

  // Restore the reading position, after the document is in place.
  useEffect(() => {
    const editor = view.current;
    if (!editor || initialLine === null) return;

    const line = Math.min(Math.max(initialLine + 1, 1), editor.state.doc.lines);
    editor.dispatch({
      effects: EditorView.scrollIntoView(editor.state.doc.line(line).from, { y: 'start' }),
    });

    handlers.current.onInitialLineUsed();
  }, [fileId, initialLine]);

  return <div className="ac-codeview" ref={host} />;
}
