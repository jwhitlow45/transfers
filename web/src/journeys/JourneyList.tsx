import { useId, useState } from 'preact/hooks';
import type { Journey, JourneyLeg, JourneysResponse, RideLeg } from '../../../shared/journeys.ts';
import { Collapse } from '../components/Collapse.tsx';
import { Countdown } from '../components/Countdown.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { StatusTag } from '../components/StatusTag.tsx';
import { clock, countdownTo, minutesUntil } from '../format.ts';
import { IconFold, IconGerbil } from '../icons/ui.tsx';
import { TimeLink } from '../track.tsx';
import { shortStopName, spokenRoute, statusOf, vehicleAt } from '../view.ts';
import './journeys.css';

export type JourneyListProps = { data: JourneysResponse; now: number; fromLabel: string; toLabel: string };

// The ways there, soonest first, each with when to set off, how long it takes and its vehicles,
// and opened, every step, each vehicle's time opening its live map. A way drops off once its first
// vehicle has left.
export function JourneyList({ data, now, fromLabel, toLabel }: JourneyListProps) {
  const ahead = data.journeys.filter((journey) => (firstRide(journey)?.departs ?? journey.leaves) * 1000 >= now - 30_000);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  if (ahead.length === 0) {
    return (
      <EmptyState title="No way there in the next few hours">
        <div class="tf-muted">Nothing these agencies run gets there with up to three changes.</div>
      </EmptyState>
    );
  }
  return (
    <ol class="tf-journeys" aria-label="Ways there">
      {ahead.map((journey, index) => {
        const key = signature(journey);
        return (
          <JourneyCard
            key={key}
            journey={journey}
            data={data}
            now={now}
            fromLabel={fromLabel}
            toLabel={toLabel}
            open={opened[key] ?? index === 0}
            onToggle={() => setOpened({ ...opened, [key]: !(opened[key] ?? index === 0) })}
          />
        );
      })}
    </ol>
  );
}

const firstRide = (journey: Journey) => journey.legs.find((leg): leg is RideLeg => leg.kind === 'ride');
// A way is its vehicles and where each is boarded, as the same trip is the same way however its
// times move.
const signature = (journey: Journey) => journey.legs.map((leg) => (leg.kind === 'ride' ? `${leg.trip}@${leg.from}` : 'walk')).join('|');
const minutesOf = (seconds: number) => Math.max(1, Math.round(seconds / 60));
// A walk this short, such as across the street, the card's summary leaves out, as its steps say it.
const STEP_SECONDS = 90;

function JourneyCard({ journey, data, now, fromLabel, toLabel, open, onToggle }: {
  journey: Journey;
  data: JourneysResponse;
  now: number;
  fromLabel: string;
  toLabel: string;
  open: boolean;
  onToggle: () => void;
}) {
  const panel = useId();
  const rides = journey.legs.filter((leg): leg is RideLeg => leg.kind === 'ride');
  const changes = Math.max(0, rides.length - 1);
  const length = Math.round((journey.arrives - journey.leaves) / 60);
  const kind = rides.length === 0 ? 'Walk all the way' : changes === 0 ? 'No changes' : `${changes} change${changes === 1 ? '' : 's'}`;
  const canceled = rides.some(({ canceled }) => canceled);
  const leaveIn = minutesUntil(journey.leaves, now);
  const spoken =
    `${leaveIn < 1 ? 'Leave now' : `Leave in ${leaveIn} minute${leaveIn === 1 ? '' : 's'}`}, at ${clock(journey.leaves)}, arrive ${clock(journey.arrives)}, ${length} minutes, ${kind.toLowerCase()}` +
    (rides.length > 0 ? `, by ${rides.map((ride) => (data.routes[ride.route] ? spokenRoute(data.routes[ride.route]!) : 'vehicle')).join(', then ')}` : '') +
    (canceled ? '. A vehicle on it is canceled' : '') +
    '.';
  return (
    <li class="tf-journey">
      <div class="tf-journey__band">
        {/* The whole band opens the steps, as a departure card's band does. */}
        <button type="button" class="tf-journey__toggle" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
          <span class="tf-sr">{spoken}</span>
        </button>
        <div class="tf-row tf-journey__row" aria-hidden="true">
          <Countdown {...countdownTo(journey.leaves, now, 'Leave in', 'Leave now')} />
          <div class="tf-row__main">
            <div class="tf-row__line">
              {clock(journey.leaves)} – {clock(journey.arrives)}
            </div>
            <div class="tf-journey__legs">
              {journey.legs.filter((leg) => leg.kind === 'ride' || leg.seconds >= STEP_SECONDS || rides.length === 0).map((leg, index) => (
                <span key={index} class="tf-journey__leg">
                  {index > 0 && <span class="tf-journey__sep">›</span>}
                  {leg.kind === 'walk' ? (
                    <span class="tf-journey__walk">
                      <span class="tf-walk-gerbil">
                        <IconGerbil />
                      </span>
                      Walk {minutesOf(leg.seconds)}
                    </span>
                  ) : (
                    <RouteChip route={data.routes[leg.route]} size="sm" />
                  )}
                </span>
              ))}
            </div>
            <div class="tf-row__off">
              {length}&nbsp;min · {kind}
              {canceled && <span class="tf-tight tf-journey__canceled">Canceled</span>}
            </div>
          </div>
          <IconFold />
        </div>
      </div>
      <Collapse open={open} id={panel}>
        <ol class="tf-journey__steps">
          {journey.legs.map((leg, index) => (
            <Step key={index} leg={leg} data={data} lastRide={leg === rides.at(-1)} fromLabel={fromLabel} toLabel={toLabel} />
          ))}
          <li class="tf-journey__step tf-journey__step--end">
            <span class="tf-journey__dot" aria-hidden="true" />
            <span>
              Arrive at <strong>{toLabel}</strong> {clock(journey.arrives)}
            </span>
          </li>
        </ol>
      </Collapse>
    </li>
  );
}

// A step of a way: a walk, between stops or from or to where the trip starts or ends, or a ride,
// whose time opens its live map with where the rider boards and gets off marked.
function Step({ leg, data, lastRide, fromLabel, toLabel }: { leg: JourneyLeg; data: JourneysResponse; lastRide: boolean; fromLabel: string; toLabel: string }) {
  const name = (key: string | null, fallback: string) => (key === null ? fallback : shortStopName(data.stops[key], key));
  if (leg.kind === 'walk') {
    return (
      <li class="tf-journey__step tf-journey__step--walk">
        <span class="tf-journey__dot" aria-hidden="true" />
        <span>
          <span class="tf-walk-gerbil" aria-hidden="true">
            <IconGerbil />
          </span>
          Walk {minutesOf(leg.seconds)}&nbsp;min {leg.from === null ? `from ${fromLabel} ` : ''}to {name(leg.to, toLabel)}
        </span>
      </li>
    );
  }
  const route = data.routes[leg.route];
  return (
    <li class="tf-journey__step tf-journey__step--ride">
      <span class="tf-journey__dot" aria-hidden="true" />
      <span class="tf-journey__ride">
        <span class="tf-journey__ride-line">
          <RouteChip route={route} size="sm" />
          <TimeLink trip={leg.trip} stop={data.stops[leg.from]} title={vehicleAt(route, leg.departs)} marks={[{ stop: leg.from, kind: 'yours' }, { stop: leg.to, kind: lastRide ? 'destination' : 'transfer' }]}>
            {clock(leg.departs)}
          </TimeLink>
          <span class="tf-journey__from">from {name(leg.from, fromLabel)}</span>
        </span>
        <span class="tf-journey__ride-sub">
          Toward {leg.toward} · {leg.canceled ? <span class="tf-status-text tf-status-text--late">Canceled</span> : <StatusTag status={statusOf(leg.departDelay, leg.live)} plain />}
        </span>
        <span class="tf-journey__ride-sub">
          {leg.stops} stop{leg.stops === 1 ? '' : 's'} · off at {name(leg.to, toLabel)} {clock(leg.arrives)}
        </span>
      </span>
    </li>
  );
}
