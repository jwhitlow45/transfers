import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { shortCornerNames } from './corner-names.ts';

// About 111 m of latitude.
const BLOCK = 0.001;

// Each name's short name, among the stops given, each a block north of the last unless placed.
const shorten = (...stops: (string | { name: string; lat: number })[]) => {
  const rows = stops.map((stop, id) => (typeof stop === 'string' ? { id, name: stop, lat: 37.75 + id * BLOCK, lon: -122.4 } : { id, ...stop, lon: -122.4 }));
  const names = shortCornerNames(rows);
  return rows.map(({ id }) => names.get(id) ?? null);
};

test('drops the street types riders leave off', () => {
  deepStrictEqual(shorten('26th St & De Haro St', 'Mission St & 24th St', 'Geary Blvd & Masonic Ave', 'Portola Dr & Burnett Ave', 'Woodside Rd & Bay Rd'), [
    '26th & De Haro',
    'Mission & 24th',
    'Geary & Masonic',
    'Portola & Burnett',
    'Woodside & Bay',
  ]);
});

test('drops spelled out types too', () => {
  deepStrictEqual(shorten('Park Presidio & California Street', 'Beach Park Blvd & Gull Ave.'), ['Park Presidio & California', 'Beach Park & Gull']);
});

test('keeps types that are part of the name or tell a small street from a big one', () => {
  deepStrictEqual(shorten('Great Hwy & Judah St', 'Lincoln Way & 19th Ave', 'Dolores Ter & 19th St', 'Buena Vista Ter & Buena Vista Ave E'), [
    'Great Hwy & Judah',
    'Lincoln Way & 19th',
    'Dolores Ter & 19th',
    null,
  ]);
});

test('keeps a lone letter or compass point whole', () => {
  deepStrictEqual(shorten('B St & 3rd Ave', 'N B St & 1st Ave', 'Alexander Ave & East Rd', 'West Portal Ave & 14th Ave'), ['B St & 3rd', 'N B St & 1st', 'Alexander & East Rd', 'West Portal & 14th']);
});

test('shortens streets that share a word with a landmark', () => {
  deepStrictEqual(shorten('Golden Gate Ave & Polk St', 'Mission St & School St', 'Bridgeway & Gate 5 Rd'), ['Golden Gate & Polk', 'Mission & School', 'Bridgeway & Gate 5']);
});

test('tidies the spaces in a name first', () => {
  deepStrictEqual(shorten('Addison  St & Digby St', 'Wisconsin St &  25th St', 'Potrero Ave&15th St'), ['Addison & Digby', 'Wisconsin & 25th', 'Potrero & 15th']);
});

test("keeps SamTrans's at", () => {
  deepStrictEqual(shorten('Broadway at Maple St'), ['Broadway at Maple']);
});

test('leaves stations, addresses, and corners with more said alone', () => {
  deepStrictEqual(shorten('Montgomery St', '341 Corbett Ave', 'Pacific Ave & Grant Ave/Chinatown', '1st Ave & Filbert St- Southbound', 'Ocean Ave & Geneva Ave / City College', 'Broadway & Charter', 'A St & B St & C St'), [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  deepStrictEqual(
    shorten(
      'Ave Alhambra & Coronado St-San Luis Ave',
      'Fremont St btwn Folsom St & Howard St',
      'Market St Between 4th & 3rd St',
      'Bay Rd & University Ave Farside',
      'Oceana Blvd & Pacific Manor School Rear Entrance',
      'Bellam Blvd & I-580',
    ),
    [null, null, null, null, null, null],
  );
});

test('leaves two different corners that would read alike as they are', () => {
  // SamTrans's two, 5 km apart on El Camino Real, either way round.
  deepStrictEqual(shorten({ name: 'El Camino Real & Oak Ave', lat: 37.5 }, { name: 'Oak St & El Camino Real', lat: 37.545 }), [null, null]);
  // One that already reads as the other would shortened.
  deepStrictEqual(shorten({ name: 'Main St & 1st Ave', lat: 37.5 }, { name: 'Main & 1st', lat: 37.6 }), [null, null]);
  // One named with at, the other with &.
  deepStrictEqual(shorten({ name: 'Broadway at Maple St', lat: 37.5 }, { name: 'Maple Ave & Broadway', lat: 37.6 }), [null, null]);
});

test('shortens one corner the agencies spelled two ways', () => {
  deepStrictEqual(shorten({ name: 'Frederick St & Masonic St', lat: 37.77 }, { name: 'Frederick St & Masonic Ave', lat: 37.7702 }), ['Frederick & Masonic', 'Frederick & Masonic']);
});

test('shortens a corner named the same in two towns, which its full name already shares', () => {
  const [first, second] = shorten({ name: 'Broadway & 1st St', lat: 37.5 }, { name: 'Broadway & 1st St', lat: 37.8 });
  strictEqual(first, 'Broadway & 1st');
  strictEqual(second, 'Broadway & 1st');
});
