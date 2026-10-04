import { RouteChip } from './RouteChip';
import { StatusTag } from './StatusTag';
import { ConnectionRow } from './ConnectionRow';
import { TimeTicks } from './TimeBar';
import { IconClock } from '../icons/ui';
import { formatClock, minutesUntil } from '../lib/time';
import { statusOf } from '../lib/status';
import type { DepartureCard as Card } from '../lib/connections';
import type { TransferPoint } from '../types';

export interface DepartureCardProps {
  card: Card;
  point: TransferPoint;
  alightStop: string;
  destinationShort?: string;   // "Home" when a destination stop is set
  nowSec: number;
  scaleMinutes: number;        // shared across the trip: ceil(longest span / 15) * 15, min 60
  nextTime?: number;           // for the canceled note
}

/** One second-leg departure: reversed band header, then every first vehicle that makes it. */
export function DepartureCard({ card, point, alightStop, destinationShort, nowSec, scaleMinutes, nextTime }: DepartureCardProps) {
  const route = point.route;
  if (card.canceled) {
    return (
      <div className="tf-canceled">
        <RouteChip route={route} />
        <span className="tf-canceled__time">{formatClock(card.time)}</span>
        <StatusTag status={statusOf(null, false, true)} />
        <span className="tf-canceled__note">Not counted.{nextTime != null && ` Next ${route.label} ${point.toward.split(', ')[1]} at ${formatClock(nextTime)}.`}</span>
      </div>
    );
  }
  const st = statusOf(card.departure.delay, card.scheduledOnly);
  const inMin = minutesUntil(card.time, nowSec);
  const dest = destinationShort && point.destRideMinutes ? `${destinationShort} ${formatClock(card.time + point.destRideMinutes)}` : null;
  const pct = (m: number) => Math.max(0, Math.min(100, ((m * 60 - nowSec) / 60 / scaleMinutes) * 100));
  const spoken = `${route.label} at ${formatClock(card.time)}, ${st.label}${card.scheduledOnly ? ', no live prediction' : ''}, ${inMin} minutes away${dest ? ', reaches ' + dest : ''}. ${card.connections.length} connection${card.connections.length === 1 ? '' : 's'}.`;
  return (
    <article className="tf-card" aria-label={spoken}>
      <h3 className="tf-sr">{spoken}</h3>
      <div className="tf-band" aria-hidden="true">
        <div className="tf-band__main">
          <div className="tf-band__line">
            <RouteChip route={route} size="band" />
            {card.scheduledOnly && <IconClock />}
            <span className="tf-band__time">{formatClock(card.time)}</span>
            <StatusTag status={st} />
          </div>
          <div className="tf-band__sub">{card.scheduledOnly ? 'Scheduled time, no live prediction' : `Arrives at ${point.stop}`}{dest && ` · ${dest}`}</div>
        </div>
        <div className="tf-band__right">
          <div className="tf-band__in">{card.scheduledOnly ? '~' : ''}{inMin} min</div>
          <div className="tf-band__inlabel">{card.scheduledOnly ? 'by schedule' : 'away'}</div>
        </div>
      </div>
      <TimeTicks scaleMinutes={scaleMinutes} />
      <div role="list" aria-label="Connecting vehicles">
        {card.connections.map(c => (
          <ConnectionRow key={c.first.id} connection={c} alightStop={alightStop} nowSec={nowSec}
            secondTime={card.time} secondEnd={card.time + Math.max(point.destRideMinutes, 8)} secondColor={route.color} pct={pct} />
        ))}
      </div>
    </article>
  );
}
