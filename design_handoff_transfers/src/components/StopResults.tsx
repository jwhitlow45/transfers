import { RouteChip } from './RouteChip';
import type { RouteResult, Stop } from '../types';

export type SearchHit = { kind: 'stop'; stop: Stop } | { kind: 'route'; route: RouteResult };

/** Same-name stops are told apart by code, agency, direction and routes served. */
export function StopResults({ query, hits, onPick, includesRoutes }: { query: string; hits: SearchHit[]; onPick: (h: SearchHit) => void; includesRoutes: boolean }) {
  const label = `${hits.length} ${includesRoutes ? 'stops and routes' : 'stops'} match “${query}”`;
  return (
    <div className="tf-results" role="region" aria-label={label}>
      <div className="tf-results__label" aria-live="polite">{label}</div>
      <div role="list">
      {hits.map(h => {
        const name = h.kind === 'stop' ? h.stop.name : h.route.name;
        const code = h.kind === 'route' ? 'Route' : h.stop.code ? `Stop ${h.stop.code}` : 'Station';
        const agency = h.kind === 'stop' ? h.stop.agency : h.route.agency;
        const dir = h.kind === 'stop' ? h.stop.direction : h.route.description;
        const chips = h.kind === 'stop' ? h.stop.routes : [h.route.route];
        return (
          <div role="listitem" key={(h.kind === 'stop' ? h.stop.id : h.route.id)}><button className="tf-result" onClick={() => onPick(h)}>
            <span className="tf-result__top"><span className="tf-result__name">{name}</span><span className="tf-result__code">{code}</span></span>
            <span className="tf-result__dir">{agency} · {dir}</span>
            <span className="tf-chips">{chips.map((r, i) => <RouteChip key={i} route={r} size="sm" />)}</span>
          </button></div>
        );
      })}
      </div>
    </div>
  );
}
