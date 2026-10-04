import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { parseElevatorAdvisory, parseStatusTable } from './access.ts';

test("BART's elevator advisory lists each station's outage, by station code", () => {
  const advisory = {
    root: {
      bsa: [{ description: { '#cdata-section': 'There are 3 elevators out of service at this time: 24TH: Station; CIVC: Station; COLS:  - Terminal/Station' } }],
    },
  };
  deepStrictEqual(parseElevatorAdvisory(advisory), [
    { station: '24th', kind: 'elevator', location: 'Station', reason: null, returns: null },
    { station: 'civc', kind: 'elevator', location: 'Station', reason: null, returns: null },
    { station: 'cols', kind: 'elevator', location: 'Terminal/Station', reason: null, returns: null },
  ]);
  deepStrictEqual(parseElevatorAdvisory({ root: { bsa: [{ description: { '#cdata-section': 'There are no elevators out of service at this time.' } }] } }), []);
  // Answers of another shape say nothing either way.
  deepStrictEqual([parseElevatorAdvisory(null), parseElevatorAdvisory({ root: {} })], [null, null]);
});

test("bart.gov's status table gives each outage's place, reason, and return date", () => {
  // Trimmed from the escalator table as bart.gov served it.
  const table = {
    html: `<table class="alerts-table"><thead><th>Station</th><th>Location</th><th>Reason</th><th>Est. Return</th></thead><tbody>
      <tr>
        <td><a href="/stations/12TH/accessible">12th St. Oakland City Center</a></td>
        <td>Street - 14th St &amp; Broadway (Franklin St side) - Up Direction</td>
        <td>Repair</td>
        <td>10/07/2026</td>
      </tr>
      <tr class="outage">
        <td><a href="/stations/EMBR/accessible">Embarcadero</a></td>
        <td>Street - Beale &amp; Market St - Bi-Directional Direction</td>
        <td>Modernization</td>
        <td></td>
      </tr></tbody></table>`,
  };
  deepStrictEqual(parseStatusTable(table, 'escalator'), [
    { station: '12th', kind: 'escalator', location: 'Street - 14th St & Broadway (Franklin St side) - Up Direction', reason: 'Repair', returns: '10/07/2026' },
    { station: 'embr', kind: 'escalator', location: 'Street - Beale & Market St - Bi-Directional Direction', reason: 'Modernization', returns: null },
  ]);
  // An alert table with no rows is no outages. Anything else, as when bart.gov changes, is unknown.
  deepStrictEqual(parseStatusTable({ html: '<div class="alerts-container"><p>No current alerts</p></div>' }, 'elevator'), []);
  deepStrictEqual([parseStatusTable({}, 'elevator'), parseStatusTable({ html: 42 }, 'elevator'), parseStatusTable({ html: '<p>Page moved</p>' }, 'elevator')], [null, null, null]);
});
