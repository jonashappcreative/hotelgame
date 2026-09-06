// =============================================================================
// log — mute the engine's own console during a run
// =============================================================================
// handleGameAction logs one line per action ("Processing action: ..."), which is
// right for a server and ruinous for a study that plays millions of actions.
// This swaps console.log/warn/error for no-ops and keeps a separate channel
// (`report`) for the simulator's own output, so results are never lost in the
// noise and the engine is never modified to be quieter.
// =============================================================================

const real = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let silenced = false;

export function silenceEngineLogs(): void {
  if (silenced) return;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  silenced = true;
}

export function restoreLogs(): void {
  if (!silenced) return;
  console.log = real.log;
  console.warn = real.warn;
  console.error = real.error;
  silenced = false;
}

/** The simulator's own output channel — always reaches the terminal. */
export function report(...args: unknown[]): void {
  real.error(...args);
}
