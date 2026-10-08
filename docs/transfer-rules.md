# Transfer rules

Status: the inputs, the window rules, and the terminal version's rules are agreed with J (2026-10-03). The thresholds under "Choosing the transfer point" are implementation choices, marked Open until J settles them.

## Inputs

A search names a **From** stop, where the rider boards the first vehicle, and a **To**, which is either the stop where they board the second vehicle or a route they want to reach.

- **To is a stop.** The targets are the routes and directions boarding there, or one per platform at a rail station. Example: Montgomery St BART to Muni 13477 gets off at 24th St Mission.
- **To is a route.** The targets are its directions. Asking for one BART line asks for both of its routes. Example: 26th St & De Haro (13516) to the 22 rides the 19 inbound to 16th St, then boards the 22 toward UCSF Mission Bay or toward Bay Street. The 48 also serves 13516 but never comes near the 22, so it drops out.

Each target gets one group, worked out as below.

### Longest transfer walk

Straight-line limits, checked on 2026-10-03 against 511's BART station maps and every crossing of two Muni lines:

| Pair | Default | Walk | Why |
|---|---|---|---|
| Street stop to street stop | 300 m | about 4.6 min | Catches every Muni crossing where both routes stop (the longest is 208 m, the 45 to the T at 4th & King) and 97.8% of route pairs that meet. 400 m adds about 1 point of coverage and 50% more nearby routes per stop, mostly parallel streets. |
| Either end a BART station or Muni Metro platform | 450 m (1.5 times the street limit) | about 7.0 min | Measured from the nearest BART entrance. Catches 98.7% of the connections BART's station maps list. The one miss is Civic Center to the 49 and 90 at Van Ness (about 510 m). |
| To is a named stop | 800 m | about 12 min | The rider picked the walk, so the limit only stops absurd pairings. |

Riders set the street limit in device settings, and the station limit scales with it. The analysis scripts are not in the repo; the numbers above are the record.

### Choosing the transfer point

Reworked on 2026-10-03 after six reviewers walked through live trips and found pages full of points no one would use. Open: every threshold in this section (3 hours, 60 seconds, 2 minutes, 150 m, half the walk) is an implementation choice J has not settled.

1. **Only what runs.** Patterns count only if a trip starts within three hours either side of now. Owl and bus-substitute patterns otherwise crowd the day, and the reverse at night. A target with nothing running gets "isn't running now, runs again Mon 7:15 AM".
2. **Walk before riding.** If the target route stops within the usual walking range of From (or, for a named stop, anywhere on its way there), the group is a walk: "No transfer needed: the 48 stops here", or "walk 2 min to Van Ness & Sutter", with its departures. No ride is offered for that target. Of the stops in range, the nearest wins unless it has under three quarters of the busiest one's trips (J's choice), so a quiet branch at the nearest pole loses to the main service a block over, but a busier stop does not pull the rider off a stop nearly every vehicle makes. With a destination, only stops before it count. Riding straight to a named stop pools every route that does it into one group, showing when each reaches the stop. Walk groups honor "hide departures under N" but not the transfer window, which measures time between two vehicles.
   - **Straight there, across the street too** (J, 2026-10-07). When To is a stop, one of its own routes that carries the rider from From (or a stop within walking range) to To, or to a street stop within 50 m of it such as the stop across the street, is a walk group too, headed "The 48 goes straight to 26th St & De Haro St", with each departure's arrival there. It does not say no transfer is needed, since the rider may be going to To to catch something there (J, 2026-10-08). A ride that ends where its route ends counts as well. Transfers to the routes at To stay beside it, since a rider may name To to catch one of them (J: from 24th St & Mission to 26th St & De Haro, someone may ride the 48 to catch the 19). Example: 13477 to 13516, which the eastbound 48 serves across the street at 13517, shows the 48 and the transfer to the northbound 19. Another route passing To's corner does not count, so Montgomery St BART to the 48 at 13477 does not offer the 14, which stops on that corner. These rides are added after long walks are weighed, so they never crowd out a transfer, and are left out when To is itself within walking range of From.
3. **First meeting place.** Along each first-leg pattern, the first run of stops within walking range of the target gives the point. Within that run, the earliest stop whose transfer is within a minute of the quickest, so the rider is not sent further for a slightly shorter walk. A stop only counts if it is closer to the target than From.
4. **No pointless boarding.** A board stop is dropped when the target ends within walking range of where the rider got off, when the target later passes within 150 m of From or of any stop the rider rode through (they could have boarded there), or when it comes back within half the walk distance of the alight stop. A walk group skips a stop where the vehicle would then pass closer to From before the rider gets off, and drops the direction entirely, offering no ride either, when it ends within walking range of From.
5. **One point per direction.** Of the first-leg patterns' points, the board stop most first-leg trips can use wins, and every pattern that can reach it pools in, wherever each lets the rider off. A row names its own stop when it differs from the group's. Only at a shared station do BART and Muni Metro each pick their own (J's choice, 2026-10-03), pooling when they pick the same stop. A pick needing more than two minutes over the quickest is left out rather than widening everyone's window. With a destination set, only routes that go on to it are considered when choosing.
6. **Stations.** Getting off on any platform of one station is getting off at the station. When To is a rail station, departures group by platform, with every line in one group, since a rider transferring to BART cares which way the train goes.

Directions read as riders say them: BART uses each line's last stop ("Antioch, Richmond"), not its headsigns, which name stations behind the rider. A trip ending early says where it goes.

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
| walk | straight line × 1.3, at 1.4 m/s (rider can change the speed in device settings) | Measured from the station entrance nearest the stop (BART's GTFS lists every entrance). 1.3 approximates the street grid. 1.4 m/s is a brisk commuter pace (OpenTripPlanner's default is 1.35). |
| crossing | 30 s when the stops are more than 30 m apart | Allowance for a signal. No street data, so distance stands in for "different corner". |

Checks against transfers J has made:

| Transfer | Estimate | Minimum | J's experience |
|---|---|---|---|
| 24th St Mission (SW plaza) to 13477, 36 m | 168 s | 3 | 3 works |
| Civic Center (8th St entrance) to 13209, 37 m | 169 s | 3 | 3 works |
| 16189 Rhode Island & 16th to 17770, 39 m | 76 s | 2 | |

Overrides, in priority order: the rider's own value for the search, a table of calibrated pairs kept in the repo, and the agency's `transfers.txt` `min_transfer_time` (BART uses it for timed cross-platform transfers).

With step-free travel on (`stepfree=1`), a transfer that gets off or boards at a BART or Muni Metro station gets 3 more minutes on its default minimum, for waiting for and riding elevators. That includes BART's listed transfers, since some change levels (12th St and 19th St) and the list does not say which. A minimum the rider set stays as they set it.

### Why no buffer, unlike Google Maps

Google Maps does not document its transfer padding, but planners that work from schedules hours ahead have to pad for lateness they cannot see. This app compares live predictions on both legs, shows each vehicle's lateness, and compares whole minutes rounded down: a transfer shown as 3 minutes is at least 3:00 in the feed, so the rounding is already a buffer of 0 to 59 seconds. A transfer within a minute of the minimum is marked tight, as the design specifies.

## Maximum transfer time

Default: the minimum plus the time between first-leg vehicles, at least 9 and at most 20 minutes. For Montgomery to the 48, BART's southbound trains come every few minutes, so the window is 3 to 12.

Each first vehicle pairs with the first second-leg departure it can make. For any departure, the best vehicle is the last one that still makes it, and its transfer falls within one first-leg headway of the minimum. A window that wide therefore shows every departure's best connection, and drops vehicles that would only wait longer for the same departure.

The 20 minute cap keeps rare feeders (an hourly Golden Gate bus) from stretching the window to an hour. When nothing connects, the empty state offers the smallest raise of the maximum that would. The minimum never drops, since it is the time the walk takes.

An earlier version widened by the second route's headway instead. That made Montgomery to the 48 run 3 to 23 on Saturdays, when the 48 comes every 20 minutes, without showing anything more useful.

## Hidden connections

Riders can reveal what the window filtered out: transfers below the minimum, transfers above the maximum, and first vehicles leaving too soon to reach. They appear in place, de-emphasized, each labeled with its reason.

## Vehicles that have left

A rider who boards and then opens the app should still find the trip they are on, to pin it. So the results keep vehicles that have left, apart from the rest:

- A first vehicle that has left From, within the last three hours, stays while the second vehicle it makes has yet to leave, or with a destination, to reach it. Each pairs with the departure it really made, which may itself have left, so it never moves on to a later one.
- A second vehicle that has left where the rider boards it stays only with a destination, until it gets there. Without one, the rider's trip ends once they board.
- A stop the feed no longer lists is one the vehicle has passed. Its time there is the schedule plus the delay at the first stop the feed does list, always before now, so the vehicle counts as gone.
- They never count as leaving too soon, and they do not count toward the 3 departures shown. They fold into a collapsed "N departed" row at the top of their card, or with every vehicle on a card gone, a "N departed" section at the top of the transfer point.

## Past the live predictions

Live predictions reach about 1 to 3 hours ahead (about 67 minutes for SamTrans). Past that, departures come from the static schedule and are labeled as scheduled. A trip the feed knows but has not predicted that far stays, at its scheduled time: it has only passed a stop when the feed's first listed stop comes after it. A scheduled trip that should be on the road but is missing from the feed, within three minutes of a live trip on the same route, is taken as that same bus and dropped.

## Freshness

Pages show how old the live data is, counted from when the server last got it from 511, so it grows when either the rider's device or the server falls behind. The server and each page both refresh every 30 seconds, so data on screen is normally under about 61 seconds old. Past 75 seconds (two and a half refreshes), the page warns, saying whether the device missed a refresh or 511 has not sent new predictions. Pages never refresh faster when data is old: each keeps its own 30 second rhythm from when it opened, so devices never line up into bursts.

## Where settings live

- Device settings (browser storage): walking speed, longest transfer walk, default window, default for hiding departures.
- Per search (saved with it): window, hiding departures (default 0), destination stop, route filters.
- Accounts may come later, so settings are kept as plain serializable objects that could move to a server.

## Carried over from the terminal version

- Every minute comparison uses whole minutes rounded down, the same number the rider sees.
- Each first vehicle pairs with the first second-leg departure it can make.
- Show the next 3 departures per second route (or per transfer point) that have at least one qualifying first vehicle still to leave From. Drop disqualified pairings before choosing those 3. Vehicles that have left come on top (see above).
- Under each departure, list every first vehicle that makes it, in order.
- Hide first vehicles leaving From sooner than a rider-set number of minutes (default 0, the terminal version used 3), but never one that has already left.
- Lateness is the feed's arrival delay at that stop, rounded to the nearest minute: "N min late", "N min early", or "delay unknown". Shown for every vehicle on both legs.
- An optional destination stop shows when the second vehicle reaches it, only when that comes after the boarding stop.
- Times display in America/Los_Angeles.

## Service changes

Checked live on 2026-10-03: Muni alerts name the affected route and stop pairs, but the replacement stop is free text ("Board at Folsom/Mabini"), and predictions keep running at stops the alerts call closed or rerouted (all 61 stops on an active 45 reroute still had predictions, and no stop was marked skipped). So the app cannot move a search to a temporary stop on its own. It shows every alert that names a route and stop in the search, ranked first when it names a stop the rider boards at or gets off at.
