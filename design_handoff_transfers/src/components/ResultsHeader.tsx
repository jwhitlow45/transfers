import { RouteChip } from './RouteChip';
import { IconBack } from '../icons/ui';
import type { FeedState, RouteRef } from '../types';

export interface ResultsHeaderProps {
  from: string;
  via: string;                 // worked out by the app → dashed + italic
  to: RouteRef;
  feed: FeedState;
  secondsSinceUpdate: number;
  windowText: string;          // "3–12 min"
  onBack: () => void;
}

export function liveStatusText(feed: FeedState, s: number): string {
  if (feed === 'offline') return `Offline, updated ${Math.floor(s / 60)} min ago`;
  if (feed === 'loading') return 'Loading';
  if (feed === 'refreshing') return 'Refreshing…';
  return s < 60 ? `Updated ${s} s ago` : `Updated ${Math.floor(s / 60)} min ago`;
}

export function ResultsHeader({ from, via, to, feed, secondsSinceUpdate, windowText, onBack }: ResultsHeaderProps) {
  return (
    <header className="tf-header">
      <div className="tf-header__row">
        <button className="tf-btn-icon" onClick={onBack} aria-label="Back to search"><IconBack /></button>
        <h1 className="tf-chain">
          <span>{from}</span><span className="tf-chain__arrow" aria-hidden="true">→</span>
          <span className="tf-chain__derived" title="Transfer point worked out by Transfers">{via}<span className="tf-sr"> (transfer point found for you)</span></span>
          <span className="tf-chain__arrow" aria-hidden="true">→</span>
          <RouteChip route={to} />
        </h1>
      </div>
      <div className="tf-livestatus" role="status">
        <span className={`tf-livestatus__state${feed === 'offline' ? ' tf-livestatus__state--offline' : ''}`}><span className="tf-dot" />{liveStatusText(feed, secondsSinceUpdate)}</span>
        <span aria-hidden="true">·</span>
        <span>Transfer {windowText}</span>
      </div>
      {(feed === 'refreshing' || feed === 'loading') && <div className="tf-refresh-bar" aria-hidden="true" />}
    </header>
  );
}
