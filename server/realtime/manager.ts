import { AGENCIES, type Agency } from '../config.ts';
import { nowSeconds } from '../time.ts';
import { BART_ELEVATOR_ADVISORY_URL, type Outage, bartStatusTableUrl, parseElevatorAdvisory, parseStatusTable } from './access.ts';
import { decodeFeed } from './feed.ts';
import { type KeyPool, pollSeconds } from './keys.ts';
import { type RtAlert, type TripSnapshot, type VehicleSnapshot, buildAlerts, buildTripSnapshot, buildVehicleSnapshot } from './snapshot.ts';

const BART_ALERTS_URL = 'https://api.bart.gov/gtfsrt/alerts.aspx';
const ALERT_SECONDS = 60;
// Elevator and escalator outages change over hours, not minutes.
const ACCESS_SECONDS = 5 * 60;
// A list kept through failures is dropped after this, rather than shown as current indefinitely.
const ACCESS_KEEP_SECONDS = 2 * 3600;
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
  private access: { elevators: Outage[] | null; escalators: Outage[] | null; elevatorsAt: number; escalatorsAt: number; fetchedAt: number; failedAt: number } = {
    elevators: null,
    escalators: null,
    elevatorsAt: 0,
    escalatorsAt: 0,
    fetchedAt: 0,
    failedAt: 0,
  };
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

  // Elevator and escalator outages at BART stations, fetched only when a rider asks for them, at
  // most every five minutes. The first request waits for them, a bounded wait. Later ones refresh
  // in the background and answer with the last list, so no request waits on bart.gov. Null when
  // none have been fetched.
  async accessOutages(): Promise<Outage[] | null> {
    const now = nowSeconds();
    if (now - Math.max(this.access.fetchedAt, this.access.failedAt) >= ACCESS_SECONDS) {
      const refreshing = this.refresh('access');
      if (this.access.elevators === null && this.access.escalators === null) await Promise.race([refreshing, new Promise((resolve) => setTimeout(resolve, 8000))]);
    }
    const { elevators, escalators } = this.access;
    return elevators === null && escalators === null ? null : [...(elevators ?? []), ...(escalators ?? [])];
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

  private refresh(feed: 'trips' | 'alerts' | 'vehicles' | 'access') {
    const existing = this.inFlight.get(feed);
    if (existing) return existing;
    const fetchFeed = { trips: () => this.fetchTrips(), alerts: () => this.fetchAlerts(), vehicles: () => this.fetchVehicles(), access: () => this.fetchAccess() }[feed];
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

  // Elevators from BART's advisory, or from bart.gov's table when it answers in the shape expected,
  // which adds each one's reason and return date. Escalators from bart.gov's table alone. A source
  // that fails, or answers in another shape, keeps its last answer, until the next good one.
  private async fetchAccess() {
    const started = nowSeconds();
    const read = (url: string, parse: (json: unknown) => Outage[] | null) =>
      this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
        .then((response) => {
          if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
          return response.json() as Promise<unknown>;
        })
        .then((json) => parse(json) ?? Promise.reject(new Error(`${url} answered in an unknown shape`)));
    const [advisory, elevatorTable, escalatorTable] = await Promise.allSettled([
      read(BART_ELEVATOR_ADVISORY_URL, parseElevatorAdvisory),
      read(bartStatusTableUrl('elevator'), (json) => parseStatusTable(json, 'elevator')),
      read(bartStatusTableUrl('escalator'), (json) => parseStatusTable(json, 'escalator')),
    ]);
    for (const [name, result] of [['BART elevator advisory', advisory], ['bart.gov elevator table', elevatorTable], ['bart.gov escalator table', escalatorTable]] as const) {
      if (result.status === 'rejected') console.error(`${name} failed:`, result.reason);
    }
    // BART's advisory is the official word. The table's rows, which add reasons and dates, are used
    // where it has them, and the advisory's own for any station the table leaves out.
    const listed = advisory.status === 'fulfilled' ? advisory.value : null;
    const table = elevatorTable.status === 'fulfilled' ? elevatorTable.value : null;
    const fresh = table || listed ? [...(table ?? []), ...(listed ?? []).filter(({ station }) => !table?.some((row) => row.station === station))] : null;
    const kept = (list: Outage[] | null, at: number) => (started - at < ACCESS_KEEP_SECONDS ? list : null);
    const elevators = fresh ?? kept(this.access.elevators, this.access.elevatorsAt);
    const escalators = escalatorTable.status === 'fulfilled' ? escalatorTable.value : kept(this.access.escalators, this.access.escalatorsAt);
    const failed = advisory.status === 'rejected' && elevatorTable.status === 'rejected';
    this.access = {
      elevators,
      escalators,
      elevatorsAt: fresh ? started : this.access.elevatorsAt,
      escalatorsAt: escalatorTable.status === 'fulfilled' ? started : this.access.escalatorsAt,
      fetchedAt: failed ? this.access.fetchedAt : started,
      failedAt: failed ? started : 0,
    };
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
