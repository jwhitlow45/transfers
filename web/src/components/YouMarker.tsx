// The rider on a map, as phones' own maps show them: a blue dot in a white ring, inside a pale
// circle of how sure the phone is. Sizes are in the map's units.
export function YouMarker({ x, y, dot, ring, halo }: { x: number; y: number; dot: number; ring: number; halo: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <circle r={halo} class="tf-you-halo" />
      <circle r={dot} class="tf-you" stroke-width={ring} />
    </g>
  );
}
