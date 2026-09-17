#!/usr/bin/env python3
"""Build the runtime sprite atlas from the Tiny Swords free pack.

Reads the pack from ./"Tiny Swords (Free Pack)" (download it from
https://pixelfrog-assets.itch.io/tiny-swords; it is deliberately NOT part of
this repository because its licence forbids redistributing the pack), trims
every frame the game uses, packs them into assets/atlas-N.png pages and writes
src/atlas-data.js with frame rectangles, anchors, 9-slice bounds and the
autotile layout. The game loads only the atlas pages. Requires Pillow.

    python3 tools/build_atlas.py
"""
import json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = os.path.join(ROOT, "Tiny Swords (Free Pack)")
OUT_JS = os.path.join(ROOT, "src", "atlas-data.js")
ASSETS = os.path.join(ROOT, "assets")
PAGE = 4096
PAD = 2

if not os.path.isdir(PACK):
    sys.exit("Asset pack not found at %r. Download the free pack from https://pixelfrog-assets.itch.io/tiny-swords and unzip it there." % PACK)

def load(p):
    return Image.open(os.path.join(PACK, p)).convert("RGBA")

def segs(flags):
    out, start = [], None
    for i, v in enumerate(flags):
        if v and start is None: start = i
        if not v and start is not None: out.append((start, i)); start = None
    if start is not None: out.append((start, len(flags)))
    return out

def projections(im):
    a = im.split()[3]; w, h = im.size
    return segs([a.crop((x, 0, x + 1, h)).getbbox() is not None for x in range(w)]), segs([a.crop((0, y, w, y + 1)).getbbox() is not None for y in range(h)])

# ---------------------------------------------------------------------------
# Item collection: every entry is (kind, key, image, meta). Images are cropped
# to what the game needs; the packer places them and fills in atlas coords.
# ---------------------------------------------------------------------------
items = []      # dicts: key, kind, frames:[(img, meta)], ...
sheets = {}

def sheet(key, path, fw=None, fh=None, anchor="feet", ax=None, ay=None):
    im = load(path); a = im.split()[3]
    fw = fw or im.width; fh = fh or im.height
    n = im.width // fw
    frames = []; ux = uy = 10**9; ux2 = uy2 = -1
    for i in range(n):
        bb = a.crop((i * fw, 0, (i + 1) * fw, fh)).getbbox()
        if bb is None: bb = (0, 0, 1, 1)
        x0, y0, x1, y1 = bb
        frames.append({"tx": x0, "ty": y0, "tw": x1 - x0, "th": y1 - y0, "img": im.crop((i * fw + x0, y0, i * fw + x1, y1))})
        ux, uy, ux2, uy2 = min(ux, x0), min(uy, y0), max(ux2, x1), max(uy2, y1)
    if ax is None: ax = fw // 2 if anchor in ("feet", "center", "top") else 0
    if ay is None: ay = {"feet": uy2, "center": fh // 2, "top": 0, "tl": 0}[anchor]
    sheets[key] = {"fw": fw, "fh": fh, "n": n, "ax": ax, "ay": ay, "frames": frames}
    items.append({"kind": "sheet", "key": key, "imgs": [f["img"] for f in frames]})

UNIT_FEET = {"warrior": 137, "archer": 136, "pawn": 135, "monk": 134}
for color in ["Blue", "Red", "Black"]:
    c = color.lower(); U = "Units/%s Units/" % color
    for anim in ["Idle", "Run", "Attack1", "Attack2"] + (["Guard"] if color == "Blue" else []):
        sheet("warrior_%s_%s" % (c, anim.lower()), U + "Warrior/Warrior_%s.png" % anim, 192, 192, ay=UNIT_FEET["warrior"])
    if color == "Blue":
        continue
    sheet("pawn_%s_idle" % c, U + "Pawn/Pawn_Idle.png", 192, 192, ay=UNIT_FEET["pawn"])
    sheet("pawn_%s_run" % c, U + "Pawn/Pawn_Run.png", 192, 192, ay=UNIT_FEET["pawn"])
    sheet("pawn_%s_attack" % c, U + "Pawn/Pawn_Interact Knife.png", 192, 192, ay=UNIT_FEET["pawn"])
    sheet("archer_%s_idle" % c, U + "Archer/Archer_Idle.png", 192, 192, ay=UNIT_FEET["archer"])
    sheet("archer_%s_run" % c, U + "Archer/Archer_Run.png", 192, 192, ay=UNIT_FEET["archer"])
    sheet("archer_%s_shoot" % c, U + "Archer/Archer_Shoot.png", 192, 192, ay=UNIT_FEET["archer"])
    if color == "Red":
        sheet("arrow_red", U + "Archer/Arrow.png", 64, 64, anchor="center")
    sheet("monk_%s_idle" % c, U + "Monk/Idle.png", 192, 192, ay=UNIT_FEET["monk"])
    sheet("monk_%s_run" % c, U + "Monk/Run.png", 192, 192, ay=UNIT_FEET["monk"])
    sheet("monk_%s_heal" % c, U + "Monk/Heal.png", 192, 192, ay=UNIT_FEET["monk"])
    sheet("monk_%s_healfx" % c, U + "Monk/Heal_Effect.png", 192, 192, ay=UNIT_FEET["monk"])
    L = U + "Lancer/"
    sheet("lancer_%s_idle" % c, L + "Lancer_Idle.png", 320, 320, ax=150, ay=198)
    sheet("lancer_%s_run" % c, L + "Lancer_Run.png", 320, 320, ax=150, ay=198)
    for d in ["Right", "UpRight", "DownRight", "Up", "Down"]:
        sheet("lancer_%s_attack_%s" % (c, d.lower()), L + "Lancer_%s_Attack.png" % d, 320, 320, ax=150, ay=198)
        sheet("lancer_%s_defence_%s" % (c, d.lower()), L + "Lancer_%s_Defence.png" % d, 320, 320, ax=150, ay=198)

T = "Terrain/"
sheet("foam", T + "Tileset/Water Foam.png", 192, 192, anchor="center")
sheet("shadow", T + "Tileset/Shadow.png", 192, 192, anchor="center")
for i in (1, 2): sheet("tree%d" % i, T + "Resources/Wood/Trees/Tree%d.png" % i, 192, 256)
for i in (3, 4): sheet("tree%d" % i, T + "Resources/Wood/Trees/Tree%d.png" % i, 192, 192)
for i in range(1, 5):
    sheet("stump%d" % i, T + "Resources/Wood/Trees/Stump %d.png" % i, 192, 256)
    sheet("bush%d" % i, T + "Decorations/Bushes/Bushe%d.png" % i, 128, 128)
    sheet("rock%d" % i, T + "Decorations/Rocks/Rock%d.png" % i, 64, 64)
    sheet("wrock%d" % i, T + "Decorations/Rocks in the Water/Water Rocks_0%d.png" % i, 64, 64, anchor="center")
sheet("duck", T + "Decorations/Rubber Duck/Rubber duck.png", 32, 32, anchor="center")
for i in range(1, 9): sheet("cloud%d" % i, T + "Decorations/Clouds/Clouds_0%d.png" % i, anchor="center")
sheet("sheep_idle", T + "Resources/Meat/Sheep/Sheep_Idle.png", 128, 128)
sheet("sheep_move", T + "Resources/Meat/Sheep/Sheep_Move.png", 128, 128)
sheet("sheep_grass", T + "Resources/Meat/Sheep/Sheep_Grass.png", 128, 128)
sheet("gold_pick", T + "Resources/Gold/Gold Resource/Gold_Resource_Highlight.png", 128, 128, anchor="center")
for i in range(3, 7): sheet("goldstone%d" % i, T + "Resources/Gold/Gold Stones/Gold Stone %d.png" % i, 128, 128)
sheet("meat", T + "Resources/Meat/Meat Resource/Meat Resource.png", 64, 64, anchor="center")
for b in ["Castle", "Tower", "House1", "House2"]:
    sheet("%s_blue" % b.lower(), "Buildings/Blue Buildings/%s.png" % b)
F = "Particle FX/"
sheet("fx_explosion1", F + "Explosion_01.png", 192, 192, anchor="center")
sheet("fx_explosion2", F + "Explosion_02.png", 192, 192, anchor="center")
sheet("fx_dust1", F + "Dust_01.png", 64, 64, anchor="center")
sheet("fx_dust2", F + "Dust_02.png", 64, 64, anchor="center")
sheet("fx_fire3", F + "Fire_03.png", 64, 64, anchor="center")
sheet("fx_splash", F + "Water Splash.png", 192, 192, anchor="center")
UI = "UI Elements/UI Elements/"
for i in range(1, 13): sheet("icon%d" % i, UI + "Icons/Icon_%02d.png" % i, 64, 64, anchor="center")
sheet("avatar1", UI + "Human Avatars/Avatars_01.png", 256, 256, anchor="center")
sheet("cursor4", UI + "Cursors/Cursor_04.png", 128, 128, anchor="center")
sheet("bigbar_fill", UI + "Bars/BigBar_Fill.png", 64, 64, anchor="tl")
sheet("banner_slot", UI + "Banners/Banner_Slots.png", 192, 192, anchor="center")
sheet("btn_smallblueroundbutton_regular", UI + "Buttons/SmallBlueRoundButton_Regular.png", 128, 128, anchor="center")

# whole images: 9-slices, 3-slices, tilemaps (coordinates get the atlas offset baked in)
nine, three, tilemaps = {}, {}, {}
def whole(kind, key, path, extra):
    im = load(path)
    items.append({"kind": kind, "key": key, "imgs": [im], "extra": extra})
for key, path in [("paper", UI + "Papers/RegularPaper.png"), ("banner", UI + "Banners/Banner.png"), ("btn_blue", UI + "Buttons/BigBlueButton_Regular.png"),
                  ("btn_blue_pressed", UI + "Buttons/BigBlueButton_Pressed.png"), ("btn_red", UI + "Buttons/BigRedButton_Regular.png"), ("btn_red_pressed", UI + "Buttons/BigRedButton_Pressed.png")]:
    im = load(path); xs, ys = projections(im); assert len(xs) == 3 and len(ys) == 3, key
    whole("nine", key, path, {"xs": [v for s in xs for v in s], "ys": [v for s in ys for v in s]})
for key, path in [("bigbar", UI + "Bars/BigBar_Base.png"), ("smallbar", UI + "Bars/SmallBar_Base.png"), ("ribbon_big", UI + "Ribbons/BigRibbons.png"), ("ribbon_small", UI + "Ribbons/SmallRibbons.png")]:
    im = load(path); xs, ys = projections(im); assert len(xs) == 3, key
    whole("three", key, path, {"xs": [v for s in xs for v in s], "rows": [list(r) for r in ys]})
for key, path in [("grass1", T + "Tileset/Tilemap_color1.png"), ("grass2", T + "Tileset/Tilemap_color2.png")]:
    whole("tilemap", key, path, {})

# ---------------------------------------------------------------------------
# Shelf packer: items are placed as groups so a sheet never spans two pages.
# ---------------------------------------------------------------------------
class Page:
    def __init__(self):
        self.x = PAD; self.y = PAD; self.rowH = 0; self.im = Image.new("RGBA", (PAGE, PAGE), (0, 0, 0, 0))
    def place(self, imgs, commit):
        x, y, rowH = self.x, self.y, self.rowH; out = []
        for im in imgs:
            w, h = im.size
            if w + 2 * PAD > PAGE or h + 2 * PAD > PAGE: raise SystemExit("image too large for a page")
            if x + w + PAD > PAGE: x = PAD; y += rowH + PAD; rowH = 0
            if y + h + PAD > PAGE: return None
            out.append((x, y)); x += w + PAD; rowH = max(rowH, h)
        if commit:
            for im, (px, py) in zip(imgs, out): self.im.paste(im, (px, py))
            self.x, self.y, self.rowH = x, y, rowH
        return out

items.sort(key=lambda it: -max(im.size[1] for im in it["imgs"]))
pages = [Page()]
for it in items:
    pos = pages[-1].place(it["imgs"], False)
    if pos is None:
        pages.append(Page()); pos = pages[-1].place(it["imgs"], False)
        if pos is None: raise SystemExit("cannot place " + it["key"])
    pages[-1].place(it["imgs"], True)
    it["page"] = len(pages) - 1; it["pos"] = pos

os.makedirs(ASSETS, exist_ok=True)
for old in os.listdir(ASSETS):
    if old.startswith("atlas-") and old.endswith(".png"): os.remove(os.path.join(ASSETS, old))
page_files = []
for i, pg in enumerate(pages):
    # crop unused bottom rows to keep the file small
    used_h = min(PAGE, pg.y + pg.rowH + PAD)
    pg.im.crop((0, 0, PAGE, used_h)).save(os.path.join(ASSETS, "atlas-%d.png" % i), optimize=True)
    page_files.append("assets/atlas-%d.png" % i)
load(UI + "Cursors/Cursor_01.png").save(os.path.join(ASSETS, "cursor.png"))

out_sheets = {}
for it in items:
    if it["kind"] == "sheet":
        s = sheets[it["key"]]; t = []
        for f, (px, py) in zip(s["frames"], it["pos"]):
            t += [f["tx"], f["ty"], f["tw"], f["th"], px, py]
        rec = {"pg": it["page"], "fw": s["fw"], "fh": s["fh"], "n": s["n"], "ax": s["ax"], "ay": s["ay"], "t": t}
        if s["n"] == 1:  # single frames: `u` is the atlas rect of the trimmed image (used by imageWorld draws)
            f = s["frames"][0]; px, py = it["pos"][0]; rec["u"] = [px, py, f["tw"], f["th"]]
        out_sheets[it["key"]] = rec
    else:
        ox, oy = it["pos"][0]; e = it["extra"]
        if it["kind"] == "nine": nine[it["key"]] = {"pg": it["page"], "xs": [ox + v for v in e["xs"]], "ys": [oy + v for v in e["ys"]]}
        elif it["kind"] == "three": three[it["key"]] = {"pg": it["page"], "xs": [ox + v for v in e["xs"]], "rows": [[oy + r[0], oy + r[1]] for r in e["rows"]]}
        else: tilemaps[it["key"]] = {"pg": it["page"], "ox": ox, "oy": oy}

LAYOUT = {15: (1, 1), 14: (1, 0), 11: (1, 2), 7: (0, 1), 13: (2, 1), 6: (0, 0), 12: (2, 0), 3: (0, 2),
          9: (2, 2), 10: (1, 3), 2: (0, 3), 8: (2, 3), 5: (3, 1), 4: (3, 0), 1: (3, 2), 0: (3, 3)}
water = load(T + "Tileset/Water Background color.png").getpixel((3, 3))
data = {"pages": page_files, "cursor": "assets/cursor.png", "water": "#%02x%02x%02x" % water[:3],
        "tilemaps": tilemaps, "blob": [list(LAYOUT[m]) for m in range(16)], "sheets": out_sheets, "nine": nine, "three": three}
with open(OUT_JS, "w") as f:
    f.write("// GENERATED by tools/build_atlas.py. Frame data for assets/atlas-*.png; art (c) Pixel Frog, see CREDITS.md.\n")
    f.write("// sheets[key]: pg=page fw/fh=frame size n=frames ax/ay=anchor t=[trimX,trimY,w,h,atlasX,atlasY]*n u=atlas rect (single frames)\n")
    f.write("const TS_ATLAS = " + json.dumps(data, separators=(",", ":")) + ";\n")
total_px = sum(im.size[0] * im.size[1] for it in items for im in it["imgs"])
print("packed %d items (%d sheets, %.1f Mpx of sprites) into %d page(s); %s; wrote %s (%d KB)" % (
    len(items), len(out_sheets), total_px / 1e6, len(pages), ", ".join("%s %dx%d %dKB" % (p, PAGE, pages[i].y + pages[i].rowH + PAD, os.path.getsize(os.path.join(ROOT, p)) // 1024) for i, p in enumerate(page_files)), OUT_JS, os.path.getsize(OUT_JS) // 1024))
