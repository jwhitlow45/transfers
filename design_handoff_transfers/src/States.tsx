import { ResultsScreen, type ResultsScreenProps } from './screens/ResultsScreen';
import { DEFAULT_ALERTS, DEFAULT_SETTINGS, TRIPS, DEMO_NOW_SEC } from './data/example';
import type { TripSettings } from './types';
import './styles.css';

/** Every state from the brief, rendered statically for review or visual tests (Storybook, Ladle, Playwright). */
const noop = () => {};
const base = (tripId: string, over: Partial<ResultsScreenProps> = {}, s: Partial<TripSettings> = {}): ResultsScreenProps => ({
  trip: TRIPS[tripId], settings: { ...DEFAULT_SETTINGS[tripId], ...s }, onSettings: noop, savedName: TRIPS[tripId].name,
  alerts: TRIPS[tripId].alerts.filter(a => DEFAULT_ALERTS[tripId].includes(a.id)),
  feed: 'live', secondsSinceUpdate: 12, nowSec: DEMO_NOW_SEC, onBack: noop, ...over
});

export const STATES: { name: string; note: string; props: ResultsScreenProps }[] = [
  { name: 'Results, live', note: 'Stop-moved alert on the boarding stop, open by default', props: base('work') },
  { name: 'Loading, first visit', note: 'No cache: skeleton + header refresh bar', props: base('work', { feed: 'loading' }) },
  { name: 'Loading, return visit', note: 'Cached results at once, refreshing in the background', props: base('work', { feed: 'refreshing' }) },
  { name: 'Offline', note: 'Last results kept; countdowns tick on the device', props: base('work', { feed: 'offline', secondsSinceUpdate: 184 }) },
  { name: 'No connection in window', note: 'One tap widens to the nearest fit (3–7 min)', props: base('work', {}, { minTransfer: 4, maxTransfer: 6 }) },
  { name: 'To a route + canceled trip', note: 'Two transfer points for the 22; one canceled bus', props: base('route') },
  { name: 'Scheduled only', note: 'SamTrans past the live horizon', props: base('samtrans') },
  { name: 'One agency feed down', note: 'Muni scheduled, BART live', props: base('work', { feedDownAgencies: ['Muni'] }) },
  { name: 'Alerts, all types', note: 'Stop moved, elevator, reroute, notice', props: base('work', { alerts: TRIPS.work.alerts }) }
];

export default function States() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, padding: 32 }}>
      {STATES.map(st => (
        <figure key={st.name} style={{ margin: 0 }}>
          <figcaption style={{ marginBottom: 8 }}><strong>{st.name}</strong> — {st.note}</figcaption>
          <div className="tf-app" style={{ width: 390, height: 820, border: '1px solid var(--divider)' }}><ResultsScreen {...st.props} /></div>
        </figure>
      ))}
    </div>
  );
}
