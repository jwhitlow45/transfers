import type { Route, Schematic as SchematicData } from '../../../shared/api.ts';

// The area around the rider drawn from our own data: route lines and stops, no streets or map
// tiles, so it appears with the results and works offline.
export function Schematic({ schematic, routes }: { schematic: SchematicData; routes: Record<string, Route> }) {
  const extent = Math.max(150, ...schematic.stops.flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)])) * 1.15;
  // SVG's y axis points down, and north is up.
  const point = (x: number, y: number) => `${x},${-y}`;
  return (
    <figure class="schematic">
      <svg viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`} role="img" aria-label={`Map of ${schematic.stops.length} nearby stops and the routes through them`}>
        {schematic.lines.map((line, index) => (
          <polyline
            key={`${line.route}-${index}`}
            points={line.points.map(([x, y]) => point(x, y)).join(' ')}
            fill="none"
            stroke={routes[line.route]?.color ? `#${routes[line.route]!.color}` : 'currentColor'}
            stroke-width={extent / 60}
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity="0.7"
          />
        ))}
        {schematic.stops.map((stop) => (
          <circle key={stop.stop} cx={stop.x} cy={-stop.y} r={extent / 45} class="schematic-stop" />
        ))}
        <circle cx="0" cy="0" r={extent / 30} class="schematic-you" />
      </svg>
      <figcaption>
        <span class="schematic-you-key" aria-hidden="true" /> You
      </figcaption>
    </figure>
  );
}
