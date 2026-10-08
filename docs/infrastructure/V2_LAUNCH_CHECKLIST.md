# v2.0.0 Launch Checklist

The checklist the Epic 14 to 18 docs refer to. It covers what ships, the database
migration, how to test against real data, and the release itself.

**Created:** 2026-10-08 · **Integration branch:** `claude/tender-meitner-s1waeq`
(PR into `epic/v2.0.0`)

---

## 1. What ships in v2.0.0

| Ships | Source | Notes |
|---|---|---|
| End-game declaration | Epic 18 | Needs its migration **before** the deploy, or no game can end |
| Power cards (room rule, off by default) | Epic 17 | |
| Live statistics dashboard at `/dashboard` | Epic 16 | Empty on launch day, fills from then on |
| Simpler room creation, host can reorder seats, editable rules | Epic 15 | |
| Reworked bots (three distinct difficulties) | bot rework | |
| `/local-preview` skills | tooling | |

| Does **not** ship | Why |
|---|---|
| Stock selling (Epic 14) | Built, but held back by `RELEASED.stockSelling = false` in `src/types/rules-normalize.ts`. Every rules blob is forced to `stockSelling: 'off'`, the switch is hidden, and the server rejects `sell_stocks`. Its **migration still has to run**: the engine resets its per-turn counters on every turn and the views select its columns. |
| Event cards | Dropped. The study lives only on `event-cards-evaluation`. |

---

## 2. Back up production first

There is no automated backup (see DEPLOYMENT.md, *Known gaps*). Take one by hand
right before migrating. The container's own `pg_dump` matches the server version
(Postgres 18):

```bash
ssh hetzner "docker exec a8ws9g5d9w9j1rhz2lfx73k2 pg_dump -U postgres -d postgres -Fc" \
  > hotelgame-prod-pre-v2-$(date +%F).dump
ls -lh hotelgame-prod-pre-v2-*.dump      # must not be 0 bytes
```

Keep this file off the repo (it holds every account and game). It is also the
input for the "real data" test in section 4.

---

## 3. The migration

### 3.1 Facts

- **Five files**, all in `db/migrations/`. Nothing applies them automatically:
  not a deploy, not a restart.
- **Additive only.** New columns with defaults, two new tables, recreated views,
  one widened constraint, one backfill. No column is dropped or renamed and no
  existing data is changed, apart from filling in `game_rooms.host_user_id`.
- **Idempotent.** Every file is safe to run twice.
- **v1.5.0 keeps working on the migrated database.** Tested: a v1.5.0 backend
  created a room, added bots and started a game on a fully migrated copy. So the
  migration can run hours or days before the deploy.
- **The order matters.** `epic17` must run **last**, after `epic18`. Both
  recreate `game_states_public`, and only `epic17`'s version has every column.

### 3.2 Order and what each file does

| # | File | Adds | Must be in before the deploy? |
|---|---|---|---|
| 1 | `2026-08-30-epic14-stock-selling.sql` | `game_states.stocks_sold_this_turn`, `chains_bought_this_turn`; recreates `game_states_public` | **Yes**, the engine writes these columns every turn |
| 2 | `2026-08-30-epic15-host-and-turn-order.sql` | `game_rooms.host_user_id` (backfilled from seat 0), `turn_order_mode`, its check constraint and index | **Yes**, hosting is decided by this column |
| 3 | `2026-08-31-epic16-game-results.sql` | Tables `game_results` and `game_result_players` | **Yes**, `epic18` alters `game_results` |
| 4 | `2026-09-06-epic18-end-declaration.sql` | `game_states.end_declared_by`, `end_condition_round`; widens `valid_end_reason`; recreates `game_states_public` | **Yes, blocking**: without it no game can end |
| 5 | `2026-09-06-epic17-power-cards.sql` | `game_players.power_cards`, `game_states.active_power_card`, `tiles_placed_this_turn`; recreates both public views | **Yes**, the engine counts placed tiles every turn |

Some of the file headers call `epic14` to `epic17` "deferrable". With the v2.0.0
code they are not: treat all five as required.

### 3.3 Run it

From the repo root on your machine:

```bash
# 0. Before: every row should say MISSING
ssh hetzner "docker exec -i a8ws9g5d9w9j1rhz2lfx73k2 psql -U postgres -d postgres" \
  < db/migrations/verify-v2.0.0.sql

# 1. Apply, in this exact order. ON_ERROR_STOP aborts a file on its first error.
for f in \
  2026-08-30-epic14-stock-selling \
  2026-08-30-epic15-host-and-turn-order \
  2026-08-31-epic16-game-results \
  2026-09-06-epic18-end-declaration \
  2026-09-06-epic17-power-cards
do
  echo "== $f"
  ssh hetzner "docker exec -i a8ws9g5d9w9j1rhz2lfx73k2 psql -v ON_ERROR_STOP=1 -U postgres -d postgres" \
    < "db/migrations/$f.sql" || { echo "STOPPED at $f"; break; }
done

# 2. After: all 17 rows should say ok
ssh hetzner "docker exec -i a8ws9g5d9w9j1rhz2lfx73k2 psql -U postgres -d postgres" \
  < db/migrations/verify-v2.0.0.sql
```

`NOTICE: ... already exists, skipping` lines are expected. An `ERROR` line is
not: the loop stops there, and since every file is idempotent you can fix the
cause and run the whole loop again.

### 3.4 If verify shows something other than ok

| Row | Fix |
|---|---|
| `game_states_public.tile_bag_count` or `game_players_public.power_cards` MISSING | `epic18` ran after `epic17`. Re-run `epic17` alone. |
| `every room with players has a host` says *re-run the epic15 file* | Rooms were created by v1.5.0 after the migration. Re-run `epic15` (it only fills empty hosts). **Do this once more right after the deploy** in any case. |
| Anything else MISSING | Re-run the loop from 3.3. |

Rehearsed on 2026-10-08 against the v1.5.0 schema with seeded rooms: all five
files applied, a second run changed nothing, the result matched a fresh
v2.0.0 `db/schema.sql` exactly, and both hazards above were reproduced and fixed
as described.

---

## 4. Testing v2.0.0 against real data

### Option A (recommended): a local copy of production

You get real accounts, rooms and history, and a dry run of the migration,
without any risk to the live site. Needs Docker Desktop.

```bash
# 1. Fresh Postgres 18 (same major version as production), loopback only
docker run -d --name hotelgame-prodcopy -p 127.0.0.1:55433:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18-alpine
sleep 5

# 2. Load the backup from section 2
docker exec -i hotelgame-prodcopy pg_restore -U postgres -d postgres --no-owner \
  < hotelgame-prod-pre-v2-YYYY-MM-DD.dump

# 3. Rehearse the migration on the copy: same loop as 3.3, against the copy
for f in 2026-08-30-epic14-stock-selling 2026-08-30-epic15-host-and-turn-order \
         2026-08-31-epic16-game-results 2026-09-06-epic18-end-declaration \
         2026-09-06-epic17-power-cards; do
  docker exec -i hotelgame-prodcopy psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
    < "db/migrations/$f.sql" || { echo "STOPPED at $f"; break; }
done
docker exec -i hotelgame-prodcopy psql -U postgres -d postgres < db/migrations/verify-v2.0.0.sql
```

4. Point the local preview at the copy. In `.env.preview.local` (gitignored,
   created by the first `/local-preview` run) change one line:

   ```
   DATABASE_URL=postgres://postgres@127.0.0.1:55433/postgres
   ```

   The preview's loopback guard accepts this, because it is `127.0.0.1`.
5. Run `/local-preview` and play at http://localhost:5173. Logging in with a
   real account and password works. Old sessions do not carry over, because the
   local JWT secret differs from production's.
6. Afterwards, set `DATABASE_URL` back to
   `postgres://postgres@127.0.0.1:55432/acquire` and remove the copy with
   `docker rm -f hotelgame-prodcopy`.

### Option B: the live production database

Possible, but every action is real. Only do it **after** section 3, because
v2.0.0 code fails against an unmigrated database.

The database has no public port, so it goes through an SSH tunnel:

```bash
# Find the container's internal IP
ssh hetzner "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' a8ws9g5d9w9j1rhz2lfx73k2"

# Keep this running in its own terminal
ssh -N -L 55434:<that-ip>:5432 hetzner
```

The password is in Coolify (the database resource's configuration, or the app's
`DATABASE_URL` environment variable). Then in `.env.preview.local`:

```
DATABASE_URL=postgres://postgres:<password>@127.0.0.1:55434/postgres
```

What to know before you do this:

- **Test games become permanent statistics.** Every finished game writes to
  `game_results`, which the public dashboard reads. To remove them afterwards,
  note the time you started and run
  `DELETE FROM game_results WHERE ended_at >= '<start time>';`
  (players are removed with them through `ON DELETE CASCADE`).
- **Two servers, one database.** Realtime events stay inside each server, so
  never open the same room from localhost and from hotelgame.jonashapp.com.
  Your local backend also runs the idle-room cleanup against production. It uses
  the same rules as production, so it only closes rooms that would close anyway.
- **Never commit `.env.preview.local`.** It is gitignored; keep it that way.
- Switch `DATABASE_URL` back and close the tunnel when you are done.

---

## 5. Release steps

1. [ ] Review and merge the integration PR into `epic/v2.0.0`.
2. [ ] Test: section 4, option A. At least one full game with power cards on,
       one declared end, and one look at `/dashboard` in Live mode.
3. [ ] Epic 15 playtest with two browsers (two humans in one room, reorder
       seats, edit rules before start).
4. [ ] PR `epic/v2.0.0` → `staging`, CI green, merge.
5. [ ] **Back up** (section 2) and **migrate** production (section 3). Verify
       shows 17 × ok.
6. [ ] PR `staging` → `main`. Merging deploys through Coolify.
7. [ ] Right after the deploy: re-run `epic15` once (fills hosts of rooms v1.5.0
       created in between) and run verify again.
8. [ ] Smoke test on https://hotelgame.jonashapp.com: `/health`, create a room,
       add bots, finish a game, check `/dashboard`.
9. [ ] Before step 6, update the changelog date in `src/data/versionHistory.ts`
       if the release day is not 2026-10-08. No tag by hand: `deploy.yml` tags
       `main` after the health check passes.

## 6. Rolling back

The code can roll back on its own; the database does not need to.

- Redeploy v1.5.0 in Coolify (*hotelgame* → **Deployments** → the last v1.5.0
  build → **Redeploy**). v1.5.0 runs fine on the migrated schema.
- Do **not** undo the migrations. The extra columns and tables are ignored by
  v1.5.0, and keeping them means the next v2 attempt needs no migration.
- Games played on v1.5.0 during a rollback are not recorded in `game_results`,
  and rooms it creates have no host. Re-run `epic15` before rolling forward.
- Restoring the backup is for real data loss only. It throws away everything
  played since the dump was taken.
