import { useState } from 'react';
import { ResultsHeader, liveStatusText } from '../components/ResultsHeader';
import { OfflineBanner, FeedOutageBanner } from '../components/Banners';
import { AlertList } from '../components/AlertList';
import { SkeletonResults } from '../components/SkeletonResults';
import { TransferPointGroup } from '../components/TransferPointGroup';
import { DataCredit } from '../components/DataCredit';
import { BottomBar } from '../components/BottomBar';
import { TransferWindowSheet, TripSettingsSheet } from '../components/TripSettingsSheet';
import { computeTrip } from '../lib/connections';
import type { FeedState, ServiceAlert, Trip, TripSettings } from '../types';

export interface ResultsScreenProps {
  trip: Trip;
  settings: TripSettings;
  onSettings: (fn: (s: TripSettings) => TripSettings) => void;  // persisted with the saved search
  savedName: string;
  alerts: ServiceAlert[];
  feed: FeedState;
  secondsSinceUpdate: number;
  feedDownAgencies?: string[];     // e.g. ['Muni'] → those legs render as scheduled
  nowSec: number;
  onBack: () => void;
}

export function ResultsScreen({ trip, settings: s, onSettings, savedName, alerts, feed, secondsSinceUpdate, feedDownAgencies = [], nowSec, onBack }: ResultsScreenProps) {
  const [sheet, setSheet] = useState<'none' | 'window' | 'settings'>('none');
  const windowText = `${s.minTransfer}–${s.maxTransfer} min`;
  const results = computeTrip(trip, s, nowSec, feedDownAgencies);
  const dest = trip.destinations.find(d => d.value === s.destination);
  // one time scale for every card on the screen so bars compare
  let span = 60;
  results.forEach(r => r.cards.forEach(c => { if (!c.canceled) span = Math.max(span, c.time + Math.max(r.point.destRideMinutes, 8) - nowSec / 60); }));
  const scaleMinutes = Math.ceil(span / 15) * 15;

  return (
    <>
      <div className="tf-scroll">
        <ResultsHeader from={trip.fromShort} via={trip.via} to={trip.points[0].route} feed={feed}
          secondsSinceUpdate={secondsSinceUpdate} windowText={windowText} onBack={onBack} />
        <main className="tf-page">
          {feed === 'offline' && <OfflineBanner statusText={liveStatusText(feed, secondsSinceUpdate)} />}
          {feedDownAgencies.map(a => <FeedOutageBanner key={a} agency={a} routes={trip.points.filter(p => p.route.agency === a).map(p => p.route.label).join(', ')} liveAgencies="BART" />)}
          <AlertList alerts={alerts} />
          {feed === 'loading' ? <SkeletonResults /> : (
            <div className="tf-groups">
              {results.map(r => (
                <TransferPointGroup key={r.point.id} result={r} firstWord={trip.firstWord} windowText={windowText} alightStop={trip.alightStop}
                  destinationShort={dest?.short} nowSec={nowSec} scaleMinutes={scaleMinutes}
                  onWiden={(min, max) => onSettings(x => ({ ...x, minTransfer: min, maxTransfer: max }))} />
              ))}
            </div>
          )}
          <DataCredit />
        </main>
      </div>
      <BottomBar windowText={windowText} onWindow={() => setSheet('window')} onSettings={() => setSheet('settings')} />
      {sheet === 'window' && <TransferWindowSheet s={s} update={onSettings} savedWith={savedName} onClose={() => setSheet('none')} onMore={() => setSheet('settings')} />}
      {sheet === 'settings' && <TripSettingsSheet trip={trip} s={s} update={onSettings} savedWith={savedName} onClose={() => setSheet('none')} />}
    </>
  );
}
