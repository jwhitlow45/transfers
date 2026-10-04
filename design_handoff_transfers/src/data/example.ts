// Example data from the terminal version this app replaces, extended to cover every state.
// Times are minutes since midnight, Pacific. The prototype clock starts at 4:34:15 PM.
import type { Stop, RouteResult, Trip, TripSettings, SavedSearch, RecentSearch } from '../types';

export const DEMO_NOW_SEC = 59655;

export const TRIPS: Record<string, Trip> = {
  "work": {
    "id": "work",
    "name": "Work to home",
    "fromShort": "Montgomery",
    "via": "24th St Mission",
    "toLabel": "48",
    "alightStop": "24th St Mission",
    "firstWord": "train",
    "firsts": [
      {
        "id": "t1",
        "agency": "BART",
        "line": "Yellow",
        "color": "#f2c500",
        "headsign": "SFO",
        "scheduled": 998,
        "delay": 1,
        "rideMinutes": 8
      },
      {
        "id": "t2",
        "agency": "BART",
        "line": "Green",
        "color": "#4db848",
        "headsign": "Daly City",
        "scheduled": 1004,
        "delay": 0,
        "rideMinutes": 8
      },
      {
        "id": "t3",
        "agency": "BART",
        "line": "Red",
        "color": "#e2231a",
        "headsign": "Millbrae",
        "scheduled": 1007,
        "delay": 0,
        "rideMinutes": 8
      },
      {
        "id": "t4",
        "agency": "BART",
        "line": "Blue",
        "color": "#0099d8",
        "headsign": "Daly City",
        "scheduled": 1010,
        "delay": 0,
        "rideMinutes": 8
      },
      {
        "id": "t5",
        "agency": "BART",
        "line": "Yellow",
        "color": "#f2c500",
        "headsign": "SFO",
        "scheduled": 1022,
        "delay": 0,
        "rideMinutes": 8
      },
      {
        "id": "t6",
        "agency": "BART",
        "line": "Green",
        "color": "#4db848",
        "headsign": "Daly City",
        "scheduled": 1025,
        "delay": 0,
        "rideMinutes": 8
      }
    ],
    "points": [
      {
        "id": "g48",
        "route": {
          "label": "48",
          "agency": "Muni",
          "color": "#4c55a8"
        },
        "stop": "24th St & Mission St",
        "code": "13477",
        "toward": "Eastbound, toward 22nd St & Iowa St",
        "destRideMinutes": 12,
        "departures": [
          {
            "scheduled": 1003,
            "delay": 7
          },
          {
            "scheduled": 1027,
            "delay": 0
          },
          {
            "scheduled": 1042,
            "delay": -2
          },
          {
            "scheduled": 1057,
            "delay": 0
          }
        ]
      }
    ],
    "alerts": [
      {
        "id": "a1",
        "severity": "severe",
        "kicker": "Your boarding stop",
        "title": "48 STOP TEMP. MOVED, board at 24th & Capp",
        "body": "Stop 13477 at 24th St & Mission St is closed for sidewalk work. Board eastbound 48 buses at the temporary pole on 24th St at Capp St, half a block east.",
        "meta": "Muni · Until Oct 18"
      },
      {
        "id": "a2",
        "severity": "warning",
        "kicker": "Station access · 24th St Mission",
        "title": "Elevator out of service at 24th St Mission",
        "body": "The street elevator on the northeast plaza is out of service. Use the southwest plaza elevator at 24th St & Mission St.",
        "meta": "BART · Posted 3:52 PM"
      },
      {
        "id": "a3",
        "severity": "warning",
        "kicker": "Reroute · 48",
        "title": "48 detour on 24th St east of Potrero Ave",
        "body": "Eastbound buses run via 23rd St between Potrero Ave and Utah St for a street fair. Your transfer stop is not affected.",
        "meta": "Muni · 10 AM to 7 PM today"
      },
      {
        "id": "a4",
        "severity": "info",
        "kicker": "Notice · Montgomery St",
        "title": "Market St entrance escalator work tonight",
        "body": "The escalator at the Market St & New Montgomery entrance will be off from 9 PM to 5 AM. Stairs stay open.",
        "meta": "BART · Tonight"
      }
    ],
    "destinations": [
      {
        "value": "none",
        "label": "None"
      },
      {
        "value": "home",
        "label": "Home · 24th St & Potrero Ave (13510)",
        "short": "Home"
      }
    ]
  },
  "route": {
    "id": "route",
    "name": "Climbing gym",
    "fromShort": "26th & De Haro",
    "via": "Rhode Island & 16th",
    "toLabel": "22",
    "alightStop": "Rhode Island & 16th",
    "firstWord": "19",
    "firsts": [
      {
        "id": "n1",
        "agency": "Muni",
        "line": "19 Polk",
        "color": "#2e8350",
        "headsign": "Fisherman’s Wharf",
        "scheduled": 997,
        "delay": 2,
        "rideMinutes": 7
      },
      {
        "id": "n2",
        "agency": "Muni",
        "line": "19 Polk",
        "color": "#2e8350",
        "headsign": "Fisherman’s Wharf",
        "scheduled": 1012,
        "delay": 0,
        "rideMinutes": 7
      },
      {
        "id": "n3",
        "agency": "Muni",
        "line": "19 Polk",
        "color": "#2e8350",
        "headsign": "Fisherman’s Wharf",
        "scheduled": 1027,
        "delay": null,
        "rideMinutes": 7
      }
    ],
    "points": [
      {
        "id": "gf",
        "kicker": "Transfer point 1 of 2",
        "route": {
          "label": "22",
          "agency": "Muni",
          "color": "#9a3b6d"
        },
        "stop": "16th St & Rhode Island St",
        "code": "13322",
        "toward": "Westbound, toward Fillmore",
        "destRideMinutes": 0,
        "departures": [
          {
            "scheduled": 1010,
            "delay": 0
          },
          {
            "scheduled": 1022,
            "delay": 1
          },
          {
            "scheduled": 1032,
            "delay": 0
          },
          {
            "scheduled": 1042,
            "delay": 0
          }
        ]
      },
      {
        "id": "gm",
        "kicker": "Transfer point 2 of 2",
        "route": {
          "label": "22",
          "agency": "Muni",
          "color": "#9a3b6d"
        },
        "stop": "16th St & Rhode Island St",
        "code": "13323",
        "toward": "Eastbound, toward UCSF Mission Bay",
        "destRideMinutes": 0,
        "departures": [
          {
            "scheduled": 1011,
            "canceled": true
          },
          {
            "scheduled": 1015,
            "delay": -1
          },
          {
            "scheduled": 1028,
            "delay": 3
          },
          {
            "scheduled": 1040,
            "delay": 0
          }
        ]
      }
    ],
    "alerts": [
      {
        "id": "r1",
        "severity": "warning",
        "kicker": "Reroute · 22",
        "title": "22 reroute: detour via 17th St",
        "body": "Buses toward Fillmore detour via 17th St between Kansas St and De Haro St. Your transfer stop at 16th St & Rhode Island St is still served.",
        "meta": "Muni · Until 8 PM"
      }
    ],
    "destinations": [
      {
        "value": "none",
        "label": "None"
      }
    ]
  },
  "samtrans": {
    "id": "samtrans",
    "name": "Montgomery St → SamTrans 120",
    "fromShort": "Montgomery",
    "via": "Daly City",
    "toLabel": "SamTrans 120",
    "alightStop": "Daly City",
    "firstWord": "train",
    "firsts": [
      {
        "id": "s1",
        "agency": "BART",
        "line": "Green",
        "color": "#4db848",
        "headsign": "Daly City",
        "scheduled": 1001,
        "delay": 0,
        "rideMinutes": 16
      },
      {
        "id": "s2",
        "agency": "BART",
        "line": "Blue",
        "color": "#0099d8",
        "headsign": "Daly City",
        "scheduled": 1007,
        "delay": 0,
        "rideMinutes": 16
      },
      {
        "id": "s3",
        "agency": "BART",
        "line": "Green",
        "color": "#4db848",
        "headsign": "Daly City",
        "scheduled": 1034,
        "delay": 0,
        "rideMinutes": 16
      },
      {
        "id": "s4",
        "agency": "BART",
        "line": "Green",
        "color": "#4db848",
        "headsign": "Daly City",
        "scheduled": 1061,
        "delay": 0,
        "rideMinutes": 16
      },
      {
        "id": "s5",
        "agency": "BART",
        "line": "Blue",
        "color": "#0099d8",
        "headsign": "Daly City",
        "scheduled": 1064,
        "delay": 0,
        "rideMinutes": 16
      }
    ],
    "points": [
      {
        "id": "g120",
        "route": {
          "label": "120",
          "agency": "SamTrans",
          "color": "#4c55a8"
        },
        "stop": "Daly City BART, Bay 3",
        "code": "356005",
        "toward": "Southbound, toward Colma BART",
        "destRideMinutes": 0,
        "departures": [
          {
            "scheduled": 1025,
            "delay": 1
          },
          {
            "scheduled": 1055,
            "scheduledOnly": true
          },
          {
            "scheduled": 1085,
            "scheduledOnly": true
          }
        ]
      }
    ],
    "alerts": [
      {
        "id": "x1",
        "severity": "info",
        "kicker": "Notice · Daly City BART",
        "title": "Bay 3 shelter work through Oct 10",
        "body": "The shelter at Bay 3 is being replaced. Buses still stop at Bay 3; wait at the marked temporary pole.",
        "meta": "SamTrans · Through Oct 10"
      }
    ],
    "destinations": [
      {
        "value": "none",
        "label": "None"
      }
    ]
  }
};

/** Alerts a3/a4 on "work" appear only in the "all alert types" state. */
export const DEFAULT_ALERTS: Record<string, string[]> = { work: ['a1', 'a2'], route: ['r1'], samtrans: ['x1'] };

export const STOPS: Stop[] = [
  {
    "id": "mont-s",
    "name": "Montgomery St",
    "agency": "BART",
    "direction": "Platform 2, toward Daly City, SFO, Millbrae",
    "routes": [
      {
        "label": "SFO",
        "agency": "BART",
        "color": "#f2c500"
      },
      {
        "label": "Millbrae",
        "agency": "BART",
        "color": "#e2231a"
      },
      {
        "label": "Daly City",
        "agency": "BART",
        "color": "#4db848"
      },
      {
        "label": "Daly City",
        "agency": "BART",
        "color": "#0099d8"
      }
    ]
  },
  {
    "id": "mont-n",
    "name": "Montgomery St",
    "agency": "BART",
    "direction": "Platform 1, toward Antioch, Richmond, Berryessa, Dublin",
    "routes": [
      {
        "label": "Antioch",
        "agency": "BART",
        "color": "#f2c500"
      },
      {
        "label": "Richmond",
        "agency": "BART",
        "color": "#e2231a"
      },
      {
        "label": "Berryessa",
        "agency": "BART",
        "color": "#4db848"
      },
      {
        "label": "Dublin",
        "agency": "BART",
        "color": "#0099d8"
      }
    ]
  },
  {
    "id": "mont-m",
    "name": "Montgomery St",
    "agency": "Muni Metro",
    "code": "16994",
    "direction": "Outbound, toward West Portal",
    "routes": [
      {
        "label": "J",
        "agency": "Muni Metro",
        "color": "#faa634"
      },
      {
        "label": "K",
        "agency": "Muni Metro",
        "color": "#569bbe"
      },
      {
        "label": "L",
        "agency": "Muni Metro",
        "color": "#92278f"
      },
      {
        "label": "M",
        "agency": "Muni Metro",
        "color": "#008752"
      },
      {
        "label": "N",
        "agency": "Muni Metro",
        "color": "#00539b"
      }
    ]
  },
  {
    "id": "13477",
    "name": "24th St & Mission St",
    "agency": "Muni",
    "code": "13477",
    "direction": "Eastbound, toward 22nd St & Iowa St",
    "routes": [
      {
        "label": "48",
        "agency": "Muni",
        "color": "#00858a"
      }
    ]
  },
  {
    "id": "13476",
    "name": "24th St & Mission St",
    "agency": "Muni",
    "code": "13476",
    "direction": "Westbound, toward 48th Ave & Quintara St",
    "routes": [
      {
        "label": "48",
        "agency": "Muni",
        "color": "#00858a"
      },
      {
        "label": "67",
        "agency": "Muni",
        "color": "#2e8350"
      }
    ]
  },
  {
    "id": "15553",
    "name": "Mission St & 24th St",
    "agency": "Muni",
    "code": "15553",
    "direction": "Northbound, toward Downtown",
    "routes": [
      {
        "label": "14",
        "agency": "Muni",
        "color": "#9a3b6d"
      },
      {
        "label": "14R",
        "agency": "Muni",
        "color": "#c4122f"
      },
      {
        "label": "49",
        "agency": "Muni",
        "color": "#2b6fa8"
      }
    ]
  },
  {
    "id": "15552",
    "name": "Mission St & 24th St",
    "agency": "Muni",
    "code": "15552",
    "direction": "Southbound, toward Daly City",
    "routes": [
      {
        "label": "14",
        "agency": "Muni",
        "color": "#9a3b6d"
      },
      {
        "label": "14R",
        "agency": "Muni",
        "color": "#c4122f"
      },
      {
        "label": "49",
        "agency": "Muni",
        "color": "#2b6fa8"
      }
    ]
  },
  {
    "id": "2416",
    "name": "24th St Mission",
    "agency": "BART",
    "direction": "Platform 2, toward Daly City, SFO, Millbrae",
    "routes": [
      {
        "label": "SFO",
        "agency": "BART",
        "color": "#f2c500"
      },
      {
        "label": "Millbrae",
        "agency": "BART",
        "color": "#e2231a"
      },
      {
        "label": "Daly City",
        "agency": "BART",
        "color": "#4db848"
      },
      {
        "label": "Daly City",
        "agency": "BART",
        "color": "#0099d8"
      }
    ]
  },
  {
    "id": "13516",
    "name": "26th St & De Haro St",
    "agency": "Muni",
    "code": "13516",
    "direction": "Northbound, toward Fisherman’s Wharf",
    "routes": [
      {
        "label": "19",
        "agency": "Muni",
        "color": "#2e8350"
      }
    ]
  }
];

export const ROUTES: (RouteResult & { tripId: string })[] = [
  {
    "id": "r22",
    "name": "22 Fillmore",
    "agency": "Muni",
    "description": "Route · Fillmore ↔ UCSF Mission Bay",
    "route": {
      "label": "22",
      "agency": "Muni",
      "color": "#9a3b6d"
    },
    "tripId": "route"
  },
  {
    "id": "r48",
    "name": "48 Quintara/24th St",
    "agency": "Muni",
    "description": "Route · West Portal ↔ 22nd St & Iowa St",
    "route": {
      "label": "48",
      "agency": "Muni",
      "color": "#00858a"
    },
    "tripId": "work"
  },
  {
    "id": "r19",
    "name": "19 Polk",
    "agency": "Muni",
    "description": "Route · Hunters Point ↔ Fisherman’s Wharf",
    "route": {
      "label": "19",
      "agency": "Muni",
      "color": "#2e8350"
    },
    "tripId": "route"
  },
  {
    "id": "r120",
    "name": "120",
    "agency": "SamTrans",
    "description": "Route · Daly City BART ↔ Colma BART",
    "route": {
      "label": "120",
      "agency": "SamTrans",
      "color": "#00858a"
    },
    "tripId": "samtrans"
  },
  {
    "id": "r101",
    "name": "101",
    "agency": "Golden Gate Transit",
    "description": "Route · San Francisco ↔ Santa Rosa",
    "route": {
      "label": "101",
      "agency": "Golden Gate Transit",
      "color": "#b8602a"
    },
    "tripId": "work"
  }
];

const base: TripSettings = { minTransfer: 3, maxTransfer: 12, hideUnder: 2, destination: 'none', disabledLines: {}, disabledPoints: {} };
export const SAVED: SavedSearch[] = [
  { id: 'v1', name: 'Work to home', tripId: 'work', settings: { ...base, destination: 'home' } },
  { id: 'v2', name: 'Climbing gym', tripId: 'route', settings: { ...base, hideUnder: 0 } }
];
export const RECENT: RecentSearch[] = [
  { id: 'c1', label: 'Montgomery St → SamTrans 120', sub: 'via Daly City · Yesterday', tripId: 'samtrans' },
  { id: 'c2', label: '26th St & De Haro St → 22', sub: '2 transfer points · Monday', tripId: 'route' }
];
export const DEFAULT_SETTINGS: Record<string, TripSettings> = { work: SAVED[0].settings, route: SAVED[1].settings, samtrans: base };
