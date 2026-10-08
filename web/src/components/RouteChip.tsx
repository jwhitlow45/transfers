import type { Route } from '../../../shared/api.ts';
import { isOwlHour, isOwlRoute } from '../format.ts';
import { ModeIcon } from '../icons/ModeIcon.tsx';
import { routeColor, textOn } from '../lib/color.ts';
import { useSettings } from '../settings.tsx';
import { chipLabel } from '../view.ts';

// Route label on its line color with the mode icon, unless the rider turned icons off. Text
// color is picked for contrast. `hidden` keeps it from screen readers where a row's spoken
// summary already says it. An owl route shows a tiny owl in the small hours.
export function RouteChip({ route, size = 'md', iconSize, color, label, hidden = false }: { route: Route | undefined; size?: 'sm' | 'md' | 'band'; iconSize?: number; color?: string; label?: string; hidden?: boolean }) {
  const { settings } = useSettings();
  if (!route) return null;
  const background = color ?? routeColor(route);
  const px = iconSize ?? (size === 'sm' ? 15 : size === 'band' ? 18 : 16);
  return (
    <span class={`tf-chip${size === 'md' ? '' : ` tf-chip--${size}`}${settings.modeIcons ? '' : ' tf-chip--plain'}`} style={{ background, color: textOn(background) }} aria-hidden={hidden || undefined}>
      {settings.modeIcons && <ModeIcon mode={route.mode} size={px} />}
      {label ?? chipLabel(route)}
      {isOwlRoute(route) && isOwlHour(new Date()) && <Owl />}
    </span>
  );
}

// Decoration only, so the chip's label stays the whole of what it says. It is smaller than the
// chip's line, which keeps every chip the height it had.
const Owl = () => (
  <svg class="tf-chip__owl" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
    <path d="M5.5 3.5l3.5 2.5h6l3.5-2.5v9c0 4.4-2.8 8-6.5 8s-6.5-3.6-6.5-8z" />
    <circle cx="9.3" cy="11" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="14.7" cy="11" r="1.7" fill="currentColor" stroke="none" />
    <path d="M12 13.2l-1.2 2h2.4z" fill="currentColor" />
  </svg>
);
