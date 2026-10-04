import type { Route } from '../../../shared/api.ts';

// Dark or white text on a route color, whichever has more contrast.
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const linear = [n >> 16, (n >> 8) & 255, n & 255].map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#111214' : '#ffffff';
}

// Matched-lightness palette for bus routes, which have no official per-route color.
export const BUS_PALETTE = ['#00858a', '#2b6fa8', '#4c55a8', '#2e8350', '#6f8226', '#b8602a', '#9a3b6d', '#7a5f45'];
const MUNI_RAPID = '#c4122f';
// Muni assigns cable cars no color. This is the design's placeholder.
const CABLE_CAR = '#8c5a2b';

// Official colors, as the design specifies them. BART's own feed values differ slightly.
const OFFICIAL: Record<string, string> = {
  'BA:Yellow': '#f2c500',
  'BA:Red': '#e2231a',
  'BA:Green': '#4db848',
  'BA:Blue': '#0099d8',
  'BA:Orange': '#faa61a',
  'SF:J': '#faa634',
  'SF:K': '#569bbe',
  'SF:L': '#92278f',
  'SF:M': '#008752',
  'SF:N': '#00539b',
  'SF:T': '#d31245',
  'SF:S': '#ffcc00',
  'SF:F': '#f0e68c',
};

// BART lines, Muni Metro, and historic streetcars keep their official colors. Muni Rapid routes
// ("5R", "14R") use Muni red as on the SFMTA map. Every other route gets a stable palette hue.
export function routeColor(route: Route): string {
  const official = OFFICIAL[`${route.agency}:${route.name}`];
  if (official) return official;
  if ((route.mode === 'bart' || route.mode === 'light-rail' || route.mode === 'streetcar') && route.color) return `#${route.color}`;
  if (route.mode === 'cable-car') return CABLE_CAR;
  if (route.agency === 'SF' && /^\d+R$/.test(route.name)) return MUNI_RAPID;
  const number = parseInt(route.name, 10);
  return BUS_PALETTE[(Number.isNaN(number) ? route.name.length : number) % BUS_PALETTE.length]!;
}

// BART line colors carry meaning and never change. Other agencies' colors are arbitrary, and
// step to the next palette color when they clash with a color already in view. When both legs
// are arbitrary (bus to bus), the second leg yields.
export function resolveRouteColor(color: string, inView: string[]): string {
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255] as const;
  };
  const clashes = (candidate: string) => {
    const [r, g, b] = rgb(candidate);
    return inView.some((other) => {
      const [r2, g2, b2] = rgb(other);
      return Math.hypot(r - r2, g - g2, b - b2) < 90;
    });
  };
  if (!clashes(color)) return color;
  const start = Math.max(0, BUS_PALETTE.indexOf(color));
  for (let step = 1; step <= BUS_PALETTE.length; step++) {
    const candidate = BUS_PALETTE[(start + step) % BUS_PALETTE.length]!;
    if (!clashes(candidate)) return candidate;
  }
  return color;
}
