/** Dark or white text on a route color, whichever has more contrast. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#111214' : '#ffffff';
}

/** Matched-lightness palette for bus routes, which have no official per-route color. */
export const BUS_PALETTE = ['#00858a', '#2b6fa8', '#4c55a8', '#2e8350', '#6f8226', '#b8602a', '#9a3b6d', '#7a5f45'];
export const MUNI_RAPID = '#c4122f';

/** BART lines, Muni Metro (J K L M N S T) and heritage streetcars (E F) keep their official colors.
 *  Muni Rapid ("5R", "14R"…) uses Muni red as on the SFMTA map. Every other bus route gets a stable palette hue. */
export function routeColor(agency: string, label: string, official?: string): string {
  if (official && (agency === 'BART' || agency === 'Muni Metro' || /^[JKLMNSTEF]$/.test(label))) return official;
  if (/^\d+R$/.test(label)) return MUNI_RAPID;
  const n = parseInt(label, 10);
  return BUS_PALETTE[(isNaN(n) ? label.length : n) % BUS_PALETTE.length];
}

/**
 * BART line colors carry meaning and never change. Other agencies' colors are arbitrary
 * and step to the next palette color when they clash with a color already on screen. When both legs are arbitrary
 * (bus → bus), the second leg yields.
 * @param color   the arbitrary color that may need to yield
 * @param inView  colors that win (first leg, or BART lines in a result list)
 */
export function resolveRouteColor(color: string, inView: string[]): string {
  const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const clash = (c: string) => { const x = rgb(c); return inView.some(f => { const b = rgb(f); return Math.hypot(x[0] - b[0], x[1] - b[1], x[2] - b[2]) < 90; }); };
  if (!clash(color)) return color;
  const i = Math.max(0, BUS_PALETTE.indexOf(color));
  for (let k = 1; k <= BUS_PALETTE.length; k++) { const c = BUS_PALETTE[(i + k) % BUS_PALETTE.length]; if (!clash(c)) return c; }
  return color;
}
