import { useEffect, useState } from 'preact/hooks';
import type { DestinationsResponse, TripResponse } from '../../../shared/api.ts';
import { getJson } from '../api.ts';
import { routeColor } from '../lib/color.ts';
import { pointId } from '../lib/results.ts';
import type { Search } from '../storage.ts';
import { chipLabel, shortStopName } from '../view.ts';
import { Sheet, Stepper, Toggle } from './Sheet.tsx';

export type SearchUpdate = (change: (search: Search) => Search) => void;
type Window = { min: number; max: number };

function WindowSteppers({ window, update }: { window: Window; update: SearchUpdate }) {
  return (
    <>
      <Stepper
        label="Minimum transfer"
        help="Time to get between stops"
        value={window.min}
        onChange={(value) => update((search) => ({ ...search, min: value, max: Math.max(search.max ?? window.max, value) }))}
      />
      <Stepper
        label="Maximum transfer"
        help="Longest wait you will accept"
        value={window.max}
        min={1}
        onChange={(value) => update((search) => ({ ...search, max: value, min: Math.min(search.min ?? window.min, value) }))}
      />
    </>
  );
}

function ResetWindow({ search, update }: { search: Search; update: SearchUpdate }) {
  if (search.min === undefined && search.max === undefined) return null;
  return (
    <button type="button" class="tf-link-button" onClick={() => update(({ min: _min, max: _max, ...rest }) => rest)}>
      Use the suggested window
    </button>
  );
}

// The compact sheet from the bottom bar.
export function TransferWindowSheet({ search, window, footer, showHidden, update, onShowHidden, onClose, onMore }: {
  search: Search;
  window: Window;
  footer: string;
  showHidden: boolean;
  update: SearchUpdate;
  onShowHidden: (show: boolean) => void;
  onClose: () => void;
  onMore: () => void;
}) {
  return (
    <Sheet title="Transfer window" subtitle="Only show connections with a transfer in this range" footer={footer} onClose={onClose}>
      <WindowSteppers window={window} update={update} />
      <div class="tf-setting">
        <div class="tf-setting__label">Hidden connections</div>
        <div class="tf-setting__help">Show transfers outside the window, and vehicles you may not reach, marked with why they were hidden.</div>
        <div class="tf-filters">
          <Toggle pressed={showHidden} onToggle={() => onShowHidden(!showHidden)}>
            Show hidden connections
          </Toggle>
        </div>
      </div>
      <ResetWindow search={search} update={update} />
      <button type="button" class="tf-link-button" onClick={onMore}>
        All trip settings
      </button>
    </Sheet>
  );
}

export function TripSettingsSheet({ search, data, window, footer, chain, destinationsUrl, update, onClose }: {
  search: Search;
  data: TripResponse | null;
  window: Window;
  footer: string;
  chain: string;
  destinationsUrl: string;
  update: SearchUpdate;
  onClose: () => void;
}) {
  const [destinations, setDestinations] = useState<DestinationsResponse | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getJson<DestinationsResponse>(destinationsUrl, { signal: controller.signal }).then(setDestinations, () => {});
    return () => controller.abort();
  }, [destinationsUrl]);

  const groups = data?.groups ?? [];
  const firstRoutes = [...new Set(groups.flatMap(({ firstRoutes }) => firstRoutes))];
  const allowed = new Set(search.firstRoutes ?? firstRoutes);
  const toggleFirst = (key: string) => {
    const next = allowed.has(key) ? [...allowed].filter((item) => item !== key) : [...allowed, key];
    // Turning every route off would show nothing, so the last one stays on.
    if (next.length === 0) return;
    update((current) => ({ ...current, firstRoutes: next.length === firstRoutes.length ? undefined : next }));
  };
  const off = new Set(search.off ?? []);
  const togglePoint = (id: string) => {
    const next = off.has(id) ? [...off].filter((item) => item !== id) : [...off, id];
    if (next.length >= groups.length) return;
    update((current) => ({ ...current, off: next.length ? next : undefined }));
  };
  const destinationLabel = (key: string) => {
    const stop = destinations?.stops[key] ?? data?.stops[key];
    return stop ? `${shortStopName(stop)}${stop.code ? ` (${stop.code})` : ''}` : key;
  };

  return (
    <Sheet title="Trip settings" subtitle={chain} footer={footer} onClose={onClose}>
      <WindowSteppers window={window} update={update} />
      <ResetWindow search={search} update={update} />
      <Stepper
        label="Hide departures leaving in less than"
        help="Time to reach your first stop"
        value={search.hide ?? 0}
        onChange={(value) => update((current) => ({ ...current, hide: value || undefined }))}
      />
      <label class="tf-setting tf-setting--block">
        <span class="tf-setting__label">Destination stop</span>
        <span class="tf-setting__help">Shows when each departure gets you there</span>
        <select
          class="tf-select"
          value={search.dest ?? ''}
          onChange={(event) => {
            const dest = event.currentTarget.value;
            update(({ dest: _dest, destLabel: _label, ...rest }) => (dest ? { ...rest, dest, destLabel: destinationLabel(dest) } : rest));
          }}
        >
          <option value="">None</option>
          {search.dest && !destinations && <option value={search.dest}>{search.destLabel ?? search.dest}</option>}
          {!destinations && <option disabled>Loading stops…</option>}
          {destinations?.groups.map((group) => {
            const routes = group.routes.map((key) => destinations.routes[key]).filter((route) => route !== undefined);
            const label = `${routes[0]?.agency === 'BA' ? 'BART' : routes.map(chipLabel).join(', ')} toward ${group.headsign}`;
            return (
              <optgroup key={group.board} label={label}>
                {group.stops.map((key) => (
                  <option key={key} value={key}>
                    {destinationLabel(key)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      {firstRoutes.length > 1 && (
        <div class="tf-setting">
          <div class="tf-setting__label">Routes on the first leg</div>
          <div class="tf-filters">
            {firstRoutes.map((key) => {
              const route = data?.routes[key];
              if (!route) return null;
              return (
                <Toggle key={key} pressed={allowed.has(key)} swatch={routeColor(route)} onToggle={() => toggleFirst(key)}>
                  {route.agency === 'BA' ? `BART · ${route.name}` : route.name}
                </Toggle>
              );
            })}
          </div>
        </div>
      )}
      {groups.length > 1 && (
        <div class="tf-setting tf-setting--last">
          <div class="tf-setting__label">Routes on the second leg</div>
          <div class="tf-filters">
            {groups.map((group) => {
              const id = pointId(group);
              const route = data?.routes[group.routes[0]!];
              return (
                <Toggle key={id} pressed={!off.has(id)} swatch={route ? routeColor(route) : undefined} onToggle={() => togglePoint(id)}>
                  {route ? chipLabel(route) : ''} toward {group.headsign}
                </Toggle>
              );
            })}
          </div>
        </div>
      )}
    </Sheet>
  );
}
