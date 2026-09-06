# Epic: End-Game Declaration

**Epic ID:** Epic 18
**Feature:** The game ends when a player declares it, not when the engine notices
**Priority:** High
**Created:** 2026-09-06
**Branch:** `feature/end-game-declaration`
**Status:** Implemented on `feature/end-game-declaration` (2026-09-06) — migration not yet applied

---

## Executive Summary

The rule, as Acquire actually plays it:

> The game ends when one player announces during their turn that either **all active hotel chains are
> safe** or that **one active hotel chain is made up of 41 or more building tiles**. A player does not
> have to announce that the game is over if it is to their advantage to keep playing — for example, to
> enlarge a hotel chain they own stock in. After making this announcement, that player **finishes their
> turn as normal**, then the game ends.

Two words carry the epic: **announces**, and **finishes**.

Today the engine implements neither. It *detects* the end condition and ends the game **immediately, in
the middle of the declaring player's turn** — and it only implements half of one of the two conditions.
The end of the game is currently something that happens *to* the players rather than something a player
chooses, and the last turn of every game is cut short.

This epic makes the end a decision, and protects the turn it is decided in:

1. **The two conditions become complete.** "All active chains are safe" does not exist anywhere in the
   codebase today.
2. **Meeting a condition ends nothing.** It unlocks a declaration.
3. **A declared turn runs to completion** — power card, tile, merger, purchases — and the game ends when
   the *player* ends the turn.
4. **Once the game can be ended, turns stop ending themselves.** While a condition is met, the buy phase
   no longer auto-ends: the player ends their turn deliberately, through a modal that reminds them the
   game can be finished. Nobody should ever be swept past that decision.
5. **The end-game vote is retired** and its button becomes the declaration button.

---

## Problems This Solves

| # | Problem | Evidence |
|---|---|---|
| 1 | **The "all active chains are safe" condition is missing entirely** — only the 41-tile condition is implemented | `server/lib/rules.ts:231` and `src/utils/gameLogic.ts:659` both check `some(c => c.tiles.length >= endSize)` and nothing else |
| 2 | **The game ends automatically**, with no player choice, the instant the threshold is crossed | Six sites set `phase = 'game_over'` off a `checkGameEnd` call: `game-action.ts:623`, `:767`, `:1345`, `:1505`, `:1797`, `:2256` |
| 3 | **The declaring player does not finish their turn.** Placing the 41st tile ends the game before they can buy stock | `game-action.ts:621` — the check runs in `place_tile` and jumps straight to `game_over`, skipping `buy_stock` entirely |
| 4 | **The turn ends itself**, so even with a declaration available the player can be swept past it | The buy phase auto-ends server-side (`game-action.ts:1296`) and on an 800ms client timer (`GameContainer.tsx:124-129`) |
| 5 | A player can never keep playing to grow a chain they hold, which is the strategic point of the rule | No opt-out exists |
| 6 | Ending the game early requires a **majority vote** — a mechanic the physical game does not have, and one that no longer earns its complexity beside a real declaration | `end_game_vote` (`game-action.ts:1617`), `EndGameVote.tsx`, `game_states.end_game_votes` |
| 7 | The statistics record cannot distinguish a declared end from a timer-driven one | `EndReason = 'threshold' \| 'vote' \| 'auto' \| 'unknown'` (`server/lib/results.ts:30`) |

Problems 3 and 4 are the ones players actually feel: the turn that ends the game is the turn you most
want to finish, and today it is the one turn you are neither allowed to finish nor asked about.

---

## No Rule Toggle

This replaces the current behaviour outright. There is no `gameEnd` field in `CustomRules`, no setting,
and no second code path.

Auto-ending is not a variant anyone chose — it is an approximation of a rule, and it is wrong in a way
that costs the declaring player a stock purchase. A toggle would mean two end-game code paths to test
forever, for a setting whose "auto" side is strictly worse: a player who *wants* the game to end simply
declares at the first opportunity, which is one click.

This mirrors how Epic 15 resolved the chain-safety default — adopt the honest rule, do not add a flag to
preserve a mistake.

**In-flight games:** removing auto-detection cannot corrupt a running game — the worst case is a game
that was about to auto-end now waits for someone to press a button, and the button ships in the same
deploy. No `rules_snapshot` migration is involved.

---

## Out of Scope

- Changing scoring, bonuses or `calculateFinalScores`. What happens *after* the game ends is untouched.
- The end-game **thresholds** themselves (41 tiles, 30 on a small board). Unchanged, and still not
  configurable.
- Local hot-seat play. `checkGameEnd` in `gameLogic.ts` gains the missing condition and a
  `canDeclareGameEnd` helper because the client needs them, but the local engine keeps auto-ending.
- Dropping the `game_states.end_game_votes` column. The vote *mechanism* goes (Part 5), but the column
  stays — it is harmless, and historical rows keep their meaning.

---

## Part 1 — The Two End Conditions

```ts
// server/lib/rules.ts — and mirrored in src/utils/gameLogic.ts
export function canDeclareGameEnd(chains, boardRows, safeChainSize): boolean {
  const active = Object.values(chains).filter(c => c.isActive);
  if (active.length === 0) return false;                    // ← mandatory guard, see below

  const endSize = boardRows === 6 ? SMALL_BOARD_END_GAME_SIZE : END_GAME_CHAIN_SIZE;
  const hasGiant  = active.some(c => c.tiles.length >= endSize);
  const allSafe   = safeChainSize !== null && active.every(c => c.isSafe);

  return hasGiant || allSafe;
}
```

Three things this has to get right:

**The vacuous case is disabled by an explicit guard.** With no chains on the board, "every active chain
is safe" is trivially true of an empty set — which would let any player declare the game over on turn
one, before a single chain exists. `active.length === 0` returning `false` is not an optimisation or a
nicety; it is the condition's precondition, and it gets its own test in both engines. The all-safe
condition is only ever meaningful with at least one chain standing.

**The all-safe condition is inert in a default room.** `DEFAULT_RULES.chainSafety` is `'none'`
(Aggressive), which makes `getSafeChainSize()` return `null` and `chain.isSafe` permanently `false`. So
in every room using today's defaults the only route to the end remains a 41-tile chain — exactly as now.
The condition only comes alive in rooms that set a safety threshold of 9/11/13/15. That is correct, but
it means **the feature is invisible in default rooms** and playtesting must deliberately use a room with
chain safety on.

**`isSafe` is already maintained** on every chain write (`place_tile:600`, `completeMergerInDb:2232`),
derived from `getSafeChainSize(rules)`. The new condition reads it and adds no new bookkeeping.

`checkGameEnd()` keeps its current name and meaning (the 41-tile threshold) only where the local engine
and the stalemate backstop need it; everything on the online path moves to `canDeclareGameEnd`.

---

## Part 2 — Declaration, Not Detection

### The flow

```
your turn, phase place_tile or buy_stock
   └─ canDeclareGameEnd(...)  → the turn stops auto-ending (Part 2a)
                              → "End Game" button appears in the header
        └─ declare_game_end   → end_declared_by = your seat, logged and broadcast
             └─ …you finish your turn exactly as normal: card, tile, merger, buy, sell…
                  └─ YOU end the turn → phase = 'game_over' instead of advancing to the next player
```

### Rulings

- **Declaring changes nothing about the current turn.** You still place, still resolve any merger, still
  play a power card, still buy up to your allowance. The only difference is where the turn ends up.
- **A declaration cannot be withdrawn.** Once announced, the game ends at the end of that turn. This
  matches the physical game and removes a class of bad-faith stalling.
- **You may declare at any point in your own turn**, in `place_tile` or `buy_stock` — before placing,
  after placing, or after buying. Merger phases are excluded, exactly as the retired vote already
  excluded them (`game-action.ts:1626`): the board is mid-transition and chain sizes are not final.
- **The condition is evaluated when you declare**, not when the turn ends.
- **Only the player whose turn it is may declare.** Everyone else can see the condition is met (chain
  sizes are public) and can see that a declaration has happened, but cannot act on it.
- **The condition being met does not force anything.** A game can run for many more turns with a
  45-tile chain on the board if nobody wants to stop. That is the point of the rule.

### The turn-end sites

The three places a turn ends each grow the same branch, before their existing "advance to the next
player" logic:

| Site | Today | After |
|---|---|---|
| `buy_stocks` end-turn path (`:1321`) | advance seat, draw, new deadline | if `end_declared_by === myPlayerIndex` → `game_over` + winner |
| `skip_buy` (`:1481`) | same | same |
| `auto_end_turn` (`:1797`) | same | same — a declared turn that times out still ends the game |

The winner calculation is the same `calculateFinalScores(...)[0].name` already used at all three sites.

---

## Part 2a — Once the Game Can End, Turns End Manually

A declaration is worthless if the player never gets the chance to make it. Today the buy phase closes
itself: the server ends the turn inside `buy_stocks` the moment nothing more can be bought
(`game-action.ts:1296`), and the client fires an 800ms auto-end (`GameContainer.tsx:124-129`). A player
who places the 41st tile, buys their three shares and looks up would find their turn already gone.

**So while `canDeclareGameEnd` is true, the turn does not end itself.** The gate becomes:

```
auto-end the turn  ⟺  !canBuyMore  &&  !canSellAnything  &&  !canDeclareGameEnd
```

This is the same gate Epic 14 widened once already (adding `canSellAnything` at
`GameContainer.tsx:121`), and the same one [Epic 17](./Epic-17-power-cards.md) widens again with
`!canPlayAnyPowerCard`. With both epics shipped it carries four terms, one per thing a player might
still want to do. Epic 18 introduces the fourth term; Epic 17 adds the third.

### The reminder

Ending the turn is then a deliberate act, and it routes through the existing `EndTurnConfirmModal`
(`src/components/game/EndTurnConfirmModal.tsx`), which already exists to say *"you can still do X — end
anyway?"*. It gains a new, highest-priority headline:

> **The game can be ended**
> *A chain has reached 41 tiles.* / *Every chain on the board is safe.*
> Declare now and the game ends when this turn does — or keep playing and decide on a later turn.
>
> **[ Declare & End Game ]**  **[ End Turn — Keep Playing ]**

That single modal is both the reminder and the decision point, at the only moment it matters. There are
therefore two routes to a declaration, and they must agree: the header button during the turn, and this
modal at the end of it. If the player already declared via the button, the modal instead confirms
plainly that ending this turn ends the game.

Rulings:

- The reminder appears **on every turn while the condition holds**, for whoever's turn it is — it is one
  extra click per turn, and it is the click that keeps a game from ending by accident.
- It appears when the player ends the turn, not automatically at turn start. An auto-popping modal every
  turn would interrupt the placement decision it is meant to inform. *(Playtest item: if players report
  missing it, popping it once on the turn the condition first becomes true is the fallback.)*
- **The turn timer still ends the turn.** `auto_end_turn` is unaffected — a player who does nothing
  cannot stall a timed game, they simply forfeit the declaration for that turn.
- **Bots are unaffected.** They always leave the buy phase through an explicit `skip_buy`
  (`server/lib/bot.ts:827` and six other exits), never by relying on the server's auto-end, so removing
  the auto-end cannot strand them.

---

## Part 3 — State & Schema

```sql
-- db/migrations/2026-09-06-epic18-end-declaration.sql
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS end_declared_by INTEGER DEFAULT NULL;
```

One nullable column holding the declaring seat's `player_index`. `NULL` means nobody has declared.

It is **never reset** during a game — a declaration is final, and the game ends at the end of that same
turn, so there is no turn boundary at which a reset would be meaningful. `new_game` deletes the
`game_states` row entirely, so a rematch starts clean.

Storing the *seat* rather than a boolean lets the turn-end branch assert that the declaring player is the
one whose turn is ending — the guard against a declaration surviving into someone else's turn through any
path this epic has not thought of.

Mirror it into `db/schema.sql` in the same idempotent style as the Epic 14/15 blocks.

> ⚠️ **Apply by hand, and before the deploy.** `deploy.sh` never runs `schema.sql` or `db/migrations/`.
> It is additive and its `NULL` default reads as "nobody has declared" — but with auto-detection removed,
> an unmigrated production DB would have **no way to end a game at all**. Unlike the Epic 14/15/17
> migrations, this one is not deferrable. It goes on the v2.0.0 launch checklist as a blocking item.

Client-side, `GameState` gains:

```ts
  endDeclaredBy: number | null;
```
mapped in `dbToGameState` alongside the other counters.

---

## Part 4 — Removing the Six Auto-End Sites

Every `checkGameEnd` call site on the online path is deleted or replaced:

| Site | What it did | After |
|---|---|---|
| `place_tile:621` | ended the game after a placement, **skipping the buy phase** | deleted — placement always proceeds to `buy_stock` |
| `found_chain:767` | same, after founding | deleted |
| `buy_stocks:1345` | ended the game on the turn-end path | replaced by the `end_declared_by` branch |
| `skip_buy:1505` | same | replaced by the `end_declared_by` branch |
| `auto_end_turn:1797` | same | replaced by the `end_declared_by` branch |
| `completeMergerInDb:2256` | ended the game as a merger completed, mid-turn | deleted — the merger exits to `buy_stock` as it otherwise would |

Deleting the `place_tile` and `completeMergerInDb` checks is what fixes Problem 3. Note the guard at
`:621` is `checkGameEnd(...) && newPhase === 'buy_stock'`, so removing it also removes a latent
inconsistency: a placement that ended in `found_chain` or a merger never triggered the check anyway,
meaning today's auto-end already fires or not depending on *how* the 41st tile landed.

After this epic, `game_over` is reachable from exactly two places: a declared turn ending, and the
stalemate backstop (Story 18.7).

---

## Part 5 — Retiring the End-Game Vote

The majority vote is removed and **its button becomes the declaration button**. `EndGameVote` sits in the
header (`GameContainer.tsx:412`), beside `InfoCard` and the audio settings; `EndGameDeclaration` takes
that slot.

What goes:

- the `end_game_vote` action (`game-action.ts:1617`)
- `src/components/game/EndGameVote.tsx`
- the `onEndGameVote` prop chain (`GameContainer.tsx:40`, `:62`, `:415`) and `handleEndGameVote` in
  `useOnlineGame.ts:581`
- the `canCallEndGameVote` derivation (`GameContainer.tsx:284`)

What stays: the `game_states.end_game_votes` column (unused, harmless) and `EndReason = 'vote'` for the
historical rows already recorded with it.

> **The trade-off, stated plainly:** the vote was the only way to end a game *before* any condition was
> met — the escape hatch for a table that had lost interest. Declaration cannot do that job, because it
> requires a 41-tile chain or an all-safe board. After this epic, a game nobody wants to finish can only
> be abandoned by leaving the room. That is a real, if narrow, loss; it is called out here so it is a
> decision rather than a discovery.

---

## Part 6 — Other Interactions

### With the turn timer

A declared turn that expires still ends the game (`auto_end_turn`). A player cannot declare and then
stall to avoid the consequence, and cannot lose the declaration by timing out.

### With Epic 17's Building Spree

**These two epics rewrite the same call sites in opposite directions, and whichever ships second must fix
the other.** [Epic 17](./Epic-17-power-cards.md) Story 17.9 currently says *"An end-game condition met on
tile 2 ends the game there"*, which describes the behaviour Epic 18 deletes. Under Epic 18 the correct
rule is:

> Meeting the condition on tile 2 of a spree ends nothing. The player may declare — the button appears
> and the turn stops auto-ending — and either way the spree continues to tiles 3 and 4, then the buy
> step, then the player ends the turn and, if declared, the game.

**Recommended order: Epic 18 first.** It deletes six call sites that Epic 17 would otherwise have to
carefully preserve and invert, and it establishes the auto-end gate that Epic 17's Story 17.4 extends.

### With bots

If no bot ever declares, a bot-only or bot-heavy game never ends. Every difficulty must therefore be able
to declare — this is not a "hard bots only" flourish like Epic 17's power cards, it is a liveness
requirement. The difficulties differ in *when*:

- **Easy** — declares as soon as it legally can. Simple, and slightly bad play, which is on-brand.
- **Medium** — declares if it is currently in the lead on net worth, otherwise after N further turns.
- **Hard** — declares when its net-worth lead is positive *and* it does not hold a majority position it
  could still grow; otherwise it keeps playing, which is exactly the strategic opt-out the rule exists
  for.

A hard cap backstops all three: any bot declares unconditionally once the condition has been met for more
than one full round, so a table of hard bots cannot deadlock.

### With the statistics record (Epic 16)

`EndReason` gains `'declared'` and `'stalemate'`. The subtlety: the game ends on a `buy_stocks` /
`skip_buy` / `auto_end_turn` action, so `endReasonForAction(action)` (`results.ts:55`) — which maps
action names to reasons — **cannot see** that a declaration caused it. The resolution must read state:
`recordIfFinished` (`:264`) already selects the `game_states` row to check `phase = 'game_over'`, so it
selects `end_declared_by` in the same query and prefers `'declared'` when it is non-null.

`'threshold'` and `'vote'` become legacy values, still present on historical rows and still rendered by
the dashboard.

### The stalemate backstop

Removing auto-detection makes one failure mode reachable that was previously masked: **the tile bag
empties, no player holds a playable tile, and nobody has declared.** The game then cannot progress —
`discard_tile` already returns `'Tile bag is empty'` (`game-action.ts:1588`) and there is nothing else to
do. With the vote retired, there is no longer a human escape from it either.

Acquire's own answer is that the game ends when no player can place a tile. Story 18.7 implements that as
an automatic end with `EndReason = 'stalemate'` — the one piece of automatic ending this epic keeps,
because it is a liveness guarantee rather than a rules decision.

---

## Part 7 — Client

### `EndGameDeclaration` (new, `src/components/game/`)

Takes the header slot vacated by `EndGameVote` (`GameContainer.tsx:412`). Rendered only on your turn with
`canDeclareGameEnd(gameState)` true:

> **You can end the game**
> *A chain has reached 41 tiles.* / *Every chain on the board is safe.*
> You'll finish this turn as normal.
> **[ End Game ]**

The reason line names *which* condition is met, because the two feel completely different at the table.
The confirmation states the two facts a player needs: it cannot be taken back, and this turn still
completes normally.

### `EndTurnConfirmModal` (modified)

Gains the end-game headline and the two-button choice described in Part 2a, taking priority over its
existing "you can still buy / still sell" variants. When the player has already declared, it says so
instead of offering the choice again.

### Everyone else

Once declared, a persistent banner for all players: **"{Name} has declared the game will end after this
turn."** This is the announcement, and it has to be visible the way it is audible around a physical
table — the other players' remaining decisions depend on knowing.

And when the condition is met but *nobody* has declared, every player should be able to see that too — a
marker on the chain that crossed 41, or on the chain list when all are safe. Otherwise the strategic
opt-out is invisible and reads as a bug.

### Modified

- **`GameContainer.tsx`** — swaps `EndGameVote` for `EndGameDeclaration`, drops `onEndGameVote` and
  `canCallEndGameVote`, adds the fourth auto-end term and the banner.
- **`InfoCard.tsx`** / chain list — the "end condition met" marker.
- **`GameLog.tsx`** — the declaration is a logged, broadcast event like any other action.

---

## User Stories

**Story 18.0 — `canDeclareGameEnd` in both engines**
Add the helper to `server/lib/rules.ts` and mirror it in `src/utils/gameLogic.ts`, including the missing
all-active-chains-safe condition and the empty-board guard.
- ✅ Returns false when no chain is active — the vacuous-truth case is explicitly disabled
- ✅ Returns true on a 41-tile chain (30 on a small board)
- ✅ Returns true when every active chain is safe and at least one exists
- ✅ Returns false for all-safe when `chainSafety: 'none'`, because no chain is ever safe
- ✅ Server and client agree on every case, proven by a shared test table

**Story 18.1 — `end_declared_by` column and `declare_game_end` action**
Migration plus the handler: your turn, phase `place_tile` or `buy_stock`, condition met, not already
declared. Writes the seat, logs it, broadcasts it.
- ✅ A non-current player is rejected (403)
- ✅ Declaring during a merger phase is rejected
- ✅ Declaring with no condition met is rejected
- ✅ Declaring twice is rejected; the first declaration stands
- ✅ The declaration is visible to every player immediately
- ✅ The migration is idempotent

**Story 18.2 — The turn ends the game** *(depends on 18.1)*
Add the `end_declared_by === myPlayerIndex` branch to `buy_stocks`, `skip_buy` and `auto_end_turn`.
- ✅ Declaring before placing still lets the player place, resolve a merger, and buy
- ✅ The game ends when that turn ends, not before
- ✅ It ends via all three turn-end paths, including a timeout
- ✅ The winner is computed with the declaring player's final cash and stocks included
- ✅ Play never passes to the next player after a declared turn

**Story 18.3 — Remove the six auto-end sites** *(depends on 18.2)*
Delete the `checkGameEnd` branches at `place_tile:621`, `found_chain:767`, `buy_stocks:1345`,
`skip_buy:1505`, `auto_end_turn:1797` and `completeMergerInDb:2256`.
- ✅ Placing the 41st tile leads to the buy phase, not to `game_over`
- ✅ A merger that pushes a chain past 41 completes and the turn continues
- ✅ A game continues indefinitely with a 60-tile chain if nobody declares
- ✅ No path reaches `game_over` except a declared turn ending and the Story 18.7 backstop

**Story 18.4 — Turns stop ending themselves, and the reminder modal** *(depends on 18.0)*
Add `!canDeclareGameEnd` as a term to both auto-end gates (`game-action.ts:1296`,
`GameContainer.tsx:124-129`) and give `EndTurnConfirmModal` its end-game headline and two-button choice.
- ✅ With a condition met, the buy phase does **not** auto-end — not after buying the full allowance, not
     when nothing is affordable
- ✅ Ending the turn always goes through the modal, which names which condition is met
- ✅ **Declare & End Game** declares and ends the turn in one gesture; the game ends
- ✅ **End Turn — Keep Playing** ends the turn with no declaration and play continues
- ✅ A player who already declared sees a confirmation, not the choice again
- ✅ The turn timer still ends an idle turn
- ✅ Bots are unaffected — they exit via explicit `skip_buy`
- ✅ With no condition met, auto-end behaviour is byte-identical to today
- ✅ Server and client agree on the gate

**Story 18.5 — Client: declare, announce, and signal the condition** *(replaces the vote)*
Swap `EndGameVote` for `EndGameDeclaration` in the header slot; delete the vote action, component and
prop chain; add the banner and the condition marker.
- ✅ The button appears only on your turn with the condition met, and names which condition
- ✅ The confirmation states that it cannot be undone and that the turn completes normally
- ✅ All players see the "will end after this turn" banner once declared
- ✅ All players can see when the condition is met but undeclared
- ✅ The declaration appears in the game log
- ✅ No vote UI, action or prop remains; the `end_game_votes` column is left in place

**Story 18.6 — Bots declare** *(liveness, all difficulties)*
Per-difficulty declaration heuristics plus the one-full-round unconditional backstop.
- ✅ A game of four easy bots ends without human input
- ✅ A game of four hard bots ends — the backstop fires even when every bot wants to keep playing
- ✅ A bot never declares illegally (wrong phase, not its turn, condition unmet)
- ✅ A bot that declares still completes its turn, buying as normal

**Story 18.7 — Stalemate backstop**
End the game automatically when the tile bag is empty and no player holds a playable tile.
- ✅ A stalled board ends rather than hanging
- ✅ It does not fire while any player has a legal placement
- ✅ It does not fire while the bag still has tiles
- ✅ Recorded with `EndReason = 'stalemate'`

**Story 18.8 — Statistics: the `declared` end reason**
Add `'declared'` and `'stalemate'` to `EndReason`; resolve the reason from `end_declared_by` inside
`recordIfFinished` rather than from the action name.
- ✅ A declared game records `'declared'`, not `'threshold'`
- ✅ A timed-out declared game records `'declared'`, not `'auto'`
- ✅ Historical `'threshold'` and `'vote'` rows still render on the dashboard
- ✅ No extra query — the reason is read from the row `recordIfFinished` already fetches

---

## Risks

| Risk | Mitigation |
|---|---|
| **The all-safe condition is vacuously true on an empty board**, letting anyone end the game on turn one | The `active.length === 0` guard, with its own test in both engines (18.0) |
| **A player is swept past the decision** by the turn auto-ending | Story 18.4 disables the auto-end while a condition holds and routes the turn end through a modal that names the choice |
| Nobody declares and the game never ends | Bots declare at every difficulty with a one-round backstop (18.6); the stalemate backstop (18.7) covers the dead-board case; the modal makes the option impossible to miss |
| **Retiring the vote removes the only pre-condition escape hatch** — a game nobody wants to finish can now only be abandoned | Accepted deliberately (Part 5). Declaration covers every case where an end condition exists; leaving the room covers the rest |
| **The migration is not applied** and, with auto-detection removed, games become unendable | Mandatory and blocking, called out on the launch checklist rather than left as a follow-up |
| A declaration leaks into another player's turn through an unforeseen path | The column stores the seat, and the turn-end branch requires it to equal the seat whose turn is ending |
| Epic 17 and Epic 18 both rewrite the same call sites and the same auto-end gate | Ship Epic 18 first; Epic 17's end-game ruling is then deleted rather than inverted, and its Story 17.4 adds a term to a gate that already exists. Whichever ships second updates the other's spec |
| The extra click per turn annoys players in a long endgame | It only applies once a condition is met, which is the last stretch of a game; the fallback is to keep the auto-end but pop the reminder first |
| The stats dashboard breaks on a new enum value | `'threshold'` and `'vote'` are retained; the dashboard must treat `EndReason` as open-ended, verified against existing rows |

---

## Verification

```bash
psql "$DATABASE_URL" -f db/migrations/2026-09-06-epic18-end-declaration.sql   # mandatory, before deploy
npx vitest run                 # unit: canDeclareGameEnd truth table, turn-end branch, auto-end gate
npm run build
cd server && npm run build
npm run lint
```

Manual, two browsers plus a bot, against a local stack (`/local-preview`):

1. **The turn completes.** Build a chain to 41 and place the 41st tile: the game does **not** end, the
   buy phase opens, and the "End Game" button appears in the header.
2. **The turn does not end itself.** Buy the full allowance — the turn stays open instead of auto-ending,
   and so does a turn where nothing is affordable.
3. **The reminder.** Click End Turn: the modal names the met condition and offers *Declare & End Game* /
   *End Turn — Keep Playing*.
4. **Keep playing.** Choose to keep playing; play continues, and the next player gets the same modal on
   their turn.
5. **Declare early, finish the turn.** Declare via the header button, then place a tile, resolve a
   merger and buy 3 shares — the game ends only when the turn does, and those shares count in the final
   score.
6. **The announcement.** After declaring in one browser, the other shows the banner immediately and can
   still act until the declaring turn ends.
7. **All chains safe.** In a `chainSafety: '11'` room, take every active chain past 11: the condition
   fires on the second route and the button says so.
8. **Empty board.** Confirm no player can declare before any chain exists.
9. **Default room.** In a `chainSafety: 'none'` room, confirm the all-safe condition never fires and 41
   tiles remains the only route.
10. **Timeout.** Declare, then let the turn timer expire — the game still ends.
11. **Bots.** A game of four bots reaches a natural end with no human input.
12. **Stats.** The dashboard shows the game from step 5 with reason `declared`, and historical `vote`
    rows still render.
