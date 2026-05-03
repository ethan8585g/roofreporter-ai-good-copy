#!/usr/bin/env python3
"""Generate Roof Manager og:image (1200x630)."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "static" / "logo.png"
W, H = 1200, 630

BG_TOP = (10, 17, 35)
BG_BOT = (15, 28, 56)
ACCENT = (16, 185, 129)
ACCENT_LIGHT = (52, 211, 153)
TEXT = (245, 247, 250)
SUBTEXT = (170, 190, 210)

img = Image.new("RGB", (W, H), BG_TOP)
draw = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    r = int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t)
    g = int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t)
    b = int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t)
    draw.line([(0, y), (W, y)], fill=(r, g, b))


def load_font(paths, size):
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


bold_paths = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]
reg_paths = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/Library/Fonts/Arial.ttf",
]

title = "ROOF MANAGER"
title_size = 110
title_font = load_font(bold_paths, title_size)
title_bbox = draw.textbbox((0, 0), title, font=title_font)
title_w = title_bbox[2] - title_bbox[0]
title_h = title_bbox[3] - title_bbox[1]

sub = "Roof Measurement Report Software"
sub_font = load_font(reg_paths, 40)
sub_bbox = draw.textbbox((0, 0), sub, font=sub_font)
sub_w = sub_bbox[2] - sub_bbox[0]

url = "roofmanager.ca"
url_font = load_font(bold_paths, 38)
url_bbox = draw.textbbox((0, 0), url, font=url_font)
url_w = url_bbox[2] - url_bbox[0]

icon_size = 140
gap = 50
total_w = icon_size + gap + max(title_w, sub_w, url_w)
start_x = (W - total_w) // 2

cx = start_x + icon_size // 2
cy = H // 2

s = icon_size
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
ax = cx + s // 2 - 10
ay = cy - s // 2 - 10
arrow_w = 60
arrow_h = 60
draw.polygon(
    [
        (ax, ay + arrow_h),
        (ax + arrow_w // 2, ay),
        (ax + arrow_w, ay + arrow_h),
        (ax + int(arrow_w * 0.7), ay + arrow_h),
        (ax + int(arrow_w * 0.7), ay + arrow_h + 30),
        (ax + int(arrow_w * 0.3), ay + arrow_h + 30),
        (ax + int(arrow_w * 0.3), ay + arrow_h),
    ],
    fill=TEXT,
)

text_x = start_x + icon_size + gap
title_y = cy - title_h - 30
draw.text((text_x, title_y), title, font=title_font, fill=TEXT)
draw.text((text_x, title_y + title_h + 30), sub, font=sub_font, fill=SUBTEXT)
draw.text((text_x, title_y + title_h + 30 + 60), url, font=url_font, fill=ACCENT_LIGHT)

img.save(OUT, format="PNG", optimize=True)
print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
