import { useEffect, useState } from 'preact/hooks';

export type Position = { lat: number; lon: number };
export type LocationProblem = 'denied' | 'unavailable';

// Where the phone is, or why it could not say. maximumAge is how old a position the phone may
// answer with, in milliseconds.
export function locate(maximumAge = 60_000) {
  return new Promise<Position>((resolve, reject: (problem: LocationProblem) => void) => {
    if (!('geolocation' in navigator)) return reject('unavailable');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
      (error) => reject(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge },
    );
  });
}

export const locationProblemText = (problem: LocationProblem) =>
  problem === 'denied'
    ? "Location is turned off for this site. Turn it on in your browser's site settings, or search by stop name or code."
    : 'Your location could not be found. Try again, or search by stop name or code.';

// Search finds the rider before opening Nearby and leaves the position here, so Nearby opens
// straight to the map. It is taken once, so reloading Nearby looks again.
let handed: Position | null = null;
export const handOver = (position: Position) => void (handed = position);
export function takeHanded() {
  const position = handed;
  handed = null;
  return position;
}

// Where the phone is as the rider moves, with how sure it is in meters, while location is already
// allowed. It never asks: a map opened to watch a vehicle is no reason to.
export function useWatchedPosition() {
  const [position, setPosition] = useState<(Position & { accuracy: number }) | null>(null);
  useEffect(() => {
    let watch: number | null = null;
    let gone = false;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => {
        if (gone || status.state !== 'granted' || !('geolocation' in navigator)) return;
        watch = navigator.geolocation.watchPosition(
          ({ coords }) => setPosition({ lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy }),
          () => setPosition(null),
          { enableHighAccuracy: true, maximumAge: 10_000 },
        );
      })
      .catch(() => {});
    return () => {
      gone = true;
      if (watch !== null) navigator.geolocation.clearWatch(watch);
    };
  }, []);
  return position;
}

