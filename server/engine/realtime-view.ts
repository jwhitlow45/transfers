import type { FeedStatus } from '../../shared/api.ts';
import type { Agency } from '../config.ts';
import type { Outage } from '../realtime/access.ts';
import type { RtAlert, TripSnapshot } from '../realtime/snapshot.ts';

// The live data one request reads, as it stood when the request came in.
export type RealtimeView = {
  trips: TripSnapshot | null;
  alerts: RtAlert[];
  status: (agency: Agency) => FeedStatus['state'];
  updatedAt: number | null;
  // BART's elevator and escalator outages, when the rider asked for them.
  access?: Outage[] | null;
};
