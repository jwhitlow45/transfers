Design a mobile-first web app called Transfers. It shows SF Bay Area transit riders which vehicle to catch so they make a specific transfer, using live predictions. Riders use it while walking to a station, standing on a platform, or sitting on a train, often underground with one bar of signal. It has to be fast, readable at a glance, and usable with one hand.

## What it answers

"If I take the next train from Montgomery BART, which 48 bus at 24th St & Mission will I make, how long is the transfer, and is the bus running late?"

The rider picks two things:
- **From**: the stop or station where they board the first vehicle (example: Montgomery St BART).
- **To**: either the stop where they board the second vehicle (example: Muni stop 13477, 24th St & Mission St), or a route they want to transfer to (example: "the 22"). When it is a route, the app finds where the two routes meet and may show more than one transfer point.

The app works out where to get off the first vehicle (24th St Mission BART in the example) and lists the next 3 departures of the second route that have at least one connecting first vehicle. Under each one, it lists every first vehicle that makes that connection.

Agencies: Muni (bus, Muni Metro light rail, cable car), BART, SamTrans, and Golden Gate Transit. Do not use agency logos or the BART system map. Agency names in text and route colors are fine.

## Screens

1. **Search (home)**
   - Two fields, From and To, plus a swap button.
   - Each field searches by stop name or stop code (the number on the pole, such as 13477). Results must tell apart stops with the same name, so each result shows the stop name, the stop code, the agency, the direction (such as "Eastbound, toward 22nd St & Iowa St"), and chips for the routes that stop there. The To field also offers routes as results (such as "22 Fillmore, Muni").
   - Below the fields: saved searches and recent searches, each one tap away. Saved searches are the main way people use the app day to day, so make them prominent. A saved search can be renamed (such as "Work to home").

2. **Results**
   - Header: the trip as a short chain, for example "Montgomery → 24th St Mission → 48". The second step comes from the app, not the rider, so style it as worked out for them.
   - Live status: "Updated 12 s ago", refreshing every 30 seconds. When the connection drops, keep showing the last results with a clear "Offline, updated 3 min ago" state. Countdowns keep ticking on the device.
   - Transfer window control: minimum and maximum transfer minutes (defaults such as 3 to 12) adjustable in place with steppers or a compact sheet. Show the current window in the header.
   - Service alerts that touch any stop or route in the trip, such as "48 STOP TEMP. MOVED, board at 24th & Capp" or "Elevator out of service at 24th St Mission". Show them inline, collapsible, and visually distinct by severity. An alert on the exact stop the rider is boarding matters most.
   - One group per connecting route (or per transfer point when the To is a route). Each group holds up to 3 cards, one per departure of the second route.
   - **Each card (one second-route departure)** shows: route name, its arrival time at the transfer stop, minutes until it arrives, and whether it is late, early, on time, or has no delay data. Optionally, the time it reaches the rider's destination stop.
   - **Under each card, every first vehicle that makes it**, in order: the first route name, its departure time from the From stop, minutes until it leaves, its own lateness, its arrival time where the rider gets off, and the transfer length in minutes. Mark transfers within a minute of the minimum as tight.
   - Show timing and delay for every arrival, on both legs. Never hide lateness or the countdown to save space.

3. **Trip settings** (sheet or panel from the results screen): minimum and maximum transfer minutes, "hide departures leaving in less than N minutes" (time to reach the From stop), an optional destination stop on the second route, and filters for which routes count on each leg. Settings are saved with the search.

## Example data (from the terminal version this replaces)

```
Montgomery → 24th St Mission → 48
  BART  4:38 PM (4 min)  → 48  4:50 PM (3 min transfer,  7 min late)    → Home  5:02 PM

  BART  4:47 PM (12 min) → 48  5:07 PM (12 min transfer, 0 min late)    → Home  5:19 PM
  BART  4:50 PM (15 min) → 48  5:07 PM (9 min transfer,  0 min late)    → Home  5:19 PM

Montgomery → Civic Center → 19
  BART  4:41 PM (7 min)  → 19  4:49 PM (5 min transfer,  2 min early)   → Home  5:05 PM
```

Each blank line starts a new bus. In the second bus, two trains both make the 5:07 PM 48. A route example: From 26th St & De Haro St (13516), To the 22: ride the 19 inbound to Rhode Island St & 16th St, then catch the 22 at 16th St & Rhode Island St, toward Fillmore or toward UCSF Mission Bay.

## States to design

- Loading on first visit (no cached data) and on return (cached results shown at once, refreshing in the background).
- Offline or stale data.
- No connection in the window, with a one-tap way to widen it.
- A departure that has only a scheduled time, past how far live predictions reach (SamTrans and Golden Gate run every 30 to 60 minutes, so this is common). It must look clearly different from a live prediction.
- A canceled trip.
- Alerts: stop moved or closed, reroute, elevator out of service, general notice.
- A feed outage for one agency while others work.

## Constraints

- Phone first, about 360 to 430 px wide, with a layout that also works on a desktop browser. No horizontal scrolling.
- Light and dark themes, following the system setting.
- Very light pages. Use the system font stack (no web fonts), tabular numerals for all times, inline SVG for the few icons needed, no images, no icon fonts, no component libraries, no animation libraries. Motion only where it carries meaning, such as a countdown tick or a refresh.
- Large tap targets and high contrast for reading on a moving train or in bright sun. Meet WCAG AA.
- Times are in Pacific time, formatted like "4:38 PM".
- Data credit is required next to the results: "Data provided by 511.org" linking to https://511.org, plus a credit to BART. Keep it quiet but visible.

## Handoff

Deliver React (TSX) function components with plain CSS that uses custom properties for design tokens (color, spacing, type scale, radius), one stylesheet or CSS modules. No Tailwind and no CSS-in-JS runtime. Include the tokens for both themes, the component list with the props each component takes, and every state above. Use the example data for realistic content.
