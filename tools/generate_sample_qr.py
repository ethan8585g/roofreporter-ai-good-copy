"""Regenerate the 'Sample Roof Measurement Report' QR codes.

Produces:
  qr-codes/qr-sample-report.png          - plain QR
  qr-codes/qr-sample-report-labeled.png  - QR with caption underneath
"""
from pathlib import Path
import qrcode
from PIL import Image, ImageDraw, ImageFont

URL = "https://www.roofmanager.ca/report/share/70f969fb607c4c40b6a2"
OUT = Path(__file__).resolve().parent.parent / "qr-codes"
OUT.mkdir(exist_ok=True)

qr = qrcode.QRCode(
    version=None,
    error_correction=qrcode.constants.ERROR_CORRECT_H,
    box_size=12,
    border=4,
)
qr.add_data(URL)
qr.make(fit=True)
img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
img = img.resize((1596, 1596), Image.NEAREST)
img.save(OUT / "qr-sample-report.png")

caption = "Sample Roof Measurement Report"
label_h = 224
labeled = Image.new("RGB", (1596, 1596 + label_h), "white")
labeled.paste(img, (0, 0))
draw = ImageDraw.Draw(labeled)

font = None
for candidate in [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]:
    try:
        font = ImageFont.truetype(candidate, 96)
        break
    except OSError:
        continue
if font is None:
    font = ImageFont.load_default()

bbox = draw.textbbox((0, 0), caption, font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
x = (1596 - tw) // 2
y = 1596 + (label_h - th) // 2 - 10
draw.text((x, y), caption, fill="black", font=font)
labeled.save(OUT / "qr-sample-report-labeled.png")

print(f"Wrote {OUT/'qr-sample-report.png'}")
print(f"Wrote {OUT/'qr-sample-report-labeled.png'}")
print(f"Encoded URL: {URL}")
