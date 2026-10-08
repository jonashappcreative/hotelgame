# Epic: Simplify Custom Rules & Room Creation

**Epic ID:** Epic 15
**Feature:** Lobby UX overhaul + custom-rules data model simplification
**Priority:** High
**Created:** 2026-08-30
**Branch:** `feature/simplify-rules-and-room-creation`
**Status:** Implemented — pending the manual DB migration and two-browser playtest

---

## Executive Summary

Creating a room today asks the host to answer a question they cannot answer yet ("how many players?"),
hides every rule behind an 8-switch wall of equal-weight toggles, and then freezes those rules
permanently the moment the room exists. Underneath, the rules themselves are modelled as 19
stringly-typed fields in which "disabled" means something different for every rule — and in one case
means the opposite of what the UI claims.

This epic does three things at once, because they are the same problem seen from two ends:

1. **Reshapes the room-creation flow** — name only, no player count, rules are the primary action, and
   the room is created by confirming them.
2. **Splits rules into Basic and Advanced** and deletes the `*Enabled` boolean layer entirely, so a
   rule is just a value with a default.
3. **Makes the lobby a real waiting room** — seats and rules side by side, host can reorder players
   (randomly or by dragging), and rules stay editable until the game starts.

---

## Problems This Solves

| # | Problem | Evidence |
|---|---|---|
| 1 | Host must fix the player count before anyone has joined | `OnlineLobby.tsx:493-516`; a 6-seat room can never start with 4 humans unless bots fill the rest (`game-action.ts:210`) |
| 2 | Rules are write-once — a mistake costs a full room recreate and code re-share | No `update_rules` op exists in `server/api/rooms.ts` |
| 3 | All 8 rules presented as equally important, no basic/advanced split, no defaults guidance | `OnlineLobby.tsx:564-932` |
| 4 | **Chain safety default is a live bug**: rule off ⇒ *no chain is ever safe*, but the lobby prints "🛡 Safe at 11+" | `rules.ts:91` returns `null` when disabled, vs `OnlineLobby.tsx:36` |
| 5 | `startingConditionsEnabled` is inert — the engine reads cash/tiles unconditionally; the flag only gates the UI | `game-action.ts:229-249` |
| 6 | No server-side validation — `body.customRules` is stringified into JSONB verbatim; bad values become `NaN` | `rooms.ts:47` |
| 7 | `CustomRules` + `DEFAULT_RULES` duplicated in two hand-synced files | `src/types/game.ts:175` / `server/lib/rules.ts:37` |
| 8 | Chain Founding tooltip promises a "founder free stock" toggle that is not rendered | `OnlineLobby.tsx:808` |
| 9 | `OnlineLobby.tsx` is 1024 lines holding 5 screens | — |
| 10 | Player seating order is insertion order — no shuffle, no host control | `rooms.ts:290-315` |
| 11 | **Host identity is seat 0** — host privilege is derived from `player_index`, so the host cannot move in the turn order | `rooms.ts:54`, `:107`, `:165`, `useOnlineGame.ts:679` |
| 12 | **`myPlayerIndex` is cached at join and never re-derived** — it gates every turn action, so any reseat silently breaks the client | `useOnlineGame.ts:54,191,218,632` vs `:355-614` |

Problem 4 is the important one. Every default room today advertises standard Acquire and plays a
variant where chains can be swallowed at any size. This epic resolves it **by adopting the current
behaviour as the spec** — Aggressive (no safe chains) becomes the honest, labelled default — so no
in-flight game changes and the UI stops lying.

---

## Out of Scope

- The board, the game screen, and anything after the game starts.
- `cashVisibility` remains cosmetic (server still ships all cash in `game_players_public`). Making it
  genuinely secret is a separate security story.
- The Join Room flow keeps its current two-field shape.
- Local hot-seat `Lobby.tsx` (unreachable dead code) is left alone.

---

## Part 1 — The New Rules Model

### The change in one sentence

Delete every `*Enabled` boolean. A rule is a **value**; "off"/"standard" is one of its values.

### New `CustomRules` (v2)

```ts
// src/types/game.ts — single source of truth, re-exported by the server
export interface CustomRules {
  // ---- Basic ----
  boardSize: 'large' | 'small';                       // 'large' = 9×12, 'small' = 6×10
  stockSelling: 'off' | '100' | '90' | '75' | '50';   // percent of market price the bank pays
  chainSafety: 'none' | '9' | '11' | '13' | '15';     // 'none' = Aggressive, no safe chains

  // ---- Advanced ----
  turnTimer: 'off' | '30' | '60' | '90';
  disableTimerFirstRounds: boolean;
  cashVisibility: 'visible' | 'hidden' | 'aggregate';
  bonusTier: 'standard' | 'flat' | 'aggressive';
  maxChains: '5' | '6' | '7';
  startingCash: '4000' | '6000' | '8000';
  startingTiles: '5' | '6' | '7';
  startWithTileOnBoard: boolean;
}

export const DEFAULT_RULES: CustomRules = {
  boardSize: 'large',
  stockSelling: 'off',
  chainSafety: 'none',
  turnTimer: 'off',
  disableTimerFirstRounds: true,
  cashVisibility: 'visible',
  bonusTier: 'standard',
  maxChains: '7',
  startingCash: '6000',
  startingTiles: '6',
  startWithTileOnBoard: true,
};
```

**19 fields → 11.** Every field is a discriminated union, so an illegal value is now a type error at
compile time and a rejected request at runtime.

### Defaults that change

| Rule | Old effective default | New default | Why |
|---|---|---|---|
| Chain safety | `null` (no safe chains) while UI said "Safe at 11+" | `'none'` — **Aggressive**, labelled honestly | Adopts real behaviour; fixes problem 4 with zero gameplay change |
| Cash visibility | `hidden` | `visible` | Product decision — negotiation over mystery |
| Stock selling | off | off (unchanged) | — |
| Everything else | unchanged | unchanged | — |

### Rules that merge two fields into one

- `stockSellingEnabled` + `sellPriceFactor` → **`stockSelling`**. The Basic screen renders a Switch
  bound to `value !== 'off'`, writing `'off'` ⇄ `'75'`. The Advanced screen renders the full 5-option
  Select. One field, two levels of detail.
- `turnTimerEnabled` + `turnTimer` → **`turnTimer`**, with `'off'` as a value.
- `chainSafetyEnabled` + `chainSafetyThreshold` → **`chainSafety`**.
- `boardSizeEnabled` + `boardSize` → **`boardSize`** as a Small/Large switch.
- `cashVisibilityEnabled`, `bonusTierEnabled`, `chainFoundingEnabled`, `startingConditionsEnabled` are
  **deleted outright** — their value fields already encode "standard".

### Board-size ⇄ maxChains coupling (retained, simplified)

Selecting `boardSize: 'small'` coerces `maxChains` to `'5'`. Enforced in exactly **two** places, as
today: the rules form on change, and `game-action.ts` at game start. The condition loses its
`chainFoundingEnabled` clause — it is now simply `if (rules.boardSize === 'small' && rules.maxChains === '7') rules.maxChains = '5'`.

### Legacy normalisation — `normalizeRules()`

`game_rooms.custom_rules` and `game_states.rules_snapshot` are schemaless JSONB, so **no DB migration
is required**. Instead, one adapter converts v1 blobs on read.

The rule for writing it: **map by observed behaviour, not by new defaults.** An in-flight game must not
change how it plays.

```ts
// src/types/rules-normalize.ts — used by both engines
export function normalizeRules(raw: unknown): CustomRules {
  // v2 blobs pass through validation; v1 blobs are translated:
  //   chainSafetyEnabled:false        -> chainSafety: 'none'      (matches old runtime behaviour)
  //   chainSafetyEnabled:true         -> chainSafety: threshold
  //   cashVisibilityEnabled:false     -> cashVisibility: 'hidden' (NOT the new 'visible' default)
  //   bonusTierEnabled:false          -> bonusTier: 'standard'
  //   boardSizeEnabled:false          -> boardSize: 'large'; '9x12'->'large', '6x10'->'small'
  //   chainFoundingEnabled:false      -> maxChains: '7'
  //   turnTimerEnabled:false          -> turnTimer: 'off'
  //   stockSellingEnabled:false       -> stockSelling: 'off', else sellPriceFactor
  //   startingCash/Tiles/startWithTileOnBoard -> copied verbatim (they were always read unconditionally)
  // Unknown or missing keys fall back to DEFAULT_RULES.
}
```

Note the two deliberate asymmetries: legacy chain-safety-off maps to `'none'` (the old *behaviour*),
and legacy cash-visibility-off maps to `'hidden'` (the old default, not the new one).

### Server-side validation

A single `validateRules(raw): { ok: true, rules } | { ok: false, errors }` built from an explicit
allowlist per field, called at the two write boundaries: `rooms.ts` `op:'create'` and the new
`op:'update_rules'`. Invalid values are rejected with 400 rather than silently becoming `NaN`.

---

## Part 2 — The New Room-Creation Flow

### Before → After

| Step | Today | After this epic |
|---|---|---|
| 1 | Menu → Create Room | unchanged |
| 2 | Name + **Number of Players** + Create Room + Set Custom Rules | **Name only**, primary button = **Set Rules** |
| 3 | (optional) 8-switch rules wall → Confirm → back to step 2 | Rules screen: **Basic** always visible, **Advanced Rules** tertiary button reveals the rest |
| 4 | Click Create Room | **Confirm Rules creates the room** |
| 5 | Waiting room: fixed N seats, rules read-only | Seats + rules **side by side**, host can **Edit Rules** and **reorder players** |
| 6 | Starts when N seats full and all ready | Starts when **≥2 players and all humans ready** |

### Screen 1 — Create a Room

Contains exactly: `Your Name` input (maxLength 20), the active-game rejoin banner, and one primary
button **Set Rules** (disabled while the name is empty). The player-count RadioGroup is deleted.

### Screen 2 — Game Rules

**Basic Rules** — always visible, three controls:

| Control | Type | Options | Default |
|---|---|---|---|
| Board Size | Switch (Small / Large) | `small` · `large` | **Large** |
| Allow Selling | Switch | on ⇒ `'75'`, off ⇒ `'off'` | **Off** |
| Chain Safety Threshold | Select | Aggressive — no safe chains · 9 · 11 · 13 · 15 tiles | **Aggressive** |

**Advanced Rules** — hidden behind a tertiary `Advanced Rules` button (disclosure, not a new screen):

| Control | Type | Options | Default |
|---|---|---|---|
| Turn Timer | Select | Off · 30s · 60s · 90s | **Off** |
| ↳ Disable for first 2 rounds | Switch (only when timer ≠ off) | — | On |
| Sell Price | Select (only when selling on) | 100% · 90% · 75% · 50% | 75% |
| Cash Visibility | Select | Visible to all · Hidden · Aggregate total | **Visible to all** |
| Bonus Tier | Select | Standard 10x/5x · Flat · Aggressive 15x/5x | **Standard** |
| Max Chains | Select | 7 · 6 · 5 | **7** (forced to 5 on small board) |
| Starting Cash | Select | $4,000 · $6,000 · $8,000 | **$6,000** |
| Starting Tiles | Select | 5 · 6 · 7 | **6** |
| Place Starting Tile | Switch — **its own top-level setting** | — | **On** |

Primary button: **Confirm Rules** → creates the room and navigates to the waiting room. The name is
already known, the player count no longer exists, so this is the only commit point. The
"Discard Custom Rules?" AlertDialog on back-navigation is removed — nothing is lost, because backing
out from here means abandoning room creation entirely.

### Screen 3 — Waiting Room

Two columns side by side (stacked on mobile):

**Left — Players**
- Host at seat 1, then every joined player, then **exactly one** `Waiting…` placeholder while
  `players.length < 6`. No more rendering 6 empty slots.
- Host-only: drag handle on each row to reorder, plus a **Shuffle** button for random order.
- Host-only: bot difficulty Select + `Add Bot`, available while `players.length < 6`.
- Ready / Not Ready badges, `You` badge, bot remove ✕ — as today.

**Right — Room Rules**
- The active rules, rendered from a **single shared summary renderer** (see Story 15.4) rather than
  the three hardcoded copies that exist now.
- Host-only **Edit Rules** button → the same Basic/Advanced form, in `update` mode, live until the
  game starts.

Bottom bar: room code + copy, `Leave`, `Ready Up` / `Cancel Ready`, and the status line.

---

## Part 3 — Start Condition (design decision)

Removing the fixed player count breaks the current start condition
(`freshPlayers.length === room.max_players && all ready`, `game-action.ts:210`).

**Recommended rule:**

> The game starts when there are **at least 2 players** and **every human player is ready**.
> Whenever a player or bot **joins or leaves, all ready flags reset to false.**

The reset is what makes this safe. "Ready" then means *"ready to play with exactly this group"*, which
removes the race where a 6th player joins in the instant the other five have readied, and it needs no
new button or host privilege. Once the start condition is met the room flips to `playing` and further
joins are rejected by the existing status check.

`game_rooms.max_players` is **kept** (the `CHECK (2..6)` constraint stays) but is now a pure capacity
value, always created as `6`. The rules model needs no migration; Part 4 adds one for host identity
and turn order.

> **Alternative if playtesting dislikes the reset:** a host-only `Start Game` button, enabled at ≥2
> ready players. More control, one more click, and it makes the host a single point of failure if they
> disconnect. Recommendation stands with the auto-start; revisit after play.

---

## Part 4 — Host Identity, Player Order & Turn-Order Randomisation

### 4a. Host identity is decoupled from the seat

Today host privilege *is* seat 0 — four sites derive it from `player_index`:

| Site | What it gates |
|---|---|
| `rooms.ts:54` | the active-room limit (counts rooms you host) |
| `rooms.ts:107` | `add_bot` |
| `rooms.ts:165` | `remove_bot` |
| `useOnlineGame.ts:679` | `isHost` in the client |

This is what forces the host to stay first. Replace it with an explicit owner column:

```sql
-- db/migrations/2026-08-30-epic15-host-and-turn-order.sql
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS host_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS turn_order_mode VARCHAR(10) NOT NULL DEFAULT 'random'
  CHECK (turn_order_mode IN ('random', 'manual'));

-- backfill existing rooms: today's host is whoever sits at seat 0
UPDATE game_rooms gr
   SET host_user_id = gp.user_id
  FROM game_players gp
 WHERE gp.room_id = gr.id AND gp.player_index = 0 AND gr.host_user_id IS NULL;
```

> ⚠️ **This migration must be applied by hand.** `deploy.sh` never runs `schema.sql` or the migrations
> directory. It joins the Epic 14 migration already queued for the v2.0.0 launch — see the launch
> checklist. Both are additive and safe to run against a live DB.

All four sites become `room.host_user_id === userId`. The client learns its host status from the room
payload rather than inferring it, so `isHost` survives any reseat.

**Host departure:** if the host leaves a `waiting` room, transfer `host_user_id` to the
earliest-joined remaining human (`ORDER BY created_at`). A room must never be left hostless.

### 4b. Turn order: Random (default) or Custom

A segmented control in the waiting room, host-only, backed by `game_rooms.turn_order_mode`:

**Random** — the default.
- The player list shows join order, but seat numbers are replaced by a `•` and a note:
  *"Turn order is randomised when the game starts."*
- Dragging is disabled — there is nothing meaningful to arrange.
- At game start the server shuffles all seats, host included.

**Custom** — the host arranges the order by hand.
- Rows become draggable (host only) and seat numbers become real.
- A **Shuffle** button randomises the custom order *immediately and visibly*, still editable
  afterwards. This is the "shuffle and look at it" affordance, distinct from Random's
  invisible shuffle at start.
- The host can drag themselves anywhere, including last.

Switching Random → Custom seeds the custom order from the current list. Switching back discards it.

### 4c. Implementation notes

- **Drag and drop:** `Reorder` from **framer-motion**, already a dependency (`^11.18.2`). No new package.
- **`set_player_order` op** (`server/api/rooms.ts`): host-only, `status === 'waiting'` only, body is the
  full ordered array of `game_players.id`. Validate that the id set exactly matches the room's current
  players — reject partial, duplicated or foreign lists. Sets `turn_order_mode = 'manual'`.
- **`set_turn_order_mode` op:** host-only, waiting-only, `'random' | 'manual'`.
- **Reindexing collides with `unique_player_per_room UNIQUE (room_id, player_index)`.** Every reseat —
  manual reorder *and* the start-time shuffle — must run a **two-phase update inside one transaction**:
  first offset every row to a negative index (`player_index = -1 - n`), then write the final indices.
  Extract this as one `reindexPlayers(roomId, orderedIds)` helper and use it for both paths.
- **Start-time shuffle** happens in the `toggle_ready` start branch of `game-action.ts`, **before**
  cash and tiles are dealt (`:269-274`) — the dealing loop iterates players in seat order, so
  shuffling afterwards would deal the wrong hands.
- Broadcast `game:players_changed` after any reseat.

### 4d. Prerequisite: `myPlayerIndex` must be derived, not cached

This is the blocking risk in the whole epic. `useOnlineGame.ts` sets `myPlayerIndex` **once** from the
join/create/rejoin response (`:191`, `:218`, `:632`) and never recomputes it — yet it gates *every*
turn action in the hook (`:355`–`:614`, ~15 guards of the form
`gameState.currentPlayerIndex !== myPlayerIndex`). The moment seats are reindexed, every client holds a
stale index: players would act as the wrong seat, or be locked out of their own turn entirely.

The fix is small and already half-built. `rooms.ts` `get_players` (`:223-241`) *already* resolves the
caller server-side (`.eq('user_id', userId)`) to filter tiles — it simply doesn't return the index.
Return it, and have the client re-derive `myPlayerIndex` on every player refresh instead of trusting
the value it cached at join.

**This must ship before any reseating story.**

## User Stories

### Foundation

**Story 15.0 — Derive `myPlayerIndex` instead of caching it** *(blocking prerequisite for 15.9/15.10)*
Return the caller's index from `rooms.ts` `get_players` (it already resolves the caller to filter
tiles) and re-derive `myPlayerIndex` in `useOnlineGame.ts` on every player refresh, replacing the
value cached at `:191`, `:218`, `:632`.
- ✅ `myPlayerIndex` updates whenever the player list changes
- ✅ Forcing a seat reindex in the DB mid-session leaves the client acting as the correct player
- ✅ All ~15 `currentPlayerIndex !== myPlayerIndex` guards still gate correctly
- ✅ Rejoin after a reseat lands on the right seat

**Story 15.1 — Rules model v2 + normaliser + validation**
Define v2 `CustomRules`/`DEFAULT_RULES` in `src/types/game.ts` as the single source of truth; have
`server/lib/rules.ts` **import** them instead of re-declaring, deleting the hand-sync comment. Add
`normalizeRules()` and `validateRules()`. Update the rule getters (`getSafeChainSize`,
`getBoardDimensions`, `getEligibleChains`, `getBonusTier`, `getSellPriceFactor`) to read v2 fields.
- ✅ `getSafeChainSize` returns `null` only for `chainSafety === 'none'`
- ✅ `getSellPriceFactor` returns `0` only for `stockSelling === 'off'`
- ✅ A v1 blob normalises to a v2 blob that plays identically
- ✅ `validateRules` rejects out-of-range values with 400, not `NaN`
- ✅ `DEFAULT_RULES` exists in exactly one file

**Story 15.2 — Wire normalisation through both engines**
Apply `normalizeRules` at every read of `custom_rules` / `rules_snapshot`:
`game-action.ts:221`, `multiplayerService.ts:401-434`, `server/lib/bot.ts:48-49`,
`rooms.ts:196-197`, `gameLogic.ts:149`.
- ✅ An existing pre-epic room started before deploy still plays with its original rules
- ✅ Bot decisions read the same normalised rules as the engine

**Story 15.3 — Lobby API ops: `update_rules`, `set_player_order`, `set_turn_order_mode`**
All host-only, all `status === 'waiting'` only, all validated, all followed by a
`game:players_changed` / `room:status_changed` broadcast. Includes the shared
`reindexPlayers(roomId, orderedIds)` helper.
- ✅ A non-host calling any of them gets 403
- ✅ Calling any of them on a `playing` room gets 409
- ✅ `reindexPlayers` never violates `unique_player_per_room` (two-phase, one transaction)
- ✅ `set_player_order` rejects a list that is not exactly the room's current players
- ✅ Host privilege is unaffected by any reorder

**Story 15.4 — Shared rules summary renderer**
One `describeRules(rules): {label, value}[]` in a shared module, replacing the three hardcoded copies
and the stale fallback strings in `getActiveRulesSummary` (`OnlineLobby.tsx:33-43`).
- ✅ Summary is derived from `DEFAULT_RULES`, never hardcoded
- ✅ A room with default rules shows "Aggressive — no safe chains", not "Safe at 11+"

### UI

**Story 15.5 — Split `OnlineLobby.tsx`**
Extract into `src/components/lobby/`: `LobbyMenu`, `CreateRoomScreen`, `JoinRoomScreen`,
`RulesForm` (Basic + Advanced disclosure, reused by create *and* edit), `WaitingRoom`,
`PlayerList`, `RoomRulesPanel`. `OnlineLobby.tsx` becomes a thin router.
- ✅ No file over ~250 lines
- ✅ `RulesForm` takes `mode: 'create' | 'edit'` and is the only rules form in the codebase
- ✅ `[DEBUG UI]` console.logs removed

**Story 15.6 — Create flow: name only, rules create the room**
- ✅ Create screen shows name + `Set Rules` only; no player count anywhere
- ✅ `Confirm Rules` creates the room with `max_players: 6`
- ✅ `onCreateRoom` signature drops its `maxPlayers` argument
- ✅ Empty name blocks `Set Rules`

**Story 15.7 — Basic / Advanced rules form**
- ✅ Basic shows exactly Board Size, Allow Selling, Chain Safety
- ✅ `Advanced Rules` tertiary button discloses the remaining 8 controls
- ✅ Small board coerces Max Chains to 5 in the form and again server-side
- ✅ Place Starting Tile is a top-level switch, not nested
- ✅ The phantom "founder free stock" tooltip copy is corrected

**Story 15.8 — Waiting room: side-by-side layout, dynamic seats, edit rules**
- ✅ Players and Rules render as two columns ≥ md, stacked below
- ✅ Exactly one `Waiting…` placeholder appears while under 6 players
- ✅ Host sees `Edit Rules`; non-hosts see the read-only panel
- ✅ Edited rules appear for every player without a manual refresh

**Story 15.9 — Host identity decoupled from seat**
Add `host_user_id` + `turn_order_mode` via the manual migration; switch all four derivation sites
(`rooms.ts:54`, `:107`, `:165`, `useOnlineGame.ts:679`) to `host_user_id === userId`; transfer host on
host departure.
- ✅ Host keeps every host control from any seat, including last
- ✅ The active-room limit still counts only rooms the user hosts
- ✅ Host leaving a waiting room transfers host to the earliest-joined remaining human
- ✅ Existing rooms are backfilled from seat 0 by the migration

**Story 15.10 — Turn order: Random default + Custom drag/shuffle**
- ✅ Random is the default; the list shows a `•` and "randomised when the game starts", no dragging
- ✅ Server shuffles all seats at game start, host included, *before* dealing cash and tiles
- ✅ Custom enables dragging and real seat numbers; the host can drag themselves anywhere
- ✅ Shuffle in Custom mode randomises visibly and the result stays editable
- ✅ Non-hosts see the order and mode but cannot change either
- ✅ Final seat order is the turn order in the started game

**Story 15.11 — Dynamic start condition**
- ✅ Game starts at ≥2 players with all humans ready
- ✅ Any join or leave resets all ready flags
- ✅ A 3-human room starts without adding bots
- ✅ Bots still count as always-ready

---

## Risks

| Risk | Mitigation |
|---|---|
| A live game started pre-deploy reads a v1 snapshot | `normalizeRules` maps by behaviour, not by new defaults; covered by Story 15.2 tests |
| Cash visibility default flips to `visible` — legacy rooms must not change | Legacy `cashVisibilityEnabled:false` maps to `'hidden'`, not the new default |
| Ready-reset-on-join feels noisy in a busy lobby | Flagged as a playtest item; host `Start Game` button is the documented fallback |
| Reorder collides with the unique seat constraint | One shared two-phase `reindexPlayers` helper, used by both the manual reorder and the start-time shuffle |
| **Stale cached `myPlayerIndex` after any reseat** — players act as the wrong seat or lose their turn | Story 15.0 ships first and derives it from the player list; 15.9/15.10 are blocked on it |
| Host status lost or duplicated when seats move | `host_user_id` is an explicit column, never derived from `player_index`; migration backfills from seat 0 |
| **The migration is not applied automatically** — `deploy.sh` never runs `schema.sql` | Both statements are `IF NOT EXISTS`/idempotent; add to the v2.0.0 launch checklist beside the Epic 14 migration |
| Start-time shuffle runs after dealing, giving players the wrong hands | Shuffle before the dealing loop at `game-action.ts:269-274`; covered by a test asserting hand↔seat alignment |

---

## Verification

```bash
psql "$DATABASE_URL" -f db/migrations/2026-08-30-epic15-host-and-turn-order.sql   # manual, once
npx vitest run                 # unit: rules v2, normalizeRules, validateRules, settleSale
npm run build                  # type-level proof the *Enabled fields are gone everywhere
cd server && npm run build     # backend compile — also proves the shared src/types import resolves
npm run lint
```

**Status of the automated gates (2026-08-30):** 385 tests pass, both TypeScript
projects compile, `npm run lint` reports 0 errors. The manual migration and the
two-browser walkthrough below are still outstanding.

### What shipped where

| Story | Landed in |
|---|---|
| 15.0 | `rooms.ts` (`list_players` / `get_players` return `myPlayerIndex`), `useOnlineGame.ts` re-derives it on every roster refresh |
| 15.1 | `src/types/game.ts` (v2 model), `src/types/rules-normalize.ts` (normalise + validate + getters), `server/lib/rules.ts` now re-exports them |
| 15.2 | `game-action.ts`, `bot.ts`, `rooms.ts`, `multiplayerService.ts`, `gameLogic.ts` |
| 15.3 | `rooms.ts` (`update_rules`, `set_player_order`, `set_turn_order_mode`), `server/lib/players.ts` (`reindexPlayers`) |
| 15.4 | `src/types/rules-describe.ts` |
| 15.5 | `src/components/lobby/` (10 files), `OnlineLobby.tsx` is now a 209-line router |
| 15.6 | `CreateRoomScreen.tsx`, `RulesForm.tsx`, `createRoom()` dropped its `maxPlayers` argument |
| 15.7 | `RulesForm.tsx` + `AdvancedRules.tsx` |
| 15.8 | `WaitingRoom.tsx`, `PlayerList.tsx`, `RoomRulesPanel.tsx` |
| 15.9 | migration + `schema.sql`; all host checks now read `host_user_id` (including `new_game` and `update_room_status`, which the spec had missed) |
| 15.10 | `PlayerList.tsx` (framer-motion `Reorder`), start-time shuffle in `game-action.ts` before the dealing loop |
| 15.11 | `MIN_PLAYERS_TO_START` in `server/lib/players.ts`, ready reset on every join/leave/bot change |

### Deviations from the spec

* `ValidationResult` and `settleSale`'s outcome are flat objects rather than
  discriminated unions. The backend compiles with `strictNullChecks: false`,
  which disables narrowing on boolean discriminants — the union shape did not
  type-check (and had already broken the Epic 14 server build; that is fixed
  here too).
* `server/tsconfig.json` no longer excludes `../src`: it now compiles
  `src/types/game.ts` and `src/types/rules-normalize.ts` into `dist/src/types/`
  so `DEFAULT_RULES` genuinely lives in one file. Verified against the
  production `dist/` layout.
* Leaving a waiting room, or removing a bot, now compacts the remaining seats.
  Without a fixed player count a hole at seat 0 would leave `current_player_index`
  pointing at nobody.

Manual, two browsers against a branch DB (`netlify functions:serve` + `npm run dev`):

1. Create a room with name only → rules screen → Confirm Rules → room exists, code shown.
2. Second browser joins by code → host list shows 2 players + one `Waiting…` row.
3. Switch turn order to Custom → host drags themselves to last, hits Shuffle → order updates in both
   browsers, and the host still sees Add Bot / Edit Rules from the last seat.
4. Host clicks Edit Rules, switches board to Small → guest's rules panel updates; Max Chains shows 5.
5. Both ready up → game starts with 2 players, no bots, in the exact seat order shown.
6. Repeat in **Random** mode → seats are shuffled at start; both clients act as the correct player and
   hold the hands dealt to their new seat (this is the Story 15.0 regression).
7. Add a bot instead → ready flags reset, all ready again → game starts with 3.
8. Regression: start a room on `main`, deploy this branch, resume — rules and behaviour unchanged.
