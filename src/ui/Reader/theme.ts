/**
 * How code looks.
 *
 * The gist asks for a document, not an IDE: white paper, dark text, a quiet gutter, and
 * very little colour. Syntax highlighting here is closer to a well-set printed listing
 * than to a neon editor theme — enough contrast between kinds of token to help you read,
 * never enough to compete with the ink someone writes on top of it.
 *
 * Generous line height is not a style choice either. Annotations need room between lines,
 * and Code Space in Phase 5 will expand this band further.
 */

import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export const paperTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    color: '#171717',
    backgroundColor: '#fff',
    // Ink surfaces are absolutely positioned children of this box, which does not scroll.
    position: 'relative',
  },
  // The one element that scrolls. Ink mounts over it and shares its coordinate space, so
  // nothing outside may scroll as well.
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.75',
    overflow: 'auto',
    overscrollBehavior: 'contain',
  },
  // Trailing space below the last line, so the end of a file is annotatable too.
  '.cm-content': {
    padding: '20px 0 45vh',
    caretColor: '#171717',
  },
  // The gutter is reference material, not content: legible on purpose, quiet on purpose.
  // Its right padding is the only gap between a line number and the code it labels.
  '.cm-gutters': {
    backgroundColor: '#fff',
    color: '#a8a8a8',
    border: 'none',
    paddingRight: '14px',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 0 0 14px',
    minWidth: '30px',
    textAlign: 'right',
    // Line numbers are a column; proportional digits make them shimmer as you scroll.
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 3px',
    color: '#d8d8d8',
  },
  '&:hover .cm-foldGutter .cm-gutterElement': { color: '#a8a8a8' },
  // No active-line band. A full-bleed stripe across a wide window is the loudest thing on
  // a page that is meant to read as paper, and in a read-only document it marks nothing
  // worth marking. The gutter number carries the position instead.
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#6b6b6b' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: '#dbe6fb',
  },
  '.cm-searchMatch': { backgroundColor: '#fdf0c2', outline: 'none' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#ffdb4d' },
  '.cm-selectionMatch': { backgroundColor: '#f3f3f3' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: '#eef2fb',
    outline: 'none',
  },
  '.cm-panels': {
    backgroundColor: '#fafafa',
    color: '#333',
    borderBottom: '1px solid #eee',
  },
  '.cm-panel input': {
    font: 'inherit',
    padding: '3px 6px',
    border: '1px solid #ddd',
    borderRadius: '5px',
  },
});

export const paperHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#9a9a9a', fontStyle: 'italic' },

  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: '#8250a8' },
  { tag: [t.operatorKeyword, t.modifier, t.self, t.null, t.atom, t.bool], color: '#8250a8' },

  { tag: [t.string, t.special(t.string), t.regexp], color: '#2f7a4d' },
  { tag: [t.number, t.integer, t.float], color: '#b05f1e' },

  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#2f5fd0' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#171717' },

  { tag: [t.typeName, t.className, t.namespace], color: '#1f6a8c' },
  { tag: [t.tagName], color: '#2f5fd0' },
  { tag: [t.attributeName], color: '#1f6a8c' },
  { tag: [t.propertyName], color: '#3a3a3a' },

  { tag: [t.variableName, t.labelName], color: '#171717' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#8a8a8a' },
  { tag: [t.meta, t.processingInstruction], color: '#9a9a9a' },

  { tag: t.link, color: '#2f5fd0', textDecoration: 'underline' },
  { tag: t.heading, color: '#171717', fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.strikethrough, textDecoration: 'line-through' },

  { tag: t.invalid, color: '#d1495b' },
]);
