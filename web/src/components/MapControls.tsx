import { IconPinch, IconRecenter } from '../icons/ui.tsx';

type MapView = { moved: boolean; zoomed: boolean; hint: boolean; recenter: () => void };

// Said to screen readers with each map's own description, as the keys work once it has focus.
export const MAP_KEYS = 'Plus and minus zoom the map, and the arrow keys move it once zoomed in.';

// Back to the picture as framed, once the rider has moved the map: the same button on every map,
// over its top right corner.
export function Recenter({ map }: { map: MapView }) {
  if (!map.moved) return null;
  return (
    <button type="button" class="tf-map-btn tf-map-recenter" onClick={map.recenter}>
      <IconRecenter />
      Recenter
    </button>
  );
}

// The maps have no zoom buttons (J, 2026-10-09), so until the rider first zooms one, each says it
// can, quietly, over its bottom left corner, as a phone's own maps teach their gestures. While a map
// has the keyboard's focus, the corner names its keys instead (see .tf-map-frame).
export function MapHint({ map }: { map: MapView }) {
  return (
    <>
      {map.hint && !map.zoomed && (
        <span class="tf-map-hint tf-map-hint--touch" aria-hidden="true">
          <IconPinch />
          <span>
            Pinch<span class="tf-map-hint__more"> to zoom</span>
          </span>
        </span>
      )}
      <span class="tf-map-hint tf-map-hint--keys" aria-hidden="true">
        <span>
          <kbd>+</kbd> <kbd>−</kbd> zoom<span class="tf-map-hint__more">, arrows move</span>
        </span>
      </span>
    </>
  );
}
