/**
 * Width and opacity, shown only when asked for.
 *
 * This is the popover you get by tapping the tool that is already selected. Keeping it
 * closed by default is the reason the palette can stay as small as it does.
 *
 * The widths are drawn as actual stroke marks rather than listed as numbers, because the
 * question a reader is answering is "how thick will this look", and a number does not
 * answer it.
 */

import { activeWidths, isInkTool, usePalette } from '@/store/palette';

export function AttributesPopover() {
  const state = usePalette();
  const { steps, step } = activeWidths(state);
  const tool = state.activeTool;

  const ink = isInkTool(tool) ? state.settings[tool] : null;
  const color = ink?.color ?? '#8e8e93';
  const opacity = ink?.opacity ?? 1;

  const maxWidth = steps[steps.length - 1] ?? 1;

  return (
    <div className="ac-attributes" role="group" aria-label="Tool size and opacity">
      <div className="ac-widths">
        {steps.map((w, i) => (
          <button
            key={i}
            type="button"
            className={`ac-width ${i === step ? 'is-selected' : ''}`}
            aria-label={`Size ${i + 1} of ${steps.length}`}
            aria-pressed={i === step}
            onClick={() => state.setWidthStep(i)}
          >
            <svg viewBox="0 0 34 34" aria-hidden="true">
              <line
                x1="7"
                y1="27"
                x2="27"
                y2="7"
                stroke={i === step ? '#fff' : color}
                strokeWidth={2 + (w / maxWidth) * 11}
                strokeLinecap="round"
              />
            </svg>
          </button>
        ))}
      </div>

      {ink && (
        <label className="ac-opacity" aria-label="Opacity">
          {/* checkerboard under a transparent-to-colour ramp: the fill shows what the
              slider is actually controlling, which no label could do as well */}
          <span
            className="ac-opacity-track"
            style={{
              backgroundImage: `linear-gradient(to right, ${color}00, ${color}), var(--ac-checker)`,
            }}
          />
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(e) => state.setOpacity(Number(e.target.value))}
          />
        </label>
      )}
    </div>
  );
}
