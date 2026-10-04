import { MODE_GLYPHS, MODE_LABEL, type Mode } from './modeGlyphs';

/** Vehicle pictogram with gerbil driver. Inherits currentColor; decorative by default. */
export function ModeIcon({ mode, size = 16, title }: { mode: Mode; size?: number; title?: string }) {
  const g = MODE_GLYPHS[mode];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <g transform={g.transform}>
        {g.parts.map((p, i) => p.stroke
          ? <path key={i} d={p.d} fill="none" stroke="currentColor" strokeWidth={p.stroke} strokeLinecap="round" strokeLinejoin="round" />
          : <path key={i} d={p.d} fill="currentColor" fillRule="evenodd" />)}
      </g>
    </svg>
  );
}

export function modeFor(agency: string, label: string): Mode {
  if (agency === 'BART') return 'bart';
  if (agency === 'Muni Metro' || /^[JKLMNST]$/.test(label)) return 'lrv';
  if (/^[EF]$/.test(label)) return 'streetcar';
  if (/^(PH|PM|C)$/.test(label)) return 'cable';
  if (/Ferry/.test(agency)) return 'ferry';
  return 'bus';
}
export { MODE_LABEL };
