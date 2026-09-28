#!/usr/bin/env python3
"""
The app mark: ᱨᱚᱠᱷᱟ, black on safety yellow, inside a black signage frame.

One source for every place the mark appears:
  public/icons/*.png            the PWA icons (and the favicon)
  android/app/src/main/res/...  the APK's launcher, splash and notification
                                icons, when a local android/ project exists
  public/card.svg, card-screen.svg   the Card AR card, to print and to show on a screen
  src/app/render/card-marker.ts      the tracker's template for that card
  tests/fixtures/card-*              the card as a camera sees it, for tests/card.test.ts

The word is drawn from Noto Sans Ol Chiki Bold (SIL OFL 1.1, vendored with its
licence in tools/fonts/) and stored as outlines, so no device ever needs an Ol
Chiki font to show it. Most phones in the field have none.

ᱨᱚᱠᱷᱟ (rokha, protection) is the word this app's own Santali already uses for
"secure", and like the rest of that Santali it is a machine draft until a
speaker has checked it. If they give a better word, change WORD and re-run.
Do not shorten it to the single letter ᱨ: alone, in black on yellow, it reads
as a hammer and sickle.

Run: python tools/make_icon.py        (needs Pillow and fontTools)
"""

from __future__ import annotations

import os
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

WORD = 'ᱨᱚᱠᱷᱟ'

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / 'tools' / 'fonts' / 'NotoSansOlChiki-Bold.ttf'

YELLOW = (242, 178, 2, 255)  # --hazard-solid
INK = (21, 20, 12, 255)  # --on-hazard
CLEAR = (0, 0, 0, 0)
SS = 4  # supersampling: draw at 4x, downsample, so edges are smooth without an SVG renderer


def word_font(px_width: float) -> tuple[ImageFont.FreeTypeFont, tuple[int, int, int, int]]:
    """The largest size at which WORD is no wider than px_width."""
    size = int(px_width)
    probe = ImageDraw.Draw(Image.new('L', (1, 1)))
    while size > 4:
        font = ImageFont.truetype(str(FONT), size)
        box = probe.textbbox((0, 0), WORD, font=font)
        if box[2] - box[0] <= px_width:
            return font, box
        size -= 2
    raise RuntimeError('word does not fit')


def draw_word(canvas: Image.Image, width_frac: float, fill, centre=(0.5, 0.5)) -> None:
    w, h = canvas.size
    font, (l, t, r, b) = word_font(w * width_frac)
    x = w * centre[0] - (r - l) / 2 - l
    y = h * centre[1] - (b - t) / 2 - t
    ImageDraw.Draw(canvas).text((x, y), WORD, font=font, fill=fill)


def plate(size: int, *, bleed: bool) -> Image.Image:
    """
    The mark as a sign plate. `bleed` is the maskable form: yellow to every
    edge, because the launcher cuts its own shape out of it. It carries no
    frame, because a frame pulled inside a circular mask (radius 40%) left the
    word too small to read at launcher size; the word alone still sits inside
    that circle.
    """
    s = size * SS
    im = Image.new('RGBA', (s, s), CLEAR)
    d = ImageDraw.Draw(im)
    if bleed:
        d.rectangle((0, 0, s, s), fill=YELLOW)
        draw_word(im, 0.66, INK)
    else:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.16, fill=YELLOW)
        a, z = s * 0.075, s * 0.925
        d.rounded_rectangle((a, a, z, z), radius=s * 0.1, outline=INK, width=round(s * 0.05))
        draw_word(im, 0.66, INK)
    return im.resize((size, size), Image.LANCZOS)


def silhouette(size: int) -> Image.Image:
    """Android notification icons are alpha only: the word in white, nothing else."""
    s = size * SS
    im = Image.new('RGBA', (s, s), CLEAR)
    draw_word(im, 0.92, (255, 255, 255, 255))
    return im.resize((size, size), Image.LANCZOS)


def splash(size: int) -> Image.Image:
    im = Image.new('RGBA', (size, size), CLEAR)
    mark = plate(round(size * 0.62), bleed=False)
    im.paste(mark, ((size - mark.width) // 2, (size - mark.height) // 2), mark)
    return im


def svg_path() -> tuple[str, tuple[float, float, float, float]]:
    """WORD as one SVG path in font units, y flipped to point down, plus its bounds."""
    font = TTFont(str(FONT))
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    hmtx = font['hmtx']

    pen = SVGPathPen(glyphs)
    bounds = BoundsPen(glyphs)
    x = 0
    for char in WORD:
        name = cmap[ord(char)]
        # Flip y (fonts are y-up, SVG is y-down) and advance along the line.
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        glyphs[name].draw(TransformPen(bounds, (1, 0, 0, -1, x, 0)))
        x += hmtx[name][0]
    return pen.getCommands(), bounds.bounds


# ── the Card AR marker ──────────────────────────────────────────────────────
#
# The card is the icon's sign plate made trackable: a square black frame (a
# tracker needs sharp corners, so none of the icon's rounding) around a yellow
# field carrying the word above a solid bar. The bar is there for the tracker,
# not for looks: the word alone is a wide low band that reads almost the same
# upside down at 16x16, and the bar makes all four turns of the card distinct.

PATT_RATIO = 0.7  # inner field / marker width; the frame is 15% of the width on each side
PATT_RES = 16  # ARToolKit's template size


def card_field(size: int) -> Image.Image:
    """The inside of the frame: exactly what the tracker samples and matches."""
    im = Image.new('RGBA', (size, size), YELLOW)
    draw_word(im, 0.86, INK, centre=(0.5, 0.36))
    ImageDraw.Draw(im).rectangle((size * 0.1, size * 0.64, size * 0.9, size * 0.84), fill=INK)
    return im


def card_marker(size: int, margin: float = 0.0) -> Image.Image:
    """The whole marker, frame included, with `margin` of white paper around it."""
    outer = round(size * (1 + 2 * margin))
    im = Image.new('RGBA', (outer, outer), (255, 255, 255, 255))
    m = round(size * margin)
    ImageDraw.Draw(im).rectangle((m, m, m + size - 1, m + size - 1), fill=INK)
    field = round(size * PATT_RATIO)
    inset = m + (size - field) // 2
    im.paste(card_field(field), (inset, inset))
    return im


def pattern_file() -> str:
    """
    The template ARToolKit matches against, in its .patt text format: four
    turns of the field, each as three 16x16 planes in BGR order. The turns
    follow the AR.js marker generator (0, then 90 degrees at a time
    anticlockwise), since that is the order the tracker's own files use.
    """
    field = card_field(PATT_RES * 32).convert('RGB')
    blocks = []
    for turn in range(4):
        small = field.rotate(90 * turn).resize((PATT_RES, PATT_RES), Image.BILINEAR)
        px = small.load()
        planes = []
        for channel in (2, 1, 0):
            rows = [' '.join(f'{px[x, y][channel]:3d}' for x in range(PATT_RES)) for y in range(PATT_RES)]
            planes.append('\n'.join(rows))
        blocks.append('\n'.join(planes))
    return '\n\n'.join(blocks) + '\n'


def card_svg(screen: bool = False) -> str:
    """
    The printable sheet: A4, the marker 150 mm across, and plain instructions.
    Vector throughout, the word as outlines, so it prints sharp from any phone
    or PC without an Ol Chiki font. `screen` crops it to the marker and its
    white border, for showing full-size on a second phone or a laptop.
    """
    commands, (x0, y0, x1, y1) = svg_path()
    size = 150.0
    left, top = (210 - size) / 2, 28.0
    field = size * PATT_RATIO
    fx, fy = left + (size - field) / 2, top + (size - field) / 2
    # The word, fitted exactly as card_field() fits it: 86% of the field wide, centred at 36% down.
    scale = field * 0.86 / (x1 - x0)
    wx = fx + field * 0.5 - (x1 - x0) * scale / 2 - x0 * scale
    wy = fy + field * 0.36 - (y1 - y0) * scale / 2 - y0 * scale
    yellow, ink = '#f2b202', '#15140c'
    text = 'font-family="system-ui, sans-serif" fill="#15140c" text-anchor="middle"'
    if screen:
        pad = 12
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{left - pad} {top - pad} '
                f'{size + 2 * pad} {size + 2 * pad}">')
    else:
        head = '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">'
    return f'''{head}
  <title>Suraksha AR · Card AR marker</title>
  <rect width="210" height="297" fill="#fff"/>
  <rect x="{left}" y="{top}" width="{size}" height="{size}" fill="{ink}"/>
  <rect x="{fx}" y="{fy}" width="{field}" height="{field}" fill="{yellow}"/>
  <path transform="translate({wx:.3f} {wy:.3f}) scale({scale:.6f})" fill="{ink}" d="{commands}"/>
  <rect x="{fx + field * 0.1:.3f}" y="{fy + field * 0.64:.3f}" width="{field * 0.8:.3f}" height="{field * 0.2:.3f}" fill="{ink}"/>
  <text x="105" y="{top + size + 16}" font-size="7" font-weight="700" {text}>Suraksha AR · Card AR</text>
  <text x="105" y="{top + size + 27}" font-size="4.6" {text}>Lay the card flat on a table, open the drill, and point the phone at it.</text>
  <text x="105" y="{top + size + 35}" font-size="4.6" {text}>कार्ड को मेज़ पर सीधा रखिए, अभ्यास खोलिए और फ़ोन का कैमरा उस पर रखिए।</text>
  <text x="105" y="{top + size + 47}" font-size="3.6" fill="#555" text-anchor="middle" font-family="system-ui, sans-serif">Print at 100% (no "fit to page"). Keep the black frame whole, flat and unfolded, and the white border around it.</text>
</svg>
'''


def camera_frame(width: int, height: int, corners: list[tuple[float, float]], background: int) -> Image.Image:
    """
    A synthetic camera frame: the marker (with its paper border) warped onto
    the four image-space `corners` of its black frame, over a plain table.
    `corners` run top-left, top-right, bottom-right, bottom-left of the frame.
    """
    size, margin = 600, 0.18
    marker = card_marker(size, margin).convert('RGB')
    m = size * margin
    src = [(m, m), (m + size, m), (m + size, m + size), (m, m + size)]
    # Perspective coefficients mapping each output pixel back into the marker image.
    import numpy as np  # only the fixtures need it

    rows, rhs = [], []
    for (x, y), (u, v) in zip(corners, src):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.append(u)
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.append(v)
    coeffs = np.linalg.solve(np.array(rows, float), np.array(rhs, float))
    table = Image.new('RGB', (width, height), (background, background - 12, background - 30))
    warped = marker.transform((width, height), Image.PERSPECTIVE, tuple(coeffs), Image.BICUBIC,
                              fillcolor=(0, 0, 0))
    mask = Image.new('L', marker.size, 255).transform((width, height), Image.PERSPECTIVE, tuple(coeffs),
                                                      Image.BILINEAR, fillcolor=0)
    table.paste(warped, (0, 0), mask)
    return table


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')
    print(f'wrote {path.relative_to(ROOT)} ({len(text.encode())} bytes)')


def write(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    print(f'wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)')


def main() -> None:
    icons = ROOT / 'public' / 'icons'
    write(icons / 'icon-192.png', plate(192, bleed=False))
    write(icons / 'icon-512.png', plate(512, bleed=False))
    write(icons / 'icon-512-maskable.png', plate(512, bleed=True))

    # The TWA project is generated and gitignored, but its PNGs are what the
    # next `npm run apk:build` packs. Sizes are Bubblewrap's own.
    res = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
    if res.is_dir():
        densities = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
        for name, k in densities.items():
            write(res / f'mipmap-{name}' / 'ic_launcher.png', plate(round(48 * k), bleed=False))
            write(res / f'mipmap-{name}' / 'ic_maskable.png', plate(round(82 * k), bleed=True))
            write(res / f'drawable-{name}' / 'splash.png', splash(round(300 * k)))
            write(res / f'drawable-{name}' / 'ic_notification_icon.png', silhouette(round(24 * k)))
        store = ROOT / 'android' / 'store_icon.png'
        write(store, plate(512, bleed=False))

    # Card AR: the sheet to print, the template the tracker matches it with,
    # and the camera calibration, all in one module so the tier needs no fetch.
    import base64
    import gzip

    write_text(ROOT / 'public' / 'card.svg', card_svg())
    # The on-screen card is the marker alone; its caption belongs to the printed sheet.
    screen_svg = ''.join(line for line in card_svg(screen=True).splitlines(True) if '<text' not in line)
    write_text(ROOT / 'public' / 'card-screen.svg', screen_svg)
    camera = base64.b64encode((ROOT / 'tools' / 'ar' / 'camera_para.dat').read_bytes()).decode()
    write_text(
        ROOT / 'src' / 'app' / 'render' / 'card-marker.ts',
        '// Generated by tools/make_mark.py from the same drawing as public/card.svg. Do not edit.\n\n'
        '/** Inner field / marker width. Must match the printed card, or nothing is ever recognised. */\n'
        f'export const PATT_RATIO = {PATT_RATIO};\n\n'
        '/** ARToolKit template for the card, four turns of the field in .patt format. */\n'
        f'export const CARD_PATTERN = `{pattern_file()}`;\n\n'
        '/**\n'
        " * ARToolKit's generic 640x480 calibration (camera_para.dat from artoolkit5-js).\n"
        ' * Every phone is some other camera; the tracker and the projection both use\n'
        ' * this one, so what is drawn still lands on the card in the image, and only\n'
        ' * distances off the card plane are approximate.\n'
        ' */\n'
        f"export const CAMERA_PARA_BASE64 = '{camera}';\n",
    )

    # Test fixtures: the card as a phone would see it, square-on-ish and a
    # quarter turn round, so a broken template or a wrong turn order fails a
    # test instead of a classroom.
    fixtures = ROOT / 'tests' / 'fixtures'
    fixtures.mkdir(parents=True, exist_ok=True)
    shots = {
        'card-upright': [(104, 52), (228, 60), (236, 186), (96, 180)],
        'card-quarter': [(230, 58), (236, 186), (100, 184), (100, 50)],
    }
    for name, corners in shots.items():
        frame = camera_frame(320, 240, corners, background=150).convert('RGBA')
        (fixtures / f'{name}.rgba.gz').write_bytes(gzip.compress(frame.tobytes(), 9, mtime=0))
        frame.save(fixtures / f'{name}.png')
        print(f'wrote tests/fixtures/{name}.rgba.gz')


if __name__ == '__main__':
    os.chdir(ROOT)
    main()
