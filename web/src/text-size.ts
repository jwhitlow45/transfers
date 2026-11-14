import { useEffect, useState } from 'preact/hooks';

// iOS's text size (Dynamic Type) for the app opened from the home screen, which has no Safari text
// size menu, and whose page otherwise keeps its own size whatever the rider set (J, 2026-11-13).
// The root font size follows the system's body text, as a share of it at iOS's default size, so the
// default changes nothing. It stops at twice that, the largest text every layout was checked at.
// Safari, with a text size menu of its own, keeps to that.

// The system body text at iOS's default text size (Large), in px.
const DEFAULT_BODY_PX = 17;
const LARGEST = 2;
// Told when the root font size changes here, as no media query sees it (see largeText).
const CHANGED = 'transfers:text-size';

export function textScale(bodyPx: number) {
  return Math.min(LARGEST, bodyPx / DEFAULT_BODY_PX);
}

// Sets the root font size before the first render, and again whenever the app comes back to the
// screen, as the rider changes the text size in Settings and returns.
export function followDynamicType() {
  const homeScreen = (navigator as { standalone?: boolean }).standalone === true;
  if (!homeScreen || !CSS.supports('font', '-apple-system-body')) return;
  const apply = () => {
    const probe = document.createElement('span');
    probe.style.font = '-apple-system-body';
    document.body.append(probe);
    const bodyPx = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    if (!(bodyPx > 0)) return;
    const size = `${(textScale(bodyPx) * 100).toFixed(2)}%`;
    if (document.documentElement.style.fontSize === size) return;
    document.documentElement.style.fontSize = size;
    dispatchEvent(new Event(CHANGED));
  };
  apply();
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
    addEventListener(CHANGED, update);
    return () => {
      removeEventListener('resize', update);
      removeEventListener(CHANGED, update);
    };
  }, []);
  return large;
}
