"""Regenerates the diagrams shown in the README.

    pip install matplotlib
    python docs/figures/make_figures.py
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

HERE = Path(__file__).resolve().parent
for f in Path("/usr/share/fonts/lm").glob("lm*10-*.otf"):  # Latin Modern, if installed
    font_manager.fontManager.addfont(str(f))
plt.style.use(HERE / "paper.mplstyle")
C = plt.rcParams["axes.prop_cycle"].by_key()["color"]
INK, GRAY = "#1a1a1a", "#8c8c8c"


def tint(hex_color, a):
    """Mixes a palette color with white (a = share of the color)."""
    rgb = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(255 - a * (255 - c)):02x}" for c in rgb)


def save(fig, name):
    fig.savefig(HERE / name, metadata={"Date": None})
    plt.close(fig)


def canvas(w, h, xmax, ymax):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, xmax)
    ax.set_ylim(0, ymax)
    ax.set_aspect("equal")
    ax.axis("off")
    return fig, ax


def box(ax, x, y, w, h, title, body=None, color=None, fill=0.10, dashed=False, title_top=False,
        size=8.5, body_size=7.4, mono_title=False):
    ec = color or INK
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.8",
                                fc=tint(color, fill) if color else "white", ec=ec,
                                lw=0.7, ls=(0, (4, 2)) if dashed else "-"))
    fam = "monospace" if mono_title else None
    if title_top:
        ax.text(x + 1.2, y + h - 1.0, title, ha="left", va="top", size=size, weight="bold",
                color=ec, family=fam)
        if body:
            ax.text(x + 1.2, y + h - 3.6, body, ha="left", va="top", size=body_size, color=INK,
                    linespacing=1.35)
        return
    cy = y + h / 2
    if body:
        ax.text(x + w / 2, y + h - 1.3, title, ha="center", va="top", size=size, weight="bold",
                color=ec, family=fam)
        ax.text(x + w / 2, y + h - 4.2, body, ha="center", va="top", size=body_size, color=INK,
                linespacing=1.35)
    else:
        ax.text(x + w / 2, cy, title, ha="center", va="center", size=size, weight="bold",
                color=ec, family=fam)


def arrow(ax, p, q, label=None, both=False, rad=0.0, loff=(0, 0), ha="center", color=INK):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="<|-|>" if both else "-|>", mutation_scale=7,
                                 lw=0.7, color=color, shrinkA=0, shrinkB=0,
                                 connectionstyle=f"arc3,rad={rad}"))
    if label:
        mx, my = (p[0] + q[0]) / 2 + loff[0], (p[1] + q[1]) / 2 + loff[1]
        ax.text(mx, my, label, ha=ha, va="center", size=7, style="italic", color=INK,
                bbox=dict(fc="white", ec="none", pad=0.6))


# ---- Figure 1: one Tauri app on the DM's computer, players join from their phones
fig, ax = canvas(7.6, 5.0, 100, 66)
box(ax, 1, 1, 69, 64, "", color=GRAY, fill=0.0, dashed=True)
ax.text(2.5, 63.6, "DM's computer: one Tauri v2 desktop app", ha="left", va="top", size=8,
        style="italic", color="#4d4d4d")

box(ax, 3, 40, 65, 20.5, "", color=C[3], fill=0.03)
ax.text(66.5, 59.6, "Frontend: React 19 + TypeScript (WebView)", ha="right", va="top", size=8.2,
        weight="bold", color=C[3])
P = dict(color=C[3], fill=0.11, size=8.2, body_size=7.0)
box(ax, 5, 42, 41, 13.5, "DM window",
    "script (Prep / Live), soundboard, initiative, notes,\n"
    "character sheets, library and manuals, dice roller,\n"
    "generators, sound triggers, Spotify mini player", **P)
box(ax, 48, 42, 18, 13.5, "Player display", "second monitor:\nimages, video,\nfog of war", **P)

box(ax, 3, 3, 65, 31.5, "", color=C[0], fill=0.03)
ax.text(66.5, 33.6, "Backend: Rust", ha="right", va="top", size=8.2, weight="bold", color=C[0])
B = dict(color=C[0], fill=0.12, size=8.0, body_size=6.9)
box(ax, 5, 17.5, 19.5, 12, "Session content",
    "sessions, assets, script,\nnotes, combat state,\nsoundboard, triggers", **B)
box(ax, 26.5, 17.5, 19.5, 12, "Knowledge base",
    "PDF text → chunks →\nMiniLM embeddings,\ncosine search", **B)
box(ax, 48, 17.5, 18, 12, "Spotify client",
    "Web API with\nPKCE OAuth; drives\nthe desktop client", **B)
box(ax, 5, 5, 19.5, 10.5, "SQLite", "rusqlite (bundled),\nin the app data folder", **B)
box(ax, 26.5, 5, 19.5, 10.5, "Audio", "rodio: one-shot SFX\nand ambient loops", **B)
box(ax, 48, 5, 18, 10.5, "Player companion",
    "axum HTTP and\nWebSocket server", **B)
arrow(ax, (14.75, 17.5), (14.75, 15.5))
arrow(ax, (36.25, 17.5), (24.5, 13.5))

arrow(ax, (14, 40), (14, 34.5))
ax.text(15.2, 37.3, "commands (invoke)", ha="left", va="center", size=7, style="italic")
arrow(ax, (44, 34.5), (44, 40))
ax.text(45.2, 37.3, "events", ha="left", va="center", size=7, style="italic")

E = dict(fill=0.10, size=8.0, body_size=6.9)
box(ax, 75, 44, 24, 10, "GitHub Releases", "signed installers and\nupdate manifest", color=C[5], **E)
box(ax, 75, 19, 24, 10, "Spotify Web API", "playback and playlists\nof the DM's account", color=C[5],
    **E)
box(ax, 75, 2, 24, 15, "Players' phones",
    "a browser on the same Wi-Fi:\npick a character (optional\nPIN), roll dice, read\nhandouts, chat",
    color=C[2], **E)
arrow(ax, (68, 49), (75, 49), "updates", loff=(0, 1.8))
arrow(ax, (66, 23.5), (75, 23.5), both=True)
arrow(ax, (66, 10), (75, 10), both=True)
ax.text(71.5, 12.6, "LAN", ha="center", va="center", size=7, style="italic")
save(fig, "fig1-architecture.svg")
