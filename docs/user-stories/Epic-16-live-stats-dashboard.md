# Epic: Live Statistics Dashboard

**Epic ID:** Epic 16
**Feature:** Public, view-only `/dashboard` with platform-wide game statistics
**Priority:** Medium
**Created:** 2026-08-30
**Branch:** `feature/stats-dashboard`
**Status:** Implemented — pending the manual DB migration and a live-data smoke test

---

## Executive Summary

We want a public `/dashboard` page, reachable from the start page, that shows the statistics of the
game as a product: how many games have been played, how long they run, which house rules people
actually pick, which chains win, how bots fare against humans, and what is happening right now.
It is view-only — no controls, no way to affect a game, no login required.

**The problem is that none of that data exists yet.** The one table designed to hold it,
`game_history`, is never written to by any code path (`db/schema.sql:187` declares it;
`server/api/account.ts:47` reads it; nothing anywhere inserts a row). The `/history` page has
therefore been rendering an empty list since it shipped, and nobody noticed because the account UI
that links to it is switched off (`src/pages/Index.tsx:20` — `SHOW_ACCOUNT_UI = false`).

And even if we started writing it today, it would not survive: `game_history.room_id` is
`REFERENCES game_rooms(id) ON DELETE CASCADE` (`db/schema.sql:190`), and `cleanup-rooms` deletes
every room 10 minutes after its last heartbeat (`server/api/cleanup-rooms.ts:25`). Every record
would be erased minutes after the game it describes ended.

So this epic is two features that have to ship together:

1. **A durable results-recording layer** — one row per finished game plus one per participant,
   written the moment a game reaches `game_over`, in tables that outlive the room.
2. **The dashboard itself** — a public read-only page over an unauthenticated aggregate API, with a
   live "right now" strip that refreshes on a timer.

The honest consequence, stated up front: **the dashboard is empty on the day it ships and fills up
from that day forward.** There is no history to backfill. This is a good reason to build it now
rather than later — every day we wait is a day of data we do not get. See
[Cold Start](#cold-start-and-empty-states).

---

## Problems This Solves

| # | Problem | Evidence |
|---|---|---|
| 1 | **No game outcome is ever recorded.** `game_history` has zero writers | `grep -rn game_history` → only `db/schema.sql:187` (DDL) and `server/api/account.ts:47` (read) |
| 2 | **Any record we did write would be deleted within ~10 minutes** of the game ending | `game_history.room_id ... ON DELETE CASCADE` (`db/schema.sql:190`) + `IDLE_MINUTES = 10` (`server/api/cleanup-rooms.ts:25`) |
| 3 | `/history` is a page that structurally cannot show anything | `src/pages/GameHistory.tsx` reads `list_history`, which queries the empty table |
| 4 | We shipped Epic 15's rule defaults (Aggressive chain safety, visible cash) on judgment alone, with no way to see whether players keep or change them | `src/types/game.ts` `DEFAULT_RULES`; no telemetry of any kind |
| 5 | Bot difficulty (`easy`/`medium`/`hard`) has never been measured against human results | `server/lib/bot.ts`; `game_players.bot_difficulty` is written but never read back for analysis |
| 6 | Everything interesting about a finished game lives in `game_states` and dies with the room — final chains, `round_number`, `game_log`, `rules_snapshot` | `db/schema.sql` `game_states`; cascade from `game_rooms` |
| 7 | The game reaches `game_over` from **seven** separate code paths, so any recording hook added naively will miss cases | `server/api/game-action.ts:622, 766, 1344, 1504, 1644, 1796, 2245` |
| 8 | There is no unauthenticated API surface at all — every handler starts with `verifyAuth` | `server/api/account.ts:16`, `server/api/rooms.ts`, `server/server.ts:43-48` |

Problem 7 is the implementation trap. Problem 2 is the one that makes this a schema epic rather
than a UI epic.

---

## Out of Scope

- **Per-game spectator view.** Watching one live game's board and share ledger is a different
  feature with a different data path (Socket.io room subscription). Explicitly deferred; the "live
  now" strip links nowhere.
- **Personal identity and per-account leaderboards.** With `SHOW_ACCOUNT_UI = false` effectively
  every player is an anonymous session, and `player_name` is free text typed per room — it is a
  label, not an identity. A "top players" board over that data would be meaningless at best and
  impersonatable at worst. See [Why there is no leaderboard](#why-there-is-no-player-leaderboard).
- **Turning the account UI back on.** Separate product decision.
- **Historical backfill.** Impossible — the data was never written.
- **Charts of in-flight game state.** The live strip shows counts only.
- **Admin/moderation tooling.** No room list with codes, no ability to end a game.

---

## Part 1 — The Recording Layer

### Design principle

A finished game is an immutable historical fact. It must not have a foreign key to a mutable,
short-lived room. The new tables reference `game_rooms` **not at all**, and reference `users` only
via `ON DELETE SET NULL`.

### New tables

```sql
-- One row per completed game. Survives room cleanup and user deletion.
CREATE TABLE game_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalised: the room is gone within minutes, so we keep no FK to it.
  -- source_room_id is kept only to make recording idempotent (see below).
  source_room_id    UUID NOT NULL UNIQUE,
  room_code         VARCHAR(8),

  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds  INTEGER,
  rounds            INTEGER,
  end_reason        VARCHAR(16) NOT NULL
                    CHECK (end_reason IN ('threshold', 'vote', 'auto', 'unknown')),

  player_count      INTEGER NOT NULL,
  human_count       INTEGER NOT NULL,
  bot_count         INTEGER NOT NULL,

  winner_name       VARCHAR(50),
  winner_is_bot     BOOLEAN,
  winner_difficulty VARCHAR(10),
  winning_total     INTEGER,

  rules             JSONB NOT NULL,   -- game_states.rules_snapshot, normalised v2
  final_chains      JSONB NOT NULL,   -- { chain: size } at game end, 0 = never founded
  mergers_count     INTEGER NOT NULL DEFAULT 0,
  app_version       VARCHAR(16),      -- from package.json at build time

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_game_results_ended_at ON game_results (ended_at DESC);

-- One row per seat in a completed game.
CREATE TABLE game_result_players (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id         UUID NOT NULL REFERENCES game_results(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  display_name      VARCHAR(50) NOT NULL,
  seat_index        INTEGER NOT NULL,
  is_bot            BOOLEAN NOT NULL DEFAULT false,
  bot_difficulty    VARCHAR(10),
  final_cash        INTEGER NOT NULL,
  final_stock_value INTEGER NOT NULL,
  final_bonus_total INTEGER NOT NULL,
  final_total       INTEGER NOT NULL,
  placement         INTEGER NOT NULL,
  stocks            JSONB NOT NULL,
  UNIQUE (result_id, seat_index)
);

CREATE INDEX idx_game_result_players_result ON game_result_players (result_id);
CREATE INDEX idx_game_result_players_user   ON game_result_players (user_id) WHERE user_id IS NOT NULL;
```

Ships as `db/migrations/2026-XX-XX-epic16-game-results.sql` **and** folded into `db/schema.sql`,
idempotently, following the Epic 14/15 pattern.

### `game_history`: replace, don't extend

`game_history` is dead code with a fatal cascade. Rather than fixing it in place we:

- Rewrite `account.ts` `list_history` to read `game_result_players JOIN game_results` for the
  caller's `user_id`, returning the same field names so `src/pages/GameHistory.tsx` needs no change.
- Leave the `game_history` table in place but unreferenced, and drop it in a follow-up once we are
  confident nothing external reads it. (Dropping tables and writing the dashboard in one PR is more
  risk than the tidiness is worth.)

### Where the write happens

`server/api/game-action.ts` sets `phase = 'game_over'` at seven sites (`:622`, `:766`, `:1344`,
`:1504`, `:1644`, `:1796`, `:2245`). Each already computes the winner via `calculateFinalScores`
(`server/lib/rules.ts:264`). Rather than adding a call at each site and hoping we caught them all:

1. Add `server/lib/results.ts` exporting `recordGameResult(roomId, endReason)`.
2. It re-reads the room, players and state from the DB itself — so it needs only two arguments and
   cannot be passed a stale in-memory snapshot.
3. It inserts with `ON CONFLICT (source_room_id) DO NOTHING`, so calling it twice is harmless.
4. Call it from every site — and add a **safety net**: a `recordIfFinished(roomId)` check in the
   room-cleanup path (`server/api/cleanup-rooms.ts`) that records any room whose state is
   `game_over` but which has no `game_results` row, immediately before deletion. Even if a future
   `game_over` path is added and the author forgets step 4, the game is still captured.
5. Recording failures are logged and swallowed. **A stats write must never break a game.**

> **Changed during implementation.** Step 4 does not touch the seven sites at all.
> `handleGameAction` has a single exit point (`game-action.ts:2030`, where `notifyForAction` fans
> out), and every path — human, bot, or timer, since `driveBots` re-enters the same function —
> passes through it. `recordIfFinished` is called there, gated on the game not already having been
> over when the action started, so the cost is one indexed lookup per in-game action and zero once
> the game is finished. A `game_over` path added later cannot be forgotten, because there is
> nothing to remember to do. The cleanup safety net stays: it covers games that ended while the
> recorder was down, and rooms that were already over when this deployed.
>
> The call is awaited rather than detached, because `new_game` deletes the `game_states` row the
> record is built from.

`started_at` comes from `game_rooms.created_at` (close enough — the lobby is short), `rounds` from
`game_states.round_number`, `mergers_count` by counting merger entries in `game_states.game_log`,
`rules` from `game_states.rules_snapshot` passed through the existing v1→v2 normaliser.

`end_reason`: `'vote'` when reached via `end_game_vote` (`:1644`), `'auto'` when reached via
`auto_end_turn` (`:1796`), `'threshold'` for the merger/placement paths, `'unknown'` from the
cleanup safety net.

---

## Part 2 — The Stats API

New handler `server/api/stats.ts`, registered in `server/server.ts` alongside the others:

```ts
app.all('/api/stats', handler(stats));
```

**It is the first unauthenticated endpoint in the codebase.** That is deliberate — the dashboard is
public — and it carries obligations:

- Read-only. `POST` with an `op`, matching house style, but every op is a `SELECT`.
- Returns **only aggregates and derived records**. Never a room code, never a `user_id`, never a
  row for a game currently in progress beyond a count.
- Results cached in-process for 60s (a simple `Map` with a timestamp — no new dependency), so a
  refresh loop or a crawler cannot hammer Postgres.
- Rate limit per IP (60 req/min) or, simpler and probably sufficient given the cache, rely on the
  cache alone and note the decision.

| op | Returns | Cache |
|---|---|---|
| `live` | `{ gamesInProgress, roomsWaiting, playersInGame, longestRunningMinutes }` | 15s |
| `totals` | `{ gamesCompleted, gamesToday, games7d, games30d, avgDurationSeconds, avgRounds, avgPlayerCount }` | 60s |
| `rules` | Per-rule value distribution across recorded games | 60s |
| `chains` | Per chain: times founded, times largest at end, avg final size | 60s |
| `economy` | Winning-total distribution buckets, avg winner total, avg spread 1st→last | 60s |
| `bots` | Win rate by seat type: human vs easy/medium/hard, and per-difficulty avg placement | 60s |
| `records` | Hall of fame: highest final total, longest game, most rounds, largest chain, biggest blowout — each with a display name label and date | 60s |
| `activity` | Games completed per day for the last 30 days | 60s |

`live` reads `game_rooms`/`game_players` directly (`status = 'playing'`, connected players);
everything else reads only the two new tables.

---

## Part 3 — The Dashboard Page

`src/pages/Dashboard.tsx`, route `/dashboard` added in `src/App.tsx` above the catch-all. Panels
composed from `src/components/dashboard/*` so no file repeats the `OnlineLobby.tsx` 1024-line
mistake called out in Epic 15.

Data via `@tanstack/react-query` (already installed, provider already mounted in `App.tsx`):
`refetchInterval: 15_000` for the live strip, `60_000` for the rest, `refetchOnWindowFocus: true`.

### Layout

```
┌───────────────────────────────────────────────────────────────┐
│  ← Back      Hotel Game · Statistics          ● live · 15s    │
├───────────────────────────────────────────────────────────────┤
│  RIGHT NOW                                                    │
│  ┌────────────┐┌────────────┐┌────────────┐┌────────────┐     │
│  │ 3          ││ 11         ││ 2          ││ 47 min     │     │
│  │ games live ││ players    ││ in lobby   ││ longest    │     │
│  └────────────┘└────────────┘└────────────┘└────────────┘     │
├───────────────────────────────────────────────────────────────┤
│  ALL TIME                                                     │
│  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐           │
│  │ 1,204  ││ 87     ││ 34 min ││ 22     ││ 3.4    │           │
│  │ games  ││ today  ││ avg    ││ rounds ││ players│           │
│  └────────┘└────────┘└────────┘└────────┘└────────┘           │
│  ┌─ games per day, last 30 ─────────────────────────────┐     │
│  │      ▁▂▅▃▇▄▂▁▃▅▆▇▅▃▂▄▆▇▇▅▃▂▁▂▄▅▆▇                    │     │
│  └──────────────────────────────────────────────────────┘     │
├──────────────────────────────┬────────────────────────────────┤
│  HOUSE RULES                 │  HOTEL CHAINS                  │
│  Chain safety                │  largest at game end           │
│   Aggressive ████████ 71%    │   Continental ██████ 22%       │
│   Safe at 11 ███ 18%         │   Imperial    █████  17%       │
│   Safe at 13 ██ 8%           │   Tower       ████   14%       │
│  Board  Large 88% · Small 12%│   …                            │
│  Selling  Off 63% · On 37%   │  avg final size 18.4 tiles     │
├──────────────────────────────┼────────────────────────────────┤
│  BOTS vs HUMANS              │  RECORDS                       │
│   Human  ████████ 58% wins   │   Highest score  61,400  "Ana" │
│   Hard   █████ 31%           │   Longest game   1h 52m        │
│   Medium ███ 9%              │   Most rounds    41            │
│   Easy   █ 2%                │   Largest chain  38 tiles      │
└──────────────────────────────┴────────────────────────────────┘
```

### Visual approach

- Charts with **recharts** (`^2.15.4`, already a dependency — no new packages).
- Chain bars use the existing chain colours from `CHAINS` in `src/types/game.ts`, so Continental is
  red on the dashboard exactly as it is on the board. This is the one place a categorical palette is
  already decided for us; use it rather than inventing one.
- Everything else uses existing theme tokens (`--primary`, `--muted-foreground`), no hardcoded hex.
- Reuses `Card`/`CardHeader` from `src/components/ui`, matching `GameHistory.tsx`.
- Mobile: panels stack to one column; every chart in an `overflow-x-auto` container.
- **Load the `dataviz` skill before writing the first chart component.**

### Entry point

A third button on the start page's mode card (`src/pages/Index.tsx:128-156`), below Tutorial:

```
┌──────────────────────────────────────┐
│  📊  Statistics                      │
│  See how the game is being played    │
└──────────────────────────────────────┘
```

`variant="outline"`, same 80px height and two-line shape as the Tutorial button, so it reads as a
peer and not as a promoted action. Also linked from `SiteFooter` for reachability from every page.

### Why there is no player leaderboard

`player_name` is free text typed at join time, and with account UI disabled there is no persistent
identity behind it. A "top players" table over that column would rank strings, not people, and
anyone could take the top spot by typing someone else's name. **Records** (best single game, longest
game) sidestep this: a name there is a caption on an event, not a claim about a person.

If the account UI is ever enabled, `game_result_players.user_id` is already recorded, and a real
leaderboard becomes a follow-up story with no schema change.

---

## Cold Start and Empty States

Day one: `game_results` has zero rows. Every all-time panel must render a designed empty state, not
a zero or a spinner:

> **Nothing recorded yet.** This dashboard started counting on <date of deploy>. Finished games
> appear here within a few seconds of the final score.

The live strip works immediately — it reads `game_rooms`, which has data today.

Panels additionally suppress themselves below a minimum sample:

| Panel | Minimum before showing | Below minimum |
|---|---|---|
| Live strip | none | always shown |
| Totals | 1 game | empty state |
| Activity chart | 1 game | empty state |
| House rules | 10 games | "needs 10 games — 3 so far" |
| Chains | 10 games | same |
| Bots vs humans | 20 games | same |
| Records | 1 game | shows what exists |

Publishing a 100%-Aggressive rules chart off two games would be worse than publishing nothing.

---

## User Stories

### Story 16.1 — Record completed games durably
**As** the product owner, **I want** every finished game written to storage that outlives the room,
**so that** statistics exist at all.

- New `game_results` + `game_result_players` tables, migration + `schema.sql`, idempotent.
- `server/lib/results.ts` with `recordGameResult(roomId, endReason)`, idempotent on `source_room_id`.
- Called from all seven `game_over` sites in `game-action.ts`.
- Safety net in `cleanup-rooms.ts` records any unrecorded finished game before deleting the room.
- A recording failure logs and does not fail the player's action or the cleanup pass.
- Unit tests: idempotency (double call → one row), placement ordering, bot rows, missing
  `rules_snapshot` falls back to `DEFAULT_RULES`, `game_log` with no mergers → `mergers_count = 0`.

### Story 16.2 — Point `/history` at the real data
**As** a signed-in player, **I want** `/history` to show my actual games, **so that** the page stops
lying about being empty.

- `account.ts` `list_history` reads the new tables, same response field names.
- `src/pages/GameHistory.tsx` unchanged.
- Note in the story: the page stays unreachable while `SHOW_ACCOUNT_UI = false`; this fixes the data
  path, not the navigation.

### Story 16.3 — Public stats API
**As** the dashboard, **I want** aggregate endpoints, **so that** I can render without a login.

- `server/api/stats.ts` with the eight ops, registered in `server.ts`.
- No auth. No room codes, user ids, or per-game rows for in-progress games in any response.
- 15s/60s in-process cache per op.
- Tests: each op against a seeded fixture; a response-shape test asserting no `room_code`,
  `user_id`, or `session_id` key appears anywhere in any payload.

### Story 16.4 — The dashboard page
**As** a visitor, **I want** `/dashboard`, **so that** I can see how the game is being played.

- Route added; page composed of panel components under `src/components/dashboard/`.
- Live strip refreshes every 15s with a visible "live" indicator; all-time panels every 60s.
- Empty and below-minimum states per the table above.
- Fully view-only: no button on the page mutates anything.
- Works signed-out and in a private window.
- Responsive to 360px; no horizontal page scroll.

### Story 16.5 — Entry point
**As** a visitor on the start page, **I want** an obvious way in, **so that** the page is
discoverable.

- Statistics button on `Index.tsx`, styled as a peer of Tutorial.
- Footer link in `SiteFooter.tsx`.
- Back button returns to `/`.

### Story 16.7 — Sample data and a source switch
**As** anyone opening the dashboard before real games accumulate, **I want** to see it populated,
**so that** the page can be read, reviewed and demoed at all.

- `src/data/sampleStats.ts` fabricates a month (~1,100 games) and aggregates them through the same
  shapes the API returns, so every figure agrees with every other one — the activity chart sums to
  the games total, the chain shares sum to 100%, the records are the real extremes of the set.
- Deterministic (fixed seed), except the live strip, which re-rolls every 15s so the "live"
  indicator has something to show.
- Header switch, persisted per browser, defaulting to **sample**; sample mode carries a permanent
  on-screen banner saying the games are not real, and never touches the network.

### Story 16.6 — Release
- Changelog entry in `src/data/versionHistory.ts` (minor bump, `1.6.0` off current `1.5.0` — or
  fold into `2.0.0` if Epic 14/15 ship first; the `/release` skill decides).
- **Manual migration required on deploy** — `deploy.sh` never applies `schema.sql`. Add
  `db/migrations/2026-XX-XX-epic16-game-results.sql` to the launch checklist alongside the Epic 14
  and 15 migrations.

---

## Risks and Decisions

| Risk | Mitigation |
|---|---|
| A `game_over` path added later forgets to record | Cleanup-path safety net catches it before deletion |
| Recording throws and breaks the final move of a game | Wrapped in try/catch, logged, swallowed — never blocks a player action |
| First unauthenticated endpoint becomes an abuse surface | Read-only ops, 60s cache, aggregates only, response-shape test forbidding identifiers |
| Dashboard looks broken because it is empty | Designed empty states + minimum-sample gates, with a "counting since <date>" line |
| `rules_snapshot` is v1-shaped on old rows | Pass through the existing v1→v2 normaliser at record time, so the table only ever holds v2 |
| Stats queries slow down as rows accumulate | Indexed on `ended_at`; all queries bounded by date range; cache absorbs repeat load |
| Scope creep into a spectator view | Explicitly out of scope; live strip is counts only and links nowhere |

### Open questions

1. **Retention.** Keep `game_results` forever, or roll up to daily aggregates after a year? Forever
   is fine for the foreseeable volume; flagging it so the decision is deliberate.
2. **Bots in the totals.** Should a 1-human/3-bot game count as a "game played" in the headline
   number? Proposal: yes in totals, and the bot panel gives the honest breakdown. Alternative is a
   "human games only" toggle — deferred.
3. **`app_version`.** Worth recording so we can see whether a rules change moved behaviour. Cheap to
   add now, impossible to add retroactively. Proposal: include it.
