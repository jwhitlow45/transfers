import { useEffect, useRef } from 'preact/hooks';

// How far a finger moves before a touch is judged a drag. Phones move 8 to 10 px before they
// start scrolling, and a drag must be claimed before that, or the browser owns the touch.
const DECIDE_PX = 5;
// A finger that rests this long before lifting has no fling left in it.
const FLING_MS = 80;
// A sideways drag must lean this much more sideways than up or down, so a slightly slanted
// scroll stays a scroll.
const SIDEWAYS_LEAN = 1.5;
// Matches the transitions on sheets and the pull indicator in styles.css.
export const SLIDE_MS = 180;

// Where the finger let go: distance along the drag's axis from where it first touched, and its
// speed then, in px per ms. Both are positive downward or rightward.
export type Release = { distance: number; velocity: number };

export type Direction = 'up' | 'down' | 'left' | 'right';

export type Drag = {
  // Whether a touch moving this way is this drag's to follow. Asked once per touch, when it first
  // moves clearly along the axis. Touches it turns down scroll as usual.
  claim: (direction: Direction, origin: Element) => boolean;
  move?: (distance: number) => void;
  // Release is null when the browser or a second finger cut the drag short.
  end: (release: Release | null) => void;
};

// Follows drags along one axis on an element without taking scrolling away from it. Touch
// events, not pointer events: once a page can scroll, the browser takes every pointer that
// moves the way it scrolls, while a touch it has not started scrolling can still be claimed.
// A claimed drag swallows the click that may follow it, so letting go over a button does not
// press it.
export function useDrag(element: () => Element | null | undefined, axis: 'x' | 'y', drag: Drag) {
  const latest = useRef(drag);
  latest.current = drag;
  useEffect(() => {
    const target = element();
    if (!target) return;
    let touch: { id: number; x: number; y: number; origin: Element; dragging: boolean } | null = null;
    let last = { at: 0, position: 0 };
    let velocity = 0;
    let swallowClickUntil = 0;
    const find = (list: TouchList, id: number) => [...list].find((point) => point.identifier === id);
    const along = (point: Touch) => (axis === 'x' ? point.clientX : point.clientY);
    const start = () => (axis === 'x' ? touch!.x : touch!.y);
    const cut = () => {
      if (touch?.dragging) latest.current.end(null);
      touch = null;
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length > 1) return cut();
      const point = event.touches[0]!;
      touch = { id: point.identifier, x: point.clientX, y: point.clientY, origin: event.target as Element, dragging: false };
      last = { at: performance.now(), position: along(point) };
      velocity = 0;
    };
    const onMove = (event: TouchEvent) => {
      const point = touch && find(event.changedTouches, touch.id);
      if (!touch || !point) return;
      const dx = point.clientX - touch.x;
      const dy = point.clientY - touch.y;
      if (!touch.dragging) {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
        const main = axis === 'x' ? dx : dy;
        const across = axis === 'x' ? dy : dx;
        const leans = Math.abs(main) > Math.abs(across) * (axis === 'x' ? SIDEWAYS_LEAN : 1);
        const direction: Direction = axis === 'x' ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        if (!event.cancelable || !leans || !latest.current.claim(direction, touch.origin)) {
          touch = null;
          return;
        }
        touch.dragging = true;
      }
      event.preventDefault();
      const at = performance.now();
      const position = along(point);
      if (at > last.at) velocity = 0.7 * ((position - last.position) / (at - last.at)) + 0.3 * velocity;
      last = { at, position };
      latest.current.move?.(position - start());
    };
    const onEnd = (event: TouchEvent) => {
      const point = touch && find(event.changedTouches, touch.id);
      if (!touch || !point) return;
      if (touch.dragging) {
        swallowClickUntil = performance.now() + 400;
        latest.current.end({ distance: along(point) - start(), velocity: performance.now() - last.at > FLING_MS ? 0 : velocity });
      }
      touch = null;
    };
    const onClick = (event: MouseEvent) => {
      if (performance.now() > swallowClickUntil) return;
      event.preventDefault();
      event.stopPropagation();
    };

    target.addEventListener('touchstart', onStart as EventListener, { passive: true });
    target.addEventListener('touchmove', onMove as EventListener, { passive: false });
    target.addEventListener('touchend', onEnd as EventListener, { passive: true });
    target.addEventListener('touchcancel', cut, { passive: true });
    target.addEventListener('click', onClick as EventListener, true);
    return () => {
      target.removeEventListener('touchstart', onStart as EventListener);
      target.removeEventListener('touchmove', onMove as EventListener);
      target.removeEventListener('touchend', onEnd as EventListener);
      target.removeEventListener('touchcancel', cut);
      target.removeEventListener('click', onClick as EventListener, true);
    };
  }, []);
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// A swipe right goes back past this share of the screen's width, or when flung this fast.
const BACK_SHARE = 0.35;
const BACK_FLING = 0.4;

// Swiping right anywhere on a screen goes back, the screen sliding with the finger. Places that
// swipe sideways themselves keep their swipe: an open sheet, form fields, and anything that
// scrolls sideways. `screen` is the screen's scroller, and the shell it sits in is what the
// drag follows, so the bottom bar slides with the rest.
export function useSwipeBack(screen: () => HTMLElement | null | undefined, onBack: () => void) {
  const shell = () => screen()?.parentElement;
  const layers = () => [...(shell()?.children ?? [])].filter((layer): layer is HTMLElement => layer instanceof HTMLElement && !layer.classList.contains('tf-sheet'));
  const slide = (offset: number, animated: boolean) => {
    for (const layer of layers()) {
      layer.style.transition = animated && !prefersReducedMotion() ? `transform ${SLIDE_MS}ms ease-out` : 'none';
      layer.style.transform = offset > 0 ? `translateX(${offset}px)` : '';
    }
  };
  useDrag(shell, 'x', {
    claim: (direction, origin) => direction === 'right' && !origin.closest('.tf-sheet, input, select, textarea') && !scrollsSideways(origin, shell()),
    move: (distance) => slide(Math.max(0, distance), false),
    end: (release) => {
      const width = shell()?.clientWidth ?? 1;
      if (!release || (release.distance < width * BACK_SHARE && release.velocity < BACK_FLING)) return slide(0, true);
      slide(width, true);
      setTimeout(onBack, prefersReducedMotion() ? 0 : SLIDE_MS);
    },
  });
}

function scrollsSideways(origin: Element, until: Element | null | undefined) {
  for (let element: Element | null = origin; element && element !== until; element = element.parentElement) {
    const overflow = getComputedStyle(element).overflowX;
    if ((overflow === 'auto' || overflow === 'scroll') && element.scrollWidth > element.clientWidth) return true;
  }
  return false;
}
