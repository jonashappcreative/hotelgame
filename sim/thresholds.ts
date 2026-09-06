// =============================================================================
// thresholds — the effect sizes this study committed to before it ran
// =============================================================================
// Pre-registration, in one file, so nothing below can be tuned after seeing the
// answer. A sweep of hundreds of cells will always produce a handful of p < 0.05
// results; without a stated "how big is big enough to act on", those are noise
// with a decimal point. Every verdict the report renders is a comparison against
// a constant defined here.
// =============================================================================

/** Base-game fairness. */
export const FAIRNESS = {
  /**
   * Seat advantage worth acting on. A 1.5 percentage-point deviation from the
   * uniform 1/N win rate is roughly the smallest edge a player could notice
   * across a few hundred games, and well below what seating conventions
   * (host sits first) would justify changing.
   */
  seatWinRatePP: 0.015,
  /**
   * A rule parameter creates a genuine choice when the archetype that exploits
   * it neither wins nor loses more than this against the field.
   */
  strategyWinRatePP: 0.03,
  /** Net-worth difference below this is not a design signal, whatever its p-value. */
  netWorthDollars: 300,
  /** False-discovery rate applied across the whole config x metric grid. */
  fdrQ: 0.05,
};

/** Card valuation. All expressed relative to `lambda x price`, the par value of a card. */
export const BANDS = {
  /**
   * Mean value may sit this far either side of par and still be "in band".
   * Wide on purpose: a 40% tolerance is about one price step in a game whose
   * share prices move in $100 increments, so a tighter band would be claiming
   * precision the game itself does not have.
   */
  meanTolerance: 0.4,
  /**
   * Ceiling bound. A card whose 95th-percentile outcome exceeds three times par
   * has a jackpot tail: it can be fairly priced on average and still produce the
   * game-warping turn that players remember and resent.
   */
  ceilingMultiple: 3,
  /**
   * Dead-draw rate. Above this a card is situational rather than universal, and
   * must be judged in a different band; above `deadText` it is not a card, it is
   * a paragraph players learn to skip.
   */
  situational: 0.35,
  deadText: 0.6,
  /** A value within this fraction of zero counts as a dead draw for the floor test. */
  deadEpsilon: 0.1,
};

/** Starting values for the three access rules, per the plan. Inputs, not conclusions. */
export const ACCESS_DEFAULTS = {
  /** One card purchasable per round, globally — the frequency lever set once instead of per card. */
  cardsPerRound: 1,
  /**
   * A card bought this round is playable next round at the earliest. This is
   * what makes "value at buy time" a meaningful number: the buyer cannot fully
   * predict the state the card will resolve in, so its price cannot simply be
   * the value of a move they were already going to make.
   */
  playDelayRounds: 1,
  /**
   * $200 flat. Deliberately the cheapest number in the game (a Sackson share at
   * founding), so every card's simulated value is judged against a low anchor
   * rather than against a number picked to already fit a few of them.
   */
  flatPrice: 200,
};

/** The three-tier price points used for the tier model's band tests. */
export const TIER_PRICES: Record<1 | 2 | 3, number> = { 1: 200, 2: 500, 3: 1200 };
