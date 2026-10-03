# Transfer rules

Status: proposed. Open choices are marked "Open".

## Inputs

A search names a **From** stop, where the rider boards the first vehicle, and a **To**, which is either the stop where they board the second vehicle or a route they want to reach.

- **To is a stop.** Candidate transfer points are the stops after From on each first-leg trip that lie within 400 m (straight line) of the To stop. When several qualify, the one with the shortest estimated transfer is used. Example: Montgomery St BART to Muni 13477 gets off at 24th St Mission.
- **To is a route.** Candidate transfer points are pairs of a stop after From on a first-leg trip and a stop on the target route within 400 m of it. Each pair, per direction of the target route, becomes its own group. Example: 26th St & De Haro (13516) to the 22 rides the 19 inbound to Rhode Island St & 16th St (16189), then boards the 22 at 17770 (toward Fillmore, 39 m away) or 17761 (toward UCSF Mission Bay, 53 m away). The 48 also serves 13516 but never comes within 400 m of the 22, so it drops out.

## Minimum transfer time

The default minimum is the physical time to get from the first vehicle to the second stop, rounded up to whole minutes, with no added safety buffer.

```
estimate = exit(alighting stop) + walk + crossing + entry(boarding stop)
minimum  = max(1, ceil(estimate / 60))
```

| Part | Default | Notes |
|---|---|---|
| exit, rail platform to street | 105 s | Walk along the platform (about 35 s), escalators or stairs (about 60 s), fare gates (about 10 s). |
| exit, bus | 10 s | Stepping off. |
| entry, street to rail platform | 120 s | Fare gates, down to the platform, find the right side. |
| entry, bus | 0 s | |
| walk | straight line × 1.3, at 1.4 m/s | Measured from the station entrance nearest the stop (BART's GTFS lists every entrance). 1.3 approximates the street grid. 1.4 m/s is a brisk commuter pace (OpenTripPlanner's default is 1.35). |
| crossing | 30 s when the stops are more than 30 m apart | Allowance for a signal. No street data, so distance stands in for "different corner". |

Checks against transfers J has made:

| Transfer | Estimate | Minimum | J's experience |
|---|---|---|---|
| 24th St Mission (SW plaza) to 13477, 36 m | 168 s | 3 | 3 works |
| Civic Center (8th St entrance) to 13209, 37 m | 169 s | 3 | 3 works |
| 16189 Rhode Island & 16th to 17770, 39 m | 76 s | 2 | |

Overrides, in priority order: the rider's own value for the search, a table of calibrated pairs kept in the repo, and the agency's `transfers.txt` `min_transfer_time` (BART uses it for timed cross-platform transfers).

### Why no buffer, unlike Google Maps

Google Maps does not document its transfer padding, but planners that work from schedules hours ahead have to pad for lateness they cannot see. This app compares live predictions on both legs, shows each vehicle's lateness, and compares whole minutes rounded down: a transfer shown as 3 minutes is at least 3:00 in the feed, so the rounding is already a buffer of 0 to 59 seconds. A transfer exactly at the minimum is marked tight.

## Maximum transfer time

Default: minimum + 9 minutes (3 to 12 for J's transfers). Each first vehicle pairs with the first second-leg departure it can make, so the maximum only drops first vehicles that would leave the rider waiting longer than that. A later first vehicle usually makes the same departure with less waiting.

Open: second routes that run every 20 to 60 minutes (SamTrans, Golden Gate). With a 9 minute window, many first vehicles show no connection at all. Proposal: when the second route's scheduled headway at that hour is longer than 9 minutes, widen the default maximum to minimum + headway, so every first vehicle shows the departure it would catch.

## Carried over from the terminal version

- Every minute comparison uses whole minutes rounded down, the same number the rider sees.
- Each first vehicle pairs with the first second-leg departure it can make.
- Show the next 3 departures per second route (or per transfer point) that have at least one qualifying first vehicle. Drop disqualified pairings before choosing those 3.
- Under each departure, list every first vehicle that makes it, in order.
- Hide first vehicles leaving From sooner than a rider-set number of minutes (the terminal version used 3).
- Lateness is the feed's arrival delay at that stop, rounded to the nearest minute: "N min late", "N min early", or "delay unknown". Shown for every vehicle on both legs.
- An optional destination stop shows when the second vehicle reaches it, only when that comes after the boarding stop.
- Times display in America/Los_Angeles.

## Service changes

Checked live on 2026-10-03: Muni alerts name the affected route and stop pairs, but the replacement stop is free text ("Board at Folsom/Mabini"), and predictions keep running at stops the alerts call closed or rerouted (all 61 stops on an active 45 reroute still had predictions, and no stop was marked skipped). So the app cannot move a search to a temporary stop on its own. It shows every alert that names a route and stop in the search, ranked first when it names a stop the rider boards at or gets off at.
