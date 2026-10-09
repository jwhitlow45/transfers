import type { StopResponse } from '../../../shared/api.ts';
import { clock, minutesUntil } from '../format.ts';
import { IconClose, IconPin, IconWarn } from '../icons/ui.tsx';
import { pinnedArrival } from '../lib/stop-pins.ts';
import type { Pin } from '../storage.ts';
import { TimeLink } from '../track.tsx';
import { chipLabel, shortStopName, statusOf } from '../view.ts';
import { OpenTrip } from './PinnedCard.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';

// An arrival pinned at a stop, drawn as a pinned trip is: a countdown to the vehicle coming, its
// live time, which opens its map, where it is going, and the stop. On Home, above the fields, it
// names the stop, and a tap anywhere else opens the stop's arrivals. Until the stop's times
// arrive, or once the vehicle has gone by, it says so with what the pin kept.
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
  const found = pinnedArrival(pin, data);
  const route = data?.routes[found?.arrival.route ?? pin.arrival?.route ?? ''];
  const at = found?.arrival.at ?? pin.ends;
  const minutes = minutesUntil(at, now);
  const gone = !found && data !== null && now / 1000 > at;
  const stop = data?.stops[pin.second.board];
  const name = `${route ? chipLabel(route) : 'Vehicle'} at ${clock(at)}`;
  const status = found ? statusOf(found.arrival.delay, found.arrival.live) : null;
  const countdown = gone ? { lead: 'Arrived', num: '✓', unit: false } : minutes < 1 ? { lead: 'Arriving', num: 'Now', unit: false } : { lead: 'Arrives in', num: String(minutes), unit: true };
  const note = !data ? (offline ? 'Times can’t load right now. They show again once the phone is back online.' : 'Getting live predictions…') : null;
  const label = open?.label ?? shortStopName(stop, pin.search?.fromLabel ?? '');
  const spoken = [`Pinned arrival at ${label}.`, gone ? `The ${name} has come.` : `The ${name}, ${countdown.unit ? `in ${minutes} minutes` : 'arriving now'}.`, status && `${status.label}.`, pin.arrival && `Toward ${pin.arrival.headsign}.`]
    .filter(Boolean)
    .join(' ');
  return (
    <section class={`tf-pinned${open ? ' tf-pinned--opens' : ''}`} aria-label="Pinned arrival">
      {open && <OpenTrip trip={open} />}
      <div class="tf-pinned__head">
        <span class="tf-kicker tf-pinned__kicker">
          <IconPin filled size={13} />
          Pinned
        </span>
        {open && <span class="tf-pinned__trip">{open.label}</span>}
        <button type="button" class="tf-pinned__unpin" onClick={() => onPin(null)}>
          <IconClose size={16} />
          Unpin
        </button>
      </div>
      {stale && (
        <p class="tf-pinned__stale">
          <IconWarn size={14} />
          {stale}
        </p>
      )}
      {note ? (
        <p class="tf-pinned__note">{note}</p>
      ) : (
        <div class="tf-row tf-pinned__row">
          <span class="tf-sr">{spoken}</span>
          <div aria-hidden="true">
            <div class="tf-row__lead">{countdown.lead}</div>
            <div class="tf-row__num">{countdown.num}</div>
            {countdown.unit && <div class="tf-row__unit">min</div>}
          </div>
          <div class="tf-row__main">
            <div class="tf-row__line">
              {route && <RouteChip route={route} hidden />}
              <TimeLink trip={pin.second.trip} stop={stop} title={name} marks={[{ stop: pin.second.board, kind: 'yours' }]} pin={{ pinned: true, label: `the ${name}`, set: (on) => onPin(on ? pin : null) }}>
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
    </section>
  );
}
