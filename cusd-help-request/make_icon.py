#!/usr/bin/env python3
"""
Render the extension icon and embed it into cusd-help-request.trex.

icon.svg (an envelope with a help "i" badge) is the master asset. Tableau
dashboard-extension manifests carry the icon as a Base64-encoded PNG in the
<icon> element (~70x70 px), so this script fits the glyph — aspect preserved —
onto a transparent 70x70 square, writes icon.png, and splices the Base64 into the
manifest. Idempotent: replaces an existing <icon> or inserts one right after
</source-location>. (Same 70x70 pipeline as cusd-excel-export.)

Primary path rasterises icon.svg with cairosvg (accurate for any icon.svg). If
cairosvg is unavailable, it falls back to drawing the same glyph with Pillow.

Run from this folder:  python3 make_icon.py
Requires:               pip install Pillow   (optionally also cairosvg)
"""
import base64
import io
import re
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SVG_PATH = HERE / "icon.svg"
PNG_PATH = HERE / "icon.png"
TREX_PATH = HERE / "cusd-help-request.trex"

SIZE = 70                              # final icon edge (Tableau expects ~70x70)
SUPERSAMPLE = 4                        # render at 4x then downscale for clean edges
CANVAS = SIZE * SUPERSAMPLE
CONTENT = SIZE * SUPERSAMPLE * 0.90    # ~10% breathing room inside the square

# Native viewBox of icon.svg — used to scale + centre (aspect preserved).
SVG_W, SVG_H = 47.0, 61.0
GREY = (159, 159, 159, 255)            # #9F9F9F
WHITE = (255, 255, 255, 255)


def _fit_on_canvas(glyph: Image.Image) -> Image.Image:
    """Centre a rendered glyph on a transparent CANVAS-square, then downscale."""
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - glyph.width) // 2
    y = (CANVAS - glyph.height) // 2
    canvas.alpha_composite(glyph, (x, y))
    return canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def render_with_cairosvg() -> Image.Image:
    """Rasterise icon.svg, scaled so its height == CONTENT (aspect preserved)."""
    import cairosvg
    scale = CONTENT / SVG_H
    raw = cairosvg.svg2png(bytestring=SVG_PATH.read_bytes(), scale=scale)
    glyph = Image.open(io.BytesIO(raw)).convert("RGBA")
    return _fit_on_canvas(glyph)


def render_with_pillow() -> Image.Image:
    """Draw the same glyph as icon.svg directly with Pillow (no cairosvg)."""
    s = CONTENT / SVG_H                       # px per svg-unit
    gw, gh = int(round(SVG_W * s)), int(round(SVG_H * s))
    img = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def sx(v): return v * s
    def sy(v): return v * s

    # Envelope body + white flap.
    d.rounded_rectangle([sx(1), sy(16), sx(37), sy(42)], radius=5 * s, fill=GREY)
    d.line([(sx(4), sy(19.5)), (sx(19), sy(30.5)), (sx(34), sy(19.5))],
           fill=WHITE, width=max(1, round(2.6 * s)), joint="curve")
    # Help "i" badge: grey disc, white ring, white dot + stem.
    cx, cy, r = 34.5, 44.5, 14.0
    d.ellipse([sx(cx - r), sy(cy - r), sx(cx + r), sy(cy + r)], fill=GREY)
    d.ellipse([sx(cx - r), sy(cy - r), sx(cx + r), sy(cy + r)],
              outline=WHITE, width=max(1, round(2.6 * s)))
    d.ellipse([sx(34.5 - 2.3), sy(40.6 - 2.3), sx(34.5 + 2.3), sy(40.6 + 2.3)], fill=WHITE)
    d.rounded_rectangle([sx(33), sy(43.6), sx(36), sy(51.2)], radius=1.5 * s, fill=WHITE)

    return _fit_on_canvas(img)


def render_png() -> Image.Image:
    try:
        return render_with_cairosvg()
    except Exception:
        return render_with_pillow()


def main() -> None:
    icon = render_png()
    icon.save(PNG_PATH, "PNG")

    buf = io.BytesIO()
    icon.save(buf, "PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    trex = TREX_PATH.read_text(encoding="utf-8")
    icon_el = f"    <icon>{b64}</icon>"
    if "<icon>" in trex:
        trex = re.sub(r"[ \t]*<icon>.*?</icon>", icon_el, trex, flags=re.DOTALL)
    else:
        trex = trex.replace(
            "    </source-location>\n",
            "    </source-location>\n" + icon_el + "\n",
            1,
        )
    TREX_PATH.write_text(trex, encoding="utf-8")

    print(f"Wrote {PNG_PATH.name} ({PNG_PATH.stat().st_size} bytes); "
          f"embedded {len(b64)} Base64 chars into {TREX_PATH.name}.")


if __name__ == "__main__":
    main()
