import type { Mode } from '../../../shared/api.ts';
import { MODE_GLYPHS, type Mode as Glyph } from './modeGlyphs.ts';

const GLYPH_FOR: Record<Mode, Glyph> = {
  bus: 'bus',
  trolleybus: 'bus',
  'light-rail': 'lrv',
  streetcar: 'streetcar',
  'cable-car': 'cable',
  bart: 'bart',
  ferry: 'ferry',
};

// Vehicle pictogram with a gerbil driver. Takes the text color of whatever it sits in, and is
// hidden from screen readers, since the route label beside it says the mode.
export function ModeIcon({ mode, size = 16 }: { mode: Mode; size?: number }) {
  const glyph = MODE_GLYPHS[GLYPH_FOR[mode]];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g transform={glyph.transform}>
        {glyph.parts.map((part, index) =>
          part.stroke ? (
            <path key={index} d={part.d} fill="none" stroke="currentColor" stroke-width={part.stroke} stroke-linecap="round" stroke-linejoin="round" />
          ) : (
            <path key={index} d={part.d} fill="currentColor" fill-rule="evenodd" />
          ),
        )}
      </g>
    </svg>
  );
}
