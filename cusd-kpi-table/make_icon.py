#!/usr/bin/env python3
"""Render icon.svg -> icon.png (~70x70, transparent) and splice the Base64 PNG
into the <icon> element of cusd-kpi-table.trex.

Mirrors tableau-extensions/cusd-excel-export/make_icon.py.

    pip install cairosvg Pillow
    python3 make_icon.py

The manifest <icon> is the PICKER icon (shown in Access Local Extensions); the
in-dashboard view draws its own table, so it has no button glyph to keep in sync.
"""
import base64
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SVG = HERE / "icon.svg"
PNG = HERE / "icon.png"
TREX = HERE / "cusd-kpi-table.trex"
SIZE = 70


def render_png() -> bytes:
    import cairosvg  # type: ignore
    cairosvg.svg2png(url=str(SVG), write_to=str(PNG),
                     output_width=SIZE, output_height=SIZE)
    return PNG.read_bytes()


def splice_into_trex(png_bytes: bytes) -> None:
    b64 = base64.b64encode(png_bytes).decode("ascii")
    text = TREX.read_text(encoding="utf-8")
    new = re.sub(r"<icon>.*?</icon>", "<icon>" + b64 + "</icon>", text, count=1, flags=re.S)
    TREX.write_text(new, encoding="utf-8")
    print(f"Spliced {len(b64)} base64 chars into {TREX.name}")


if __name__ == "__main__":
    png = render_png()
    print(f"Wrote {PNG.name} ({len(png)} bytes)")
    splice_into_trex(png)
