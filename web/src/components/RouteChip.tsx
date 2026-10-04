import type { Route } from '../../../shared/api.ts';
import { ModeIcon } from '../icons/ModeIcon.tsx';
import { routeColor, textOn } from '../lib/color.ts';
import { chipLabel } from '../view.ts';

// Route label on its line color with the mode icon. Text color is picked for contrast.
export function RouteChip({ route, size = 'md', iconSize, color, label }: { route: Route | undefined; size?: 'sm' | 'md' | 'band'; iconSize?: number; color?: string; label?: string }) {
  if (!route) return null;
  const background = color ?? routeColor(route);
  const px = iconSize ?? (size === 'sm' ? 15 : size === 'band' ? 18 : 16);
  return (
    <span class={`tf-chip${size === 'md' ? '' : ` tf-chip--${size}`}`} style={{ background, color: textOn(background) }}>
      <ModeIcon mode={route.mode} size={px} />
      {label ?? chipLabel(route)}
    </span>
  );
}
