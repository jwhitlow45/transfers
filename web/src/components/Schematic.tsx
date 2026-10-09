import { useMemo } from 'preact/hooks';
import type { Route, Schematic as SchematicData } from '../../../shared/api.ts';
import { useMapView } from '../lib/map-view.ts';
import { routeColor, stopLetterColor } from '../lib/color.ts';
import { spread } from '../lib/spread.ts';
import { YouMarker } from './YouMarker.tsx';
import { PinchHint, Recenter } from './MapControls.tsx';

// The area around the rider drawn from our own data: route lines and stops, no streets or map
// tiles, so it arrives with the results and works offline. Stops the list shows carry the
// letter their cards do, so the rider can tell which stop each route uses.
export function Schematic({ schematic, routes, letters }: { schematic: SchematicData; routes: Record<string, Route>; letters: Record<string, string> }) {
  const extent = Math.max(150, ...schematic.stops.flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)])) * 1.15;
  // Pinched or zoomed in, it stops short of a view so close the corner it separates fills the map.
  const map = useMapView({ left: -extent, top: -extent, width: extent * 2, height: extent * 2 }, Math.max(1, Math.min(8, extent / 45)));
  // Half the width shown, in meters. Every size below follows it, so markers and lines keep
  // their size on screen at any zoom.
  const view = map.box.width / 2;
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
        <svg
          ref={map.ref}
          class={map.zoomed ? 'tf-map--zoomed' : undefined}
          style={{ touchAction: map.touchAction }}
          viewBox={`${map.box.left} ${map.box.top} ${map.box.width} ${map.box.height}`}
          role="img"
          aria-label={`Map of ${schematic.stops.length} nearby stops and the routes through them. You are in the middle.`}
        >
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
          <YouMarker x={0} y={0} dot={you} ring={you * 0.46} halo={you * 1.85} />
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
        <Recenter map={map} />
        <PinchHint map={map} />
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

