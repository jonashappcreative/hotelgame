// =============================================================================
// progress — formatting for the live terminal view
// =============================================================================
// A ten-minute run that prints "12/21" tells you it is alive and nothing else.
// These helpers exist so every line the run emits carries three things: how long
// it has been going, what just finished, and what the number was — so the run is
// readable as it happens rather than only once it writes its JSON.
// =============================================================================

const START = Date.now();

/** mm:ss since the process started. Every emitted line is stamped with it. */
export function clock(): string {
  const seconds = Math.floor((Date.now() - START) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Remaining time implied by the work done so far. Rough, and labelled as such. */
export function eta(done: number, total: number, since: number): string {
  if (done === 0) return '--:--';
  const perItem = (Date.now() - since) / done;
  const seconds = Math.round((perItem * (total - done)) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function bar(done: number, total: number, width = 24): string {
  const filled = total === 0 ? width : Math.round((done / total) * width);
  return `[${'#'.repeat(filled)}${'.'.repeat(Math.max(0, width - filled))}]`;
}

export function money(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.round(value));
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

export function padLeft(text: string, width: number): string {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

export function rule(title: string, width = 78): string {
  const head = `── ${title} `;
  return head + '─'.repeat(Math.max(0, width - head.length));
}
