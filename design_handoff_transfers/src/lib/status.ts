import type { StatusKind } from '../types';

export interface Status { kind: StatusKind; label: string }

export function statusOf(delay: number | null | undefined, scheduledOnly = false, canceled = false): Status {
  if (canceled) return { kind: 'canceled', label: 'Canceled' };
  if (scheduledOnly) return { kind: 'scheduled', label: 'Scheduled' };
  if (delay == null) return { kind: 'nodata', label: 'No delay data' };
  if (delay > 0) return { kind: 'late', label: `${delay} min late` };
  if (delay < 0) return { kind: 'early', label: `${-delay} min early` };
  return { kind: 'ontime', label: 'On time' };
}
