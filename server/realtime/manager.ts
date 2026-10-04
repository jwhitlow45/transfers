import { AGENCIES, type Agency } from '../config.ts';
import { nowSeconds } from '../time.ts';
import { decodeFeed } from './feed.ts';
import { type KeyPool, pollSeconds } from './keys.ts';
import { type RtAlert, type TripSnapshot, type VehicleSnapshot, buildAlerts, buildTripSnapshot, buildVehicleSnapshot } from './snapshot.ts';

const BART_ALERTS_URL = 'https://api.bart.gov/gtfsrt/alerts.aspx';
const ALERT_SECONDS = 60;
// Polling stops this long after the last request, so an idle site spends no 511 requests.
const IDLE_SECONDS = 5 * 60;
// Checks every second, so each refresh lands on its interval rather than up to 5 seconds late.
const TICK_MS = 1000;

type FeedState<T> = { value: T | null; fetchedAt: number; failedAt: number; error: string | null };

// Keeps one shared copy of each realtime feed for every visitor, fetched only while someone
// is using the site.
export class Realtime {
  readonly tripSeconds: number;
  private readonly agencies = new Set<Agency>(AGENCIES);
  private trips: FeedState<TripSnapshot> = { value: null, fetchedAt: 0, failedAt: 0, error: null };
  private alerts511: FeedState<RtAlert[]> = { value: null, fetchedAt: 0, failedAt: 0, error: null };
  private alertsBart: FeedState<RtAlert[]> = { value: null, fetchedAt: 0, failedAt: 0, error: null };
  private vehicles: FeedState<VehicleSnapshot> = { value: null, fetchedAt: 0, failedAt: 0, error: null };
  private lastDemand = 0;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = new Map<string, Promise<void>>();
  private readonly pool: KeyPool;
  private readonly fetchImpl: typeof fetch;

  constructor(pool: KeyPool, fetchImpl: typeof fetch = fetch) {
    this.pool = pool;
    this.fetchImpl = fetchImpl;
    this.tripSeconds = pollSeconds(pool.size);
  }

  // The current snapshot, fetching first when there is none or it has gone stale, such as on
  // the first request after the site sat idle. During an outage this retries no sooner than
  // the timer would, since every failed request still counts against the keys.
  async current() {
    const now = nowSeconds();
    this.lastDemand = now;
    this.schedule();
    const due = (feed: { fetchedAt: number; failedAt: number }, seconds: number) => now - feed.fetchedAt > seconds * 2 && now - Math.max(feed.fetchedAt, feed.failedAt) >= seconds;
    const waits: Promise<void>[] = [];
    if (due(this.trips, this.tripSeconds)) waits.push(this.refresh('trips'));
    if (due(this.alerts511, ALERT_SECONDS)) waits.push(this.refresh('alerts'));
    // Waiting is bounded, so a slow feed delays the first page by seconds, not indefinitely.
    if (waits.length > 0) await Promise.race([Promise.allSettled(waits), new Promise((resolve) => setTimeout(resolve, 8000))]);
    return {
      trips: this.trips.value,
      alerts: [...(this.alerts511.value ?? []), ...(this.alertsBart.value ?? [])],
      status: (agency: Agency) => this.status(agency, now),
    };
  }

  private status(agency: Agency, now: number): 'live' | 'stale' | 'schedule' | 'down' {
    const snapshot = this.trips.value;
    if (!snapshot) return 'down';
    if (!snapshot.horizon.has(agency)) return 'schedule';
    return now - this.trips.fetchedAt > this.tripSeconds * 3 ? 'stale' : 'live';
  }

  updatedAt() {
    return this.trips.fetchedAt || null;
  }

  // Vehicle positions, fetched only when someone opens a vehicle's map, never on the timer. One
  // fetch then serves every open map until the next interval, so open maps cost at most one
  // request per interval between them.
  async vehiclePositions() {
    const now = nowSeconds();
    if (now - Math.max(this.vehicles.fetchedAt, this.vehicles.failedAt) >= this.tripSeconds) {
      await Promise.race([this.refresh('vehicles'), new Promise((resolve) => setTimeout(resolve, 8000))]);
    }
    return this.vehicles.value;
  }

  private schedule() {
    if (this.timer) return;
    const tick = () => {
      this.timer = null;
      const now = nowSeconds();
      if (now - this.lastDemand > IDLE_SECONDS) return;
      // A failed fetch waits a full interval too. 511 counts failed requests against the key, so
      // retrying every tick through an outage would spend the hour's allowance in minutes.
      if (now - Math.max(this.trips.fetchedAt, this.trips.failedAt) >= this.tripSeconds) void this.refresh('trips');
      if (now - Math.max(this.alerts511.fetchedAt, this.alerts511.failedAt) >= ALERT_SECONDS) void this.refresh('alerts');
      this.timer = setTimeout(tick, TICK_MS);
      this.timer.unref();
    };
    this.timer = setTimeout(tick, TICK_MS);
    this.timer.unref();
  }

  private refresh(feed: 'trips' | 'alerts' | 'vehicles') {
    const existing = this.inFlight.get(feed);
    if (existing) return existing;
    const fetchFeed = { trips: () => this.fetchTrips(), alerts: () => this.fetchAlerts(), vehicles: () => this.fetchVehicles() }[feed];
    const work = fetchFeed().finally(() => this.inFlight.delete(feed));
    this.inFlight.set(feed, work);
    return work;
  }

  private async fetchTrips() {
    const started = nowSeconds();
    try {
      const bytes = await this.pool.request('tripupdates', { agency: 'RG' });
      this.trips = { value: buildTripSnapshot(decodeFeed(bytes), started, this.agencies), fetchedAt: started, failedAt: 0, error: null };
    } catch (error) {
      this.trips = { ...this.trips, failedAt: started, error: String(error) };
      console.error('Trip updates failed:', error);
    }
  }

  private async fetchVehicles() {
    const started = nowSeconds();
    try {
      const bytes = await this.pool.request('vehiclepositions', { agency: 'RG' });
      this.vehicles = { value: buildVehicleSnapshot(decodeFeed(bytes), started, this.agencies), fetchedAt: started, failedAt: 0, error: null };
    } catch (error) {
      this.vehicles = { ...this.vehicles, failedAt: started, error: String(error) };
      console.error('Vehicle positions failed:', error);
    }
  }

  private async fetchAlerts() {
    const started = nowSeconds();
    const [regional, bart] = await Promise.allSettled([
      this.pool.request('servicealerts', { agency: 'RG' }),
      this.fetchImpl(BART_ALERTS_URL, { signal: AbortSignal.timeout(15_000) }).then(async (response) => {
        if (!response.ok) throw new Error(`BART alerts answered ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      }),
    ]);
    if (regional.status === 'fulfilled') {
      this.alerts511 = { value: buildAlerts(decodeFeed(regional.value), started, this.agencies), fetchedAt: started, failedAt: 0, error: null };
    } else {
      this.alerts511 = { ...this.alerts511, failedAt: started, error: String(regional.reason) };
      console.error('511 alerts failed:', regional.reason);
    }
    if (bart.status === 'fulfilled') {
      this.alertsBart = { value: buildAlerts(decodeFeed(bart.value), started, this.agencies, 'BA'), fetchedAt: started, failedAt: 0, error: null };
    } else {
      this.alertsBart = { ...this.alertsBart, failedAt: started, error: String(bart.reason) };
    }
  }
}
