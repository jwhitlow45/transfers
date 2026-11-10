import { Fragment } from 'preact';
import { useId, useState } from 'preact/hooks';
import type { Journey, JourneyLeg, JourneysResponse, RideLeg } from '../../../shared/journeys.ts';
import { Collapse } from '../components/Collapse.tsx';
import { Num } from '../components/Countdown.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { Dots } from '../components/Dots.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { Approx, StatusTag } from '../components/StatusTag.tsx';
import { approx, approxMinutes, atLeast, clock, minutesUntil, stillWaiting } from '../format.ts';
import { IconFold, IconGerbil } from '../icons/ui.tsx';
import { TimeLink } from '../track.tsx';
import { shortStopName, spokenRoute, statusOf, vehicleAt } from '../view.ts';
import './journeys.css';

export type JourneyListProps = { data: JourneysResponse; now: number; toLabel: string };

// The ways there, soonest first, each with when to set off, how long it takes and its vehicles,
// and opened, every step, each vehicle's time opening its live map. A way drops off once its first
// vehicle has left, and one yet to leave the first stop of its trip has not (see stillWaiting). A way on
// foot leaves whenever the rider does, so it stays.
export function JourneyList({ data, now, toLabel }: JourneyListProps) {
  const ahead = data.journeys.filter((journey) => {
    const first = firstRide(journey);
    return !first || stillWaiting(first.departs, now, first.notStarted) || first.departs * 1000 >= now - 30_000;
  });
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

function JourneyCard({ journey, data, now, toLabel, open, onToggle }: {
  journey: Journey;
  data: JourneysResponse;
  now: number;
  toLabel: string;
  open: boolean;
  onToggle: () => void;
}) {
  const panel = useId();
  const rides = journey.legs.filter((leg): leg is RideLeg => leg.kind === 'ride');
  const changes = Math.max(0, rides.length - 1);
  const length = Math.round((journey.arrives - journey.leaves) / 60);
  const kind = rides.length === 0 ? 'Walk all the way' : changes === 0 ? 'No changes' : `${changes} change${changes === 1 ? '' : 's'}`;
  // When to set off follows the first vehicle, and arriving the last. The band has no Scheduled
  // tag, so either from the schedule alone is marked here (see approx), and never says "now".
  const leavesScheduled = rides[0]?.live === false;
  const arrivesScheduled = rides.at(-1)?.live === false;
  const lengthScheduled = leavesScheduled || arrivesScheduled;
  // Setting off for a first vehicle yet to leave the first stop of its trip is then at the soonest.
  const leavesNotStarted = rides[0]?.notStarted === true;
  const leaveIn = leavesScheduled || leavesNotStarted ? Math.max(1, minutesUntil(journey.leaves, now)) : minutesUntil(journey.leaves, now);
  const scheduledWord = (scheduled: boolean) => (scheduled ? ', scheduled' : '');
  const spoken =
    `${leaveIn < 1 ? 'Leave now' : `Leave in ${leavesNotStarted ? 'at least ' : ''}${leaveIn} minute${leaveIn === 1 ? '' : 's'}`}, at ${clock(journey.leaves)}${scheduledWord(leavesScheduled)}, arrive ${clock(journey.arrives)}${scheduledWord(arrivesScheduled)}, ${length} minutes${scheduledWord(lengthScheduled)}, ${kind.toLowerCase()}` +
    (rides.length > 0 ? `, by ${rides.map((ride) => (data.routes[ride.route] ? spokenRoute(data.routes[ride.route]!) : 'vehicle')).join(', then ')}` : '') +
    '.';
  // When each step starts: a ride when its vehicle leaves, and a walk when the rider sets off, or
  // gets off the vehicle before it. A walk's time is the schedule's when that vehicle's is.
  const steps = journey.legs.map((leg, index) => {
    if (leg.kind === 'ride') return { leg, at: leg.departs, scheduled: !leg.live };
    const before = journey.legs.slice(0, index).findLast((earlier): earlier is RideLeg => earlier.kind === 'ride');
    return before ? { leg, at: before.arrives, scheduled: !before.live } : { leg, at: journey.leaves, scheduled: leavesScheduled };
  });
  const shownLegs = journey.legs.filter((leg) => leg.kind === 'ride' || leg.seconds >= STEP_SECONDS || rides.length === 0);
  return (
    <li class="tf-card tf-journey">
      <div class="tf-journey__band">
        {/* The whole row opens the steps, as a departure card's band does. */}
        <button type="button" class="tf-journey__toggle" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
          <span class="tf-sr">{spoken}</span>
        </button>
        <div class="tf-row" aria-hidden="true">
          <Num n={leaveIn < 1 ? 'Now' : leavesNotStarted ? atLeast(leaveIn) : approxMinutes(leaveIn, leavesScheduled)} unit={leaveIn < 1 ? null : 'min'} />
          <div class="tf-rb">
            <div class="tf-rb__main">
              <div class="tf-l1">
                {/* One run of text, so the dash has a space's room on both sides. A line too narrow
                    for both times breaks after the dash. */}
                <span>
                  {approx(clock(journey.leaves), leavesScheduled)}&nbsp;– {approx(clock(journey.arrives), arrivesScheduled)}
                </span>
              </div>
              <div class="tf-l1 tf-journey__legs">
                {shownLegs.map((leg, index) => (
                  <Fragment key={index}>
                    {index > 0 && <span class="tf-journey__sep">›</span>}
                    {leg.kind === 'walk' ? (
                      <span class="tf-journey__walk">
                        <span class="tf-walk-gerbil">
                          <IconGerbil />
                        </span>
                        Walk {minutesOf(leg.seconds)}
                      </span>
                    ) : (
                      <RouteChip route={data.routes[leg.route]} />
                    )}
                  </Fragment>
                ))}
              </div>
              <Dots class="tf-l2" tag="div" parts={[`${approx(String(length), lengthScheduled)}\u00a0min`, kind]} />
            </div>
            <span class="tf-end">
              <IconFold />
            </span>
          </div>
        </div>
      </div>
      <Collapse open={open} id={panel}>
        <ol class="tf-steps">
          {steps.map(({ leg, at, scheduled }, index) => (
            <Step key={index} leg={leg} at={at} scheduled={scheduled} data={data} lastRide={leg === rides.at(-1)} />
          ))}
          <li class="tf-row">
            <span class="tf-num">
              <span class="tf-num__clock">
                <Approx scheduled={arrivesScheduled}>{clock(journey.arrives)}</Approx>
              </span>
            </span>
            <span class="tf-step__t">
              <span>
                Arrive <strong>{toLabel}</strong>
              </span>
            </span>
          </li>
        </ol>
      </Collapse>
    </li>
  );
}

// A step of a way, as a row with its clock time in the number column: a walk, between stops or
// from or to where the trip starts or ends, or a ride, whose time opens its live map with where
// the rider boards and gets off marked.
function Step({ leg, at, scheduled, data, lastRide }: { leg: JourneyLeg; at: number; scheduled: boolean; data: JourneysResponse; lastRide: boolean }) {
  const name = (key: string) => shortStopName(data.stops[key], key);
  if (leg.kind === 'walk') {
    return (
      <li class="tf-row">
        <span class="tf-num">
          <span class="tf-num__clock">
            <Approx scheduled={scheduled}>{clock(at)}</Approx>
          </span>
        </span>
        <span class="tf-step__t">
          <span>
            <span class="tf-walk-gerbil" aria-hidden="true">
              <IconGerbil />
            </span>
            Walk {minutesOf(leg.seconds)}&nbsp;min to <strong>{name(leg.to)}</strong>
          </span>
        </span>
      </li>
    );
  }
  const route = data.routes[leg.route];
  return (
    <li class="tf-row">
      <span class="tf-num">
        <span class="tf-num__clock">
          <TimeLink trip={leg.trip} stop={data.stops[leg.from]} title={vehicleAt(route, leg.departs)} marks={[{ stop: leg.from, kind: 'yours' }, { stop: leg.to, kind: lastRide ? 'destination' : 'transfer' }]}>
            {clock(leg.departs)}
          </TimeLink>
        </span>
      </span>
      <div>
        <span class="tf-step__t">
          <span>
            <RouteChip route={route} /> from {name(leg.from)}
          </span>
        </span>
        <span class="tf-l2">Toward {leg.toward}</span>
        <span class="tf-l2">
          <StatusTag status={statusOf(leg.departDelay, leg.live, false, leg.notStarted)} plain />
        </span>
        <Dots
          class="tf-l2"
          parts={[
            `${leg.stops} stop${leg.stops === 1 ? '' : 's'}`,
            <>
              off at {name(leg.to)} <Approx scheduled={!leg.live}>{clock(leg.arrives)}</Approx>
            </>,
          ]}
        />
      </div>
    </li>
  );
}
