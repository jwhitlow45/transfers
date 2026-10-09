import { deepStrictEqual } from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Agency } from '../config.ts';
import type { Schedule } from '../schedule.ts';
import { CALENDAR, buildSchedule, clock, files } from '../test-gtfs.ts';
import { wayBack } from './trip.ts';

// J's commute both ways: BART between Montgomery and 24th St Mission, a Yellow line route each
// way, and the 48 along 24th St, westbound on one side and eastbound across the street.
function feeds() {
  const trips = (rows: [route: string, id: string, headsign: string, direction: number][]) =>
    `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n${rows.map(([route, id, headsign, direction]) => `${route},all,${id},${headsign},${direction},,`).join('\n')}\n`;
  const times = (rows: [trip: string, at: number, stop: string][]) =>
    `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${rows.map(([trip, at, stop], index) => `${trip},${clock(at)},${clock(at)},${stop},${index + 1}`).join('\n')}\n`;
  const at = 8 * 3600;
  return new Map<Agency, Map<string, string>>([
    [
      'BA',
      files({
        'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nYellow-S,Yellow-S,Antioch to SFO,1\nYellow-N,Yellow-N,SFO to Antioch,1\n',
        'stops.txt': [
          'stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station',
          '901209,901209,Montgomery Street,37.789173,-122.401587,1,',
          '901201,901201,Montgomery Street,37.789213,-122.401642,0,901209',
          '901202,901202,Montgomery Street,37.789133,-122.401532,0,901209',
          '901609,901609,24th Street / Mission,37.752419,-122.418468,1,',
          '901601,901601,24th Street / Mission,37.752422,-122.418518,0,901609',
          '901602,901602,24th Street / Mission,37.752416,-122.418418,0,901609',
          '24TH_3,,SW Entrance,37.75194137,-122.4188268,2,901609',
        ].join('\n'),
        'calendar.txt': CALENDAR,
        'trips.txt': trips([['Yellow-S', 's1', 'SFO', 1], ['Yellow-N', 'n1', 'Antioch', 0]]),
        'stop_times.txt': times([['s1', at, '901201'], ['s1', at + 480, '901601'], ['n1', at, '901602'], ['n1', at + 480, '901202']]),
      }),
    ],
    [
      'SF',
      files({
        'routes.txt': 'route_id,route_short_name,route_long_name,route_type\n48,48,QUINTARA/24TH STREET,3\n',
        'stops.txt': [
          'stop_id,stop_code,stop_name,stop_lat,stop_lon',
          '13476,13476,24th St & Mission St,37.752250,-122.418600',
          '13477,13477,24th St & Mission St,37.752178,-122.418550',
          '13460,13460,24th St & Church St,37.751400,-122.427000',
          '13461,13461,24th St & Church St,37.751330,-122.426880',
        ].join('\n'),
        'calendar.txt': CALENDAR,
        'trips.txt': trips([['48', 'w1', 'Great Highway', 0], ['48', 'e1', '22nd St + Iowa St', 1]]),
        'stop_times.txt': times([['w1', at + 600, '13476'], ['w1', at + 900, '13460'], ['e1', at + 600, '13461'], ['e1', at + 900, '13477']]),
      }),
    ],
  ]);
}

let schedule: Schedule;
before(() => {
  schedule = buildSchedule(feeds());
});
after(() => schedule.close());

test('the way back starts across the street from the destination and heads for the station the train left the rider at', () => {
  deepStrictEqual(wayBack(schedule, { from: 'BA:901209', to: 'SF:13476', dest: 'SF:13460' }), {
    back: {
      from: 'SF:13461',
      fromLabel: '24th St & Church St (13461)',
      to: 'BA:901609',
      toLabel: '24th St Mission',
      dest: 'BA:901209',
      destLabel: 'Montgomery St',
    },
  });
});

test('a trip to a route finds the same way back, and one without a destination has none', () => {
  deepStrictEqual(wayBack(schedule, { from: 'BA:901209', to: 'route:SF:48', dest: 'SF:13460' }).back?.from, 'SF:13461');
  deepStrictEqual(wayBack(schedule, { from: 'BA:901209', to: 'SF:13476' }), { back: null });
});

test('the transfer point the page names by its station is the one the return trip uses, and route filters count', () => {
  const back = { from: 'SF:13461', fromLabel: '24th St & Church St (13461)', to: 'BA:901609', toLabel: '24th St Mission', dest: 'BA:901209', destLabel: 'Montgomery St' };
  // The page names BART stops by their station, where the link has platforms.
  deepStrictEqual(wayBack(schedule, { from: 'BA:901209', to: 'SF:13476', dest: 'SF:13460' }, { alight: 'BA:901609', board: 'SF:13476' }), { back });
  deepStrictEqual(wayBack(schedule, { from: 'BA:901209', to: 'SF:13476', dest: 'SF:13460', firstRoutes: ['BA:Yellow-S'], secondRoutes: ['SF:48'] }), { back });
  // Filters that leave no first leg, or no second, leave no return trip.
  deepStrictEqual(wayBack(schedule, { from: 'BA:901209', to: 'SF:13476', dest: 'SF:13460', firstRoutes: ['SF:48'] }), { back: null });
  deepStrictEqual(wayBack(schedule, { from: 'BA:901209', to: 'SF:13476', dest: 'SF:13460', secondRoutes: ['BA:Yellow-N'] }), { back: null });
});
