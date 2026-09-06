// =============================================================================
// worker — executes one job in its own thread
// =============================================================================
// Each worker owns its own MemoryDb and its own seeded Math.random, so threads
// never share mutable state. That is also why the db backend can be a process
// singleton without a race: a worker thread is a separate isolate.
//
// Workers narrate. Every meaningful step posts a `log` message back to the main
// thread, which prints it with a timestamp — so a ten-minute run reads as a
// stream of finished work rather than a progress percentage.
// =============================================================================

import './boot';
import { parentPort, workerData } from 'worker_threads';
import { silenceEngineLogs } from './log';
import { seatsOf } from './policies';
import { playBatch } from './studies';
import { buildCorpus, corpusProfile, type CorpusState } from './corpus';
import { estimateLambda } from './equity';
import { valueCard } from './valuation';
import { cardById, leverGrid } from './effects';
import { money, pct, pad, padLeft } from './progress';
import type { Job, JobResult, CorpusSpec } from './jobs';
import { playRecord } from './deck-study';
import type { EquitySample } from './equity';

silenceEngineLogs();

const ID: number = workerData.id;

function say(line: string): void {
  parentPort!.postMessage({ log: line, worker: ID });
}

let cachedCorpus: { key: string; states: CorpusState[] } | null = null;

async function corpusFor(spec: CorpusSpec): Promise<CorpusState[]> {
  const key = JSON.stringify(spec);
  if (cachedCorpus?.key === key) return cachedCorpus.states;
  const started = Date.now();
  const states = await buildCorpus({
    seats: seatsOf(spec.seats),
    games: spec.games,
    seedBase: spec.seedBase,
    perGame: spec.perGame,
  });
  cachedCorpus = { key, states };
  const profile = corpusProfile(states);
  say(`corpus rebuilt: ${states.length} positions from ${spec.games} games in ${Date.now() - started}ms  ` +
    Object.entries(profile).map(([k, v]) => `${k}:${v}`).join(' '));
  return states;
}

async function execute(job: Job): Promise<JobResult> {
  switch (job.kind) {
    case 'batch': {
      const started = Date.now();
      const records = await playBatch({
        seats: seatsOf(job.seats),
        games: job.games,
        seedBase: job.seedBase,
        rules: job.rules as any,
        onGame: (done, total) => {
          // One line per quarter of a shard: enough to show life, not enough to
          // drown the other workers' output.
          const step = Math.max(1, Math.floor(total / 4));
          if (done % step === 0 && done < total) {
            say(`${pad(job.label, 22)} ${padLeft(`${done}/${total}`, 9)} games`);
          }
        },
      });
      const finished = records.filter((r) => r.outcome === 'finished').length;
      const rejections = records.reduce((sum, r) => sum + r.rejections, 0);
      const rounds = records.reduce((sum, r) => sum + r.rounds, 0) / records.length;
      say(`${pad(job.label, 22)} ${padLeft(`${records.length}`, 5)} games done in ${padLeft(`${Date.now() - started}ms`, 7)}  ` +
        `finished ${padLeft(pct(finished / records.length), 4)}  rounds ${rounds.toFixed(1)}  rejections ${rejections}`);
      return { kind: 'batch', label: job.label, records };
    }

    case 'deck': {
      const started = Date.now();
      const seats = seatsOf(job.seats);
      const records = [];
      // 'none' is deck-disabled: the four rotations of a seed are bit-identical
      // games, because nothing in the deck layer runs and nothing consumes the
      // game's random stream. Playing one and pairing it against all four
      // rotations is not an approximation, it is the same numbers for a quarter
      // of the work — and the identity is asserted in deck.test.ts.
      const rotations = job.mode === 'one-seat' ? job.rotations : [null];
      for (const seed of job.seeds) {
        for (const rotation of rotations) {
          const record = await playRecord({
            cell: job.cell, seats, seatNames: job.seats, seed,
            deckSeat: rotation, mode: job.mode, policy: job.policy, price: job.price,
          });
          // The money-supply trace is only ever read for Scenario B's inflation
          // question, which compares the symmetric arm against the baseline.
          // Carrying it on all 20,000 asymmetric records would triple the JSONL
          // and the cross-thread payload for nothing.
          if (job.mode === 'one-seat') record.money_in_play = [];
          records.push(record);
        }
      }
      const natural = records.filter((r) => r.game_ended_naturally).length;
      const rejections = records.reduce((sum, r) => sum + r.rejections, 0);
      say(`${pad(job.label, 26)} ${padLeft(`${records.length}`, 5)} games in ${padLeft(`${((Date.now() - started) / 1000).toFixed(1)}s`, 7)}  ` +
        `natural ${padLeft(pct(natural / records.length), 4)}  rejections ${rejections}  ` +
        `played/g ${(records.reduce((s, r) => s + r.cards_played, 0) / records.length).toFixed(1)}`);
      return { kind: 'deck', cell: job.cell, records };
    }

    case 'lambda': {
      const corpus = await corpusFor(job.corpus);
      const states = corpus.slice(job.offset, job.offset + job.states);
      const started = Date.now();
      const est = await estimateLambda({
        states: states.map((s) => ({ id: s.id, tables: s.tables, seat: s.seat, round: s.round, stratum: s.stratum })),
        seats: seatsOf(job.corpus.seats),
        n: job.rollouts,
        seedBase: job.seedBase,
      });
      say(`lambda shard @${job.offset}: ${states.length} positions x ${job.rollouts} paired rollouts in ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s -> ${est.lambda.toFixed(3)}`);
      return { kind: 'lambda', lambda: est.lambda, lo: est.lo, hi: est.hi, perState: est.perState };
    }

    case 'card': {
      const corpus = await corpusFor(job.corpus);
      const card = cardById(job.cardId);
      const seats = seatsOf(job.corpus.seats);
      const grid = leverGrid(card, job.leverCap);
      say(`${pad(card.name, 22)} start — ${grid.length} lever cell(s), ${corpus.length} positions, ${job.rollouts} rollouts/arm [${card.fidelity}]`);

      // One baseline per position, shared across every lever cell of this card.
      const baselines = new Map<string, EquitySample>();
      const cells = [];
      const started = Date.now();
      for (let i = 0; i < grid.length; i++) {
        const cellStart = Date.now();
        const cell = await valueCard({
          card, levers: grid[i], corpus, seats,
          rollouts: job.rollouts,
          seedBase: job.seedBase,
          config: job.config,
          baselines,
        });
        cells.push(cell);
        say(`${pad(card.name, 22)} cell ${i + 1}/${grid.length} ${pad(cell.leverLabel, 34)} ` +
          `mean ${padLeft(money(cell.mean), 9)}  P95 ${padLeft(money(cell.ceiling), 9)}  ` +
          `legal ${padLeft(`${cell.legalStates}/${cell.totalStates}`, 6)}  ${((Date.now() - cellStart) / 1000).toFixed(1)}s`);
      }
      say(`${pad(card.name, 22)} DONE in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return { kind: 'card', cardId: job.cardId, cells };
    }
  }
}

async function main() {
  const jobs = workerData.jobs as Job[];
  for (let i = 0; i < jobs.length; i++) {
    const result = await execute(jobs[i]);
    parentPort!.postMessage({ ok: true, index: workerData.indices[i], result });
  }
  parentPort!.postMessage({ done: true });
}

main().catch((err) => {
  parentPort!.postMessage({ ok: false, error: String(err?.stack ?? err) });
});
