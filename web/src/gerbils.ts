// Gerbil mode, an easter egg: five quick taps on Home's title, and a gerbil walks every transfer
// walk. Kept on the page's root, so CSS shows the gerbils wherever walks are named, and on this
// device, so it lasts.
const KEY = 'transfers:gerbils';
const TAPS = 5;
const WITHIN_MS = 2000;

const stored = () => {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
};
const show = (on: boolean) => {
  if (typeof document !== 'undefined') document.documentElement.dataset.gerbils = on ? 'on' : 'off';
};
show(stored());

let taps: number[] = [];

// A tap on the title. Returns whether gerbil mode is now on or off once the taps add up, and null
// until then.
export function tapForGerbils(now = Date.now()): boolean | null {
  taps = [...taps.filter((at) => now - at < WITHIN_MS), now];
  if (taps.length < TAPS) return null;
  taps = [];
  const on = !stored();
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Without storage, it lasts as long as the page.
  }
  show(on);
  return on;
}
