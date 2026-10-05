import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Route, Schematic as SchematicData } from '../../../shared/api.ts';
import { motionOff } from '../gestures.ts';
import { routeColor, stopLetterColor } from '../lib/color.ts';
import { spread } from '../lib/spread.ts';

// The area around the rider drawn from our own data: route lines and stops, no streets or map
// tiles, so it arrives with the results and works offline. Stops the list shows carry the
// letter their cards do, so the rider can tell which stop each route uses.
export function Schematic({ schematic, routes, letters }: { schematic: SchematicData; routes: Record<string, Route>; letters: Record<string, string> }) {
  const extent = Math.max(150, ...schematic.stops.flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)])) * 1.15;
  // Zooming in stays centered on the rider, and stops short of a view so close the corner it
  // separates fills the map.
  const zooms = ZOOMS.filter((zoom) => zoom === 1 || extent / zoom >= 45);
  const [zoomIndex, setZoomIndex] = useState(0);
  const level = Math.min(zoomIndex, zooms.length - 1);
  // Half the width shown, in meters. Every size below follows it, so markers and lines keep
  // their size on screen at any zoom.
  const view = useEased(extent / zooms[level]!);
  const stop = view / 28;
  const marker = view / 11;
  const you = view / 26;
  // SVG's y axis points down, and north is up.
  const lettered = schematic.stops.filter(({ stop: key }) => letters[key]).map(({ stop: key, x, y }) => ({ key, x, y: -y }));
  const placed = spread(lettered, marker * 1.1, you * 2.4);
  // The response describes only the routes its list shows. The map's other routes are thin gray
  // lines behind them, for context. Built once, since a zoom draws the map again on every frame.
  const [listed, others] = useMemo(() => {
    const path = (points: [number, number][]) => points.map(([x, y]) => `${x},${-y}`).join(' ');
    return [
      schematic.lines.flatMap(({ route, points }) => (routes[route] ? [{ route: routes[route], points: path(points) }] : [])),
      schematic.lines.flatMap(({ route, points }) => (routes[route] ? [] : [path(points)])),
    ] as const;
  }, [schematic, routes]);
  const width = view / 70;
  return (
    <figure class="tf-schematic">
      <div class="tf-schematic__frame">
        <svg viewBox={`${-view} ${-view} ${view * 2} ${view * 2}`} role="img" aria-label={`Map of ${schematic.stops.length} nearby stops and the routes through them. You are in the middle.`}>
          {others.map((points, index) => (
            <polyline key={`other-${index}`} points={points} fill="none" class="tf-schematic__other" stroke-width={width / 2} stroke-linecap="round" stroke-linejoin="round" />
          ))}
          {listed.map(({ route, points }, index) => (
            <polyline
              key={`${route.key}-${index}`}
              points={points}
              fill="none"
              stroke={routeColor(route)}
              stroke-width={width}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          ))}
          {schematic.stops
            .filter(({ stop: key }) => !letters[key])
            .map(({ stop: key, x, y }) => (
              <rect key={key} x={x - stop / 2} y={-y - stop / 2} width={stop} height={stop} class="tf-schematic__stop" stroke-width={view / 120} />
            ))}
          {/* Where each lettered stop really is, joined to its letter when that had to move aside. */}
          {lettered.map(({ key, x, y }, index) => {
            const at = placed[index]!;
            const color = stopLetterColor(letters[key]!);
            return (
              <g key={key}>
                {Math.hypot(at.x - x, at.y - y) > marker / 2 && <line x1={x} y1={y} x2={at.x} y2={at.y} stroke={color} stroke-width={view / 120} />}
                <rect x={x - stop / 2} y={y - stop / 2} width={stop} height={stop} fill={color} class="tf-schematic__marker" stroke-width={view / 160} />
              </g>
            );
          })}
          <circle cx="0" cy="0" r={you} class="tf-schematic__you" stroke-width={view / 90} />
          {lettered.map(({ key }, index) => {
            const { x, y } = placed[index]!;
            return (
              <g key={`${key}-letter`}>
                <rect x={x - marker / 2} y={y - marker / 2} width={marker} height={marker} fill={stopLetterColor(letters[key]!)} class="tf-schematic__marker" stroke-width={view / 90} />
                <text x={x} y={y} class="tf-schematic__letter" font-size={marker * 0.68} text-anchor="middle" dominant-baseline="central">
                  {letters[key]}
                </text>
              </g>
            );
          })}
        </svg>
        <div class="tf-schematic__zoom">
          {/* Disabled by aria only, so a button that reaches the end of its range keeps focus. */}
          <button type="button" onClick={() => level > 0 && setZoomIndex(level - 1)} aria-disabled={level === 0} aria-label="Zoom out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button type="button" onClick={() => level < zooms.length - 1 && setZoomIndex(level + 1)} aria-disabled={level === zooms.length - 1} aria-label="Zoom in around you">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true">
              <path d="M5 12h14M12 5v14" />
            </svg>
          </button>
        </div>
      </div>
      <figcaption>
        <span class="tf-schematic__you-key" aria-hidden="true" />
        You
        {/* Stops in the list wear their letters. */}
        {schematic.stops.some(({ stop: key }) => !letters[key]) && (
          <>
            <span class="tf-schematic__stop-key" aria-hidden="true" />
            Other stops
          </>
        )}
      </figcaption>
    </figure>
  );
}

const ZOOMS = [1, 2, 4, 8];
const ZOOM_MS = 200;

// Eases the view to each new width in log scale, so every doubling takes the same time. A tap
// partway through carries on from where the map is.
function useEased(target: number) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    const show = (value: number) => {
      current.current = value;
      setShown(value);
    };
    if (motionOff()) {
      show(target);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(time) {
      // A frame's time can be from just before the start.
      const progress = Math.max(0, Math.min(1, (time - start) / ZOOM_MS));
      show(from * (target / from) ** (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}
