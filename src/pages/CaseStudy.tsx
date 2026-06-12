import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SiteFooter, VERSION_HISTORY } from '@/components/SiteFooter';
import { PlaceFoundExhibit, MergerExhibit, StockExhibit } from '@/components/case-study/CaseStudyExhibits';
import { ArrowLeft, ExternalLink, GraduationCap, Play } from 'lucide-react';

/* The story behind Hotel Game — a player-facing version of the portfolio
   case study at jonashapp.com/projects/acquire-game.html. Same exhibits,
   same narrative, rendered natively in the game's own design system. */

const Section = ({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-4">
    <div>
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary mb-2">{kicker}</p>
      <h2 className="text-2xl md:text-3xl">{title}</h2>
    </div>
    {children}
  </section>
);

const BUILD_NOTES: { kicker: string; title: string; body: string }[] = [
  {
    kicker: 'Act 1 · Prototype',
    title: 'A playable engine in a weekend',
    body:
      'The first scaffold came out of Lovable: on January 4th this was an empty Vite/React shell, on January 5th the core engine — founding, mergers, stock trading, scoring — was playable in hot-seat mode.',
  },
  {
    kicker: 'Act 2 · Engineering',
    title: 'User stories as the interface to AI',
    body:
      'Real features were built with Claude Code from written epics and numbered user stories — the custom-rules engine shipped as stories 0 through 9, each specified, implemented and reviewed separately.',
  },
  {
    kicker: 'Act 3 · Hardening',
    title: 'AI as auditor of AI',
    body:
      'A dedicated security audit (remediated across two passes) and a brand & IP audit — which is why this game is called Hotel Game. Reviewing the machine’s work turned out to be the senior skill.',
  },
  {
    kicker: 'Act 4 · In the game',
    title: 'Bots that respect the table',
    body:
      'Server-side bots fill empty seats so two friends can still run a four-player economy. They go through the exact same rules pipeline as humans — and were tuned down from "optimal" to "fun to beat".',
  },
];

const ARCH_ACTS: { name: string; stack: string; note: string; current?: boolean }[] = [
  {
    name: 'Act I — Supabase',
    stack: 'Netlify CDN · Supabase Postgres / Auth / Realtime · Edge Function',
    note: 'Fastest start, but the free tier pauses after 7 idle days. A game that falls asleep is a dead game.',
  },
  {
    name: 'Act II — Split stack',
    stack: 'Netlify Functions · Neon Postgres · Hetzner Socket.IO relay',
    note: 'Always-on, but two providers, two deploys, one debugging headache. Lasted three days in production.',
  },
  {
    name: 'Act III — One box',
    stack: 'Caddy · Hono (REST + Socket.IO, one process) · Postgres 16 · Docker on Hetzner',
    note: 'One server, one deploy, realtime in-process. Boring on purpose — boring is what survives.',
    current: true,
  },
];

const CaseStudy = () => (
  <div className="min-h-screen flex flex-col bg-background">
    <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-8 md:py-12 space-y-14 md:space-y-20">
      {/* Header */}
      <div className="space-y-8">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to lobby
          </Link>
        </Button>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary mb-3">
            The story behind the game
          </p>
          <h1 className="text-4xl md:text-5xl mb-4">
            From a New Year&apos;s ritual to Hotel Game
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            How a board game marathon in a rented vacation house became the site you&apos;re on —
            designed and engineered by one person, with AI in the loop, in five months of evenings.
          </p>
        </div>
      </div>

      {/* Gameplay screenshot */}
      <img
        src="/case-study-gameplay.webp"
        alt="Hotel Game gameplay showing the board with hotel chains, player stocks, and tiles"
        className="w-full rounded-2xl border border-border/60 shadow-lg"
      />

      {/* Story */}
      <Section kicker="Origin" title="Six people, six cities, one board">
        <div className="space-y-4 text-muted-foreground leading-relaxed max-w-2xl">
          <p>
            Between Christmas and New Year, my friends and I rented a house in the middle of nowhere in Denmark.
            One friend brought a piece of family history: a battered copy of the 1964 hotel-empire classic Acquire, &quot;just in case&quot;.
            We played it every single night. Founding chains, forcing mergers, going to bed at 3 a.m.
            calculating who really held the majority.
          </p>
          <p>Ok, that is a little exaggerated, but you get the point. We had lots of fun.</p>
          <p>
            Then January came, and everyone scattered back to their own cities. The group chat kept
            demanding &quot;one more round&quot;. Difficult, as there was no online version of it. 
            So here the idea was born. I built the thing properly: a web version that feels like the
            board on the table — not a spreadsheet with a chat window. With a developer mindset, AI, and the
            heart of a UI/UX Designer.
          </p>
        </div>
      </Section>

      {/* Exhibits */}
      <Section kicker="Try it ①" title="Place a tile, found a chain">
        <p className="text-muted-foreground max-w-2xl">
          Every turn starts the same way: one tile out of your hand, onto its printed coordinate.
          Two touching tiles become a hotel chain — and the founder pockets a free share.
        </p>
        <PlaceFoundExhibit />
      </Section>

      <Section kicker="Try it ②" title="Trigger a merger">
        <p className="text-muted-foreground max-w-2xl">
          The heart of the game: connect two chains and the bigger one swallows the smaller.
          Shareholders of the defunct chain are paid out — then their shares convert.
        </p>
        <MergerExhibit />
      </Section>

      <Section kicker="Try it ③" title="Play the market">
        <p className="text-muted-foreground max-w-2xl">
          Tiles win battles, stocks win the game. Up to three shares per turn; prices climb with
          chain size and tier, and chains with 11+ tiles are safe from being swallowed.
        </p>
        <StockExhibit />
      </Section>

      {/* How it was built */}
      <Section kicker="Behind the scenes" title="One designer, an AI team">
        <div className="grid sm:grid-cols-2 gap-3">
          {BUILD_NOTES.map(n => (
            <div key={n.title} className="player-card space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">{n.kicker}</p>
              <h3 className="text-base font-semibold">{n.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{n.body}</p>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground max-w-2xl text-sm">
          The honest takeaway: AI didn&apos;t remove the design work, it relocated it — from typing
          code to writing specifications, reviewing diffs and owning the architecture. Every generated
          line still had to pass the only test that matters here: five impatient friends on a Sunday call.
        </p>
      </Section>

      {/* Architecture */}
      <Section kicker="Architecture" title="Three acts to boring">
        <div className="grid md:grid-cols-3 gap-3">
          {ARCH_ACTS.map(a => (
            <div
              key={a.name}
              className={`rounded-xl border p-4 space-y-2 ${
                a.current ? 'border-primary/60 shadow-glow' : 'border-border/60'
              }`}
              style={{ background: 'var(--gradient-card)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{a.name}</h3>
                {a.current && (
                  <span className="rounded-full bg-primary/15 text-primary text-[10px] px-1.5 py-0.5">
                    current
                  </span>
                )}
              </div>
              <p className="font-mono text-xs text-foreground/80 leading-relaxed">{a.stack}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{a.note}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Timeline */}
      <Section kicker="Timeline" title="Five months of evenings">
        <div className="space-y-0">
          {[...VERSION_HISTORY].reverse().map(v => (
            <div
              key={v.version}
              className="grid grid-cols-[72px_88px_1fr] max-sm:grid-cols-[72px_1fr] gap-3 py-3 border-b border-border/40 text-sm"
            >
              <span className={`font-mono ${v.current ? 'text-primary font-semibold' : ''}`}>v{v.version}</span>
              <span className="font-mono text-muted-foreground max-sm:hidden">{v.date}</span>
              <span className="text-muted-foreground leading-relaxed">{v.summary}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <section className="rounded-2xl border border-border/60 p-8 text-center space-y-4" style={{ background: 'var(--gradient-card)' }}>
        <h2 className="text-2xl md:text-3xl">The table is set.</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          We still play — same six people, six cities, one board. The bots will happily take a seat
          if you&apos;re short on friends tonight.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Button asChild>
            <Link to="/">
              <Play className="w-4 h-4 mr-2" />
              Play now
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/tutorial">
              <GraduationCap className="w-4 h-4 mr-2" />
              Start with the tutorial
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <a href="https://www.jonashapp.com/projects/acquire-game.html" target="_blank" rel="noopener noreferrer">
              Full case study
              <ExternalLink className="w-3.5 h-3.5 ml-2" />
            </a>
          </Button>
        </div>
      </section>
    </div>
    <SiteFooter />
  </div>
);

export default CaseStudy;
