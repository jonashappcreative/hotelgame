// =============================================================================
// policies — the agent population the simulator plays against
// =============================================================================
// server/lib/bot.ts is never modified. The three shipped difficulties are the
// primary population precisely because they are legible: you can read exactly
// why "hard" buys what it buys, and that legibility is what makes a price
// explainable later. Everything measured here is valid *relative to this
// population*, which is why every headline number is reported per tier and a
// conclusion only counts if it is stable across tiers.
//
// The five archetypes exist for one question the difficulties cannot answer:
// "is a strategic line dominant?" They are deliberately thin — a base policy
// plus a rewrite of the buy or placement choice — and every rewrite is checked
// against the same rules helpers the engine enforces, falling back to the base
// move when it would be illegal. A policy that emits an illegal move shows up
// immediately as a rejection, which the harness counts and the study asserts
// to be zero.
// =============================================================================

import { decideBotMove, type BotDifficulty } from '../server/lib/bot';
import {
  type ChainName,
  CHAINS,
  MAX_STOCKS_PER_TURN,
  normalizeRules,
  getSellPriceFactor,
  getStockPrice,
  getAdjacentTiles,
  getBoardDimensions,
  getEligibleChains,
} from '../server/lib/rules';

export interface Move { action: string; payload?: any }
export type Policy = (phase: string, state: any, players: any[], actor: any) => Move;

export type PolicyName =
  | 'easy' | 'medium' | 'hard'
  | 'budget-focused' | 'premium-focused' | 'merger-hunter' | 'cash-hoarder' | 'aggressive-seller';

export const DIFFICULTIES: PolicyName[] = ['easy', 'medium', 'hard'];
export const ARCHETYPES: PolicyName[] = [
  'budget-focused', 'premium-focused', 'merger-hunter', 'cash-hoarder', 'aggressive-seller',
];

const ALL_CHAINS = Object.keys(CHAINS) as ChainName[];

function base(difficulty: BotDifficulty): Policy {
  return (phase, state, players, actor) => decideBotMove(difficulty, phase, state, players, actor);
}

// -----------------------------------------------------------------------------
// Shared legality helpers — the same conditions game-action.ts checks
// -----------------------------------------------------------------------------

function affordablePurchase(
  state: any, actor: any, chains: ChainName[], budgetShares: number,
): { chain: ChainName; quantity: number }[] {
  const already = state.stocks_purchased_this_turn ?? 0;
  let remaining = Math.min(budgetShares, MAX_STOCKS_PER_TURN - already);
  let cash = actor.cash;
  const bank = { ...state.stock_bank };
  const out: { chain: ChainName; quantity: number }[] = [];

  for (const chain of chains) {
    if (remaining <= 0) break;
    if (!state.chains?.[chain]?.isActive) continue;
    const price = getStockPrice(chain, state.chains[chain].tiles.length);
    let qty = 0;
    while (qty < remaining && bank[chain] - qty > 0 && cash >= price) {
      qty++;
      cash -= price;
    }
    if (qty > 0) {
      out.push({ chain, quantity: qty });
      bank[chain] -= qty;
      remaining -= qty;
    }
  }
  return out;
}

function tierOrder(preferred: 'budget' | 'premium'): ChainName[] {
  const rank = (c: ChainName) => {
    const t = CHAINS[c].tier;
    const score = t === 'budget' ? 0 : t === 'midrange' ? 1 : 2;
    return preferred === 'budget' ? score : -score;
  };
  return [...ALL_CHAINS].sort((a, b) => rank(a) - rank(b));
}

/** Placements this seat may legally make, with whether each one triggers a merger. */
function classifyHand(state: any, actor: any): { tileId: string; merges: boolean; legal: boolean }[] {
  const rules = normalizeRules(state.rules_snapshot);
  const { boardRows, boardColsCount } = getBoardDimensions(rules);
  const eligible = getEligibleChains(rules);
  const chains = state.chains ?? {};
  const board = state.board ?? {};

  return (actor.tiles ?? []).map((tileId: string) => {
    const adjacent = getAdjacentTiles(tileId, boardRows, boardColsCount);
    const adjChains = new Set<ChainName>();
    let unincorporated = 0;
    for (const adj of adjacent) {
      const tile = board[adj];
      if (!tile?.placed) continue;
      if (tile.chain) adjChains.add(tile.chain as ChainName);
      else unincorporated++;
    }
    const list = [...adjChains];
    const mergesSafe = list.length >= 2 && list.filter((c) => chains[c]?.isSafe).length >= 2;
    const noSlot = list.length === 0 && unincorporated > 0 &&
      eligible.filter((c) => !chains[c]?.isActive).length === 0;
    return { tileId, merges: list.length >= 2 && !mergesSafe, legal: !mergesSafe && !noSlot };
  });
}

function sellableBasket(state: any, actor: any): { chain: ChainName; quantity: number }[] {
  const rules = normalizeRules(state.rules_snapshot);
  if (getSellPriceFactor(rules) <= 0) return [];
  const boughtThisTurn: ChainName[] = (state.chains_bought_this_turn ?? []) as ChainName[];
  const sold = state.stocks_sold_this_turn ?? 0;
  let allowance = MAX_STOCKS_PER_TURN - sold;
  if (allowance <= 0) return [];

  const out: { chain: ChainName; quantity: number }[] = [];
  // Sell the smallest positions first: an aggressive seller is liquidating
  // scrap, not dismantling a majority it is about to be paid for.
  const held = ALL_CHAINS
    .filter((c) => (actor.stocks?.[c] ?? 0) > 0 && state.chains?.[c]?.isActive && !boughtThisTurn.includes(c))
    .sort((a, b) => (actor.stocks[a] ?? 0) - (actor.stocks[b] ?? 0));

  for (const chain of held) {
    if (allowance <= 0) break;
    const qty = Math.min(allowance, actor.stocks[chain]);
    out.push({ chain, quantity: qty });
    allowance -= qty;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Archetypes
// -----------------------------------------------------------------------------

/** Buys only toward one end of the chain-tier ladder; otherwise plays "hard". */
function tierFocused(preferred: 'budget' | 'premium'): Policy {
  const inner = base('hard');
  const order = tierOrder(preferred);
  return (phase, state, players, actor) => {
    if (phase !== 'buy_stock') return inner(phase, state, players, actor);
    const purchases = affordablePurchase(state, actor, order, MAX_STOCKS_PER_TURN);
    if (purchases.length === 0) return { action: 'skip_buy' };
    return { action: 'buy_stocks', payload: { purchases } };
  };
}

/** Prefers tiles that trigger a merger; falls back to "hard" when none do. */
function mergerHunter(): Policy {
  const inner = base('hard');
  return (phase, state, players, actor) => {
    if (phase !== 'place_tile') return inner(phase, state, players, actor);
    const merging = classifyHand(state, actor).filter((p) => p.legal && p.merges);
    if (merging.length === 0) return inner(phase, state, players, actor);
    return { action: 'place_tile', payload: { tileId: merging[0].tileId } };
  };
}

/** Never buys; banks the cash and collects bonuses on founder shares alone. */
function cashHoarder(): Policy {
  const inner = base('hard');
  return (phase, state, players, actor) => {
    if (phase === 'buy_stock') return { action: 'skip_buy' };
    return inner(phase, state, players, actor);
  };
}

/** Liquidates its smallest positions every turn the rules allow it to. */
function aggressiveSeller(): Policy {
  const inner = base('hard');
  return (phase, state, players, actor) => {
    if (phase !== 'buy_stock') return inner(phase, state, players, actor);
    const sales = sellableBasket(state, actor);
    if (sales.length > 0) return { action: 'sell_stocks', payload: { sales } };
    return inner(phase, state, players, actor);
  };
}

const REGISTRY: Record<PolicyName, () => Policy> = {
  easy: () => base('easy'),
  medium: () => base('medium'),
  hard: () => base('hard'),
  'budget-focused': () => tierFocused('budget'),
  'premium-focused': () => tierFocused('premium'),
  'merger-hunter': mergerHunter,
  'cash-hoarder': cashHoarder,
  'aggressive-seller': aggressiveSeller,
};

export function policy(name: PolicyName): Policy {
  const build = REGISTRY[name];
  if (!build) throw new Error(`unknown policy: ${name}`);
  return build();
}

export function seatsOf(names: PolicyName[]) {
  return names.map((name) => ({ policy: policy(name), label: name }));
}

/** N identical seats — the configuration the seat-fairness null hypothesis needs. */
export function uniformSeats(name: PolicyName, count: number) {
  return seatsOf(Array(count).fill(name) as PolicyName[]);
}
