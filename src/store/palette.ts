/**
 * Tool palette state.
 *
 * This exists in Phase 0, before any ink engine, on purpose: the ink engine should read
 * its stroke style from here rather than inventing its own, and the shape is easier to
 * get right while nothing depends on it.
 *
 * Note what is *not* here — no stroke data, no canvas, no geometry. This store holds only
 * what the user has chosen, which is also exactly what is worth persisting between
 * sessions.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InkTool, Tool } from '@/model/types';

/**
 * Five discrete steps, not a continuous slider. Discrete widths are repeatable across
 * sessions and thumb-sized on a tablet, which is why every serious drawing tool does this.
 */
export const WIDTHS: Record<InkTool, readonly number[]> = {
  pen: [1, 2, 3.5, 6, 10],
  highlighter: [10, 16, 22, 30, 40],
};

export const ERASER_WIDTHS: readonly number[] = [12, 20, 30, 44, 60];

/**
 * Borrowed from the landing page so that annotations made in the app look like the ink in
 * the marketing preview. Ink is the one place this product is allowed to use colour.
 */
export const SWATCHES: readonly string[] = [
  '#1c1c1e', // ink black
  '#2f5fd0', // note blue
  '#d1495b', // question red
  '#f59e0b', // bookmark amber
  '#2e9e5b', // green
];

export interface ToolSettings {
  color: string;
  /** an index into WIDTHS[tool], not a pixel value — see above */
  widthStep: number;
  /** 0..1 */
  opacity: number;
}

export type Dock = 'bottom' | 'top' | 'left' | 'right';

interface PaletteState {
  /** `null` means reading mode: no tool armed, pointer events scroll and select. */
  activeTool: Tool | null;
  settings: Record<InkTool, ToolSettings>;
  eraserWidthStep: number;

  /** The width/opacity popover, opened by tapping the already-selected tool. */
  attributesOpen: boolean;

  dock: Dock;
  collapsed: boolean;

  selectTool: (tool: Tool) => void;
  clearTool: () => void;
  setColor: (color: string) => void;
  setWidthStep: (step: number) => void;
  setOpacity: (opacity: number) => void;
  closeAttributes: () => void;
  setDock: (dock: Dock) => void;
  toggleCollapsed: () => void;
}

const DEFAULTS: Record<InkTool, ToolSettings> = {
  pen: { color: '#2f5fd0', widthStep: 1, opacity: 1 },
  // A highlighter that is not translucent is a marker pen, and it would bury the code.
  highlighter: { color: '#f59e0b', widthStep: 2, opacity: 0.35 },
};

export const usePalette = create<PaletteState>()(
  persist(
    (set, get) => ({
      activeTool: null,
      settings: structuredClone(DEFAULTS),
      eraserWidthStep: 1,
      attributesOpen: false,
      dock: 'bottom',
      collapsed: false,

      /**
       * Tapping a tool arms it. Tapping the *armed* tool opens its attributes — this is
       * the interaction from Apple's picker, and it is what keeps width and opacity off
       * screen until they are wanted.
       */
      selectTool: (tool) =>
        set((s) =>
          s.activeTool === tool
            ? { attributesOpen: !s.attributesOpen }
            : { activeTool: tool, attributesOpen: false },
        ),

      clearTool: () => set({ activeTool: null, attributesOpen: false }),

      setColor: (color) => {
        const tool = get().activeTool;
        if (!isInkTool(tool)) return;
        set((s) => ({ settings: { ...s.settings, [tool]: { ...s.settings[tool], color } } }));
      },

      setWidthStep: (widthStep) => {
        const tool = get().activeTool;
        if (tool === 'eraser') return set({ eraserWidthStep: widthStep });
        if (!isInkTool(tool)) return;
        set((s) => ({ settings: { ...s.settings, [tool]: { ...s.settings[tool], widthStep } } }));
      },

      setOpacity: (opacity) => {
        const tool = get().activeTool;
        if (!isInkTool(tool)) return;
        set((s) => ({ settings: { ...s.settings, [tool]: { ...s.settings[tool], opacity } } }));
      },

      closeAttributes: () => set({ attributesOpen: false }),
      setDock: (dock) => set({ dock }),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed, attributesOpen: false })),
    }),
    {
      name: 'annotatecode:palette',
      // Deliberately not persisting `activeTool` or `attributesOpen`: a returning user
      // should land in reading mode, not mid-stroke.
      partialize: (s) => ({
        settings: s.settings,
        eraserWidthStep: s.eraserWidthStep,
        dock: s.dock,
        collapsed: s.collapsed,
      }),
    },
  ),
);

export function isInkTool(tool: Tool | null): tool is InkTool {
  return tool === 'pen' || tool === 'highlighter';
}

/** The stroke style the ink engine should use right now, or `null` in reading mode. */
export function currentStrokeStyle(state: PaletteState) {
  const tool = state.activeTool;
  if (!isInkTool(tool)) return null;
  const s = state.settings[tool];
  return {
    tool,
    color: s.color,
    width: WIDTHS[tool][s.widthStep] ?? WIDTHS[tool][1]!,
    opacity: s.opacity,
  };
}

/** Width steps and current step for whichever tool is armed. */
export function activeWidths(state: PaletteState): { steps: readonly number[]; step: number } {
  const tool = state.activeTool;
  if (tool === 'eraser') return { steps: ERASER_WIDTHS, step: state.eraserWidthStep };
  if (!isInkTool(tool)) return { steps: WIDTHS.pen, step: 1 };
  return { steps: WIDTHS[tool], step: state.settings[tool].widthStep };
}
