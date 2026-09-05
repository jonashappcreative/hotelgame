# Bot Strategy Evaluation

**Date:** 2026-09-05
**Scope:** `server/lib/bot.ts` (373 lines), driven by `driveBotsLoop` in `server/api/game-action.ts`, scored against `server/lib/rules.ts`.
**Nature:** Read-only analysis. No code was changed.
**Revision:** v2 — incorporates Jonas's corrections on dead tiles, cash valuation and chain-founding tier preference, plus the new merger-liquidity requirement and the revised selling spec per difficulty (Story 14.8 scope explicitly superseded).

---

## 1. Executive summary

The bot layer is *correct* — it produces legal moves in every phase and never stalls a room — but it is **not differentiated the way the three difficulty labels promise**.

Five findings drive everything below:

1. **Medium and hard play tiles identically.** They share one scoring function; the only difference is that medium picks the second-best tile 30 % of the time. Tile placement is the largest strategic surface in Acquire, and hard adds *nothing* to it.
2. **No bot ever reads opponents' holdings when buying.** The only place in the entire file where other players' stock counts are consulted is the merge branch of the tile score. Majority races, the 13-share threshold, "someone is ahead of me on this chain" — none of it exists at any difficulty.
3. **Hard's buy formula does the opposite of what its comment claims.** The comment says "discount by price"; the algebra resolves to a *positive* price coefficient. Hard reliably buys the largest, most expensive chain on the board and almost never buys a young cheap chain.
4. **No bot has any concept of liquidity.** Cash is never tracked as "can I act next turn?", and the game's cheapest liquidation route — forcing a merge, which pays **full book price** — is invisible to every difficulty. This is the root of the new merger requirement in §5.4.
5. **No bot uses the Mode B sell feature at all**, at any difficulty. Under the revised spec (§4) that is now a gap at all three levels, not a design decision.

The header comment in `bot.ts` claims hard uses "an evaluation function (net worth + majority-bonus expectation) … shallow lookahead." There is no lookahead and no net-worth term. `getSafeChainSize` is imported and never used — a fossil of a safety model that was never built.

---

## 2. How bots actually run

`driveBotsLoop` (`server/api/game-action.ts:2085`) is a server-side loop, fired detached after every successful human action and after `bot_tick`:

- Reads fresh `game_states` + `game_players` each iteration; resolves the actor (`merger.currentPlayerIndex` during merger stock, else `current_player_index`).
- Stops the moment the actor is not a bot. Capped at 60 moves / 5 minutes / 3 retries per seat.
- Every bot move goes through the real `handleGameAction`, so the bot is validated by the same engine as a human. **A bot cannot cheat**, and an illegal suggestion is a rejected request, not corrupt state.
- Merger phases have an explicit safe fallback (keep-all / largest-survivor / pay-bonuses) so a bad suggestion cannot freeze a room.
- Pacing: one `BOT_TURN_DELAY_MS` (3 s) per *turn*, not per action.

`decideBotMove` is a pure function of `(difficulty, phase, gameState, players, actor)`. It stashes `players` on `gameState.__players` so ranking helpers can see everyone's stocks — a capability that is then used exactly once.

**Architecturally this is sound.** Every criticism below is about the decision content, not the plumbing.

### 2.1 Selling mechanics the bot layer must respect

Relevant because §4 now requires two of three difficulties to sell. From `settleSale` (`rules.ts:118`) and the `sell_stocks` case (`game-action.ts:1390`):

| Constraint | Value |
|---|---|
| Valid phase | `buy_stock` only, on the bot's own turn |
| Per-turn budget | `stocks_sold_this_turn` ≤ 3, **independent** of the 3-share buy budget — a bot may sell 3 *and* buy 3 in one turn |
| Ordering | A chain in `chains_bought_this_turn` cannot be sold → **sell must precede buy within a turn** |
| Price | `floor(getStockPrice × factor / 10) × 10`, factor 0.5–0.9 → always a haircut |
| Gate | `factor <= 0` when the rule is off; the sell path must be skipped entirely |
| Chain state | Active chains only |

**The decisive asymmetry:** merger liquidation (`game-action.ts:1101`) sells defunct shares at `getStockPrice` — **full book price, no haircut**. Voluntary `sell_stocks` always takes the haircut. Forcing a merge is therefore the cheapest liquidation in the game, which is exactly why §5.4 matters.

One implementation trap: `decideBuy` currently short-circuits on `stocks_purchased_this_turn > 0`. A sell-capable bot needs that guard to consider `stocks_sold_this_turn` too, or the drive loop will re-enter the buy phase and sell again every tick.

---

## 3. Phase-by-phase matrix

| Phase | Easy | Medium | Hard | Medium→Hard delta |
|---|---|---|---|---|
| `place_tile` | Uniform random over legal tiles | Score-sorted, 30 % chance of 2nd best | Score-sorted, always best | **Noise only** |
| `discard_tile` | Only when nothing is legal; prefers a 2-safe-chain dead tile | same | same | none |
| `found_chain` | Random available chain | Highest tier, 40 % chance of random | Highest tier, deterministic | **Noise only** |
| `merger_choose_survivor` | Random among tied-largest | Tied-largest where it holds most stock | same | **none** |
| `merger_pay_bonuses` | Trigger action | same | same | none |
| `merger_handle_stock` | **Keep 100 %** | **Sell 100 %** | **Trade max 2:1, sell remainder** | real |
| `buy_stock` | 50 % skip, else 1 random affordable share | Greedy ≤3, cheap+concentrating, 25 %/step early stop | Greedy ≤3, size+price weighted | real |
| `sell_stocks` (Mode B) | never | never | never | none — **now a gap at all three levels** |

**Only two of seven phases genuinely separate medium from hard.**

---

## 4. Difficulty-by-difficulty verdict, against the revised spec

The target spec, as confirmed by Jonas (this supersedes Story 14.8's "bots never sell"):

> **Easy** — every placement, merger and buying decision at random. Never uses the `sell_stocks` feature. At mergers it may randomly select "sell" as one of the three options.
> **Medium** — follows a strategy; may sell under rules defined here.
> **Hard** — everything medium does, plus hand lookahead, merge planning, majority-probability reasoning, liquidity awareness, and strategic use of `sell_stocks` (e.g. to fund majority in a chain it intends to merge).

### 4.1 Easy

**Verdict: matches on placement, founding and survivor choice. Fails on the merger decision. Correct on `sell_stocks` by accident.**

| Behaviour | Random? | Against spec |
|---|---|---|
| Tile placement | ✅ uniform over legal | ✅ |
| Chain founding | ✅ uniform | ✅ |
| Survivor choice | ✅ uniform over tied-largest | ✅ |
| Buying | ⚠️ 50 % skip, then 1 random share | random, but *deliberately passive* — see below |
| Merger stock | ❌ **always keeps everything** | ❌ must be a random legal split |
| `sell_stocks` | ✅ never | ✅ matches spec |

Two things worth knowing:

- **Keeping defunct shares is close to the worst possible line — and it is not random.** `calculateFinalScores` skips inactive chains (`rules.ts:267`), so a kept share in a chain that is never re-founded scores **zero**. Easy bots systematically bleed value at every merger. The spec calls for a random legal split, which must satisfy: `sell + trade + keep = shares`, `trade` even, and `trade / 2 ≤ stock_bank[surviving]`.
- **Easy buys at most 1 share per turn and skips half the time.** That is not "random buying", it is abstention. Since shares are worth at least their cash equivalent at scoring (see §5.2), a 50 % skip rate is a systematic handicap rather than randomness. Spec-true randomness would be a random *quantity* (0–3) across random affordable chains.

### 4.2 Medium — *expectation: "follows a strategy — buys into the chain it just founded, stops at 13, switches when majority is out of reach"*

**Verdict: only the first clause holds, and it holds by accident.**

The medium buy score is:

```
desirability(c) = (held + 1) × 100 − price × 0.5
```

- **"Buys shares of the chain it just founded" — ✅ but incidentally.** Founding grants a free share, so `held = 1` on the founded chain, worth +100. Worked example: newly founded Continental (size 2, price 400) scores `200 − 200 = 0`; an untouched Tower (size 3, price 300) scores `100 − 150 = −50`. The founded chain wins — but only because the free share happened to bump `held`, not because founding was modelled.
- **"Stops at 13" — ❌ absent.** No majority threshold exists anywhere in the file. Worse, the `held` term is the *dominant* one (+100 per share vs. a price penalty of 100–550), so medium **snowballs**: every share it buys makes the next share of the same chain more attractive. It will buy its 14th, 18th, 22nd share of one chain, converting cash into shares that add nothing to either bonus.
- **"Switches when someone else is ahead" — ❌ absent.** Medium never looks at another player's stocks. `gameState.__players` is available to it and unused in this path.
- Emergent behaviour: **buy the cheapest available chain and pile into it** — which is, ironically, sound Acquire heuristics.

The 25 % per-step early break also means medium frequently buys 1–2 shares when 3 were affordable, for no strategic reason.

**Proposed medium sell rules** (deliberately simple and legible — medium should be competent, not sharp):

1. Sell only when **cash-blocked**: the bot cannot afford a single share of its top-ranked chain this turn.
2. Sell only from **dead-weight positions**: chains where it holds ≤ 2 shares and is not the current majority holder. Never sell from its largest position.
3. Sell the **minimum** needed to afford one purchase, capped at 2 shares per turn.
4. Sell **before** buying (forced by `chains_bought_this_turn`).
5. No merge lookahead, no opponent modelling — that is hard's job.

This gives medium a visible, explainable habit ("it sells scraps when it's broke") without granting it hard's reasoning.

### 4.3 Hard

**Verdict: none of the requested capabilities are implemented. The buy heuristic actively contradicts the cheap-share requirement.**

The hard buy score, expanded (`getBonuses.majority = price × 10` at the standard tier):

```
size × price × 0.02  +  held × 30  +  (price × 10) × 0.01  −  price × 0.05
= 0.02 × size × price  +  30 × held  +  0.05 × price
```

The price term is **net positive**. The `− price × 0.05` "discount" is more than cancelled by the majority-bonus term it was meant to offset. With real numbers:

| Chain | Size | Price | Hard score (held = 0) |
|---|---|---|---|
| Continental (premium) | 12 | 800 | **232** |
| American (midrange) | 6 | 600 | 102 |
| Tower (budget) | 3 | 300 | 33 |
| Sackson, just founded | 2 | 200 | **18** |

A ~6.6-share holding difference is needed to overturn the Continental-vs-Tower gap. In practice **hard buys the biggest chain on the board every turn** until cash or bank runs out. The young cheap chain — the one whose shares triple after two merges, the one to arbitrage into a 2:1 trade — ranks last.

Against the requirements:

| Requested hard capability | Present? | Evidence |
|---|---|---|
| Evaluate tiles in hand — "can I merge in a following round?" | ❌ | `hand` is used only to classify *this* turn's legal moves (`bot.ts:129-131`). |
| Buy cheap shares expecting a merge, then trade up 2:1 | ❌ **inverted** | Score above ranks the cheapest, smallest chain lowest. |
| Majority-probability reasoning from all players' stock | ❌ | `playersForRanking` is called in exactly one place — the merge branch of the *tile* score (`bot.ts:169`). Never in `decideBuy`. |
| "Two others are loading up on this chain → buy something else" | ❌ | No opponent-holdings term in any buy path. |
| "Do I hold neighbouring tiles → found here" | ❌ | `found` is a flat constant 100 (`bot.ts:151-154`). |
| Liquidity-driven merge timing | ❌ | No cash term anywhere; see §5.4. |
| Strategic `sell_stocks` | ❌ | Never emitted at any difficulty. |

What hard *does* have that medium lacks: maximal 2:1 trading at mergers (`bot.ts:267-272`), arithmetically correct and bank-bounded — genuinely the strongest of the three merger lines.

**Hard may well be weaker than medium at buying.** Medium accidentally plays the sound line (cheap, concentrated); hard plays the expensive-and-late line. Worth measuring before tuning (§7, P3).

---

## 5. Cross-cutting gaps

### 5.1 Founding is a flat constant, and the tier preference is questionable

`found` scores 100 regardless of unincorporated-cluster size, tier, hand adjacency, or whether the bot can dominate the new chain. Founding always outranks growing (30) and usually outranks merging (20 + swing × 0.05).

Separately, `decideFoundChain` (`bot.ts:200-215`) picks the **highest tier available** for medium and hard, and does not even receive `actor` — so the choice is blind to the bot's own cash and holdings.

**This tier-first rule is not obviously correct, and is probably wrong.** A budget chain costs 200/share at size 2 against 400 for premium: founding cheap lets the bot reach 13 shares (unassailable majority) far sooner, and builds trade fodder for later 2:1 conversions. Premium chains pay bigger bonuses but only if you actually win the majority — and at double the price per share, that is a materially harder race.

Founding should be scored on **cost-to-dominate**, not tier:
- unincorporated-cluster size (immediate price and growth),
- shares of majority reachable given current cash and the 25-share bank,
- merge potential visible in hand,
- tier as a **tiebreak only**.

A consequence worth noting: this also dissolves the "hard bots are deterministic clones" problem (they currently always found Continental, then Imperial, in that fixed order) without needing artificial noise — a real evaluation function varies with board and cash naturally.

### 5.2 Cash — the gap is liquidity, not hoarding

*(Revised: the earlier framing "cash is never valued" was wrong.)*

Jonas is right that cash need not be preserved for its own sake: shares are worth at least their cash equivalent at final scoring, so converting cash into shares is normally correct and hoarding is a mistake.

The actual gap is narrower and more specific: **no bot models being cash-blocked.** There is no notion of

- "I cannot afford a single share this turn, so I have no move in the buy phase,"
- "saving this turn lets me afford the two shares that flip majority next turn,"
- or "the opponent is broke, so a merge now denies them the chance to buy back in."

That is the input the merger requirement in §5.4 and the sell policies in §4.2/§4.3 all depend on. Easy's 50 %-skip behaviour is the *opposite* failure — it hoards cash it never deploys.

### 5.3 Growth is never scored defensively

`grow = 30 + myShares × price × 0.02` has no penalty for pushing a chain *an opponent* dominates toward safe size or toward the 41-tile end-game trigger. A bot will happily hand a rival a safe, uncontestable majority.

### 5.4 Merge scoring is one-sided, and ignores liquidity and denial

`bot.ts:170-179` sums only *the bot's own* expected bonus and is never negative. It ignores:

- opponents collecting larger bonuses from the same merge,
- the survivor's post-merge price jump,
- the 2:1 trade equity the bot would gain,
- and it prices the defunct chain at its *current* size, before the merging tiles are added — a systematic underestimate.

**New requirement — merge as a liquidity and denial instrument.** A merge that is locally sub-optimal on bonus split can still be the right move:

1. **Self-funding.** Merger liquidation pays **full book price** (`game-action.ts:1101`), while `sell_stocks` takes a 10–50 % haircut. For a cash-starved bot, forcing a merge is the cheapest possible way to convert shares into buying power — strictly better than voluntary selling, and it should be preferred whenever both are available.
2. **Denial.** Killing a chain early caps what opponents can ever extract from it: a rival still accumulating a position in that chain never gets to mature it into the larger late-game bonus. Merging while an opponent is cash-poor compounds this — they collect their bonus but cannot convert it into a competitive position before the board moves on.
3. **The mirror case.** Hard should also be able to *withhold* a merge it could trigger, when delaying keeps a cash-starved opponent starved, or when one more round of growth materially raises the bot's own payout.

The evaluation therefore needs: own cash, every opponent's cash, each side's holdings in the defunct and surviving chains, and the merge's effect on the bot's ability to act *next* turn — not just the immediate bonus swing.

### 5.5 The end game is invisible

`END_GAME_CHAIN_SIZE` (41) and the safe-chain threshold are never consulted. No bot plays to trigger the end while ahead, or to delay it while behind. `getSafeChainSize` is imported at `bot.ts:24` and never called — the clearest signal that the safety dimension was scoped and dropped.

### 5.6 The 13-share majority threshold is unmodelled

25 shares per chain (`src/types/game.ts:141`), so 13 is an unassailable majority. No bot stops there, and no bot recognises when an opponent has passed it — which is also the trigger condition for "stop contesting this chain and buy elsewhere."

### 5.7 Dead tiles — *no issue; earlier finding withdrawn*

The rule is as Jonas states: bots and humans alike may only exchange tiles when **no** legal placement exists. The bot's behaviour (`bot.ts:133-139`) implements this correctly, and its preference for discarding a permanently-dead 2-safe-chain tile over an arbitrary one is the right tiebreak.

One small note kept for the record, as a *validation* observation rather than a strategy one: the engine's `discard_tile` handler validates turn ownership and hand membership but does not itself re-derive "no legal placement exists", so the rule is enforced by the client and by the bot's own discipline rather than server-side.

---

## 6. Robustness notes

- `decideChooseSurvivor` (`bot.ts:231`): if `pool` is empty, `Math.max(...[])` is `−Infinity`, `tied` is `[]`, and the payload carries `survivingChain: undefined`. The engine rejects it and the merger fallback recovers — no freeze, but it logs an error. Reachable only in a degenerate state.
- Repeated discards do not advance the phase and do not incur a pacing sleep (same `actorIndex`), so a hand of dead tiles can burn through the loop's 60-move cap quickly. Bounded, not dangerous.
- `bot.ts` mutates its `gameState` argument (`gameState.__players = players`). Harmless as called, but it makes the function impure.
- The `bot.test.ts` suite asserts **legality and non-stalling only** — "places a tile it holds", "buys ≤3 affordable shares", "never sells". Not one test asserts a *strategic* property, which is why the buy-formula sign error survived. Note that the existing "never sells" tests encode Story 14.8 and will need replacing under the revised spec.
- Selling requires the Epic 14 columns (`stocks_sold_this_turn`, `chains_bought_this_turn`) — present in `db/schema.sql:161-163` and `db/migrations/2026-08-30-epic14-stock-selling.sql`, but `deploy.sh` never applies schema changes, so this migration must be run by hand before sell-capable bots reach the server.

---

## 7. Recommendations, in priority order

No code changes were made; this is a proposed sequence.

**P0 — make hard actually hard**
1. Fix the sign in the hard buy score so price genuinely discounts, then re-tune. Today the comment and the algebra disagree.
2. Add an opponent-holdings term to `decideBuy`: for each chain compute the bot's shares vs. the best rival's, shares left in the bank, and turns needed to overtake. Drop a chain to near-zero desirability once majority is mathematically unreachable, and once the bot holds 13+.
3. Give hard a distinct tile score. While hard and medium share `score()`, the difficulty label is cosmetic on the game's most important decision.

**P1 — implement the requested capabilities**
4. **Hand lookahead.** For each tile in hand, classify what it *would* do next turn (found / grow / merge) and fold a discounted value into this turn's choice. This is the single feature that makes hard feel like it is planning.
5. **Cheap-share arbitrage.** Value a small chain by its *expected* value if merged (survivor price × 0.5 per 2:1 trade), not its current price.
6. **Cost-to-dominate founding** (§5.1). Replace the flat 100 and the tier-first rule with cluster size, cash-to-majority, hand adjacency, and tier only as a tiebreak — explicitly allowing hard to found a budget chain first.
7. **Liquidity and denial in merge decisions** (§5.4). Model own and opponents' cash; let hard force a bonus-suboptimal merge to self-fund at full book price, and let it withhold a merge to keep a rival starved.
8. **Defensive growth** (§5.3): penalise growing a chain a rival dominates, especially toward safe size or the end-game trigger.

**P2 — selling, per the revised spec**
9. **Easy:** randomise the merger stock decision across a legal `sell`/`trade`/`keep` split (trade even, `trade / 2 ≤ bank[surviving]`). Continue to never emit `sell_stocks`. Consider randomising buy *quantity* 0–3 rather than the current 50 %-skip-then-one-share, which is abstention rather than randomness.
10. **Medium:** implement the five cash-blocked rules in §4.2.
11. **Hard:** sell only when it converts into a *specific* better position this turn — dump a locked-minority or unreachable-majority position to fund the marginal share that flips standing in a chain the bot can merge from hand. Require proceeds (post-haircut) to buy strictly more expected bonus than the position sold. Never sell the chain it is buying into. Prefer forcing a merge over voluntary selling whenever both liquidate the same position, because the merge route avoids the haircut (§2.1).
12. Sequence the turn as **sell → buy → end**, and extend the `decideBuy` short-circuit to consider `stocks_sold_this_turn` as well as `stocks_purchased_this_turn`.
13. Gate every sell path on `getSellPriceFactor > 0` so rooms with the rule off are unaffected.

**P3 — labels, tests, measurement**
14. Replace the "bots never sell" tests, and add strategic assertions: "hard does not buy a chain where it holds 13", "hard prefers a founded-chain share to an equally priced foreign one", "medium sells only when cash-blocked", "easy's merger split is legal and varies across runs".
15. Update the `bot.ts` header comment — it currently promises lookahead and a net-worth term that do not exist — and remove or use the unused `getSafeChainSize` import.
16. Epic 16's dashboard already has a `bots` panel keyed on `bot_difficulty` (`server/api/stats.ts:189-195`). Once the above lands, that panel is the natural regression check — and it is worth reading *before* changing anything, because on the current code **I would not be surprised if medium out-performs hard**.

---

## 8. Spec decisions recorded

Resolved during review, superseding earlier assumptions:

- **Story 14.8's "bots never sell" is withdrawn.** Selling is now in scope for medium and hard.
- **Easy:** all placement, merger and buying decisions random; never uses `sell_stocks`; may randomly choose "sell" within the merger stock decision.
- **Medium:** may sell under the rules proposed in §4.2 (cash-blocked, dead-weight positions only, minimum quantity).
- **Hard:** may use `sell_stocks` to optimise its own position — e.g. funding majority in a chain it intends to merge — per §4.3 and P2/11.
- **Founding is not tier-first.** Hard must be free to found a cheaper chain when that buys a faster or more certain majority.
- **Cash is not to be hoarded**; the requirement is liquidity awareness (can I act next turn?), not preservation.
- **Dead-tile exchange only when no legal placement exists** — current behaviour is correct and stays.
