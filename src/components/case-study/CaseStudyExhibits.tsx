import { useEffect, useRef, useState } from 'react';
import { ChainName, CHAINS } from '@/types/game';
import { getStockPrice } from '@/utils/gameLogic';
import { Button } from '@/components/ui/button';
import { useAudio } from '@/contexts/AudioContext';
import { cn } from '@/lib/utils';
import { Building2, Minus, Plus, RotateCcw, ShoppingCart } from 'lucide-react';

/* ----------------------------------------------------------------------------
   Self-contained, client-only slices of the real game for the case-study page.
   They reuse the game's design tokens (.tile / .chain-* / tokens from index.css)
   and the real price matrix, but hold their tiny state locally — no server.
   ---------------------------------------------------------------------------- */

type MiniTile = { placed: boolean; chain: ChainName | null };
type MiniBoardState = Record<string, MiniTile>;

const cellId = (row: number, col: string) => `${row}${col}`;

interface MiniBoardProps {
  cols: string[];
  rows: number[];
  tiles: MiniBoardState;
  highlightedCells?: Set<string>;
  onCellClick?: (cellId: string) => void;
}

const MiniBoard = ({ cols, rows, tiles, highlightedCells, onCellClick }: MiniBoardProps) => (
  <div className="bg-[hsl(var(--board-bg))] rounded-2xl p-3 md:p-4 shadow-lg">
    <div className="flex mb-1.5">
      <div className="w-6 md:w-8" />
      {cols.map(col => (
        <div key={col} className="flex-1 text-center text-[10px] md:text-xs font-medium text-muted-foreground">
          {col}
        </div>
      ))}
    </div>
    <div className="space-y-1">
      {rows.map(row => (
        <div key={row} className="flex gap-1">
          <div className="w-6 md:w-8 flex items-center justify-center text-[10px] md:text-xs font-medium text-muted-foreground">
            {row}
          </div>
          {cols.map(col => {
            const id = cellId(row, col);
            const tile = tiles[id];
            const isHighlighted = highlightedCells?.has(id);
            return (
              <button
                key={id}
                onClick={() => isHighlighted && onCellClick?.(id)}
                disabled={!isHighlighted}
                className={cn(
                  'tile flex-1 aspect-[4/3] min-h-[22px] md:min-h-[30px] text-[9px] md:text-[11px] font-mono',
                  tile?.placed && !tile.chain && 'tile-placed animate-slide-up',
                  tile?.chain && `tile-chain chain-${tile.chain}`,
                  isHighlighted && !tile?.placed && 'border-primary animate-pulse-subtle ring-1 ring-primary/50 cursor-pointer hover:scale-105 transition-transform',
                )}
              >
                <span className={cn(
                  'font-semibold',
                  tile?.chain === 'tower' ? 'text-background' :
                  tile?.placed ? 'text-foreground' :
                  isHighlighted ? 'text-primary' :
                  'text-muted-foreground/25',
                )}>
                  {id}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  </div>
);

interface HandTileProps {
  id: string;
  used: boolean;
  isKey?: boolean;
  onClick: () => void;
}

const HandTile = ({ id, used, isKey, onClick }: HandTileProps) => (
  <button
    onClick={onClick}
    disabled={used}
    aria-label={`Place tile ${id}`}
    className={cn(
      'w-14 aspect-[4/3] rounded-md font-mono text-xs font-semibold border-2 transition-all duration-200 flex items-center justify-center',
      used
        ? 'bg-muted/40 border-border/50 border-dashed text-muted-foreground/50 cursor-default'
        : isKey
        ? 'bg-primary/20 border-primary/60 text-primary cursor-pointer hover:bg-primary/30 hover:scale-105 shadow-[0_0_20px_rgba(var(--color-primary),0.4)]'
        : 'bg-primary/20 border-primary text-primary cursor-pointer hover:bg-primary/30 hover:scale-105',
    )}
  >
    {id}
  </button>
);

const ExhibitFrame = ({
  label,
  onReset,
  resetLabel = 'Reset',
  children,
}: {
  label: string;
  onReset: () => void;
  resetLabel?: string;
  children: React.ReactNode;
}) => (
  <div className="relative rounded-xl border border-border/60 p-4 md:p-5" style={{ background: 'var(--gradient-card)' }}>
    <div className="flex items-center justify-between gap-3 mb-4">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      <Button variant="ghost" size="sm" onClick={onReset}>
        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
        {resetLabel}
      </Button>
    </div>
    {children}
  </div>
);

/* ----------------------------------------------------------------------------
   Exhibit 1 — place tiles, found a chain
   ---------------------------------------------------------------------------- */

const EX1_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const EX1_ROWS = [1, 2, 3, 4, 5, 6];
const EX1_PRESET = ['2C', '5G'];
const EX1_HAND = ['2D', '4B', '6E', '3H', '5A', '1F'];
const EX1_FOUNDER_TILE = '2D'; // lands next to 2C → founds a chain
const EX1_CHOICES: ChainName[] = ['tower', 'american', 'imperial'];

export const PlaceFoundExhibit = () => {
  const { playSfx } = useAudio();
  const [board, setBoard] = useState<MiniBoardState>({});
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [chooserOpen, setChooserOpen] = useState(false);
  const [founded, setFounded] = useState<ChainName | null>(null);
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const reset = () => {
    clearTimeout(timer.current);
    const initial: MiniBoardState = {};
    EX1_PRESET.forEach(id => { initial[id] = { placed: true, chain: null }; });
    setBoard(initial);
    setUsed(new Set());
    setChooserOpen(false);
    setFounded(null);
    setStatus('Your move. Tap any glowing tile in your hand to place it on the board.');
  };

  useEffect(() => {
    reset();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placeTile = (id: string) => {
    if (used.has(id) || chooserOpen) return;
    const nextUsed = new Set(used).add(id);
    setUsed(nextUsed);
    setBoard(prev => ({ ...prev, [id]: { placed: true, chain: null } }));
    playSfx('tile-place');
    if (id === EX1_FOUNDER_TILE && !founded) {
      setStatus('2C and 2D are touching — you just founded a hotel chain. Pick the brand.');
      timer.current = setTimeout(() => setChooserOpen(true), 400);
    } else if (nextUsed.size === EX1_HAND.length && founded) {
      setStatus('Hand played. In the real game you would now draw back up to six tiles — and buy stocks.');
    } else {
      setStatus(`Placed ${id}.${founded ? '' : ' Tiles next to each other become a hotel chain — try 2D.'}`);
    }
  };

  const chooseChain = (chain: ChainName) => {
    setChooserOpen(false);
    setFounded(chain);
    setBoard(prev => ({
      ...prev,
      '2C': { placed: true, chain },
      '2D': { placed: true, chain },
    }));
    playSfx('chain-founded');
    const done = used.size === EX1_HAND.length;
    setStatus(`${CHAINS[chain].displayName} established! The founder receives one free share.${done ? ' Hand played — next: the stock phase.' : ''}`);
  };

  return (
    <ExhibitFrame label="Exhibit — your opening move" onReset={reset}>
      <MiniBoard cols={EX1_COLS} rows={EX1_ROWS} tiles={board} highlightedCells={!used.has(EX1_FOUNDER_TILE) ? new Set([EX1_FOUNDER_TILE]) : undefined} onCellClick={(id) => placeTile(id)} />
      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Your tiles</p>
        <div className="flex flex-wrap gap-2">
          {EX1_HAND.map(id => (
            <HandTile key={id} id={id} used={used.has(id)} isKey={id === EX1_FOUNDER_TILE && !founded} onClick={() => placeTile(id)} />
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-3 min-h-[20px]" role="status" aria-live="polite">{status}</p>
      {chooserOpen && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/85 backdrop-blur-sm">
          <div className="bg-card rounded-xl p-5 shadow-2xl border border-primary/50 animate-slide-up w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Found a Hotel Chain!</h3>
                <p className="text-sm text-muted-foreground">Choose which chain to establish. You'll receive 1 bonus share.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {EX1_CHOICES.map(chain => (
                <Button
                  key={chain}
                  variant="outline"
                  className="h-auto p-3 justify-start gap-3 hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
                  onClick={() => chooseChain(chain)}
                >
                  <span className={cn('w-5 h-5 rounded-full shrink-0', `chain-${chain}`)} />
                  <div className="text-left">
                    <p className="font-semibold text-sm">{CHAINS[chain].displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {CHAINS[chain].tier} · ${getStockPrice(chain, 2)}/share
                    </p>
                  </div>
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
      {founded && (
        <div className="mt-3">
          <span className="stock-badge bg-secondary border border-border/70">
            <span className={cn('w-2.5 h-2.5 rounded-full', `chain-${founded}`)} />
            +1 {CHAINS[founded].displayName} share — founder&apos;s bonus
          </span>
        </div>
      )}
    </ExhibitFrame>
  );
};

/* ----------------------------------------------------------------------------
   Exhibit 2 — trigger a merger
   ---------------------------------------------------------------------------- */

const EX2_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const EX2_ROWS = [1, 2, 3, 4, 5, 6];
const EX2_TOWER = ['3D', '3E', '3F'];
const EX2_AMERICAN = ['2H', '3H', '4H', '3I'];
const EX2_BRIDGE = '3G';

export const MergerExhibit = () => {
  const { playSfx } = useAudio();
  const [board, setBoard] = useState<MiniBoardState>({});
  const [placedBridge, setPlacedBridge] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [status, setStatus] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const reset = () => {
    clearTimers();
    const initial: MiniBoardState = {};
    EX2_TOWER.forEach(id => { initial[id] = { placed: true, chain: 'tower' }; });
    EX2_AMERICAN.forEach(id => { initial[id] = { placed: true, chain: 'american' }; });
    setBoard(initial);
    setPlacedBridge(false);
    setShowBanner(false);
    setStatus('Tower (3 tiles) and American (4 tiles) are one square apart. Place 3G between them.');
  };

  useEffect(() => {
    reset();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trigger = () => {
    if (placedBridge) return;
    setPlacedBridge(true);
    setBoard(prev => ({ ...prev, [EX2_BRIDGE]: { placed: true, chain: null } }));
    playSfx('merger-fanfare');
    setStatus('Merger! The bigger chain survives: American acquires Tower.');
    const defunct = [...EX2_TOWER].reverse();
    defunct.forEach((id, i) => {
      timers.current.push(setTimeout(() => {
        setBoard(prev => ({ ...prev, [id]: { placed: true, chain: 'american' } }));
      }, 700 + i * 160));
    });
    timers.current.push(setTimeout(() => {
      setBoard(prev => ({ ...prev, [EX2_BRIDGE]: { placed: true, chain: 'american' } }));
    }, 700 + defunct.length * 160));
    timers.current.push(setTimeout(() => setShowBanner(true), 1100));
  };

  return (
    <ExhibitFrame label="Exhibit — the hostile takeover" onReset={reset} resetLabel="Replay">
      <MiniBoard cols={EX2_COLS} rows={EX2_ROWS} tiles={board} highlightedCells={!placedBridge ? new Set([EX2_BRIDGE]) : undefined} onCellClick={() => trigger()} />
      <div className="flex items-end gap-5 flex-wrap mt-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Your tile</p>
          <HandTile id={EX2_BRIDGE} used={placedBridge} isKey={!placedBridge} onClick={trigger} />
        </div>
        <p className="text-sm text-muted-foreground flex-1 min-w-[200px]" role="status" aria-live="polite">{status}</p>
      </div>
      {showBanner && (
        <div className="game-log-entry game-log-entry-recent mt-4 animate-slide-up" aria-live="polite">
          <p className="font-semibold text-foreground">American acquires Tower — the survivor grows to 8 tiles.</p>
          <p className="text-muted-foreground text-xs mt-1">
            Tower shareholders are paid out before their shares convert: majority bonus 10× share price, minority 5×.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="stock-badge bg-chain-tower/15 border border-chain-tower/40 text-chain-tower font-mono">
              Majority bonus $3,000 → you
            </span>
            <span className="stock-badge bg-chain-tower/15 border border-chain-tower/40 text-chain-tower font-mono">
              Minority bonus $1,500 → Marie
            </span>
          </div>
        </div>
      )}
    </ExhibitFrame>
  );
};

/* ----------------------------------------------------------------------------
   Exhibit 3 — buy stocks
   ---------------------------------------------------------------------------- */

const EX3_CHAINS: { chain: ChainName; size: number; safe?: boolean }[] = [
  { chain: 'tower', size: 3 },
  { chain: 'american', size: 8 },
  { chain: 'continental', size: 11, safe: true },
];
const EX3_MAX_PER_TURN = 3;
const EX3_START_CASH = 6000;

export const StockExhibit = () => {
  const { playSfx } = useAudio();
  const [cash, setCash] = useState(EX3_START_CASH);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [owned, setOwned] = useState<Record<string, number>>({});
  const [status, setStatus] = useState('Pick up to three shares per turn — cheap chains grow, expensive chains pay.');

  const price = (c: { chain: ChainName; size: number }) => getStockPrice(c.chain, c.size);
  const totalSelected = EX3_CHAINS.reduce((s, c) => s + (qty[c.chain] ?? 0), 0);
  const totalCost = EX3_CHAINS.reduce((s, c) => s + (qty[c.chain] ?? 0) * price(c), 0);

  const reset = () => {
    setCash(EX3_START_CASH);
    setQty({});
    setOwned({});
    setStatus('Pick up to three shares per turn — cheap chains grow, expensive chains pay.');
  };

  const change = (c: { chain: ChainName; size: number }, delta: number) => {
    const current = qty[c.chain] ?? 0;
    if (delta > 0) {
      if (totalSelected >= EX3_MAX_PER_TURN) {
        setStatus('The rules cap purchases at 3 shares per turn.');
        return;
      }
      if (totalCost + price(c) > cash) {
        setStatus(`Not enough cash for another ${CHAINS[c.chain].displayName} share.`);
        return;
      }
    } else if (current === 0) {
      return;
    }
    playSfx('ui-click');
    setQty(prev => ({ ...prev, [c.chain]: current + delta }));
  };

  const buy = () => {
    if (totalSelected === 0) return;
    playSfx('buy-stock');
    setCash(prev => prev - totalCost);
    setOwned(prev => {
      const next = { ...prev };
      EX3_CHAINS.forEach(c => { next[c.chain] = (next[c.chain] ?? 0) + (qty[c.chain] ?? 0); });
      return next;
    });
    setStatus(`Bought ${totalSelected} ${totalSelected === 1 ? 'share' : 'shares'} for $${totalCost.toLocaleString()}. In the real game, the turn now passes on.`);
    setQty({});
  };

  return (
    <ExhibitFrame label="Exhibit — the stock phase" onReset={reset}>
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Your cash</p>
          <p className="cash-display">${(cash - totalCost).toLocaleString()}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Shares this turn</p>
          <div className="flex gap-1.5 justify-end">
            {Array.from({ length: EX3_MAX_PER_TURN }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'w-3.5 h-3.5 rounded border transition-colors',
                  i < totalSelected ? 'bg-primary border-primary shadow-glow' : 'border-border bg-background/50',
                )}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        {EX3_CHAINS.map(c => {
          const q = qty[c.chain] ?? 0;
          const plusDisabled = totalSelected >= EX3_MAX_PER_TURN || totalCost + price(c) > cash;
          return (
            <div key={c.chain} className="player-card flex items-center gap-4 !p-3">
              <span className={cn('w-3 h-3 rounded-full shrink-0', `chain-${c.chain}`)} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">
                  {CHAINS[c.chain].displayName}{c.safe && ' ★'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.size} tiles · {CHAINS[c.chain].tier}{c.safe && ' · safe from mergers'}
                </p>
              </div>
              <p className="font-mono text-sm font-semibold whitespace-nowrap">
                ${price(c)} <span className="text-muted-foreground font-normal text-xs">/ share</span>
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={q === 0}
                  onClick={() => change(c, -1)} aria-label={`Remove one ${CHAINS[c.chain].displayName} share`}>
                  <Minus className="w-3.5 h-3.5" />
                </Button>
                <span className="font-mono text-sm font-semibold w-4 text-center">{q}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={plusDisabled}
                  onClick={() => change(c, +1)} aria-label={`Add one ${CHAINS[c.chain].displayName} share`}>
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap mt-4">
        <p className="font-mono font-semibold">Total: ${totalCost.toLocaleString()}</p>
        <Button onClick={buy} disabled={totalSelected === 0}>
          <ShoppingCart className="w-4 h-4 mr-2" />
          Buy shares
        </Button>
      </div>

      {Object.values(owned).some(v => v > 0) && (
        <div className="flex items-center gap-2 flex-wrap mt-4">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Your portfolio</span>
          {EX3_CHAINS.filter(c => (owned[c.chain] ?? 0) > 0).map(c => (
            <span key={c.chain} className="stock-badge bg-secondary border border-border/70">
              <span className={cn('w-2.5 h-2.5 rounded-full', `chain-${c.chain}`)} />
              {CHAINS[c.chain].displayName} × {owned[c.chain]}
            </span>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground mt-3 min-h-[20px]" role="status" aria-live="polite">{status}</p>
    </ExhibitFrame>
  );
};
