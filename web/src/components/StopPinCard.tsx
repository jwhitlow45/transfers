import type { StopResponse } from '../../../shared/api.ts';
import { clock, countdownTo, minutesUntil } from '../format.ts';
import { pinnedArrival } from '../lib/stop-pins.ts';
import type { Pin } from '../storage.ts';
import { TimeLink } from '../track.tsx';
import { pinLabel, shortStopName, statusOf, vehicleAt } from '../view.ts';
import { PinnedFrame, waitingNote } from './PinnedCard.tsx';
import { Countdown } from './Countdown.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';

// An arrival pinned at a stop, drawn as a pinned trip is: a countdown to the vehicle coming, its
// live time, which opens its map, where it is going, and the stop. On Home, above the fields, it
// names the stop, and a tap anywhere else opens the stop's arrivals. Until the stop's times
// arrive, or once the vehicle has gone by, it says so with what the pin kept, and a canceled
// vehicle is tagged as a pinned trip's is.
export function StopPinCard({ pin, data, now, open, offline, stale, onPin }: {
  pin: Pin;
  data: StopResponse | null;
  // Milliseconds, on the server's clock.
  now: number;
  // On Home: the stop, by the saved name the rider gave it when it is saved, and its arrivals.
  open?: { label: string; href: string };
  offline: boolean;
  stale: string | null;
  onPin: (pin: Pin | null) => void;
}) {
  const { arrival, canceled, lost } = pinnedArrival(pin, data);
  const route = data?.routes[arrival?.route ?? pin.arrival?.route ?? ''];
  const at = arrival?.at ?? pin.ends;
  const minutes = minutesUntil(at, now);
  const gone = !canceled && data !== null && now / 1000 > at;
  const stop = data?.stops[pin.second.board];
  const name = vehicleAt(route, at);
  const status = arrival && !canceled ? statusOf(arrival.delay, arrival.live) : null;
  const countdown = gone ? { lead: 'Arrived', num: '✓', unit: null } : countdownTo(at, now, 'Arrives in', 'Arriving');
  // As a pinned trip's card says when the answer for it cannot place its vehicles.
  const note = !data ? waitingNote(offline) : lost ? 'Times for this arrival are not available right now.' : null;
  const label = open?.label ?? shortStopName(stop, pin.search?.fromLabel ?? '');
  const spoken = [`Pinned arrival at ${label}.`, canceled ? `The ${name} is canceled.` : gone ? `The ${name} has come.` : `The ${name}, ${countdown.unit ? `in ${minutes} minutes` : 'arriving now'}.`, status && `${status.label}.`, pin.arrival && `Toward ${pin.arrival.headsign}.`]
    .filter(Boolean)
    .join(' ');
  return (
    <PinnedFrame label="Pinned arrival" open={open} tags={canceled && <span class="tf-tight">Canceled</span>} stale={data ? stale : null} onUnpin={() => onPin(null)}>
      {note ? (
        <p class="tf-pinned__note">{note}</p>
      ) : (
        <div class="tf-row tf-pinned__row">
          <span class="tf-sr">{spoken}</span>
          <Countdown {...countdown} />
          <div class="tf-row__main">
            <div class="tf-row__line">
              {route && <RouteChip route={route} hidden />}
              <TimeLink trip={pin.second.trip} stop={stop} title={name} marks={[{ stop: pin.second.board, kind: 'yours' }]} pin={{ pinned: true, label: pinLabel([route, at]), set: (on) => onPin(on ? pin : null) }}>
                {clock(at)}
              </TimeLink>
            </div>
            {status && <StatusTag status={status} plain hidden />}
            {pin.arrival && (
              <div class="tf-row__off" aria-hidden="true">
                → {pin.arrival.headsign}
              </div>
            )}
            <div class="tf-row__off" aria-hidden="true">
              at {shortStopName(stop, label)}
            </div>
          </div>
        </div>
      )}
    </PinnedFrame>
  );
}
