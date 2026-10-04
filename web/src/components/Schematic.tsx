import type { Route, Schematic as SchematicData } from '../../../shared/api.ts';
import { routeColor } from '../lib/color.ts';

// The area around the rider drawn from our own data: route lines and stops, no streets or map
// tiles, so it arrives with the results and works offline.
export function Schematic({ schematic, routes }: { schematic: SchematicData; routes: Record<string, Route> }) {
  const extent = Math.max(150, ...schematic.stops.flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)])) * 1.15;
  const stop = extent / 28;
  return (
    <figure class="tf-schematic">
      <svg viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`} role="img" aria-label={`Map of ${schematic.stops.length} nearby stops and the routes through them. You are in the middle.`}>
        {schematic.lines.map((line, index) => {
          const route = routes[line.route];
          return (
            <polyline
              key={`${line.route}-${index}`}
              // SVG's y axis points down, and north is up.
              points={line.points.map(([x, y]) => `${x},${-y}`).join(' ')}
              fill="none"
              stroke={route ? routeColor(route) : 'currentColor'}
              stroke-width={extent / 70}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          );
        })}
        {schematic.stops.map(({ stop: key, x, y }) => (
          <rect key={key} x={x - stop / 2} y={-y - stop / 2} width={stop} height={stop} class="tf-schematic__stop" stroke-width={extent / 120} />
        ))}
        <circle cx="0" cy="0" r={extent / 26} class="tf-schematic__you" stroke-width={extent / 90} />
      </svg>
      <figcaption>
        <span class="tf-schematic__you-key" aria-hidden="true" />
        You
        <span class="tf-schematic__stop-key" aria-hidden="true" />
        Stops
      </figcaption>
    </figure>
  );
}
