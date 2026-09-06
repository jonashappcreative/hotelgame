// =============================================================================
// pool — a minimal worker_threads pool
// =============================================================================
// Jobs are dealt round-robin at spawn time rather than queued dynamically. Every
// job in this study is roughly the same size (a card, or a batch of games), so
// static dealing costs a little tail latency and saves the whole machinery of a
// work-stealing queue.
//
// Workers narrate their own progress; this module's other job is to interleave
// those narrations onto one terminal, stamped with the worker that produced them
// and the elapsed time, so a parallel run still reads top to bottom.
// =============================================================================

import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { join } from 'path';
import type { Job, JobResult } from './jobs';
import { report } from './log';
import { clock, eta, bar, padLeft } from './progress';

export function defaultWorkers(): number {
  return Math.max(1, Math.min(8, cpus().length - 1));
}

export interface PoolOptions {
  workers?: number;
  /** Printed on the summary line so a phase is identifiable in the scrollback. */
  label: string;
  /** Set false for phases whose per-job lines would drown the useful output. */
  verbose?: boolean;
}

export async function runJobs(jobs: Job[], opts: PoolOptions): Promise<JobResult[]> {
  if (jobs.length === 0) return [];
  const workers = opts.workers ?? defaultWorkers();
  const count = Math.min(workers, jobs.length);
  const verbose = opts.verbose !== false;

  const shards: { id: number; jobs: Job[]; indices: number[] }[] =
    Array.from({ length: count }, (_, id) => ({ id, jobs: [], indices: [] }));
  jobs.forEach((job, i) => {
    shards[i % count].jobs.push(job);
    shards[i % count].indices.push(i);
  });

  report(`  ${jobs.length} job(s) across ${count} worker(s)`);

  const results: JobResult[] = new Array(jobs.length);
  const started = Date.now();
  let done = 0;

  await Promise.all(shards.map((shard) => new Promise<void>((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'worker.js'), { workerData: shard });
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      err ? reject(err) : resolve();
    };

    worker.on('message', (msg: any) => {
      if (msg.log !== undefined) {
        if (verbose) report(`  ${clock()} w${msg.worker} │ ${msg.log}`);
        return;
      }
      if (msg.done) { finish(); return; }
      if (!msg.ok) { finish(new Error(msg.error)); return; }
      results[msg.index] = msg.result;
      done++;
      report(`  ${clock()} ${bar(done, jobs.length)} ${padLeft(`${done}/${jobs.length}`, 7)} ${opts.label}  eta ${eta(done, jobs.length, started)}`);
    });

    worker.on('error', (err) => finish(err));
    // Only an exit we did not ask for is a failure — terminate() after a clean
    // finish exits non-zero by design.
    worker.on('exit', (code) => finish(code === 0 ? undefined : new Error(`worker exited ${code}`)));
  })));

  report(`  ${clock()} ${opts.label} complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return results;
}
