# Event Card Deck — Balance Report

Simulation study of the purchasable event-card deck against the shipped game
rules, run entirely headless through the real engine.

- **Games played:** 28,500 (Scenario A) + 500 (Scenario B, $200) + 500 (Scenario B, $400) + 3,984 counterfactual replays
- **Wall clock:** 170 s (A) + 216 s (B @ $200) + 122 s (B @ $400) on 8 worker threads
- **Population:** four seats, all the shipped `hard` bot, identical in every arm. The deck is the only variable.
- **Rules:** shipped defaults (`DEFAULT_RULES`, chain safety off)
- **Artifacts:** `sim/out/scenarioA.json`, `sim/out/scenarioB.json`, `sim/out/scenarioB-400.json`; raw games in `sim/results/*.jsonl`

---

## Headline

1. **The fair price is $200.** At $200 the deck holder wins 24.9% (skilled) and 26.4% (mechanical); both intervals contain the 25% null. Every price above $200 makes the deck a straight loss for its holder.
2. **Price is genuinely the binding constraint, not the rate limit.** A *free* deck wins 51.5% — more than double the null. The one-card-per-round limit does not contain the deck on its own.
3. **The deck is not close to price-neutral in shape.** At $200 it lengthens games, adds 14% more mergers, inflates the money supply by 9%, and widens the winner-to-loser spread by $1,861 — all significant on paired seeds.
4. **Kingmaking is severe.** 20.5% of card plays by a player who was not leading changed the winner *to a third party*. A placebo control confirms this is causal, not replay noise.
5. **Three quarters of purchased cards are never played** (73.3%), sitting idle a mean of 3.9 rounds and a 90th percentile of 11. The cause is *not* mainly the access rules: an autopsy of every unplayed card attributes 45.7% to the buying policy holding out for a better moment that never came, 26.9% to a blind spot in the value estimator, and only 14.6% to the one-play-per-round limit.

---

## Phase 0 — Harness

The engine was already extractable: `sim/harness.ts` drives whole games through the
real `handleGameAction` against an in-memory Postgres stand-in, with no network,
no persistence and no React. This study added the deck layer (`sim/deck.ts`,
`sim/deck-study.ts`, `sim/scenarios.ts`, `sim/deck-run.ts`) on top of it.

**Determinism.** `Math.random` is replaced process-wide by a seeded mulberry32
stream. Verified in `sim/deck.test.ts`: the same seed replays a game move for
move (170+ moves), and a deck game replays its entire card sequence and final
scores identically. Two full Scenario A runs 20 minutes apart produced identical
numbers to the last decimal.

A stronger property was measured and it matters for everything below: the engine
draws **1,070 random numbers during setup and exactly 0 afterwards**. With `hard`
bots, a game is fully determined by its deal. Two consequences:

- A deck-on game and its deck-off twin share their luck exactly until the deck
  actually spends a dollar. Spot-checked by hand over 12 seeds
  (`sim/probe-divergence.ts`): the first differing move falls in round 4–10 in
  every pair, never before the first purchase in round 0.
- A counterfactual replay differs from the original *only* through the effect of
  the suppressed card. There is no chaotic RNG path for divergence to travel
  down. This is what makes the kingmaking number in Scenario B interpretable.

**Speed.** 12.4 ms per baseline game, 14 ms per greedy deck game, 27 ms per
ev-threshold deck game (the estimator evaluates all 21 cards per buy decision).
Well inside the 50 ms bar; no profiling needed.

**One defect found and fixed.** The first working deck build produced
`rejected:place_tile` errors in 13% of games against 0 in 300 no-deck games. Cause:
the value estimator used `MemoryDb.snapshot()`/`restore()` around a trial patch,
and `restore()` replaces every row *object* with a fresh clone. The card's real
patch then landed on new objects while the harness still held references to the
old ones, so the bot read a stale rack and eventually named a tile it had already
placed via Charter Renewal. Fixed by evaluating on a separate scratch database
that never touches the live one. Post-fix: **0 rejected moves and 100% natural
game endings across all 29,500 games.**

**The deck.** 21 of the 23 designed cards. `insider-tip` (reads an opponent's
rack) and `board-seat` (buys another card at a discount) are excluded: no policy
in the population uses rack knowledge, and `board-seat`'s value is a function of
the rest of the pool. Both would enter as guaranteed no-ops. Excluding them makes
the modelled deck *stronger* than a real 23-card deck, so every price below is an
upper bound.

**Access rules under test:** 1 buy/round, 1 play/round, no play in the round of
purchase, price a run parameter, unplayed cards held until played or the game ends.

---

## Scenario A — Price sweep with asymmetric deck access

500 base seeds × 4 seat rotations × 5 prices × 2 policies = 20,000 games, plus
2 control prices (8,000 games) and a 500-game paired baseline.

### Sanity checks

| Check | Result | Verdict |
|---|---|---|
| Baseline per-seat win rate | 28.4% / 28.5% / 23.1% / 20.0% | **Spread of 8.5 points.** A real first-player advantage — seat 1 beats seat 4 by 8.4 points. Rotation cancels it exactly, but it is worth knowing about. |
| Games ending naturally | 100.0% (500/500 baseline, 29,500/29,500 overall) | Pass, well above the 95% bar |
| Rejected moves | 0 across every cell | Pass |
| Ties on net worth | 0.4% | Negligible; Wilson intervals are computed on sole wins |
| Divergence vs baseline | First differing move in round 4–10, first purchase in round 0 | Pass |
| Mean rounds / mergers (baseline) | 13.8 / 6.5 | Matches the pre-existing harness health run |

### The price curve

Deck holder's win rate against the 25% null. 2,000 games per cell; Wilson 95%
intervals; cash margin is the paired within-seed difference (deck-on minus
deck-off) of the deck seat's final cash versus the mean of the other three.

| Policy | Price | Win rate | Wilson 95% CI | Δ cash margin | 95% bootstrap CI | Δ net-worth margin | Cards bought | played | unplayed | Decline rate |
|---|---|---|---|---|---|---|---|---|---|---|
| always-buy-greedy | **$200** | **26.4%** | [24.5%, 28.4%] | −$806 | [−$1,309, −$251] | −$524 | 12.8 | 11.2 | 1.6 | 12.6% |
| always-buy-greedy | $300 | 17.6% | [16.0%, 19.3%] | −$3,031 | [−$3,533, −$2,536] | −$4,621 | 11.7 | 10.3 | 1.4 | 19.6% |
| always-buy-greedy | $400 | 12.3% | [10.9%, 13.8%] | −$4,775 | [−$5,265, −$4,275] | −$7,692 | 11.0 | 9.7 | 1.3 | 25.0% |
| always-buy-greedy | $500 | 6.6% | [5.6%, 7.8%] | −$6,613 | [−$7,108, −$6,127] | −$11,510 | 10.0 | 8.9 | 1.1 | 31.2% |
| always-buy-greedy | $600 | 4.9% | [4.0%, 5.9%] | −$7,854 | [−$8,318, −$7,366] | −$14,051 | 9.2 | 8.2 | 1.0 | 37.0% |
| ev-threshold | **$200** | **24.9%** | [23.0%, 26.8%] | −$1,203 | [−$1,569, −$831] | −$1,215 | 8.2 | 2.1 | 6.0 | 7.8% |
| ev-threshold | $300 | 18.8% | [17.1%, 20.5%] | −$2,211 | [−$2,569, −$1,841] | −$2,607 | 5.8 | 1.4 | 4.4 | 8.0% |
| ev-threshold | $400 | 19.1% | [17.3%, 20.8%] | −$2,401 | [−$2,745, −$2,067] | −$3,091 | 4.7 | 1.1 | 3.7 | 6.9% |
| ev-threshold | $500 | 16.9% | [15.3%, 18.6%] | −$2,557 | [−$2,889, −$2,237] | −$3,331 | 3.8 | 0.8 | 3.1 | 5.4% |
| ev-threshold | $600 | 17.7% | [16.1%, 19.4%] | −$2,375 | [−$2,662, −$2,092] | −$3,191 | 3.1 | 0.6 | 2.5 | 4.4% |

**Control cells** (outside the plan's sweep; excluded from the interpolation, run
to separate "price is too high everywhere" from "the deck is a liability at any price"):

| Policy | Price | Win rate | Wilson 95% CI | Δ cash margin | Cards bought | played | Decline rate |
|---|---|---|---|---|---|---|---|
| always-buy-greedy | $0 | 51.5% | [49.4%, 53.7%] | +$4,381 | 14.7 | 12.6 | 0.0% |
| always-buy-greedy | $100 | 39.9% | [37.8%, 42.1%] | +$1,727 | 13.8 | 12.0 | 6.2% |
| ev-threshold | $0 | 51.4% | [49.2%, 53.6%] | +$4,391 | 14.2 | 11.8 | 0.0% |
| ev-threshold | $100 | 29.9% | [27.9%, 31.9%] | +$426 | 11.5 | 3.5 | 6.3% |

### Crossing point

- **`always-buy-greedy`: $216**, interpolated between $200 (26.4%) and $300 (17.6%).
- **`ev-threshold`: $198.** The swept range produces no crossing — the curve has
  already reached the null at its cheapest cell ($200, 24.9%, CI [23.0%, 26.8%],
  which contains 25%). The control cells bracket it: interpolating between $100
  (29.9%) and $200 (24.9%) gives $198.

**Recommended price: $200.** Both policy arms are statistically indistinguishable
from fair there, and the two independent crossing estimates ($216 and $198) sit
either side of it.

### How to read the curve

The plan lists four possible shapes. The data matches the first, with one
qualification.

**Smooth downward slope crossing 25%.** It does, and steeply: $0 → 51.5%,
$100 → 39.9%/29.9%, $200 → ~25%, $600 → 4.9%/17.7%. The crossing is real and
tight.

**Price is the binding constraint, not the rate limit.** The plan's diagnostic
for the flat-curve case is `affordability_declines` near zero at $600. It is not:
greedy declines rise monotonically from 12.6% at $200 to 37.0% at $600. And the
$0 control settles it outright — with the identical one-buy-one-play-per-round
rate limit and no price at all, the deck holder wins **51.5%**. The rate limit
alone leaves the deck roughly twice as strong as fair. Price is doing the
balancing work.

**Skill headroom exists, but not where the plan expected it.** At the fair price
the two arms are 1.5 points apart (26.4% vs 24.9%) — by the plan's rule of thumb,
"the cards play themselves". That reading is right about *timing* and wrong about
*spending*. Above the fair price the arms diverge enormously: at $600 the
mechanical buyer wins 4.9% and the disciplined one 17.7%. The skill in this deck
is knowing when **not** to buy, not when to play. `ev-threshold` protects itself
by simply buying less (3.1 cards at $600 versus greedy's 9.2).

**A note on the ev-threshold floor.** `ev-threshold` never recovers to 25% at any
price above $200, flattening around 17–19%. It is not being beaten by the cards
it plays — it plays only 0.6–1.4 of them per game up there. It is being beaten by
the ones it buys and never plays: 2.5–4.4 cards per game at $500–600, which is
$1,500–$2,600 of dead cash. Scenario B's autopsy (below) shows what that dead
cash actually is: a buy rule and a play rule that disagree with each other. The
policy buys whenever a blind draw is worth more than its price, then refuses to
play what it drew until the card clears three times its price. Note that the
mechanical arm barely has this problem — `always-buy-greedy` ends with 1.0–1.6
cards in hand at every price, against `ev-threshold`'s 2.5–6.0.

---

## Scenario B — Symmetric deck health run

All four seats hold the deck on `ev-threshold`, at the Scenario A price.

**A departure from the plan, stated explicitly.** The plan says to use $400 if
Scenario A produced no crossing. Scenario A produced no crossing *inside the
swept range*, but the price is not unknown: the bottom cell is already at the
null and the control cells bracket the crossing at $198. Running the health check
at $400 would describe a deck the measurement says nobody would buy (0.8 plays
per game). So **$200 is the primary arm** and the plan's literal $400 was run
alongside it as a secondary. Both are reported.

**On game counts.** 500 games, not 2,000. With all four seats holding the deck,
the seat rotation is a no-op — the four rotations of a seed are the identical
game. The Scenario A baseline collapses the same way for the same reason (nothing
in the deck layer runs, so the four rotations are bit-identical, asserted in
`sim/deck.test.ts`). 500 distinct symmetric games are paired against 500 distinct
baseline games on the same seeds, which is exactly the matched comparison the
plan asks for.

### Deck versus no-deck baseline, paired on seed ($200)

| Metric | Deck | Baseline | Paired diff | 95% bootstrap CI | p |
|---|---|---|---|---|---|
| Rounds per game | 14.1 | 13.8 | **+0.3** | [+0.2, +0.5] | 3e−5 |
| Mergers per game | 7.4 | 6.5 | **+0.9 (+14%)** | [+0.7, +1.0] | 8e−28 |
| Money in play at end | $62,982 | $57,679 | **+$5,303 (+9%)** | [+$3,312, +$7,223] | 1e−7 |
| Winner's net worth | $43,244 | $41,011 | +$2,234 | [+$1,638, +$2,831] | 2e−13 |
| Net-worth spread (top − bottom) | $19,377 | $17,516 | **+$1,861 (+11%)** | [+$1,083, +$2,640] | 1e−5 |
| Games hitting the round cap | 0% | 0% | 0 | — | — |
| Seat win rates | 26.7 / 26.6 / 23.3 / 23.4 | 28.4 / 28.5 / 23.1 / 20.0 | spread 3.4pp vs 8.5pp | — | — |

At $400 the same shape holds but weaker: +0.2 rounds, +0.6 mergers, and money in
play is flat (−$993, CI [−$2,639, +$710] — not distinguishable from zero).

**Reading.** The game does not break, but it does move. Nothing stalls: 100% of
games still end naturally, and the round cap is never reached. Game length barely
moves (+0.3 rounds), so the deck is not accelerating the arc past its design.

The economy does move. **Mergers rise 14%** — the deck is a merger accelerator,
which matters because mergers are the payout engine; several cards
(`franchise-expansion`, `charter-renewal`, `spin-off`, `tender-offer`) directly
manufacture board events. **The money supply inflates 9%** even though every seat
is paying $200 a card into the bank, so bank-sourced card payouts are more than
covering the deck's own cost. That ratio is a design choice worth making
deliberately rather than by accident.

**The deck slightly reduces seat unfairness** (spread 3.4pp versus the baseline's
8.5pp). It does not amplify first-player advantage; if anything it gives later
seats a lever. That is a genuinely good result.

### Per-card play frequency ($200, 4,406 plays across 500 games)

Staple = played in more than ~25% of the games it reached a hand in. Dead = under 5%.

| Card | Plays | Games played in | Play rate when available | Bought, never played | Mean idle rounds | Classification |
|---|---|---|---|---|---|---|
| dividend-call | 705 | 493 | 99.0% | 81 | 1.5 | **Staple — auto-include** |
| tender-offer | 577 | 439 | 88.2% | 224 | 2.5 | **Staple** |
| skyscraper | 517 | 425 | 86.4% | 263 | 2.0 | **Staple** |
| bridge-loan | 503 | 415 | 83.7% | 278 | 2.9 | **Staple** |
| spin-off | 553 | 406 | 81.7% | 227 | 4.1 | **Staple** |
| franchise-expansion | 454 | 403 | 80.9% | 325 | 2.6 | **Staple** |
| charter-renewal | 314 | 297 | 59.8% | 473 | 3.2 | Staple |
| ipo-discount | 192 | 141 | 28.4% | 580 | 7.9 | Staple (marginal) |
| five-star-upgrade | 79 | 73 | 14.7% | 714 | 10.8 | Situational † |
| golden-parachute | 70 | 65 | 13.0% | 720 | 10.8 | Situational † |
| hostile-takeover | 69 | 64 | 12.9% | 710 | 10.2 | Situational † |
| antitrust-filing | 68 | 63 | 12.6% | 732 | 11.0 | Situational † |
| ground-lease | 73 | 63 | 12.6% | 715 | 9.8 | Situational † |
| proxy-fight | 66 | 61 | 12.2% | 727 | 10.5 | Situational † |
| short-sell | 62 | 61 | 12.2% | 719 | 10.5 | Situational † |
| zoning-veto | 61 | 58 | 11.7% | 743 | 10.8 | Situational † |
| buyback | 43 | 39 | 7.8% | 748 | 7.7 | **Near-dead** |
| market-scan | 0 | 0 | 0.0% | 787 | — | Not measurable ‡ |
| surveyor | 0 | 0 | 0.0% | 788 | — | Not measurable ‡ |
| land-bank | 0 | 0 | 0.0% | 790 | — | Not measurable ‡ |
| demolition-permit | 0 | 0 | 0.0% | 771 | — | Not measurable ‡ |

† These eight carry deferred hooks the estimator cannot see, so they are scored
at par and only played once the phase bar decays. Their frequencies describe the
fallback rule, not the card. See Limitations.

‡ These four are invisible to the estimator, not weak. See Limitations.

### Frustration counters ($200)

| Counter | Value |
|---|---|
| Cards bought | 16,521 |
| Cards played | 4,406 |
| **Purchased and never played** | **73.3%** |
| Mean idle rounds between purchase and play | 3.9 |
| 90th percentile idle rounds | 11 |
| Rounds a buy was wanted but unaffordable | 5.8% |

At $400 the picture is the same (75.1% never played, 4.3 mean idle rounds), so
this is not a consequence of the price.

#### Why are they never played?

The aggregate number has several causes with opposite design implications, so
every card left in hand at the end was attributed to the best opportunity it ever
had. `sim/probe-unplayed.ts` audits each seat's hand every round — is the card off
cooldown, is it legal, what is it worth, what bar did the policy require, and was
the round's single play slot already spent. 150 symmetric games at $200: 4,965
cards bought, 1,326 played, 3,639 unplayed.

| Cause | Cards | Share of unplayed | Mean best value ever seen | What it means |
|---|---|---|---|---|
| **Declined on value** | 1,664 | **45.7%** | $148 | Legal and off cooldown, but never worth enough for the policy to spend its play on |
| **Invisible to the estimator** | 980 | **26.9%** | $0 | Scored at exactly $0 every round it was held — an instrument blind spot, not a decision |
| **Blocked by the play limit** | 533 | **14.6%** | $288 | Legal *and* over the bar, but the seat's one play that round went to a better card |
| **Bought too late** | 328 | 9.0% | — | The one-round delay never elapsed before the game ended |
| **Never legal** | 134 | 3.7% | — | The engine would not have allowed it in any round it was held |
| *Cleared the bar in an idle round* | 0 | 0.0% | — | Control: zero, so the audit's values agree exactly with the policy's decisions |

**So the honest answer to "why don't they get played" is: mostly because the bot
decided not to, and that decision is as much about the policy as about the cards.**
Of the 1,664 declined on value, **1,347 (80.9%) did reach one full price at some
point** and were held anyway, because `ev-threshold`'s bar is 3× price early and
2× mid. Those 1,347 are 37% of every unplayed card in the study, and they are
attributable to the hold multiple — a policy parameter — not to the deck's access
rules. Only the remaining 317 (8.7% of unplayed) are cards that never once reached
their own price.

Regrouped by what each cause is actually about:

| | Share of unplayed |
|---|---|
| The buying policy's timing rule (hold bar) | ~37% |
| The value estimator's blind spots | ~27% |
| The deck's access rules (play limit + purchase delay) | ~24% |
| Genuine card weakness (never reached par, or never legal) | ~12% |

**The correction this forces.** The one-play-per-round limit is a real constraint —
533 cards were ready and lost the slot to something better — but it is not the
main driver, and an earlier reading of this report said it was. The dominant
mechanism is that this policy's buy rule and play rule disagree: it buys whenever
a blind draw beats the price, then refuses to play what it drew until the card is
worth three times the price. `always-buy-greedy`, which plays as soon as it
legally can, leaves only 1.6 cards in hand per game against `ev-threshold`'s 6.0.

**What that means for the design question.** The frustration counters overstate
what a human would feel, because a human would stop buying once their hand backed
up. What survives as a genuine design signal is the 14.6% blocked and the 9.0%
bought-too-late: even a well-timed player will sometimes hold a ready card because
the round's play is already spent. That is the tension the one-play-per-round rule
is presumably meant to create; at this price it costs about a quarter of purchases.

### Kingmaking ($200, 200-game subsample)

For every card play by a seat that was not leading on net worth, the game was
replayed with that single play suppressed.

| Measure | Value |
|---|---|
| Qualifying plays (by a non-leader) | 1,308 over 200 games |
| Plays that changed the eventual winner | 363 (**27.8%**) |
| …where the new winner was a **third party**, not the card's user | 268 (**20.5%**) |
| …where the card's user won it for themselves | 95 (7.3%) |
| **Placebo control** (card still played, one random draw burned) | **0 (0.0%)** |

At $400: 21.2% decisive, 16.4% kingmaking, placebo again 0.

**The placebo is what makes this readable.** The obvious objection to a
suppression counterfactual is that any perturbation reshuffles a chaotic system,
so "the winner changed" would measure butterflies rather than the card. It does
not here: the engine consumes zero randomness after the deal, so burning a random
draw at the moment of the play changed the winner in **0 of 1,308 replays**. The
27.8% is entirely attributable to the card.

**One in five card plays by a trailing player hands the game to somebody other
than themselves.** That is the definition of kingmaking, and at this rate it is a
structural property of the deck rather than an edge case. Note the ratio: a
non-leader's play is nearly three times as likely to crown a rival (20.5%) as to
win them the game (7.3%).

---

## Cards that look mispriced or degenerate

Evidence from `sim/probe-estimator.ts` (807 live positions across 40 games,
reporting each card's legality rate and estimated immediate value) plus the
Scenario B frequencies.

| Card | Evidence | Verdict |
|---|---|---|
| **spin-off** | Legal in 26% of positions; mean value $5,638; max $12,800. **28× its $200 price** when it lands. Played in 82% of games it appears in. | **Jackpot tail.** A fair mean cannot rescue a card that pays 28× price on a quarter of turns. Needs a magnitude lever pulled down hard, or a much higher price class. |
| **charter-renewal** | Legal in 19% of positions; mean $4,876; **0% dead rate when legal** — it is never a dud. 24× price. | **Overpowered when live.** Narrow availability is doing all the balancing, which is fragile. |
| **tender-offer** | Legal in 85% of positions; mean $1,000; max $8,000. 88% play rate. 5× price with near-universal availability. | **The most consistently overpriced-for-its-cost card in the pool.** High availability plus high mean is the worst combination. |
| **dividend-call** | Legal 80%; mean $795; only 5% dead; **99.0% play rate when available**, played in 493 of 500 games. | **Auto-include.** A card that is played essentially every time it is drawn is not a decision. 4× price. |
| **skyscraper** | Legal 80%; mean $487; 45% of legal positions score exactly $0. 86% play rate. | Bimodal — either a big swing or nothing. Worth a look, less urgent. |
| **buyback** | Mean **−$220**; clears its own price in only 38 of 807 positions; 7.8% play rate; 748 copies bought and never played. | **Dead text at $200.** It costs more than it returns in almost every position. |
| **demolition-permit** | Legal 71%, mean −$122, never clears one price, **0 plays in 500 games**. | Cannot be judged. Its value is denial — what a *rival* loses — which this instrument does not measure. See Limitations. |
| **market-scan, surveyor, land-bank** | Legal in 100% of positions, valued at **exactly $0 in 100% of them**, 0 plays. | Cannot be judged. Pure information/tile-manipulation effects with no immediate net-worth signature. See Limitations. |
| The 8 hook cards | Scored at par by construction; play frequencies of 11.7–14.7% are the fallback rule firing, not measurement. | Cannot be judged. See Limitations. |

**And the deck as a whole.** At any price below roughly $200 the deck is not a
side system, it is the game: a free deck wins 51.5% against a 25% null. The
price is not a flavour knob.

---

## Limitations

These bound what the numbers above are allowed to claim. The first is the
important one.

1. **The value estimator is myopic, and 12 of 21 cards are outside what it can
   see.** Both deck policies value a card by applying its immediate patch and
   measuring the change in *the actor's own* net worth, as production scores it.
   No rollout, no lookahead, no opponent response. Measured directly
   (`sim/probe-estimator.ts`):
   - **3 cards are invisible** (`market-scan`, `surveyor`, `land-bank`): legal in
     100% of positions and valued at exactly $0 in 100% of them. Their 0% play
     rate is a property of the instrument, not the card.
   - **1 denial card is invisible for the same reason** (`demolition-permit`):
     its value is what an opponent loses, which never appears in the actor's own
     net worth.
   - **8 cards carry deferred hooks** (`zoning-veto`, `short-sell`, `proxy-fight`,
     `golden-parachute`, `hostile-takeover`, `antitrust-filing`, `ground-lease`,
     `five-star-upgrade`) and are scored at par rather than at a fabricated
     constant, so they are played only once the phase bar decays to par.
   - **9 cards are genuinely measured.**

   Direction of the bias: `ev-threshold` systematically under-plays denial,
   information and deferred cards, so its results are a **lower bound on skilled
   play**. The true fair price is therefore at or **above** $200, not below.

2. **The deck is 21 cards, not 23.** Excluding two guaranteed no-ops makes every
   draw better than it would really be, which also pushes the true fair price
   at-or-above $200.

3. **Everything is relative to the `hard` bot.** These are the shipped bots, which
   is what makes the conclusions legible, but a human who reads racks, targets
   rivals and times mergers would extract more from the deck than any policy here.
   Every number is a floor with respect to human skill.

4. **The phase bars (3× / 2× / 1× price) are a policy choice, not a measurement.**
   They were fixed before any Scenario A cell was run and were not revisited
   afterwards, but a different timing model would move `ev-threshold`'s curve.
   The autopsy quantifies how much: 37% of all unplayed cards are cards that did
   reach par and were held anyway. `ev-threshold`'s buy rule (buy when a blind
   draw beats the price) and its play rule (play when a card beats 3×/2×/1× the
   price) are not consistent with each other, and the gap between them is where
   the dead cash accumulates. A policy that stopped buying once its hand backed
   up would report far lower frustration and probably a slightly higher win rate,
   so `ev-threshold`'s curve is a floor here too.

5. **Default lever settings only.** Every card is simulated at the first option of
   every lever (the design doc's own leaning). The lever grid is not swept here —
   that is what `sim/out/cards.json` does, per position rather than per game.

6. **The kingmaking placebo bounds RNG-path chaos at zero, not state-path chaos.**
   It proves the replay does not diverge for random reasons. It does not prove a
   $1 change could not cascade — but such a cascade would still be *caused* by
   the card.

---

## Reproducing

```bash
npm run sim:build

# Phase 0 gates
npx vitest run sim/deck.test.ts
node .sim-build/sim/probe-divergence.js     # divergence spot check
node .sim-build/sim/probe-estimator.js      # estimator blind-spot probe
node .sim-build/sim/probe-unplayed.js 150   # why unplayed cards stayed unplayed

# The scenarios (B refuses to run until A's artifact exists)
node .sim-build/sim/deck-run.js --scenario a --seeds 500
node .sim-build/sim/deck-run.js --scenario b --seeds 500 --kingmaking 200
```

Raw per-game JSONL is kept in `sim/results/` so every table above can be re-cut
without replaying a game.
