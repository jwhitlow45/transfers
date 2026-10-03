import { useMemo, useState } from 'preact/hooks';
import type { Alert, Connection, Departure, Group, TripResponse } from '../../../shared/api.ts';
import { takeInitialData } from '../api.ts';
import { ago, clock, countdown, lateness, walkMinutes } from '../format.ts';
import { useNow, usePoll } from '../hooks.ts';
import { navigate, tripPath } from '../router.ts';
import { matchesServerDefaults, tripApiUrl, useSettings } from '../settings.tsx';
import { type Search, loadSaved, rememberRecent, searchId } from '../storage.ts';
import { saveSearch } from './Home.tsx';
import { RouteBadge } from './RouteBadge.tsx';

const initialData = takeInitialData<TripResponse>();

export function Trip({ search }: { search: Search }) {
  const { settings } = useSettings();
  const [showHidden, setShowHidden] = useState(false);
  const url = tripApiUrl(search, settings, showHidden);
  const initial = useMemo(() => (initialData && !showHidden && matchesServerDefaults(settings) && initialData.from === search.from ? initialData : null), []);
  const { data, error, fetchedAt, offline, loading } = usePoll<TripResponse>(url, 30_000, initial);
  const now = useNow();
  const [saved, setSaved] = useState(() => loadSaved().some((item) => item.id === searchId(search)));

  useMemo(() => rememberRecent(search), [searchId(search)]);

  const setWindow = (change: Partial<Pick<Search, 'min' | 'max'>>) => navigate(tripPath({ ...search, ...change }), { replace: true });
  const firstGroup = data?.groups[0];
  const min = search.min ?? firstGroup?.window.min;
  const max = search.max ?? firstGroup?.window.max;

  return (
    <article class="trip" aria-busy={loading}>
      <header class="trip-header">
        <h1>
          {search.fromLabel} <span aria-hidden="true">→</span>
          <span class="visually-hidden"> to </span> {search.toLabel}
        </h1>
        <p class="status" role="status" aria-live="polite">
          {statusText(offline, fetchedAt, now, data?.feeds)}
        </p>
      </header>

      <div class="trip-controls">
        <fieldset class="window">
          <legend>Transfer window</legend>
          <Stepper label="Shortest" value={min} onChange={(value) => setWindow({ min: value, ...(max !== undefined && value > max ? { max: value } : {}) })} />
          <Stepper label="Longest" value={max} onChange={(value) => setWindow({ max: Math.max(value, min ?? 0) })} />
          {(search.min !== undefined || search.max !== undefined) && (
            <button type="button" class="link" onClick={() => navigate(tripPath({ ...search, min: undefined, max: undefined } as Search), { replace: true })}>
              Reset
            </button>
          )}
        </fieldset>
        <label class="toggle">
          <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.currentTarget.checked)} />
          Show hidden connections
        </label>
        <button
          type="button"
          class="secondary"
          disabled={saved}
          onClick={() => {
            const name = prompt('Name this search', `${search.fromLabel} to ${search.toLabel}`)?.trim();
            if (!name) return;
            saveSearch(search, name);
            setSaved(true);
          }}
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>

      {error && <p class="error" role="alert">{error}</p>}
      {data && data.alerts.length > 0 && <Alerts alerts={data.alerts} />}
      {data && data.groups.length === 0 && (
        <p class="empty">No transfer found between these stops. They may be too far apart to walk, or no route links them.</p>
      )}
      {data?.groups.map((group) => (
        <GroupView key={`${group.alight}|${group.board}|${group.routes.join(',')}`} group={group} data={data} now={now} showHidden={showHidden} onShowHidden={() => setShowHidden(true)} />
      ))}
      {!data && loading && <p class="empty">Loading…</p>}
    </article>
  );
}

function statusText(offline: boolean, fetchedAt: number | null, now: number, feeds: TripResponse['feeds'] | undefined) {
  if (fetchedAt === null) return offline ? 'Offline' : 'Loading';
  const when = `updated ${ago(fetchedAt, now)}`;
  const down = (feeds ?? []).filter(({ state }) => state === 'down' || state === 'stale').map(({ agency }) => agency);
  const notes = down.length > 0 ? `. Live data missing for ${down.join(', ')}` : '';
  return offline ? `Offline, ${when}${notes}` : `${when[0]!.toUpperCase()}${when.slice(1)}${notes}`;
}

function Stepper({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: number) => void }) {
  return (
    <div class="stepper">
      <span class="stepper-label" id={`stepper-${label}`}>
        {label}
      </span>
      <button type="button" aria-label={`${label} transfer, one minute less`} disabled={value === undefined || value <= 0} onClick={() => onChange((value ?? 0) - 1)}>
        −
      </button>
      <output aria-labelledby={`stepper-${label}`}>{value ?? '–'} min</output>
      <button type="button" aria-label={`${label} transfer, one minute more`} disabled={value === undefined} onClick={() => onChange((value ?? 0) + 1)}>
        +
      </button>
    </div>
  );
}

function Alerts({ alerts }: { alerts: Alert[] }) {
  return (
    <section class="alerts" aria-label="Service alerts">
      {alerts.map((alert) => (
        <details key={alert.id} class={`alert alert-${alert.relevance}`} open={alert.relevance === 'stop'}>
          <summary>
            <span class="alert-kind">{alert.relevance === 'stop' ? 'At your stop' : alert.relevance === 'route' ? 'On your route' : 'Agency notice'}</span>
            {alert.header}
          </summary>
          {alert.description && <p>{alert.description}</p>}
          {alert.url && (
            <p>
              <a href={alert.url} target="_blank" rel="noreferrer">
                More from the agency
              </a>
            </p>
          )}
        </details>
      ))}
    </section>
  );
}

function GroupView({ group, data, now, showHidden, onShowHidden }: { group: Group; data: TripResponse; now: number; showHidden: boolean; onShowHidden: () => void }) {
  const alight = data.stops[group.alight];
  const board = data.stops[group.board];
  const sameStop = group.alight === group.board;
  return (
    <section class="group" aria-label={`Transfer at ${board?.name}`}>
      <h2 class="group-heading">
        <span class="group-routes">
          {group.routes.map((key) => (
            <RouteBadge key={key} route={data.routes[key]} />
          ))}
        </span>
        <span>
          toward {group.headsign}
          <span class="group-detail">
            {sameStop ? `at ${board?.name}` : `Get off at ${alight?.name}, walk ${walkMinutes(group.walkMeters)} min to ${board?.name}`}
            {board?.code ? ` (${board.code})` : ''} · {group.window.min} to {group.window.max} min transfer
          </span>
        </span>
      </h2>
      {group.departures.length === 0 ? (
        <p class="empty">
          No connection in this window.{' '}
          {!showHidden && (
            <button type="button" class="link" onClick={onShowHidden}>
              Show hidden connections
            </button>
          )}
        </p>
      ) : (
        <ol class="departures">
          {group.departures.map((departure) => (
            <DepartureCard key={departure.trip} departure={departure} group={group} data={data} now={now} />
          ))}
        </ol>
      )}
    </section>
  );
}

function DepartureCard({ departure, group, data, now }: { departure: Departure; group: Group; data: TripResponse; now: number }) {
  const route = data.routes[departure.route];
  const late = lateness(departure.delay);
  return (
    <li class={`departure${departure.canceled ? ' canceled' : ''}`}>
      <div class="departure-main">
        <RouteBadge route={route} />
        <time class="time">{clock(departure.at)}</time>
        <span class="countdown">{departure.canceled ? 'Canceled' : countdown(departure.at, now)}</span>
        {!departure.canceled && <Lateness late={late} live={departure.live} />}
        {departure.destination !== undefined && <span class="destination">arrives {clock(departure.destination)}</span>}
      </div>
      {departure.connections.length > 0 && (
        <ul class="connections" aria-label={`Vehicles that make the ${clock(departure.at)} ${route?.name ?? ''}`}>
          {departure.connections.map((connection) => (
            <ConnectionRow key={connection.trip} connection={connection} group={group} data={data} now={now} />
          ))}
        </ul>
      )}
    </li>
  );
}

const HIDDEN_REASONS = { short: 'shorter than your minimum', long: 'longer than your maximum', soon: 'leaves too soon to reach' };

function ConnectionRow({ connection, group, data, now }: { connection: Connection; group: Group; data: TripResponse; now: number }) {
  const tight = !connection.hidden && connection.transfer === group.window.min;
  return (
    <li class={`connection${connection.hidden ? ' hidden-connection' : ''}`}>
      <RouteBadge route={data.routes[connection.route]} size="small" />
      <time class="time">{clock(connection.departs)}</time>
      <span class="countdown">{countdown(connection.departs, now)}</span>
      <Lateness late={lateness(connection.departDelay)} live={connection.live} />
      <span class="transfer">
        {connection.transfer} min transfer
        {tight && <strong class="tight"> · tight</strong>}
        {connection.hidden && <em> · {HIDDEN_REASONS[connection.hidden]}</em>}
      </span>
    </li>
  );
}

function Lateness({ late, live }: { late: ReturnType<typeof lateness>; live: boolean }) {
  if (!live) return <span class="lateness lateness-scheduled">scheduled</span>;
  return <span class={`lateness lateness-${late.tone}`}>{late.text}</span>;
}
