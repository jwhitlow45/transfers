import { useMemo, useState } from 'react';
import { SearchFields, type FieldValue } from '../components/SearchFields';
import { StopResults, type SearchHit } from '../components/StopResults';
import { SavedSearchCard } from '../components/SavedSearchCard';
import { RecentList } from '../components/RecentList';
import { formatClock } from '../lib/time';
import { statusOf } from '../lib/status';
import { computeTrip } from '../lib/connections';
import { ROUTES, STOPS, TRIPS } from '../data/example';
import type { RecentSearch, SavedSearch } from '../types';

export interface SearchScreenProps {
  nowSec: number;
  saved: SavedSearch[];
  recent: RecentSearch[];
  onOpenTrip: (tripId: string) => void;
  onRename: (id: string, name: string) => void;
}

export function SearchScreen({ nowSec, saved, recent, onOpenTrip, onRename }: SearchScreenProps) {
  const [from, setFrom] = useState<{ q: string; hit?: SearchHit }>({ q: '' });
  const [to, setTo] = useState<{ q: string; hit?: SearchHit }>({ q: '' });
  const [focus, setFocus] = useState<'from' | 'to' | null>(null);

  const active = focus === 'from' ? from : focus === 'to' ? to : null;
  const hits = useMemo<SearchHit[]>(() => {
    if (!active || active.hit || !active.q.trim()) return [];
    const q = active.q.trim().toLowerCase();
    const match = (name: string, code?: string, labels: string[] = []) => name.toLowerCase().includes(q) || (!!code && code.includes(q)) || labels.some(l => l.toLowerCase() === q);
    const stops: SearchHit[] = STOPS.filter(s => match(s.name, s.code, s.routes.map(r => r.label))).map(stop => ({ kind: 'stop', stop }));
    const routes: SearchHit[] = focus === 'to' ? ROUTES.filter(r => match(r.name, undefined, [r.route.label])).map(route => ({ kind: 'route', route })) : [];
    return [...stops, ...routes].slice(0, 6);
  }, [active, focus]);

  const meta = (h?: SearchHit): FieldValue['meta'] => !h ? undefined : h.kind === 'route' ? `${h.route.agency} route` : `${h.stop.agency}${h.stop.code ? ' · Stop ' + h.stop.code : ''} · ${h.stop.direction}`;
  const pick = (h: SearchHit) => {
    const name = h.kind === 'stop' ? h.stop.name : h.route.name;
    (focus === 'from' ? setFrom : setTo)({ q: name, hit: h });
    setFocus(null);
  };
  const go = () => onOpenTrip(to.hit?.kind === 'route' ? (to.hit.route as any).tripId : 'work');

  return (
    <div className="tf-scroll">
      <div className="tf-page tf-page--form">
        <div className="tf-search-head"><h1>Transfers</h1><span className="tf-muted">{formatClock(nowSec / 60)}</span></div>
        <SearchFields from={{ query: from.q, meta: meta(from.hit) }} to={{ query: to.q, meta: meta(to.hit) }}
          onFrom={q => { setFrom({ q }); setFocus('from'); }} onTo={q => { setTo({ q }); setFocus('to'); }} onFocus={setFocus}
          onSwap={() => { setFrom(to.hit?.kind === 'route' ? { q: '' } : to); setTo(from); }} />
        {(from.q || to.q) && <button className="tf-btn-primary" disabled={!(from.hit && to.hit)} onClick={go}>Find transfers</button>}
        {hits.length > 0
          ? <StopResults query={active!.q} hits={hits} onPick={pick} includesRoutes={focus === 'to'} />
          : <>
            <section className="tf-section">
              <h2>Saved</h2>
              <div className="tf-saved-grid">
                {saved.map(sv => {
                  const t = TRIPS[sv.tripId];
                  const res = computeTrip(t, sv.settings, nowSec);
                  let best: { m: number; line: string; sec: number } | undefined;
                  res.forEach(r => r.cards.forEach(c => c.connections.forEach(cn => {
                    if (!best || cn.first.leaveSec < best.sec) {
                      const f = cn.first, lbl = f.agency === 'BART' ? 'BART' : f.line.split(' ')[0];
                      best = { sec: f.leaveSec, m: Math.floor(f.leaveSec / 60),
                        line: `${lbl} ${formatClock(f.departs)} (${statusOf(f.delay).label.toLowerCase()}) → ${r.point.route.label} ${formatClock(c.time)} (${statusOf(c.departure.delay, c.scheduledOnly).label.toLowerCase()})` };
                    }
                  })));
                  return <SavedSearchCard key={sv.id} name={sv.name} chain={`${t.fromShort} → ${t.via} → ${t.toLabel}`}
                    windowText={`${sv.settings.minTransfer}–${sv.settings.maxTransfer} min`} next={best && { minutes: best.m, line: best.line }}
                    severeAlerts={t.alerts.filter(a => a.severity === 'severe').length} onOpen={() => onOpenTrip(sv.tripId)} onRename={n => onRename(sv.id, n)} />;
                })}
              </div>
            </section>
            <RecentList items={recent} onOpen={r => onOpenTrip(r.tripId)} />
          </>}
      </div>
    </div>
  );
}
