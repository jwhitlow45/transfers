import type { Stop } from '../../../shared/api.ts';
import { IconChevronRight, IconWarn } from '../icons/ui.tsx';
import { type StationOutages, outageLabel, returnDate } from '../lib/outages.ts';
import { shortStopName } from '../view.ts';
import { AppLink } from './AppLink.tsx';
import { Sheet } from './Sheet.tsx';

// The answer an outage's station is named from: transfer results or trips.
type Named = { stops: Record<string, Stop> };

// An elevator or escalator out at a BART station on the trip, or at the station whose arrivals
// show. It stays on the page while it lasts, and opens what BART says about it.
export function OutageTag({ outages, data, onOpen }: { outages: StationOutages; data: Named; onOpen: () => void }) {
  return (
    <button type="button" class="tf-outage-tag" aria-haspopup="dialog" onClick={onOpen}>
      <IconWarn size={14} />
      {outageLabel(outages.kinds, shortStopName(data.stops[outages.station], 'this station'))}
      <IconChevronRight size={14} />
    </button>
  );
}

// Each outage at the station: which one, why, and when BART expects it back, with the station's
// accessibility page, and where to stop showing them, named as Settings names them (J, 2026-10-13).
export function OutageSheet({ outages, data, onClose }: { outages: StationOutages; data: Named; onClose: () => void }) {
  const stop = data.stops[outages.station];
  const name = shortStopName(stop, 'this station');
  return (
    <Sheet title={`Outages at ${name}`} subtitle="From BART's elevator and escalator status" onClose={onClose}>
      <ul class="tf-outages">
        {outages.outages.map((outage) => {
          const back = returnDate(outage.returns);
          return (
            <li key={`${outage.kind}-${outage.location}-${outage.reason}`} class="tf-outage">
              <div class="tf-outage__kicker">
                <IconWarn size={14} />
                <span class="tf-kicker">{outage.kind === 'elevator' ? 'Elevator' : 'Escalator'}</span>
              </div>
              <div class="tf-outage__where">{outage.location}</div>
              {outage.reason && <div>{outage.reason}.</div>}
              <div class="tf-muted">{back ? `Back about ${back}` : 'BART gives no return date'}</div>
            </li>
          );
        })}
      </ul>
      <div class="tf-outage-links">
        {stop?.bart && (
          <a class="tf-link-button" href={`https://www.bart.gov/stations/${stop.bart}/accessible`} target="_blank" rel="noopener">
            Accessibility at {name} on bart.gov
          </a>
        )}
        <AppLink class="tf-link-button tf-link-button--secondary" href="/settings#accessibility">
          Hide {outages.kinds.join(' and ')} outages in Settings
        </AppLink>
      </div>
    </Sheet>
  );
}
