/**
 * The instruments.
 *
 * Each tool is drawn as the object it is — a pen, a highlighter, an eraser — standing in a
 * tray whose bottom edge clips them. Selecting one lifts it out of the tray; that rise is
 * the whole selection affordance, so there is no highlight box and no border anywhere here.
 *
 * The tip carries the current colour. That is what makes the palette readable at a glance:
 * you never have to look at the swatch row to know what you are about to draw with.
 */

import type { Tool } from '@/model/types';

interface Props {
  tool: Tool;
  color: string;
  /** Highlighter ink is translucent, and the instrument should admit it. */
  opacity?: number;
}

/** Barrels share one soft left-to-right shading so the three tools read as a set. */
function Barrel({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor="#dedee4" />
      <stop offset="22%" stopColor="#fbfbfd" />
      <stop offset="62%" stopColor="#f1f1f4" />
      <stop offset="100%" stopColor="#d4d4db" />
    </linearGradient>
  );
}

export function ToolInstrument({ tool, color, opacity = 1 }: Props) {
  const uid = `inst-${tool}`;

  if (tool === 'pen') {
    return (
      <svg className="ac-instrument" viewBox="0 0 36 100" aria-hidden="true">
        <defs>
          <Barrel id={uid} />
        </defs>
        <rect x="7" y="33" width="22" height="67" fill={`url(#${uid})`} />
        {/* the metal cone */}
        <polygon points="18,7 28,33 8,33" fill="#c9c9d1" />
        <polygon points="18,7 23,20 13,20" fill="#b4b4be" />
        {/* the nib, in the ink you are about to write with */}
        <polygon points="18,7 21,15 15,15" fill={color} />
        <rect x="7" y="37" width="22" height="5" fill={color} opacity="0.9" />
      </svg>
    );
  }

  if (tool === 'highlighter') {
    return (
      <svg className="ac-instrument" viewBox="0 0 36 100" aria-hidden="true">
        <defs>
          <Barrel id={uid} />
        </defs>
        <rect x="5" y="35" width="26" height="65" fill={`url(#${uid})`} />
        {/* chisel tip — flat, angled, and translucent like the ink it lays down */}
        <polygon points="9,17 27,9 27,35 9,35" fill={color} opacity={0.45 + opacity * 0.5} />
        <polygon points="9,17 27,9 27,14 9,22" fill={color} />
        <rect x="5" y="35" width="26" height="4" fill="#c9c9d1" />
        <rect x="5" y="41" width="26" height="6" fill={color} opacity="0.9" />
      </svg>
    );
  }

  return (
    <svg className="ac-instrument" viewBox="0 0 36 100" aria-hidden="true">
      <defs>
        <Barrel id={uid} />
      </defs>
      <rect x="7" y="30" width="22" height="70" fill={`url(#${uid})`} />
      {/* a soft rubber wedge, deliberately the only tool with no colour of its own */}
      <path d="M9 30 L27 30 L27 16 Q27 11 22 11 L14 11 Q9 11 9 16 Z" fill="#efb9b9" />
      <path d="M9 22 L27 17 L27 22 L9 27 Z" fill="#e39d9d" opacity="0.55" />
    </svg>
  );
}
