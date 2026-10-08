import { useEffect, useState } from 'preact/hooks';
import type { DestinationsResponse, TripResponse, WayBackResponse } from '../../../shared/api.ts';
import { getJson } from '../api.ts';
import { IconChevron } from '../icons/ui.tsx';
import { routeColor } from '../lib/color.ts';
import { pointId } from '../lib/results.ts';
import { shortTripPath } from '../../../shared/short-links.ts';
import { navigate, replacePage, tripPath } from '../router.ts';
import type { Search } from '../storage.ts';
import { chipLabel, shortStopName } from '../view.ts';
import { Sheet, Toggle } from './Sheet.tsx';
import { MinutesSlider, WindowSlider } from './Slider.tsx';

export type SearchUpdate = (change: (search: Search) => Search) => void;
// The sheet's title, which also names it among what a page left open (see Left in router.ts).
export const TRIP_SETTINGS = 'Trip settings';
type Window = { min: number; max: number };

function WindowSetting({ window, update }: { window: Window; update: SearchUpdate }) {
  return (
    <WindowSlider
      label="Transfer window"
      help="Shortest time to get between stops, and longest wait you will accept"
      window={window}
      onChange={({ min, max }) => update((search) => ({ ...search, min, max }))}
    />
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

// Hands the trip to the phone's share sheet, or copies its link where there is none. The link
// carries the stops only, never the rider's own settings.
function ShareButton({ search, onCopied }: { search: Search; onCopied: () => void }) {
  const share = async () => {
    const { from, to, fromLabel, toLabel } = search;
    // Short where both ends have a short form (shared/short-links.ts), which the server opens with
    // the stops' names.
    const url = location.origin + (shortTripPath(from, to) ?? tripPath({ from, to, fromLabel, toLabel }));
    if (navigator.share) {
      try {
        await navigator.share({ title: `${fromLabel} to ${toLabel}`, url });
      } catch {
        // Closing the share sheet rejects, which is the rider changing their mind.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      onCopied();
    } catch {
      // Without clipboard access there is nothing to confirm.
    }
  };
  return (
    <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={share}>
      Share this trip
    </button>
  );
}

// Sharing the trip, and its way back: from the destination stop to where the first vehicle let the
// rider off, to catch it back to where they started (see wayBack in server/engine/trip.ts), side
// by side (J, 2026-10-08). The way back is worked out once the sheet opens, and needs a destination
// to start from. It closes the sheet and takes this page's place rather than opening a page over
// it, and its own way back returns here.
function TripActions({ search, wayBackUrl, onCopied }: { search: Search; wayBackUrl: string; onCopied: () => void }) {
  const [back, setBack] = useState<WayBackResponse['back'] | undefined>(undefined);
  useEffect(() => {
    setBack(undefined);
    if (!search.dest) return;
    const controller = new AbortController();
    getJson<WayBackResponse>(wayBackUrl, { signal: controller.signal }).then(({ back }) => setBack(back), () => setBack(null));
    return () => controller.abort();
  }, [search.dest ? wayBackUrl : null]);
  const path = back ? tripPath({ from: back.from, to: back.to, fromLabel: back.fromLabel, toLabel: back.toLabel, dest: back.dest, destLabel: back.destLabel }) : null;
  const note = !search.dest ? 'Set a destination stop below for the way back.' : back === null ? `No way back found from ${search.destLabel ?? 'the destination'}.` : null;
  return (
    <div class="tf-setting">
      <div class="tf-trip-actions">
        <ShareButton search={search} onCopied={onCopied} />
        <button type="button" class="tf-btn-outline tf-btn-secondary" disabled={!path} aria-describedby={note ? 'way-back-note' : undefined} onClick={() => path && replacePage(path)}>
          Way back
        </button>
      </div>
      {note && (
        <div class="tf-setting__help tf-trip-actions__note" id="way-back-note">
          {note}
        </div>
      )}
    </div>
  );
}

// Every setting for this search, opened from the bottom bar, then those for every trip.
export function TripSettingsSheet({ search, data, window, savedName, chain, destinationsUrl, wayBackUrl, deviceHide, showHidden, update, onSave, onShowHidden, onCopied, onClose }: {
  search: Search;
  // The device's own default, which this search uses until it sets its own.
  deviceHide: number;
  data: TripResponse | null;
  window: Window;
  // The saved search's name, which keeps these settings, or null when it is not saved.
  savedName: string | null;
  chain: string;
  destinationsUrl: string;
  wayBackUrl: string;
  showHidden: boolean;
  update: SearchUpdate;
  onSave: () => void;
  onShowHidden: (show: boolean) => void;
  // The link was copied, which the screen's toast says above the sheet.
  onCopied: () => void;
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
  // At a shared station each system can catch the same route at its own stop, so twin labels
  // name their stop.
  const secondLabel = (group: (typeof groups)[number]) => {
    const route = data?.routes[group.routes[0]!];
    return `${route ? chipLabel(route) : ''} toward ${group.headsign}`;
  };
  const twins = new Set(groups.map(secondLabel).filter((label, index, all) => all.indexOf(label) !== index));
  const destinationLabel = (key: string) => {
    const stop = destinations?.stops[key] ?? data?.stops[key];
    return stop ? `${shortStopName(stop)}${stop.code ? ` (${stop.code})` : ''}` : key;
  };

  return (
    <Sheet title={TRIP_SETTINGS} subtitle={chain} onClose={onClose}>
      <TripActions search={search} wayBackUrl={wayBackUrl} onCopied={onCopied} />
      <WindowSetting window={window} update={update} />
      <ResetWindow search={search} update={update} />
      <MinutesSlider
        label="Hide departures leaving in less than"
        help="Time to reach your first stop"
        value={search.hide ?? deviceHide}
        onChange={(value) => update((current) => ({ ...current, hide: value }))}
      />
      <label class="tf-setting tf-setting--block">
        <span class="tf-setting__label">Destination stop</span>
        <span class="tf-setting__help">Shows when each departure gets you there</span>
        <span class="tf-select-wrap">
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
            {destinations?.groups.map((group, index) => {
              const routes = group.routes.map((key) => destinations.routes[key]).filter((route) => route !== undefined);
              const label = `${routes[0]?.agency === 'BA' ? 'BART' : routes.map(chipLabel).join(', ')} toward ${group.headsign}`;
              return (
                <optgroup key={`${group.board}|${index}`} label={label}>
                  {group.stops.map((key) => (
                    <option key={key} value={key}>
                      {destinationLabel(key)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <IconChevron />
        </span>
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
                  {secondLabel(group)}
                  {twins.has(secondLabel(group)) && ` at ${shortStopName(data?.stops[group.board], group.board)}`}
                </Toggle>
              );
            })}
          </div>
        </div>
      )}
      {/* Everything above is this search's own, which saving it keeps. The sheet covers the
          bottom bar's bookmark, so saving is here too. */}
      <div class="tf-sheet__saved">
        {savedName !== null ? (
          `Saved with “${savedName}”`
        ) : (
          <>
            Applies to this search.{' '}
            <button type="button" class="tf-link-button tf-sheet__save" onClick={onSave}>
              Save it to keep these settings
            </button>
          </>
        )}
      </div>
      {/* Settings for every trip on this device. Showing hidden connections is one, kept here as
          riders reach for it from results. The rest are a page of their own. Opened from here,
          back returns to these results. */}
      <div class="tf-setting tf-setting--device">
        <div class="tf-setting__label">For every trip</div>
        <div class="tf-setting__help">Show transfers outside the window, and vehicles you may not reach, marked with why they were hidden.</div>
        <div class="tf-filters">
          <Toggle pressed={showHidden} onToggle={() => onShowHidden(!showHidden)}>
            Show hidden connections
          </Toggle>
        </div>
        <div class="tf-setting__help tf-setting__more">Walking speed, accessibility, pinned trips, and more.</div>
        <a class="tf-link-button" href="/settings" onClick={(event) => (event.preventDefault(), navigate('/settings'))}>
          Device settings
        </a>
      </div>
    </Sheet>
  );
}
