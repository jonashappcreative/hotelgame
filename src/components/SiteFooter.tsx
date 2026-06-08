import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

const OWNER_NAME = 'Jonas Happ';
const CONTACT_EMAIL = 'jonashapp.business@gmail.com';
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
      'Netlify Functions (serverless, Node 20)',
      'jose (JWT auth), bcryptjs (password hashing)',
    ],
  },
  {
    group: 'Database',
    items: ['Neon — Serverless Postgres (via Netlify DB)'],
  },
  {
    group: 'Infrastructure',
    items: [
      'Hetzner — WebSocket relay server (Express + Socket.IO)',
      'Netlify — hosting, serverless functions & continuous deploy',
    ],
  },
  {
    group: 'Testing',
    items: ['Vitest + Testing Library'],
  },
];

const CREDITS: { role: string; by: string }[] = [
  { role: 'Logo & Favicon', by: 'ChatGPT (OpenAI)' },
  { role: 'UI design', by: 'Lovable' },
  { role: 'Backend & Server', by: 'Claude Code (Anthropic)' },
  { role: 'Server hosting', by: 'Hetzner' },
  { role: 'Deployment', by: 'Netlify' },
  { role: 'Database', by: 'Neon' },
];

export const SiteFooter = () => {
  const [open, setOpen] = useState<null | 'about' | 'imprint'>(null);

  return (
    <footer className="w-full border-t border-border/50 mt-8">
      <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>© {CURRENT_YEAR} {OWNER_NAME}</span>
        <nav className="flex items-center gap-4">
          <button
            onClick={() => setOpen('about')}
            className="hover:text-foreground transition-colors"
          >
            About
          </button>
          <button
            onClick={() => setOpen('imprint')}
            className="hover:text-foreground transition-colors"
          >
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
              An online multiplayer adaptation of the classic hotel-empire
              board game — place tiles, found chains, trade stocks, trigger
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
                Sample Street 1
                <br />
                12345 Sample City
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
              <p className="text-muted-foreground leading-relaxed">
                This is sample placeholder content. Despite careful review, no
                liability is assumed for the accuracy, completeness, or
                timeliness of the information provided. External links point to
                third-party content for which the respective operators are
                solely responsible.
              </p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </footer>
  );
};
