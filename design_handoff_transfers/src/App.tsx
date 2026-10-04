import { useEffect, useRef, useState } from 'react';
import { SearchScreen } from './screens/SearchScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { DEFAULT_ALERTS, DEFAULT_SETTINGS, RECENT, SAVED, TRIPS, DEMO_NOW_SEC } from './data/example';
import type { FeedState, TripSettings } from './types';
import './styles.css';

const REFRESH_SECONDS = 30;

/**
 * Wiring for the prototype: a 1 s device clock (countdowns tick locally, also offline),
 * a 30 s refresh, and per-trip settings saved with the search.
 * Replace the example data and the fake refresh with 511.org / BART feeds; cache the last
 * response per trip so a return visit renders at once with feed='refreshing'.
 */
export default function App() {
  const [nowSec, setNowSec] = useState(DEMO_NOW_SEC);
  const [lastUpdate, setLastUpdate] = useState(DEMO_NOW_SEC - 12);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [screen, setScreen] = useState<{ name: 'search' } | { name: 'results'; tripId: string }>({ name: 'search' });
  const [feed, setFeed] = useState<FeedState>('live');
  const [saved, setSaved] = useState(SAVED);
  const [settings, setSettings] = useState<Record<string, TripSettings>>(DEFAULT_SETTINGS);
  const cached = useRef(new Set(['work']));

  useEffect(() => { const id = setInterval(() => setNowSec(s => s + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);
  useEffect(() => {
    if (online && feed === 'live' && nowSec - lastUpdate >= REFRESH_SECONDS) refresh();
  }, [nowSec]); // eslint-disable-line react-hooks/exhaustive-deps

  function refresh(kind: FeedState = 'refreshing') {
    setFeed(kind);
    setTimeout(() => { setFeed('live'); setLastUpdate(n => Math.max(n, nowSec)); }, kind === 'loading' ? 1500 : 1100);
  }
  function openTrip(tripId: string) {
    setScreen({ name: 'results', tripId });
    refresh(cached.current.has(tripId) ? 'refreshing' : 'loading');
    cached.current.add(tripId);
  }

  if (screen.name === 'search') {
    return <div className="tf-app"><SearchScreen nowSec={nowSec} saved={saved} recent={RECENT} onOpenTrip={openTrip}
      onRename={(id, name) => setSaved(list => list.map(s => s.id === id ? { ...s, name } : s))} /></div>;
  }
  const trip = TRIPS[screen.tripId];
  const sv = saved.find(s => s.tripId === trip.id);
  return (
    <div className="tf-app">
      <ResultsScreen trip={trip} settings={settings[trip.id]} savedName={sv?.name ?? trip.name}
        onSettings={fn => setSettings(all => ({ ...all, [trip.id]: fn(all[trip.id]) }))}
        alerts={trip.alerts.filter(a => DEFAULT_ALERTS[trip.id].includes(a.id))}
        feed={online ? feed : 'offline'} secondsSinceUpdate={nowSec - lastUpdate} nowSec={nowSec}
        onBack={() => setScreen({ name: 'search' })} />
    </div>
  );
}
