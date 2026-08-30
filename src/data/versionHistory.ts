/**
 * Single source of truth for the changelog shown on the site.
 *
 * Rendered by the footer's "Version History" dialog (`SiteFooter`) and by the
 * timeline on `/case-study`. The `version` of the top entry must match
 * `package.json`; CI enforces that, and the `/release` skill keeps them in sync.
 *
 * Newest first — the top entry is the current release and carries `current: true`.
 * Entries are prose summaries written for players, not commit dumps: say what
 * changed from the outside, not which files moved.
 */
export type VersionEntry = {
  version: string;
  date: string;
  summary: string;
  current?: boolean;
};

export const VERSION_HISTORY: VersionEntry[] = [
  { version: '1.5.0', date: '2026-08-30', current: true, summary: 'Buying stock no longer ends your turn. You can buy a share, see how the board reacts, and still buy your second and third — the turn now ends only once you have spent all three purchases, or nothing left in the bank is affordable. Ending your turn early with money to spend asks you to confirm first, and warns you if you picked shares but never pressed Buy. Behind the scenes the backend moved fully off its Netlify leftovers, and every change now runs through type-check, lint, tests and a build before it can reach the site.' },
  { version: '1.4.2', date: '2026-06-14', summary: 'Story page overhaul: new interactive Custom House Rules exhibit (board size, starting cash/tiles, turn timer, hidden cash toggles with live rules summary); architecture section renamed and reframed; timeline flipped to latest-first with collapse toggle; "Back to lobby" button moved below the CTA container; package.json version synced to match release versioning.' },
  { version: '1.4.1', date: '2026-06-13', summary: 'Bug fix: bots now stay ready in re-created rooms so a rematch no longer gets stuck. Bot turns are paced (~3s each) with an audible turn-change cue, merger tiles animate one-by-one (~200ms each) once the merger resolves, and the "hotel established" voice line is muted. Home screen polish: larger logo, removed the redundant tutorial card, and a WCAG-readable tutorial button hover. Footer shows the full version history again; the case-study timeline shows the latest 5 with a "show earlier" toggle.' },
  { version: '1.4.0', date: '2026-06-12', summary: 'Enhanced case study page with interactive exhibits (board visualization, clickable tiles, chain founder modal), merger animations in the main game (1-second smooth tile transitions), improved tile highlighting (cyan glow without flicker), and version history expansion ("show more" button).' },
  { version: '1.3.0', date: '2026-06-09', summary: 'Full Hetzner migration: unified Hono + Socket.IO backend (no more Netlify Functions), standard Postgres, in-process WebSocket notifications, Caddy reverse proxy, turquoise theme finalised, Lovable branding removed, and improved merger stock decision UI (tick marks, numeric labels, post-trade portfolio preview).' },
  { version: '1.2.0', date: '2026-06-09', summary: 'Game-over → lobby fix, idle-room auto-cleanup (closes rooms after 10 min), site footer (About / Imprint / Version History), hidden login, lobby background image, and a green/turquoise theme system.' },
  { version: '1.1.0', date: '2026-06-08', summary: 'Sound-effects & music system, small-board rule set, automatic buy-phase completion, header reorder, and AI-bot tuning.' },
  { version: '1.0.0', date: '2026-06-06', summary: 'Production backend migration: Supabase → Netlify DB (Neon) + a Hetzner Socket.IO relay. Added AI bots and game branding.' },
  { version: '0.11.0', date: '2026-02-22', summary: 'Security remediation across two audit passes and a brand / IP naming-compliance review.' },
  { version: '0.10.0', date: '2026-02-19', summary: 'Server-enforced custom-rules engine: turn timer, chain safety, cash visibility, bonus tiers, board size, chain founding, and starting conditions.' },
  { version: '0.9.0', date: '2026-02-17', summary: 'Custom-rules UI: full rules flow, scrollable settings panel, and refined defaults.' },
  { version: '0.8.0', date: '2026-02-09', summary: 'Game rejoin / reconnect (localStorage + name matching) and broad game-UI polish.' },
  { version: '0.7.0', date: '2026-02-08', summary: 'Interactive tutorial, online-lobby redesign, Vitest test suite, and single-click tile placement.' },
  { version: '0.6.0', date: '2026-02-04', summary: 'Ready-to-start system replacing host-only game start; Netlify routing fixes.' },
  { version: '0.5.0', date: '2026-02-01', summary: 'Tile-discard for unplayable hands and the initial Netlify deployment configuration.' },
  { version: '0.4.0', date: '2026-01-31', summary: 'Supabase backend + local development; anonymous room joining; waiting-room UI.' },
  { version: '0.3.0', date: '2026-01-25', summary: 'Online-multiplayer foundation: lobby, auth & profiles, a secure server action layer, realtime sync, race-safe joins, and opponent-data masking.' },
  { version: '0.2.0', date: '2026-01-05', summary: 'Core game engine: chain founding, mergers, stock trading, and end-game scoring.' },
  { version: '0.1.0', date: '2026-01-04', summary: 'Initial Hotel Game frontend scaffold (Vite + React + TypeScript + Tailwind + shadcn/ui).' },
];
