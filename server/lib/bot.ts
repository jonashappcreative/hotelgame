// =============================================================================
// bot — server-side AI for Hotel Game bot players.
// =============================================================================
// `decideBotMove` is given the current DB state (the game_states row, all
// game_players rows, and the acting bot's row) and returns ONE legal engine
// action + payload for the current phase. The driver in game-action.ts applies
// it through the real engine, so the bot never needs to mutate state itself —
// it only needs to choose a legal move.
//
// Difficulty:
//   easy   — a random legal move in every phase, including a random legal
//            sell/trade/keep split at a merger. Never uses the optional
//            sell_stocks feature.
//   medium — simple, legible heuristics: concentrate on cheap chains, ride the
//            chain it founded, stop at an unassailable majority, and sell scrap
//            positions only when it cannot afford the share it wants.
//   hard   — values every move in dollars: price appreciation, expected
//            majority/minority bonuses discounted by how contested the chain
//            still is, 2:1 trade equity, and liquidity. Reads its own hand one
//            round ahead, and reads every opponent's holdings and cash.
//
// All legality/pricing uses the shared rules module so it matches the engine.
// A rejected move stops the drive loop for the turn, so every payload built
// here mirrors the engine's own validation before it is emitted.
// =============================================================================

import {
  type ChainName,
  type TileId,
  type CustomRules,
  normalizeRules,
  getSafeChainSize,
  getBoardDimensions,
  getEligibleChains,
  getBonusTier,
  getSellPriceFactor,
  getStockPrice,
  getSellPrice,
  getBonuses,
  getAdjacentTiles,
  MAX_STOCKS_PER_TURN,
  END_GAME_CHAIN_SIZE,
  SMALL_BOARD_END_GAME_SIZE,
} from './rules';
import { STOCKS_PER_CHAIN } from '../../src/types/game';

export type BotDifficulty = 'easy' | 'medium' | 'hard';
export interface BotMove { action: string; payload?: any }

const ALL_CHAINS: ChainName[] = [
  'sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial',
];

// --- tuning constants --------------------------------------------------------

// 13 of 25 shares can never be caught, so a chain at this holding is settled
// and further shares in it buy nothing but equity.
const MAJORITY_LOCK = Math.floor(STOCKS_PER_CHAIN / 2) + 1;
// Tiles a live chain is assumed to gain while we hold it. Used to price the
// headroom of a young chain against a mature one.
const GROWTH_HORIZON = 5;
// Shares that typically win a contested majority — the unit of "cost to
// dominate" when choosing which chain to found.
const MAJORITY_TARGET = 7;
// How much of an opponent's gain counts against a move of ours. Below 1 because
// denying a rival is worth less than earning it ourselves.
const DENIAL_WEIGHT = 0.35;
// Extra weight on cash when we cannot afford to act — liquidity we can spend
// beats equity we cannot.
const CASH_URGENCY = 1.6;
// Floor on how much an uncontested-looking standing is trusted early, when the
// bank is still full and anyone can still buy in.
const MIN_CONFIDENCE = 0.15;

// Tier ranking, now a tiebreak only (see rankFoundingChains).
const TIER_RANK: Record<string, number> = { budget: 0, midrange: 1, premium: 2 };
const CHAIN_TIER: Record<ChainName, string> = {
  sackson: 'budget', tower: 'budget',
  worldwide: 'midrange', american: 'midrange', festival: 'midrange',
  continental: 'premium', imperial: 'premium',
};

// --- small utilities ---------------------------------------------------------

function rnd<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Inclusive on both ends.
function rndInt(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Bots read the same normalised rules the engine does, so a legacy v1 snapshot
// never has the bot playing by different rules from the humans at the table.
function rules(gameState: any): CustomRules {
  return normalizeRules(gameState.rules_snapshot);
}

// --- decision context --------------------------------------------------------

interface Rival {
  index: number;
  cash: number;
  stocks: Record<string, number>;
}

// Everything a decision needs, resolved once per move so the individual scorers
// stay short and side-effect free.
interface Ctx {
  diff: BotDifficulty;
  r: CustomRules;
  gs: any;
  me: any;
  myIndex: number;
  cash: number;
  hand: TileId[];
  board: Record<string, any>;
  chains: Record<string, any>;
  bank: Record<string, number>;
  bonusTier: 'standard' | 'flat' | 'aggressive';
  sellFactor: number;
  safeSize: number | null;
  endGameSize: number;
  boardRows: number;
  boardColsCount: number;
  rivals: Rival[];
  active: ChainName[];
  /** Chains we could merge away next round with a tile already in hand, mapped
   *  to the chain that would survive it. Drives the cheap-share arbitrage. */
  mergeTargets: Map<ChainName, ChainName>;
  /** True when we cannot afford a single share of any active chain. */
  broke: boolean;
  /** True when no opponent can afford a share either. */
  rivalsBroke: boolean;
}

function buildCtx(diff: BotDifficulty, gameState: any, players: any[], actor: any): Ctx {
  const r = rules(gameState);
  const { boardRows, boardColsCount } = getBoardDimensions(r);
  const chains = gameState.chains ?? {};
  const bank = gameState.stock_bank ?? {};
  const myIndex = actor.player_index;

  const active = ALL_CHAINS.filter((c) => chains[c]?.isActive);
  const rivals: Rival[] = (players ?? [])
    .filter((p: any) => p.player_index !== myIndex)
    .map((p: any) => ({ index: p.player_index, cash: p.cash ?? 0, stocks: p.stocks ?? {} }));

  const cash = actor.cash ?? 0;
  const prices = active.map((c) => getStockPrice(c, chains[c].tiles.length));
  const cheapest = prices.length > 0 ? Math.min(...prices) : Infinity;

  const ctx: Ctx = {
    diff,
    r,
    gs: gameState,
    me: actor,
    myIndex,
    cash,
    hand: actor.tiles ?? [],
    board: gameState.board ?? {},
    chains,
    bank,
    bonusTier: getBonusTier(r),
    sellFactor: getSellPriceFactor(r),
    safeSize: getSafeChainSize(r),
    endGameSize: boardRows === 6 ? SMALL_BOARD_END_GAME_SIZE : END_GAME_CHAIN_SIZE,
    boardRows,
    boardColsCount,
    rivals,
    active,
    mergeTargets: new Map(),
    broke: active.length > 0 && cash < cheapest,
    rivalsBroke: rivals.length > 0 && rivals.every((p) => p.cash < cheapest),
  };

  ctx.mergeTargets = findMergeTargets(ctx);
  return ctx;
}

const sizeOf = (ctx: Ctx, c: ChainName): number => ctx.chains[c]?.tiles.length ?? 0;
const priceOf = (ctx: Ctx, c: ChainName): number => getStockPrice(c, sizeOf(ctx, c));
const myShares = (ctx: Ctx, c: ChainName): number => ctx.me.stocks?.[c] ?? 0;
const bankLeft = (ctx: Ctx, c: ChainName): number => ctx.bank[c] ?? 0;
const rivalShares = (ctx: Ctx, c: ChainName): number[] => ctx.rivals.map((p) => p.stocks?.[c] ?? 0);

// --- opponent model ----------------------------------------------------------

// What one holder can expect to collect from a chain's bonuses, mirroring
// getStockholderRankings + calculateFinalScores (including the flat tier and
// the sole-holder case that pays both bonuses).
function expectedBonus(
  mine: number,
  rivals: number[],
  bonuses: { majority: number; minority: number },
  bonusTier: string,
): number {
  if (mine <= 0) return 0;

  if (bonusTier === 'flat') {
    const holders = rivals.filter((x) => x > 0).length + 1;
    return Math.floor((bonuses.majority + bonuses.minority) / holders);
  }

  const all = [mine, ...rivals.filter((x) => x > 0)];
  const top = Math.max(...all);
  const leaders = all.filter((x) => x === top).length;

  if (mine === top) {
    const behind = all.filter((x) => x < top);
    // Nobody in second place — the leaders split both bonuses.
    if (behind.length === 0) return Math.floor((bonuses.majority + bonuses.minority) / leaders);
    return Math.floor(bonuses.majority / leaders);
  }

  const behind = all.filter((x) => x < top);
  const second = Math.max(...behind);
  if (mine === second) {
    return Math.floor(bonuses.minority / behind.filter((x) => x === second).length);
  }
  return 0;
}

// How much a standing can be trusted. Early, with the bank full, anyone can
// still buy in; once the shares are gone the ranking is close to final.
function confidence(ctx: Ctx, c: ChainName): number {
  return clamp(1 - bankLeft(ctx, c) / STOCKS_PER_CHAIN, MIN_CONFIDENCE, 1);
}

// Total the opponents expect to collect from one chain's bonuses.
function rivalBonusTotal(
  ctx: Ctx,
  c: ChainName,
  bonuses: { majority: number; minority: number },
): number {
  const mine = myShares(ctx, c);
  const all = rivalShares(ctx, c);
  return all.reduce((sum, held, i) => {
    const others = [mine, ...all.filter((_, j) => j !== i)];
    return sum + expectedBonus(held, others, bonuses, ctx.bonusTier);
  }, 0);
}

// --- placement classification (mirrors the place_tile handler) ---------------

interface Placement {
  tileId: TileId;
  legal: boolean;
  type: 'merge' | 'grow' | 'found' | 'isolated' | 'illegal';
  growChain?: ChainName;
  mergeChains?: ChainName[];
  mergesSafe?: boolean; // would merge >=2 safe chains (permanently dead tile)
  /** Tiles the new chain would start with, when type === 'found'. */
  clusterSize?: number;
}

function classifyPlacement(tileId: TileId, gameState: any, r: CustomRules): Placement {
  const { boardRows, boardColsCount } = getBoardDimensions(r);
  const eligible = getEligibleChains(r);
  const board = gameState.board ?? {};
  const chains = gameState.chains ?? {};

  const adjacent = getAdjacentTiles(tileId, boardRows, boardColsCount);
  const adjChains = new Set<ChainName>();
  let adjUnincorp = 0;
  for (const a of adjacent) {
    const t = board[a];
    if (t?.placed) {
      if (t.chain) adjChains.add(t.chain as ChainName);
      else adjUnincorp++;
    }
  }
  const chainArr = Array.from(adjChains);

  if (chainArr.length >= 2) {
    const safeCount = chainArr.filter((c) => chains[c]?.isSafe).length;
    if (safeCount >= 2) {
      return { tileId, legal: false, type: 'illegal', mergeChains: chainArr, mergesSafe: true };
    }
    return { tileId, legal: true, type: 'merge', mergeChains: chainArr };
  }

  if (chainArr.length === 1) {
    return { tileId, legal: true, type: 'grow', growChain: chainArr[0] };
  }

  if (adjUnincorp > 0) {
    const available = eligible.filter((c) => !chains[c]?.isActive);
    if (available.length === 0) {
      return { tileId, legal: false, type: 'illegal' };
    }
    return { tileId, legal: true, type: 'found', clusterSize: adjUnincorp + 1 };
  }

  return { tileId, legal: true, type: 'isolated' };
}

// --- hand lookahead ----------------------------------------------------------

// Chains we could merge away with a tile we already hold, mapped to the chain
// that would swallow them. Shares in these are about to pay their bonus and
// convert 2:1, which is what makes cheap shares in a doomed chain worth buying.
function findMergeTargets(ctx: Ctx): Map<ChainName, ChainName> {
  const targets = new Map<ChainName, ChainName>();
  for (const tileId of ctx.hand) {
    const p = classifyPlacement(tileId, ctx.gs, ctx.r);
    if (!p.legal || p.type !== 'merge') continue;
    const involved = [...(p.mergeChains ?? [])].sort((a, b) => sizeOf(ctx, b) - sizeOf(ctx, a));
    const survivor = involved[0];
    for (const d of involved.slice(1)) {
      if (!targets.has(d)) targets.set(d, survivor);
    }
  }
  return targets;
}

// Tiles still in hand that touch this one — a chain founded here can be grown
// again next round without drawing luck.
function handAdjacency(ctx: Ctx, tileId: TileId, exclude: TileId): number {
  const neighbours = new Set(getAdjacentTiles(tileId, ctx.boardRows, ctx.boardColsCount));
  return ctx.hand.filter((t) => t !== exclude && neighbours.has(t)).length;
}

// --- valuation ---------------------------------------------------------------

// Marginal dollar value of holding one more share of `c`, given `extra` shares
// already added this turn. The three terms are the whole of hard's buy thesis:
// price headroom, the bonus the extra share actually unlocks, and trade equity
// when we can merge the chain away ourselves.
function shareValue(ctx: Ctx, c: ChainName, extra = 0): number {
  const size = sizeOf(ctx, c);
  const price = getStockPrice(c, size);
  const mine = myShares(ctx, c) + extra;

  // An unassailable majority is already banked; more shares only tie up cash.
  if (mine >= MAJORITY_LOCK) return 0;

  const survivor = ctx.mergeTargets.get(c);
  const imminent = survivor !== undefined;
  const rivals = rivalShares(ctx, c);

  // A chain about to be merged away will not appreciate; one that lives on will.
  const appreciation = imminent ? 0 : getStockPrice(c, size + GROWTH_HORIZON) - price;

  // Bonuses are paid on the size at payout: now for a merge we control, later
  // for a chain that keeps growing. A merge we can trigger ourselves is the one
  // standing we can actually count on, hence full confidence.
  const payoutSize = imminent ? size : size + GROWTH_HORIZON;
  const bonuses = getBonuses(c, payoutSize, ctx.bonusTier);
  const conf = imminent ? 1 : confidence(ctx, c);
  const delta =
    expectedBonus(mine + 1, rivals, bonuses, ctx.bonusTier) -
    expectedBonus(mine, rivals, bonuses, ctx.bonusTier);

  // Two defunct shares become one surviving share, priced after the merge.
  let trade = 0;
  if (imminent) {
    const mergedSize = size + sizeOf(ctx, survivor!) + 1;
    trade = Math.max(0, getStockPrice(survivor!, mergedSize) / 2 - price);
  }

  return appreciation + delta * conf + trade;
}

// Dollar value of the last share we hold in `c` — what we give up by selling it.
function holdValue(ctx: Ctx, c: ChainName): number {
  const mine = myShares(ctx, c);
  if (mine <= 0) return 0;
  return shareValue(ctx, c, -1);
}

// --- placement ---------------------------------------------------------------

// Chains available to found, ranked by how cheaply we could come to dominate
// them. A budget chain reaches a majority for roughly half the outlay of a
// premium one, so tier is a tiebreak, not the lead term.
function rankFoundingChains(ctx: Ctx, clusterSize: number): ChainName[] {
  const eligible = getEligibleChains(ctx.r).filter((c) => !ctx.chains[c]?.isActive);
  const choices = eligible.length > 0
    ? eligible
    : ALL_CHAINS.filter((c) => !ctx.chains[c]?.isActive);

  const score = (c: ChainName): number => {
    const price = getStockPrice(c, clusterSize);
    if (price <= 0) return 0;
    const bonuses = getBonuses(c, clusterSize + GROWTH_HORIZON, ctx.bonusTier);
    // Return on the cash it takes to secure the majority we are founding for.
    const roi = bonuses.majority / (MAJORITY_TARGET * price);
    // How much of that race this turn's cash actually covers.
    const affordable = Math.min(MAX_STOCKS_PER_TURN, Math.floor(ctx.cash / price));
    return roi * 1000 + affordable * 25 + TIER_RANK[CHAIN_TIER[c]] * 5;
  };

  return [...choices].sort((a, b) => score(b) - score(a));
}

// Dollar value of founding here: the free share, its headroom, the head start
// it gives us in the bonus race, and whether we can keep growing it next round.
function foundValue(ctx: Ctx, p: Placement): number {
  const cluster = p.clusterSize ?? 2;
  const best = rankFoundingChains(ctx, cluster)[0];
  if (!best) return 0;

  const price = getStockPrice(best, cluster);
  const later = getStockPrice(best, cluster + GROWTH_HORIZON);
  const bonuses = getBonuses(best, cluster + GROWTH_HORIZON, ctx.bonusTier);
  const head = expectedBonus(1, rivalShares(ctx, best), bonuses, ctx.bonusTier) *
    confidence(ctx, best);

  return price + (later - price) + head
    + cluster * 40
    + handAdjacency(ctx, p.tileId, p.tileId) * 60;
}

// Dollar value of growing `c` by one tile: our shares appreciate, but so do
// everyone else's, and pushing a rival's chain to safe size or over the
// end-game line hands them the game.
function growValue(ctx: Ctx, c: ChainName): number {
  const size = sizeOf(ctx, c);
  const delta = getStockPrice(c, size + 1) - getStockPrice(c, size);
  const mine = myShares(ctx, c);
  const rivals = rivalShares(ctx, c);
  const rivalTotal = rivals.reduce((s, x) => s + x, 0);
  const rivalBest = rivals.length > 0 ? Math.max(...rivals) : 0;

  let value = mine * delta - rivalTotal * delta * DENIAL_WEIGHT;

  // Making a chain we do not lead safe locks in someone else's majority.
  if (ctx.safeSize !== null && size < ctx.safeSize && size + 1 >= ctx.safeSize && rivalBest > mine) {
    value -= getBonuses(c, size + 1, ctx.bonusTier).majority * 0.25;
  }

  // Triggering the end while behind on that chain cashes out their position.
  if (size + 1 >= ctx.endGameSize && rivalBest > mine) {
    value -= getBonuses(c, size + 1, ctx.bonusTier).majority * 0.5;
  }

  return value + 25; // a quiet legal move still beats passing
}

// Dollar value of firing this merge. Beyond our own bonus this counts the
// opponents' take against us, the full-price liquidation a merge gives us when
// we are cash-starved, and the risk of re-arming a table that has run dry.
function mergeValue(ctx: Ctx, p: Placement): number {
  const involved = [...(p.mergeChains ?? [])].sort((a, b) => sizeOf(ctx, b) - sizeOf(ctx, a));
  const survivor = involved[0];
  const defunct = involved.slice(1);
  if (!survivor) return 0;

  const mergedSize = involved.reduce((s, c) => s + sizeOf(ctx, c), 0) + 1;
  const survivorPrice = getStockPrice(survivor, mergedSize);

  let value = 0;
  let rivalCashGain = 0;

  for (const d of defunct) {
    const size = sizeOf(ctx, d);
    const price = getStockPrice(d, size);
    const bonuses = getBonuses(d, size, ctx.bonusTier);
    const mine = myShares(ctx, d);

    value += expectedBonus(mine, rivalShares(ctx, d), bonuses, ctx.bonusTier);

    const rivalTake = rivalBonusTotal(ctx, d, bonuses);
    value -= rivalTake * DENIAL_WEIGHT;

    // Defunct shares liquidate at full book price — the cheapest cash in the
    // game, and the reason a "bad" merge can still be the right move when we
    // cannot afford to buy anything.
    const liquidation = mine * price;
    value += ctx.broke ? liquidation * CASH_URGENCY : liquidation * 0.1;

    // What is left converts 2:1 into the survivor.
    value += Math.floor(mine / 2) * Math.max(0, survivorPrice - price);

    const rivalHeld = rivalShares(ctx, d).reduce((s, x) => s + x, 0);
    rivalCashGain += rivalTake + rivalHeld * price;
  }

  // Our own survivor shares reprice upward on the merge.
  value += myShares(ctx, survivor) * (survivorPrice - getStockPrice(survivor, sizeOf(ctx, survivor)));

  // A table with no cash cannot bid against us. Waking it up costs us tempo.
  if (ctx.rivalsBroke && !ctx.broke) value -= rivalCashGain * DENIAL_WEIGHT;

  return value;
}

// Medium's deliberately simple placement score, unchanged in spirit: prefer
// founding, then growing what it holds, with a rough merge estimate.
function mediumPlacementScore(ctx: Ctx, p: Placement): number {
  switch (p.type) {
    case 'found':
      return 100;
    case 'grow': {
      const c = p.growChain!;
      return 30 + myShares(ctx, c) * priceOf(ctx, c) * 0.02;
    }
    case 'merge': {
      const involved = [...(p.mergeChains ?? [])].sort((a, b) => sizeOf(ctx, b) - sizeOf(ctx, a));
      const survivor = involved[0];
      let swing = 0;
      for (const d of involved.slice(1)) {
        const bonuses = getBonuses(d, sizeOf(ctx, d), ctx.bonusTier);
        swing += expectedBonus(myShares(ctx, d), rivalShares(ctx, d), bonuses, ctx.bonusTier);
      }
      swing += myShares(ctx, survivor) * 2;
      return 20 + swing * 0.05;
    }
    default:
      return 5;
  }
}

function hardPlacementScore(ctx: Ctx, p: Placement): number {
  switch (p.type) {
    case 'found': return foundValue(ctx, p);
    case 'grow': return growValue(ctx, p.growChain!);
    case 'merge': return mergeValue(ctx, p);
    default: return 10; // isolated — keeps the board open without helping anyone
  }
}

function decidePlaceTile(ctx: Ctx): BotMove {
  const hand = ctx.hand;
  const placements = hand.map((t) => classifyPlacement(t, ctx.gs, ctx.r));
  const playable = placements.filter((p) => p.legal);

  if (playable.length === 0) {
    // No legal placement — exchange a tile to draw a fresh one. Prefer a
    // permanently-dead tile (merges 2+ safe chains); else any tile.
    const dead = placements.find((p) => p.mergesSafe);
    const toDiscard = dead?.tileId ?? hand[0];
    return { action: 'discard_tile', payload: { tileId: toDiscard } };
  }

  if (ctx.diff === 'easy') {
    return { action: 'place_tile', payload: { tileId: rnd(playable).tileId } };
  }

  const score = ctx.diff === 'hard' ? hardPlacementScore : mediumPlacementScore;
  const ranked = [...playable].sort((a, b) => score(ctx, b) - score(ctx, a));

  // Medium plays a near-best tile, not the best one.
  if (ctx.diff === 'medium' && ranked.length > 1 && Math.random() < 0.3) {
    return { action: 'place_tile', payload: { tileId: ranked[1].tileId } };
  }
  return { action: 'place_tile', payload: { tileId: ranked[0].tileId } };
}

// --- founding ----------------------------------------------------------------

function decideFoundChain(ctx: Ctx): BotMove {
  const chains = ctx.chains;
  const eligible = getEligibleChains(ctx.r).filter((c) => !chains[c]?.isActive);
  const choices = eligible.length > 0 ? eligible : ALL_CHAINS.filter((c) => !chains[c]?.isActive);

  if (ctx.diff === 'easy') {
    return { action: 'found_chain', payload: { chainName: rnd(choices) } };
  }

  if (ctx.diff === 'medium') {
    // Medium still reaches for the prestigious chain, and sometimes just picks.
    const byTier = [...choices].sort((a, b) => TIER_RANK[CHAIN_TIER[b]] - TIER_RANK[CHAIN_TIER[a]]);
    const chainName = byTier.length > 1 && Math.random() < 0.4 ? rnd(byTier) : byTier[0];
    return { action: 'found_chain', payload: { chainName } };
  }

  // Hard founds where a majority is cheapest to buy, which is usually a budget
  // chain — the cheap shares double as trade fodder at the first merger.
  const cluster = (ctx.gs.pending_chain_foundation?.length as number) || 2;
  const ranked = rankFoundingChains(ctx, cluster).filter((c) => choices.includes(c));
  return { action: 'found_chain', payload: { chainName: ranked[0] ?? choices[0] } };
}

// --- merger ------------------------------------------------------------------

function decideChooseSurvivor(ctx: Ctx): BotMove {
  const chains = ctx.chains;
  const last = ctx.gs.last_placed_tile;

  const adj = last ? getAdjacentTiles(last, ctx.boardRows, ctx.boardColsCount) : [];
  const adjChains = [...new Set(
    adj
      .filter((t) => ctx.board[t]?.placed && ctx.board[t]?.chain)
      .map((t) => ctx.board[t].chain as ChainName),
  )];
  const pool = adjChains.length > 0 ? adjChains : ALL_CHAINS.filter((c) => chains[c]?.isActive);

  // Degenerate state (nothing adjacent, nothing active): let the engine's own
  // validation speak rather than sending an undefined chain.
  if (pool.length === 0) return { action: 'choose_merger_survivor', payload: {} };

  // Only chains tied for the largest are sensible survivors.
  const maxSize = Math.max(...pool.map((c) => sizeOf(ctx, c)));
  const tied = pool.filter((c) => sizeOf(ctx, c) === maxSize);

  if (ctx.diff === 'easy') {
    return { action: 'choose_merger_survivor', payload: { survivingChain: rnd(tied) } };
  }

  if (ctx.diff === 'medium') {
    // Keep alive the chain we hold the most stock in.
    const best = [...tied].sort((a, b) => myShares(ctx, b) - myShares(ctx, a))[0];
    return { action: 'choose_merger_survivor', payload: { survivingChain: best } };
  }

  // Hard keeps the chain worth the most to us: equity plus the bonus we expect
  // to collect from it once it has grown.
  const value = (c: ChainName): number => {
    const size = sizeOf(ctx, c);
    const bonuses = getBonuses(c, size + GROWTH_HORIZON, ctx.bonusTier);
    return myShares(ctx, c) * getStockPrice(c, size)
      + expectedBonus(myShares(ctx, c), rivalShares(ctx, c), bonuses, ctx.bonusTier) * confidence(ctx, c);
  };
  const best = [...tied].sort((a, b) => value(b) - value(a))[0];
  return { action: 'choose_merger_survivor', payload: { survivingChain: best } };
}

function decideMergerStock(ctx: Ctx): BotMove {
  const merger = ctx.gs.merger;
  const defunct = merger.currentDefunctChain as ChainName;
  const surviving = merger.survivingChain as ChainName;
  const shares: number = myShares(ctx, defunct);
  const bankSurv: number = bankLeft(ctx, surviving);

  if (shares <= 0) {
    return { action: 'merger_stock_choice', payload: { decision: { sell: 0, trade: 0, keep: 0 } } };
  }

  const maxPairs = Math.min(Math.floor(shares / 2), bankSurv);

  if (ctx.diff === 'easy') {
    // A random legal split. Trade must be even and is bounded by the bank.
    const trade = rndInt(0, maxPairs) * 2;
    const rest = shares - trade;
    const sell = rndInt(0, rest);
    return {
      action: 'merger_stock_choice',
      payload: { decision: { sell, trade, keep: rest - sell } },
    };
  }

  const defunctPrice = getStockPrice(defunct, sizeOf(ctx, defunct));

  if (ctx.diff === 'medium') {
    // Medium doubles down on a chain it already owns, and otherwise takes cash.
    if (myShares(ctx, surviving) > 0 && maxPairs > 0) {
      const trade = maxPairs * 2;
      return {
        action: 'merger_stock_choice',
        payload: { decision: { sell: shares - trade, trade, keep: 0 } },
      };
    }
    return { action: 'merger_stock_choice', payload: { decision: { sell: shares, trade: 0, keep: 0 } } };
  }

  // Hard compares every legal trade/sell split. Keeping is never priced in:
  // final scoring skips inactive chains, so a kept share pays only if the
  // chain is founded again later.
  const survSize = sizeOf(ctx, surviving);
  const survPrice = getStockPrice(surviving, survSize);
  const survBonuses = getBonuses(surviving, survSize + GROWTH_HORIZON, ctx.bonusTier);
  const survRivals = rivalShares(ctx, surviving);
  const held = myShares(ctx, surviving);
  const conf = confidence(ctx, surviving);
  const cashWeight = ctx.broke ? CASH_URGENCY : 1;

  let bestPairs = 0;
  let bestValue = -Infinity;
  for (let pairs = 0; pairs <= maxPairs; pairs++) {
    const gained = pairs;
    const bonusGain =
      expectedBonus(held + gained, survRivals, survBonuses, ctx.bonusTier) -
      expectedBonus(held, survRivals, survBonuses, ctx.bonusTier);
    const value = gained * survPrice + bonusGain * conf
      + (shares - pairs * 2) * defunctPrice * cashWeight;
    if (value > bestValue) {
      bestValue = value;
      bestPairs = pairs;
    }
  }

  const trade = bestPairs * 2;
  return {
    action: 'merger_stock_choice',
    payload: { decision: { sell: shares - trade, trade, keep: 0 } },
  };
}

// --- selling -----------------------------------------------------------------

interface Sale { chain: ChainName; quantity: number }

// Chains we are allowed to sell right now, mirroring settleSale's rejections.
function sellableChains(ctx: Ctx): ChainName[] {
  const boughtThisTurn = (ctx.gs.chains_bought_this_turn ?? []) as ChainName[];
  return ctx.active.filter((c) => myShares(ctx, c) > 0 && !boughtThisTurn.includes(c));
}

const sellPriceOf = (ctx: Ctx, c: ChainName): number =>
  getSellPrice(c, sizeOf(ctx, c), ctx.sellFactor);

// Medium sells only to unblock itself: scrap positions only, never its best
// chain, and never more than it needs.
function mediumSale(ctx: Ctx): Sale[] | null {
  const target = mediumBuyTarget(ctx);
  if (!target) return null;

  const needed = priceOf(ctx, target);
  if (ctx.cash >= needed) return null; // not cash-blocked

  const sources = sellableChains(ctx)
    .filter((c) => c !== target)
    .filter((c) => myShares(ctx, c) <= 2)
    .filter((c) => {
      const rivals = rivalShares(ctx, c);
      const best = rivals.length > 0 ? Math.max(...rivals) : 0;
      return myShares(ctx, c) <= best; // never break up a lead
    })
    .sort((a, b) => sellPriceOf(ctx, b) - sellPriceOf(ctx, a));

  const sales: Sale[] = [];
  let raised = 0;
  let sold = 0;
  const cap = Math.min(2, MAX_STOCKS_PER_TURN);

  for (const c of sources) {
    const available = Math.min(myShares(ctx, c), cap - sold);
    for (let i = 0; i < available && ctx.cash + raised < needed; i++) {
      raised += sellPriceOf(ctx, c);
      sold++;
      const existing = sales.find((s) => s.chain === c);
      if (existing) existing.quantity++;
      else sales.push({ chain: c, quantity: 1 });
    }
    if (ctx.cash + raised >= needed || sold >= cap) break;
  }

  // Selling at a haircut is only worth it if it actually buys the share.
  if (sales.length === 0 || ctx.cash + raised < needed) return null;
  return sales;
}

// Hard sells only when the cash converts into a strictly better position — the
// classic case being funding the majority in a chain it is about to merge.
function hardSale(ctx: Ctx): Sale[] | null {
  const candidates = ctx.active
    .filter((c) => bankLeft(ctx, c) > 0)
    .map((c) => ({ chain: c, value: shareValue(ctx, c), price: priceOf(ctx, c) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const target = candidates[0];
  if (!target) return null;
  if (ctx.cash >= target.price) return null; // no need to raise anything

  const sources = sellableChains(ctx)
    .filter((c) => c !== target.chain)
    .map((c) => ({ chain: c, giveUp: holdValue(ctx, c), proceeds: sellPriceOf(ctx, c) }))
    .filter((x) => x.proceeds > 0 && x.giveUp < target.value)
    .sort((a, b) => a.giveUp - b.giveUp);

  const sales: Sale[] = [];
  let raised = 0;
  let surrendered = 0;
  let sold = 0;

  for (const src of sources) {
    const available = Math.min(myShares(ctx, src.chain), MAX_STOCKS_PER_TURN - sold);
    for (let i = 0; i < available && ctx.cash + raised < target.price; i++) {
      raised += src.proceeds;
      surrendered += src.giveUp;
      sold++;
      const existing = sales.find((s) => s.chain === src.chain);
      if (existing) existing.quantity++;
      else sales.push({ chain: src.chain, quantity: 1 });
    }
    if (ctx.cash + raised >= target.price || sold >= MAX_STOCKS_PER_TURN) break;
  }

  if (sales.length === 0) return null;
  if (ctx.cash + raised < target.price) return null; // would not unblock the buy
  if (surrendered >= target.value) return null;      // not worth what it costs us
  return sales;
}

// --- buying ------------------------------------------------------------------

// Medium's ranking: cheap shares and chains it already holds. It stops at an
// unassailable majority and walks away from a race it cannot win, but never
// looks deeper than that.
function mediumDesirability(ctx: Ctx, c: ChainName, bought: Record<string, number>): number {
  const held = myShares(ctx, c) + (bought[c] ?? 0);
  if (held >= MAJORITY_LOCK) return -Infinity; // majority already locked up

  const rivals = rivalShares(ctx, c);
  const best = rivals.length > 0 ? Math.max(...rivals) : 0;
  // Someone is so far ahead that our shares can never overtake them.
  if (best >= MAJORITY_LOCK || held + bankLeft(ctx, c) <= best) return -Infinity;

  return (held + 1) * 100 - priceOf(ctx, c) * 0.5;
}

function mediumBuyTarget(ctx: Ctx): ChainName | null {
  const candidates = ctx.active.filter((c) => bankLeft(ctx, c) > 0);
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort(
    (a, b) => mediumDesirability(ctx, b, {}) - mediumDesirability(ctx, a, {}),
  );
  const top = ranked[0];
  return mediumDesirability(ctx, top, {}) === -Infinity ? null : top;
}

function decideBuyPhase(ctx: Ctx): BotMove {
  const gs = ctx.gs;

  // Buying is incremental for humans, but a bot commits its whole purchase in a
  // single action — once it has bought this turn, end the turn rather than
  // re-entering this decision on the next drive-loop tick.
  if ((gs.stocks_purchased_this_turn ?? 0) > 0) return { action: 'skip_buy' };

  // Selling comes first: a chain bought this turn can no longer be sold, and
  // one sale per turn is enough for any plan the bots make.
  if (ctx.diff !== 'easy' && ctx.sellFactor > 0 && (gs.stocks_sold_this_turn ?? 0) === 0) {
    const sales = ctx.diff === 'medium' ? mediumSale(ctx) : hardSale(ctx);
    if (sales && sales.length > 0) return { action: 'sell_stocks', payload: { sales } };
  }

  const buyable = ctx.active.filter((c) => bankLeft(ctx, c) > 0);
  if (buyable.length === 0) return { action: 'skip_buy' };
  if (!buyable.some((c) => priceOf(ctx, c) <= ctx.cash)) return { action: 'skip_buy' };

  if (ctx.diff === 'easy') {
    // A random quantity of a random affordable chain, including none at all.
    const affordable = buyable.filter((c) => priceOf(ctx, c) <= ctx.cash);
    const wanted = rndInt(0, MAX_STOCKS_PER_TURN);
    if (wanted === 0) return { action: 'skip_buy' };

    let cash = ctx.cash;
    const picked: Record<string, number> = {};
    const left: Record<string, number> = {};
    for (const c of affordable) left[c] = bankLeft(ctx, c);

    for (let i = 0; i < wanted; i++) {
      const options = affordable.filter((c) => priceOf(ctx, c) <= cash && left[c] > 0);
      if (options.length === 0) break;
      const pick = rnd(options);
      picked[pick] = (picked[pick] ?? 0) + 1;
      left[pick]--;
      cash -= priceOf(ctx, pick);
    }
    const purchases = toPurchases(picked);
    return purchases.length > 0
      ? { action: 'buy_stocks', payload: { purchases } }
      : { action: 'skip_buy' };
  }

  // Greedily buy up to 3 shares, re-scoring after each (price, bank and our own
  // holdings all move as we go).
  let cash = ctx.cash;
  const bought: Record<string, number> = {};
  const left: Record<string, number> = {};
  for (const c of buyable) left[c] = bankLeft(ctx, c);

  for (let i = 0; i < MAX_STOCKS_PER_TURN; i++) {
    const options = buyable.filter((c) => priceOf(ctx, c) <= cash && left[c] > 0);
    if (options.length === 0) break;

    const scored = options
      .map((c) => ({
        chain: c,
        score: ctx.diff === 'medium'
          ? mediumDesirability(ctx, c, bought)
          : shareValue(ctx, c, bought[c] ?? 0),
      }))
      .filter((x) => Number.isFinite(x.score))
      .sort((a, b) => b.score - a.score);

    // Hard only spends when the share is actually worth something to it.
    const pick = scored[0];
    if (!pick) break;
    if (ctx.diff === 'hard' && pick.score <= 0) break;

    bought[pick.chain] = (bought[pick.chain] ?? 0) + 1;
    left[pick.chain]--;
    cash -= priceOf(ctx, pick.chain);

    // Medium stops early sometimes rather than always filling its allowance.
    if (ctx.diff === 'medium' && Math.random() < 0.25) break;
  }

  const purchases = toPurchases(bought);
  if (purchases.length === 0) return { action: 'skip_buy' };
  return { action: 'buy_stocks', payload: { purchases } };
}

function toPurchases(bought: Record<string, number>): { chain: string; quantity: number }[] {
  return Object.entries(bought)
    .filter(([, q]) => q > 0)
    .map(([chain, quantity]) => ({ chain, quantity }));
}

// --- entry point -------------------------------------------------------------

export function decideBotMove(
  difficulty: BotDifficulty,
  phase: string,
  gameState: any,
  players: any[],
  actor: any,
): BotMove {
  const ctx = buildCtx(difficulty, gameState, players, actor);

  switch (phase) {
    case 'place_tile':
      return decidePlaceTile(ctx);
    case 'found_chain':
      return decideFoundChain(ctx);
    case 'merger_choose_survivor':
      return decideChooseSurvivor(ctx);
    case 'merger_pay_bonuses':
      // No decision to make — just advance the merger (engine pays bonuses).
      return { action: 'pay_merger_bonuses' };
    case 'merger_handle_stock':
      return decideMergerStock(ctx);
    case 'buy_stock':
      return decideBuyPhase(ctx);
    default:
      // Unknown / non-actionable phase — skip safely.
      return { action: 'skip_buy' };
  }
}
