import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// 511 allows each key 60 requests per hour, and each endpoint counts separately (seen live:
// three endpoints each reported 59 left after one request apiece). The pool spreads requests
// across keys by how many each has left on that endpoint, and remembers its usage on disk so a
// restart does not spend requests the last run already used.
export type Endpoint = 'tripupdates' | 'vehiclepositions' | 'servicealerts' | 'datafeeds';

export const HOURLY_LIMIT = 60;
const HOUR = 3600;

type Usage = {
  // Unix seconds of each request in the past hour.
  uses: number[];
  // The last RateLimit-Remaining header, and when it came.
  remaining: number | null;
  remainingAt: number | null;
  blockedUntil: number | null;
};

export class KeyPool {
  readonly size: number;
  private usage: Record<string, Usage> = {};
  private readonly keys: { key: string; id: string }[];
  private readonly statePath: string;
  private readonly fetchImpl: typeof fetch;

  constructor(keys: string[], statePath: string, fetchImpl: typeof fetch = fetch) {
    this.statePath = statePath;
    this.fetchImpl = fetchImpl;
    // Usage is stored under a short hash, so the state file holds no keys.
    this.keys = keys.map((key) => ({ key, id: createHash('sha256').update(key).digest('hex').slice(0, 8) }));
    this.size = keys.length;
    try {
      this.usage = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      this.usage = {};
    }
  }

  // Requests left on an endpoint across all keys, estimated for the next hour.
  remaining(endpoint: Endpoint, now: number) {
    return this.keys.reduce((total, { id }) => total + Math.max(0, this.estimate(id, endpoint, now)), 0);
  }

  async request(endpoint: Endpoint, params: Record<string, string>, now = Math.floor(Date.now() / 1000)) {
    const choice = this.pick(endpoint, now);
    if (!choice) throw new RateLimitedError(endpoint);
    const usage = this.usageFor(choice.id, endpoint);
    usage.uses.push(now);
    const url = `https://api.511.org/transit/${endpoint}?${new URLSearchParams({ ...params, api_key: choice.key })}`;
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
      const remaining = response.headers.get('RateLimit-Remaining');
      if (remaining !== null && !Number.isNaN(Number(remaining))) {
        usage.remaining = Number(remaining);
        usage.remainingAt = now;
      }
      if (response.status === 429) {
        usage.blockedUntil = this.windowReopens(usage, now);
        throw new RateLimitedError(endpoint);
      }
      if (response.status === 401 || response.status === 403) {
        // A bad key stays bad, so it sits out a day instead of failing every poll.
        usage.blockedUntil = now + 24 * HOUR;
        throw new Error(`511 rejected key ${choice.id} with ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      if (!response.ok) throw new Error(`511 ${endpoint} answered ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } finally {
      this.save(now);
    }
  }

  private pick(endpoint: Endpoint, now: number) {
    let best: { key: string; id: string; left: number } | null = null;
    for (const { key, id } of this.keys) {
      const usage = this.usageFor(id, endpoint);
      if (usage.blockedUntil !== null && usage.blockedUntil > now) continue;
      const left = this.estimate(id, endpoint, now);
      if (left > 0 && (!best || left > best.left)) best = { key, id, left };
    }
    return best;
  }

  // The fewer of what this pool has counted in the past hour and what 511 last reported, less
  // requests made since that report.
  private estimate(id: string, endpoint: Endpoint, now: number) {
    const usage = this.usageFor(id, endpoint);
    usage.uses = usage.uses.filter((time) => time > now - HOUR);
    let left = HOURLY_LIMIT - usage.uses.length;
    if (usage.remaining !== null && usage.remainingAt !== null && usage.remainingAt > now - HOUR) {
      const since = usage.uses.filter((time) => time > (usage.remainingAt ?? 0)).length;
      left = Math.min(left, usage.remaining - since);
    }
    return left;
  }

  // 511 does not say when its window resets, so assume a sliding hour: the key is usable again
  // when its oldest recent request ages out, and waits at least 5 minutes either way.
  private windowReopens(usage: Usage, now: number) {
    const oldest = usage.uses.find((time) => time > now - HOUR) ?? now;
    return Math.max(now + 300, oldest + HOUR);
  }

  private usageFor(id: string, endpoint: Endpoint) {
    const name = `${id}:${endpoint}`;
    return (this.usage[name] ??= { uses: [], remaining: null, remainingAt: null, blockedUntil: null });
  }

  private save(now: number) {
    for (const usage of Object.values(this.usage)) usage.uses = usage.uses.filter((time) => time > now - HOUR);
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(`${this.statePath}.tmp`, JSON.stringify(this.usage));
      renameSync(`${this.statePath}.tmp`, this.statePath);
    } catch (error) {
      console.error('Could not save 511 key usage:', error);
    }
  }
}

export class RateLimitedError extends Error {
  constructor(endpoint: Endpoint) {
    super(`Every 511 key is out of requests for ${endpoint}`);
  }
}

// Seconds between trip update fetches: 30, or longer when there are too few keys to fetch that
// often while keeping a fifth of each hour's requests in reserve for restarts and retries.
export function pollSeconds(keyCount: number, target = 30) {
  const fastest = HOUR / (Math.max(1, keyCount) * HOURLY_LIMIT * 0.8);
  return Math.max(target, Math.ceil(fastest));
}
