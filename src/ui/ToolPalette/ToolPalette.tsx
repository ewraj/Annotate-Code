/**
 * The tool palette.
 *
 * Modelled on Apple's tool picker — the control in Pages, Freeform, Notes and Markup —
 * because the people this product is for have already learned it, and because its three
 * structural ideas are the right ones here:
 *
 *   - it floats over the document and docks to an edge, so the code keeps the screen;
 *   - attributes are progressive, hidden behind a tap on the selected tool;
 *   - the selected tool rises out of the tray, which needs no chrome to explain itself.
 *
 * In Phase 0 this is presentational. It owns no strokes and draws nothing — the ink engine
 * reads its choices out of the palette store rather than the other way round.
 */

import { useRef, useState } from 'react';
import type { Tool } from '@/model/types';
import { isInkTool, SWATCHES, usePalette, type Dock } from '@/store/palette';
import { AttributesPopover } from './AttributesPopover';
import { ToolInstrument } from './ToolInstrument';
import './palette.css';

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'pen', label: 'Pen' },
  { id: 'highlighter', label: 'Highlighter' },
  { id: 'eraser', label: 'Eraser' },
];

interface Props {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function ToolPalette({ canUndo = false, canRedo = false, onUndo, onRedo }: Props) {
  const state = usePalette();
  const [dragging, setDragging] = useState(false);
  const dragged = useRef(false);

  const tool = state.activeTool;
  const ink = isInkTool(tool) ? state.settings[tool] : null;
  const vertical = state.dock === 'left' || state.dock === 'right';

  if (state.collapsed) {
    return (
      <button
        type="button"
        className={`ac-palette-pill ac-dock-${state.dock}`}
        onClick={state.toggleCollapsed}
        aria-label="Show annotation tools"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 18 L15 7 L18 10 L7 21 L3 22 Z" />
        </svg>
      </button>
    );
  }

  /**
   * Drag the palette body to re-dock it. The nearest edge to where the pointer lands
   * wins — matching the reference, and cheaper to reason about than free positioning,
   * which would only ever end up covering code.
   */
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button, input, label')) return;
    dragged.current = false;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging) dragged.current = true;
    void e;
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!dragged.current) return;

    const { innerWidth: w, innerHeight: h } = window;
    const distances: Array<[Dock, number]> = [
      ['left', e.clientX],
      ['right', w - e.clientX],
      ['top', e.clientY],
      ['bottom', h - e.clientY],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    state.setDock(distances[0]![0]);
  }

  return (
    <div
      className={`ac-palette ac-dock-${state.dock} ${dragging ? 'is-dragging' : ''}`}
      role="toolbar"
      aria-label="Annotation tools"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {state.attributesOpen && <AttributesPopover />}

      <div className="ac-palette-tray">
        <div className="ac-group ac-history">
          <button type="button" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 7 L4 12 L9 17" />
              <path d="M4 12 H14 a5 5 0 0 1 0 10 H10" />
            </svg>
          </button>
          <button type="button" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 7 L20 12 L15 17" />
              <path d="M20 12 H10 a5 5 0 0 0 0 10 H14" />
            </svg>
          </button>
        </div>

        <span className="ac-divider" />

        <div className="ac-group ac-tools">
          {TOOLS.map(({ id, label }) => {
            const active = tool === id;
            const settings = isInkTool(id) ? state.settings[id] : null;
            return (
              <button
                key={id}
                type="button"
                className={`ac-tool ${active ? 'is-active' : ''}`}
                aria-label={active ? `${label} — size and opacity` : label}
                aria-pressed={active}
                onClick={() => state.selectTool(id)}
              >
                <ToolInstrument
                  tool={id}
                  color={settings?.color ?? '#8e8e93'}
                  opacity={settings?.opacity ?? 1}
                />
              </button>
            );
          })}
        </div>

        <span className="ac-divider" />

        <div className="ac-group ac-colors">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={`ac-swatch ${ink?.color === c ? 'is-selected' : ''}`}
              style={{ '--swatch': c } as React.CSSProperties}
              aria-label={`Colour ${c}`}
              aria-pressed={ink?.color === c}
              disabled={!ink}
              onClick={() => state.setColor(c)}
            />
          ))}

          <label
            className={`ac-swatch ac-swatch-custom ${
              ink && !SWATCHES.includes(ink.color) ? 'is-selected' : ''
            }`}
            aria-label="Custom colour"
          >
            <input
              type="color"
              value={ink?.color ?? '#1c1c1e'}
              disabled={!ink}
              onChange={(e) => state.setColor(e.target.value)}
            />
          </label>
        </div>

        <span className="ac-divider" />

        <button
          type="button"
          className="ac-more"
          aria-label={vertical ? 'Collapse tools' : 'More'}
          onClick={state.toggleCollapsed}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="6" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="18" cy="12" r="1.6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
