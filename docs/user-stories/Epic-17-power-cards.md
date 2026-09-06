# Epic: Power Cards

**Epic ID:** Epic 17
**Feature:** Five once-per-game power cards as an optional room rule
**Priority:** Medium
**Created:** 2026-09-06
**Branch:** `feature/power-cards`
**Status:** Implemented on `power-cards` (2026-09-06), on top of Epic 18 — migration not yet applied

---

## Executive Summary

Acquire's turn is deliberately rigid: place one tile, buy up to three shares, draw one tile, pass.
Every player has the same lever every turn, and the only variable is the board. Power cards add a
small, symmetric pool of one-shot exceptions to that rigidity — each player gets the **same five
cards**, each card is spent **once per game**, and **at most one card may be played per turn**, on
your own turn.

Because every player holds the same hand, the cards add timing decisions rather than luck. The
interesting question is never "who drew the good card", it is "is this the turn worth spending it on".

The five powers:

| Id | Name | Effect |
|---|---|---|
| `extra_buy` | **Extra Purchase** | Buy up to **5** shares this turn instead of 3. |
| `extra_tiles` | **Extra Tiles** | Draw **5** tiles immediately, taking your hand to 11. You then draw nothing until your hand is back at the normal limit. |
| `free_stock` | **Free Shares** | The 3 shares you take this turn cost nothing. |
| `stock_trade` | **Stock Trade** | Trade **2 shares you own for 1 share from the market**, up to three times. Everything you give up must be a chain currently on the board. You may still buy 3 shares normally. |
| `multi_tile` | **Building Spree** | Place up to **4 tiles** this turn. A merger triggered by a tile is fully resolved before the next tile is placed. |

The feature ships behind a room rule, **off by default**, so no existing or in-flight game changes.

---

## Why this is more than five `if` statements

The current engine hard-codes three assumptions that all five cards break:

| # | Assumption | Where it lives |
|---|---|---|
| 1 | A turn places **exactly one** tile, and a placement always leads to `buy_stock` | `game-action.ts:456` (`place_tile`), `:684` (`found_chain`), `:2185` (`completeMergerInDb`) |
| 2 | A turn ends by drawing **exactly one** tile (`tileBag.pop()`) | `game-action.ts:1321` (`buy_stocks`), `:1481` (`skip_buy`), `:1717` (`auto_end_turn`) |
| 3 | The per-turn share allowance is the **constant** `MAX_STOCKS_PER_TURN = 3` | `types/game.ts:MAX_STOCKS_PER_TURN`, `gameLogic.ts:483`, `:507`, `game-action.ts:1230` |
| 4 | The buy phase **ends the turn itself** as soon as nothing more can be bought or sold | `game-action.ts:1296`, `GameContainer.tsx:124-129` |

Assumption 2 is the load-bearing one. "Draw one tile" is only correct because exactly one tile was
placed; the moment a turn can place four tiles or draw five at once, the invariant that actually
matters — **your hand is refilled up to the hand limit at the end of your turn** — has to be stated
explicitly. Story 17.1 does that as a standalone, behaviour-preserving refactor, and every card after
it is comparatively small.

---

## Out of Scope

- Any card beyond these five. The set is fixed at five for this epic; the model is extensible but the
  card list is not configurable per room.
- Trading, giving or discarding cards between players. Cards are dealt at game start and spent by
  their owner or not at all.
- Recording power-card usage in the Epic 16 statistics tables (`game_results`, `game_result_players`).
  Nothing in this epic changes those tables; a "cards played" stat is a sensible follow-up.
- Tutorial coverage (`src/components/Tutorial/`). The cards are explained in-game by their own confirm
  dialogs; adding a tutorial chapter is a separate story.
- Local hot-seat play (`src/hooks/useGameState.ts`, `Lobby.tsx`). Power cards are online-only. The
  client `GameState` grows the fields, but the local engine never populates them and the UI hides the
  card bar when the rule is off — which it always is locally.
- Easy and medium bots playing cards (see Story 17.12 for the deliberate reason).

---

## Part 1 — The Rule

Power cards are a **Basic** rule, because turning them on changes how the game feels more than any
Advanced toggle does, and a host should not have to hunt for it.

```ts
// src/types/game.ts — added to CustomRules
  /** Optional one-shot power cards, one identical set of 5 per player. */
  powerCards: 'off' | 'on';
```

```ts
// DEFAULT_RULES
  powerCards: 'off',
```

**Off by default, deliberately.** Every room created before this ships, and every in-flight game,
normalises to `'off'` and plays exactly as it does today — `normalizeRules()` already falls back to
`DEFAULT_RULES` for missing keys, so v1 and pre-Epic-17 v2 blobs need no special case beyond a test
that proves it. `rules_snapshot` is JSONB, so **no rules migration is required** (the two new
gameplay columns in Part 3 are a different matter).

Wiring, following the shape Epic 15 established:

- `RULE_VALUES.powerCards = ['off', 'on']` in `src/types/rules-normalize.ts` — `validateRules` then
  rejects anything else with a 400 for free.
- `describeRules()` in `src/types/rules-describe.ts` gains a "Power Cards — On / Off" line, so the
  lobby rules panel and the in-game rules summary pick it up with no further work.
- `RulesForm.tsx` renders it as a Basic Switch, below Chain Safety.

---

## Part 2 — The Turn, Restated

Today's turn, as the engine actually implements it:

```
place_tile ──┬─ (2+ chains) ─→ merger_* ──┐
             ├─ (1 chain)   ───────────────┤
             ├─ (0 chains, cluster) ─→ found_chain ─┤
             └─ (isolated)  ───────────────┴─→ buy_stock ─→ [buy ≤3 | sell ≤3 | skip] ─→ draw 1 ─→ next player
```

With power cards, three edges change and one new terminal appears:

```
place_tile ──… as above …──→ phaseAfterPlacement()
                               ├─ multi_tile active, tilesPlaced < 4, a playable tile remains → place_tile
                               └─ otherwise                                                    → buy_stock

buy_stock ─→ [buy ≤ limit(3|5) | sell ≤3 | trade ≤3 | play a card | skip] ─→ refill hand to limit ─→ next player
              └─ auto-ends only when none of those four is available
```

Everything else — merger resolution, the per-player merger stock step, the end-game check, the turn
timer — is untouched. A card never changes *whose* turn it is and never runs across a turn boundary.

### The invariants that must survive

1. **One card per turn, per player, per game.** Enforced server-side by `active_power_card` being
   non-null and by the card being removed from `game_players.power_cards` the moment it is played.
2. **A card is spent when it is played, not when it pays off.** Playing Extra Purchase and then buying
   nothing burns the card. This is stated in each confirm dialog, and it is what makes the server
   validation simple and race-free.
3. **A merger is always fully resolved before anything else happens** — including before the next tile
   of a Building Spree. This already falls out of the phase machine; Story 17.9 must not shortcut it.
4. **The buy step happens once, at the end of the turn**, after every placement. Building Spree does
   not grant extra buying.
5. **Budgets are separate.** Buying (3 or 5), selling (3, Epic 14) and trading (3 trades) each have
   their own per-turn allowance and do not consume one another.
6. **A turn never auto-ends while the player could still play a card.** See Part 2a — this is the one
   place where power cards change a turn that has no card active.

### Part 2a — The buy phase must stop auto-ending

Today the buy phase ends itself. The moment nothing more can be bought, the server ends the turn inside
`buy_stocks` (`game-action.ts:1296`) and the client fires an 800ms auto-end
(`GameContainer.tsx:124-129`). That is a deliberate convenience — without it every turn would need a
manual End Turn click for a phase that usually has nothing left to offer.

Epic 14 already had to widen that gate once: with selling on, "can't afford anything" no longer means
"nothing to do", so `canSellAnything` was added as a second term (`GameContainer.tsx:121`). Power cards
need a third term for exactly the same reason, and the case is sharper — **the turn where you can't
afford anything is precisely the turn you want to play Free Shares.** Auto-ending there would take the
card off the table at the only moment it matters.

The gate becomes, in both engines:

```
end the turn  ⟺  !canBuyMore  &&  !canSellAnything  &&  !canPlayAnyPowerCard  &&  !canDeclareGameEnd
```

The fourth term belongs to [Epic 18](./Epic-18-end-game-declaration.md), which widened the same gate for
the same reason — a player must not be swept past the choice to end the game. Epic 18 shipped first, so
this story adds one term to a gate that was already wired at both call sites.

`canPlayAnyPowerCard(gameState, playerData)` is `canPlayPowerCard()` (Story 17.3) run across the
player's remaining cards, **plus a per-card "is there actually a use" predicate** — modelled on
`canSellStock` (`gameLogic.ts:512`), which deliberately checks that the player holds sellable shares
rather than merely that the rule is on. Without that second half, a player holding only Stock Trade and
no tradeable shares would have every single turn hang waiting for a manual End Turn.

In the `buy_stock` phase only three cards can ever qualify — `extra_buy` and `free_stock` (both require
nothing bought yet) and `stock_trade`. `extra_tiles` and `multi_tile` are `place_tile`-only, so a player
holding just those two still gets today's auto-end.

When the turn stays open, the player ends it with the existing End Turn button (`skip_buy`), which is
unchanged. The `EndTurnConfirmModal` warning about discarded selections (`GameContainer.tsx:345`) should
also name an unplayed-but-playable card, so ending the turn is never a silent loss.

---

## Part 3 — State & Schema

### `game_players.power_cards TEXT[]`

The cards this player still holds. Dealt at game start as all five when the rule is on, `'{}'` when it
is off. Removing an element is how a card is spent.

**This column is public.** Every player sees which cards every other player has left — that is a
meaningful part of the game (knowing an opponent still holds Building Spree changes how you leave the
board), and hiding it would be a false secret anyway since every play is logged. It joins the
non-sensitive columns in `game_players_public`; `tiles` and `session_id` remain the only hidden ones.

### `game_states.active_power_card JSONB`

The card in effect for the current turn, or `NULL`. One column rather than four booleans because
exactly one card can be active and each card carries different bookkeeping:

```ts
export interface ActivePowerCard {
  card: PowerCardId;
  /** stock_trade only: trades completed this turn, 0–3. */
  tradesUsed: number;
}
```

Cleared to `NULL` at every turn end, alongside the existing `stocks_purchased_this_turn` /
`stocks_sold_this_turn` / `chains_bought_this_turn` resets.

### `game_states.tiles_placed_this_turn INTEGER`

Maintained **always**, not just under Building Spree — it is what lets the server say "you may only
play Extra Tiles before you have placed" without inspecting `last_placed_tile`, which is also written
by the starting tile at game setup.

### Migration

```sql
-- db/migrations/2026-09-06-epic17-power-cards.sql
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS power_cards TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE game_states  ADD COLUMN IF NOT EXISTS active_power_card JSONB DEFAULT NULL;
ALTER TABLE game_states  ADD COLUMN IF NOT EXISTS tiles_placed_this_turn INTEGER NOT NULL DEFAULT 0;
```

> ⚠️ **Apply by hand.** `deploy.sh` never runs `schema.sql` or `db/migrations/`. This joins the Epic 14
> and Epic 15 migrations on the v2.0.0 launch checklist. All three statements are additive and
> idempotent, and their defaults make an unmigrated row behave exactly like a game with the rule off —
> so the deploy is safe in either order, though the feature is inert until the migration lands.

Mirror all three into `db/schema.sql` in the same idempotent style as the Epic 14/15 blocks.

### Shared constants

```ts
// src/types/game.ts
export type PowerCardId = 'extra_buy' | 'extra_tiles' | 'free_stock' | 'stock_trade' | 'multi_tile';

export const POWER_CARDS: PowerCardId[] = ['extra_buy', 'extra_tiles', 'free_stock', 'stock_trade', 'multi_tile'];

export const EXTRA_BUY_LIMIT = 5;      // shares, replaces MAX_STOCKS_PER_TURN for the turn
export const EXTRA_TILES_DRAW = 5;     // tiles drawn immediately
export const MULTI_TILE_LIMIT = 4;     // tiles placeable this turn
export const MAX_POWER_TRADES = 3;     // trades per turn
export const TRADE_GIVE = 2;           // shares given per trade
export const TRADE_RECEIVE = 1;        // shares received per trade
```

`server/lib/rules.ts` re-exports them, as it already does for `CustomRules` and `DEFAULT_RULES`.

---

## Part 4 — The Cards, Precisely

Each card below states its **legality window** (when `play_power_card` accepts it), its **effect**, and
the **rulings** that the implementation has to encode.

### Card 1 — Extra Purchase (`extra_buy`)

**Legality:** your turn, phase `place_tile` or `buy_stock`, and `stocks_purchased_this_turn === 0`.
**Effect:** the per-turn buy allowance for this turn is 5 instead of 3.

Rulings:
- The requirement that you have not yet bought removes the "buy 3, then retroactively raise the cap"
  ambiguity. The card is a decision made before you shop, not after.
- The allowance stops being a constant: introduce `getStockAllowance(state)` returning
  `EXTRA_BUY_LIMIT` when `extra_buy` is active and `MAX_STOCKS_PER_TURN` otherwise. It replaces the
  literal in `game-action.ts:1230` and in `gameLogic.ts:getRemainingStockAllowance` (`:483`).
- The **sell** allowance stays 3 (`getRemainingSellAllowance`, `:507`). The card is about buying.
- The auto-end-turn check (`canBuyMore`, `game-action.ts:1296`; `canBuyMoreStock`, `gameLogic.ts:489`)
  reads the same helper, so the buy panel stays open for shares 4 and 5.

### Card 2 — Extra Tiles (`extra_tiles`)

**Legality:** your turn, phase `place_tile`, and `tiles_placed_this_turn === 0`.
**Effect:** immediately draw 5 tiles (fewer if the bag holds fewer), taking a default hand from 6 to 11.

Rulings:
- The draw happens **when the card is played**, not at end of turn, so the enlarged hand is usable this
  turn.
- You then draw nothing for several turns, and that is the cost, not a bug. It is a *consequence* of
  Story 17.1's rule — "refill up to the hand limit" — not a separate mechanism: at 11 tiles you are
  above the limit, so the end-of-turn refill draws zero, and it stays zero until normal play has taken
  you back down to the limit. With a 6-tile limit that is five turns of drought.
- If the bag is empty, the card is refused with a 400 rather than silently wasted.
- The hand limit is `parseInt(rules.startingTiles)` (5, 6 or 7), so on a 7-tile room the card takes you
  to 12 and the drought is the same five turns.
- The dead-tile flow is unaffected: `discard_tile` (`game-action.ts:1535`) remains a 1-for-1 swap and
  must **not** be changed into a refill, or an 11-tile hand full of dead tiles would refill to 6.

### Card 3 — Free Shares (`free_stock`)

**Legality:** your turn, phase `place_tile` or `buy_stock`, and `stocks_purchased_this_turn === 0`.
**Effect:** every share you take this turn costs $0.

Rulings:
- The allowance stays **3**. Free Shares does not raise the cap, and since only one card may be played
  per turn it can never combine with Extra Purchase for 5 free shares. Both facts are stated in the
  card's dialog because players will ask.
- The bank still has to hold the shares, and the chain still has to be active. Only the price is zero.
- The affordability half of `canBuyMore` / `canBuyMoreStock` must be skipped while the card is active,
  or a broke player would have their free-share turn auto-ended before they could take anything.
- Shares taken free still land in `chains_bought_this_turn`, so Epic 14 still forbids selling them back
  the same turn. Free shares must not become a cash pump.
- The game log names the price: *"Took 3 Continental (free — Free Shares)"*.

### Card 4 — Stock Trade (`stock_trade`)

**Legality:** your turn, phase `place_tile` or `buy_stock`. No purchase precondition — trading and
buying are independent budgets.
**Effect:** up to **three** trades this turn; each gives 2 shares you own to the bank and takes 1 share
of your choice from the bank.

Rulings:
- **Every chain involved must be currently active on the board** — both chains you give from and the
  chain you receive. Defunct-chain certificates are worthless paper and cannot be laundered.
- The two shares given may come from **two different chains**, or both from one. The client sends
  `{ give: [{chain, quantity}], receive: chain }` and the server requires `sum(quantity) === 2`.
- The received chain must have at least 1 share in the bank. The given shares return to the bank first,
  so trading 2 Tower for 1 Tower is legal and pointless, and trading into a chain whose last share you
  just returned works.
- Epic 14's "no selling what you bought this turn" guard extends to trades: shares given up may not be
  from a chain in `chains_bought_this_turn`, and the chain received is **added** to that list. Without
  both halves, buy-then-trade is a way around the sell restriction.
- Trades do **not** consume the buy allowance. "You may still buy 3 shares normally this turn" is the
  headline of the card and the reason it is the most powerful of the five in the mid-game.
- Trading never ends the turn and never changes the phase — modelled exactly on `sell_stocks`
  (`game-action.ts:1381`), including the write ordering note: the player row (stocks) is updated first,
  the bank second, so a failure between them can only under-return shares, never duplicate them.
- All arithmetic and validation lives in a `settleTrade()` in `server/lib/rules.ts`, beside
  `settleSale()`, so it is unit-testable without a database.

### Card 5 — Building Spree (`multi_tile`)

**Legality:** your turn, phase `place_tile`, and `tiles_placed_this_turn === 0`.
**Effect:** place up to 4 tiles this turn. You may stop after any tile.

Rulings:
- **Each tile is fully resolved before the next.** A tile that founds a chain runs `found_chain`; a tile
  that merges runs the whole `merger_choose_survivor → merger_pay_bonuses → merger_handle_stock` cycle
  for every affected player. Only when the board is settled does the phase return to `place_tile`.
  This is not new machinery — it is the existing phase machine with one edge redirected.
- The redirect is a single shared helper, so all four exits agree:

  ```ts
  // server/lib/players.ts
  function phaseAfterPlacement(gameState, playerTiles): 'place_tile' | 'buy_stock'
  //  place_tile  when multi_tile is active
  //              AND tiles_placed_this_turn < MULTI_TILE_LIMIT
  //              AND the player still holds a legally placeable tile
  //  buy_stock   otherwise
  ```

  Call sites: `place_tile`'s grow and isolated branches (`game-action.ts:611`, `:618`), `found_chain`
  (`:763`), and `completeMergerInDb` (`:2185`, the exit for every merger path).
- **You still buy only once**, at the end, after all placements. There is no per-tile buy step.
- A new action **`end_placements`** moves `place_tile → buy_stock` on demand, so a player who wants
  only two of their four tiles is not stuck. Valid only when `multi_tile` is active and
  `tiles_placed_this_turn >= 1`.
- **Game end mid-spree — resolved by Epic 18 shipping first.**
  [Epic 18](./Epic-18-end-game-declaration.md) deleted the six automatic end-game checks, including the
  two on the placement path, so there is nothing here to invert: **meeting the condition mid-spree ends
  nothing.** The player may declare — the header button appears and the turn stops auto-ending — and
  either way the spree continues to tiles 3 and 4, then the buy step, then the player ends the turn
  and, if declared, the game.
- **Out of playable tiles mid-spree:** `phaseAfterPlacement` returns `buy_stock`. The unplayable-tile
  modal is for the *start* of a turn and must not appear mid-spree.
- **Timer:** one deadline for the whole turn, unchanged. On expiry `auto_end_turn` ends the turn from
  whatever point the spree reached (Story 17.13).
- The hand shrinks by up to 4 and Story 17.1's refill tops it back up at end of turn, drawing up to 4
  tiles. This is the second reason the refill refactor comes first.

---

## Part 5 — API Surface

Three new actions on `/game-action`, all following the existing handler shape (turn check → phase check
→ validate → write → `notifyForAction`):

| Action | Payload | Phase | Ends turn |
|---|---|---|---|
| `play_power_card` | `{ card: PowerCardId }` | per card, see Part 4 | no |
| `power_trade` | `{ give: {chain, quantity}[], receive: ChainName }` | `buy_stock` | no |
| `end_placements` | — | `place_tile` | no (→ `buy_stock`) |

`play_power_card` is the only place card legality is decided, via one exported
`canPlayPowerCard(card, gameState, playerData): { ok: true } | { ok: false, reason: string }` used by
**both** the server (as the gate) and the client (to disable buttons and explain why). One rule set,
two consumers — the pattern `settleSale` already established.

Add all three to `notifyForAction` (`game-action.ts:59`) so the realtime fan-out reaches the room;
`power_trade` and `play_power_card` change public state (bank, remaining cards) and must not be silent.

---

## Part 6 — Client

### `GameState` additions (`src/types/game.ts`, mapped in `dbToGameState`)

```ts
  activePowerCard: ActivePowerCard | null;
  tilesPlacedThisTurn: number;
```
and on `PlayerState`:
```ts
  powerCards: PowerCardId[];   // remaining, public
```

### Where the cards live on screen

The game screen is `lg:grid-cols-[1fr_320px]` (`GameContainer.tsx:423`): the left column holds the board,
the phase-dependent action panel and the log; the **right rail is the "your stuff" stack** — your
`PlayerCard` (cash and stocks), then `PlayerHand`, then the End Turn button, then the opponents.

**`PowerCardBar` goes in that rail, directly below `PlayerHand` and above End Turn**, styled as another
`bg-card rounded-xl p-3` panel titled *Your Cards*. The reasons:

- The cards are yours and permanent for the game, exactly like your tiles and your cash. The rail is
  already read top-to-bottom as *what I have → what I can do → end my turn*, and the cards slot in as
  the last "what I have".
- They must be reachable in **both** `place_tile` and `buy_stock` — `multi_tile` and `extra_tiles` are
  placement-time, the other three are buy-time. The left column's action panel swaps by phase, so
  anything placed there would be hidden for half of every turn.
- Opponents' remaining cards sit on their own `PlayerCard`s further down the same rail, so "what does
  everyone still hold" is one uninterrupted scan.

On mobile the grid collapses and the rail stacks under the board, putting the bar between your hand and
the opponents — the same reading order, no separate mobile treatment needed.

**Rejected:** a floating bottom bar (extra machinery, and it would fight the mobile stack) and a slot in
the left action panel (invisible during the wrong phase).

### Clicking a card expands its rules

Five cards across a 320px rail is roughly 52px each — enough for an icon and a state dot, not a name.
So the bar carries the icons and **a click carries the words**. One component, `PowerCardDialog`, in two
modes:

| Card state | Dialog |
|---|---|
| Yours, legal, your turn | Name, what it does, its rulings, and **Play card** / Cancel |
| Yours but not legal right now | The same explanation, read-only, headed by the reason from `canPlayPowerCard` (*"Only before you place a tile this turn"*) |
| Already spent, or an opponent's | The same explanation, read-only, marked spent or attributed to that player |

A click therefore **always** explains and never dead-ends — this is the primary way a player learns what
the five cards do, which is why the epic needs no tutorial chapter to ship. On desktop, hovering gives a
one-line summary so the common case needs no dialog at all. The play-mode dialog always ends with
*"This card is spent as soon as you play it, even if you change your mind."*

### New components (`src/components/game/`)

- **`PowerCardBar.tsx`** — the five cards in fixed order, each `spent` / `available` / `blocked`
  (legal-but-not-now). Hidden entirely when `rulesSnapshot.powerCards === 'off'`.
- **`PowerCardDialog.tsx`** — the expansion described above, shared by your bar and by opponents' pips.
- **`PowerTradePanel.tsx`** — inside the buy phase when `stock_trade` is active: pick 2 shares to give,
  1 chain to receive, "Trade (n/3)". Disabled chains carry their reason (not active, bought this turn,
  bank empty).

### Modified components

- **`PlayerCard.tsx`** — a compact row of remaining card pips per opponent, each opening the read-only
  dialog. Public information, so it renders for every seat regardless of `cashVisibility`.
- **`StockPurchase.tsx`** — allowance from `getRemainingStockAllowance` (already the case; it just stops
  being a constant), prices struck through and shown as **Free** while `free_stock` is active, and a
  banner naming the active card.
- **`PlayerHand.tsx`** — the 3-column grid (`PlayerHand.tsx:36`) already wraps 11 tiles into four rows,
  so the tiles themselves are fine. Two things are not: the empty-slot filler is hardcoded to
  `6 - tiles.length` (`:71`) and must read the room's hand limit, and a four-row hand plus the card bar
  makes the rail tall enough to push End Turn below the fold on a laptop — so the bar stays a single
  row of icons and the hand keeps its own bounds rather than growing the column without limit.
- **`GameContainer.tsx`** — mounts the bar and dialog, and renders **"Done placing (n/4)"** during a
  spree next to the board.
- **`GameLog.tsx`** — every card play, every trade and every free purchase is logged. No new component,
  but the entries must be written server-side by each handler.

---

## User Stories

### Foundation

**Story 17.0 — Power-card rule, ids and constants**
Add `powerCards` to `CustomRules`/`DEFAULT_RULES` (default `'off'`), `PowerCardId`/`POWER_CARDS` and the
five limit constants; extend `RULE_VALUES`, `describeRules()` and `server/lib/rules.ts`'s re-exports.
- ✅ A v1 blob and a pre-Epic-17 v2 blob both normalise to `powerCards: 'off'`
- ✅ `validateRules` rejects `powerCards: 'yes'` with a 400
- ✅ `describeRules` shows a Power Cards line
- ✅ `DEFAULT_RULES` still exists in exactly one file

**Story 17.1 — Refill the hand to the limit instead of drawing one tile** *(blocking prerequisite for 17.7 and 17.9)*
Extract `refillHand(tiles, bag, limit)` into `server/lib/players.ts` and use it at all three turn-end
sites (`buy_stocks:1321`, `skip_buy:1481`, `auto_end_turn`). `limit = parseInt(rules.startingTiles)`.
Draws nothing when the hand is at or above the limit, and stops early when the bag runs dry.
- ✅ Normal play is byte-identical to today: place 1, refill draws exactly 1
- ✅ A hand above the limit draws nothing
- ✅ An empty bag ends the turn cleanly instead of throwing
- ✅ All three turn-end paths share the one helper — no fourth copy of `tileBag.pop()`
- ✅ Existing tests pass unchanged

**Story 17.2 — Schema, dealing, and public visibility**
Add the three columns (migration + `schema.sql`), deal `POWER_CARDS` to every seat in the game-start
branch (`toggle_ready`, `game-action.ts:297`) when the rule is on and `'{}'` when off, expose
`power_cards` through `game_players_public` and `get_players`, and map it into `PlayerState`.
- ✅ A game started with the rule on gives all five cards to every seat, bots included
- ✅ A game started with the rule off gives everyone `'{}'`
- ✅ `new_game` re-deals a full set
- ✅ The legacy `start_game` handler (unreferenced by the client and already ignoring custom rules — it
     hardcoded a 9×12 board, $6000 and 6 tiles) is **deleted**, along with its dead `startGame` client
     helper, rather than taught to deal cards it would have dealt into a game with the wrong rules
- ✅ Every player can see every other player's remaining cards; nobody can see another player's tiles
- ✅ The migration is idempotent and safe to run against a live DB

**Story 17.3 — `play_power_card` and the shared legality helper**
Implement `canPlayPowerCard()` and the action: it verifies the rule is on, the turn, the phase, that the
card is still held, that no card is active, and the per-card precondition; it then removes the card,
writes `active_power_card`, logs the play and fans out.
- ✅ Playing a second card in one turn is rejected (409) even under a double-click race
- ✅ Playing a card you have already spent is rejected
- ✅ Playing a card on someone else's turn is rejected (403)
- ✅ Playing any card with the rule off is rejected
- ✅ The card is gone from `power_cards` even if the player then does nothing with it
- ✅ `active_power_card` and `tiles_placed_this_turn` reset at every one of the three turn ends

**Story 17.4 — Keep the turn open while a card is still playable**
Add `canPlayAnyPowerCard()` beside `canPlayPowerCard()`, including the per-card "has an available use"
predicate, and add it as a third term to both auto-end gates: the server's `canBuyMore` branch
(`game-action.ts:1296`) and the client's auto-end effect (`GameContainer.tsx:124-129`). Extend the
End Turn confirmation to name a playable card that is about to be forfeited.
- ✅ A turn with nothing affordable and Free Shares still in hand does **not** auto-end
- ✅ Spending the full buy allowance with Stock Trade still in hand does **not** auto-end
- ✅ A player holding only Stock Trade but no tradeable shares still gets today's auto-end
- ✅ A player holding only `extra_tiles` / `multi_tile` still gets today's auto-end in `buy_stock`
- ✅ With the rule off, auto-end behaviour is byte-identical to today
- ✅ With every card spent, auto-end behaviour is byte-identical to today
- ✅ The End Turn confirmation names a playable card the player is about to forfeit
- ✅ Server and client agree on the gate — the client never auto-ends a turn the server would keep open

### The cards

**Story 17.5 — Extra Purchase**
Introduce `getStockAllowance()` and route both engines' buy caps and auto-end checks through it.
- ✅ 5 shares can be bought across multiple incremental purchases in one turn
- ✅ The 6th is rejected
- ✅ The buy panel stays open through shares 4 and 5 instead of auto-ending at 3
- ✅ Holding the card unplayed keeps the turn open rather than auto-ending it (17.4)
- ✅ The sell allowance is still 3
- ✅ Rejected if the player has already bought this turn

**Story 17.6 — Free Shares**
Zero the cost in `buy_stocks` while active, and skip the affordability half of the auto-end check.
- ✅ 3 shares are taken with no change in cash
- ✅ The cap is still 3 — the card does not stack into 5
- ✅ A player with $0 can still take their 3 shares
- ✅ A turn where nothing is affordable stays open so the card can be played at all (17.4)
- ✅ Bank and chain-active validation still apply
- ✅ Free shares still land in `chains_bought_this_turn`
- ✅ Rejected if the player has already bought this turn

**Story 17.7 — Extra Tiles** *(depends on 17.1)*
Draw 5 immediately at play time.
- ✅ Hand goes 6 → 11 the moment the card is played, this turn
- ✅ End-of-turn refill draws nothing while the hand is above the limit
- ✅ Drawing resumes only once the hand is back below the limit — five turns later in a default room
- ✅ A bag with 2 tiles left gives 2, not an error; an empty bag refuses the card
- ✅ Rejected once a tile has been placed this turn
- ✅ `discard_tile` is still a 1-for-1 swap on an 11-tile hand

**Story 17.8 — Stock Trade**
`settleTrade()` in `server/lib/rules.ts` plus the `power_trade` action.
- ✅ 2 shares out, 1 in; both directions restricted to chains active on the board
- ✅ The 2 given may span two chains
- ✅ Three trades allowed, the fourth rejected
- ✅ A chain bought this turn cannot be given away; a chain received is added to `chains_bought_this_turn`
- ✅ Receiving from an empty bank is rejected
- ✅ Trading does not consume the buy allowance — 3 shares are still buyable afterwards
- ✅ Trading never ends the turn and never changes the phase
- ✅ An unspent allowance of trades keeps the turn open; no tradeable shares does not (17.4)
- ✅ Defunct chains are refused on both sides

**Story 17.9 — Building Spree** *(depends on 17.1)*
`phaseAfterPlacement()` plus the `end_placements` action.
- ✅ Four tiles can be placed in one turn; the fifth is refused
- ✅ A merger on tile 2 is fully resolved — survivor, bonuses, every player's stock decision — before
     tile 3 can be placed
- ✅ A chain founded on tile 1 runs `found_chain` and returns to `place_tile`
- ✅ Exactly one buy step runs, after the last placement
- ✅ "Done placing" ends the sequence early and is refused before the first placement
- ✅ Running out of playable tiles moves to `buy_stock` without showing the unplayable-tile modal
- ✅ An end-game condition met on tile 2 ends nothing (Epic 18 shipped first): the spree continues and
     only a declaration ends the game, at the end of the turn
- ✅ End-of-turn refill draws back up to the limit, up to 4 tiles
- ✅ Rejected once a tile has been placed this turn

### Client

**Story 17.10 — Power card bar, dialogs and opponent visibility**
- ✅ The bar is hidden entirely when the rule is off
- ✅ Spent cards render as spent and cannot be clicked
- ✅ An illegal-right-now card is disabled and its tooltip gives the server's reason
- ✅ Each dialog states the effect and that the card is spent on play
- ✅ The bar sits in the right rail between your tiles and End Turn, visible in both phases
- ✅ Clicking any card — yours, blocked, spent, or an opponent's — opens a dialog explaining it
- ✅ Only the legal-right-now dialog offers **Play card**; every other state is read-only with a reason
- ✅ Opponents' remaining cards are visible on their player cards and open the same read-only dialog
- ✅ An 11-tile hand plus the bar still leaves End Turn reachable without hunting on a laptop viewport
- ✅ The empty-tile-slot filler follows the room's hand limit instead of a hardcoded 6
- ✅ Every card play appears in the game log for all players

**Story 17.11 — Buy-phase UI for the three economic cards**
- ✅ The allowance display reads 5 under Extra Purchase
- ✅ Prices show as **Free** under Free Shares and cash does not move
- ✅ The trade panel enforces give-2 / receive-1 and shows the trade counter
- ✅ Disabled chains in the trade panel say why
- ✅ Selling (Epic 14) still works alongside all three

**Story 17.12 — Bots** *(hard only)*
Hard bots play cards; **easy and medium hold theirs for the whole game**, and that is deliberate — the
three difficulties were just reworked to be genuinely distinct (`f87c5e2`), and "knows when to spend a
one-shot resource" is exactly the kind of judgement that should separate hard from medium. One
heuristic per card in `server/lib/bot.ts`, each a single guarded rule rather than a search:
Free Shares when cash is short of the priciest chain it leads; Extra Purchase when it can afford 5 in a
chain it leads and the bank still has them; Extra Tiles when its hand has one or fewer playable tiles;
Building Spree when it holds two or more placements that each score above its growth threshold; Stock
Trade when it holds 2+ shares in chains it cannot win.
- ✅ Hard bots play at most one card per turn and never an illegal one
- ✅ Easy and medium bots finish a game with all five cards
- ✅ A room of hard bots completes a full game with the rule on, with no rejected moves in the log
- ✅ `driveBotsLoop`'s retry/fallback path is untouched

**Story 17.13 — Turn timer, disconnect and rejoin**
- ✅ One turn deadline covers the whole turn including a 4-tile spree
- ✅ `auto_end_turn` on an expired timer mid-spree ends the turn from wherever it is, refills the hand,
     and does not force another placement
- ✅ A card played and then abandoned by a disconnect stays spent
- ✅ Rejoining mid-turn restores the active card, the trade counter and the placement counter
- ✅ An in-flight game started before this deploy is unaffected in every respect

**Story 17.14 — Lobby rule control**
- ✅ Power Cards is a Basic switch, default off
- ✅ The lobby rules panel and the in-game summary both show its state
- ✅ Editing it in the waiting room propagates to every player
- ✅ It is frozen into `rules_snapshot` at game start and cannot change mid-game

---

## Risks

| Risk | Mitigation |
|---|---|
| **The one-tile-per-turn assumption is wired into four exits**, and missing one leaves a turn stuck in `place_tile` forever | One shared `phaseAfterPlacement()`; a test that walks each of the four exits (grow, isolated, found, merger) with the card active and asserts the phase |
| The "draw one tile" refactor silently changes normal play | Story 17.1 ships alone, ahead of every card, with tests asserting byte-identical behaviour at the limit |
| A merger mid-spree interleaves with the next placement | The phase machine already blocks it; the spree edge is only added at `completeMergerInDb`'s exit, after the merger is finished. Explicit test with a merger on tile 2 of 4 |
| Free Shares becomes a cash pump via Epic 14 selling | Free shares are added to `chains_bought_this_turn`, so they cannot be sold back the same turn |
| Stock Trade launders shares around the sell restriction | The guard applies to both sides of a trade — give side blocked for chains bought this turn, receive side added to the list |
| A double-clicked card is played twice | Server rejects when `active_power_card` is non-null; the card is removed in the same write |
| Bots deadlock or spam rejected moves with cards on | Only hard bots play cards, each behind a single guard; `canPlayPowerCard` is the same gate the server uses, so a bot cannot propose an illegal play |
| An 11-tile hand plus the card bar pushes End Turn below the fold in the 320px rail | The tile grid already wraps; Story 17.10 keeps the bar to one row and fixes the hardcoded 6-slot filler, and the laptop viewport is an explicit acceptance criterion |
| **The migration is not applied automatically** — `deploy.sh` never runs `schema.sql` | All three statements are `IF NOT EXISTS` with defaults that mean "rule off"; add to the v2.0.0 launch checklist beside the Epic 14 and 15 migrations |
| **The buy phase auto-ends before a card can be played** — worst on exactly the turn Free Shares is for | Story 17.4 adds the third term to both gates, mirroring Epic 14's `canSellAnything`; the per-card "has a use" predicate stops the opposite failure, a turn that never ends on its own |
| Server and client disagree about whether a turn should stay open, so the client ends a turn the server would have kept | Both read the same `canPlayAnyPowerCard`, the same way both already read `canBuyMoreStock` |
| **Epic 18 rewrites the same end-game call sites in the opposite direction** | Resolved: [Epic 18](./Epic-18-end-game-declaration.md) shipped first, deleting the six auto-end checks, so Story 17.9's end-game ruling was dropped rather than inverted and Story 17.4 only had to add a term to an existing gate |
| The rule changes an in-flight game | Default `'off'`, snapshotted at game start, and absent keys normalise to `'off'` — covered by a test on a real pre-epic blob |

---

## Verification

```bash
psql "$DATABASE_URL" -f db/migrations/2026-09-06-epic17-power-cards.sql   # manual, once
npx vitest run                 # unit: canPlayPowerCard, settleTrade, refillHand, phaseAfterPlacement
npm run build
cd server && npm run build
npm run lint
```

Manual, two browsers plus a hard bot, against a local stack (`/local-preview`):

1. Create a room with **Power Cards on**; both clients show five cards for every seat.
2. **Extra Purchase** — buy 5 across two clicks; the 6th is refused; the card shows spent for both players.
3. **Free Shares** — with cash deliberately spent down, take 3 shares for $0; confirm the cap is still 3
   and that those chains cannot be sold this turn.
4. **Stock Trade** — three trades, one of them giving 1 share each from two different chains; confirm
   3 shares are still buyable afterwards and the fourth trade is refused.
5. **Extra Tiles** — hand goes to 11; play five further turns and confirm no tile is drawn until the
   hand is back to 6.
6. **Building Spree** — place 4 tiles, arranging for tile 2 to trigger a merger; confirm the merger
   resolves completely (including the other player's stock decision) before tile 3, that only one buy
   step follows, and that the hand refills by 4.
7. **Done placing** after 2 of 4 tiles.
8. **Auto-end** — spend down to no affordable share while holding Free Shares: the turn stays open and
   the card is playable. Then spend the card and confirm the turn auto-ends as usual. Repeat holding
   only Building Spree, which should auto-end immediately.
9. **Timer** — turn on a 30s timer, start a spree, let it expire; the turn ends cleanly.
10. **Rejoin** — reload mid-spree; the placement counter and active card survive.
11. **Regression** — a room with Power Cards **off** plays exactly as before, and a game started on
    `main` before the deploy resumes with no visible change.
