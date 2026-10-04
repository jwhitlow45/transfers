import { RouteChip } from './RouteChip';
import { StatusTag } from './StatusTag';
import { TimeBar } from './TimeBar';
import { formatClock, minutesUntil } from '../lib/time';
import { statusOf } from '../lib/status';
import type { Connection } from '../lib/connections';
import type { RouteRef } from '../types';

export interface ConnectionRowProps {
  connection: Connection;
  alightStop: string;
  nowSec: number;
  secondTime: number;        // minutes since midnight
  secondEnd: number;         // secondTime + ride to destination (or +8 for the bar)
  secondColor: string;
  pct: (m: number) => number; // minutes → % on the card's shared scale
}

/** One first-leg vehicle under a departure card. Countdown leads: when it reaches the From stop. */
export function ConnectionRow({ connection: c, alightStop, nowSec, secondTime, secondEnd, secondColor, pct }: ConnectionRowProps) {
  const f = c.first;
  const mins = minutesUntil(f.departs, nowSec);
  const now = mins < 1;
  const st = statusOf(f.delay);
  const route: RouteRef = { label: f.agency === 'BART' ? 'BART' : f.line, agency: f.agency, color: f.color };
  const spoken = `${f.agency === 'BART' ? `BART ${f.line} line` : f.line} toward ${f.headsign}, ${now ? 'arriving now' : `arrives in ${mins} minute${mins === 1 ? '' : 's'}`}, ${formatClock(f.departs)}, ${st.label}. Off at ${alightStop} ${formatClock(f.arrives)}. ${c.transfer} minute transfer${c.tight ? ', tight' : ''}.`;
  return (
    <div role="listitem" className={`tf-row${c.tight ? ' tf-row--tight' : ''}`}>
      <span className="tf-sr">{spoken}</span>
      <div aria-hidden="true">
        <div className="tf-row__lead">{now ? 'Arriving' : 'Arrives in'}</div>
        <div className="tf-row__num">{now ? 'Now' : mins}</div>
        {!now && <div className="tf-row__unit">min</div>}
      </div>
      <div className="tf-row__main" aria-hidden="true">
        <div className="tf-row__line"><RouteChip route={route} /><span>{formatClock(f.departs)}</span></div>
        <StatusTag status={st} plain />
        <div className="tf-row__off">Off at {alightStop} {formatClock(f.arrives)}</div>
      </div>
      <div className="tf-row__xfer" aria-hidden="true">
        <div className="tf-row__xfer-min">{c.transfer} min</div>
        <div className="tf-row__xfer-label">transfer</div>
        {c.tight && <div className="tf-tight">TIGHT</div>}
      </div>
      <TimeBar rideStart={pct(f.departs)} rideEnd={pct(f.arrives)} gapEnd={pct(secondTime)} busEnd={pct(secondEnd)} busColor={secondColor} />
    </div>
  );
}
