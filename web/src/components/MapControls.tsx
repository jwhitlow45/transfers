import { IconPinch, IconRecenter } from '../icons/ui.tsx';

type MapView = { moved: boolean; zoomed: boolean; hint: boolean; recenter: () => void };

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

// The maps have no zoom buttons (J, 2026-10-09), so until the rider first zooms one, each says
// it can, quietly, over its bottom left corner. A phone's own maps teach their gestures this way.
export function PinchHint({ map }: { map: MapView }) {
  if (!map.hint || map.zoomed) return null;
  return (
    <span class="tf-map-hint" aria-hidden="true">
      <IconPinch />
      Pinch to zoom
    </span>
  );
}
