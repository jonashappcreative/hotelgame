// =============================================================================
// deck — the purchasable event-card deck, played inside whole games
// =============================================================================
// The existing card study (valuation.ts) asks "what is this card worth in this
// position?" by paired rollout. This module asks a different question: what
// happens across a *whole game* when a seat can buy from the deck and the other
// seats cannot. That needs the cards to be bought, held and played by an agent
// under the deck's real access rules, not applied once to a frozen position.
//
// The deck sits on top of the harness's two hooks. A card's Treatment is the
// same object valuation.ts uses — an immediate `patch` plus, for windowed or
// merger-triggered effects, hooks that keep acting. When a card is played its
// patch lands on the live tables and its hooks are added to the multiplexer, so
// the rest of the game plays on with the effect in force.
//
// Two streams of randomness, deliberately separated:
//
//   The global stream (rng.ts, installed over Math.random) is the *game's* luck
//   — tile bag, shuffles, bot coin flips. The deck must not touch it before it
//   actually does something, or a deck-on game and its deck-off twin would
//   diverge from move one and the matched-pair design in Scenario A would be
//   worthless. So the deck shuffle and every speculative evaluation run on a
//   private stream instead. Divergence then begins exactly at the first card
//   purchase, which is what the sanity check in the plan asks for.
// =============================================================================

import { Sim, type SeatSpec, type TurnContext, type SimOptions } from './harness';
import type { Tables } from './memory-db';
import { scoreSeats, winnersOf, type SeatScore } from './metrics';
import {
  CARDS, cardById, defaultLevers, DEFAULT_POOL_CONFIG,
  type CardDef, type Levers, type PoolConfig, type Treatment,
} from './effects';

// -----------------------------------------------------------------------------
// Access rules under test
// -----------------------------------------------------------------------------

export interface DeckAccess {
  /** Run parameter, never a constant — the whole of Scenario A is a sweep over it. */
  price: number;
  buysPerRound: number;
  playsPerRound: number;
  /** A card cannot be played in the round it was bought. */
  playDelayRounds: number;
}

export const ACCESS: Omit<DeckAccess, 'price'> = {
  buysPerRound: 1,
  playsPerRound: 1,
  playDelayRounds: 1,
};

/**
 * The deck. Two of the 23 designed cards are left out, and the omission is a
 * result, not a convenience:
 *
 *   insider-tip  reads an opponent's rack. No policy in the population uses
 *                rack knowledge, so its simulated effect is $0 by construction.
 *   board-seat   buys another card at half price. Its value is a function of
 *                the rest of the pool, so it cannot be drawn before the pool is
 *                priced without circularity.
 *
 * Both would otherwise enter the deck as guaranteed no-ops. Excluding them makes
 * the modelled deck *stronger* than the shipped 23-card deck would be, because a
 * draw can never be a dud for a reason that has nothing to do with the card. Any
 * fair price this study reports is therefore an upper bound on the price a
 * 23-card deck would need.
 */
export const DECK_POOL: CardDef[] = CARDS.filter(
  (c) => c.fidelity === 'exact' || c.fidelity === 'approx',
);

export type DeckPolicyName = 'always-buy-greedy' | 'ev-threshold';

// -----------------------------------------------------------------------------
// A private PRNG, so speculation never perturbs the game's luck
// -----------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run `fn` with Math.random pointed at a private stream. Card patches draw from
 * Math.random (bag reinsertion, "a random 3"), so a *speculative* patch applied
 * only to score a hypothetical would otherwise consume the game's luck and
 * change the game that follows.
 */
function offStream<T>(rnd: () => number, fn: () => T): T {
  const saved = Math.random;
  Math.random = rnd;
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

function shuffled<T>(items: T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// -----------------------------------------------------------------------------
// The value estimator
// -----------------------------------------------------------------------------
//
// ASSUMPTIONS. This is the only model of card value either deck policy has, and
// it is deliberately the cheapest one that is not a hand-written constant per
// card. It is *myopic*: it applies the card's immediate patch to a copy of the
// live tables and reports the change in the actor's net worth as production
// scores it (cash + liquidated shares + end-of-game bonuses, metrics.ts). No
// rollout, no lookahead, no opponent response.
//
// What follows from that, stated so the results can be read against it:
//
//  1. It sees immediate board and balance-sheet changes exactly. A demolished
//     tile, a forced sale, a founded chain, a cash transfer — all scored by the
//     same function that decides the winner.
//  2. It is blind to *deferred* effects. Eight cards carry hooks that fire on a
//     later event (the next merger, a window of N rounds); their patch alone is
//     worth about nothing, so a naive reading would price them at zero and the
//     ev-threshold policy would simply never play them. Rather than invent a
//     constant, a hook-carrying card whose myopic value is negligible is scored
//     *at par* (exactly the price). It is then never preferred over a card with
//     real measured value, but it is also not dead: it gets played once the
//     policy's bar has decayed to par. The consequence is that ev-threshold's
//     numbers are a LOWER bound on skilled play for those eight cards.
//  3. It ignores opponent response and compounding, so denial cards (whose
//     value is what the opponent now cannot do) are undervalued and cash cards
//     are valued at face rather than at their compounded worth. lambda from the
//     existing study says a dollar of cash is worth ~0.97 of final score, so
//     the second error is small; the first is not, and is the main reason the
//     ev-threshold arm should be read as a floor on the ceiling, not the ceiling.
//
// The estimator is identical in both policy arms. The arms differ only in what
// they do with its output, which is what makes the comparison between them a
// statement about *timing and selection* rather than about two different models.

export interface EvalContext {
  sim: Sim;
  seat: number;
  config: PoolConfig;
  rnd: () => number;
  /**
   * Speculation runs on a throwaway Sim, never on the live one. MemoryDb.restore
   * replaces every row *object* with a fresh clone, so snapshot/restore around a
   * trial patch would silently swap the identity of the rows the harness handed
   * to the bot: the game would carry on correctly, but the bot would be reading
   * a stale rack and would eventually name a tile it no longer holds. Keeping
   * speculation on a separate db makes that class of bug impossible rather than
   * merely absent.
   */
  scratch: Sim;
  /** One clone of the live tables per decision point, re-restored for each card tried. */
  base: Tables;
}


/** Change in this seat's net worth from playing `card` right now. */
export function myopicValue(ctx: EvalContext, card: CardDef, price: number): number {
  const levers = defaultLevers(card);
  ctx.scratch.db.restore(ctx.base);
  const cardCtx = { tables: ctx.scratch.db.tables, seat: ctx.seat, levers, config: ctx.config };
  if (!card.legal(cardCtx)) return Number.NEGATIVE_INFINITY;

  const before = netWorth(ctx.scratch, ctx.seat);
  offStream(ctx.rnd, () => card.treatment(cardCtx).patch(ctx.scratch.db.tables));
  const immediate = netWorth(ctx.scratch, ctx.seat) - before;

  // Assumption 2 above: a hook card with no measurable immediate effect is
  // scored at par rather than at zero.
  if (Math.abs(immediate) < 1 && hasHooks(card, cardCtx)) return price;
  return immediate;
}

const hookCache = new Map<string, boolean>();
function hasHooks(card: CardDef, cardCtx: any): boolean {
  const cached = hookCache.get(card.id);
  if (cached !== undefined) return cached;
  const t = card.treatment(cardCtx);
  const has = Boolean(t.onTurnStart || t.onDecision);
  hookCache.set(card.id, has);
  return has;
}

function netWorth(sim: Sim, seat: number): number {
  return scoreSeats(sim).find((s) => s.seat === seat)?.netWorth ?? 0;
}

/**
 * What a blind draw is worth here. The buyer does not know what they will draw,
 * so the buy decision is made against the mean of the pool's positive outcomes:
 * a card whose myopic value is negative can simply be held rather than played,
 * so its downside is floored at zero rather than carried into the average.
 */
export function deckExpectedValue(ctx: EvalContext, price: number): number {
  let sum = 0;
  for (const card of DECK_POOL) {
    const v = myopicValue(ctx, card, price);
    sum += Number.isFinite(v) ? Math.max(0, v) : 0;
  }
  return sum / DECK_POOL.length;
}

// -----------------------------------------------------------------------------
// The two deck policies
// -----------------------------------------------------------------------------
//
// PHASE BARS. ev-threshold's timing model is one decaying bar and nothing else:
// early in the game it holds out for a multiple of the price, late in the game
// it accepts par. That is the whole of "waits for the right moment" — a card
// worth 3x its price in round 4 is worth playing now, one worth 1.1x is worth
// holding, because the same card in a mature position is usually worth more.
// The multiples were fixed before any Scenario A cell was run and were not
// revisited afterwards. Phase boundaries are corpus.ts's, so this study and the
// valuation study cut the game in the same places.

export const PHASE_BOUNDS = { earlyMax: 6, midMax: 14 };
export const HOLD_MULTIPLE = { early: 3, mid: 2, late: 1 };

export function holdBar(round: number, price: number): number {
  if (round <= PHASE_BOUNDS.earlyMax) return price * HOLD_MULTIPLE.early;
  if (round <= PHASE_BOUNDS.midMax) return price * HOLD_MULTIPLE.mid;
  return price * HOLD_MULTIPLE.late;
}

export interface HandCard { cardId: string; boughtRound: number }

export interface AuditCard {
  cardId: string;
  boughtRound: number;
  /** Has the one-round purchase delay elapsed? */
  offCooldown: boolean;
  /** Would the engine allow this card here at all? */
  legal: boolean;
  /** What the estimator said it was worth, or null when illegal. */
  value: number | null;
  /** The bar the policy required this round. */
  bar: number;
}

export interface AuditRound {
  seat: number;
  round: number;
  hand: AuditCard[];
  /** The card actually played this round, if any. */
  played: string | null;
  /** Rounds remaining in the game after this one — filled in by the probe, not here. */
  isFinalRound?: boolean;
}

export interface DeckDecision {
  /** Does this seat want to buy this round, ignoring whether it can pay? */
  wantsBuy: (ctx: EvalContext, price: number) => boolean;
  /** Which held card to play now, if any. */
  choosePlay: (
    ctx: EvalContext, hand: HandCard[], round: number, price: number,
  ) => { card: HandCard; value: number } | null;
}

const playable = (hand: HandCard[], round: number) =>
  hand.filter((h) => round - h.boughtRound >= ACCESS.playDelayRounds);

export const DECK_POLICIES: Record<DeckPolicyName, DeckDecision> = {
  // The floor. Mechanical use: buy on sight, play the best thing in hand the
  // moment it is legal, with no notion of a better moment later.
  'always-buy-greedy': {
    wantsBuy: () => true,
    choosePlay: (ctx, hand, round, price) => {
      let best: { card: HandCard; value: number } | null = null;
      for (const h of playable(hand, round)) {
        const v = myopicValue(ctx, cardById(h.cardId), price);
        if (!Number.isFinite(v)) continue;
        if (!best || v > best.value) best = { card: h, value: v };
      }
      return best;
    },
  },

  // The ceiling. Buys only against a positive expectation, and holds a legal
  // card until it clears the phase bar.
  'ev-threshold': {
    wantsBuy: (ctx, price) => deckExpectedValue(ctx, price) > price,
    choosePlay: (ctx, hand, round, price) => {
      const bar = holdBar(round, price);
      let best: { card: HandCard; value: number } | null = null;
      for (const h of playable(hand, round)) {
        const v = myopicValue(ctx, cardById(h.cardId), price);
        if (!Number.isFinite(v)) continue;
        if (!best || v > best.value) best = { card: h, value: v };
      }
      if (!best || best.value < bar) return null;
      return best;
    },
  },
};

// -----------------------------------------------------------------------------
// Per-seat deck state
// -----------------------------------------------------------------------------

export interface PlayEvent {
  seat: number;
  round: number;
  cardId: string;
  estValue: number;
  /** Was this seat top of the table on net worth at the moment it played? The kingmaking filter. */
  leadingAtPlay: boolean;
  /** Index of this play within the game, across all seats. What the counterfactual suppresses. */
  index: number;
}

export interface SeatDeckStats {
  seat: number;
  policy: DeckPolicyName;
  cardsBought: number;
  cardsPlayed: number;
  cardsUnplayedAtEnd: number;
  cardIdsPlayed: string[];
  cardIdsUnplayed: string[];
  /** The round of each purchase, in order. */
  buyRounds: number[];
  /** Rounds a card sat in hand between purchase and play, per played card. */
  idleRounds: number[];
  meanIdleRoundsPerCard: number;
  /** Rounds this seat wanted a card under its policy and could not pay for it. */
  affordabilityDeclines: number;
  /** Rounds this seat was legally allowed to buy at all (the rate-limit denominator). */
  buyOpportunities: number;
  spentOnCards: number;
}

// -----------------------------------------------------------------------------
// The controller
// -----------------------------------------------------------------------------

export interface DeckGameOptions {
  seats: SeatSpec[];
  seed: number;
  /** Seats with deck access. Empty for the no-deck baseline. */
  deckSeats: number[];
  policy: DeckPolicyName;
  price: number;
  config?: PoolConfig;
  /**
   * Per-round audit of every card in hand: why was it not played this round?
   * Purely observational — it runs its own PRNG so it consumes nothing from
   * either the game's stream or the policy's evaluation stream, and an audited
   * game is identical to an unaudited one.
   */
  onAudit?: (info: AuditRound) => void;
  /** Kingmaking counterfactual: skip the card play with this global index. */
  suppressPlayIndex?: number;
  /**
   * Placebo control for the same counterfactual. The card at this index is
   * still played, but one draw is burned from the game's own random stream
   * first, so the rest of the game diverges exactly as a suppression would
   * while the card's effect is left intact. The gap between the suppression
   * arm's winner-change rate and this one is how much of "the play decided the
   * game" is the play, and how much is a butterfly.
   */
  placeboPlayIndex?: number;
  maxMoves?: number;
}

export interface DeckGameResult {
  seed: number;
  outcome: 'finished' | 'stalled' | 'move_limit';
  stallReason: string | null;
  rounds: number;
  mergers: number;
  rejections: number;
  seatScores: SeatScore[];
  winners: number[];
  moneyInPlay: { round: number; total: number }[];
  deckStats: SeatDeckStats[];
  plays: PlayEvent[];
  /** Ordered `seat:phase:action`, for the divergence spot check. */
  log: string[];
}

export async function playDeckGame(opts: DeckGameOptions): Promise<DeckGameResult> {
  const config = opts.config ?? DEFAULT_POOL_CONFIG;
  const deckSeats = new Set(opts.deckSeats);
  const decide = DECK_POLICIES[opts.policy];

  // Private streams, one per concern, both derived from the game seed so the
  // whole game stays a pure function of it.
  const shuffleRnd = mulberry32(opts.seed ^ 0x5deece66);
  const evalRnd = mulberry32(opts.seed ^ 0x1d2b3c4d);

  // One shuffled deck per game, reshuffled from a full pool when exhausted.
  let draws: string[] = shuffled(DECK_POOL.map((c) => c.id), shuffleRnd);
  const drawCard = (): string => {
    if (draws.length === 0) draws = shuffled(DECK_POOL.map((c) => c.id), shuffleRnd);
    return draws.pop()!;
  };

  const hands = new Map<number, HandCard[]>();
  const stats = new Map<number, SeatDeckStats>();
  for (const seat of deckSeats) {
    hands.set(seat, []);
    stats.set(seat, {
      seat, policy: opts.policy,
      cardsBought: 0, cardsPlayed: 0, cardsUnplayedAtEnd: 0,
      cardIdsPlayed: [], cardIdsUnplayed: [],
      buyRounds: [], idleRounds: [], meanIdleRoundsPerCard: 0,
      affordabilityDeclines: 0, buyOpportunities: 0, spentOnCards: 0,
    });
  }

  const lastBuyRound = new Map<number, number>();
  const lastPlayRound = new Map<number, number>();
  const plays: PlayEvent[] = [];
  const moneyInPlay: { round: number; total: number }[] = [];
  let moneyRound = -1;

  // Hooks contributed by cards already in play, multiplexed onto the harness's
  // single hook slot.
  const turnHooks: NonNullable<Treatment['onTurnStart']>[] = [];
  const decisionHooks: NonNullable<Treatment['onDecision']>[] = [];

  let sim!: Sim;
  // Never activated as the db backend and never run — it exists only to give
  // scoreSeats a Sim-shaped host for hypothetical tables.
  const scratch = new Sim({ seats: opts.seats, seed: opts.seed });

  const onTurnStart = (ctx: TurnContext) => {
    if (ctx.round !== moneyRound) {
      moneyRound = ctx.round;
      moneyInPlay.push({ round: ctx.round, total: ctx.players.reduce((s, p) => s + (p.cash ?? 0), 0) });
    }

    if (deckSeats.has(ctx.seat)) deckTurn(ctx);

    for (const hook of turnHooks) hook(ctx);
  };

  const onDecision = (ctx: TurnContext & { phase: string }) => {
    for (const hook of decisionHooks) hook(ctx);
  };

  /**
   * One deck seat's card step, at the top of its own turn. Play first, then buy:
   * a card bought this round could not be played this round anyway, and doing it
   * in this order means the play decision is made before the price is deducted,
   * so cash spent on a card never suppresses the same turn's play.
   */
  function deckTurn(ctx: TurnContext): void {
    const seat = ctx.seat;
    const round = ctx.round;
    const hand = hands.get(seat)!;
    const stat = stats.get(seat)!;
    const evalCtx: EvalContext = {
      sim, seat, config, rnd: evalRnd,
      scratch, base: sim.db.snapshot(),
    };

    // --- play ---------------------------------------------------------------
    if ((lastPlayRound.get(seat) ?? -1) !== round && hand.length > 0) {
      const choice = decide.choosePlay(evalCtx, hand, round, opts.price);
      if (choice) {
        const index = plays.length;
        if (opts.suppressPlayIndex !== index) {
          if (opts.placeboPlayIndex === index) Math.random();
          const card = cardById(choice.card.cardId);
          const cardCtx = {
            tables: sim.db.tables, seat, levers: defaultLevers(card), config,
          };
          const treatment = card.treatment(cardCtx);
          treatment.patch(sim.db.tables);
          if (treatment.onTurnStart) turnHooks.push(treatment.onTurnStart);
          if (treatment.onDecision) decisionHooks.push(treatment.onDecision);

          hand.splice(hand.indexOf(choice.card), 1);
          lastPlayRound.set(seat, round);
          stat.cardsPlayed++;
          stat.cardIdsPlayed.push(card.id);
          stat.idleRounds.push(round - choice.card.boughtRound);
          plays.push({
            seat, round, cardId: card.id, estValue: choice.value,
            leadingAtPlay: isLeading(seat), index,
          });
        } else {
          // Suppressed for the counterfactual. The play slot is still consumed,
          // so the arm differs from the baseline by exactly one card play and
          // not by a shifted play schedule.
          lastPlayRound.set(seat, round);
          plays.push({
            seat, round, cardId: choice.card.cardId, estValue: choice.value,
            leadingAtPlay: isLeading(seat), index,
          });
        }
      }
    }

    // --- audit --------------------------------------------------------------
    if (opts.onAudit) {
      // A private stream per (seed, round, seat): the audit re-evaluates cards
      // that the policy may not have looked at, and must not advance evalRnd or
      // the game would differ depending on whether it was being observed.
      const auditCtx: EvalContext = {
        sim, seat, config,
        rnd: mulberry32(opts.seed ^ (round * 31) ^ (seat * 7919)),
        scratch, base: sim.db.snapshot(),
      };
      const bar = decide === DECK_POLICIES['ev-threshold'] ? holdBar(round, opts.price) : Number.NEGATIVE_INFINITY;
      opts.onAudit({
        seat, round,
        played: lastPlayRound.get(seat) === round ? (plays[plays.length - 1]?.cardId ?? null) : null,
        // Only the cards still in hand. The question the audit answers is "why is
        // this one still here?", and `played` records whether the round's single
        // play slot was already spent on something else.
        hand: hand.map((h) => {
          const card = cardById(h.cardId);
          const offCooldown = round - h.boughtRound >= ACCESS.playDelayRounds;
          const value = myopicValue(auditCtx, card, opts.price);
          return {
            cardId: h.cardId,
            boughtRound: h.boughtRound,
            offCooldown,
            legal: Number.isFinite(value),
            value: Number.isFinite(value) ? value : null,
            bar,
          };
        }),
      });
    }

    // --- buy ----------------------------------------------------------------
    if ((lastBuyRound.get(seat) ?? -1) !== round) {
      stat.buyOpportunities++;
      if (decide.wantsBuy(evalCtx, opts.price)) {
        const row = ctx.players.find((p) => p.player_index === seat);
        if (row && row.cash >= opts.price) {
          row.cash -= opts.price;
          stat.spentOnCards += opts.price;
          stat.cardsBought++;
          stat.buyRounds.push(round);
          hand.push({ cardId: drawCard(), boughtRound: round });
          lastBuyRound.set(seat, round);
        } else {
          stat.affordabilityDeclines++;
        }
      }
    }
  }

  function isLeading(seat: number): boolean {
    const scored = scoreSeats(sim);
    const best = Math.max(...scored.map((s) => s.netWorth));
    return (scored.find((s) => s.seat === seat)?.netWorth ?? 0) >= best;
  }

  const simOpts: SimOptions = {
    seats: opts.seats,
    seed: opts.seed,
    onTurnStart,
    onDecision,
    maxMoves: opts.maxMoves,
  };
  sim = new Sim(simOpts);
  await sim.setup();
  const result = await sim.run();

  const seatScores = scoreSeats(sim);
  for (const seat of deckSeats) {
    const stat = stats.get(seat)!;
    const hand = hands.get(seat)!;
    stat.cardsUnplayedAtEnd = hand.length;
    stat.cardIdsUnplayed = hand.map((h) => h.cardId);
    stat.meanIdleRoundsPerCard = stat.idleRounds.length
      ? stat.idleRounds.reduce((a, b) => a + b, 0) / stat.idleRounds.length
      : 0;
  }

  return {
    seed: opts.seed,
    outcome: result.outcome,
    stallReason: result.stallReason,
    rounds: result.rounds,
    mergers: result.mergers,
    rejections: result.rejections,
    seatScores,
    winners: winnersOf(seatScores),
    moneyInPlay,
    deckStats: [...stats.values()].sort((a, b) => a.seat - b.seat),
    plays,
    log: result.log,
  };
}
