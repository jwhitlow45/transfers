import { useEffect, useState } from 'preact/hooks';

// iOS's text size (Dynamic Type) for the app opened from the home screen, which has no Safari text
// size menu, and whose page otherwise keeps its own size whatever the rider set (J, 2026-11-13).
// The root font size follows the system's body text, as a share of it at iOS's default size, so the
// default changes nothing. It stops at twice that, the largest text every layout was checked at,
// and goes no smaller than the default, where some tap targets, sized in rem, would fall under
// 44 px. Safari, with a text size menu of its own, keeps to that.

// The system body text at iOS's default text size (Large), in px.
const DEFAULT_BODY_PX = 17;
const LARGEST = 2;

export function textScale(bodyPx: number) {
  return Math.min(LARGEST, Math.max(1, bodyPx / DEFAULT_BODY_PX));
}

// An element the rider never sees, sized only to be watched.
function hidden(style: string, parent: HTMLElement = document.body) {
  const element = document.createElement('span');
  element.setAttribute('aria-hidden', 'true');
  element.textContent = 'M';
  element.style.cssText = `position: absolute; top: 0; left: 0; visibility: hidden; pointer-events: none; ${style}`;
  parent.append(element);
  return element;
}

// Watches the root font size, for whatever changes it: the system text size here, or a browser's
// own font size setting. What measured text at the old size (see Whole and the pin bar) measures it
// again on `resize`, as on a turned phone, so a change sends one, as nothing else would: the window
// keeps its size. Then follows the system text size in the home-screen app, from before the first
// render, and as the rider changes it, in Settings or from Control Center while the app is open.
export function followTextSize() {
  if (typeof ResizeObserver === 'undefined') return;
  // One level under the system text's probe below, as a resize observer hears in one go only the
  // elements deeper than those it just told of: a system change resizes this in the same frame.
  let first = true;
  new ResizeObserver(() => {
    if (first) return void (first = false);
    dispatchEvent(new Event('resize'));
  }).observe(hidden('width: 1rem; height: 1px', hidden('')));

  const homeScreen = (navigator as { standalone?: boolean }).standalone === true;
  if (!homeScreen || !CSS.supports('font', '-apple-system-body')) return;
  const system = hidden('font: -apple-system-body');
  let scale = 0;
  const apply = () => {
    const bodyPx = parseFloat(getComputedStyle(system).fontSize);
    if (!(bodyPx > 0) || textScale(bodyPx) === scale) return;
    scale = textScale(bodyPx);
    document.documentElement.style.fontSize = `${scale * 100}%`;
  };
  apply();
  new ResizeObserver(apply).observe(system);
  // A second look on the way back to the app, in case its size changed while it was away.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && apply());
}

// Whether the text is about 150% or larger: under 18 root ems across the page, as the stylesheet's
// large-text rules go (@container app in styles.css). Those follow the root font size, which a media
// query in em would not, as it reads the browser's own default size.
export function largeText() {
  return document.body.clientWidth <= 18 * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

export function useLargeText() {
  const [large, setLarge] = useState(largeText);
  useEffect(() => {
    const update = () => setLarge(largeText());
    addEventListener('resize', update);
    return () => removeEventListener('resize', update);
  }, []);
  return large;
}
