// =============================================================================
// effects — the 24-card pool, expressed as things the simulator can measure
// =============================================================================
// Each card is a legality predicate plus a treatment: a patch applied to the
// position, and optionally a hook that keeps acting as the rollout plays on
// (which is how windowed and permanent effects are modelled without touching
// the engine). Levers are named with the card doc's own glossary, so tuning a
// card here is the same operation as arguing about it there.
//
// Fidelity is declared per card and carried all the way into the workbench,
// because it is the single most important caveat on any number below:
//
//   'exact'        the patch is what the rules text says, in engine terms.
//   'approx'       the patch stands in for an effect the engine cannot express;
//                  the note says which direction the approximation errs.
//   'unmeasurable' the effect is real but invisible to this agent population —
//                  information cards, whose value requires an opponent model
//                  that reads the information. Reported as unmeasurable, never
//                  as "worth $0".
//   'derived'      priced arithmetically from the other cards, not simulated.
//
// Nothing here modifies server/. Per-turn budgets (stocks_purchased_this_turn,
// stocks_sold_this_turn, chains_bought_this_turn) live in mutable state rather
// than in code, which is what lets most of Group B be a two-line patch.
// =============================================================================

import type { Tables } from './memory-db';
import type { TurnContext } from './harness';
import {
  type ChainName,
  CHAINS,
  MAX_STOCKS_PER_TURN,
  normalizeRules,
  getStockPrice,
  getBonuses,
  getSafeChainSize,
  getBoardDimensions,
  getEligibleChains,
  getBonusTier,
  getStockholderRankings,
  getAdjacentTiles,
} from '../server/lib/rules';

export type Fidelity = 'exact' | 'approx' | 'unmeasurable' | 'derived';
export type MoneySource = 'bank' | 'player' | 'neutral';
export type LeverType = 'magnitude' | 'scope' | 'duration' | 'frequency' | 'compensation' | 'cost-shape';

export interface LeverOption { id: string; label: string; value: any }
export interface Lever {
  id: string;
  type: LeverType;
  question: string;
  options: LeverOption[];
}

export type Levers = Record<string, any>;

export interface PoolConfig {
  /**
   * Card doc §7 Q4 as one switch instead of four. Threads through every card
   * that references chain safety: Demolition Permit, Hostile Takeover, Spin Off,
   * Antitrust Filing, Tender Offer, Five Star Upgrade.
   */
  allowSafeChainTargeting: boolean;
}

export const DEFAULT_POOL_CONFIG: PoolConfig = { allowSafeChainTargeting: false };

export interface CardContext {
  tables: Tables;
  seat: number;
  levers: Levers;
  config: PoolConfig;
}

export type DecisionHook = (ctx: TurnContext & { phase: string }) => void;

export interface Treatment {
  patch: (tables: Tables) => void;
  onTurnStart?: (ctx: TurnContext) => void;
  onDecision?: DecisionHook;
}

export interface CardDef {
  id: string;
  name: string;
  group: 'A' | 'B' | 'C' | 'D';
  /** The card doc's provisional assignment (§5.1). What the band test checks against. */
  tier: 1 | 2 | 3;
  effect: string;
  source: MoneySource;
  fidelity: Fidelity;
  /** What the simulation actually does, and which way it errs. Required whenever fidelity is not 'exact'. */
  note?: string;
  riskNote?: string;
  levers: Lever[];
  /** Would a player be able to play this card here at all? */
  legal: (ctx: CardContext) => boolean;
  /** Built fresh for every rollout, because hooks carry state ("the next merger", "for N rounds"). */
  treatment: (ctx: CardContext) => Treatment;
}

// -----------------------------------------------------------------------------
// Position helpers
// -----------------------------------------------------------------------------

const ALL_CHAINS = Object.keys(CHAINS) as ChainName[];

export function gs(tables: Tables): any {
  return (tables.game_states ?? [])[0];
}
export function seatRow(tables: Tables, seat: number): any {
  return (tables.game_players ?? []).find((p) => p.player_index === seat);
}
export function opponents(tables: Tables, seat: number): any[] {
  return (tables.game_players ?? []).filter((p) => p.player_index !== seat);
}
function rules(tables: Tables) {
  return normalizeRules(gs(tables)?.rules_snapshot);
}
function activeChains(tables: Tables): ChainName[] {
  const chains = gs(tables)?.chains ?? {};
  return ALL_CHAINS.filter((c) => chains[c]?.isActive);
}
function sizeOf(tables: Tables, chain: ChainName): number {
  return gs(tables)?.chains?.[chain]?.tiles?.length ?? 0;
}
function priceOf(tables: Tables, chain: ChainName): number {
  return getStockPrice(chain, sizeOf(tables, chain));
}
function isSafe(tables: Tables, chain: ChainName): boolean {
  return !!gs(tables)?.chains?.[chain]?.isSafe;
}
function held(tables: Tables, seat: number, chain: ChainName): number {
  return seatRow(tables, seat)?.stocks?.[chain] ?? 0;
}

/** The opponent this card would rationally be pointed at: whoever is doing best. */
export function leadingOpponent(tables: Tables, seat: number): any | null {
  const rivals = opponents(tables, seat);
  if (rivals.length === 0) return null;
  const worth = (p: any) => {
    let total = p.cash ?? 0;
    for (const c of activeChains(tables)) total += (p.stocks?.[c] ?? 0) * priceOf(tables, c);
    return total;
  };
  return rivals.reduce((best, p) => (worth(p) > worth(best) ? p : best));
}

/** The chain this seat has the most riding on — the natural target of a self-serving card. */
export function bestOwnChain(tables: Tables, seat: number): ChainName | null {
  const candidates = activeChains(tables).filter((c) => held(tables, seat, c) > 0);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) =>
    held(tables, seat, c) * priceOf(tables, c) > held(tables, seat, best) * priceOf(tables, best) ? c : best);
}

/** The chain a denial card should point at: the leader's biggest position that is not also ours. */
export function bestRivalChain(tables: Tables, seat: number): ChainName | null {
  const rival = leadingOpponent(tables, seat);
  if (!rival) return null;
  const candidates = activeChains(tables)
    .filter((c) => (rival.stocks?.[c] ?? 0) > held(tables, seat, c));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) =>
    (rival.stocks?.[c] ?? 0) * priceOf(tables, c) > (rival.stocks?.[best] ?? 0) * priceOf(tables, best) ? c : best);
}

function payFromBank(tables: Tables, seat: number, amount: number): void {
  const row = seatRow(tables, seat);
  if (row) row.cash = Math.max(0, row.cash + amount);
}

/** Money moved between players — the money supply is unchanged, only its distribution. */
function transfer(tables: Tables, from: any, toSeat: number, amount: number, floor = 0): number {
  const moved = Math.max(0, Math.min(amount, (from.cash ?? 0) - floor));
  from.cash -= moved;
  payFromBank(tables, toSeat, moved);
  return moved;
}

// -----------------------------------------------------------------------------
// Board helpers — the geometry the Group D cards need
// -----------------------------------------------------------------------------

function dims(tables: Tables) {
  return getBoardDimensions(rules(tables));
}

/** Is a chain's tile set still one connected region after removing `drop`? */
export function stillConnected(tiles: string[], drop: string[], rows: number, cols: number): boolean {
  const remaining = new Set(tiles.filter((t) => !drop.includes(t)));
  if (remaining.size === 0) return true;
  const start = remaining.values().next().value as string;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const tile = queue.pop()!;
    for (const adj of getAdjacentTiles(tile, rows, cols)) {
      if (remaining.has(adj) && !seen.has(adj)) { seen.add(adj); queue.push(adj); }
    }
  }
  return seen.size === remaining.size;
}

/** Tiles this seat could legally place right now, classified the way the engine classifies them. */
export function handPlacements(tables: Tables, seat: number) {
  const state = gs(tables);
  const { boardRows, boardColsCount } = dims(tables);
  const eligible = getEligibleChains(rules(tables));
  const chains = state.chains ?? {};
  const board = state.board ?? {};

  return (seatRow(tables, seat)?.tiles ?? []).map((tileId: string) => {
    const adjacent = getAdjacentTiles(tileId, boardRows, boardColsCount);
    const adjChains = new Set<ChainName>();
    const unincorporated: string[] = [];
    for (const adj of adjacent) {
      const tile = board[adj];
      if (!tile?.placed) continue;
      if (tile.chain) adjChains.add(tile.chain as ChainName);
      else unincorporated.push(adj);
    }
    const list = [...adjChains];
    const mergesSafe = list.length >= 2 && list.filter((c) => chains[c]?.isSafe).length >= 2;
    const noSlot = list.length === 0 && unincorporated.length > 0 &&
      eligible.filter((c) => !chains[c]?.isActive).length === 0;
    return {
      tileId,
      adjacentChains: list,
      unincorporated,
      kind: list.length >= 2 ? 'merge' : list.length === 1 ? 'grow' : unincorporated.length > 0 ? 'found' : 'isolated',
      legal: !mergesSafe && !noSlot,
    };
  });
}

/**
 * Apply one extra tile placement, replicating the engine's own place_tile
 * arithmetic. Used by Franchise Expansion, which cannot be a state patch: the
 * engine allows exactly one placement per turn and there is no counter to move.
 * Merger resolution mirrors the auto_end_turn path (bonuses paid, tiles
 * transferred, defunct chains cleared), which is the same code shape a shipped
 * implementation would reuse.
 */
export function applyExtraPlacement(
  tables: Tables, seat: number, tileId: string, allowFound: boolean, allowMerge: boolean,
): boolean {
  const state = gs(tables);
  const placement = handPlacements(tables, seat).find((p) => p.tileId === tileId);
  if (!placement || !placement.legal) return false;
  if (placement.kind === 'found' && !allowFound) return false;
  if (placement.kind === 'merge' && !allowMerge) return false;

  const r = rules(tables);
  const safeSize = getSafeChainSize(r);
  const bonusTier = getBonusTier(r);
  const row = seatRow(tables, seat);
  row.tiles = row.tiles.filter((t: string) => t !== tileId);
  state.board[tileId] = { id: tileId, placed: true, chain: null };

  if (placement.kind === 'isolated') return true;

  if (placement.kind === 'grow') {
    const chain = placement.adjacentChains[0];
    const added = [tileId, ...placement.unincorporated];
    for (const t of added) state.board[t] = { ...state.board[t], chain };
    const all = [...state.chains[chain].tiles, ...added];
    state.chains[chain] = { ...state.chains[chain], tiles: all, isSafe: safeSize !== null && all.length >= safeSize };
    return true;
  }

  if (placement.kind === 'found') {
    const available = getEligibleChains(r).filter((c) => !state.chains[c]?.isActive);
    if (available.length === 0) return false;
    // Found the cheapest available chain: the founder share doubles as trade
    // fodder, which is what the engine's own "hard" bot reaches for.
    const chain = available[0];
    const added = [tileId, ...placement.unincorporated];
    for (const t of added) state.board[t] = { ...state.board[t], chain };
    state.chains[chain] = {
      ...state.chains[chain], tiles: added, isActive: true,
      isSafe: safeSize !== null && added.length >= safeSize,
    };
    if (state.stock_bank[chain] > 0) {
      state.stock_bank[chain]--;
      row.stocks[chain] = (row.stocks[chain] ?? 0) + 1;
    }
    return true;
  }

  // merge
  const sorted = [...placement.adjacentChains].sort((a, b) => sizeOf(tables, b) - sizeOf(tables, a));
  const survivor = sorted[0];
  const defunctList = sorted.slice(1);

  for (const defunct of defunctList) {
    const bonuses = getBonuses(defunct, sizeOf(tables, defunct), bonusTier);
    payMergerBonuses(tables, defunct, bonuses, bonusTier);
  }

  const moved = [tileId, ...placement.unincorporated];
  for (const defunct of defunctList) moved.push(...state.chains[defunct].tiles);
  for (const t of moved) state.board[t] = { ...state.board[t], chain: survivor };
  const all = [...new Set([...state.chains[survivor].tiles, ...moved])];
  state.chains[survivor] = { ...state.chains[survivor], tiles: all, isSafe: safeSize !== null && all.length >= safeSize };
  for (const defunct of defunctList) {
    state.chains[defunct] = { ...state.chains[defunct], tiles: [], isActive: false, isSafe: false };
  }
  return true;
}

/** The engine's bonus split, applied to a tables snapshot. Returns what each seat received. */
export function payMergerBonuses(
  tables: Tables, defunct: ChainName, bonuses: { majority: number; minority: number }, bonusTier: string,
): Map<number, number> {
  const players = (tables.game_players ?? []).map((p) => ({
    id: `player-${p.player_index}`, name: p.player_name, cash: p.cash, stocks: p.stocks,
  }));
  const payouts = bonusPayouts(players, defunct, bonuses, bonusTier);
  for (const [seat, amount] of payouts) payFromBank(tables, seat, amount);
  return payouts;
}

/** Pure: who gets what from one defunct chain, exactly as game-action.ts splits it. */
export function bonusPayouts(
  players: { id: string; stocks: Record<string, number> }[],
  defunct: ChainName,
  bonuses: { majority: number; minority: number },
  bonusTier: string,
): Map<number, number> {
  const out = new Map<number, number>();
  const seatOf = (id: string) => parseInt(id.split('-')[1], 10);

  if (bonusTier === 'flat') {
    const holders = players.filter((p) => (p.stocks[defunct] ?? 0) > 0);
    if (holders.length === 0) return out;
    const each = Math.floor((bonuses.majority + bonuses.minority) / holders.length);
    for (const h of holders) out.set(seatOf(h.id), each);
    return out;
  }

  const { majority, minority } = getStockholderRankings(players as any[], defunct);
  if (majority.length === 0) return out;
  if (minority.length === 0) {
    const each = Math.floor((bonuses.majority + bonuses.minority) / majority.length);
    for (const p of majority) out.set(seatOf(p.id), each);
    return out;
  }
  const majEach = Math.floor(bonuses.majority / majority.length);
  const minEach = Math.floor(bonuses.minority / minority.length);
  for (const p of majority) out.set(seatOf(p.id), majEach);
  for (const p of minority) out.set(seatOf(p.id), minEach);
  return out;
}

// -----------------------------------------------------------------------------
// Lever shorthand
// -----------------------------------------------------------------------------

function lever(id: string, type: LeverType, question: string, options: [string, any][]): Lever {
  return { id, type, question, options: options.map(([label, value]) => ({ id: String(value), label, value })) };
}

const noTreatment: Treatment = { patch: () => {} };

// =============================================================================
// Group A — tile flow and information
// =============================================================================

const marketScan: CardDef = {
  id: 'market-scan',
  name: 'Market Scan',
  group: 'A', tier: 1,
  effect: 'Look at the top N tiles of the bag. Keep 1, return the others to the bottom.',
  source: 'neutral',
  fidelity: 'approx',
  note:
    'The draw itself is modelled exactly — the kept tile is moved to the draw end of the bag and the ' +
    'rest to the bottom. What is not modelled is the information the look gives beyond that choice, ' +
    'so the number is a floor on the card, not a ceiling.',
  riskNote: 'None serious. The natural floor of the pool and the calibration anchor for one price unit.',
  levers: [
    lever('seen', 'magnitude', 'How many tiles are seen?', [['2', 2], ['3', 3], ['5', 5]]),
    lever('kept', 'magnitude', 'How many are kept?', [['1', 1], ['2', 2]]),
    lever('returned', 'scope', 'Where do the rest go?', [['Bottom of bag', 'bottom'], ['Reshuffled', 'shuffle']]),
  ],
  legal: (ctx) => (gs(ctx.tables)?.tile_bag?.length ?? 0) >= 3,
  treatment: (ctx) => ({
    patch: (tables) => {
      const state = gs(tables);
      const bag: string[] = state.tile_bag;
      const seen = bag.splice(bag.length - ctx.levers.seen, ctx.levers.seen);
      const ranked = seen.sort((a, b) => tileAppeal(tables, ctx.seat, b) - tileAppeal(tables, ctx.seat, a));
      const keep = ranked.slice(0, ctx.levers.kept);
      const rest = ranked.slice(ctx.levers.kept);
      if (ctx.levers.returned === 'bottom') bag.unshift(...rest);
      else bag.splice(Math.floor(bag.length / 2), 0, ...rest);
      // The draw end is the end of the array (the engine pops).
      bag.push(...keep);
    },
  }),
};

/** How much this seat wants a given tile: does it grow a chain they hold, or open one up? */
function tileAppeal(tables: Tables, seat: number, tileId: string): number {
  const state = gs(tables);
  const { boardRows, boardColsCount } = dims(tables);
  let score = 0;
  for (const adj of getAdjacentTiles(tileId, boardRows, boardColsCount)) {
    const tile = state.board?.[adj];
    if (!tile?.placed) continue;
    if (tile.chain) {
      const chain = tile.chain as ChainName;
      const stake = held(tables, seat, chain);
      const rivalBest = Math.max(0, ...opponents(tables, seat).map((p) => p.stocks?.[chain] ?? 0));
      // Growing a chain is worth the price step it buys us, less what the same
      // step hands the player who actually owns it. Without the second term a
      // "helpful" tile that enriches the board leader scores as a gain.
      score += stake * 60 - rivalBest * 35;
      if (stake === 0 && rivalBest === 0) score += 20;
    } else {
      score += 40; // an unincorporated neighbour is a founding opportunity
    }
  }
  return score;
}

const insiderTip: CardDef = {
  id: 'insider-tip',
  name: 'Insider Tip',
  group: 'A', tier: 1,
  effect: "Look at one opponent's rack.",
  source: 'neutral',
  fidelity: 'unmeasurable',
  note:
    'No policy in the agent population reads opponents\' racks — the bot\'s rival model is cash and ' +
    'shares only. A simulated value would therefore be exactly $0 by construction, which is a fact ' +
    'about the bots, not about the card. Pricing this needs either an agent that uses rack knowledge ' +
    'or a human playtest.',
  riskNote: 'Free to implement and free to hide in a digital build, which is exactly why it is tempting to over-tune.',
  levers: [
    lever('scope', 'magnitude', 'How much of the rack is seen?', [['All 6 tiles', 6], ['A random 3', 3]]),
    lever('duration', 'duration', 'For how long?', [['One look', 'once'], ['Until your next turn', 'window']]),
  ],
  legal: () => true,
  treatment: () => noTreatment,
};

const landBank: CardDef = {
  id: 'land-bank',
  name: 'Land Bank',
  group: 'A', tier: 1,
  effect: 'Reserve one tile from your rack. It is protected from becoming permanently unplayable.',
  source: 'neutral',
  fidelity: 'approx',
  note:
    'Modelled as its two observable consequences: a dead tile in hand is exchanged for a fresh draw, ' +
    'and — when the reserved tile does not count against the rack limit — the hand grows by one. ' +
    'The "held indefinitely" clause has no engine analogue and is not modelled.',
  riskNote: 'If reserved tiles are immune to the two-safe-chains rule, the card silently rewrites a core rule.',
  levers: [
    lever('slots', 'magnitude', 'How many tiles may be reserved?', [['1', 1], ['2', 2]]),
    lever('rackLimit', 'scope', 'Does a reserved tile count against the rack limit of 6?', [['Yes', true], ['No — hand size grows', false]]),
  ],
  legal: (ctx) => (seatRow(ctx.tables, ctx.seat)?.tiles?.length ?? 0) > 0,
  treatment: (ctx) => ({
    patch: (tables) => {
      const state = gs(tables);
      const row = seatRow(tables, ctx.seat);
      const dead = handPlacements(tables, ctx.seat).filter((p) => !p.legal).slice(0, ctx.levers.slots);
      for (const tile of dead) {
        row.tiles = row.tiles.filter((t: string) => t !== tile.tileId);
        state.tile_bag.unshift(tile.tileId);
        const drawn = state.tile_bag.pop();
        if (drawn) row.tiles.push(drawn);
      }
      if (!ctx.levers.rackLimit) {
        for (let i = 0; i < ctx.levers.slots; i++) {
          const drawn = state.tile_bag.pop();
          if (drawn) row.tiles.push(drawn);
        }
      }
    },
  }),
};

const surveyor: CardDef = {
  id: 'surveyor',
  name: 'Surveyor',
  group: 'A', tier: 1,
  effect: 'Discard any number of tiles from your rack and draw back up to 6.',
  source: 'bank',
  fidelity: 'exact',
  riskNote: 'Overlaps heavily with Market Scan. Probably keep one of the two unless they land in different tiers.',
  levers: [
    lever('max', 'magnitude', 'How many tiles may be exchanged?', [['Up to 3', 3], ['The full rack', 6]]),
    lever('cost', 'cost-shape', 'What does it cost?', [['Free', 0], ['$100 per tile', 100]]),
  ],
  legal: (ctx) => (gs(ctx.tables)?.tile_bag?.length ?? 0) > 0,
  treatment: (ctx) => ({
    patch: (tables) => {
      const state = gs(tables);
      const row = seatRow(tables, ctx.seat);
      // Exchange the least useful tiles first: dead ones, then the ones that
      // touch nothing on the board.
      const ranked = handPlacements(tables, ctx.seat)
        .map((p) => ({ ...p, appeal: p.legal ? tileAppeal(tables, ctx.seat, p.tileId) : -1 }))
        .sort((a, b) => a.appeal - b.appeal)
        .slice(0, ctx.levers.max)
        .filter((p) => p.appeal <= 20);
      for (const tile of ranked) {
        if (state.tile_bag.length === 0) break;
        row.tiles = row.tiles.filter((t: string) => t !== tile.tileId);
        state.tile_bag.unshift(tile.tileId);
        const drawn = state.tile_bag.pop();
        if (drawn) row.tiles.push(drawn);
        row.cash = Math.max(0, row.cash - ctx.levers.cost);
      }
    },
  }),
};

const zoningVeto: CardDef = {
  id: 'zoning-veto',
  name: 'Zoning Veto',
  group: 'A', tier: 2,
  effect: 'Cancel the next player\'s tile placement. They draw a replacement and place nothing this turn.',
  source: 'neutral',
  fidelity: 'approx',
  note:
    'The engine has no way to skip a turn, so the target instead loses its best tile (returned to the ' +
    'bag, replacement drawn) and its whole buy allowance for that turn. That is strictly weaker than ' +
    'removing the turn, so the measured value is a lower bound on the real card.',
  riskNote: 'The only card that removes a turn rather than altering it. Highest feel-bad potential, and it kingmakes: it hurts one player and helps everyone else equally.',
  levers: [
    lever('scope', 'scope', 'Which placements may be cancelled?', [['Any placement', 'any'], ['Only a merger or a founding', 'structural']]),
    lever('buyPhase', 'magnitude', 'Does the target still get its buy phase?', [['No', false], ['Yes', true]]),
  ],
  legal: (ctx) => opponents(ctx.tables, ctx.seat).length > 0,
  treatment: (ctx) => {
    const nextSeat = (ctx.seat + 1) % (ctx.tables.game_players?.length ?? 1);
    let fired = false;
    return {
      patch: () => {},
      onTurnStart: (turn) => {
        if (fired || turn.seat !== nextSeat) return;
        fired = true;
        const tables = { game_states: [turn.state], game_players: turn.players } as unknown as Tables;
        const placements = handPlacements(tables, nextSeat).filter((p) => p.legal);
        const eligible = ctx.levers.scope === 'structural'
          ? placements.filter((p) => p.kind === 'merge' || p.kind === 'found')
          : placements;
        if (eligible.length === 0) return;
        const best = eligible.reduce((a, b) =>
          tileAppeal(tables, nextSeat, b.tileId) > tileAppeal(tables, nextSeat, a.tileId) ? b : a);
        const row = turn.players.find((p) => p.player_index === nextSeat)!;
        row.tiles = row.tiles.filter((t: string) => t !== best.tileId);
        turn.state.tile_bag.unshift(best.tileId);
        const drawn = turn.state.tile_bag.pop();
        if (drawn) row.tiles.push(drawn);
        if (!ctx.levers.buyPhase) turn.state.stocks_purchased_this_turn = MAX_STOCKS_PER_TURN;
      },
    };
  },
};

// =============================================================================
// Group B — money and shares
// =============================================================================

const bridgeLoan: CardDef = {
  id: 'bridge-loan',
  name: 'Bridge Loan',
  group: 'B', tier: 1,
  effect: 'Buy up to 5 shares this turn instead of 3. The extra shares cost a premium.',
  source: 'bank',
  fidelity: 'approx',
  note:
    'Modelled as the settled trade rather than as a raised allowance: the extra shares are bought ' +
    'immediately, at list price plus the premium, from the same bank the engine draws on. Raising ' +
    'the allowance directly (a negative stocks_purchased_this_turn) does not work, because ' +
    'server/lib/bot.ts hardcodes the 3-share cap in its own buy loop instead of reading the counter ' +
    'the engine enforces — so a bot handed a 5-share turn either wastes it or overshoots into a ' +
    'rejected move. That is a real prerequisite for shipping this card, not a simulation artefact.',
  riskNote: 'Clean and easy to price: it converts money to position at a known exchange rate. The second calibration anchor.',
  levers: [
    lever('total', 'magnitude', 'How many shares in total?', [['4', 4], ['5', 5]]),
    lever('premium', 'cost-shape', 'What does the extra cost?', [['+20%', 0.2], ['+50%', 0.5], ['Flat $200 each', -200]]),
  ],
  legal: (ctx) => activeChains(ctx.tables).length > 0 && (seatRow(ctx.tables, ctx.seat)?.cash ?? 0) > 0,
  treatment: (ctx) => ({
    patch: (tables) => {
      const state = gs(tables);
      const row = seatRow(tables, ctx.seat);
      let extra = ctx.levers.total - MAX_STOCKS_PER_TURN;
      // Buy into the chain this seat already has the most riding on, falling
      // back to the cheapest live chain — the same order the "hard" bot's own
      // share valuation lands on.
      const preference = activeChains(tables)
        .filter((c) => (state.stock_bank[c] ?? 0) > 0)
        .sort((a, b) => (held(tables, ctx.seat, b) - held(tables, ctx.seat, a)) || (priceOf(tables, a) - priceOf(tables, b)));
      for (const chain of preference) {
        while (extra > 0 && (state.stock_bank[chain] ?? 0) > 0) {
          const list = priceOf(tables, chain);
          const cost = ctx.levers.premium < 0
            ? list + -ctx.levers.premium
            : Math.round(list * (1 + ctx.levers.premium));
          if (row.cash < cost) break;
          row.cash -= cost;
          state.stock_bank[chain]--;
          row.stocks[chain] = (row.stocks[chain] ?? 0) + 1;
          extra--;
        }
        if (extra === 0) break;
      }
    },
  }),
};

const ipoDiscount: CardDef = {
  id: 'ipo-discount',
  name: 'IPO Discount',
  group: 'B', tier: 1,
  effect: 'All shares you buy this turn cost less.',
  source: 'bank',
  fidelity: 'approx',
  note:
    'The engine prices every purchase from getStockPrice with no discount hook, so the saving is paid ' +
    'as cash up front: the discount rate times the full per-turn allowance at the price of the chain ' +
    'this seat is most likely to buy. That overstates a turn where the player buys nothing and ' +
    'understates a turn where they buy three premium shares.',
  riskNote: 'Its value scales with share price, so it is worth nothing early and a lot late — the opposite curve to most of the pool.',
  levers: [
    lever('size', 'magnitude', 'How large is the discount?', [['One price tier down (~$100)', 'tier'], ['25%', 0.25], ['50%', 0.5]]),
    lever('scope', 'scope', 'Which chains?', [['All chains', 'all'], ['Cheapest tier only', 'budget']]),
  ],
  legal: (ctx) => activeChains(ctx.tables).length > 0,
  treatment: (ctx) => ({
    patch: (tables) => {
      let chains = activeChains(tables);
      if (ctx.levers.scope === 'budget') chains = chains.filter((c) => CHAINS[c].tier === 'budget');
      if (chains.length === 0) return;
      const row = seatRow(tables, ctx.seat);
      const target = chains.reduce((a, b) => (priceOf(tables, b) > priceOf(tables, a) ? b : a));
      const price = priceOf(tables, target);
      const affordable = Math.min(MAX_STOCKS_PER_TURN, Math.floor((row?.cash ?? 0) / price));
      const perShare = ctx.levers.size === 'tier' ? Math.min(100, price) : price * (ctx.levers.size as number);
      payFromBank(tables, ctx.seat, perShare * affordable);
    },
  }),
};

const shortSell: CardDef = {
  id: 'short-sell',
  name: 'Short Sell',
  group: 'B', tier: 3,
  effect: 'Name an active chain. If it is absorbed within N rounds, collect a multiple of its share price. If not, pay a penalty.',
  source: 'bank',
  fidelity: 'exact',
  riskNote: 'Flagged for possible cut. Self-fulfilling unless scope forbids naming a chain adjacent to your own tiles, and that restriction is hard to state cleanly.',
  levers: [
    lever('window', 'duration', 'How long is the window?', [['2 rounds', 2], ['4 rounds', 4]]),
    lever('multiple', 'magnitude', 'What is the payout?', [['5x share price', 5], ['10x share price', 10]]),
    lever('scope', 'scope', 'May you name a chain you can merge yourself?', [['No', false], ['Yes', true]]),
  ],
  legal: (ctx) => pickShortTarget(ctx.tables, ctx.seat, ctx.levers.scope) !== null,
  treatment: (ctx) => {
    const target = pickShortTarget(ctx.tables, ctx.seat, ctx.levers.scope);
    const startRound = gs(ctx.tables)?.round_number ?? 0;
    const strike = target ? priceOf(ctx.tables, target) : 0;
    let settled = false;
    return {
      patch: () => {},
      onTurnStart: (turn) => {
        if (settled || !target) return;
        const absorbed = !turn.state.chains?.[target]?.isActive;
        if (absorbed) {
          settled = true;
          const row = turn.players.find((p) => p.player_index === ctx.seat)!;
          row.cash += strike * ctx.levers.multiple;
        } else if (turn.round >= startRound + ctx.levers.window) {
          settled = true;
          const row = turn.players.find((p) => p.player_index === ctx.seat)!;
          row.cash = Math.max(0, row.cash - strike * 2);
        }
      },
    };
  },
};

/** The chain a short would rationally name: small, contested, and adjacent to something. */
function pickShortTarget(tables: Tables, seat: number, mayNameOwnTarget: boolean): ChainName | null {
  const candidates = activeChains(tables).filter((c) => !isSafe(tables, c));
  if (candidates.length === 0) return null;
  const reachable = new Set(
    handPlacements(tables, seat)
      .filter((p) => p.kind === 'merge')
      .flatMap((p) => p.adjacentChains),
  );
  const pool = mayNameOwnTarget ? candidates : candidates.filter((c) => !reachable.has(c));
  if (pool.length === 0) return null;
  // Smallest chain: most likely to be the one absorbed.
  return pool.reduce((a, b) => (sizeOf(tables, b) < sizeOf(tables, a) ? b : a));
}

const dividendCall: CardDef = {
  id: 'dividend-call',
  name: 'Dividend Call',
  group: 'B', tier: 2,
  effect: 'Each opponent pays you an amount based on your holdings in one chain.',
  source: 'player',
  fidelity: 'exact',
  riskNote: 'Moves money rather than creating it, so it is not inflationary — but it can bankrupt one player in a single hit. A floor rule is worth considering.',
  levers: [
    lever('rate', 'magnitude', 'How much per share held?', [['$50', 50], ['$100', 100]]),
    lever('cap', 'cost-shape', 'What is the cap?', [['$500 per payer', 500], ['$1,000 per payer', 1000]]),
    lever('scope', 'scope', 'Who pays?', [['Every opponent', 'all'], ['Only holders of that chain', 'holders']]),
  ],
  legal: (ctx) => bestOwnChain(ctx.tables, ctx.seat) !== null && opponents(ctx.tables, ctx.seat).length > 0,
  treatment: (ctx) => ({
    patch: (tables) => {
      const chain = bestOwnChain(tables, ctx.seat);
      if (!chain) return;
      const due = Math.min(ctx.levers.cap, held(tables, ctx.seat, chain) * ctx.levers.rate);
      const payers = opponents(tables, ctx.seat)
        .filter((p) => ctx.levers.scope === 'all' || (p.stocks?.[chain] ?? 0) > 0);
      for (const payer of payers) {
        // Floor: no player is reduced below the price of one share.
        transfer(tables, payer, ctx.seat, due, priceOf(tables, chain));
      }
    },
  }),
};

const buyback: CardDef = {
  id: 'buyback',
  name: 'Buyback',
  group: 'B', tier: 2,
  effect: 'Sell shares of one chain back to the bank above list price.',
  source: 'bank',
  fidelity: 'exact',
  riskNote: 'A liquidity valve. Its real function is letting a player escape a losing position — decide first whether escape hatches are wanted at all.',
  levers: [
    lever('premium', 'magnitude', 'What premium over list?', [['110%', 1.1], ['125%', 1.25], ['150%', 1.5]]),
    lever('shares', 'scope', 'How many shares?', [['Up to 3', 3], ['Up to 5', 5]]),
  ],
  legal: (ctx) => worstOwnChain(ctx.tables, ctx.seat) !== null,
  treatment: (ctx) => ({
    patch: (tables) => {
      const chain = worstOwnChain(tables, ctx.seat);
      if (!chain) return;
      const row = seatRow(tables, ctx.seat);
      const qty = Math.min(ctx.levers.shares, row.stocks[chain] ?? 0);
      if (qty <= 0) return;
      row.stocks[chain] -= qty;
      gs(tables).stock_bank[chain] += qty;
      row.cash += Math.floor(priceOf(tables, chain) * ctx.levers.premium) * qty;
    },
  }),
};

/** The position a player would want out of: shares in a chain someone else has locked up. */
function worstOwnChain(tables: Tables, seat: number): ChainName | null {
  const candidates = activeChains(tables).filter((c) => held(tables, seat, c) > 0);
  if (candidates.length === 0) return null;
  const contested = (c: ChainName) => {
    const best = Math.max(0, ...opponents(tables, seat).map((p) => p.stocks?.[c] ?? 0));
    return best - held(tables, seat, c);
  };
  return candidates.reduce((a, b) => (contested(b) > contested(a) ? b : a));
}

const tenderOffer: CardDef = {
  id: 'tender-offer',
  name: 'Tender Offer',
  group: 'B', tier: 2,
  effect: 'Offer an opponent a fixed price for 2 of their shares. They accept, or pay you a refusal fee.',
  source: 'player',
  fidelity: 'approx',
  note:
    'The target\'s decision is modelled by a rule, not by an agent: it accepts when the offer beats what ' +
    'the shares are worth to it (list price, marked up when the position is a live majority), otherwise ' +
    'it pays the fee. A real opponent would sometimes refuse out of spite or accept out of cash need, ' +
    'so the measured value is the rational-opponent case.',
  riskNote: 'The refusal fee is what stops it being a free "no thanks". Set too high, it is a forced sale with extra steps.',
  levers: [
    lever('price', 'magnitude', 'What is the offer, per share?', [['List price', 1.0], ['125% of list', 1.25]]),
    lever('fee', 'magnitude', 'What is the refusal fee?', [['$300', 300], ['$800', 800]]),
    lever('safe', 'scope', 'Are safe chains exempt?', [['Exempt', true], ['Fair game', false]]),
  ],
  legal: (ctx) => tenderTarget(ctx.tables, ctx.seat, ctx.levers.safe, ctx.config) !== null,
  treatment: (ctx) => ({
    patch: (tables) => {
      const pickResult = tenderTarget(tables, ctx.seat, ctx.levers.safe, ctx.config);
      if (!pickResult) return;
      const { player, chain } = pickResult;
      const list = priceOf(tables, chain);
      const offer = Math.floor(list * ctx.levers.price);
      const qty = Math.min(2, player.stocks[chain] ?? 0);
      // What the shares are worth to the holder: list, marked up while the
      // position is still a majority worth defending.
      const rivalsBest = Math.max(0, ...(tables.game_players ?? [])
        .filter((p) => p.player_index !== player.player_index)
        .map((p) => p.stocks?.[chain] ?? 0));
      const defending = (player.stocks[chain] ?? 0) > rivalsBest;
      const reserve = defending ? list * 1.6 : list;

      if (offer >= reserve) {
        player.stocks[chain] -= qty;
        const row = seatRow(tables, ctx.seat);
        row.stocks[chain] = (row.stocks[chain] ?? 0) + qty;
        transfer(tables, row, player.player_index, offer * qty, 0);
      } else {
        transfer(tables, player, ctx.seat, ctx.levers.fee, list);
      }
    },
  }),
};

function tenderTarget(tables: Tables, seat: number, safeExempt: boolean, config: PoolConfig) {
  const rival = leadingOpponent(tables, seat);
  if (!rival) return null;
  const exempt = safeExempt || !config.allowSafeChainTargeting;
  const candidates = activeChains(tables)
    .filter((c) => (rival.stocks?.[c] ?? 0) >= 2 && (!exempt || !isSafe(tables, c)));
  if (candidates.length === 0) return null;
  const chain = candidates.reduce((a, b) => (priceOf(tables, b) > priceOf(tables, a) ? b : a));
  return { player: rival, chain };
}

// =============================================================================
// Group C — merger manipulation
// =============================================================================

/**
 * Both Proxy Fight and Golden Parachute act at the moment bonuses are paid, and
 * neither can be a state patch: the engine decides the split itself, later. The
 * hook recomputes the split the card implies, compares it to the split the
 * engine is about to make, and settles the difference in cash — including on the
 * seats the card displaces, so the externality column is real rather than
 * one-sided.
 */
function mergerBonusHook(seat: number, adjust: (payouts: Map<number, number>, ctx: any) => Map<number, number>, oneShot = true): DecisionHook {
  let used = false;
  return (turn) => {
    if (used || turn.phase !== 'merger_pay_bonuses') return;
    const state = turn.state;
    const defunct = state.merger?.currentDefunctChain as ChainName;
    if (!defunct) return;
    const bonusTier = getBonusTier(normalizeRules(state.rules_snapshot));
    const bonuses = getBonuses(defunct, state.chains[defunct].tiles.length, bonusTier);
    const players = turn.players.map((p) => ({
      id: `player-${p.player_index}`, stocks: { ...(p.stocks ?? {}) },
    }));
    const actual = bonusPayouts(players, defunct, bonuses, bonusTier);
    const wanted = adjust(actual, { players, defunct, bonuses, bonusTier, seat });
    if (!wanted) return;
    used = oneShot;
    for (const p of turn.players) {
      const delta = (wanted.get(p.player_index) ?? 0) - (actual.get(p.player_index) ?? 0);
      if (delta !== 0) p.cash = Math.max(0, p.cash + delta);
    }
  };
}

const proxyFight: CardDef = {
  id: 'proxy-fight',
  name: 'Proxy Fight',
  group: 'C', tier: 2,
  effect: 'In your next merger, count as holding extra shares of the defunct chain for bonus determination only.',
  source: 'bank',
  fidelity: 'exact',
  riskNote: 'Well contained: it never alters ownership, so it never cascades into later mergers. A strong mid-band candidate.',
  levers: [
    lever('extra', 'magnitude', 'How many phantom shares?', [['+1', 1], ['+2', 2], ['+3', 3]]),
    lever('scope', 'scope', 'Which bonus does it affect?', [['Majority only', 'majority'], ['Majority and minority', 'both']]),
  ],
  legal: (ctx) => activeChains(ctx.tables).length >= 2,
  treatment: (ctx) => ({
    patch: () => {},
    onDecision: mergerBonusHook(ctx.seat, (actual, info) => {
      const boostedPlayers = info.players.map((p: any) =>
        p.id === `player-${ctx.seat}`
          ? { ...p, stocks: { ...p.stocks, [info.defunct]: (p.stocks[info.defunct] ?? 0) + ctx.levers.extra } }
          : p);
      const wanted = bonusPayouts(boostedPlayers, info.defunct, info.bonuses, info.bonusTier);
      if (ctx.levers.scope === 'majority') {
        // Minority payouts revert to what they would have been.
        for (const [s, amount] of actual) {
          if (amount === Math.floor(info.bonuses.minority / Math.max(1, countAt(actual, amount)))) wanted.set(s, amount);
        }
      }
      return wanted;
    }),
  }),
};

function countAt(map: Map<number, number>, value: number): number {
  let n = 0;
  for (const v of map.values()) if (v === value) n++;
  return n;
}

const goldenParachute: CardDef = {
  id: 'golden-parachute',
  name: 'Golden Parachute',
  group: 'C', tier: 2,
  effect: 'Multiply your bonus in the next merger.',
  source: 'bank',
  fidelity: 'exact',
  riskNote: 'Overlaps with Proxy Fight; they should not both exist at the same price. Proxy Fight changes who wins, this changes how much — the first is more interesting.',
  levers: [
    lever('multiplier', 'magnitude', 'By how much?', [['+50%', 1.5], ['Double', 2]]),
    lever('scope', 'scope', 'Which bonus?', [['Minority only', 'minority'], ['Both bonuses', 'both']]),
  ],
  legal: (ctx) => activeChains(ctx.tables).length >= 2,
  treatment: (ctx) => ({
    patch: () => {},
    onDecision: mergerBonusHook(ctx.seat, (actual, info) => {
      const mine = actual.get(ctx.seat) ?? 0;
      if (mine <= 0) return null as any;
      const isMinority = mine <= Math.floor(info.bonuses.minority);
      if (ctx.levers.scope === 'minority' && !isMinority) return null as any;
      const wanted = new Map(actual);
      wanted.set(ctx.seat, Math.floor(mine * ctx.levers.multiplier));
      return wanted;
    }),
  }),
};

const hostileTakeover: CardDef = {
  id: 'hostile-takeover',
  name: 'Hostile Takeover',
  group: 'C', tier: 3,
  effect: 'In a merger you trigger, choose which chain survives even if it is not the larger one.',
  source: 'neutral',
  fidelity: 'exact',
  note:
    'Implemented the way a shipped version would be: the merger record is rewritten before bonuses are ' +
    'paid, so the engine\'s own completeMerger transfers the tiles the other way. No arithmetic is ' +
    'reimplemented. Note that the "equal only" setting is a no-op by construction — the engine already ' +
    'routes an equal-size merger to merger_choose_survivor and lets the placing player pick, so at that ' +
    'setting the card sells something the base game gives away.',
  riskNote: 'At "any size gap" this is the most powerful card in the pool — it lets a player dismantle the board leader at will. A gap of 2 keeps it a tactical tool.',
  levers: [
    // Ordered with the doc's own leaning first: the default cell of every card
    // is the option set the design document argues for.
    lever('gap', 'scope', 'What size gap is permitted?', [['Up to 2 tiles', 2], ['Equal only', 0], ['Any gap', 99]]),
    lever('safe', 'scope', 'May the choice destroy a safe chain?', [['No', false], ['Yes', true]]),
  ],
  legal: (ctx) => activeChains(ctx.tables).length >= 2,
  treatment: (ctx) => {
    let used = false;
    return {
      patch: () => {},
      onDecision: (turn) => {
        if (used || turn.phase !== 'merger_pay_bonuses') return;
        const state = turn.state;
        const merger = state.merger;
        if (!merger || merger.currentPlayerIndex !== ctx.seat) return;
        if (merger.bonusesPaid) return;
        const involved: ChainName[] = [merger.survivingChain, ...merger.defunctChains];
        const size = (c: ChainName) => state.chains[c]?.tiles?.length ?? 0;
        const survivor = merger.survivingChain as ChainName;
        // Prefer to save the chain this seat is most invested in.
        const stake = (c: ChainName) => (turn.players.find((p) => p.player_index === ctx.seat)?.stocks?.[c] ?? 0);
        const allowSafe = ctx.levers.safe && ctx.config?.allowSafeChainTargeting !== false;
        const candidates = involved.filter((c) =>
          c !== survivor &&
          size(survivor) - size(c) <= ctx.levers.gap &&
          (allowSafe || !state.chains[survivor]?.isSafe));
        if (candidates.length === 0) return;
        const choice = candidates.reduce((a, b) => (stake(b) > stake(a) ? b : a));
        if (stake(choice) <= stake(survivor)) return;
        used = true;
        state.merger = {
          ...merger,
          survivingChain: choice,
          defunctChains: involved.filter((c) => c !== choice)
            .sort((a, b) => size(b) - size(a)),
          currentDefunctChain: involved.filter((c) => c !== choice)
            .sort((a, b) => size(b) - size(a))[0],
        };
      },
    };
  },
};

const antitrustFiling: CardDef = {
  id: 'antitrust-filing',
  name: 'Antitrust Filing',
  group: 'C', tier: 2,
  effect: 'One chain is frozen for a round. It cannot be merged, expanded, or traded.',
  source: 'neutral',
  fidelity: 'approx',
  note:
    'Only the trading freeze is modelled exactly (the chain\'s shares are pulled out of the bank and ' +
    'returned when the window closes). Freezing expansion and merger would need engine-level placement ' +
    'validation, so the measured value is the defensive half of the card only — a lower bound.',
  riskNote: 'Second cut candidate alongside Zoning Veto: blocking expansion can make an opponent\'s tiles unplayable, which is turn denial in disguise.',
  levers: [
    lever('duration', 'duration', 'How long is the freeze?', [['One round', 1], ['One full turn cycle', 2]]),
    lever('scope', 'scope', 'What is frozen?', [['Trading only', 'trade'], ['Everything', 'all']]),
  ],
  legal: (ctx) => bestRivalChain(ctx.tables, ctx.seat) !== null,
  treatment: (ctx) => {
    const target = bestRivalChain(ctx.tables, ctx.seat);
    const startRound = gs(ctx.tables)?.round_number ?? 0;
    let frozen = 0;
    let restored = false;
    return {
      patch: (tables) => {
        if (!target) return;
        frozen = gs(tables).stock_bank[target] ?? 0;
        gs(tables).stock_bank[target] = 0;
      },
      onTurnStart: (turn) => {
        if (restored || !target) return;
        if (turn.round < startRound + ctx.levers.duration) return;
        restored = true;
        turn.state.stock_bank[target] = (turn.state.stock_bank[target] ?? 0) + frozen;
      },
    };
  },
};

const spinOff: CardDef = {
  id: 'spin-off',
  name: 'Spin Off',
  group: 'C', tier: 3,
  effect: 'Split a large chain into two, if board geometry allows. You take a founder share of the new chain.',
  source: 'neutral',
  fidelity: 'approx',
  note:
    'Chain splitting has no engine concept, so this is the closest thing to new subsystem work in the ' +
    'pool. The geometry check is real: a connected sub-region of the target is carved off and both ' +
    'halves are verified connected before the split is applied. What is not modelled is what happens ' +
    'to existing holders of the original chain — the compensation lever below is priced as "nothing", ' +
    'which is the buyer-favourable end of the range.',
  riskNote: 'The most rules-heavy card in the pool. Cheap to implement digitally, expensive to explain in rules text.',
  levers: [
    lever('minSize', 'magnitude', 'Minimum chain size to split', [['12+', 12], ['15+', 15]]),
    lever('founder', 'magnitude', 'Founder shares granted', [['1', 1], ['2', 2]]),
    lever('voidSafety', 'scope', 'Does the split void safety for both halves?', [['No', false], ['Yes', true]]),
  ],
  legal: (ctx) => splitTarget(ctx.tables, ctx.levers.minSize) !== null,
  treatment: (ctx) => ({
    patch: (tables) => {
      const target = splitTarget(tables, ctx.levers.minSize);
      if (!target) return;
      const state = gs(tables);
      const r = rules(tables);
      const safeSize = getSafeChainSize(r);
      const free = getEligibleChains(r).filter((c) => !state.chains[c]?.isActive);
      if (free.length === 0) return;
      const newChain = free[0];
      const { boardRows, boardColsCount } = dims(tables);
      const piece = carveConnectedPiece(state.chains[target].tiles, boardRows, boardColsCount);
      if (!piece) return;

      const remaining = state.chains[target].tiles.filter((t: string) => !piece.includes(t));
      for (const tile of piece) state.board[tile] = { ...state.board[tile], chain: newChain };
      state.chains[target] = {
        ...state.chains[target], tiles: remaining,
        isSafe: !ctx.levers.voidSafety && safeSize !== null && remaining.length >= safeSize,
      };
      state.chains[newChain] = {
        ...state.chains[newChain], tiles: piece, isActive: true,
        isSafe: !ctx.levers.voidSafety && safeSize !== null && piece.length >= safeSize,
      };
      const row = seatRow(tables, ctx.seat);
      const grant = Math.min(ctx.levers.founder, state.stock_bank[newChain] ?? 0);
      state.stock_bank[newChain] -= grant;
      row.stocks[newChain] = (row.stocks[newChain] ?? 0) + grant;
    },
  }),
};

function splitTarget(tables: Tables, minSize: number): ChainName | null {
  const candidates = activeChains(tables).filter((c) => sizeOf(tables, c) >= minSize);
  if (candidates.length === 0) return null;
  const state = gs(tables);
  const free = getEligibleChains(rules(tables)).filter((c) => !state.chains[c]?.isActive);
  if (free.length === 0) return null;
  return candidates.reduce((a, b) => (sizeOf(tables, b) > sizeOf(tables, a) ? b : a));
}

/**
 * Carve a connected piece of roughly half a chain such that the remainder is
 * also connected. Grows a region from the tile farthest from the centroid,
 * which for the blob shapes chains actually form finds a clean cut most of the
 * time; returns null when it cannot, which is the geometry check the card needs.
 */
export function carveConnectedPiece(tiles: string[], rows: number, cols: number): string[] | null {
  if (tiles.length < 4) return null;
  const set = new Set(tiles);
  const target = Math.floor(tiles.length / 2);

  for (const seed of tiles) {
    const piece: string[] = [seed];
    const inPiece = new Set(piece);
    const frontier = getAdjacentTiles(seed, rows, cols).filter((t) => set.has(t));
    while (piece.length < target && frontier.length > 0) {
      const next = frontier.shift()!;
      if (inPiece.has(next)) continue;
      piece.push(next);
      inPiece.add(next);
      for (const adj of getAdjacentTiles(next, rows, cols)) {
        if (set.has(adj) && !inPiece.has(adj)) frontier.push(adj);
      }
    }
    if (piece.length < 2) continue;
    if (piece.length >= tiles.length) continue;
    if (stillConnected(tiles, piece, rows, cols)) return piece;
  }
  return null;
}

// =============================================================================
// Group D — board and structure
// =============================================================================

const demolitionPermit: CardDef = {
  id: 'demolition-permit',
  name: 'Demolition Permit',
  group: 'D', tier: 2,
  effect: 'Remove one tile from the board.',
  source: 'neutral',
  fidelity: 'exact',
  riskNote: 'The safety clause is not a detail, it is the card. Allowing a drop below the safety threshold turns this into a purchasable merger enabler worth several thousand in bonuses.',
  levers: [
    lever('tiles', 'magnitude', 'How many tiles?', [['1', 1], ['2', 2]]),
    lever('breakSafety', 'scope', 'May it reduce a chain below the safety threshold?', [['No', false], ['Yes', true]]),
    lever('returns', 'cost-shape', 'What happens to the tile?', [['Returns to the bag', true], ['Leaves the game', false]]),
  ],
  legal: (ctx) => demolitionPick(ctx.tables, ctx.seat, ctx.levers, ctx.config).length > 0,
  treatment: (ctx) => ({
    patch: (tables) => {
      const picks = demolitionPick(tables, ctx.seat, ctx.levers, ctx.config);
      const state = gs(tables);
      const r = rules(tables);
      const safeSize = getSafeChainSize(r);
      for (const { chain, tile } of picks) {
        state.chains[chain] = {
          ...state.chains[chain],
          tiles: state.chains[chain].tiles.filter((t: string) => t !== tile),
        };
        state.chains[chain].isSafe = safeSize !== null && state.chains[chain].tiles.length >= safeSize;
        state.board[tile] = { id: tile, placed: false, chain: null };
        if (ctx.levers.returns) state.tile_bag.unshift(tile);
      }
    },
  }),
};

/**
 * Which tile to knock out. Preference order is the card's own logic: drop a
 * rival's chain out of safety if the lever allows it (the several-thousand-dollar
 * case), otherwise shrink the largest chain we do not control.
 */
function demolitionPick(tables: Tables, seat: number, levers: Levers, config: PoolConfig) {
  const state = gs(tables);
  const { boardRows, boardColsCount } = dims(tables);
  const safeSize = getSafeChainSize(rules(tables));
  const out: { chain: ChainName; tile: string }[] = [];
  const removed: string[] = [];

  // Never demolish a chain this seat is invested in — the card is pointed at
  // the board leader's position, not at one's own.
  const rivalEdge = (c: ChainName) =>
    Math.max(0, ...opponents(tables, seat).map((p) => p.stocks?.[c] ?? 0)) - held(tables, seat, c);

  const ranked = [...activeChains(tables)]
    .filter((c) => rivalEdge(c) >= 0)
    .sort((a, b) => {
      const breakA = safeSize !== null && isSafe(tables, a) && sizeOf(tables, a) - levers.tiles < safeSize ? 1 : 0;
      const breakB = safeSize !== null && isSafe(tables, b) && sizeOf(tables, b) - levers.tiles < safeSize ? 1 : 0;
      if (breakA !== breakB) return breakB - breakA;
      if (rivalEdge(a) !== rivalEdge(b)) return rivalEdge(b) - rivalEdge(a);
      return sizeOf(tables, b) - sizeOf(tables, a);
    });

  for (const chain of ranked) {
    if (out.length >= levers.tiles) break;
    if (isSafe(tables, chain) && !(levers.breakSafety && config.allowSafeChainTargeting)) continue;
    const tiles: string[] = state.chains[chain].tiles;
    if (tiles.length <= 2) continue;
    for (const tile of tiles) {
      if (out.length >= levers.tiles) break;
      if (!stillConnected(tiles, [...removed, tile], boardRows, boardColsCount)) continue;
      out.push({ chain, tile });
      removed.push(tile);
    }
  }
  return out;
}

const franchiseExpansion: CardDef = {
  id: 'franchise-expansion',
  name: 'Franchise Expansion',
  group: 'D', tier: 3,
  effect: 'Place a second tile this turn.',
  source: 'neutral',
  fidelity: 'exact',
  note:
    'The extra placement replays the engine\'s own place_tile arithmetic, including full merger ' +
    'resolution (bonuses paid by the same split, tiles transferred, defunct chains cleared) for the ' +
    'variant that permits it.',
  riskNote: 'With both scope restrictions removed this is a purchasable merger trigger and the strongest card in the pool by a wide margin.',
  levers: [
    lever('found', 'scope', 'May the extra tile found a chain?', [['No', false], ['Yes', true]]),
    lever('merge', 'scope', 'May the extra tile trigger a merger?', [['No', false], ['Yes', true]]),
    lever('extra', 'magnitude', 'How many extra tiles?', [['1', 1], ['2', 2]]),
  ],
  legal: (ctx) => franchisePicks(ctx.tables, ctx.seat, ctx.levers).length > 0,
  treatment: (ctx) => ({
    patch: (tables) => {
      for (let i = 0; i < ctx.levers.extra; i++) {
        const picks = franchisePicks(tables, ctx.seat, ctx.levers);
        if (picks.length === 0) return;
        applyExtraPlacement(tables, ctx.seat, picks[0], ctx.levers.found, ctx.levers.merge);
      }
    },
  }),
};

function franchisePicks(tables: Tables, seat: number, levers: Levers): string[] {
  const allowed = handPlacements(tables, seat).filter((p) => {
    if (!p.legal) return false;
    if (p.kind === 'found' && !levers.found) return false;
    if (p.kind === 'merge' && !levers.merge) return false;
    return true;
  });
  // A merger the player can trigger outranks everything — which is exactly why
  // the unrestricted version is the doc's flagged worst case. Below that, the
  // choice is by what the tile is worth to *this* seat, so growing a chain a
  // rival owns is not treated as a gain.
  return allowed
    .sort((a, b) =>
      ((b.kind === 'merge' ? 1 : 0) - (a.kind === 'merge' ? 1 : 0)) ||
      (tileAppeal(tables, seat, b.tileId) - tileAppeal(tables, seat, a.tileId)))
    .map((p) => p.tileId);
}

const charterRenewal: CardDef = {
  id: 'charter-renewal',
  name: 'Charter Renewal',
  group: 'D', tier: 2,
  effect: 'Refound a chain that has been absorbed, elsewhere on the board. Take extra founder shares.',
  source: 'neutral',
  fidelity: 'approx',
  note:
    'The card is played on a founding the buyer was already able to make: a tile from hand that would ' +
    'open a new chain instead refounds a defunct one, with extra founder shares. Two adjacent ' +
    'unincorporated tiles almost never sit on the board — placing next to one immediately triggers a ' +
    'founding — so a version that needs a bare site would be dead text by construction.',
  riskNote: 'Mild, and it adds a late-game pressure valve when the board is running out of chain slots.',
  levers: [
    lever('founder', 'magnitude', 'Founder shares granted', [['1 extra (2 total)', 1], ['2 extra (3 total)', 2]]),
    lever('scope', 'scope', 'Which chain may be refounded?', [['Any defunct chain', 'any'], ['Only one absorbed by someone else', 'other']]),
  ],
  legal: (ctx) => refoundOpportunity(ctx.tables, ctx.seat) !== null,
  treatment: (ctx) => ({
    patch: (tables) => {
      const site = refoundOpportunity(tables, ctx.seat);
      if (!site) return;
      // The engine's own founding path, then the card's extra shares on top.
      if (!applyExtraPlacement(tables, ctx.seat, site.tileId, true, false)) return;
      const state = gs(tables);
      const row = seatRow(tables, ctx.seat);
      const founded = ALL_CHAINS.find((c) => state.chains[c]?.tiles?.includes(site.tileId));
      if (!founded) return;
      const grant = Math.min(ctx.levers.founder, state.stock_bank[founded] ?? 0);
      state.stock_bank[founded] -= grant;
      row.stocks[founded] = (row.stocks[founded] ?? 0) + grant;
    },
  }),
};

/** A tile in hand that would found a chain, plus a free chain slot to give it. */
function refoundOpportunity(tables: Tables, seat: number): { tileId: string } | null {
  const state = gs(tables);
  const free = getEligibleChains(rules(tables)).filter((c) => !state.chains[c]?.isActive);
  if (free.length === 0) return null;
  const site = handPlacements(tables, seat).find((p) => p.legal && p.kind === 'found');
  return site ? { tileId: site.tileId } : null;
}

const skyscraper: CardDef = {
  id: 'skyscraper',
  name: 'Skyscraper',
  group: 'D', tier: 3,
  effect: 'One chain permanently counts as larger for share price purposes only.',
  source: 'bank',
  fidelity: 'approx',
  note:
    'The engine prices from real chain size with no override, so the upgrade is settled as cash: every ' +
    'holder is paid the mark-to-market difference on their shares at the moment it is played. What is ' +
    'not captured is the compounding — a permanently higher price also raises what the chain is worth ' +
    'at the final scoring — so this understates the card, and understates the shared benefit with it.',
  riskNote: 'It benefits every holder of that chain, not just the buyer. That is either a flaw or a feature depending on whether shared-benefit cards are wanted.',
  levers: [
    lever('boost', 'magnitude', 'How much larger?', [['+2 tiles', 2], ['+3 tiles', 3]]),
    lever('scope', 'scope', 'What does the boost affect?', [['Pricing only', 'price'], ['Pricing and merger size', 'size']]),
  ],
  legal: (ctx) => bestOwnChain(ctx.tables, ctx.seat) !== null,
  treatment: (ctx) => ({
    patch: (tables) => {
      const chain = bestOwnChain(tables, ctx.seat);
      if (!chain) return;
      const size = sizeOf(tables, chain);
      const delta = getStockPrice(chain, size + ctx.levers.boost) - getStockPrice(chain, size);
      if (delta <= 0) return;
      // Every holder is paid, not just the buyer. That is the card.
      for (const p of tables.game_players ?? []) {
        const shares = p.stocks?.[chain] ?? 0;
        if (shares > 0) p.cash += delta * shares;
      }
      if (ctx.levers.scope === 'size') {
        // The stealth-Hostile-Takeover variant: the chain also wins size
        // comparisons, modelled by padding it with tiles from the bag.
        const state = gs(tables);
        const pad = state.tile_bag.splice(0, ctx.levers.boost);
        state.chains[chain].tiles = [...state.chains[chain].tiles, ...pad];
        for (const tile of pad) state.board[tile] = { id: tile, placed: true, chain };
      }
    },
  }),
};

const groundLease: CardDef = {
  id: 'ground-lease',
  name: 'Ground Lease',
  group: 'D', tier: 3,
  effect: 'Whenever any player expands a chosen chain, you collect a fee.',
  source: 'bank',
  fidelity: 'exact',
  riskNote: 'Flagged for cut. Open-ended and it grows with game length, which is exactly the property that resists a fixed price.',
  levers: [
    lever('fee', 'magnitude', 'Fee per tile', [['$100', 100], ['$200', 200]]),
    lever('duration', 'duration', 'How long does it run?', [['4 rounds', 4], ['Until the chain is absorbed', 99]]),
    lever('cap', 'cost-shape', 'Is there a total cap?', [['$2,000', 2000], ['Uncapped', Infinity]]),
  ],
  legal: (ctx) => activeChains(ctx.tables).length > 0,
  treatment: (ctx) => {
    const target = biggestGrowingChain(ctx.tables);
    const startRound = gs(ctx.tables)?.round_number ?? 0;
    let lastSize = target ? sizeOf(ctx.tables, target) : 0;
    let collected = 0;
    return {
      patch: () => {},
      onTurnStart: (turn) => {
        if (!target || collected >= ctx.levers.cap) return;
        if (turn.round >= startRound + ctx.levers.duration) return;
        const chain = turn.state.chains?.[target];
        if (!chain?.isActive) return;
        const grown = chain.tiles.length - lastSize;
        lastSize = chain.tiles.length;
        if (grown <= 0) return;
        const due = Math.min(grown * ctx.levers.fee, ctx.levers.cap - collected);
        collected += due;
        const row = turn.players.find((p) => p.player_index === ctx.seat);
        if (row) row.cash += due;
      },
    };
  },
};

function biggestGrowingChain(tables: Tables): ChainName | null {
  const candidates = activeChains(tables).filter((c) => !isSafe(tables, c));
  const pool = candidates.length > 0 ? candidates : activeChains(tables);
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (sizeOf(tables, b) > sizeOf(tables, a) ? b : a));
}

const fiveStarUpgrade: CardDef = {
  id: 'five-star-upgrade',
  name: 'Five Star Upgrade',
  group: 'D', tier: 3,
  effect: 'Permanently upgrade a chain. Every holder collects a recurring dividend at the start of each of their turns.',
  source: 'bank',
  fidelity: 'approx',
  note:
    'The dividend is exact — paid per turn, to every holder, by a hook. The price-tier bump is settled ' +
    'as a one-off mark-to-market like Skyscraper, because the engine prices from real chain size. ' +
    'The card also changes game *pacing*, so its round-count distribution is compared against baseline ' +
    'separately rather than folded into the value number.',
  riskNote:
    'The pool\'s only recurring income. Base Acquire has exactly two money faucets — merger bonuses and ' +
    'share sales — both event-driven and self-limiting. A permanent faucet makes holding better than ' +
    'trading, lengthens the game, and rewards whoever is already ahead.',
  levers: [
    lever('rate', 'magnitude', 'Dividend, as a share of current price', [['5%', 0.05], ['10%', 0.1], ['20%', 0.2]]),
    lever('minSize', 'scope', 'Minimum chain size', [['6+', 6], ['11+', 11]]),
    lever('tierBump', 'scope', 'Is the price-tier bump included?', [['No', false], ['Yes', true]]),
    lever('exclusive', 'compensation', 'Does the buyer get an exclusive first round?', [['No', false], ['Yes', true]]),
  ],
  legal: (ctx) => upgradeTarget(ctx.tables, ctx.seat, ctx.levers.minSize) !== null,
  treatment: (ctx) => {
    const target = upgradeTarget(ctx.tables, ctx.seat, ctx.levers.minSize);
    const startRound = gs(ctx.tables)?.round_number ?? 0;
    return {
      patch: (tables) => {
        if (!target || !ctx.levers.tierBump) return;
        const size = sizeOf(tables, target);
        const delta = getStockPrice(target, size + 3) - getStockPrice(target, size);
        for (const p of tables.game_players ?? []) {
          const shares = p.stocks?.[target] ?? 0;
          if (shares > 0) p.cash += delta * shares;
        }
      },
      onTurnStart: (turn) => {
        if (!target) return;
        const chain = turn.state.chains?.[target];
        if (!chain?.isActive) return;
        const exclusiveWindow = ctx.levers.exclusive && turn.round === startRound;
        const price = getStockPrice(target, chain.tiles.length);
        const row = turn.players.find((p) => p.player_index === turn.seat);
        if (!row) return;
        if (exclusiveWindow && turn.seat !== ctx.seat) return;
        const shares = row.stocks?.[target] ?? 0;
        if (shares > 0) row.cash += Math.floor(price * ctx.levers.rate) * shares;
      },
    };
  },
};

function upgradeTarget(tables: Tables, seat: number, minSize: number): ChainName | null {
  const candidates = activeChains(tables).filter((c) => sizeOf(tables, c) >= minSize && held(tables, seat, c) > 0);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (held(tables, seat, b) > held(tables, seat, a) ? b : a));
}

const boardSeat: CardDef = {
  id: 'board-seat',
  name: 'Board Seat',
  group: 'D', tier: 3,
  effect: 'Look at the top 3 event cards and buy one immediately at half price.',
  source: 'bank',
  fidelity: 'derived',
  note:
    'Circular by construction: its value is a function of the value of every other card, so it is ' +
    'computed arithmetically from the finished pool (the expected maximum of N draws, less half the ' +
    'price paid) rather than simulated. See sim/economy.ts.',
  riskNote: 'It also sets the effective search cost of the deck, so it changes how often high-tier cards appear. Price it last, or cut it.',
  levers: [
    lever('seen', 'magnitude', 'How many cards are seen?', [['3', 3], ['5', 5]]),
    lever('discount', 'magnitude', 'How large is the discount?', [['Half price', 0.5], ['Free', 0]]),
  ],
  legal: () => true,
  treatment: () => noTreatment,
};

// =============================================================================

export const CARDS: CardDef[] = [
  marketScan, insiderTip, landBank, surveyor, zoningVeto,
  bridgeLoan, ipoDiscount, shortSell, dividendCall, buyback, tenderOffer,
  proxyFight, goldenParachute, hostileTakeover, antitrustFiling, spinOff,
  demolitionPermit, franchiseExpansion, charterRenewal, skyscraper, groundLease,
  fiveStarUpgrade, boardSeat,
];

export function cardById(id: string): CardDef {
  const card = CARDS.find((c) => c.id === id);
  if (!card) throw new Error(`unknown card: ${id}`);
  return card;
}

/** Default lever choices: the first option of every lever, which is the doc's own leaning. */
export function defaultLevers(card: CardDef): Levers {
  const out: Levers = {};
  for (const l of card.levers) out[l.id] = l.options[0].value;
  return out;
}

/**
 * The lever grid, capped. A card with three three-way levers is 27 cells, each
 * needing hundreds of paired rollouts across a stratified corpus; the cap keeps
 * the full pass affordable and is reported alongside the results so nobody
 * mistakes a truncated grid for an exhaustive one.
 */
export function leverGrid(card: CardDef, cap = 12): Levers[] {
  let grid: Levers[] = [{}];
  for (const l of card.levers) {
    const next: Levers[] = [];
    for (const combo of grid) {
      for (const option of l.options) next.push({ ...combo, [l.id]: option.value });
    }
    grid = next;
  }
  if (grid.length <= cap) return grid;
  // Keep the default corner plus an even spread, so both ends of every lever
  // still appear rather than only the first options.
  const step = grid.length / cap;
  const picked: Levers[] = [];
  for (let i = 0; i < cap; i++) picked.push(grid[Math.floor(i * step)]);
  return picked;
}

export function leverLabel(card: CardDef, levers: Levers): string {
  return card.levers
    .map((l) => l.options.find((o) => o.value === levers[l.id])?.label ?? String(levers[l.id]))
    .join(' / ');
}

/** Cards the simulator can actually price. The rest are reported with their reason. */
export const MEASURABLE = CARDS.filter((c) => c.fidelity === 'exact' || c.fidelity === 'approx');
