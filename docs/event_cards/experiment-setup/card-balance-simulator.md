# Hotel Game Event Card Balance: Simulation Plan

You are building a headless simulation harness for an existing Hotel Game implementation  in order to balance a new purchasable event card deck. Work through the phases in order. Do not start Scenario B until Scenario A has produced a result file.

Report what the numbers say. Do not tune card effects, prices, or bot policies to make results look better. If something looks broken, say so and stop.

---

## Phase 0: Harness

Before any scenario runs, build the infrastructure. This is the part most likely to invalidate everything downstream, so do it carefully and verify it.

**Extract the engine.** The game logic must run headless in Node, fully separated from React components and from Supabase. No network calls, no persistence, no rendering. If the current code has game rules living inside components or inside Supabase handlers, refactor them out into a pure module first and confirm the UI still works afterwards.

**Determinism.** Replace every use of `Math.random()` in the engine path with an injected seeded PRNG (use a small, well-tested one such as mulberry32 or sfc32). Verify determinism explicitly: the same seed plus the same bot policies must produce a byte-identical game log across two runs. Write this as a test. If it fails, nothing below is valid.

**Bot interface.** Define a policy interface roughly like:

```ts
interface BotPolicy {
  chooseTilePlacement(state): Tile
  chooseStockPurchases(state): StockBuy[]
  resolveMergerHoldings(state): MergerDecision
  chooseChainToFound(state): ChainId
  // deck extensions, only called when deck access is enabled
  shouldBuyCard(state, price): boolean
  chooseCardToPlay(state, hand): CardPlay | null
}
```

The existing "hard" AI implements the first four methods. All bots in all scenarios use that same base policy, so the deck is the only variable.

**Deck rules under test.** One card purchase per round maximum. One card play per round maximum. A card cannot be played in the round it was purchased (one full round delay). Price is a run parameter, not a constant. Unplayed cards stay in hand until played or until the game ends.

**Two deck policies.** Implement both, they are separate experimental arms:

- `always-buy-greedy`: buys whenever cash allows, plays the highest immediate-value card as soon as it is legal. This is the floor, mechanical use.
- `ev-threshold`: buys only when estimated card value exceeds price, plays at the estimated best moment (for example, holds a merger-related card until a merger is plausible within one or two rounds). This is the ceiling, skilled use. Keep the estimator simple and document its assumptions in a comment block.

**Per-game log record.** Write one JSON line per game containing at minimum:

```
seed, seat_config, price, policy, deck_enabled,
winner_seat, final_cash_by_seat,
deck_seat, deck_seat_margin_vs_field_mean,
rounds_played, merger_count, total_money_end,
cards_bought, cards_played, cards_unplayed_at_end,
mean_idle_rounds_per_card, affordability_declines,
game_ended_naturally (bool), card_ids_played[]
```

`affordability_declines` counts rounds where the bot wanted a card under its policy but could not pay. This distinguishes "price binds" from "rate limit binds" and is important for reading Scenario A.

**Execution.** Run games in parallel across worker threads. Write results to JSONL under `sim/results/`. Log progress to stderr. A single game should take milliseconds; if it takes longer than ~50ms, profile before running full scale, because the total is 20,000+ games.

---

## Scenario A: Price sweep with asymmetric deck access

**Question.** At what price does a single deck-holding player win exactly as often as a player without the deck?

**Setup.** Four bots per game, all using the identical hard base policy. Exactly one seat has deck access. The other three cannot buy or play cards.

**Design.**

- 500 base seeds.
- Each seed runs 4 times, rotating the deck holder through seats 1, 2, 3, 4. Do not randomize the seat. Rotation cancels first-player advantage exactly instead of paying for it in variance.
- That gives 2,000 games per cell.
- Price cells: 200, 300, 400, 500, 600.
- Policy arms: `always-buy-greedy` and `ev-threshold`.
- Total: 5 prices × 2 policies × 2,000 = 20,000 games.

**Paired baseline.** Run the same 500 seeds × 4 seat positions with the deck disabled entirely, 2,000 games. This baseline is price-independent, so it is run once and reused across all price cells. For each seed and seat, you now have a matched pair: same tile bag, same shuffle, deck on versus deck off. Compare within pairs.

**Primary metric.** Deck holder's win rate per cell, tested against the 25 percent null. Report a Wilson 95 percent confidence interval, not just the point estimate.

**Secondary metric.** Paired difference in final cash margin (deck seat's cash minus the mean of the other three), deck-on minus deck-off, on matched seeds. Report mean and bootstrap CI. This is continuous and much lower variance than win rate, so it will show direction long before win rate resolves.

**Sanity checks, run these before trusting anything.**

- In the baseline runs, each seat's win rate should sit near 25 percent. If seat 1 is at 32 percent, note the magnitude in the report. Rotation still cancels it, but a large advantage is worth knowing about.
- Games ending naturally should be well above 95 percent. A high round-cap rate means the engine or the bots are stalling.
- Baseline and deck-on runs on the same seed should diverge only after the first card purchase. Spot check one pair by hand.

**Deliverable.** A table of price versus win rate with CIs for both policy arms, plus the estimated crossing point where the `ev-threshold` curve meets 25 percent. Interpolate linearly between the two bracketing price cells.

**How to read it.**

- Smooth downward slope crossing 25 percent: that crossing is the fair price. Done.
- Flat curve across the whole 200 to 600 range: price is not the binding constraint. Check `affordability_declines`. If it is near zero at 600 dollars, the one-per-round rate limit is doing all the balancing work and price is close to decorative. Report this rather than extending the sweep.
- Curve never crosses 25 percent even at 600: the deck is too strong to fix with price. Stop and report which cards dominate `card_ids_played`.
- `always-buy-greedy` and `ev-threshold` within about 1 point of each other: the cards play themselves, no skill headroom. Report as a design finding.

---

## Scenario B: Symmetric deck health run

Run only after Scenario A has produced a crossing price. Use that price. If A produced no crossing, use 400 and say so in the report.

**Question.** Does the deck damage the game itself when everyone has it?

**Setup.** All four bots have deck access at the Scenario A price. Same 500 seeds × 4 rotations = 2,000 games, so results are comparable to the Scenario A baseline on matched seeds. Run with `ev-threshold` only.

**Comparison target.** The no-deck baseline from Scenario A, same seeds.

**Metrics, all as paired differences against baseline.**

- Mean rounds per game. Large drops mean the deck is accelerating the game past its intended arc.
- Merger count per game. Mergers are Acquire's payout engine, so a shift here changes the whole economy.
- Total money in the system at game end, and its trajectory over rounds. Watch for inflation.
- Rate of games hitting the round cap without a natural end.
- Win rate spread across the four seats. All four should sit near 25 percent. If the deck amplifies first-player advantage, it shows up here.
- Per-card play frequency across all 8,000 card plays. Anything played in more than roughly 25 percent of the games it is available in is a staple. Anything under 5 percent is close to dead.

**Frustration counters.** From the same runs: share of purchased cards never played, and mean idle rounds between purchase and play. High values mean the one-round delay plus the play limit is creating dead cash rather than tension.

**Kingmaking counter.** For each card play by a player not currently leading on estimated final cash, check whether the eventual winner changes as a result, and whether the new winner is a third party rather than the card's user. Report the rate. This needs a counterfactual replay of the same seed with that single play suppressed, so implement it as an optional expensive pass over a 200-game subsample rather than over all 2,000.

**Deliverable.** A comparison table, deck versus baseline, with the paired differences and CIs, plus the per-card frequency table and the frustration and kingmaking rates.

---

## Final output

Write `sim/REPORT.md` containing: the Scenario A price curve and recommended price, the Scenario B health comparison, the per-card frequency table, and a short list of cards that look mispriced or degenerate, with the evidence for each. Keep raw JSONL so results can be re-analyzed without re-running.

Estimated wall clock: 20,000 games in Scenario A, 2,000 in B, plus the 200-game counterfactual subsample. Report actual runtime after Phase 0 so scale can be adjusted if needed.