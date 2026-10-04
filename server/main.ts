import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { join } from 'node:path';
import { MAX_MINUTES } from '../shared/api.ts';
import { DEFAULT_NEARBY_METERS, nearby } from './api/nearby.ts';
import { search } from './api/search.ts';
import { config, requireApiKeys } from './config.ts';
import { trackVehicle } from './engine/track.ts';
import { type RealtimeView, RequestError, type TripRequest, destinations, planTrip } from './engine/trip.ts';
import { KeyPool } from './realtime/keys.ts';
import { Realtime } from './realtime/manager.ts';
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
      const view = await realtimeView();
      return sendJson(request, response, planTrip(schedule, view, tripRequest(url.searchParams), nowSeconds()));
    }
    case '/api/vehicle': {
      const trip = url.searchParams.get('trip');
      const stop = url.searchParams.get('stop');
      if (!trip || !stop) throw new RequestError(400, 'Send trip and stop');
      return sendJson(request, response, trackVehicle(schedule, await realtime.vehiclePositions(), { trip, stop }, nowSeconds()));
    }
    case '/api/destinations':
      return sendJson(request, response, destinations(schedule, tripRequest(url.searchParams)));
    case '/api/nearby': {
      const center = point(url.searchParams);
      if (!center) throw new RequestError(400, 'Send lat and lon');
      const radius = clamp(numberParam(url.searchParams, 'r') ?? DEFAULT_NEARBY_METERS, 100, 1000);
      return sendJson(request, response, nearby(schedule, await realtimeView(), center, radius, nowSeconds()));
    }
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
  // BART or Muni Metro at a shared station: "BA", "SF", or both.
  const agencies = (name: string) => (params.get(name) ?? '').split(',').filter((agency): agency is 'BA' | 'SF' => agency === 'BA' || agency === 'SF');
  const fromAgencies = agencies('fm');
  const toAgencies = agencies('tm');
  if (fromAgencies.length) request.fromAgencies = fromAgencies;
  if (toAgencies.length) request.toAgencies = toAgencies;
  return request;
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

// Results change only when a feed refreshes or a vehicle leaves, so most refreshes match the
// last one and get an empty 304.
function sendJson(request: IncomingMessage, response: ServerResponse, body: unknown, status = 200) {
  const text = JSON.stringify(body);
  const etag = `"${createHash('sha1').update(text).digest('base64url').slice(0, 16)}"`;
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('ETag', etag);
  if (status === 200 && request.headers['if-none-match'] === etag) {
    response.writeHead(304).end();
    return;
  }
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(request.method === 'HEAD' ? undefined : text);
}

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
