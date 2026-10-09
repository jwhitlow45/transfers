// Walking between stops, as the server times a transfer and the page names its walk.

// Straight-line distance times this approximates walking the street grid.
export const DETOUR_FACTOR = 1.3;
// Meters per second, unless the rider set their own in Settings.
export const DEFAULT_WALK_SPEED = 1.4;

// Seconds to walk a straight-line distance along the streets.
export const walkSeconds = (meters: number, speed = DEFAULT_WALK_SPEED) => (meters * DETOUR_FACTOR) / speed;
