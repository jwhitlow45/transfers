import type { Route } from '../../../shared/api.ts';

// A route's name on its own color. Agencies without colors get the neutral badge.
export function RouteBadge({ route, size = 'normal' }: { route: Route | undefined; size?: 'normal' | 'small' }) {
  if (!route) return null;
  const style = route.color ? { background: `#${route.color}`, color: `#${route.textColor ?? 'FFFFFF'}` } : undefined;
  const agency = { SF: 'Muni', BA: 'BART', SM: 'SamTrans', GG: 'Golden Gate Transit', GF: 'Golden Gate Ferry' }[route.agency];
  return (
    <span class={`badge badge-${size}`} style={style} title={`${agency} ${route.name}${route.longName ? `, ${route.longName}` : ''}`}>
      <span class="visually-hidden">{agency} </span>
      {route.name}
    </span>
  );
}
