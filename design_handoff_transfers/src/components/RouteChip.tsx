import { ModeIcon, modeFor } from '../icons/ModeIcon';
import { textOn } from '../lib/color';
import type { RouteRef } from '../types';

/** Route label on its line color with the mode icon. Text color is picked for contrast. */
export function RouteChip({ route, size = 'md', iconSize }: { route: RouteRef; size?: 'sm' | 'md' | 'band'; iconSize?: number }) {
  const px = iconSize ?? (size === 'sm' ? 15 : size === 'band' ? 18 : 16);
  return (
    <span className={`tf-chip${size === 'md' ? '' : ' tf-chip--' + size}`} style={{ background: route.color, color: textOn(route.color) }}>
      <ModeIcon mode={modeFor(route.agency, route.label)} size={px} />
      {route.label}
    </span>
  );
}
