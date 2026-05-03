#!/usr/bin/env python3
"""Generate Roof Manager og:image (wide social preview) + square logo icon."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

STATIC = Path(__file__).resolve().parent.parent / "public" / "static"
OG = STATIC / "og-image.png"
LOGO = STATIC / "logo.png"

BG_TOP = (10, 17, 35)
BG_BOT = (15, 28, 56)
ACCENT = (16, 185, 129)
ACCENT_LIGHT = (52, 211, 153)
TEXT = (245, 247, 250)
SUBTEXT = (170, 190, 210)


def gradient_bg(w, h):
    img = Image.new("RGB", (w, h), BG_TOP)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        r = int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t)
        d.line([(0, y), (w, y)], fill=(r, g, b))
    return img


def load_font(paths, size):
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


BOLD = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]
REG = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/Library/Fonts/Arial.ttf",
]


def draw_house_icon(draw, cx, cy, s, with_arrow=True):
    roof_pts = [
        (cx - s // 2, cy + 5),
        (cx, cy - s // 2 + 10),
        (cx + s // 2, cy + 5),
    ]
    draw.polygon(roof_pts, fill=ACCENT)
    body_w = s * 0.95
    body_h = s * 0.55
    draw.rectangle(
        [cx - body_w / 2, cy + 5, cx + body_w / 2, cy + 5 + body_h],
        fill=ACCENT_LIGHT,
    )
    if with_arrow:
        ax = cx + s // 2 - 10
        ay = cy - s // 2 - 10
        aw = int(s * 0.42)
        ah = int(s * 0.42)
        draw.polygon(
            [
                (ax, ay + ah),
                (ax + aw // 2, ay),
                (ax + aw, ay + ah),
                (ax + int(aw * 0.7), ay + ah),
                (ax + int(aw * 0.7), ay + ah + ah // 2),
                (ax + int(aw * 0.3), ay + ah + ah // 2),
                (ax + int(aw * 0.3), ay + ah),
            ],
            fill=TEXT,
        )


# ---------- og-image.png (1200x630, wide social preview) ----------
W, H = 1200, 630
img = gradient_bg(W, H)
draw = ImageDraw.Draw(img)

title = "ROOF MANAGER"
title_font = load_font(BOLD, 110)
title_bbox = draw.textbbox((0, 0), title, font=title_font)
title_w = title_bbox[2] - title_bbox[0]
title_h = title_bbox[3] - title_bbox[1]

sub = "Roof Measurement Report Software"
sub_font = load_font(REG, 40)
sub_bbox = draw.textbbox((0, 0), sub, font=sub_font)
sub_w = sub_bbox[2] - sub_bbox[0]

url = "roofmanager.ca"
url_font = load_font(BOLD, 38)
url_bbox = draw.textbbox((0, 0), url, font=url_font)
url_w = url_bbox[2] - url_bbox[0]

icon_size = 140
gap = 50
total_w = icon_size + gap + max(title_w, sub_w, url_w)
start_x = (W - total_w) // 2
cx = start_x + icon_size // 2
cy = H // 2

draw_house_icon(draw, cx, cy, icon_size, with_arrow=True)

text_x = start_x + icon_size + gap
title_y = cy - title_h - 30
draw.text((text_x, title_y), title, font=title_font, fill=TEXT)
draw.text((text_x, title_y + title_h + 30), sub, font=sub_font, fill=SUBTEXT)
draw.text((text_x, title_y + title_h + 30 + 60), url, font=url_font, fill=ACCENT_LIGHT)

img.save(OG, format="PNG", optimize=True)
print(f"Wrote {OG} ({OG.stat().st_size} bytes)")

# ---------- logo.png (512x512 square icon, used in navbars) ----------
S = 512
img = gradient_bg(S, S)
draw = ImageDraw.Draw(img)
draw_house_icon(draw, S // 2, int(S * 0.42), int(S * 0.55), with_arrow=True)

label = "ROOF MANAGER"
label_font = load_font(BOLD, 56)
label_bbox = draw.textbbox((0, 0), label, font=label_font)
label_w = label_bbox[2] - label_bbox[0]
draw.text(((S - label_w) // 2, int(S * 0.78)), label, font=label_font, fill=TEXT)

img.save(LOGO, format="PNG", optimize=True)
print(f"Wrote {LOGO} ({LOGO.stat().st_size} bytes)")
