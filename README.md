# Transfers

Live transfer times between any two Bay Area transit stops: Muni, BART, SamTrans, and Golden Gate Transit. Pick where you board and the stop or route you want to transfer to, and it lists the next departures you can make, every vehicle that makes each one, and how late each is running.

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
  - `api/`, `main.ts`: the HTTP API.
- `web/`: Preact frontend built with Vite.
- `shared/api.ts`: the JSON the API sends.
- `docker/`, `Dockerfile`, `docker-compose.yml`: deployment. See [docs/deploy.md](docs/deploy.md).
