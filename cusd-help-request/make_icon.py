#!/usr/bin/env python3
"""
Render the extension icon and embed it into cusd-help-request.trex.

icon.svg (a navy envelope) is the master asset. Tableau dashboard-extension
manifests carry the icon as a Base64-encoded PNG in the <icon> element (~70x70
px), so this script produces a 70x70 transparent PNG, writes icon.png, and
splices the Base64 into the manifest. Idempotent: replaces an existing <icon> or
inserts one right after </source-location>.

Primary path rasterises icon.svg with cairosvg (matches the other CUSD
extensions). If cairosvg is unavailable, it falls back to drawing the same
envelope directly with Pillow, so the icon can always be regenerated.

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

SIZE = 70                       # final icon edge (Tableau expects ~70x70)
SUPERSAMPLE = 4                 # render at 4x then downscale for clean edges
CANVAS = SIZE * SUPERSAMPLE
NAVY = (0, 48, 135, 255)        # #003087
WHITE = (255, 255, 255, 255)


def render_with_cairosvg() -> Image.Image:
    """Rasterise icon.svg to a CANVAS-square RGBA image (preferred)."""
    import cairosvg
    raw = cairosvg.svg2png(
        bytestring=SVG_PATH.read_bytes(),
        output_width=CANVAS,
        output_height=CANVAS,
    )
    return Image.open(io.BytesIO(raw)).convert("RGBA")


def render_with_pillow() -> Image.Image:
    """Draw the same envelope as icon.svg directly with Pillow (no cairosvg)."""
    s = CANVAS / 64.0   # icon.svg uses a 0..64 viewBox
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([8 * s, 16 * s, 56 * s, 48 * s], radius=5 * s, fill=NAVY)
    d.line(
        [(11 * s, 21 * s), (32 * s, 36 * s), (53 * s, 21 * s)],
        fill=WHITE, width=max(1, round(3.5 * s)), joint="curve",
    )
    return img


def render_png() -> Image.Image:
    try:
        glyph = render_with_cairosvg()
    except Exception:
        glyph = render_with_pillow()
    return glyph.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


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
