# Handoff: Transfers

## Overview
Transfers is a mobile-first web app for SF Bay Area riders. It shows which first vehicle to catch so they make a specific transfer, using live predictions. The rider picks **From** (a stop or station) and **To** (a stop or a route). The app works out where to get off the first vehicle and lists the next 3 departures of the second route that have at least one connecting first vehicle. Under each departure it lists every first vehicle that makes the connection. Agencies: Muni (bus, Metro, cable car, streetcar), BART, SamTrans, Golden Gate Transit.

People use it walking to a station, on a platform, or underground with one bar of signal. It has to be glanceable, one-handed, and keep working offline.

## About the design files
`design/` holds **HTML design references**: prototypes showing the intended look and behavior. They are not production code. Open `design/Transfers.dc.html` in a browser; it shows the final design (turn 6), a clickable prototype, and every state in light and dark. `design/Mode Icons.dc.html` is the icon exploration; turn 5a is the final set.

`src/` is a **React (TSX) implementation** of the final design, written for this handoff with plain CSS custom properties. It has no Tailwind, no CSS-in-JS, and no component, icon or animation libraries. Use it as the starting point, and recreate it in your codebase's patterns if they differ. It runs on example data; swap in real 511.org and BART feeds (see State management).

## Fidelity
**High fidelity.** Colors, type sizes, spacing, borders, icons and copy are final. Match them exactly.

## Screens

### 1. Search (home) — `screens/SearchScreen.tsx`
- Single column, max-width 760px, 16px gutters, 22px gap between blocks.
- **Header:** "Transfers" at 24/700, plus the current Pacific time in muted text on the right.
- **Fields** (`SearchFields`): one 1.5px bordered box containing From and To rows with a 52px swap column on the right. Each row has an uppercase 12px kicker and an 18px/600 input. Once a result is picked, a meta line under the input shows agency · stop code · direction.
- **Find transfers:** a 52px primary button, shown once either field has text. It is enabled only when both fields have a pick.
- **Results** (`StopResults`): replaces Saved/Recent while typing. Each row (64px minimum) shows name, then code ("Stop 13477", "Station" or "Route"), then agency · direction, then route chips. This is how same-name stops are told apart. The To field also returns routes. A query matches name, stop code, or an exact route label.
- **Saved** (`SavedSearchCard`): the primary daily entry point. Cards tile with `auto-fit, minmax(320px, 1fr)`. Each card shows:
  - the name at 19/700, with a pencil button that renames it in place (Enter or blur commits);
  - the chain, plus the transfer window;
  - "ARRIVES IN" with a 38/800 countdown for the soonest connecting first vehicle;
  - one line with both legs and their lateness;
  - a red tag if a severe alert touches the boarding stop.

  Tapping the body opens results.
- **Recent** (`RecentList`): 60px rows, each with a label, a sub line, and a chevron.

### 2. Results — `screens/ResultsScreen.tsx`
- **Sticky header** (`ResultsHeader`):
  - Row 1 has a 44px back button and the trip chain at 17/700: "Montgomery → *24th St Mission* → [48]". The middle step is worked out by the app, so it has a 1px dashed accent border, is italic, and uses the `--accent-ink` color.
  - Row 2 is the live status: a dot, then "Updated 12 s ago" (or "Refreshing…", or "Offline, updated 3 min ago" in red bold with a hollow dot), then "· Transfer 3–12 min".
  - A 2px indeterminate bar along the header's bottom edge runs while loading or refreshing.
- **Banners:** Offline uses the reversed field color. Feed outage has a caution border and tint.
- **Alerts** (`AlertList`): max-width 760px, 8px gap, collapsible.
  - **Severe** (boarding stop): red border, red tint, red kicker and icon. Open by default.
  - **Warning** (elevator out, reroute): amber border and icon.
  - **Info** (general notice): neutral border and an info icon.

  Each alert has a kicker (12px caps), a title (16/650), and a body plus meta when open.
- **Groups** (`TransferPointGroup`): one per connecting route, or one per transfer point when To is a route (kicker "Transfer point 1 of 2"). The header has the route chip (18px icon), "at {stop}", and the stop code · direction. On desktop, groups sit side by side with `auto-fit, minmax(380px, 1fr)`.
- **Departure card** (`DepartureCard`), 1.5px `--line` border:
  - **Band:** `--field` background with `--on-field` text. It shows the route chip (17/800), time (21/800), status tag, and countdown on the right ("15 min" / "away", or "~61 min" / "by schedule"). The sub line reads "Arrives at {stop} · Home 5:02 PM" when a destination is set. A scheduled-only departure adds a clock icon and a dashed "Scheduled" tag.
  - **Ticks:** "now · +15 · +30 · +45", aligned to the time bar column.
  - **Connection rows** (`ConnectionRow`) use a grid of `80px | 1fr | auto`:
    - Left: "ARRIVES IN" (12px caps), the number at 38/800, then "min" (or "Now"). This is minutes until the first vehicle reaches the From stop. The app does not estimate walking time.
    - Middle: route chip + departure time at 17/700; lateness as colored text; "Off at {stop} {time}".
    - Right: transfer minutes (20/800), "transfer", and a **TIGHT** tag when the transfer is ≤ min + 1. The minutes turn red when tight.
    - Time bar under the middle and right columns: dotted wait, ink ride segment, outlined gap (red border and tint when tight), then the second leg in its route color. Every card on the screen shares one scale.
- **Canceled departure:** a dashed red box with the struck-through time, "Canceled", and "Not counted. Next 22 toward UCSF Mission Bay at 4:54 PM." It stays in time order.
- **Empty window:** "No train connects to the 48 within 4–6 min", a hint, and a primary "Widen to 3–7 min" button. The suggestion is the smallest symmetric widening that finds a connection.
- **Credit** (`DataCredit`): "Data provided by 511.org" and "BART data courtesy of BART", in 13px muted text, always under the results.
- **Bottom bar** (`BottomBar`): within thumb reach. A "Transfer window 3–12 min" button (flex) and a 52px settings button.

### 3. Sheets — `components/TripSettingsSheet.tsx`
- Bottom sheet over a scrim, max-height 90%, inner max-width 560px.
- **Transfer window:** min and max steppers plus a link to "All trip settings".
- **Trip settings:**
  - min and max transfer;
  - "Hide departures leaving in less than N min" (time to reach the From stop);
  - destination stop (native select);
  - first-leg route filters (toggle chips with `aria-pressed`);
  - second-leg route and transfer-point filters.
- Steppers are 48×48 − / value / + inside a 1.5px box.
- The sheet closes with a "Done" primary button; under it: "Saved with “Work to home”". Settings persist per saved search.

## Interactions & behavior
- **Clock:** ticks every 1 s on the device, offline too. Countdowns use `floor((t − now) / 60)`. Show "Now" / "Arriving" under 1 min. A first vehicle drops off once it has left.
- **Refresh:** every 30 s while online. The header shows "Refreshing…" and the bar for about 1 s, then "Updated N s ago" counts up.
- **Return visit:** render cached results immediately with `feed='refreshing'`. **First visit:** skeleton plus bar with `feed='loading'`.
- **Offline** (`navigator.onLine` or fetch failure): keep the last results, show the offline banner and red status, and keep ticking.
- **Feed outage for one agency:** render that agency's departures with `scheduledOnly`, and show the outage banner naming the routes and the agencies that are still live.
- **Scheduled-only** (past the live horizon; common for SamTrans and Golden Gate Transit): dashed "Scheduled" tag, muted time, "~" countdown, "by schedule".
- **Motion:** only the refresh bar (1.1s linear, infinite) and the alert chevron rotation (150ms). Both respect `prefers-reduced-motion`.
- **Tap targets:** ≥ 44px; primary buttons and the bottom bar 52px; steppers 48px.
- **No horizontal scroll** from 360px to desktop. Layout uses grid `auto-fit` and `minmax(0, 1fr)`.

## Accessibility
- Each connection row has one visually hidden sentence, and its visual fragments are `aria-hidden`. Example: "BART Yellow line toward SFO, arrives in 4 minutes, 4:39 PM, 1 min late. Off at 24th St Mission 4:47 PM. 3 minute transfer, tight." Chips show "BART" without the color word, so the color is spoken here.
- Each departure card has an `aria-label` and a hidden `<h3>` with the same summary, so screen-reader users can jump between departures by heading.
- The live status is `role="status"`. Alert toggles use `aria-expanded`. Sheets are `role="dialog" aria-modal`. Steppers announce through `<output aria-live="polite">`.
- Contrast: text is ≥ 4.5:1 in both themes. `--accent` (3:1) is used only for chrome and the live dot; text in the accent color uses `--accent-ink`. Route chip text switches between dark and white per color (`textOn`).
- Sheets move focus into the panel on open, keep Tab inside, close on Escape or a scrim tap, and return focus to the button that opened them.
- Search results are a plain list of buttons under a polite live count ("4 stops and routes match “24th”"). They are not a listbox, because there is no arrow-key model.
- The worked-out transfer point in the header carries hidden text, "(transfer point found for you)", so it doesn't rely on dashed styling or a tooltip.
- Alert toggles reference their panels with `aria-controls`. The loading skeleton is `aria-busy`.
- Nothing depends on color alone: lateness, TIGHT, Scheduled, Canceled and severity all have words. BART line color is in the spoken row summary.
- Countdowns are deliberately not live-announced every minute, which would be constant noise. The header status is the live region.
- Set `<html lang="en">`. Don't disable pinch-zoom. Layout holds at 200% text zoom because nothing has a fixed height.

**Manual test before ship** (VoiceOver on iOS and TalkBack on Android, plus a keyboard on desktop):
1. Swipe through a departure card. Expect the heading first, then one sentence per connection.
2. Open and close the transfer window sheet. Focus should land on the panel and come back to "Transfer window".
3. Run a search for "24th". The match count should be announced, and each result should read its name, stop code, direction and routes.
4. Go offline. The status should change to "Offline, updated N min ago" without stealing focus.
5. Check that tap targets are ≥ 44px with large text enabled.

## Route colors — `lib/color.ts`
- **Official colors kept:** BART lines (Yellow `#f2c500`, Red `#e2231a`, Green `#4db848`, Blue `#0099d8`); Muni Metro J `#faa634`, K `#569bbe`, L `#92278f`, M `#008752`, N `#00539b`, T `#d31245`, S `#ffcc00`; F `#f0e68c`.
- **Muni Rapid** routes ("5R", "14R"…): `#c4122f`, following the SFMTA map.
- **Other bus routes** have no official color. They get a stable hue from `BUS_PALETTE` keyed on the route number: `#00858a #2b6fa8 #4c55a8 #2e8350 #6f8226 #b8602a #9a3b6d #7a5f45`.
- **Clash rule:** BART colors never change. A route with an arbitrary color steps to the next palette color if it is within RGB distance 90 of a color already in view (the first leg). Bus to bus: the second leg yields.
- **Cable car:** Muni assigns no color; the prototype uses placeholder brown `#8c5a2b`.

## Mode icons — `icons/modeGlyphs.ts`, `icons/ModeIcon.tsx`
- Six 24×24 side-view pictograms facing right: bus (also used for trolley buses), light rail (single-arm pantograph), streetcar (trolley pole), cable car (tilted −9°), BART, ferry. Each has a gerbil driver in the cab window.
- Solid `currentColor` fills with `evenodd` window cut-outs; rails and wave are 1.6px strokes. Path data is generated from `design/Mode Icons.dc.html` (turn 5a). Edit it there if the shapes change.
- Sizes: 15px in search chips, 16px in rows and the header, 18px in group headers and the band. Below about 20px the gerbil reads as a dark spot in the window, which is intended.
- Interface icons (`icons/ui.tsx`) are inline 24×24 strokes at 1.75: back, swap, sliders, chevrons, warning, info, offline, clock, pencil, close.

## State management
- **App-level:** `nowSec` (1 s tick), `lastUpdate`, `online`, `feed: 'live' | 'refreshing' | 'loading' | 'offline'`, current screen and trip, saved searches (name + settings), recent searches, and a per-trip response cache.
- **Derived:** `computeTrip(trip, settings, nowSec, feedDownAgencies)` returns, for each transfer point, up to 3 departure cards (canceled ones kept in sequence) with their connections. `suggestWiden` builds the empty-state button.
- **Data to fetch:**
  - 511.org StopMonitoring (Muni, SamTrans, Golden Gate) and BART ETD for the From stop and the transfer stop or stops;
  - 511.org GTFS static, to find where two routes meet when To is a route and to supply scheduled times past the live horizon;
  - 511.org service alerts, filtered to every stop and route in the trip and ranked by severity, with the boarding stop first.
- Keep the last response per trip, in memory and `localStorage`, for instant return visits and offline use.

## Design tokens — `src/styles.css`
Light and dark themes, following `prefers-color-scheme`; force one with `data-theme` on `<html>`.

| Token | Light | Dark |
|---|---|---|
| --bg | #f2f2f3 | #1c2128 |
| --surface | #e3e3e5 | #2a313b |
| --text | #1d1f20 | #d9dfe7 |
| --muted | #55575a | #9ba5b2 |
| --divider | rgba(29,31,32,.14) | rgba(205,217,229,.13) |
| --line | rgba(29,31,32,.66) | rgba(205,217,229,.5) |
| --accent | #5980a6 | #8fb5dc |
| --accent-ink | #416180 | #b5d4f4 |
| --accent-tint | #d6ebff | #2c4258 |
| --primary / --on-primary | #416180 / #f5f5f8 | #8fb5dc / #14191f |
| --field / --on-field / --on-field-muted | #1d2d3d / #eef6ff / #b9cadb | #2d3b4c / #ecf3fb / #bccad9 |
| --late / --late-tint | oklch(.5 .18 28) / oklch(.93 .04 28) | oklch(.77 .13 28) / oklch(.33 .065 28) |
| --early / --early-tint | oklch(.48 .17 300) / oklch(.93 .04 300) | oklch(.8 .11 300) / oklch(.33 .055 300) |
| --caution / --caution-tint | oklch(.5 .11 70) / oklch(.94 .045 85) | oklch(.84 .11 80) / oklch(.33 .045 80) |
| --ok | #416180 | #b5d4f4 |
| --scrim | rgba(18,20,22,.45) | rgba(6,9,13,.55) |

- **Type:** the system font stack, with tabular numerals everywhere. Sizes are 12 / 13 / 14 / 16 / 17 / 19 / 21 / 24, and 38 for countdowns. Weights 400 / 600 / 650 / 700 / 800. Caps tracking .06em, kicker tracking .08em.
- **Space:** 4 / 8 / 12 / 14 (card padding) / 16 (gutter) / 22 / 28.
- **Shape:** every card, chip, button and field has square corners (radius 0); only the live dot is round. Borders are 1px (dividers) and 1.5px (cards, fields, controls). There are no shadows.
- **Layout:** results max 1120px, search and alerts max 760px, sheets and the bottom bar max 560px, countdown column 80px, group min width 380px.

## Example data — `src/data/example.ts`
From the terminal version this replaces, extended to cover every state. The demo clock starts at 4:34:15 PM.
- **Work to home:** Montgomery → 24th St Mission → 48. Includes BART 4:39 PM (1 min late) to the 48 at 4:50 PM (7 min late), a 3 min tight transfer, Home at 5:02 PM. Two trains make the 5:07 PM 48.
- **Climbing gym:** 26th St & De Haro (13516) → 22. Rides the 19 to Rhode Island & 16th; the 22 has two transfer points (toward Fillmore and toward UCSF Mission Bay), and one 22 is canceled.
- **SamTrans:** Montgomery → Daly City → SamTrans 120. Live first, then scheduled only.
- **Stops:** same-name pairs (24th St & Mission St 13477/13476, Mission St & 24th St 15553/15552) for disambiguation.

## Files
- `design/Transfers.dc.html`: the final design (turn 6a), prototype, and states gallery (open in a browser; needs `support.js` next to it).
- `design/TransfersApp2.dc.html`: the app prototype the canvas embeds.
- `design/Mode Icons.dc.html`: icon exploration; turn 5a is final.
- `src/styles.css`: tokens and component classes (`tf-*`).
- `src/types.ts`, `src/lib/{time,status,color,connections}.ts`: models and logic.
- `src/icons/`: `modeGlyphs.ts`, `ModeIcon.tsx` (pictograms), `ui.tsx` (interface icons).
- `src/components/`:
  - `RouteChip(route, size, iconSize)`
  - `StatusTag(status, plain)`
  - `TimeBar(rideStart, rideEnd, gapEnd, busEnd, busColor)` and `TimeTicks(scaleMinutes)`
  - `ConnectionRow(connection, alightStop, nowSec, secondTime, secondEnd, secondColor, pct)`
  - `DepartureCard(card, point, alightStop, destinationShort, nowSec, scaleMinutes, nextTime)`
  - `TransferPointGroup(result, firstWord, windowText, onWiden, …)`
  - `ResultsHeader(from, via, to, feed, secondsSinceUpdate, windowText, onBack)`
  - `OfflineBanner(statusText)` and `FeedOutageBanner(agency, routes, liveAgencies)`
  - `AlertList(alerts, initiallyOpen)`
  - `SkeletonResults()`
  - `DataCredit()`
  - `BottomBar(windowText, onWindow, onSettings)`
  - `Sheet(title, subtitle, savedWith, onClose)` and `Stepper(label, help, value, min, max, onChange)`
  - `TransferWindowSheet(s, update, savedWith, onClose, onMore)` and `TripSettingsSheet(trip, s, update, savedWith, onClose)`
  - `SearchFields(from, to, onFrom, onTo, onFocus, onSwap)`
  - `StopResults(query, hits, onPick, includesRoutes)`
  - `SavedSearchCard(name, chain, windowText, next, severeAlerts, onOpen, onRename)`
  - `RecentList(items, onOpen)`
- `src/screens/SearchScreen.tsx`, `src/screens/ResultsScreen.tsx`, `src/App.tsx`: screens and app wiring.
- `src/States.tsx`: every results state rendered statically, for review and visual tests.
