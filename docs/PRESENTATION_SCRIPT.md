# From Tabletop to Browser — Building *Acquire* Online

**A 30-minute talk: how a UX designer shipped a real-time multiplayer game.**

Audience: ~40 people, mixed technical / non-technical.
Tone: storytelling, but technically honest. Show the expertise *and* the scars.

---

## Timing map (30:00 total)

| # | Section | Slide(s) | Time | Running |
|---|---|---|---|---|
| 0 | Who I am | 1 | 2:00 | 2:00 |
| 1 | The idea (Louisa & the board game) | 2 | 2:00 | 4:00 |
| 2 | Writing it down: the PRD | 3 | 2:00 | 6:00 |
| 3 | Planning with Claude & co. | 4 | 2:00 | 8:00 |
| 4 | Building with Lovable | 5 | 2:30 | 10:30 |
| 5 | **The architecture puzzle (build-up)** | 6 | 5:30 | 16:00 |
| 6 | Two migrations: why I moved house twice | 7 | 3:30 | 19:30 |
| 7 | Don't be afraid (the toolbox + fuck-ups) | 8 | 3:00 | 22:30 |
| 8 | The nasty edge cases (UX under failure) | 9 | 2:30 | 25:00 |
| 9 | **Live demo** | 10 | 3:00 | 28:00 |
| 10 | Wrap-up: what I'd tell past-me | 11 | 2:00 | 30:00 |

> Tip: rehearse with a timer. The architecture slide is the heart — if you're
> running late, cut from sections 6–7, never from 5.

---

## Section 0 — Who I am  *(2:00)*

**Slide 1** — Your photo, name, one line: *"UX Designer who codes (a bit)."*

**Say:**

> Hi, I'm Jonas. By trade I'm a **UX designer** — I think in flows, edge cases,
> and "what happens when the user does the thing you didn't plan for."
>
> I also write code. Not as a senior engineer — I want to be honest about that —
> but enough to be **dangerous**: enough to read a stack trace, open a terminal,
> SSH into a server, and not panic when something is on fire. Over the last few
> months I built and shipped a **real-time, multiplayer online board game**, end
> to end: the frontend, the backend, the database, the server it runs on, the
> domain, the TLS certificate. All of it.
>
> This talk is the story of how a designer with *limited but real* coding
> experience did that — and crucially, **how the AI tools changed what "limited
> experience" even means** in 2026. I'll show you the architecture, the tools, and
> the mistakes. Especially the mistakes.

**Beat:** Set the contract with the room — *"You don't need to be an engineer to
follow this. And if you are one, I promise there's real plumbing in here."*

---

## Section 1 — The idea  *(2:00)*

**Slide 2** — Photo of the physical *Acquire* board game (tiles, hotel chains,
play money). Friend's name: **Louisa**.

**Say:**

> It started, like a lot of good things, at a table with friends. My friend
> **Louisa** is the one who put the box in front of me — a 1960s board game called
> **Acquire**. You place tiles on a grid, those tiles found **hotel chains**, you
> buy **stock** in the chains, and when two chains touch, they **merge** — the
> bigger one swallows the smaller, shareholders get paid out, and there's this
> beautiful moment of negotiation and greed. It's basically a tiny **stock market**
> on a board.
>
> We loved it. But we couldn't always be in the same room. And the digital
> versions out there were… not nice to look at. As a UX person that physically
> hurt me. So I had the classic dangerous thought: *"How hard could it be?"*
>
> That question is the whole talk.

**Beat:** This is your emotional hook. Keep it warm and short. The board game is
the "before"; the browser is the "after."

---

## Section 2 — Writing it down: the PRD  *(2:00)*

**Slide 3** — A screenshot of the **Product Requirement Document** (blurred is
fine), with 3–4 bullet headers pulled out big.

**Say:**

> Here's where the designer instinct kicked in. Before writing a single line of
> code, I wrote a **Product Requirement Document** — a PRD. Not because a process
> told me to, but because I'd learned that **the cost of a wrong assumption is
> lowest on paper.**
>
> The PRD answered the boring-but-load-bearing questions: What *is* the product?
> Local hot-seat on one device, **and** online with friends on separate devices?
> (Both.) How many players? What happens when someone leaves mid-game? What's in
> scope for v1, and — just as important — what's deliberately *not*?
>
> This document later became the thing I handed to the AI. A vague prompt gives
> you vague software. A PRD gives the model the same context I'd give a human
> engineer. **The clearer the spec, the better the machine — that's a UX principle
> and a prompting principle at the same time.**

**Beat:** Land the reusable idea: *spec quality = output quality*, for humans
and models alike.

---

## Section 3 — Planning with Claude & co.  *(2:00)*

**Slide 4** — Split screen: PRD on the left, an **Implementation Plan** (markdown
with phases/checkboxes) on the right. Logos: Claude, etc.

**Say:**

> From the PRD I worked **with Claude** — and a couple of other models — to turn
> "what" into "how." We wrote **implementation plans**: documents that break the
> work into phases, each with a definition of done.
>
> This is the part people underestimate. I wasn't asking the AI "write me a game."
> I was using it as a **thinking partner and a junior engineer at the same time**:
> "Here's the architecture, here's the constraint, what are the trade-offs?" Then I
> made the call, wrote it down as a plan, and we executed against it phase by phase.
>
> My repo is full of these — migration plans, infra setup guides, user stories,
> even a checklist for "is this safe to deploy?" The AI didn't replace the
> engineering judgement. It **compressed the distance** between "I have a decision"
> and "the decision is implemented correctly." For someone with limited coding
> time, that compression is the entire game.

**Beat:** Distinguish *vibe-prompting* from *spec-driven AI development*. You did
the latter. That's the expertise signal.

---

## Section 4 — Building with Lovable  *(2:30)*

**Slide 5** — Lovable screenshot → arrow → a clean React UI screenshot. Small
caption: *React · TypeScript · Vite · Tailwind · shadcn/ui*.

**Say:**

> For the frontend I built with **Lovable** — an AI app builder that generates a
> real **React + TypeScript** codebase. Not a toy, not a no-code black box: actual
> components, actual files, committed straight to **GitHub.** And that detail
> matters, because it meant I was never trapped. The moment Lovable couldn't do
> something, I could open the same repo in my own editor and fix it by hand.
>
> The stack under the hood: **React 18, TypeScript, Vite** as the build tool,
> **Tailwind** and **shadcn/ui** for styling. As a designer this was paradise — I
> could go from a UX idea to a clickable, animated interface fast, and still drop
> down into the code for the pixel-level and behaviour-level details that AI
> defaults get wrong.
>
> So the division of labour became: **AI for velocity, me for taste and
> correctness.** Lovable got me 80% of a screen in minutes; the last 20% — the
> empty states, the disabled-button logic, the "what does this look like while
> you wait" — that's the UX work, and that stayed human.

**Beat:** Reassure non-tech folks (it's visual, fast) *and* tech folks (it's a
real repo, you can eject). The 80/20 line is quotable.

---

## Section 5 — THE ARCHITECTURE PUZZLE  *(5:30)*  ★ centerpiece

> **This is one slide that builds up in layers (animation / click-through).**
> Reveal one box at a time. Each reveal = one sentence about *what sits where* and
> *how it talks to the next thing*. Keep a consistent visual language: boxes =
> things that run, arrows = how they communicate, and label every arrow with its
> **protocol**.

### Build order (each bullet = one click)

**Layer 1 — The player.**
> Everything starts with a person in a **browser**. No app to install. Just a URL.

```
[ 🧑 Browser ]
```

**Layer 2 — The frontend (what they see).**
> The browser downloads a **React single-page app** — HTML, JavaScript, CSS. This
> is the whole UI: the board, the tiles, the animations. It's *just files*, served
> to the browser. At this point nothing is multiplayer yet — it's a pretty client
> with no brain.

```
[ 🧑 Browser ] ⟵ HTML/JS/CSS ⟵ [ 🌐 React SPA (static files) ]
```

**Layer 3 — The brain (game logic).**
> The rules of Acquire — whose turn it is, can you afford this stock, did two
> chains just merge — live on the **server**, not in the browser. Why? Because the
> browser belongs to the player, and **you can never trust the player's computer.**
> The server is the **single source of truth** and the **referee.**

```
[ 🧑 Browser ] ⟷ HTTPS / REST ⟷ [ 🧠 Backend API  (game rules) ]
```

> When you buy stock, your browser doesn't *do* the buy. It **asks** the server:
> *"I'd like to buy 3 shares."* The server checks the rules, and only the server
> decides what actually happened.

**Layer 4 — Memory (the database).**
> The server needs to *remember* — every room, every player's cash, the board, the
> tile bag. That's the **database**: a **PostgreSQL** database. It's the long-term
> memory. If every server restarted tomorrow, the games would still be there.

```
[ 🧠 Backend API ] ⟷ SQL ⟷ [ 🗄️ PostgreSQL DB ]
```

> **One anti-cheat detail engineers will appreciate:** the bag of future tiles and
> *other* players' hands live in the DB, but they must **never** reach your
> browser — or you could cheat by reading the network traffic. So the database
> exposes **"public" views** that strip those secret columns out. The browser is
> only ever allowed to see the sanitized version.

**Layer 5 — The heartbeat (real-time).**
> Here's the multiplayer magic. When I make a move, **how does *your* screen
> update?** HTTP can't do that on its own — the server can't phone the browser.
> So there's a second channel: a **WebSocket** — a permanent, two-way line held
> open between every browser and the server, using **Socket.io.**

```
[ 🧑 Browser ] ⟸ WSS (WebSocket) ⟸ [ 📡 Real-time relay ]
```

> The flow is elegant: I buy stock → server validates and saves it → server fires
> a tiny **"hey, something changed in room X"** ping over the WebSocket to everyone
> in that room → each browser hears the ping and **re-fetches** the fresh state.
> The WebSocket doesn't carry the game data — it just carries the *nudge.* That
> keeps it dumb, cheap, and disposable.

**Layer 6 — The doorway (reverse proxy + TLS).**
> All of this is wrapped by **Caddy**, a reverse proxy. It's the front door: it
> terminates **HTTPS** (the padlock in the address bar), automatically gets and
> renews the **TLS certificate** for free, and routes traffic — *"`/api` goes to
> the backend, `/socket.io` goes to the WebSocket, everything else is the
> website."*

```
                    ┌──────────── 🖥️ One Hetzner server ─────────────┐
[ 🧑 Browser ] ⟷ 🔒 │ [ Caddy ]→[ Backend API ]→[ PostgreSQL ]        │
                    │            └→[ Socket.io relay ]                │
                    └────────────────────────────────────────────────┘
```

**Layer 7 — Where it physically lives.**
> And all of it runs on **one server I rent from Hetzner**, a German cloud host —
> a single Linux machine. The backend, the database, the real-time relay, the web
> server: each one runs in its own **Docker container**, and **Docker Compose**
> starts them together with one command. The domain comes via **All-Inkl** /
> **`jonashapp.com`** DNS, pointing at that server's IP.

### The full picture (final reveal)

```
                        ┌─────────────────────────────────────────────┐
   🧑 Browser  ⟷  🔒   │   🖥️  Hetzner server (Ubuntu + Docker)        │
   (React SPA)         │                                               │
        │              │   [ Caddy ]  ──/api──▶ [ Backend API (Hono) ] │
        │  HTTPS/REST   │      │                       │               │
        ├──────────────┼──────┘        SQL ───────────┤               │
        │              │      │                        ▼               │
        │  WSS          │      └──/socket.io──▶ [ Socket.io ]          │
        └──────────────┼─────────────────▶            │               │
                        │                  [ 🗄️ PostgreSQL ]            │
                        └─────────────────────────────────────────────┘
              DNS: jonashapp.com (All-Inkl) ──▶ Hetzner IP
```

**Close the slide:**

> So that's the whole machine. A person, a website, a referee, a memory, a
> heartbeat, a front door — and a single rented computer to hold them all. **None
> of these boxes is magic.** Each one does exactly one job, and the arrows between
> them are just three ideas: *fetch data, save data, notify of change.* If you
> understand this slide, you understand the entire system.

**Beat:** This is your *demonstrate-expertise* moment. Slow down. The payoff line
is "the arrows are just three ideas." That makes a scary diagram feel human.

---

## Section 6 — Two migrations: why I moved house twice  *(3:30)*

**Slide 7** — Three columns / a timeline: **v1 Supabase → v2 Split → v3 Unified.**

**Say:**

> Here's the honest part: the architecture I just showed you is **version three.**
> I rebuilt the backend **twice.** Let me tell you why — because the *reasons* are
> the real lesson.
>
> **Version 1 was Supabase.** Supabase is wonderful — it hands you a Postgres
> database, authentication, and real-time updates in an afternoon. Perfect for
> getting started. But the free tier **pauses your whole project after 7 days of
> inactivity.** For a game my friends play on weekends, that's fatal — they'd open
> it Friday night and the backend would be asleep.
>
> **Version 2** split Supabase into its parts: the database moved to **Netlify
> DB** (Neon Postgres), I wrote my **own authentication** from scratch — JSON Web
> Tokens, signed and verified, passwords hashed with bcrypt — and I stood up a
> dedicated **real-time relay on a Hetzner server** in Docker. This taught me a
> ton, but now I had pieces in *three* different companies' clouds, and the
> complexity of keeping them in sync was its own tax.
>
> **Version 3 — where it is today — I pulled everything onto one Hetzner box.**
> One server runs the API, the database, and the real-time relay together. It's
> cheaper, it never sleeps, it's all under my control, and the whole thing is
> **one `docker compose up` away** from running on any machine, including my
> laptop.
>
> The lesson isn't "Supabase bad, Hetzner good." The lesson is: **you don't have
> to get the architecture right the first time. You're allowed to outgrow your
> tools.** Each version shipped. Each version taught me what the next one needed.

**Beat:** Reframe rewrites as maturity, not failure. The "you're allowed to
outgrow your tools" line is for the whole room — designers, founders, engineers.

---

## Section 7 — Don't be afraid (the toolbox + fuck-ups)  *(3:00)*

**Slide 8** — A grid of intimidating words, each with a one-line demystifier.
Reveal them, then "x out" the fear.

| Scary word | What it actually is |
|---|---|
| **Terminal** | A text box that runs commands. That's it. |
| **SSH** | Opening that text box *on a computer far away.* |
| **Git / branches** | Save points. A branch is a parallel save you can throw away. |
| **SQL** | Asking the database questions in almost-English. |
| **Docker** | A lunchbox that ships an app with everything it needs to run. |
| **Browser console** | The browser's "what's really going on" panel (press F12). |
| **HTML** | The nouns of a web page. The structure. |
| **Server** | Someone else's computer that's always on. |

**Say:**

> If you're non-technical, this slide is the one I want you to remember. Every word
> here used to scare me. None of them do now — and not because I'm a genius, but
> because each one is **smaller than its reputation.**
>
> A **terminal** is just a text box that runs commands. **SSH** is opening that
> same text box, but on a computer sitting in a German data centre — I type, and
> it runs *there.* **Git branches** are save points in a video game: I make a
> branch, try something reckless, and if I break it, I throw the branch away and
> I'm back to safety. **Docker** is a lunchbox — it packs the app with everything
> it needs so it runs the same on my laptop and on the server.
>
> Now the fuck-ups, because you came for those. *(Pick 2 of these and tell them as
> quick stories — they're more fun spoken than read.)*
>
> - **The deploy that pushed to `main`.** I learned the hard way that pushing to
>   `main` **auto-deploys to the live site.** So I now have a rule written down for
>   myself and my AI assistant: `main < staging < develop < feature branches` —
>   nothing reaches players until it's been tested one layer down. The fix wasn't
>   technical. It was **process.**
> - **CORS — the two-hour gremlin.** The frontend and backend lived on different
>   domains, and the browser silently **blocked** them from talking for security
>   reasons. No crash, just… nothing happened. Two hours in the browser console
>   later: I had to explicitly tell the server *"this website is allowed to talk
>   to you."* One line of config.
> - **Secrets that almost got committed.** Netlify's secret-scanner caught me about
>   to publish a key to the repo. Now secrets live in **environment variables**,
>   never in code. (`openssl rand -hex 32` is my friend.)
>
> The meta-lesson: **nothing here is fragile in a way that can hurt you, if you
> have backups and save points.** Branches, databases, containers — they all let
> you break things *safely.* Fear comes from thinking one wrong command ends the
> world. It almost never does.

**Beat:** This is the emotional core for the non-technical half. Tell the
fuck-ups with a smile. Vulnerability + recovery = trust.

---

## Section 8 — The nasty edge cases (UX under failure)  *(2:30)*

**Slide 9** — Three "what if…" cards: **Disconnect**, **Rejoin**, **Auth/identity**.

**Say:**

> Now back to my home turf: UX. Anybody can design the happy path. The craft is in
> the moments where things **go wrong** — and in multiplayer, things go wrong
> constantly. Phones lock. Wi-Fi drops. People rage-refresh.
>
> **"What if someone disconnects mid-game?"** In a turn-based game, one frozen
> player **blocks everyone.** So every browser sends a quiet **heartbeat** every
> few seconds. Miss a few beats and the others see *"Louisa is reconnecting…"* —
> the game doesn't freeze in confusion, it **names** what's happening.
>
> **"What if they refresh during their own turn — mid-merger decision?"** They
> should land **back exactly where they were**, dialog open, money intact. That
> only works because the truth lives on the **server**, not in the tab they just
> nuked. The browser is disposable; the game state is not. *(Callback to the
> architecture slide — this is why that design choice mattered.)*
>
> **"What if a logged-in player rejoins from their phone instead of their laptop?"**
> They should slot back into **their** seat — same cash, same stock. But an
> **anonymous** guest who clears their browser? That identity is genuinely gone,
> so the honest UX is to **say so clearly** and offer: *"Make an account so this
> doesn't happen again."* A good error doesn't hide the problem — it gives you the
> next step.
>
> This is the unglamorous 20% I mentioned earlier. The AI will never write it for
> you, because it requires asking *"what's the worst moment for this user, and how
> do I make it survivable?"* **That question is the job.**

**Beat:** Tie UX directly back to architecture. This is where designer + engineer
fuse — your unique angle. Land "that question is the job."

---

## Section 9 — LIVE DEMO  *(3:00)*

**Slide 10** — Minimal: just the URL big on screen, as a safety net.

> **Have this pre-staged. Two browser windows already open and logged in. Rehearse
> the exact clicks. A 3-minute demo has no room to fumble.**

**Demo run-sheet (narrate as you click):**

1. **(0:00)** "This is live, on my own server, right now." — show the lobby.
2. **(0:25)** Create a room → read out the **room code.**
3. **(0:45)** Switch to window two → join with the code. *"Two separate players."*
   Point at window one — *"notice it updated instantly. That's the WebSocket."*
4. **(1:15)** Start the game. Place a tile → **found a hotel chain** → watch it
   appear on both screens.
5. **(1:50)** Buy some stock. Narrate: *"my browser asked the server, the server
   checked the rules, saved it, and pinged the other player."*
6. **(2:15)** **The money shot:** trigger (or pre-arrange) a **merger** — two
   chains touch, payouts happen. *"This is the moment the whole game exists for."*
7. **(2:40)** Optional flex: open the **browser console (F12)**, show the
   `game:state_updated` event arriving. *"That's the heartbeat from the last
   slide, live."*

**Fallback:** If anything fails live, have a **30-second screen recording** of the
exact same flow ready to drop in. Never debug on stage. *"And here's one I
prepared earlier."*

---

## Section 10 — Wrap-up: what I'd tell past-me  *(2:00)*

**Slide 11** — 3–4 takeaways, big text. End with a thank-you + the URL + Louisa.

**Say:**

> Three things I'd tell the version of me who started this.
>
> **One — a clear spec beats clever code.** The PRD and the implementation plans
> did more for this project than any single smart trick. Whether you're briefing a
> human or an AI, **clarity is the multiplier.**
>
> **Two — the AI didn't replace the thinking, it replaced the *distance.*** I still
> made every architectural decision. The tools just collapsed the gap between
> deciding and doing — which is exactly what lets one designer ship a full-stack
> multiplayer game in his spare time. That's genuinely new.
>
> **Three — you're allowed to not know yet.** I didn't know what SSH was. I do now.
> I rebuilt the backend twice. Every scary word on that toolbox slide was learned
> *while* building, in public, breaking things on save points. **You don't need
> permission or a title to build the thing. You need a save point and the nerve to
> press the button.**
>
> It started with Louisa putting a board game on a table. It ends — for now — with
> a thing my friends play from anywhere in the world. Thank you.
>
> *(URL on screen.)* Try it. Break it. Tell me what you find.

**Beat:** Callback to Louisa closes the loop you opened in Section 1. End on the
invitation — confident, generous, not salesy.

---

## Appendix A — One-line answers for Q&A

- **"Why not just use Unity / a game engine?"** It's a turn-based board game, not
  an action game — the browser is the perfect, install-free platform, and my UX
  skills transfer directly to the web.
- **"Is it secure?"** The server is the only thing that touches the database;
  the browser never holds DB credentials; secrets are in environment variables;
  auth is signed JWTs with bcrypt-hashed passwords; TLS everywhere via Caddy.
- **"What about cheating?"** Future tiles and opponents' hands never leave the
  server — the database serves "public" views that strip secret columns.
- **"How much did it cost?"** One small Hetzner VPS (a few euros a month) plus a
  domain. That's it.
- **"Did the AI write all of it?"** No. The AI wrote a lot of the *first draft* of
  each piece. I wrote the spec, made the architecture calls, and did the edge-case
  and UX work by hand. AI for velocity, me for taste and correctness.
- **"Could you do this for a client / product?"** Yes — same pattern (static
  frontend + authoritative API + Postgres + real-time + one server) scales to a
  lot of products.

## Appendix B — Glossary card for the non-technical half (optional handout)

- **Frontend** — the part you see and click (runs in your browser).
- **Backend** — the part you don't see; enforces the rules (runs on a server).
- **Database** — the long-term memory; remembers everything between sessions.
- **API** — the menu of requests the frontend is allowed to make to the backend.
- **WebSocket** — a permanent open line so the server can nudge the browser the
  instant something changes.
- **Reverse proxy (Caddy)** — the front door that handles HTTPS and routes traffic.
- **Docker** — packaging so an app runs identically everywhere.
- **DNS** — the phone book that turns `jonashapp.com` into a server's address.

---

## Production notes (for you, not the audience)

- **Slide count:** 11 content slides + demo. Keep words on slides *minimal* — the
  script is what you say, not what you show.
- **The build-up slide (5)** is the only animated one. Build it as 7 click states.
  If your tool supports it, keep prior layers dimmed (not gone) so the picture
  accumulates.
- **Rehearse the demo 3×** and record the fallback video *today*, not the night
  before.
- **Two-audience trick:** every technical claim is immediately followed by a plain
  metaphor (referee, memory, heartbeat, front door, lunchbox, save point). Tech
  folks get the term; everyone else gets the picture. Never make them choose.
- **Cut lever:** if over time, drop Appendix demos and trim Section 6 to two
  sentences. Protect Sections 5, 8, and the demo.
</content>
</invoke>
