import { RouteChip } from './RouteChip';
import { DepartureCard } from './DepartureCard';
import type { PointResult } from '../lib/connections';

export interface TransferPointGroupProps {
  result: PointResult;
  firstWord: string;            // "train" / "19"
  windowText: string;           // "3–12 min"
  alightStop: string;
  destinationShort?: string;
  nowSec: number;
  scaleMinutes: number;
  onWiden: (min: number, max: number) => void;
}

/** One group per connecting route, or per transfer point when To is a route. Up to 3 cards. */
export function TransferPointGroup({ result, firstWord, windowText, onWiden, ...rest }: TransferPointGroupProps) {
  const { point, cards, widenTo } = result;
  const live = cards.filter(c => !c.canceled);
  return (
    <section className="tf-group">
      <div>
        {point.kicker && <div className="tf-kicker">{point.kicker}</div>}
        <h2 className="tf-group__title"><RouteChip route={point.route} iconSize={18} /><span>at {point.stop}</span></h2>
        <div className="tf-group__meta">{point.route.agency} stop {point.code} · {point.toward}</div>
      </div>
      {live.length === 0 ? (
        <div className="tf-empty">
          <div className="tf-empty__title">No {firstWord} connects to the {point.route.label} within {windowText}</div>
          <div className="tf-muted">{widenTo ? 'The closest connections fall just outside your window.' : 'Nothing connects in the next hour.'}</div>
          {widenTo && <button className="tf-btn-primary" onClick={() => onWiden(widenTo[0], widenTo[1])}>Widen to {widenTo[0]}–{widenTo[1]} min</button>}
        </div>
      ) : cards.map((card, i) => (
        <DepartureCard key={card.time + (card.canceled ? 'x' : '')} card={card} point={point}
          nextTime={cards.slice(i + 1).find(c => !c.canceled)?.time} {...rest} />
      ))}
    </section>
  );
}
