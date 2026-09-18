# Run with: python3 tools/build_icon.py
"""Builds assets/icon-180.png and assets/icon-512.png from the player
warrior's first idle frame (warrior_blue_idle, frame 0) in assets/atlas-0.png,
composited on a solid #1e1a2e square background for "Add to Home Screen"."""
import re
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ATLAS_DATA_JS = ROOT / "src" / "atlas-data.js"
ATLAS_PNG = ROOT / "assets" / "atlas-0.png"
BG = (0x1E, 0x1A, 0x2E, 0xFF)
SHEET_NAME = "warrior_blue_idle"
FRAME_INDEX = 0
FILL_RATIO = 0.70  # sprite occupies ~70% of the icon's width/height

# Pull the TS_ATLAS JSON literal out of the JS file so we don't need a JS runtime.
src = ATLAS_DATA_JS.read_text()
m = re.search(r"const TS_ATLAS = (\{.*\});", src)
atlas = json.loads(m.group(1))

sheet = atlas["sheets"][SHEET_NAME]
page = atlas["pages"][sheet["pg"]]
t = sheet["t"]
i = FRAME_INDEX * 6
trim_x, trim_y, w, h, atlas_x, atlas_y = t[i:i + 6]

atlas_img = Image.open(ROOT / page).convert("RGBA")
frame = atlas_img.crop((atlas_x, atlas_y, atlas_x + w, atlas_y + h))

# Double-check the crop is already trimmed to opaque bounds; re-trim defensively if not.
bbox = frame.getbbox()
if bbox and bbox != (0, 0, w, h):
    frame = frame.crop(bbox)
    w, h = frame.size


def build_icon(size, out_path):
    icon = Image.new("RGBA", (size, size), BG)
    target = size * FILL_RATIO
    scale = min(target / w, target / h)
    new_w = max(1, round(w * scale))
    new_h = max(1, round(h * scale))
    sprite = frame.resize((new_w, new_h), Image.NEAREST)
    dest_x = (size - new_w) // 2
    dest_y = (size - new_h) // 2
    icon.alpha_composite(sprite, (dest_x, dest_y))
    icon.convert("RGB").save(out_path)


build_icon(180, ROOT / "assets" / "icon-180.png")
build_icon(512, ROOT / "assets" / "icon-512.png")
print(f"frame: {SHEET_NAME}[{FRAME_INDEX}] trim=({trim_x},{trim_y}) size={w}x{h} atlas=({atlas_x},{atlas_y}) page={page}")
