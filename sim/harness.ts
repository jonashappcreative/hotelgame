// =============================================================================
// harness — drives a whole game through the real engine, headless
// =============================================================================
// Mirrors driveBotsLoop (server/api/game-action.ts) minus the parts that exist
// for live play: no 3s pacing, no 60-move budget, no five-minute deadline. Every
// move still goes through handleGameAction, so an illegal move surfaces as a
// rejection rather than as corrupt state — which is why `rejections` is a
// headline metric of any run and is asserted to be zero.
//
// Bootstrapping goes through `toggle_ready`, not `start_game`. start_game is
// legacy: it hardcodes a 9x12 board, $6000 and 6 tiles and never writes
// rules_snapshot, so a game started through it ignores CustomRules entirely and
// would answer rule-sweep questions about a game nobody plays.
//
// Seats are fixed with turn_order_mode: 'manual', which skips the start-time
// shuffle. Seat order then means something, which is what the seat-fairness
// question needs.
// =============================================================================

import { setDbBackend } from '../server/lib/db';
import { handleGameAction } from '../server/api/game-action';
import { MemoryDb, type Tables } from './memory-db';
import { reseed } from './rng';
import { DEFAULT_RULES, type CustomRules } from '../server/lib/rules';
import type { Policy } from './policies';

const CORS: Record<string, string> = {};

/**
 * The configuration the whole study is calibrated against: exactly what the
 * product ships. That includes chainSafety: 'none'.
 *
 * This was originally set to chainSafety: '11', on the reasoning that roughly a
 * third of the card pool's scope levers are phrased in terms of safe chains.
 * Measurement rejected that choice. With safety on, 13-19% of games never reach
 * an end condition: safe chains cannot merge, so the board fragments into
 * regions that can never consolidate, the bag empties, and play stalls with
 * unplayable racks. With safety off — the shipped default — every merger stays
 * legal, the board keeps consolidating toward the 41-tile threshold, and 100% of
 * games finish. Pricing cards against a baseline that deadlocks one game in
 * seven would have described a game nobody plays.
 *
 * The consequence for the card pool is the finding, not a caveat: under shipped
 * defaults there are no safe chains, so every "may this card touch a safe chain"
 * lever is moot. Safety is swept as a rule dimension instead (see SWEEPS).
 */
export const BASELINE_RULES: CustomRules = { ...DEFAULT_RULES };

/** Phases in which a merger is mid-resolution, where the actor may not be the current player. */
const MERGER_PHASES = new Set(['merger_pay_bonuses', 'merger_handle_stock', 'merger_choose_survivor']);

export interface SeatSpec {
  policy: Policy;
  /** Reported in results so per-tier stability can be checked. */
  label: string;
}

export interface TurnContext {
  db: MemoryDb;
  state: Record<string, any>;
  players: Record<string, any>[];
  /** Seat about to act. */
  seat: number;
  round: number;
}

export type TurnHook = (ctx: TurnContext) => void;

export interface SimOptions {
  seats: SeatSpec[];
  rules?: Partial<CustomRules>;
  seed: number;
  /** Called once at the top of every turn, before the acting seat moves. Recurring card effects live here. */
  onTurnStart?: TurnHook;
  /** Called at every decision point. Used by corpus.ts to sample states. */
  onDecision?: (ctx: TurnContext & { phase: string }) => void;
  maxMoves?: number;
  /**
   * game_log is append-only and never read back by the engine, but it is the
   * single biggest thing cloned on every read. Capping it keeps a rollout cheap.
   * Merger counting uses the harness's own counter instead (see `mergers`).
   */
  logCap?: number;
}

export interface MoveRecord {
  seat: number;
  phase: string;
  action: string;
  ok: boolean;
}

export interface RunResult {
  /** 'finished' — a real game-over. 'stalled' — forced to end; counted and reported, never hidden. */
  outcome: 'finished' | 'stalled' | 'move_limit';
  moves: number;
  rejections: number;
  rounds: number;
  mergers: number;
  /** Set whenever outcome is not 'finished'. */
  stallReason: string | null;
  /** Ordered action names, for the determinism check. Timestamps are excluded — they are wall-clock. */
  log: string[];
}

const DEFAULT_MAX_MOVES = 4000;

export class Sim {
  readonly db = new MemoryDb();
  readonly roomId: string;
  readonly seats: SeatSpec[];
  readonly rules: CustomRules;

  mergers = 0;
  rejections = 0;
  moves = 0;
  /** Why a run ended other than by the rules. Reported, never hidden. */
  stallReason: string | null = null;

  private opts: SimOptions;
  private lastTurnKey = '';

  constructor(opts: SimOptions) {
    this.opts = opts;
    this.seats = opts.seats;
    this.rules = { ...BASELINE_RULES, ...(opts.rules ?? {}) };
    this.roomId = 'room-sim';
  }

  /** Install this game's storage as the process-wide backend. */
  activate(): void {
    setDbBackend(this.db);
  }

  state(): Record<string, any> | undefined {
    return this.db.rows('game_states').find((r) => r.room_id === this.roomId);
  }

  players(): Record<string, any>[] {
    return [...this.db.rows('game_players')].sort((a, b) => a.player_index - b.player_index);
  }

  snapshot(): Tables {
    return this.db.snapshot();
  }

  restore(tables: Tables): void {
    this.db.restore(tables);
  }

  /** Seed the room, the seats, and start the game through the live start path. */
  async setup(): Promise<void> {
    this.activate();
    reseed(this.opts.seed);
    this.db.reset();

    this.db.rows('game_rooms').push({
      id: this.roomId,
      room_code: 'SIM',
      status: 'waiting',
      max_players: 6,
      custom_rules: this.rules,
      host_user_id: 'user-0',
      turn_order_mode: 'manual',
      created_at: new Date(0).toISOString(),
    });

    this.seats.forEach((seat, index) => {
      this.db.rows('game_players').push({
        id: `player-${index}`,
        room_id: this.roomId,
        user_id: `user-${index}`,
        player_index: index,
        player_name: `${seat.label}#${index}`,
        // Every seat is a bot: bots are permanently ready, which is what makes
        // one toggle_ready enough to start the room.
        is_bot: true,
        bot_difficulty: 'medium',
        // Deliberately false at setup — a bot inserted as already-ready would
        // have its first toggle flip it *off* and return early.
        is_ready: false,
        cash: 0,
        stocks: {},
        tiles: [],
      });
    });

    const res = await this.act(0, 'toggle_ready');
    if (res.status !== 200) throw new Error(`toggle_ready failed: ${res.status}`);
    if (!this.state()) throw new Error('game did not start');
  }

  private act(seat: number, action: string, payload?: any): Promise<Response> {
    return handleGameAction({
      corsHeaders: CORS,
      body: { action, roomId: this.roomId, payload },
      actAsPlayerIndex: seat,
    });
  }

  /** Whose move is it? During the per-player merger stock step it is not the current player. */
  private actorSeat(state: Record<string, any>): number | null {
    const seat = state.phase === 'merger_handle_stock'
      ? state.merger?.currentPlayerIndex
      : state.current_player_index;
    return seat == null ? null : seat;
  }

  private countedUpTo = 0;

  /**
   * Count mergers as they are logged, then drop the entries we have already
   * counted. Must run in that order, and `countedUpTo` is reset to the trimmed
   * length so the next pass resumes at the right place.
   */
  private drainLog(state: Record<string, any>): void {
    const log = state.game_log;
    if (!Array.isArray(log)) return;
    for (let i = this.countedUpTo; i < log.length; i++) {
      const action = log[i]?.action;
      if (action === 'Merger complete' || action === 'Merger auto-resolved') this.mergers++;
    }
    this.countedUpTo = log.length;

    const cap = this.opts.logCap ?? 30;
    if (log.length > cap) {
      // Keep a short tail so anything reading recent history still sees some.
      state.game_log = log.slice(-2);
      this.countedUpTo = state.game_log.length;
    }
  }

  /** Force the game to end. All seats are bots, so a single vote reaches the majority. */
  private async forceEnd(): Promise<void> {
    const state = this.state();
    if (!state) return;
    if (!['place_tile', 'buy_stock'].includes(state.phase)) return;
    await this.act(state.current_player_index, 'end_game_vote', { vote: true });
  }

  async run(): Promise<RunResult> {
    const maxMoves = this.opts.maxMoves ?? DEFAULT_MAX_MOVES;
    const log: string[] = [];
    // Repeated discards from one seat mean the bag can no longer feed it a
    // playable tile; without this the loop would spin until the move cap.
    let discardStreak = 0;
    let outcome: RunResult['outcome'] = 'move_limit';

    for (let i = 0; i < maxMoves; i++) {
      const state = this.state();
      if (!state) break;
      if (state.phase === 'game_over') { outcome = 'finished'; break; }

      this.drainLog(state);

      const seat = this.actorSeat(state);
      if (seat == null) break;
      const players = this.players();

      // One hook call per turn, not per action within a turn.
      const turnKey = `${state.round_number ?? 0}:${state.current_player_index}`;
      if (turnKey !== this.lastTurnKey) {
        this.lastTurnKey = turnKey;
        this.opts.onTurnStart?.({ db: this.db, state, players, seat, round: state.round_number ?? 0 });
      }
      this.opts.onDecision?.({
        db: this.db, state, players, seat, round: state.round_number ?? 0, phase: state.phase,
      });

      const actor = players.find((p) => p.player_index === seat);
      if (!actor) break;

      // Captured before the call: `state` is the live row and the engine writes
      // through it, so reading state.phase afterwards reports the *next* phase.
      const phase = state.phase;
      const bagBefore = (state.tile_bag ?? []).length;

      const move = this.seats[seat].policy(phase, state, players, actor);
      const res = await this.act(seat, move.action, move.payload);
      this.moves++;
      log.push(`${seat}:${phase}:${move.action}`);

      if (move.action === 'discard_tile') {
        discardStreak++;
        if (discardStreak > 25) {
          // Every tile in hand is permanently unplayable and the bag can no
          // longer help. Recorded, never silently dropped.
          this.stallReason = bagBefore === 0 ? 'empty_bag_deadlock' : 'dead_hand_deadlock';
          await this.forceEnd();
          outcome = 'stalled';
          break;
        }
      } else {
        discardStreak = 0;
      }

      if (res.status !== 200) {
        this.rejections++;
        // Mirror the production fallbacks so a merger cannot freeze a run. Any
        // rejection outside a merger phase is a real defect and ends the game.
        if (!MERGER_PHASES.has(phase)) {
          this.stallReason = `rejected:${phase}:${move.action}`;
          await this.forceEnd();
          outcome = 'stalled';
          break;
        }
        const fallback = mergerFallback(state, actor);
        const fbRes = await this.act(seat, fallback.action, fallback.payload);
        this.moves++;
        if (fbRes.status !== 200) {
          this.stallReason = `merger_fallback_rejected:${phase}`;
          await this.forceEnd();
          outcome = 'stalled';
          break;
        }
      }
    }

    const state = this.state();
    if (state) this.drainLog(state);
    if (state?.phase === 'game_over' && outcome === 'move_limit') outcome = 'finished';

    return {
      outcome,
      stallReason: this.stallReason,
      moves: this.moves,
      rejections: this.rejections,
      rounds: state?.round_number ?? 0,
      mergers: this.mergers,
      log,
    };
  }
}

/** The same safe fallbacks driveBotsLoop uses when a bot's merger move is rejected. */
function mergerFallback(state: Record<string, any>, actor: Record<string, any>): { action: string; payload?: any } {
  if (state.phase === 'merger_handle_stock') {
    const defunct = state.merger?.currentDefunctChain;
    const shares: number = actor.stocks?.[defunct] ?? 0;
    return { action: 'merger_stock_choice', payload: { decision: { sell: 0, trade: 0, keep: shares } } };
  }
  if (state.phase === 'merger_choose_survivor') {
    const chains = state.chains ?? {};
    const tied = (state.merger?.defunctChains as string[]) ?? [];
    const survivor = [...tied].sort(
      (a, b) => (chains[b]?.tiles?.length ?? 0) - (chains[a]?.tiles?.length ?? 0),
    )[0] ?? tied[0];
    return { action: 'choose_merger_survivor', payload: { survivingChain: survivor } };
  }
  return { action: 'pay_merger_bonuses' };
}

/** Build, start and play one game. The common entry point for every study below. */
export async function playGame(opts: SimOptions): Promise<{ sim: Sim; result: RunResult }> {
  const sim = new Sim(opts);
  await sim.setup();
  const result = await sim.run();
  return { sim, result };
}
