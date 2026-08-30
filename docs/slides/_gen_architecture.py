#!/usr/bin/env python3
"""Generate the 7-frame architecture build-up for the Acquire talk.

Each frame is a standalone 1280x720 SVG that accumulates one more layer, so you
can drop architecture-1..7 onto successive slides (or as one slide's build
states). Geometry is shared, so boxes stay put as the picture grows.
"""

import os

W, H = 1280, 720
OUT = os.path.dirname(os.path.abspath(__file__))

# ---- palette (teal / turquoise dark theme, matches the app) -----------------
BG      = "#0c1a1d"
WRAP_F  = "#102429"
WRAP_S  = "#1f4d54"
BOX_F   = "#143038"
BOX_S   = "#2dd4bf"
HI_S    = "#5eead4"   # highlight stroke for the newest element
TXT     = "#eafffb"
SUB     = "#8fc9c1"
ARROW   = "#5eead4"
PILL_F  = "#0c1a1d"

# ---- geometry ---------------------------------------------------------------
BROWSER = (60, 300, 240, 170)
WRAPPER = (600, 70, 640, 600)
SPA     = (632, 150, 180, 110)
CADDY   = (632, 370, 180, 120)
BACKEND = (1012, 150, 200, 110)
SOCKET  = (1012, 320, 200, 110)
POSTGRES= (1012, 500, 200, 110)


def cx(b): return b[0] + b[2] / 2
def cy(b): return b[1] + b[3] / 2
def right(b): return b[0] + b[2]
def bottom(b): return b[1] + b[3]


def box(b, title, sub, hi=False):
    x, y, w, h = b
    s = HI_S if hi else BOX_S
    sw = 3 if hi else 2
    glow = ' filter="url(#glow)"' if hi else ""
    out = f'<g{glow}>'
    out += f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{BOX_F}" stroke="{s}" stroke-width="{sw}"/>'
    out += f'<circle cx="{x+28}" cy="{y+32}" r="8" fill="{s}"/>'
    out += f'<text x="{x+48}" y="{y+38}" fill="{TXT}" font-size="20" font-weight="700">{title}</text>'
    if sub:
        out += f'<text x="{x+20}" y="{y+h-18}" fill="{SUB}" font-size="14">{sub}</text>'
    out += '</g>'
    return out


def pill(x, y, text):
    w = len(text) * 7.2 + 18
    return (f'<g><rect x="{x-w/2:.0f}" y="{y-13}" width="{w:.0f}" height="26" rx="13" '
            f'fill="{PILL_F}" stroke="{WRAP_S}" stroke-width="1"/>'
            f'<text x="{x:.0f}" y="{y+5}" fill="{SUB}" font-size="13" text-anchor="middle">{text}</text></g>')


def arrow(points, two=False, dashed=False, hi=False):
    """points: list of (x,y). Marker arrowhead(s)."""
    col = HI_S if hi else ARROW
    d = "M " + " L ".join(f"{x:.0f},{y:.0f}" for x, y in points)
    dash = ' stroke-dasharray="6 5"' if dashed else ""
    start = ' marker-start="url(#ah)"' if two else ""
    return (f'<path d="{d}" fill="none" stroke="{col}" stroke-width="2.4"{dash}'
            f' marker-end="url(#ah)"{start}/>')


def frame(n):
    e = []  # drawing order: bg, wrapper, arrows-under, boxes, arrows-over, labels

    # background
    e.append(f'<rect width="{W}" height="{H}" fill="{BG}"/>')
    e.append(f'<rect width="{W}" height="{H}" fill="url(#grid)"/>')

    # title
    e.append(f'<text x="48" y="58" fill="{TXT}" font-size="26" font-weight="800">'
             f'How Acquire works — the architecture</text>')
    e.append(f'<text x="48" y="84" fill="{SUB}" font-size="15">Step {n} of 7</text>')

    # wrapper (server) behind inner boxes
    if n >= 6:
        x, y, w, h = WRAPPER
        e.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="20" '
                 f'fill="{WRAP_F}" stroke="{WRAP_S}" stroke-width="2" '
                 f'{"" if n<7 else ""} stroke-dasharray="2 0"/>')
        if n >= 7:
            e.append(f'<text x="{x+24}" y="{y+34}" fill="{TXT}" font-size="19" font-weight="700">'
                     f'One Hetzner server</text>')
            e.append(f'<text x="{x+24}" y="{y+56}" fill="{SUB}" font-size="13">'
                     f'Ubuntu · Docker Compose · each box = one container</text>')
        else:
            e.append(f'<text x="{x+24}" y="{y+38}" fill="{SUB}" font-size="15">'
                     f'one machine · one front door</text>')

    # ---- arrows drawn UNDER boxes? we draw boxes first, then arrows on top ----
    boxes = []
    if n >= 1:
        boxes.append(box(BROWSER, "Browser", "the player · React SPA", hi=(n == 1)))
    if n >= 2:
        boxes.append(box(SPA, "React SPA", "HTML · JS · CSS (static)", hi=(n == 2)))
    if n >= 3:
        boxes.append(box(BACKEND, "Backend API", "game rules · the referee", hi=(n == 3)))
    if n >= 4:
        boxes.append(box(POSTGRES, "PostgreSQL", "the memory", hi=(n == 4)))
    if n >= 5:
        boxes.append(box(SOCKET, "Socket.io", "the heartbeat", hi=(n == 5)))
    if n >= 6:
        boxes.append(box(CADDY, "Caddy", "front door · HTTPS / TLS", hi=(n == 6)))
    e += boxes

    # ---- arrows ----
    A = []
    L = []
    # download (direct; replaced by Caddy file_server from frame 6)
    if 2 <= n <= 5:
        A.append(arrow([(SPA[0], cy(SPA)), (right(BROWSER)+8, cy(BROWSER)-20)], hi=(n == 2)))
        L.append(pill((SPA[0]+right(BROWSER))/2, cy(BROWSER)-44, "download HTML / JS / CSS"))
    # direct REST + WSS (frames 3-5, replaced by Caddy at 6)
    if 3 <= n <= 5:
        A.append(arrow([(right(BROWSER), cy(BROWSER)), (900, cy(BROWSER)),
                        (900, BACKEND[1]+55), (BACKEND[0], BACKEND[1]+55)], two=True))
        L.append(pill(600, BACKEND[1]+55, "HTTPS · REST  /api"))
    if n == 5:
        A.append(arrow([(right(BROWSER), bottom(BROWSER)-20), (860, bottom(BROWSER)-20),
                        (860, cy(SOCKET)), (SOCKET[0], cy(SOCKET))], two=True))
        L.append(pill(600, bottom(BROWSER)-20, "WSS · WebSocket"))
    # SQL (stays from 4)
    if n >= 4:
        A.append(arrow([(BACKEND[0]-18, bottom(BACKEND)-30), (980, bottom(BACKEND)-30),
                        (980, POSTGRES[1]+40), (POSTGRES[0], POSTGRES[1]+40)], two=True,
                       hi=(n == 4)))
        L.append(pill(972, (bottom(BACKEND)+POSTGRES[1])/2, "SQL"))
    # notify backend -> socket (stays from 5)
    if n >= 5:
        A.append(arrow([(cx(BACKEND), bottom(BACKEND)), (cx(SOCKET), SOCKET[1])], hi=(n == 5)))
        L.append(pill(cx(SOCKET)+44, (bottom(BACKEND)+SOCKET[1])/2, "notify"))
    # Caddy routing (frames 6-7)
    if n >= 6:
        # browser -> caddy (REST + WSS), with lock
        A.append(arrow([(right(BROWSER), cy(BROWSER)-22), (CADDY[0], cy(CADDY)-30)], two=True,
                       hi=(n == 6)))
        A.append(arrow([(right(BROWSER), cy(BROWSER)+22), (CADDY[0], cy(CADDY)+30)], two=True,
                       hi=(n == 6)))
        L.append(pill((right(BROWSER)+CADDY[0])/2, cy(BROWSER)-46, "HTTPS · REST (TLS)"))
        L.append(pill((right(BROWSER)+CADDY[0])/2, cy(BROWSER)+50, "WSS · WebSocket (TLS)"))
        # caddy -> spa (file_server)
        A.append(arrow([(cx(CADDY), CADDY[1]), (cx(CADDY), bottom(SPA))]))
        L.append(pill(cx(CADDY), (CADDY[1]+bottom(SPA))/2, "file_server"))
        # caddy -> backend (/api)
        A.append(arrow([(right(CADDY), cy(CADDY)-30), (912, cy(CADDY)-30),
                        (912, cy(BACKEND)), (BACKEND[0], cy(BACKEND))]))
        L.append(pill(912, cy(CADDY)-50, "/api"))
        # caddy -> socket (/socket.io)
        A.append(arrow([(right(CADDY), cy(CADDY)+30), (940, cy(CADDY)+30),
                        (940, cy(SOCKET)), (SOCKET[0], cy(SOCKET))]))
        L.append(pill(940, cy(CADDY)+52, "/socket.io"))

    e += A
    e += L

    # DNS bar (frame 7)
    if n >= 7:
        y = bottom(WRAPPER) + 18
        e.append(f'<rect x="{WRAPPER[0]}" y="{y}" width="{WRAPPER[2]}" height="32" rx="8" '
                 f'fill="{WRAP_F}" stroke="{WRAP_S}" stroke-width="1"/>')
        e.append(f'<text x="{cx(WRAPPER):.0f}" y="{y+21}" fill="{SUB}" font-size="14" '
                 f'text-anchor="middle">DNS: jonashapp.com (All-Inkl) → Hetzner IP</text>')

    defs = (
        '<defs>'
        f'<marker id="ah" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">'
        f'<path d="M0,0 L7,3 L0,6 Z" fill="{ARROW}"/></marker>'
        '<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">'
        '<feGaussianBlur stdDeviation="5" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
        f'<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">'
        f'<path d="M40 0 H0 V40" fill="none" stroke="#10262b" stroke-width="1"/></pattern>'
        '</defs>'
    )
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
           f'width="{W}" height="{H}" font-family="Segoe UI, Helvetica, Arial, sans-serif">'
           + defs + "".join(e) + '</svg>')
    return svg


for i in range(1, 8):
    path = os.path.join(OUT, f"architecture-{i}.svg")
    with open(path, "w") as f:
        f.write(frame(i))
    print("wrote", path)
