import { readFileSync } from 'node:fs';
import protobuf from 'protobufjs';

const proto = readFileSync(new URL('./gtfs-realtime.proto', import.meta.url), 'utf8');
const FeedMessage = protobuf.parse(proto).root.lookupType('transit_realtime.FeedMessage');

// Plain objects with absent fields left out (defaults: false), so a present 0 can be told apart
// from a field the feed never sent. 64-bit times become numbers, and enums their names.
export function decodeFeed(bytes: Uint8Array) {
  const message = FeedMessage.decode(bytes);
  return FeedMessage.toObject(message, { longs: Number, enums: String, defaults: false }) as FeedObject;
}

export function encodeFeed(feed: FeedObject) {
  return FeedMessage.encode(FeedMessage.fromObject(feed)).finish();
}

export type FeedObject = {
  header: { gtfsRealtimeVersion: string; timestamp?: number };
  entity?: FeedEntity[];
};

export type FeedEntity = {
  id: string;
  isDeleted?: boolean;
  tripUpdate?: TripUpdate;
  vehicle?: VehiclePosition;
  alert?: Alert;
};

export type VehiclePosition = {
  trip?: TripUpdate['trip'];
  vehicle?: { id?: string; label?: string };
  position?: { latitude: number; longitude: number; bearing?: number; speed?: number };
  currentStopSequence?: number;
  stopId?: string;
  currentStatus?: 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO';
  timestamp?: number;
};

export type TripUpdate = {
  trip: {
    tripId?: string;
    routeId?: string;
    directionId?: number;
    startDate?: string;
    startTime?: string;
    scheduleRelationship?: 'SCHEDULED' | 'ADDED' | 'UNSCHEDULED' | 'CANCELED' | 'REPLACEMENT' | 'DUPLICATED' | 'DELETED' | 'NEW';
  };
  vehicle?: { id?: string; label?: string };
  stopTimeUpdate?: StopTimeUpdate[];
  timestamp?: number;
  delay?: number;
};

export type StopTimeUpdate = {
  stopSequence?: number;
  stopId?: string;
  arrival?: StopTimeEvent;
  departure?: StopTimeEvent;
  scheduleRelationship?: 'SCHEDULED' | 'SKIPPED' | 'NO_DATA' | 'UNSCHEDULED';
};

export type StopTimeEvent = { delay?: number; time?: number; uncertainty?: number };

export type TranslatedString = { translation?: { text: string; language?: string }[] };

export type Alert = {
  activePeriod?: { start?: number; end?: number }[];
  informedEntity?: { agencyId?: string; routeId?: string; routeType?: number; stopId?: string; trip?: { tripId?: string } }[];
  cause?: string;
  effect?: string;
  url?: TranslatedString;
  headerText?: TranslatedString;
  descriptionText?: TranslatedString;
  severityLevel?: string;
};
