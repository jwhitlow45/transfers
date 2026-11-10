import type { Connection, Departure, TripResponse } from '../../../shared/api.ts';
import type { Mark, Transfer } from '../track.tsx';
import { chipLabel, pinLabel, vehicleAt } from '../view.ts';

// A transfer's live map, as a time link opens it, and what its sheet's Pin names (see pinLabel).
export type ConnectionTrack = { trip: string; stop: TripResponse['stops'][string] | undefined; title: string; color?: string; marks: Mark[]; transfer?: Transfer };

// The map either vehicle of a transfer opens, wherever the transfer shows, in the results and on a
// saved card alike: the first vehicle, with where the rider gets on and where they get off to
// transfer marked, and the second drawn on the same map, on to the destination. A first vehicle
// the schedule lacks has no line to draw, so the map follows the second alone, to where the rider
// boards it.
// `alight` and `board` are the group's stops, and `walkMeters` its walk between them, which a
// vehicle letting the rider off elsewhere has its own of. `min` is the window's shortest transfer.
// `destination` is the stop the rider named, if any.
export function connectionTrack(
  connection: Connection,
  departure: Departure,
  { data, alight, board, min, walkMeters, secondColor, destination }: { data: TripResponse; alight: string; board: string; min: number; walkMeters: number; secondColor: string; destination?: string | undefined },
): { track: ConnectionTrack; label: string; offStop: string } {
  const route = data.routes[connection.route];
  const secondRoute = data.routes[departure.route];
  const offStop = connection.alight ?? alight;
  const label = pinLabel([route, connection.departs], [secondRoute, departure.at]);
  if (connection.added) {
    return { track: { trip: departure.trip, stop: data.stops[board], title: vehicleAt(secondRoute, departure.at), color: secondColor, marks: [{ stop: board, kind: 'transfer' }] }, label, offStop };
  }
  const transferScheduled = !connection.live || Boolean(connection.arrivesScheduled) || !departure.live;
  const reaches = departure.destination !== undefined ? destination : undefined;
  return {
    track: {
      trip: connection.trip,
      stop: (connection.board ? data.stops[connection.board] : undefined) ?? data.stops[data.from],
      // Both vehicles are on the map, so the sheet names both.
      title: `${route ? chipLabel(route) : 'Vehicle'}, then the ${secondRoute ? chipLabel(secondRoute) : 'next vehicle'}`,
      marks: [
        { stop: connection.board ?? data.from, kind: 'yours' },
        { stop: offStop, kind: 'transfer' },
      ],
      transfer: { trip: departure.trip, stop: board, color: secondColor, minutes: connection.transfer, scheduled: transferScheduled, ...(connection.hidden ? {} : { min }), ...(reaches ? { destination: reaches } : {}), walkMeters: connection.walkMeters ?? walkMeters },
    },
    label,
    offStop,
  };
}
