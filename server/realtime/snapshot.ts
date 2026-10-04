import type { Agency } from '../config.ts';
import type { Alert, FeedObject, TranslatedString } from './feed.ts';

export type RtStopTime = {
  stopId: string;
  // Unix seconds, or null when the feed sent only a delay.
  time: number | null;
  // Seconds, or null when the feed sent none.
  delay: number | null;
  skipped: boolean;
};

export type RtTrip = {
  agency: Agency;
  tripId: string;
  routeId: string | null;
  canceled: boolean;
  // Trips the schedule does not have, such as BART's extra trains.
  added: boolean;
  vehicle: string | null;
  stops: RtStopTime[];
};

export type TripSnapshot = {
  fetchedAt: number;
  feedTime: number | null;
  trips: Map<string, RtTrip>;
  // Keyed "SF:13477": each trip that has a time at that stop, with the index into trip.stops.
  byStop: Map<string, { trip: RtTrip; index: number }[]>;
  // The latest predicted time per agency: past it, only the schedule knows what runs.
  horizon: Map<Agency, number>;
};

export const tripKey = (agency: string, tripId: string) => `${agency}:${tripId}`;
export const stopKey = (agency: string, stopId: string) => `${agency}:${stopId}`;

// 511's regional feed prefixes trip and route ids with the operator ("SF:48") but not stop ids.
function splitPrefixed(id: string | undefined) {
  if (!id) return null;
  const colon = id.indexOf(':');
  return colon === -1 ? null : { agency: id.slice(0, colon), id: id.slice(colon + 1) };
}

export function buildTripSnapshot(
  feed: FeedObject,
  fetchedAt: number,
  agencies: ReadonlySet<Agency>,
  // Feeds that use bare ids (BART's own) name their agency here.
  defaultAgency?: Agency,
): TripSnapshot {
  const trips = new Map<string, RtTrip>();
  const byStop = new Map<string, { trip: RtTrip; index: number }[]>();
  const horizon = new Map<Agency, number>();
  for (const entity of feed.entity ?? []) {
    const update = entity.tripUpdate;
    if (!update || entity.isDeleted) continue;
    const prefixed = splitPrefixed(update.trip.tripId);
    const agency = (prefixed?.agency ?? defaultAgency) as Agency | undefined;
    const tripId = prefixed?.id ?? update.trip.tripId;
    if (!agency || !tripId || !agencies.has(agency)) continue;
    const relationship = update.trip.scheduleRelationship ?? 'SCHEDULED';
    if (relationship === 'DELETED') continue;
    const trip: RtTrip = {
      agency,
      tripId,
      routeId: splitPrefixed(update.trip.routeId)?.id ?? update.trip.routeId ?? null,
      canceled: relationship === 'CANCELED',
      added: relationship === 'ADDED' || relationship === 'NEW',
      vehicle: update.vehicle?.id ?? update.vehicle?.label ?? null,
      stops: [],
    };
    for (const stopUpdate of update.stopTimeUpdate ?? []) {
      if (!stopUpdate.stopId) continue;
      // A trip's first stop often has only a departure.
      const event = stopUpdate.arrival?.time !== undefined || stopUpdate.arrival?.delay !== undefined ? stopUpdate.arrival : stopUpdate.departure;
      const time = event?.time ?? null;
      const delay = event?.delay === undefined || event.delay === null ? null : withinADay(event.delay);
      const skipped = stopUpdate.scheduleRelationship === 'SKIPPED';
      if (time === null && delay === null && !skipped) continue;
      trip.stops.push({ stopId: stopUpdate.stopId, time, delay, skipped });
      if (time !== null) horizon.set(agency, Math.max(horizon.get(agency) ?? 0, time));
    }
    trips.set(tripKey(agency, tripId), trip);
    for (const [index, stopTime] of trip.stops.entries()) {
      if (stopTime.skipped) continue;
      const key = stopKey(agency, stopTime.stopId);
      let list = byStop.get(key);
      if (!list) byStop.set(key, (list = []));
      list.push({ trip, index });
    }
  }
  return { fetchedAt, feedTime: feed.header.timestamp ?? null, trips, byStop, horizon };
}

// Merges snapshots from separate feeds (511's regional feed and BART's own).
export function mergeSnapshots(snapshots: TripSnapshot[]): TripSnapshot {
  const merged: TripSnapshot = { fetchedAt: 0, feedTime: null, trips: new Map(), byStop: new Map(), horizon: new Map() };
  for (const snapshot of snapshots) {
    merged.fetchedAt = Math.max(merged.fetchedAt, snapshot.fetchedAt);
    for (const [key, trip] of snapshot.trips) merged.trips.set(key, trip);
    for (const [key, list] of snapshot.byStop) merged.byStop.set(key, [...(merged.byStop.get(key) ?? []), ...list]);
    for (const [agency, time] of snapshot.horizon) merged.horizon.set(agency, Math.max(merged.horizon.get(agency) ?? 0, time));
  }
  return merged;
}

export type RtAlert = {
  id: string;
  agencies: Agency[];
  effect: string | null;
  cause: string | null;
  header: string;
  description: string | null;
  url: string | null;
  activeUntil: number | null;
  // Keyed "SF:48" and "SF:13477".
  routes: string[];
  stops: string[];
  // Pairs the feed named together, keyed "SF:48|SF:13477": the stop is affected on that route only.
  routeStops: string[];
  agencyWide: boolean;
};

export function buildAlerts(feed: FeedObject, now: number, agencies: ReadonlySet<Agency>, defaultAgency?: Agency): RtAlert[] {
  const alerts: RtAlert[] = [];
  for (const entity of feed.entity ?? []) {
    const alert = entity.alert;
    if (!alert || entity.isDeleted || !isActive(alert, now)) continue;
    const routes = new Set<string>();
    const stops = new Set<string>();
    const routeStops = new Set<string>();
    const alertAgencies = new Set<Agency>();
    let agencyWide = false;
    for (const informed of alert.informedEntity ?? []) {
      const route = splitPrefixed(informed.routeId);
      const agency = (informed.agencyId ?? route?.agency ?? defaultAgency) as Agency | undefined;
      if (!agency || !agencies.has(agency)) continue;
      alertAgencies.add(agency);
      const routeId = route?.id ?? informed.routeId;
      const routeKey = routeId ? stopKey(agency, routeId) : null;
      const stopKeyValue = informed.stopId ? stopKey(agency, informed.stopId) : null;
      if (routeKey) routes.add(routeKey);
      if (stopKeyValue) stops.add(stopKeyValue);
      if (routeKey && stopKeyValue) routeStops.add(`${routeKey}|${stopKeyValue}`);
      if (!routeKey && !stopKeyValue && !informed.trip) agencyWide = true;
    }
    if (alertAgencies.size === 0) continue;
    // BART titles every alert "BART.gov Alert", so its description says what happened.
    const generic = (text: string | null) => !text || /^BART\.gov Alert$/i.test(text);
    const firstLine = (text: string | null) => text?.split(/(?<=[.!?])\s+|\n/)[0]?.slice(0, 160) ?? null;
    const header = generic(translated(alert.headerText)) ? firstLine(translated(alert.descriptionText)) : translated(alert.headerText);
    if (!header) continue;
    const description = translated(alert.descriptionText);
    alerts.push({
      id: entity.id,
      agencies: [...alertAgencies],
      effect: alert.effect ?? null,
      cause: alert.cause ?? null,
      header,
      description: description && description !== header ? description : null,
      url: translated(alert.url),
      activeUntil: currentPeriodEnd(alert, now),
      routes: [...routes],
      stops: [...stops],
      routeStops: [...routeStops],
      agencyWide,
    });
  }
  return alerts;
}

function isActive(alert: Alert, now: number) {
  const periods = alert.activePeriod ?? [];
  if (periods.length === 0) return true;
  return periods.some(({ start, end }) => (start ?? 0) <= now && (end === undefined || end === 0 || now < end));
}

function currentPeriodEnd(alert: Alert, now: number) {
  const period = (alert.activePeriod ?? []).find(({ start, end }) => (start ?? 0) <= now && (!end || now < end));
  return period?.end || null;
}

// English text. Some agencies append every language into the English translation after a
// "---" line, as AC Transit does, so only the first part is kept.
function translated(text: TranslatedString | undefined) {
  const translations = text?.translation ?? [];
  const english = translations.find(({ language }) => !language || language.startsWith('en')) ?? translations[0];
  const value = english?.text.split(/\r?\n---\r?\n/)[0]?.trim();
  return value || null;
}

// Where each vehicle is, keyed by its trip ("SF:12126855"), as the trip snapshot keys trips.
// `sequence` is the GTFS stop_sequence of `stopId` in the trip, which tells apart two visits to
// one stop on a loop.
export type RtVehicle = { lat: number; lon: number; bearing: number | null; at: number | null; stopId: string | null; sequence: number | null };
export type VehicleSnapshot = { fetchedAt: number; byTrip: Map<string, RtVehicle> };

export function buildVehicleSnapshot(feed: FeedObject, fetchedAt: number, agencies: ReadonlySet<Agency>): VehicleSnapshot {
  const byTrip = new Map<string, RtVehicle>();
  for (const entity of feed.entity ?? []) {
    const vehicle = entity.vehicle;
    const trip = splitPrefixed(vehicle?.trip?.tripId);
    if (!vehicle?.position || entity.isDeleted || !trip || !agencies.has(trip.agency as Agency)) continue;
    byTrip.set(tripKey(trip.agency, trip.id), {
      lat: vehicle.position.latitude,
      lon: vehicle.position.longitude,
      // Many vehicles report 0 while standing, which would point every stopped bus north.
      bearing: vehicle.position.bearing || null,
      at: vehicle.timestamp ?? null,
      stopId: vehicle.stopId ?? null,
      sequence: vehicle.currentStopSequence ?? null,
    });
  }
  return { fetchedAt, byTrip };
}

// 511 reports trips that start after midnight a whole day late or early: the 1 due at 12:27 AM
// came with a delay of 86,478 seconds, its predicted time right. No vehicle runs half a day off
// schedule, so whole days are taken out, leaving 78 seconds.
export function withinADay(delaySeconds: number) {
  return delaySeconds - DAY_SECONDS * Math.round(delaySeconds / DAY_SECONDS);
}

const DAY_SECONDS = 86_400;
