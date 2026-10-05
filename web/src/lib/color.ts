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

// How far apart two #rrggbb colors are, as a straight line through RGB.
function distance(a: string, b: string) {
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255] as const;
  };
  const [r, g, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r - r2, g - g2, b1 - b2);
}

// BART line colors carry meaning and never change. Other agencies' colors are arbitrary, and
// step to the next palette color when they clash with a color already in view. When both legs
// are arbitrary (bus to bus), the second leg yields.
export function resolveRouteColor(color: string, inView: string[]): string {
  const clashes = (candidate: string) => inView.some((other) => distance(candidate, other) < 90);
  if (!clashes(color)) return color;
  const start = Math.max(0, BUS_PALETTE.indexOf(color));
  for (let step = 1; step <= BUS_PALETTE.length; step++) {
    const candidate = BUS_PALETTE[(start + step) % BUS_PALETTE.length]!;
    if (!clashes(candidate)) return candidate;
  }
  return color;
}

// A nearby stop's letter is colored the same on its cards and its map marker, so the eye can
// match them without reading. Dark enough for white letters (5:1 or more), and nearest stops,
// which come first, differ most in hue.
const STOP_COLORS = ['#c62828', '#1565c0', '#2e7d32', '#7b1fa2', '#a85200', '#00796b', '#ad1457', '#5d4037'];
export const stopLetterColor = (letter: string) => STOP_COLORS[(letter.charCodeAt(0) - 65) % STOP_COLORS.length]!;

// Colors a saved search can wear, named for the picker's labels.
export const SAVED_COLORS = [
  { color: '#00858a', name: 'Teal' },
  { color: '#2b6fa8', name: 'Blue' },
  { color: '#4c55a8', name: 'Indigo' },
  { color: '#9a3b6d', name: 'Plum' },
  { color: '#c4122f', name: 'Red' },
  { color: '#b8602a', name: 'Orange' },
  { color: '#f2c500', name: 'Yellow' },
  { color: '#6f8226', name: 'Olive' },
  { color: '#2e8350', name: 'Green' },
  { color: '#7a5f45', name: 'Brown' },
];

// A new saved search starts in its route's color, unless another saved search already looks
// like that, in which case it takes the first picker color that looks like none of them.
export function defaultSavedColor(routeColorHex: string | null, taken: string[]) {
  const free = (color: string) => taken.every((other) => distance(color, other) >= 90);
  if (routeColorHex && free(routeColorHex)) return routeColorHex;
  return SAVED_COLORS.find(({ color }) => free(color))?.color ?? SAVED_COLORS.find(({ color }) => !taken.includes(color))?.color ?? SAVED_COLORS[0]!.color;
}
