import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const OWNER_NAME = 'Jonas Happ';
const CONTACT_EMAIL = 'hello@jonashapp.com';
const CURRENT_YEAR = new Date().getFullYear();

// Grouped so the About dialog stays readable and is trivial to extend.
const TECH_STACK: { group: string; items: string[] }[] = [
  {
    group: 'Frontend',
    items: [
      'React 18 + TypeScript',
      'Vite (build tooling)',
      'Tailwind CSS + shadcn/ui (Radix UI)',
      'React Router, TanStack Query',
      'Framer Motion (animation), Howler.js (audio)',
      'React Hook Form + Zod, Lucide icons',
    ],
  },
  {
    group: 'Realtime',
    items: ['Socket.IO (browser client + Node relay)'],
  },
  {
    group: 'Backend',
    items: [
      'Hono (Node 20, REST API + WebSocket in one process)',
      'jose (JWT auth), bcryptjs (password hashing)',
    ],
  },
  {
    group: 'Database',
    items: ['Postgres 16 (Docker)'],
  },
  {
    group: 'Infrastructure',
    items: [
      'Hetzner — VPS hosting (Docker Compose: Caddy + backend + Postgres)',
      'Caddy — TLS termination, reverse proxy, static file serving',
    ],
  },
  {
    group: 'Testing',
    items: ['Vitest + Testing Library'],
  },
];

const CREDITS: { role: string; by: string }[] = [
  { role: 'Logo & Favicon', by: 'ChatGPT (OpenAI)' },
  { role: 'Backend & Server', by: 'Claude Code (Anthropic)' },
  { role: 'Server hosting', by: 'Hetzner' },
];

// Development timeline mapped from the git history. Newest first; the top entry
// is the current release. Also rendered on the /case-study page.
export const VERSION_HISTORY: { version: string; date: string; summary: string; current?: boolean }[] = [
  { version: '1.4.1', date: '2026-06-13', current: true, summary: 'Bug fix: bots now stay ready in re-created rooms so a rematch no longer gets stuck. Bot turns are paced (~3s each) with an audible turn-change cue, merger tiles animate one-by-one (~200ms each) once the merger resolves, and the "hotel established" voice line is muted. Home screen polish: larger logo, removed the redundant tutorial card, and a WCAG-readable tutorial button hover. Footer shows the full version history again; the case-study timeline shows the latest 5 with a "show earlier" toggle.' },
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

export const SiteFooter = () => {
  const [open, setOpen] = useState<null | 'about' | 'imprint' | 'versions'>(null);

  const linkClass = 'hover:text-foreground transition-colors';

  return (
    <footer className="w-full border-t border-border/50 mt-8">
      <div className="max-w-5xl mx-auto px-4 py-4 grid grid-cols-1 sm:grid-cols-3 items-center gap-2 text-xs text-muted-foreground">
        <span className="text-center sm:text-left order-3 sm:order-1">
          © {CURRENT_YEAR} {OWNER_NAME}
        </span>

        <div className="hidden sm:block order-2" />

        <nav className="flex items-center justify-center sm:justify-end gap-4 order-2 sm:order-3">
          <Link to="/case-study" className={linkClass}>
            The Story
          </Link>
          <button onClick={() => setOpen('about')} className={linkClass}>
            About
          </button>
          <button onClick={() => setOpen('versions')} className={linkClass}>
            Version History
          </button>
          <button onClick={() => setOpen('imprint')} className={linkClass}>
            Imprint
          </button>
        </nav>
      </div>

      {/* About */}
      <Dialog open={open === 'about'} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>About this game</DialogTitle>
            <DialogDescription>
              An online game inspired by the board game classic "Acquire"
              — place tiles, found chains, trade stocks, trigger
              mergers, and finish with the greatest fortune.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[55vh] pr-4">
            <div className="space-y-5 text-sm">
              <section>
                <h3 className="font-semibold mb-2">Tech stack</h3>
                <div className="space-y-3">
                  {TECH_STACK.map((s) => (
                    <div key={s.group}>
                      <p className="text-xs font-medium text-primary uppercase tracking-wide">
                        {s.group}
                      </p>
                      <ul className="mt-1 list-disc list-inside text-muted-foreground space-y-0.5">
                        {s.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="font-semibold mb-2">Credits</h3>
                <ul className="space-y-1">
                  {CREDITS.map((c) => (
                    <li key={c.role} className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{c.role}</span>
                      <span className="font-medium text-right">{c.by}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <p className="text-xs text-muted-foreground">
                Acquire is a trademark of its respective owner. This is a
                non-commercial, fan-made project for educational purposes and is
                not affiliated with or endorsed by the rights holders.
              </p>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Version History */}
      <Dialog open={open === 'versions'} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Development milestones, newest first. Current release:{' '}
              <span className="font-mono text-primary">
                v{VERSION_HISTORY[0].version}
              </span>
              .
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[50vh] pr-4 border border-border/40 rounded-lg">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Version</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Date</th>
                  <th className="py-2 font-medium">Changes</th>
                </tr>
              </thead>
              <tbody>
                {VERSION_HISTORY.map((v) => (
                  <tr key={v.version} className="border-b border-border/50 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap font-mono">
                      <span className={cn(v.current && 'text-primary font-semibold')}>
                        v{v.version}
                      </span>
                      {v.current && (
                        <span className="ml-2 rounded-full bg-primary/15 text-primary text-[10px] px-1.5 py-0.5 align-middle">
                          current
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground font-mono">
                      {v.date}
                    </td>
                    <td className="py-2 text-muted-foreground">{v.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Imprint */}
      <Dialog open={open === 'imprint'} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Imprint</DialogTitle>
            <DialogDescription>
              Information pursuant to applicable disclosure requirements.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <section>
              <h3 className="font-semibold mb-1">Responsible for content</h3>
              <p className="text-muted-foreground leading-relaxed">
                {OWNER_NAME}
                <br />
                Weidplan 82
                <br />
                22523 Hamburg
                <br />
                Germany
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">Contact</h3>
              <p className="text-muted-foreground">
                Email:{' '}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">
                  {CONTACT_EMAIL}
                </a>
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">Disclaimer</h3>
              <div className="text-muted-foreground leading-relaxed space-y-2 text-xs">
                <p>
                  This web application is provided "as-is" without warranties of any kind, including fitness for a particular purpose. The application relies on real-time communication via WebSocket (Socket.IO) and may experience temporary unavailability due to server maintenance, network issues, or infrastructure constraints.
                </p>
                <p>
                  Game sessions are stored in a PostgreSQL database. User data is retained only as necessary for gameplay and is not sold to third parties. No liability is assumed for loss of game sessions, data corruption, or service interruptions.
                </p>
                <p>
                  The application is hosted on Hetzner Cloud infrastructure and uses Caddy for TLS termination and reverse proxying. Third-party services are used solely to maintain operations and comply with their respective terms of service.
                </p>
                <p>
                  "Acquire" is a trademark of its respective owner. This is a non-commercial, fan-made project for educational and recreational purposes and is not affiliated with or endorsed by the rights holders.
                </p>
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </footer>
  );
};
