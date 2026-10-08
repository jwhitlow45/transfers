import { readFileSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { join } from 'node:path';
import { MAX_MINUTES } from '../shared/api.ts';
import { chipLabel, stopLabel } from '../shared/labels.ts';
import { parseShortTrip } from '../shared/short-links.ts';
import { DEFAULT_NEARBY_METERS, nearby } from './api/nearby.ts';
import { search } from './api/search.ts';
import { config, requireApiKeys } from './config.ts';
import { trackTarget, trackVehicle } from './engine/track.ts';
import { routeView, stopView } from './engine/views.ts';
import { type RealtimeView, RequestError, type TripRequest, destinations, planTrip, wayBack } from './engine/trip.ts';
import { KeyPool } from './realtime/keys.ts';
import { Realtime } from './realtime/manager.ts';
import { sendJson } from './json.ts';
import { ScheduleStore } from './schedule-store.ts';
import { nowSeconds } from './time.ts';

const pool = new KeyPool(requireApiKeys(), join(config.dataDir, 'key-usage.json'));
const realtime = new Realtime(pool);
const store = new ScheduleStore(config.dataDir, pool);

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    if (error instanceof RequestError) return sendJson(request, response, { error: error.message }, error.status);
    console.error(error);
    sendJson(request, response, { error: 'Something went wrong' }, 500);
  });
});

async function handle(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new RequestError(405, 'Only GET');
  if (url.pathname === '/api/health') {
    return sendJson(request, response, { schedule: store.schedule?.builtAt ?? null, realtime: realtime.updatedAt() });
  }
  if (!allowRequest(request)) throw new RequestError(429, 'Too many requests, try again in a minute');
  const schedule = store.schedule;
  if (!schedule) throw new RequestError(503, 'Loading schedules, try again in a minute');

  switch (url.pathname) {
    case '/api/search': {
      const near = point(url.searchParams);
      return sendJson(request, response, search(schedule, url.searchParams.get('q') ?? '', { routes: url.searchParams.get('kind') !== 'stop', ...(near ? { near } : {}) }));
    }
    case '/api/trip': {
      const trip = tripRequest(url.searchParams);
      // Elevator and escalator outages are fetched only for riders who asked for them, alongside
      // the rest rather than after.
      const [view, access] = await Promise.all([realtimeView(), trip.stepFree || trip.escalators ? realtime.accessOutages() : null]);
      view.access = access;
      return sendJson(request, response, planTrip(schedule, view, trip, nowSeconds()));
    }
    case '/api/vehicle': {
      const trip = url.searchParams.get('trip');
      const stop = url.searchParams.get('stop');
      if (!trip || !stop) throw new RequestError(400, 'Send trip and stop');
      trackTarget(schedule, { trip, stop });
      const [vehicles, { trips }] = await Promise.all([realtime.vehiclePositions(), realtime.current()]);
      // The vehicle the rider transfers to, with its own pinned span, prefixed "t".
      const transferTrip = url.searchParams.get('ttrip');
      const transferStop = url.searchParams.get('tstop');
      const transferSpan = spanParam(url.searchParams, 't');
      // Its own marks: where the rider boards it and, with a destination, where they leave it.
      const transferMarks = url.searchParams.getAll('tmark').slice(0, MAX_MARKS);
      // Each trip drawn from its first stop to its last.
      const whole = url.searchParams.get('whole') === '1';
      const transfer = transferTrip && transferStop ? { trip: transferTrip, stop: transferStop, whole, ...(transferMarks.length ? { marks: transferMarks } : {}), ...(transferSpan ? { span: transferSpan } : {}) } : undefined;
      const span = spanParam(url.searchParams, '');
      const marks = url.searchParams.getAll('mark').slice(0, MAX_MARKS);
      const fitOnBoard = url.searchParams.get('autofit') === '1';
      return sendJson(request, response, trackVehicle(schedule, { vehicles, trips }, { trip, stop, marks, fitOnBoard, whole, ...(span ? { span } : {}), ...(transfer ? { transfer } : {}) }, nowSeconds()));
    }
    case '/api/destinations':
      return sendJson(request, response, destinations(schedule, tripRequest(url.searchParams)));
    case '/api/way-back':
      return sendJson(request, response, wayBack(schedule, tripRequest(url.searchParams)));
    case '/api/nearby': {
      const center = point(url.searchParams);
      if (!center) throw new RequestError(400, 'Send lat and lon');
      const radius = clamp(numberParam(url.searchParams, 'r') ?? DEFAULT_NEARBY_METERS, 100, 1000);
      return sendJson(request, response, nearby(schedule, await realtimeView(), center, radius, nowSeconds()));
    }
  }
  // A short link from Share this trip opens the trip's own address, with its stops' names as the
  // app's own links carry them.
  if (url.pathname.startsWith('/s/')) {
    const short = parseShortTrip(url.pathname);
    // A link cut short or mistyped opens the app, rather than an error page a rider cannot use.
    if (!short) {
      response.writeHead(302, { Location: '/', 'Cache-Control': 'no-cache' });
      response.end();
      return;
    }
    const label = (key: string) => {
      const route = key.startsWith('route:') ? schedule.routesByKey.get(key.slice('route:'.length)) : undefined;
      const stop = route ? undefined : schedule.stopsByKey.get(key);
      return route ? chipLabel(routeView(route)) : stop ? stopLabel(stopView(schedule, stop)) : key;
    };
    const params = new URLSearchParams({ fl: label(short.from), tl: label(short.to) });
    response.writeHead(302, { Location: `/t/${encodeURIComponent(short.from)}/${encodeURIComponent(short.to)}?${params}`, 'Cache-Control': 'no-cache' });
    response.end();
    return;
  }
  // A saved trip link gets the page shell with its results already inside, so the first
  // paint underground takes one request instead of two.
  const trip = url.pathname.match(/^\/t\/([^/]+)\/([^/]+)$/);
  if (trip) return sendShell(response, async () => planTrip(schedule, await realtimeView(), tripRequest(url.searchParams, decodeURIComponent(trip[1]!), decodeURIComponent(trip[2]!)), nowSeconds()));
  throw new RequestError(404, 'Not found');
}

async function realtimeView(): Promise<RealtimeView> {
  const { trips, alerts, status } = await realtime.current();
  return { trips, alerts, status, updatedAt: realtime.updatedAt() };
}

function tripRequest(params: URLSearchParams, from = params.get('from'), to = params.get('to')): TripRequest {
  if (!from || !to) throw new RequestError(400, 'Send from and to');
  const request: TripRequest = { from, to };
  const min = numberParam(params, 'min');
  const max = numberParam(params, 'max');
  const hide = numberParam(params, 'hide');
  const walk = numberParam(params, 'walk');
  const speed = numberParam(params, 'speed');
  if (min !== undefined) request.min = clamp(Math.round(min), 0, MAX_MINUTES);
  if (max !== undefined) request.max = clamp(Math.round(max), 0, MAX_MINUTES);
  if (hide !== undefined) request.hide = clamp(Math.round(hide), 0, MAX_MINUTES);
  if (walk !== undefined) request.walk = clamp(walk, 50, 1500);
  if (speed !== undefined) request.speed = clamp(speed, 0.3, 3);
  const dest = params.get('dest');
  if (dest) request.dest = dest;
  const first = params.get('r1');
  const second = params.get('r2');
  if (first) request.firstRoutes = first.split(',');
  if (second) request.secondRoutes = second.split(',');
  if (params.get('hidden') === '1') request.hidden = true;
  if (params.get('stepfree') === '1') request.stepFree = true;
  if (params.get('escalators') === '1') request.escalators = true;
  // BART or Muni Metro at a shared station: "BA", "SF", or both.
  const agencies = (name: string) => (params.get(name) ?? '').split(',').filter((agency): agency is 'BA' | 'SF' => agency === 'BA' || agency === 'SF');
  const fromAgencies = agencies('fm');
  const toAgencies = agencies('tm');
  if (fromAgencies.length) request.fromAgencies = fromAgencies;
  if (toAgencies.length) request.toAgencies = toAgencies;
  // A pinned trip: the vehicle to transfer to and where it is boarded, with the first vehicle and
  // where the rider leaves it unless the route is already at From, and when each was scheduled there.
  const [catchTrip, board, firstTrip, alight] = ['p2', 'pb', 'p1', 'pa'].map((name) => params.get(name));
  const at = numberParam(params, 'pt');
  const firstAt = numberParam(params, 'pf');
  if (catchTrip && board && at !== undefined) {
    const first = firstTrip && alight ? { first: { trip: firstTrip, alight, ...(firstAt !== undefined ? { at: firstAt } : {}) } } : {};
    request.pin = { second: { trip: catchTrip, board }, at, ...first };
  }
  return request;
}

// A map's pinned stretch of a trip, as `from` and `to` stop positions, under an optional prefix.
function spanParam(params: URLSearchParams, prefix: string): [number, number] | undefined {
  const [from, to] = [numberParam(params, `${prefix}from`), numberParam(params, `${prefix}to`)];
  return from === undefined || to === undefined ? undefined : [Math.floor(from), Math.floor(to)];
}

function numberParam(params: URLSearchParams, name: string) {
  const value = params.get(name);
  if (value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RequestError(400, `${name} must be a number`);
  return number;
}

function point(params: URLSearchParams) {
  const lat = numberParam(params, 'lat');
  const lon = numberParam(params, 'lon');
  return lat === undefined || lon === undefined ? undefined : { lat, lon };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The page marks at most a rider's boarding and transfer stops on a map.
const MAX_MARKS = 4;

let shell: string | null = null;
async function sendShell(response: ServerResponse, data: () => Promise<unknown>) {
  shell ??= readFileSync(join(config.webDist, 'index.html'), 'utf8');
  let initial = '';
  try {
    // Escaped so trip data can never close the script element.
    initial = `<script id="initial" type="application/json">${JSON.stringify(await data()).replaceAll('<', '\\u003c')}</script>`;
  } catch (error) {
    if (!(error instanceof RequestError)) console.error(error);
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  response.end(shell.replace('</head>', `${initial}</head>`));
}

// A generous per-address limit. Every visitor shares one copy of each feed, so traffic costs
// CPU here and never 511 requests.
const REQUESTS_PER_MINUTE = 120;
const buckets = new Map<string, { count: number; minute: number }>();
function allowRequest(request: IncomingMessage) {
  // The tunnel and Caddy put the visitor's address first in X-Forwarded-For.
  const forwarded = request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for'];
  const address = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ?? request.socket.remoteAddress ?? '';
  const minute = Math.floor(Date.now() / 60_000);
  const bucket = buckets.get(address);
  if (!bucket || bucket.minute !== minute) {
    if (buckets.size > 10_000) buckets.clear();
    buckets.set(address, { count: 1, minute });
    return true;
  }
  return ++bucket.count <= REQUESTS_PER_MINUTE;
}

server.listen(config.port, () => console.log(`Listening on ${config.port}, fetching trip updates every ${realtime.tripSeconds} s while in use`));
void store.start();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    store.schedule?.close();
    process.exit(0);
  });
}
