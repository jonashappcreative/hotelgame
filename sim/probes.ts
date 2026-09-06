// One-off probe, two questions:
//
// 1. Does a bot ever get asked to buy twice inside one turn? The bot's buy loop
//    counts to MAX_STOCKS_PER_TURN from zero every time it is asked, while the
//    engine counts stocks_purchased_this_turn across the whole turn — so a bot
//    that stops early and is asked again could overshoot into a rejected move.
// 2. Is the dead-lock rate a property of chain safety? With safety off, no
//    merger is ever blocked, so the board keeps consolidating toward the 41-tile
//    end condition instead of fragmenting into chains that can never merge.
import './boot';
import { Sim, playGame } from './harness';
import { uniformSeats, policy, type PolicyName } from './policies';
import { silenceEngineLogs, report } from './log';

async function buyReentry() {
  report('--- buy-phase re-entry ---');
  for (const difficulty of ['easy', 'medium', 'hard'] as PolicyName[]) {
    let reentries = 0;
    let rejections = 0;
    const games = 200;
    for (let i = 0; i < games; i++) {
      // Wrap each seat's policy to count consecutive buy_stock decisions.
      let lastKey = '';
      let streak = 0;
      const seats = Array.from({ length: 4 }, (_, seat) => {
        const inner = policy(difficulty);
        return {
          label: difficulty,
          policy: (phase: string, state: any, players: any[], actor: any) => {
            if (phase === 'buy_stock') {
              const key = `${state.round_number}:${seat}`;
              streak = key === lastKey ? streak + 1 : 0;
              lastKey = key;
              if (streak === 1) reentries++;
            }
            return inner(phase, state, players, actor);
          },
        };
      });
      const sim = new Sim({ seats, seed: 777_000 + i });
      await sim.setup();
      const result = await sim.run();
      rejections += result.rejections;
    }
    report(`  ${difficulty}: ${games} games, buy-phase re-entries=${reentries}, rejections=${rejections}`);
  }
}

async function safetyDeadlocks() {
  report('--- dead-lock rate vs chain safety ---');
  for (const chainSafety of ['none', '9', '11', '13', '15']) {
    const games = 250;
    let finished = 0;
    const reasons: Record<string, number> = {};
    let rounds = 0;
    for (let i = 0; i < games; i++) {
      const { result } = await playGame({
        seats: uniformSeats('hard', 4),
        seed: 888_000 + i,
        rules: { chainSafety } as any,
      });
      if (result.outcome === 'finished') finished++;
      else reasons[result.stallReason ?? '?'] = (reasons[result.stallReason ?? '?'] ?? 0) + 1;
      rounds += result.rounds;
    }
    report(`  chainSafety=${chainSafety}: finished ${((finished / games) * 100).toFixed(1)}%, mean rounds ${(rounds / games).toFixed(1)}, stalls ${JSON.stringify(reasons)}`);
  }
}

async function main() {
  silenceEngineLogs();
  await buyReentry();
  await safetyDeadlocks();
}

main().catch((err) => { report(err); process.exit(1); });
