import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { PlaceResult } from '../../shared/journeys.ts';
import { all, get, openDatabase } from '../db.ts';
import { distanceMeters, type Point } from '../geo.ts';
import { searchQuery, searchText } from '../gtfs/search-text.ts';
import type { Schedule } from '../schedule.ts';
import { nowSeconds, zonedParts } from '../time.ts';
import { buildPlaces } from './ingest.ts';

const MAX_AGE_SECONDS = 7 * 24 * 3600;
// A build that missed tiles, when every server was busy, tries again the next night.
const INCOMPLETE_AGE_SECONDS = 20 * 3600;
// After the schedule's 3 AM rebuild, when few riders are out.
const REBUILD_HOUR = 4;
// The best matches anywhere, and the best around the rider, which a place with a longer name by
// their door might not be among.
const CANDIDATES = 200;
const NEARBY_CANDIDATES = 100;
const NEARBY_DEGREES = 0.03;

type Candidate = PlaceResult & { fame: number; score: number };

// Places by name, from their own database, apart from the schedule's.
export class Places {
  readonly builtAt: number;
  // Tiles the build had no answer for.
  readonly missing: number;
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = openDatabase(path, { readOnly: true });
    const meta = (key: string) => Number(get<{ value: string }>(this.db, 'SELECT value FROM meta WHERE key = ?', key)?.value ?? 0);
    this.builtAt = meta('built_at');
    this.missing = meta('missing');
  }

  close() {
    this.db.close();
  }

  // Places with every word typed in their names, or in what kind of place they are, the last word
  // as the start of one, as stops are matched (see searchQuery). The better match comes first,
  // and among matches about as good, the better known and then the nearer to `near`: a rider who
  // types "philz" means the Philz down the street.
  search(text: string, near: Point | undefined, limit: number): PlaceResult[] {
    const match = searchQuery(text);
    if (!match) return [];
    const select = `SELECT p.id, p.name, p.kind, p.street, p.lat, p.lon, p.fame, bm25(place_search, 10, 5, 2) AS score
      FROM place_search JOIN places p ON p.row = place_search.rowid WHERE place_search MATCH ?`;
    const found = all<Candidate>(this.db, `${select} ORDER BY score LIMIT ?`, match, CANDIDATES);
    if (near) {
      const [lat, lon] = [near.lat, near.lon];
      found.push(...all<Candidate>(this.db, `${select} AND p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ? ORDER BY score LIMIT ?`, match, lat - NEARBY_DEGREES, lat + NEARBY_DEGREES, lon - NEARBY_DEGREES, lon + NEARBY_DEGREES, NEARBY_CANDIDATES));
    }
    const typed = searchText(text);
    // bm25 is lower for better matches. Being a landmark counts for more than a name that starts
    // with what was typed, so "dolores park" finds the park before the chiropractor named for it,
    // and 15 km away counts about as much as being a landmark.
    const order = (place: Candidate) => place.score - place.fame - (searchText(place.name).startsWith(typed) ? 1.5 : 0) + (near ? Math.min(3, distanceMeters(near, place) / 5000) : 0);
    const unique = [...new Map(found.map((place) => [place.id, place])).values()];
    return unique
      .map((place) => ({ place, order: order(place) }))
      .sort((a, b) => a.order - b.order)
      .slice(0, limit)
      .map(({ place: { id, name, kind, street, lat, lon } }) => ({ id, name, kind, street, lat, lon }));
  }

  get(id: string): PlaceResult | null {
    return get<PlaceResult>(this.db, 'SELECT id, name, kind, street, lat, lon FROM places WHERE id = ?', id) ?? null;
  }
}

// Holds the current places and rebuilds them about weekly, swapping the new database in whole.
// Search simply finds no places until the first build finishes.
export class PlaceStore {
  private current: Places | null = null;
  private building: Promise<void> | null = null;
  private readonly path: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.path = join(dataDir, 'places.db');
  }

  get places() {
    return this.current;
  }

  start(schedule: () => Schedule | null) {
    if (existsSync(this.path)) {
      try {
        this.current = new Places(this.path);
      } catch (error) {
        console.error('Could not open the places database, rebuilding:', error);
      }
    }
    const due = (places: Places) => nowSeconds() - places.builtAt > (places.missing > 0 ? INCOMPLETE_AGE_SECONDS : MAX_AGE_SECONDS);
    // Not at once: a server restarted again and again, as in development, never asks Overpass.
    const timer = setInterval(() => {
      const current = schedule();
      if (!current || this.building) return;
      if (!this.current || (due(this.current) && zonedParts(nowSeconds()).hour === REBUILD_HOUR)) {
        this.building = this.build(current).finally(() => (this.building = null));
      }
    }, 10 * 60 * 1000);
    timer.unref();
  }

  private async build(schedule: Schedule) {
    const started = performance.now();
    try {
      const stops = [...schedule.patternsByStop.keys()].map((id) => schedule.stop(id));
      const { count, missing } = await buildPlaces(stops, this.path);
      const previous = this.current;
      this.current = new Places(this.path);
      // The old file is already unlinked, and closing it frees the space.
      previous?.close();
      console.log(`Places rebuilt in ${((performance.now() - started) / 1000).toFixed(0)} s: ${count} places${missing.length ? `, ${missing.length} tiles missing` : ''}`);
    } catch (error) {
      console.error('Places rebuild failed, keeping the previous ones:', error);
    }
  }
}
