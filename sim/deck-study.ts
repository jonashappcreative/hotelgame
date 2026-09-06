// =============================================================================
// deck-study — one game record, and the batches that produce them
// =============================================================================
// The unit of analysis is one finished game, written as one JSON line. Nothing
// is aggregated here: the scenarios are read back out of the JSONL, so a price
// curve can be re-cut, a metric re-derived or a subgroup pulled out without
// replaying 22,000 games.
// =============================================================================

import {
  playDeckGame, type DeckPolicyName, type SeatDeckStats, type PlayEvent,
} from './deck';
import type { SeatSpec } from './harness';
import type { PolicyName } from './policies';

export type DeckMode = 'none' | 'one-seat' | 'all-seats';

export interface DeckRecord {
  cell: string;
  seed: number;
  seat_config: string;
  price: number;
  policy: DeckPolicyName;
  deck_enabled: boolean;
  deck_mode: DeckMode;

  /** Single winner, or null when the game ended in a tie on net worth. */
  winner_seat: number | null;
  winners: number[];
  final_cash_by_seat: number[];
  final_net_worth_by_seat: number[];

  /** The seat under test in Scenario A. Null when every seat has the deck. */
  deck_seat: number | null;
  /** Deck seat's final cash minus the mean of the other three. The plan's secondary metric. */
  deck_seat_margin_vs_field_mean: number | null;
  /** The same margin on net worth — the quantity that actually decides the game. */
  deck_seat_networth_margin_vs_field_mean: number | null;

  rounds_played: number;
  merger_count: number;
  /** Sum of every seat's cash on hand at the end. Card prices leave this pool; bank-sourced effects add to it. */
  total_money_end: number;
  money_in_play: { round: number; total: number }[];

  cards_bought: number;
  cards_played: number;
  cards_unplayed_at_end: number;
  mean_idle_rounds_per_card: number;
  affordability_declines: number;
  buy_opportunities: number;

  game_ended_naturally: boolean;
  outcome: string;
  stall_reason: string | null;
  rejections: number;

  card_ids_played: string[];
  card_ids_unplayed: string[];
  deck_stats_by_seat: SeatDeckStats[];
  plays: PlayEvent[];
}

export interface DeckGameSpec {
  cell: string;
  seats: SeatSpec[];
  seatNames: PolicyName[];
  seed: number;
  /** Which seat holds the deck. Also recorded for the no-deck arm, where it is notional and pairs the record. */
  deckSeat: number | null;
  mode: DeckMode;
  policy: DeckPolicyName;
  price: number;
  suppressPlayIndex?: number;
  placeboPlayIndex?: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export async function playRecord(spec: DeckGameSpec): Promise<DeckRecord> {
  const seatCount = spec.seats.length;
  const deckSeats =
    spec.mode === 'all-seats' ? spec.seats.map((_, i) => i)
    : spec.mode === 'one-seat' && spec.deckSeat !== null ? [spec.deckSeat]
    : [];

  const game = await playDeckGame({
    seats: spec.seats,
    seed: spec.seed,
    deckSeats,
    policy: spec.policy,
    price: spec.price,
    suppressPlayIndex: spec.suppressPlayIndex,
    placeboPlayIndex: spec.placeboPlayIndex,
  });

  const cash: number[] = new Array(seatCount).fill(0);
  const net: number[] = new Array(seatCount).fill(0);
  for (const s of game.seatScores) { cash[s.seat] = s.cash; net[s.seat] = s.netWorth; }

  const seat = spec.deckSeat;
  const others = (xs: number[]) => xs.filter((_, i) => i !== seat);
  const cashMargin = seat === null ? null : cash[seat] - mean(others(cash));
  const netMargin = seat === null ? null : net[seat] - mean(others(net));

  const stats = game.deckStats;
  const sum = (f: (s: SeatDeckStats) => number) => stats.reduce((a, s) => a + f(s), 0);
  const idle = stats.flatMap((s) => s.idleRounds);

  return {
    cell: spec.cell,
    seed: spec.seed,
    seat_config: spec.seatNames.join('/'),
    price: spec.price,
    policy: spec.policy,
    deck_enabled: deckSeats.length > 0,
    deck_mode: spec.mode,

    winner_seat: game.winners.length === 1 ? game.winners[0] : null,
    winners: game.winners,
    final_cash_by_seat: cash,
    final_net_worth_by_seat: net,

    deck_seat: seat,
    deck_seat_margin_vs_field_mean: cashMargin,
    deck_seat_networth_margin_vs_field_mean: netMargin,

    rounds_played: game.rounds,
    merger_count: game.mergers,
    total_money_end: cash.reduce((a, b) => a + b, 0),
    money_in_play: game.moneyInPlay,

    cards_bought: sum((s) => s.cardsBought),
    cards_played: sum((s) => s.cardsPlayed),
    cards_unplayed_at_end: sum((s) => s.cardsUnplayedAtEnd),
    mean_idle_rounds_per_card: mean(idle),
    affordability_declines: sum((s) => s.affordabilityDeclines),
    buy_opportunities: sum((s) => s.buyOpportunities),

    game_ended_naturally: game.outcome === 'finished',
    outcome: game.outcome,
    stall_reason: game.stallReason,
    rejections: game.rejections,

    card_ids_played: stats.flatMap((s) => s.cardIdsPlayed),
    card_ids_unplayed: stats.flatMap((s) => s.cardIdsUnplayed),
    deck_stats_by_seat: stats,
    plays: game.plays,
  };
}
