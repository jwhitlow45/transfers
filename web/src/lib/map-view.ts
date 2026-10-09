import { useEffect, useRef, useState } from 'preact/hooks';
import { motionOff } from '../gestures.ts';

// A map's picture as an SVG viewBox: where its middle is, and how far in it is zoomed from the
// whole picture (`zoom` 1).
type View = { x: number; y: number; zoom: number };
export type Box = { left: number; top: number; width: number; height: number };

// A tap this soon after another, this near it, zooms in, as phones' own maps do.
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;
// A button's zoom, or going back to the whole picture, eases there over this long.
const EASE_MS = 200;

// Pinching zooms a map, a finger moves it once zoomed in, and a double tap zooms in where it lands
// (J, 2026-10-09). Until the rider moves it, the map follows `whole`, the picture as its page frames
// it, so a refresh that grows the picture still shows all of it. `ref` is the map's SVG.
// Zoomed out all the way, one finger scrolls the page as it did, and the map keeps to the picture's
// bounds however it is moved.
export function useMapView(whole: Box, maxZoom: number) {
  const ref = useRef<SVGSVGElement>(null);
  const middle = { x: whole.left + whole.width / 2, y: whole.top + whole.height / 2 };
  const [moved, setMoved] = useState<View | null>(null);
  const view = moved ?? { ...middle, zoom: 1 };
  const width = whole.width / view.zoom;
  const height = whole.height / view.zoom;
  // The middle kept where the zoomed picture stays inside the whole one.
  const keepIn = ({ x, y, zoom }: View): View => {
    const z = Math.min(maxZoom, Math.max(1, zoom));
    const [w, h] = [whole.width / z, whole.height / z];
    return {
      zoom: z,
      x: Math.min(whole.left + whole.width - w / 2, Math.max(whole.left + w / 2, x)),
      y: Math.min(whole.top + whole.height - h / 2, Math.max(whole.top + h / 2, y)),
    };
  };
  const latest = useRef({ view, keepIn });
  latest.current = { view, keepIn };

  // Eases to a view, or with null, back to the whole picture, which then follows the page again.
  const easing = useRef(0);
  const easeTo = (target: View | null) => {
    cancelAnimationFrame(easing.current);
    const from = latest.current.view;
    const to = target ?? { ...middle, zoom: 1 };
    if (motionOff()) return setMoved(target);
    const start = performance.now();
    const step = (time: number) => {
      const t = Math.max(0, Math.min(1, (time - start) / EASE_MS));
      const eased = 1 - (1 - t) ** 3;
      if (t < 1) {
        // Zoom in log scale, so every doubling takes the same time.
        setMoved({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased, zoom: from.zoom * (to.zoom / from.zoom) ** eased });
        easing.current = requestAnimationFrame(step);
      } else setMoved(target);
    };
    easing.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const touching = new Map<number, { x: number; y: number }>();
    // The gesture under way: the view it started from, the point it holds under the fingers, and
    // their spread, in screen pixels.
    let gesture: { from: View; spread: number; at: { x: number; y: number }; held: { x: number; y: number }; scale: number } | null = null;
    let lastTap = { at: 0, x: 0, y: 0 };
    // Screen pixels per map unit, and the screen point the picture's middle sits at.
    const frame = () => {
      const rect = svg.getBoundingClientRect();
      const { view: current } = latest.current;
      const scale = Math.min(rect.width / (whole.width / current.zoom), rect.height / (whole.height / current.zoom));
      return { scale, mid: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    };
    const fingers = () => {
      const points = [...touching.values()];
      const at = points.length === 1 ? points[0]! : { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 };
      const spread = points.length === 1 ? 0 : Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
      return { at, spread };
    };
    const begin = () => {
      const { view: current } = latest.current;
      const { scale, mid } = frame();
      const { at, spread } = fingers();
      gesture = { from: current, spread, at, scale, held: { x: current.x + (at.x - mid.x) / scale, y: current.y + (at.y - mid.y) / scale } };
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      touching.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touching.size > 2) return;
      cancelAnimationFrame(easing.current);
      // A second tap in the same place zooms in there.
      const now = performance.now();
      if (touching.size === 1 && now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_PX) {
        const { view: current, keepIn: keep } = latest.current;
        const { scale, mid } = frame();
        const point = { x: current.x + (event.clientX - mid.x) / scale, y: current.y + (event.clientY - mid.y) / scale };
        const zoom = current.zoom * 2;
        // The tapped point stays where it was tapped.
        easeTo(keep({ zoom, x: point.x - (event.clientX - mid.x) / (scale * 2), y: point.y - (event.clientY - mid.y) / (scale * 2) }));
        lastTap = { at: 0, x: 0, y: 0 };
        return;
      }
      lastTap = { at: now, x: event.clientX, y: event.clientY };
      begin();
    };
    const move = (event: PointerEvent) => {
      if (!touching.has(event.pointerId) || !gesture) return;
      touching.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const { at, spread } = fingers();
      const { from } = gesture;
      // One finger moves only a zoomed map: zoomed out, it scrolls the page.
      if (touching.size === 1 && from.zoom <= 1) return;
      const zoom = gesture.spread > 0 && spread > 0 ? from.zoom * (spread / gesture.spread) : from.zoom;
      const scale = gesture.scale * (zoom / from.zoom);
      const { mid } = frame();
      // The point that was under the fingers stays under them.
      setMoved(latest.current.keepIn({ zoom, x: gesture.held.x - (at.x - mid.x) / scale, y: gesture.held.y - (at.y - mid.y) / scale }));
      event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      if (!touching.delete(event.pointerId)) return;
      // The finger still down carries on from where the map is.
      if (touching.size > 0) begin();
      else gesture = null;
    };
    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    return () => {
      svg.removeEventListener('pointerdown', down);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
      cancelAnimationFrame(easing.current);
    };
  }, [whole.width, whole.height, whole.left, whole.top]);

  const zoomed = view.zoom > 1.001;
  return {
    ref,
    box: { left: view.x - width / 2, top: view.y - height / 2, width, height },
    zoom: view.zoom,
    maxZoom,
    // Moved from the picture as the page frames it, which the Recenter button goes back to.
    moved: moved !== null && (zoomed || Math.hypot(view.x - middle.x, view.y - middle.y) > 1),
    zoomed,
    // Zoomed out, a finger scrolls the page past the map, and pinches are the map's. Zoomed in,
    // every gesture on the map is the map's.
    touchAction: zoomed ? 'none' : 'pan-y',
    zoomBy: (factor: number) => easeTo(keepIn({ ...view, zoom: view.zoom * factor })),
    recenter: () => moved !== null && easeTo(null),
  };
}
