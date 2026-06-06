// =============================================================================
// bot — server-side AI for Acquire bot players.
// =============================================================================
// `decideBotMove` is given the current DB state (the game_states row, all
// game_players rows, and the acting bot's row) and returns ONE legal engine
// action + payload for the current phase. The driver in game-action.ts applies
// it through the real engine, so the bot never needs to mutate state itself —
// it only needs to choose a legal move.
//
// Difficulty:
//   easy   — near-random legal moves.
//   medium — simple, deliberately flawed heuristics.
//   hard   — scores every legal move with an evaluation function (net worth +
//            majority-bonus expectation) and picks the best; shallow lookahead.
//
// All legality/pricing uses the shared rules module so it matches the engine.
// =============================================================================

import {
  type ChainName,
  type TileId,
  type CustomRules,
  DEFAULT_RULES,
  getSafeChainSize,
  getBoardDimensions,
  getEligibleChains,
  getBonusTier,
  getStockPrice,
  getBonuses,
  getAdjacentTiles,
  getStockholderRankings,
} from './rules';

export type BotDifficulty = 'easy' | 'medium' | 'hard';
export interface BotMove { action: string; payload?: any }

const ALL_CHAINS: ChainName[] = [
  'sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial',
];

// --- small utilities ---------------------------------------------------------

function rnd<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rules(gameState: any): CustomRules {
  return { ...DEFAULT_RULES, ...(gameState.rules_snapshot ?? {}) };
}

// Tier ranking used by the founding heuristic (premium chains are worth more).
const TIER_RANK: Record<string, number> = { budget: 0, midrange: 1, premium: 2 };
const CHAIN_TIER: Record<ChainName, string> = {
  sackson: 'budget', tower: 'budget',
  worldwide: 'midrange', american: 'midrange', festival: 'midrange',
  continental: 'premium', imperial: 'premium',
};

// --- placement classification (mirrors the place_tile handler) ---------------

interface Placement {
  tileId: TileId;
  legal: boolean;
  type: 'merge' | 'grow' | 'found' | 'isolated' | 'illegal';
  growChain?: ChainName;
  mergeChains?: ChainName[];
  mergesSafe?: boolean; // would merge >=2 safe chains (permanently dead tile)
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
    return { tileId, legal: true, type: 'found' };
  }

  return { tileId, legal: true, type: 'isolated' };
}

// --- evaluation helpers (medium/hard) ----------------------------------------

// game_players rows -> the {id, stocks} shape the ranking helper expects. Needs
// to be attached to the gameState by the caller (we stash it lazily).
function playersForRanking(gameState: any): any[] {
  return gameState.__players?.map((p: any) => ({
    id: `player-${p.player_index}`,
    stocks: p.stocks,
  })) ?? [];
}

// --- per-phase decisions -----------------------------------------------------

function decidePlaceTile(diff: BotDifficulty, gameState: any, actor: any): BotMove {
  const r = rules(gameState);
  const hand: TileId[] = actor.tiles ?? [];
  const placements = hand.map((t) => classifyPlacement(t, gameState, r));
  const playable = placements.filter((p) => p.legal);

  if (playable.length === 0) {
    // No legal placement — discard a tile to draw a fresh one. Prefer a
    // permanently-dead tile (merges 2+ safe chains); else any tile.
    const dead = placements.find((p) => p.mergesSafe);
    const toDiscard = dead?.tileId ?? hand[0];
    return { action: 'discard_tile', payload: { tileId: toDiscard } };
  }

  if (diff === 'easy') {
    return { action: 'place_tile', payload: { tileId: rnd(playable).tileId } };
  }

  const bonusTier = getBonusTier(r);
  const chains = gameState.chains ?? {};
  const myShares = (name: ChainName) => actor.stocks?.[name] ?? 0;

  const score = (p: Placement): number => {
    switch (p.type) {
      case 'found': {
        // Founding gives a free share + sets up a majority in a fresh chain.
        return 100;
      }
      case 'grow': {
        const c = chains[p.growChain!];
        const size = c?.tiles.length ?? 0;
        const price = getStockPrice(p.growChain!, size + 1);
        // Growing helps most when we hold shares in that chain.
        return 30 + myShares(p.growChain!) * price * 0.02;
      }
      case 'merge': {
        // Estimate the bonus swing for us across defunct chains.
        const mc = p.mergeChains ?? [];
        const sorted = [...mc].sort((a, b) => (chains[b]?.tiles.length ?? 0) - (chains[a]?.tiles.length ?? 0));
        const surviving = sorted[0];
        const defunct = sorted.slice(1);
        let swing = 0;
        const states = playersForRanking(gameState);
        for (const d of defunct) {
          const size = chains[d]?.tiles.length ?? 0;
          const bonuses = getBonuses(d, size, bonusTier);
          const { majority, minority } = getStockholderRankings(states, d);
          const id = `player-${actor.player_index}`;
          if (majority.some((x: any) => x.id === id)) swing += Math.floor(bonuses.majority / Math.max(1, majority.length));
          else if (minority.some((x: any) => x.id === id)) swing += Math.floor(bonuses.minority / Math.max(1, minority.length));
        }
        // Slightly value keeping a chain we hold alive as the survivor.
        swing += myShares(surviving) * 2;
        return 20 + swing * 0.05;
      }
      default:
        return 5; // isolated placement
    }
  };

  // Founding: bias toward the most valuable available chain tier when we found.
  const best = [...playable].sort((a, b) => score(b) - score(a));
  const top = best[0];

  if (diff === 'medium') {
    // Medium prefers grow/found but with noise — sometimes picks 2nd best.
    if (best.length > 1 && Math.random() < 0.3) {
      return { action: 'place_tile', payload: { tileId: best[1].tileId } };
    }
  }
  return { action: 'place_tile', payload: { tileId: top.tileId } };
}

function decideFoundChain(diff: BotDifficulty, gameState: any): BotMove {
  const r = rules(gameState);
  const chains = gameState.chains ?? {};
  const eligible = getEligibleChains(r).filter((c) => !chains[c]?.isActive);
  const choices = eligible.length > 0 ? eligible : ALL_CHAINS.filter((c) => !chains[c]?.isActive);

  let chainName: ChainName;
  if (diff === 'easy') {
    chainName = rnd(choices);
  } else {
    // Prefer the highest-tier available chain (more valuable founder position).
    const sorted = [...choices].sort((a, b) => TIER_RANK[CHAIN_TIER[b]] - TIER_RANK[CHAIN_TIER[a]]);
    chainName = diff === 'medium' && sorted.length > 1 && Math.random() < 0.4 ? rnd(sorted) : sorted[0];
  }
  return { action: 'found_chain', payload: { chainName } };
}

function decideChooseSurvivor(diff: BotDifficulty, gameState: any, actor: any): BotMove {
  const r = rules(gameState);
  const { boardRows, boardColsCount } = getBoardDimensions(r);
  const chains = gameState.chains ?? {};
  const last = gameState.last_placed_tile;
  const board = gameState.board ?? {};

  const adj = last ? getAdjacentTiles(last, boardRows, boardColsCount) : [];
  const adjChains = [...new Set(
    adj.filter((t) => board[t]?.placed && board[t]?.chain).map((t) => board[t].chain as ChainName),
  )];
  const pool = adjChains.length > 0 ? adjChains : ALL_CHAINS.filter((c) => chains[c]?.isActive);

  // Only chains tied for the largest are sensible survivors.
  const maxSize = Math.max(...pool.map((c) => chains[c]?.tiles.length ?? 0));
  const tied = pool.filter((c) => (chains[c]?.tiles.length ?? 0) === maxSize);

  let survivingChain: ChainName;
  if (diff === 'easy') {
    survivingChain = rnd(tied);
  } else {
    // Keep alive the chain we hold the most stock in.
    survivingChain = [...tied].sort(
      (a, b) => (actor.stocks?.[b] ?? 0) - (actor.stocks?.[a] ?? 0),
    )[0];
  }
  return { action: 'choose_merger_survivor', payload: { survivingChain } };
}

function decideMergerStock(diff: BotDifficulty, gameState: any, actor: any): BotMove {
  const merger = gameState.merger;
  const defunct = merger.currentDefunctChain as ChainName;
  const surviving = merger.survivingChain as ChainName;
  const shares: number = actor.stocks?.[defunct] ?? 0;
  const bankSurv: number = gameState.stock_bank?.[surviving] ?? 0;

  if (shares <= 0) {
    return { action: 'merger_stock_choice', payload: { decision: { sell: 0, trade: 0, keep: 0 } } };
  }

  if (diff === 'easy') {
    // Keep everything (simplest legal choice).
    return { action: 'merger_stock_choice', payload: { decision: { sell: 0, trade: 0, keep: shares } } };
  }

  if (diff === 'medium') {
    // Cash out entirely.
    return { action: 'merger_stock_choice', payload: { decision: { sell: shares, trade: 0, keep: 0 } } };
  }

  // Hard: trade as many as possible (2:1, bounded by the bank) into the
  // surviving chain, sell the remainder.
  const maxPairs = Math.min(Math.floor(shares / 2), bankSurv);
  const trade = maxPairs * 2;
  const sell = shares - trade;
  return { action: 'merger_stock_choice', payload: { decision: { sell, trade, keep: 0 } } };
}

function decideBuy(diff: BotDifficulty, gameState: any, actor: any): BotMove {
  const r = rules(gameState);
  const bonusTier = getBonusTier(r);
  const chains = gameState.chains ?? {};
  const bank = gameState.stock_bank ?? {};
  let cash = actor.cash ?? 0;

  const active = ALL_CHAINS.filter((c) => chains[c]?.isActive && (bank[c] ?? 0) > 0);
  if (active.length === 0) return { action: 'skip_buy' };

  const priceOf = (c: ChainName) => getStockPrice(c, chains[c].tiles.length);
  const affordable = active.filter((c) => priceOf(c) <= cash);
  if (affordable.length === 0) return { action: 'skip_buy' };

  if (diff === 'easy') {
    // Half the time skip; otherwise buy a single random affordable share.
    if (Math.random() < 0.5) return { action: 'skip_buy' };
    return { action: 'buy_stocks', payload: { purchases: [{ chain: rnd(affordable), quantity: 1 }] } };
  }

  // Greedily buy up to 3 shares, re-scoring after each (price/bank/cash change).
  const bought: Record<string, number> = {};
  const remainingBank: Record<string, number> = {};
  for (const c of active) remainingBank[c] = bank[c] ?? 0;

  const desirability = (c: ChainName): number => {
    const size = chains[c].tiles.length;
    const price = priceOf(c);
    const held = (actor.stocks?.[c] ?? 0) + (bought[c] ?? 0);
    if (diff === 'medium') {
      // Cheap shares and chains we already hold; ignores deeper strategy.
      return (held + 1) * 100 - price * 0.5;
    }
    // Hard: value larger chains and majority potential; discount by price.
    const bonuses = getBonuses(c, size, bonusTier);
    return size * price * 0.02 + held * 30 + bonuses.majority * 0.01 - price * 0.05;
  };

  for (let i = 0; i < 3; i++) {
    const candidates = active.filter((c) => priceOf(c) <= cash && remainingBank[c] > 0);
    if (candidates.length === 0) break;
    const pick = [...candidates].sort((a, b) => desirability(b) - desirability(a))[0];
    // Medium stops once it has a couple of shares of one chain; hard fills to 3.
    bought[pick] = (bought[pick] ?? 0) + 1;
    remainingBank[pick] -= 1;
    cash -= priceOf(pick);
    if (diff === 'medium' && Math.random() < 0.25) break;
  }

  const purchases = Object.entries(bought)
    .filter(([, q]) => q > 0)
    .map(([chain, quantity]) => ({ chain, quantity }));

  if (purchases.length === 0) return { action: 'skip_buy' };
  return { action: 'buy_stocks', payload: { purchases } };
}

// --- entry point -------------------------------------------------------------

export function decideBotMove(
  difficulty: BotDifficulty,
  phase: string,
  gameState: any,
  players: any[],
  actor: any,
): BotMove {
  // Stash players on the state so the eval/ranking helpers can read everyone's
  // holdings without changing every signature.
  gameState.__players = players;

  switch (phase) {
    case 'place_tile':
      return decidePlaceTile(difficulty, gameState, actor);
    case 'found_chain':
      return decideFoundChain(difficulty, gameState);
    case 'merger_choose_survivor':
      return decideChooseSurvivor(difficulty, gameState, actor);
    case 'merger_pay_bonuses':
      // No decision to make — just advance the merger (engine pays bonuses).
      return { action: 'pay_merger_bonuses' };
    case 'merger_handle_stock':
      return decideMergerStock(difficulty, gameState, actor);
    case 'buy_stock':
      return decideBuy(difficulty, gameState, actor);
    default:
      // Unknown / non-actionable phase — skip safely.
      return { action: 'skip_buy' };
  }
}
