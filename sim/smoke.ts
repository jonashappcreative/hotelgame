// Temporary smoke entry — sanity-checks the harness and the valuation core.
import './boot';
import { playGame } from './harness';
import { uniformSeats } from './policies';
import { silenceEngineLogs, report } from './log';
import { buildCorpus, corpusProfile } from './corpus';
import { estimateLambda, counterfactual, grantCash } from './equity';
import { fmtMoney } from './stats';

async function main() {
  silenceEngineLogs();

  let t0 = Date.now();
  const N = 50;
  let rejections = 0;
  const stalls: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const { result } = await playGame({ seats: uniformSeats('hard', 4), seed: 1000 + i });
    rejections += result.rejections;
    if (result.outcome !== 'finished') stalls[result.stallReason ?? '?'] = (stalls[result.stallReason ?? '?'] ?? 0) + 1;
  }
  report(`games: ${N} in ${Date.now() - t0}ms, rejections=${rejections}, stalls=${JSON.stringify(stalls)}`);

  t0 = Date.now();
  const seats = uniformSeats('hard', 4);
  const corpus = await buildCorpus({ seats, games: 8, seedBase: 5000, perGame: 3 });
  report(`corpus: ${corpus.length} states in ${Date.now() - t0}ms ${JSON.stringify(corpusProfile(corpus))}`);

  t0 = Date.now();
  const lambda = await estimateLambda({
    states: corpus.slice(0, 8).map((s) => ({ id: s.id, tables: s.tables, seat: s.seat, round: s.round, stratum: s.stratum })),
    seats,
    n: 40,
    seedBase: 900000,
  });
  report(`lambda: ${lambda.lambda.toFixed(3)} [${lambda.lo.toFixed(3)}, ${lambda.hi.toFixed(3)}] in ${Date.now() - t0}ms`);

  // The unit test of the whole model: price "gain $2000 cash" and check it comes
  // back at lambda x $2000.
  const probe = corpus[0];
  const v = await counterfactual({
    tables: probe.tables, seats, seat: probe.seat, seedBase: 700000, n: 80,
    treatment: () => ({ patch: (tables) => grantCash(tables, probe.seat, 2000) }),
  });
  report(`$2000 grant -> ${fmtMoney(v.buyer.mean)} [${fmtMoney(v.buyer.lo)}, ${fmtMoney(v.buyer.hi)}], expected ~${fmtMoney(2000 * lambda.lambda)}`);
}

main().catch((err) => { report(err); process.exit(1); });
