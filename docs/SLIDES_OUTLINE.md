# Slides Outline — *From Tabletop to Browser*

On-screen text only (speaker notes live in `PRESENTATION_SCRIPT.md`).
Keep words minimal — the slide is the headline, you are the paragraph.
Architecture build-up images: `docs/slides/architecture-1.svg … architecture-7.svg`
(PNG versions alongside for Keynote/PowerPoint).

---

### Slide 1 — Title / Who I am
- **From Tabletop to Browser**
- Building *Acquire* as a real-time online game
- Jonas — *UX Designer who codes (a bit)*
- [your photo]

### Slide 2 — The idea
- It started at a table, with **Louisa**
- *Acquire* (1962): place tiles → found hotel chains → buy stock → chains **merge**
- "A tiny stock market on a board"
- "How hard could it be?"
- [photo of the physical board game]

### Slide 3 — Write it down first
- **Product Requirement Document (PRD)**
- Local hot-seat **and** online multiplayer
- In scope / out of scope for v1
- *The cost of a wrong assumption is lowest on paper*
- → The PRD became the brief I handed to the AI

### Slide 4 — Plan with AI
- From **"what"** (PRD) → **"how"** (Implementation Plans)
- Phased plans, each with a definition of done
- AI as **thinking partner + junior engineer** — I make the call
- *Spec-driven, not vibe-prompted*

### Slide 5 — Build the UI with Lovable
- **Lovable** → a real React + TypeScript repo (committed to GitHub)
- Stack: **React 18 · TypeScript · Vite · Tailwind · shadcn/ui**
- Never trapped: I can eject into my own editor anytime
- **AI for velocity · me for taste & correctness** (the last 20%)

### Slide 6 — The architecture *(build-up: 7 clicks)*
> Use `architecture-1 … architecture-7`, one per click.
1. **Browser** — the player. Just a URL.
2. **React SPA** — the UI is *just files* (HTML/JS/CSS).
3. **Backend API** — the rules & referee. *Never trust the client.*
4. **PostgreSQL** — the memory. (+ "public" views hide secret tiles = anti-cheat)
5. **Socket.io** — the heartbeat. Pushes *"something changed"* → browsers refetch.
6. **Caddy** — the front door. HTTPS/TLS + routing (`/api`, `/socket.io`, website).
7. **One Hetzner server** — Docker Compose; DNS via All-Inkl.
- *Closing line: the arrows are just three ideas — fetch, save, notify.*

### Slide 7 — I moved house twice
- **v1 — Supabase**: fast start… but free tier **sleeps after 7 days**
- **v2 — Split**: Netlify DB + my own **JWT auth** + Hetzner relay (3 clouds)
- **v3 — Unified Hetzner**: one box, `docker compose up`, never sleeps, full control
- *You're allowed to outgrow your tools. Every version shipped.*

### Slide 8 — Don't be afraid
| Scary word | What it actually is |
|---|---|
| Terminal | a text box that runs commands |
| SSH | that text box, on a faraway computer |
| Git branches | save points you can throw away |
| Docker | a lunchbox that ships an app with everything it needs |
| Browser console | the "what's really going on" panel (F12) |
| SQL | asking the database questions in almost-English |
| Server | someone else's computer that's always on |
- **Fuck-ups:** the `main` auto-deploy · the 2-hour CORS gremlin · the almost-committed secret
- *Backups + save points = nothing here can really hurt you*

### Slide 9 — The nasty edge cases (UX under failure)
- **Disconnect** → heartbeat → *"Louisa is reconnecting…"* (don't freeze, **name** it)
- **Refresh mid-turn / mid-merger** → land back exactly where you were (truth lives on the server)
- **Identity** → logged-in rejoins from any device · anonymous + cleared browser = honest "make an account"
- *"What's the worst moment for this user, and how do I make it survivable?" — that question is the job*

### Slide 10 — Live demo
- [big URL]
- Two players · found a chain · buy stock · **a merger**
- (optional) open the console — watch `game:state_updated` arrive live

### Slide 11 — What I'd tell past-me
- **A clear spec beats clever code**
- **AI didn't replace the thinking — it replaced the distance**
- **You're allowed to not know yet** (I learned every scary word *while* building)
- It started with Louisa & a board game. Thank you — try it, break it.
- [URL]
</content>
</invoke>
