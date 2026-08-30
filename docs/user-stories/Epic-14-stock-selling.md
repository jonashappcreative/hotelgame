# Epic: Stock Selling Game Mode

**Epic ID:** Epic 14
**Feature:** Custom Room Rules — Stock Selling
**Priority:** Medium
**Created:** 2026-08-30
**Status:** Ideation — mode selection pending

---

## Executive Summary

Add an optional game mode, activated from the Custom Rules screen when creating a room, in which
players may **sell** stock back to the bank as well as buy it. Today the game is buy-only: cash
converts into shares and never converts back until a merger liquidates a defunct chain or the game
ends. This epic presents three distinct mechanical designs for a voluntary selling mechanic,
recommends one, and specifies it down to implementation-ready user stories.

## Product Vision

A player who reads the board early and commits cash to the right chain should be rewarded — but a
player who reads it *wrong* should have a way back, at a price. Selling turns every purchase into a
reversible bet with a cost, opening a second strategic axis: not just *what do I buy*, but *when do I
get out, and what does getting out cost me*.

---

## Current Behaviour (what exists today)

| Aspect | Today |
|---|---|
| Buying | During the `buy_stock` phase, max 3 shares per turn (`MAX_STOCKS_PER_TURN`), counted in `stocksPurchasedThisTurn` |
| Price | Pure function of chain size and tier — `getStockPrice(chain, size)` over `CHAIN_SIZE_BRACKETS` / `BASE_PRICES` |
| Voluntary selling | **Does not exist anywhere** |
| Involuntary selling | Merger defunct-chain disposal (`merger_stock_choice`: sell / trade 2:1 / keep) and end-of-game liquidation in `calculateFinalScores` |
| Bank | `stockBank: Record<ChainName, number>`, 25 shares per chain (`STOCKS_PER_CHAIN`) |

The merger disposal path is the closest existing analogue and is the model to copy for pricing,
validation shape and UI feel — see `src/components/game/MergerStockDecision.tsx` and the
`merger_stock_choice` case in `server/api/game-action.ts`.

---

## Mode A — "Open Market"

### Concept
Selling is simply buying in reverse. The bank always stands ready to buy your shares back at the
same price it sells them for. Maximum simplicity, zero new economics.

### Mechanics
Selling happens inside the existing `buy_stock` phase — **no new `GamePhase` is introduced**. Buys
and sells draw from one shared per-turn budget. Sold shares return to `stockBank` immediately and are
re-buyable by the next player.

### Sell Price
**Full current market price**, identical to the buy price: `getStockPrice(chain, currentSize)`.
Sell 2 Tower at a 7-tile chain and you receive exactly what the next player would pay for them.

### Price Fluctuation
**None.** `CHAIN_SIZE_BRACKETS` and `BASE_PRICES` are untouched. A share's price is still a pure
function of its chain's tile count.

### Timing & Limits
- **3 transactions per turn, shared** between buying and selling — buy 3, or sell 3, or buy 2 + sell 1.
- Any time during your own `buy_stock` phase, before ending the turn.
- Sell proceeds are spendable on the same turn.
- Guard rail: you may not buy and sell the *same chain* on the same turn.

### What It Looks Like
The existing `StockPurchase.tsx` stepper grid gains a second, red **Sell** stepper on each chain row
that you hold shares in. One confirm button commits the whole basket. The running total shows a net
figure that can be positive (net seller) or negative (net buyer).

### Cost & Risk
Cheapest of the three to build — one new server action, one price lookup, no new state beyond a
counter. The design risk is economic: at a zero spread, capital is never really committed. A player
can hold a majority position all game and unwind it costlessly the moment it stops paying, which
takes real tension out of Acquire's central bet.

---

## Mode B — "Broker's Cut" ⭐ Recommended

### Concept
The bank buys your shares back, but not at what it sold them for. The spread between the buy price
and the sell price is the cost of liquidity — cash is always available in an emergency, and it always
costs you something to get it.

### Mechanics
Selling happens inside the existing `buy_stock` phase — **no new `GamePhase`**. Buying and selling
have *separate* per-turn allowances, so a turn can be a real portfolio rebalance rather than an
either/or. Sold shares return to `stockBank`.

### Sell Price
**Market price × sell factor**, rounded down to the nearest 10. The factor is chosen by the room
creator in the lobby:

| Setting | Factor | Feel |
|---|---|---|
| Full Value | 100% | No spread — this *is* Mode A |
| Broker | 90% | Light friction, mostly a convenience |
| Standard | 75% (default) | Selling is a real decision |
| Fire Sale | 50% | Selling is a last resort |

Example at 75%: a 7-tile Continental share buys at $700 and sells at $520.

### Price Fluctuation
**None.** Deterministic and legible — the sell price is always a fixed fraction of the number already
displayed on the chain card.

### Timing & Limits
- **Up to 3 shares bought AND up to 3 shares sold per turn** (independent counters).
- Any time during your own `buy_stock` phase; order is free, so you can sell first and spend the
  proceeds on the same turn's purchases.
- Guard rail: shares bought this turn cannot be sold this turn.

### What It Looks Like
A **Buy / Sell** segmented control sits above the existing stepper grid. The Sell view lists only
chains you hold, each row showing *shares held · market price · you receive · spread lost*, with a
running "Proceeds $X (spread −$Y)" summary above the confirm button. The spread is shown before
confirming, never after.

### Cost & Risk
Moderate build: one new custom rule, one new server action, one new turn counter, one UI mode. The
price tables, the scoring path and the phase machine are all untouched. **Mode A is a strict subset**
— shipping the 100% option delivers it as a lobby setting rather than a second build. The main risk
is presentational: if the discount is not obvious before the player confirms, it reads as a bug.

---

## Mode C — "Market Volatility"

### Concept
Prices stop being a pure function of chain size. What players *do* moves the market: heavy buying
drives a chain's price up, heavy selling drives it down, and the market corrects toward fundamentals
over time. Dumping a position depresses what you get for the last share of it.

### Mechanics
A new per-chain value, `marketPressure: Record<ChainName, number>`, clamped to −2 … +2 bracket steps
and stored as a new JSONB column on `game_states`.

- Every share bought adds pressure; every share sold removes it. **3 net shares = 1 bracket step.**
- At the start of each round, every chain's pressure **decays one step toward 0** — the market
  correction. Logged as a "Market Report" entry.
- **Trade price** = the tier price at `bracket(size) + pressureShift`, clamped inside the tier's table.

### Sell Price
The **live trade price** — which the act of selling itself pushes down. Selling 3 shares of a chain
knocks it down a bracket, so the third share is worth less than the first. Buying works the same way
in reverse and gets more expensive as you accumulate.

### Price Fluctuation
**Yes — this is the whole point of the mode.**

> **Deliberate simplification:** market pressure applies to **trade prices only** (buying and
> selling). Merger bonuses and end-of-game liquidation keep using the pure size-based price. This
> keeps the change out of the scoring path. Extending pressure to bonuses and final scoring is a
> credible Phase 2, but it changes the value of every position in the game and needs its own
> balancing pass.

### Timing & Limits
- **3 transactions per turn, shared** between buying and selling.
- **Per-chain cap of 2 shares sold per turn**, so no single turn can crater a chain.
- Any time during your own `buy_stock` phase.

### What It Looks Like
A **market ticker strip** above the board: each active chain with its live price and a ▲ / ▼ / —
indicator plus the delta against its base price. The stepper grid shows the live price, with the base
price struck through when pressure is non-zero. End-of-round market corrections appear in the game
log.

### Cost & Risk
By far the largest build. `getStockPrice` is duplicated across `src/utils/gameLogic.ts` and
`server/lib/rules.ts` and is called from roughly eight sites including `getBonuses`,
`getStockholderRankings` and `calculateFinalScores`; introducing a second price concept means auditing
every one of them for which price it should use. Highest flavour, highest chance of destabilising
scoring, and it needs playtesting to tune the pressure and decay constants.

---

## Comparison

| | **A — Open Market** | **B — Broker's Cut** ⭐ | **C — Market Volatility** |
|---|---|---|---|
| Shares sellable per turn | 3, shared with buys | 3, separate from buys | 3 shared, max 2 per chain |
| Sell price | 100% of market | 50–90% of market (configurable) | Live price, moves as you trade |
| Price fluctuation | None | None | Yes — supply-driven, decays each round |
| When you can sell | Own `buy_stock` phase | Own `buy_stock` phase | Own `buy_stock` phase |
| New `GamePhase` | No | No | No |
| New DB column | `stocks_sold_this_turn` | `stocks_sold_this_turn` | `stocks_sold_this_turn` + `market_pressure` |
| Touches scoring path | No | No | Only if extended in Phase 2 |
| Strategic depth added | Low | Medium | High |
| Build size | Small | Medium | Large |
| Balance risk | Medium — removes commitment | Low | High — needs playtesting |

---

## Recommendation

**Build Mode B — "Broker's Cut".**

1. It is the only one of the three that adds a genuine *decision* — is liquidity worth the spread? —
   rather than just a new button.
2. The spread is what stops selling from deflating the game. Without it, capital is never committed
   and the core Acquire bet loses its teeth; with it, getting out is always possible and never free.
3. **It contains Mode A.** Ship the sell factor with a `100` option and "Open Market" becomes a lobby
   setting, not a second implementation. Rooms that want frictionless trading get it for free.
4. It leaves the price tables, the scoring path and the phase machine alone, which keeps the change
   auditable and the regression surface small.

Mode C is documented above as the Phase 2 evolution. It should not be attempted until Mode B has been
played enough to know whether the group actually wants price movement.

The user stories below specify **Mode B only**.

---

## Technical Stack

- **Frontend:** React 18 + TypeScript + Vite, Tailwind, shadcn/ui, Framer Motion
- **Backend:** Hono + Socket.IO in one process (`server/`), self-hosted Postgres, deployed on Hetzner
- **Authority:** server-only. `server/api/game-action.ts` is the sole mutator for online games; the
  client has no reducer and refetches on `game:state_updated`
- **Tests:** Vitest (`pool: "forks"`)

> **Keep in sync:** the rules engine is duplicated. `src/utils/gameLogic.ts` drives local hot-seat play
> and all client-side UI derivations; `server/lib/rules.ts` + `server/api/game-action.ts` are the
> authoritative online engine. `server/lib/rules.ts` carries an explicit *"Mirror of
> src/types/game.ts CustomRules — keep in sync"* comment. Every constant and helper touched below
> exists in two copies.

---

## Custom Rule Specification

Follows the existing stringly-typed `*Enabled` + value pattern used by every other custom rule.

```ts
// src/types/game.ts — CustomRules, and mirrored in server/lib/rules.ts
stockSellingEnabled: boolean;   // DEFAULT_RULES: false
sellPriceFactor: string;        // '100' | '90' | '75' | '50' — DEFAULT_RULES: '75'
```

`game_rooms.custom_rules` and `game_states.rules_snapshot` are both schemaless JSONB, and
`toggle_ready` merges `{ ...DEFAULT_RULES, ...room.custom_rules }` before freezing the snapshot — so
**the rule itself needs no migration**. Existing rooms fall back to `stockSellingEnabled: false`.

Server-side getter, placed beside the existing `getSafeChainSize` / `getBonusTier` in
`server/lib/rules.ts`:

```ts
export function getSellPriceFactor(rules: CustomRules): number {
  if (!rules.stockSellingEnabled) return 0;      // 0 = selling disabled
  return parseInt(rules.sellPriceFactor) / 100;
}

export function getSellPrice(chainName: ChainName, size: number, factor: number): number {
  return Math.floor((getStockPrice(chainName, size) * factor) / 10) * 10;
}
```

---

## Epic 14: Stock Selling (Mode B)

### User Story 14.1: Custom Rule — Enable Stock Selling

**As a** room creator,
**I want** to enable stock selling and choose how much the bank pays for shares it buys back,
**so that** I can offer my group a game with a real exit option without giving away free liquidity.

#### Acceptance Criteria
- [ ] The Custom Rules screen shows a **Stock Selling** toggle, off by default, with an `InfoTooltip`
      explaining the spread.
- [ ] When enabled, a `Select` appears with: `Full Value — 100% of market price`,
      `Broker — 90%`, `Standard — 75% (Default)`, `Fire Sale — 50%`.
- [ ] The rules summary badge list includes `💱 Sell at {n}%` when the rule is enabled.
- [ ] The setting is persisted to `game_rooms.custom_rules` on room creation and frozen into
      `game_states.rules_snapshot` when the game starts.
- [ ] Joining players see the setting via the existing `fetchRoomRules(roomId)` path before readying up.
- [ ] Changing the setting marks the draft dirty, so the existing back-navigation warning fires.

#### Implementation Tasks
- [ ] **`src/types/game.ts`**: add `stockSellingEnabled` and `sellPriceFactor` to `CustomRules` and
      `DEFAULT_RULES`.
- [ ] **`server/lib/rules.ts`**: mirror both fields in its `CustomRules` and `DEFAULT_RULES`; add
      `getSellPriceFactor(rules)` and `getSellPrice(chain, size, factor)`.
- [ ] **`src/components/game/OnlineLobby.tsx`**: add the toggle block in the `mode === 'customRules'`
      screen, following the Bonus Payment Tiers block; add the entry to `getActiveRulesSummary`.
- [ ] No change needed to `hasCustomRulesChanged` — it deep-compares against `DEFAULT_RULES`.

#### Test Cases
In `server/lib/rules.test.ts` (**new file** — `server/lib/bot.test.ts` is currently the only server-side test file):
- `getSellPriceFactor` returns `0` when `stockSellingEnabled` is false, regardless of `sellPriceFactor`.
- `getSellPriceFactor` returns `0.75` for `'75'`.
- `getSellPrice('continental', 7, 0.75)` returns `520` (700 × 0.75 = 525 → floored to 520).
- `getSellPrice(chain, size, 1)` equals `getStockPrice(chain, size)` for every chain and bracket.

#### Dependencies
- None. This is the foundation story.

---

### User Story 14.2: Server — `sell_stocks` Action

**As a** player in a room with stock selling enabled,
**I want** my sale to be validated and settled by the server,
**so that** nobody can sell shares they don't own or invent cash.

#### Acceptance Criteria
- [ ] A new `sell_stocks` action accepts `{ sales: { chain: ChainName; quantity: number }[] }`.
- [ ] Rejects with 400 when `rulesSnapshot.stockSellingEnabled` is false.
- [ ] Rejects with 403 when it is not the caller's turn; with 400 when `phase !== 'buy_stock'`.
- [ ] Rejects when the player holds fewer shares of a chain than they are selling.
- [ ] Rejects when `stocksSoldThisTurn + total > MAX_STOCKS_PER_TURN`.
- [ ] Rejects any chain the player bought shares of **this turn** (see 14.3).
- [ ] On success: player `cash` increases by `Σ getSellPrice(chain, size, factor) × qty`, player
      `stocks` decrease, `stockBank[chain]` increases by the same amounts, and `stocksSoldThisTurn`
      increases.
- [ ] Selling never ends the turn and never changes the phase.
- [ ] Selling a chain's shares can flip majority/minority standing, and that is intended — no
      protection for the outgoing majority holder.

#### Implementation Tasks
- [ ] **`server/api/game-action.ts`**: add `sell_stocks` to the `GameActionRequest` union and a new
      `switch` case modelled directly on the existing `buy_stocks` case (~line 1176), reusing its
      turn/phase guard shape.
- [ ] Use `getSellPriceFactor(rules)` once per request, alongside the existing `globalBonusTier`
      derivation.
- [ ] Write an entry to `game_log` per sale: `"{name} sold {qty} {Chain} for ${amount}"`.
- [ ] Call the existing `notifyForAction()` fan-out so all clients refetch.

> **Write ordering — there are no DB transactions in `game-action.ts`.** Update `game_players` first,
> setting `cash` and `stocks` **in a single row update** (atomic for the player), then update
> `game_states.stock_bank`. A partial failure can then only under-return shares to the bank; it can
> never duplicate cash or shares. Log a warning if the second write fails.

#### Test Cases
In `server/lib/rules.test.ts` (pure pricing) and, if the settlement logic is extracted into a testable
helper, a new `server/api/sell-stocks.test.ts`:
- Selling more shares than held is rejected.
- Selling 2 when 2 were already sold this turn is rejected (cap is 3).
- Selling a chain bought this turn is rejected.
- Cash delta equals the sum of `getSellPrice` per share.
- `stockBank` total per chain is conserved: `bank + Σ player holdings === 25` after any sale.

#### Dependencies
- STORY 14.1, STORY 14.3.

---

### User Story 14.3: Per-Turn Sell Allowance and Same-Turn Guard

**As a** player,
**I want** selling to have its own per-turn budget,
**so that** a turn can be a genuine rebalance without eating into what I can buy.

#### Acceptance Criteria
- [ ] `stocksSoldThisTurn` tracks shares sold in the current turn, independent of
      `stocksPurchasedThisTurn`.
- [ ] Both counters reset to 0 at every turn transition.
- [ ] `chainsBoughtThisTurn` records which chains were bought this turn, so 14.2 can block selling them.
- [ ] Both survive a page refresh — they are server state, not client state.

#### Implementation Tasks
- [ ] **`db/schema.sql`**: add `stocks_sold_this_turn INTEGER NOT NULL DEFAULT 0` and
      `chains_bought_this_turn TEXT[] DEFAULT '{}'` to `game_states`, beside the existing
      `stocks_purchased_this_turn`. Both need a matching `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
      migration for the live database.
- [ ] **`server/api/game-action.ts`**: reset both at **every** existing
      `stocks_purchased_this_turn: 0` write site — there are **four** of them (`buy_stocks`, `skip_buy`,
      `auto_end_turn`, and `completeMergerInDb`); grep to confirm before editing. Missing one leaks
      allowance across turns.
- [ ] **`server/api/game-action.ts`** (`buy_stocks` case): append purchased chains to
      `chains_bought_this_turn`.
- [ ] **`src/types/game.ts`**: add `stocksSoldThisTurn: number` and `chainsBoughtThisTurn: ChainName[]`
      to `GameState`.
- [ ] **`src/utils/multiplayerService.ts`** (`dbToGameState`): map both new columns.
- [ ] **`src/utils/gameLogic.ts`**: add `getRemainingSellAllowance(state)` mirroring the existing
      `getRemainingStockAllowance`, and `canSellStock(state, playerIndex)` mirroring `canBuyMoreStock`.

#### Test Cases
In `src/utils/gameLogic.test.ts`:
- `getRemainingSellAllowance` returns 3 at turn start, 1 after two shares sold, 0 at three.
- `canSellStock` is false when the player holds no shares, when the rule is disabled, and when the
  allowance is exhausted.
- `canSellStock` is false for a player whose only holdings are chains in `chainsBoughtThisTurn`.

#### Dependencies
- STORY 14.1.

---

### User Story 14.4: Buy / Sell Trading Panel

**As a** player,
**I want** to see exactly what I will receive and what the spread costs me before I confirm,
**so that** the discount never surprises me.

#### Acceptance Criteria
- [ ] When the rule is enabled, a **Buy / Sell** segmented control appears above the stepper grid.
      When disabled, the panel is unchanged from today.
- [ ] The Sell view lists only chains the player holds shares in, each row showing shares held,
      market price, per-share sale price, and a stepper capped at `min(shares held, sell allowance)`.
- [ ] Chains bought this turn appear disabled with the reason "Bought this turn".
- [ ] A summary line reads `Proceeds $X · spread −$Y` and updates live.
- [ ] The confirm button is disabled when nothing is selected.
- [ ] Uncommitted sell selections are reported through the existing `onPendingChange` hook so the
      End Turn warning covers them too.
- [ ] Switching between Buy and Sell tabs preserves each tab's pending selections.

#### Implementation Tasks
- [ ] **`src/components/game/StockPurchase.tsx`**: add a `mode: 'buy' | 'sell'` state, a
      `sellSelections` record parallel to the existing `selections`, and a `getTotalProceeds()`
      alongside `getTotalCost()`. Reuse `getStockPrice` and the new `getSellPrice` helper rather than
      recomputing prices inline.
- [ ] Extend `StockPurchaseProps` with `onSell: (sales: { chain: ChainName; quantity: number }[]) => void`.
- [ ] Follow the value-preview pattern from `src/components/game/MergerStockDecision.tsx`, which
      already renders an "After this decision" portfolio summary.

#### Test Cases
In `src/components/game/StockPurchase.test.tsx` (**new file**):
- The Buy/Sell control is absent when `stockSellingEnabled` is false.
- The Sell view omits chains with zero holdings.
- The sell stepper caps at the smaller of holdings and remaining allowance.
- The proceeds and spread figures match `getSellPrice` for the selected basket.

#### Dependencies
- STORY 14.3.

---

### User Story 14.5: Client Wiring

**As a** player,
**I want** my sale to reach the server and the result to appear immediately,
**so that** the panel reflects reality.

#### Acceptance Criteria
- [ ] Confirming a sale calls `executeGameAction('sell_stocks', roomId, { sales })` and then
      `refreshGameState()`.
- [ ] A rejected sale surfaces the server's error message as a toast and leaves the selection intact
      for correction.
- [ ] The optimistic "not your turn" guard used by the other handlers applies here too.

#### Implementation Tasks
- [ ] **`src/hooks/useOnlineGame.ts`**: add `handleSellStocks`, modelled on the existing
      `handleBuyStocks` (one of the per-action handlers around lines 351–592).
- [ ] **`src/components/game/GameContainer.tsx`**: pass `onSell` through to `StockPurchase`.
- [ ] No change to `executeGameAction` — it already takes an arbitrary action name and payload.

#### Test Cases
In `src/hooks/useOnlineGame.test.ts` (**new file**):
- `handleSellStocks` is a no-op when it is not the local player's turn.
- A 400 response leaves local state untouched and raises a toast.

#### Dependencies
- STORY 14.2, STORY 14.4.

---

### User Story 14.6: Sales Are Public

**As an** opponent,
**I want** to see who sold what and for how much,
**so that** I can read the table and react.

#### Acceptance Criteria
- [ ] Every sale writes a `GameLogEntry` visible to all players: `"Anna sold 2 Tower for $740"`.
- [ ] Opponent share counts update for everyone immediately after a sale.
- [ ] The bank's available-share count for the chain updates for everyone immediately.
- [ ] Sale proceeds respect the existing **Cash Visibility** rule: when cash is hidden, the log shows
      the sale but opponents still cannot see the seller's resulting balance.

#### Implementation Tasks
- [ ] **`server/api/game-action.ts`**: append the log entry inside the `sell_stocks` case.
- [ ] Verify the existing `game_players_public` / `game_states_public` views expose `stocks` and
      `stock_bank` — they do; no view change is required.

#### Test Cases
- Manual: two browsers, sell in one, confirm the log line and share counts in the other without a
  refresh.

#### Dependencies
- STORY 14.2.

---

### User Story 14.7: Turn-End Interaction

**As a** player,
**I want** the turn not to end underneath me while I still have something to sell,
**so that** selling is actually usable.

#### Acceptance Criteria
- [ ] The 800 ms automatic turn-end fires only when the player can neither buy **nor** sell.
- [ ] The End Turn confirmation warns about pending *sell* selections as well as pending buys.
- [ ] With the Turn Timer rule on, timer expiry auto-ends the turn **without selling anything** —
      the auto-play path never sells on a player's behalf.

#### Implementation Tasks
- [ ] **`src/components/game/GameContainer.tsx`**: widen the `canBuyAnything` condition behind the
      auto-end-turn effect (~lines 110–143) to `canBuyAnything || canSellAnything`.
- [ ] **`src/components/game/EndTurnConfirmModal.tsx`**: include pending sells in the warning copy.
- [ ] **`server/api/game-action.ts`**: confirm the timer auto-play fallback takes no sell action —
      matching how it already always chooses `keep` for merger stock decisions.

#### Test Cases
In `src/utils/gameLogic.test.ts`:
- A player with no buyable chains but sellable holdings does not trip the auto-end condition.
- A player with neither does.

#### Dependencies
- STORY 14.3, STORY 14.4.

---

### User Story 14.8: Bots Hold

**As a** player in a room with bots,
**I want** bots to keep playing normally when selling is enabled,
**so that** the mode doesn't break mixed games.

#### Acceptance Criteria
- [ ] Bots never emit `sell_stocks`. This is an explicit, documented decision, not an oversight.
- [ ] Bots complete their turns normally in rooms with the rule enabled — **no stall is possible**,
      because selling is optional and is never required for a phase transition.
- [ ] A comment in `server/lib/bot.ts` records that bot selling is deliberately out of scope, with a
      pointer to this story.

#### Implementation Tasks
- [ ] **`server/lib/bot.ts`**: add the explanatory comment near the buy logic (~lines 274–332). No
      behavioural change.
- [ ] Verify `driveBots(roomId)` needs no new branch — the new action is never a required transition.

#### Test Cases
In `server/lib/bot.test.ts`:
- A bot turn completes normally with `stockSellingEnabled: true` in the rules snapshot.

#### Dependencies
- STORY 14.2.

---

### User Story 14.9: Pre-Implementation Type Fix

**As a** developer,
**I want** `GameState` to typecheck before I add fields to it,
**so that** new errors are visible instead of buried in existing ones.

#### Acceptance Criteria
- [ ] `npx tsc -p tsconfig.app.json --noEmit` passes on the branch before stories 14.1–14.8 land.

#### Implementation Tasks
- [ ] **`src/utils/multiplayerService.ts`** (~line 381): `dbToGameState` currently omits `bonusTier`,
      `maxChains` and `eligibleChains` from the `GameState` it returns. Online games therefore have
      those three fields `undefined` at runtime, surviving only on `??` fallbacks in
      `src/utils/gameLogic.ts`. Populate them from the rules snapshot using the same derivation the
      server uses.
- [ ] **`src/components/game/PlayerCard.test.tsx`** (~line 25): update the fixture, which fails for
      the same reason.

#### Dependencies
- None. Do this first.

---

## Testing Requirements

### Unit Tests
- `getSellPriceFactor` and `getSellPrice` across every tier, bracket and factor, including the
  round-down-to-10 behaviour and the `factor = 1` identity against `getStockPrice`.
- `getRemainingSellAllowance` / `canSellStock` across allowance, holdings and same-turn-purchase states.
- Share conservation: for every chain, `stockBank[chain] + Σ player holdings === 25` after any
  sequence of buys and sells.

### Integration Tests
- Sell → buy in the same turn: proceeds are spendable immediately.
- Sell → refresh: `stocksSoldThisTurn` survives, allowance is not reset.
- Selling the shares that gave a player majority correctly reassigns majority in
  `getStockholderRankings`.
- Rule disabled: `sell_stocks` is rejected and the UI shows no Sell control.

### E2E Tests
- Two-player room, selling at 75%: create room with the rule on, buy 3, end turn, sell 2 next turn,
  verify cash and bank counts in both browsers.
- Bot room with the rule on: play three full rounds, confirm no stalls.

---

## Out of Scope

- **Local hot-seat and the tutorial.** Local play ignores custom rules entirely today —
  `initializeGame(playerNames)` always uses `DEFAULT_RULES` — so wiring selling into it means building
  a local custom-rules surface first.
- **Bot selling strategy** (see 14.8).
- **Player-to-player trading** or negotiated sales.
- **Short selling, margin, or any borrowing mechanic.**
- **Mode C's `marketPressure`** — designed above, not scheduled.
- **Extending market pressure to merger bonuses and final scoring** — Phase 2 of Mode C at the earliest.

---

## Definition of Done

- [ ] Room creators can enable Stock Selling and pick a sell factor; joiners see it before readying.
- [ ] Players can sell up to 3 shares per turn during their own buy phase, at the configured factor.
- [ ] Sell proceeds are spendable on the same turn.
- [ ] Shares bought this turn cannot be sold this turn.
- [ ] The spread is visible before confirming, never only after.
- [ ] All sales appear in the shared game log; share and bank counts update for every player without
      a refresh.
- [ ] The turn does not auto-end while a sale is still possible.
- [ ] Bots complete turns normally with the rule enabled.
- [ ] Share conservation holds: 25 per chain across bank and players, always.
- [ ] `npx tsc -p tsconfig.app.json --noEmit` passes and the full Vitest suite is green.
- [ ] No regression in rooms with the rule disabled — the default game is byte-for-byte unchanged.

---

## Success Metrics

- Stock Selling is enabled in **>25%** of custom rooms within a month of release.
- **>60%** of players in an enabled room sell at least once per game — if nobody sells, the spread is
  too punishing; if everyone sells every turn, it is too generous.
- Median game length changes by **<10%** versus rooms with the rule off.
- Zero share-conservation defects reported.

---

## Notes

- **Estimated development time:** 3–4 days for Mode B across all nine stories, assuming 14.9 is done
  first.
- The single biggest correctness risk is **allowance reset**: `stocks_purchased_this_turn: 0` is
  written at four separate sites in `server/api/game-action.ts`. Every one of them must also reset
  `stocks_sold_this_turn` and `chains_bought_this_turn`. Grep for all of them before starting 14.3.
- The second biggest is the **duplicated rules engine** — `src/utils/gameLogic.ts` and
  `server/lib/rules.ts`. The client copy drives what the UI *offers*; the server copy decides what is
  *allowed*. A divergence shows up as a button that produces a 400.
- `game_states.phase` is `VARCHAR(30)` and this epic adds no new phase value, so no schema concern
  there.
