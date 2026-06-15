# Architecture build-up frames

Seven cumulative frames for the architecture slide of the *Acquire* talk.
Each frame adds one layer, so the diagram grows as you click.

| Frame | Adds |
|---|---|
| `architecture-1` | Browser (the player) |
| `architecture-2` | React SPA (static files download) |
| `architecture-3` | Backend API (the referee) |
| `architecture-4` | PostgreSQL (the memory) |
| `architecture-5` | Socket.io (the heartbeat) + notify |
| `architecture-6` | Caddy front door (HTTPS/TLS + routing) |
| `architecture-7` | Hetzner server wrapper + Docker + DNS |

- **`.svg`** — vector, crisp at any size. Keynote (≥ macOS) and PowerPoint 2016+
  import SVG directly: *Insert → Pictures → This Device*.
- **`.png`** — 1280×720 raster fallback that imports everywhere.

**To put them on one animated slide:** stack frames 1–7 on the same slide and give
each an "Appear" build, or use 7 successive slides (simplest, zero risk live).

## Regenerating
Edit geometry/colours in `_gen_architecture.py`, then:

```bash
python3 _gen_architecture.py          # writes the 7 SVGs
# optional PNGs (needs cairosvg):
for i in 1 2 3 4 5 6 7; do \
  python3 -c "import cairosvg; cairosvg.svg2png(url='architecture-$i.svg', \
    write_to='architecture-$i.png', output_width=1280, output_height=720)"; done
```
</content>
</invoke>
