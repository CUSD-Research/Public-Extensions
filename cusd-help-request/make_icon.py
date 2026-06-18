#!/usr/bin/env python3
"""
Render the extension icon and embed it into cusd-help-request.trex.

icon.svg (envelope + help "i" badge over a "Help Email" title) is the master
asset. Tableau dashboard-extension manifests carry the icon as a Base64-encoded
PNG in the <icon> element (~70x70 px), so this script rasterises icon.svg with
cairosvg, fits it — aspect preserved — onto a transparent 70x70 square, writes
icon.png, and splices the Base64 into the manifest. Idempotent: replaces an
existing <icon> or inserts one right after </source-location>. (Same 70x70
pipeline as cusd-excel-export.)

The viewBox is read from icon.svg, so swapping in a new icon of any shape needs
no code change. icon.svg uses a <text> element for the title, so a sans-serif
font must be available to the renderer (Arial on Windows; any sans via fontconfig
on Linux).

Run from this folder:  python3 make_icon.py
Requires:               pip install cairosvg Pillow
"""
import base64
import io
import re
from pathlib import Path

import cairosvg
from PIL import Image

HERE = Path(__file__).resolve().parent
SVG_PATH = HERE / "icon.svg"
PNG_PATH = HERE / "icon.png"
TREX_PATH = HERE / "cusd-help-request.trex"

SIZE = 70                              # final icon edge (Tableau expects ~70x70)
SUPERSAMPLE = 4                        # render at 4x then downscale for clean edges
CANVAS = SIZE * SUPERSAMPLE
CONTENT = SIZE * SUPERSAMPLE * 0.90    # ~10% breathing room inside the square


def svg_viewbox() -> "tuple[float, float]":
    """Read viewBox W/H from icon.svg so a new icon needs no code edit."""
    text = SVG_PATH.read_text(encoding="utf-8")
    m = re.search(r'viewBox="\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)"', text)
    if not m:
        raise SystemExit("icon.svg: could not read viewBox width/height")
    return float(m.group(1)), float(m.group(2))


def render_png() -> Image.Image:
    """Rasterise icon.svg fit-and-centered (aspect preserved) onto a 70x70 square."""
    w, h = svg_viewbox()
    scale = CONTENT / max(w, h)          # fit the larger side; never stretch
    raw = cairosvg.svg2png(bytestring=SVG_PATH.read_bytes(), scale=scale)
    glyph = Image.open(io.BytesIO(raw)).convert("RGBA")
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(glyph, ((CANVAS - glyph.width) // 2, (CANVAS - glyph.height) // 2))
    return canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


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
