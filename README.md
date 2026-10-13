# Transfers

Live transfer times between Bay Area transit stops: Muni, BART, SamTrans, and Golden Gate Transit. Pick the stop where you start, then the route you want to catch or the stop you are going to.

- **A route in To:** the next departures of that route you can make, every vehicle from your stop that makes each one, how long each transfer is, and how late each vehicle is running.
- **A stop in To:** two tabs. **Trips** is the ways to get there: the routes that go straight there, from your stop or a short walk from it, or when none does, every way there with one transfer, soonest arrival first, and when nothing that simple gets there, trips with more changes. **Transfers** is what you can catch at that stop, as for a route. The page opens on Transfers when a route already takes you there, and on Trips otherwise.
- **From** is always a stop. With nothing typed, it lists the stops nearest you.

## Why it exists

- **You set the transfer window.** The shortest and longest transfer you will accept is yours, per search or for every search. Trip planners working from schedules pad each transfer for lateness they cannot see, so they leave out tight connections a rider can make. Transfers shows them, and those the window hides are a tap away, each with its reason.
- **Live times on both vehicles, and no hidden padding.** Both legs use 511's live predictions where it has them. Each transfer's minimum is the physical time to change, rounded up to whole minutes, with a few timed by hand. See [docs/transfer-rules.md](docs/transfer-rules.md).
- **Built for one bar of signal.** Riders use it walking to a station, on a platform, or on a train underground. Each request asks only for what one page shows, and each answer carries only the fields the page reads, so answers stay small and get through when bigger ones would not. The last results show at once while new ones load, and extras like the live vehicle map load only when opened.
- **Accessible.** It works with a screen reader and a keyboard. BART's elevator and escalator outages show on the way and on a station's arrivals, unless turned off, and a rider who uses elevators can allow more time to change at stations.
- **It helps most going from frequent service to infrequent,** such as BART to a bus every 20 minutes, where the train you catch decides whether you make the bus.

Data provided by [511.org](https://511.org) and BART.

## Running locally

Needs Node 24 and pnpm. Put 511 keys in `.env` (see `.env.example`).

```sh
pnpm install
pnpm dev:server   # API on :3000. Downloads and builds the schedule on first start.
pnpm dev:web      # Frontend on :5173, proxying /api to :3000.
```

To build the schedule from zips already on disk instead of downloading: `pnpm ingest <dir with SF.zip, BA.zip, SM.zip, GG.zip, GF.zip>`.

Checks: `pnpm typecheck` (TypeScript 7) and `pnpm test` (Node's test runner).

## Layout

- `server/`: Node, run as TypeScript directly (no build step).
  - `gtfs/`: loads 511's static schedules into SQLite.
  - `realtime/`: decodes GTFS-realtime feeds and spreads requests across 511 keys.
  - `engine/`: finds transfer points and pairs connections. The rules are in [docs/transfer-rules.md](docs/transfer-rules.md).
  - `journeys/`: plans trips with any number of changes (RAPTOR), from timetables kept in memory, for a stop no way with one transfer reaches.
  - `api/`, `main.ts`: the HTTP API.
- `web/`: Preact frontend built with Vite.
- `shared/api.ts` and `shared/journeys.ts`: the JSON the API sends.
- `shared/short-links.ts` and `shared/labels.ts`: short trip links, and how a trip's stops and routes are named, used by both the server and the app.
- `design_handoff_transfers/`: the Claude Design handoff the frontend follows. `web/src/styles.css` starts from its stylesheet, adjusted since, and additions for screens it did not cover follow at the end.
- `docker/`, `Dockerfile`, `docker-compose.yml`: deployment. See [docs/deploy.md](docs/deploy.md).
