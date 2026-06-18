#!/usr/bin/env python3
"""
Render the extension icon from icon.svg and embed it into cusd-excel-export.trex.

icon.svg (the down-arrow + tray + "Excel" glyph) is the master asset. Tableau
dashboard-extension manifests carry the icon as a Base64-encoded PNG in the
<icon> element (~70x70 px), so this script rasterises the SVG at high resolution
with cairosvg, fits it (aspect-preserved) onto a transparent 70x70 square,
writes icon.png, and splices the Base64 into the manifest. Idempotent: replaces
an existing <icon> or inserts one right after </source-location>.

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
TREX_PATH = HERE / "cusd-excel-export.trex"

SIZE = 70             # final icon edge (Tableau expects ~70x70)
SUPERSAMPLE = 4       # render at 4x then downscale for clean anti-aliasing
CONTENT = SIZE * SUPERSAMPLE * 0.90  # ~10% breathing room inside the square
CANVAS = SIZE * SUPERSAMPLE

# Native SVG height (from its viewBox) — used to compute the render scale.
SVG_NATIVE_HEIGHT = 79.0


def render_png() -> Image.Image:
    # Rasterise the SVG so its height == CONTENT, preserving aspect ratio.
    scale = CONTENT / SVG_NATIVE_HEIGHT
    raw = cairosvg.svg2png(bytestring=SVG_PATH.read_bytes(), scale=scale)
    glyph = Image.open(io.BytesIO(raw)).convert("RGBA")

    # Centre it on a transparent square canvas, then downscale.
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - glyph.width) // 2
    y = (CANVAS - glyph.height) // 2
    canvas.alpha_composite(glyph, (x, y))
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

    print(f"Rendered {PNG_PATH.name} ({PNG_PATH.stat().st_size} bytes) from "
          f"{SVG_PATH.name}; embedded {len(b64)} Base64 chars into {TREX_PATH.name}.")


if __name__ == "__main__":
    main()
