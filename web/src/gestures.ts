import { useEffect, useRef } from 'preact/hooks';

// How far a finger moves before a touch is judged a drag. Phones move 8 to 10 px before they
// start scrolling, and a drag must be claimed before that, or the browser owns the touch.
const DECIDE_PX = 5;
// A finger that rests this long before lifting has no fling left in it.
const FLING_MS = 80;

// Where the finger let go: dy from where it first touched, and its speed then, in px per ms.
// Both are positive downward.
export type Release = { dy: number; velocity: number };

export type VerticalDrag = {
  // Whether a touch moving this way is this drag's to follow. Asked once per touch, when it first
  // moves clearly up or down. Touches it turns down scroll as usual.
  claim: (direction: 'up' | 'down', origin: Element) => boolean;
  move?: (dy: number) => void;
  // Release is null when the browser or a second finger cut the drag short.
  end: (release: Release | null) => void;
};

// Follows up-and-down drags on an element without taking scrolling away from it. Touch events,
// not pointer events: once a page can scroll, the browser takes every vertical pointer for
// itself, while a touch it has not started scrolling can still be claimed. A claimed drag
// swallows the click that may follow it, so letting go over a button does not press it.
export function useVerticalDrag(element: () => Element | null | undefined, drag: VerticalDrag) {
  const latest = useRef(drag);
  latest.current = drag;
  useEffect(() => {
    const target = element();
    if (!target) return;
    let touch: { id: number; x: number; y: number; origin: Element; dragging: boolean } | null = null;
    let last = { y: 0, at: 0 };
    let velocity = 0;
    let swallowClickUntil = 0;
    const find = (list: TouchList, id: number) => [...list].find((point) => point.identifier === id);
    const cut = () => {
      if (touch?.dragging) latest.current.end(null);
      touch = null;
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length > 1) return cut();
      const point = event.touches[0]!;
      touch = { id: point.identifier, x: point.clientX, y: point.clientY, origin: event.target as Element, dragging: false };
      last = { y: point.clientY, at: performance.now() };
      velocity = 0;
    };
    const onMove = (event: TouchEvent) => {
      const point = touch && find(event.changedTouches, touch.id);
      if (!touch || !point) return;
      const dx = point.clientX - touch.x;
      const dy = point.clientY - touch.y;
      if (!touch.dragging) {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
        if (!event.cancelable || Math.abs(dy) <= Math.abs(dx) || !latest.current.claim(dy > 0 ? 'down' : 'up', touch.origin)) {
          touch = null;
          return;
        }
        touch.dragging = true;
      }
      event.preventDefault();
      const at = performance.now();
      if (at > last.at) velocity = 0.7 * ((point.clientY - last.y) / (at - last.at)) + 0.3 * velocity;
      last = { y: point.clientY, at };
      latest.current.move?.(dy);
    };
    const onEnd = (event: TouchEvent) => {
      const point = touch && find(event.changedTouches, touch.id);
      if (!touch || !point) return;
      if (touch.dragging) {
        swallowClickUntil = performance.now() + 400;
        latest.current.end({ dy: point.clientY - touch.y, velocity: performance.now() - last.at > FLING_MS ? 0 : velocity });
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
