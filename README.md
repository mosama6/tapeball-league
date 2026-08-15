# Wolfpack Tape Ball League

Event-sourced cricket tournament scoring platform: an **Umpire app** (offline-first, ball-by-ball) and a **public web app** (live scores, scorecards, points, leaderboards) sharing one Node/Postgres backend.

Scores are never stored as a mutable total. Every ball is an immutable `Delivery` event. Totals, scorecards, the 30-run retirement, illegal-ball escalation, free hits, home runs, points, and leaderboards are all derived from that log.

Both frontends are **web apps** with a phone-first layout (no native/React Native build).

## Apps

| App | URL | Who |
|---|---|---|
| Public web | http://localhost:5174 | Anyone (view-only). Admin login is inside `/admin`. |
| Umpire | http://localhost:5173 | Assigned umpires, scoring at the ground |
| API + WebSocket | http://localhost:4000 | Shared backend |

## Stack

- **Backend:** Node.js, Express, Prisma, PostgreSQL, Socket.IO
- **Rule engine:** TypeScript in `/shared` (used by API, umpire app, and tests)
- **Umpire:** React + Vite + Dexie.js (IndexedDB queue for offline sync)
- **Public web:** React + Vite + Socket.IO client

## Folder structure

```
/shared        types + scoring rule engine + Vitest suite (PRD §9)
/backend       REST API, Prisma schema, WebSocket, seed data
/umpire-app    offline-first scoring UI
/web-app       live scores, tournaments, leaderboards, lightweight admin
```

## Prerequisites

- Node.js 20+
- Docker (for PostgreSQL) **or** a local Postgres. Default URL: `postgresql://tapeball:tapeball@127.0.0.1:5433/tapeball`

## Run locally

```bash
docker compose up -d
npm install
npm run db:push
npm run db:seed
npm run dev:apps
```

Then open:

- Public: http://localhost:5174
- Umpire: http://localhost:5173

### Demo logins

| Role | Email | Password |
|---|---|---|
| Admin | admin@wolfpackcricket.com | password123 |
| Umpire | umpire@wolfpackcricket.com | password123 |

Seed data includes the **Wolfpack Tape Ball League**, four teams, and venues. Fixtures and matches are not seeded — create those in Admin.

If you already seeded earlier, those demo logins were `admin@lms.local` / `umpire@lms.local` until you re-seed.

## Custom rules (defaults, configurable per tournament)

- **Illegal-ball escalation:** wides and no-balls share one counter per over. First illegal = +1 and not a legal ball. Second and later = +4 **and** the ball counts as legal.
- **Free hit** after every no-ball (carries over if the next ball is also illegal). Bowled/caught/LBW/stumped/hit-wicket are illegal on a free hit; run-out is allowed.
- **Home run:** exact bat-six on the final *fair* legal ball of an innings → +6 bonus to batsman and team (12 from that ball).
- **Retire at 30:** personal **bat runs only** (extras never count). Not a wicket. Dismissal on the same ball wins. Return only when no other eligible batter remains, and the umpire picks who comes back.

## Tests

```bash
npm test
```

Runs the rule-engine suite in `/shared` (dot balls, extras, escalation, home run, retirement, free hit, undo, duplicate event IDs, chase ending, and the wide→no-ball+six scenario).

## Offline scoring

The umpire app applies each ball locally with the shared engine, stores the event in IndexedDB, and syncs to the API when the network returns. The server is idempotent on `eventId`, so a retry cannot double-score.

## Production hosting

See [HOSTING.md](HOSTING.md) for Neon, Vercel, `wolfpackcricket.com` / `umpire.wolfpackcricket.com` / `api.wolfpackcricket.com`, images, and live-score capacity.
