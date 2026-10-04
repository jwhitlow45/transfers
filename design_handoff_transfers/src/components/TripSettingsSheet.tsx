import { Sheet, Stepper } from './Sheet';
import type { Trip, TripSettings } from '../types';

type Upd = (fn: (s: TripSettings) => TripSettings) => void;

function WindowSteppers({ s, update }: { s: TripSettings; update: Upd }) {
  return <>
    <Stepper label="Minimum transfer" help="Time to get between stops" value={s.minTransfer}
      onChange={v => update(x => ({ ...x, minTransfer: v, maxTransfer: Math.max(x.maxTransfer, v) }))} />
    <Stepper label="Maximum transfer" help="Longest wait you will accept" value={s.maxTransfer} min={1}
      onChange={v => update(x => ({ ...x, maxTransfer: v, minTransfer: Math.min(x.minTransfer, v) }))} />
  </>;
}

/** Compact sheet from the bottom bar. */
export function TransferWindowSheet({ s, update, savedWith, onClose, onMore }: { s: TripSettings; update: Upd; savedWith: string; onClose: () => void; onMore: () => void }) {
  return (
    <Sheet title="Transfer window" subtitle="Only show connections with a transfer in this range" savedWith={savedWith} onClose={onClose}>
      <WindowSteppers s={s} update={update} />
      <button onClick={onMore} style={{ minHeight: 48, color: 'var(--accent-ink)', fontWeight: 650, textDecoration: 'underline', textUnderlineOffset: 3 }}>All trip settings</button>
    </Sheet>
  );
}

export function TripSettingsSheet({ trip, s, update, savedWith, onClose }: { trip: Trip; s: TripSettings; update: Upd; savedWith: string; onClose: () => void }) {
  const lines = trip.firsts.filter((f, i, a) => a.findIndex(x => x.line === f.line) === i);
  return (
    <Sheet title="Trip settings" subtitle={`${trip.fromShort} → ${trip.via} → ${trip.toLabel}`} savedWith={savedWith} onClose={onClose}>
      <WindowSteppers s={s} update={update} />
      <Stepper label="Hide departures leaving in less than" help={`Time to reach ${trip.fromShort}`} value={s.hideUnder}
        onChange={v => update(x => ({ ...x, hideUnder: v }))} />
      <label className="tf-setting" style={{ display: 'block' }}>
        <span className="tf-setting__label" style={{ display: 'block' }}>Destination stop on the {trip.toLabel}</span>
        <span className="tf-setting__help">Shows when each departure gets you there</span>
        <select className="tf-select" value={s.destination} onChange={e => update(x => ({ ...x, destination: e.target.value }))}>
          {trip.destinations.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <div className="tf-setting">
        <div className="tf-setting__label">Routes on the first leg</div>
        <div className="tf-filters">{lines.map(f => {
          const on = !s.disabledLines[f.line];
          return <button key={f.line} className="tf-filter" aria-pressed={on} onClick={() => update(x => ({ ...x, disabledLines: { ...x.disabledLines, [f.line]: on } }))}>
            <span className="tf-filter__swatch" style={{ background: f.color }} />{f.agency === 'BART' ? `BART · ${f.headsign}` : f.line}</button>;
        })}</div>
      </div>
      <div className="tf-setting" style={{ borderBottom: 0 }}>
        <div className="tf-setting__label">Routes on the second leg</div>
        <div className="tf-filters">{trip.points.map(p => {
          const on = !s.disabledPoints[p.id];
          return <button key={p.id} className="tf-filter" aria-pressed={on} onClick={() => update(x => ({ ...x, disabledPoints: { ...x.disabledPoints, [p.id]: on } }))}>
            <span className="tf-filter__swatch" style={{ background: p.route.color }} />{p.route.label} {p.toward.split(', ')[1]}</button>;
        })}</div>
      </div>
    </Sheet>
  );
}
