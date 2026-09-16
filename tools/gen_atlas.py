#!/usr/bin/env python3
"""Generate src/atlas-data.js: per-frame trim boxes, anchors, 9-slice bounds and
autotile layout for the Tiny Swords free pack. Run from the repo root:
    python3 tools/gen_atlas.py
Requires Pillow. Output is committed so the game runs without Python."""
import json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "Tiny Swords (Free Pack)/"
OUT = os.path.join(ROOT, "src", "atlas-data.js")

def load(p):
    return Image.open(os.path.join(ROOT, BASE + p)).convert("RGBA")

def segs(flags):
    out, start = [], None
    for i, v in enumerate(flags):
        if v and start is None: start = i
        if not v and start is not None: out.append((start, i)); start = None
    if start is not None: out.append((start, len(flags)))
    return out

def projections(im):
    a = im.split()[3]; w, h = im.size
    cols = [a.crop((x, 0, x + 1, h)).getbbox() is not None for x in range(w)]
    rows = [a.crop((0, y, w, y + 1)).getbbox() is not None for y in range(h)]
    return segs(cols), segs(rows)

sheets = {}
def sheet(key, path, fw=None, fh=None, anchor="feet", ax=None, ay=None):
    im = load(path); a = im.split()[3]
    fw = fw or im.width; fh = fh or im.height
    n = im.width // fw
    trims = []; ux = uy = 10**9; ux2 = uy2 = -1
    for i in range(n):
        bb = a.crop((i * fw, 0, (i + 1) * fw, fh)).getbbox()
        if bb is None: bb = (0, 0, 1, 1)
        x0, y0, x1, y1 = bb
        trims += [x0, y0, x1 - x0, y1 - y0]
        ux, uy, ux2, uy2 = min(ux, x0), min(uy, y0), max(ux2, x1), max(uy2, y1)
    if ax is None:
        ax = fw // 2 if anchor in ("feet", "center", "top") else 0
    if ay is None:
        ay = {"feet": uy2, "center": fh // 2, "top": 0, "tl": 0}[anchor]
    sheets[key] = {"p": path, "fw": fw, "fh": fh, "n": n, "ax": ax, "ay": ay,
                   "u": [ux, uy, ux2 - ux, uy2 - uy], "t": trims}
    return sheets[key]

# ---- Units -------------------------------------------------------------
UNIT_FEET = {"warrior": 137, "archer": 136, "pawn": 135, "monk": 134}
for color in ["Blue", "Red", "Black"]:
    c = color.lower(); U = f"Units/{color} Units/"
    if color in ("Blue",):
        pass
    sheet(f"warrior_{c}_idle", U + "Warrior/Warrior_Idle.png", 192, 192, ay=UNIT_FEET["warrior"])
    sheet(f"warrior_{c}_run", U + "Warrior/Warrior_Run.png", 192, 192, ay=UNIT_FEET["warrior"])
    sheet(f"warrior_{c}_attack1", U + "Warrior/Warrior_Attack1.png", 192, 192, ay=UNIT_FEET["warrior"])
    sheet(f"warrior_{c}_attack2", U + "Warrior/Warrior_Attack2.png", 192, 192, ay=UNIT_FEET["warrior"])
    sheet(f"warrior_{c}_guard", U + "Warrior/Warrior_Guard.png", 192, 192, ay=UNIT_FEET["warrior"])
    if color == "Blue":
        continue  # player only needs the warrior
    sheet(f"pawn_{c}_idle", U + "Pawn/Pawn_Idle.png", 192, 192, ay=UNIT_FEET["pawn"])
    sheet(f"pawn_{c}_run", U + "Pawn/Pawn_Run.png", 192, 192, ay=UNIT_FEET["pawn"])
    sheet(f"pawn_{c}_attack", U + "Pawn/Pawn_Interact Knife.png", 192, 192, ay=UNIT_FEET["pawn"])
    sheet(f"pawn_{c}_axe", U + "Pawn/Pawn_Interact Axe.png", 192, 192, ay=UNIT_FEET["pawn"])
    sheet(f"archer_{c}_idle", U + "Archer/Archer_Idle.png", 192, 192, ay=UNIT_FEET["archer"])
    sheet(f"archer_{c}_run", U + "Archer/Archer_Run.png", 192, 192, ay=UNIT_FEET["archer"])
    sheet(f"archer_{c}_shoot", U + "Archer/Archer_Shoot.png", 192, 192, ay=UNIT_FEET["archer"])
    sheet(f"arrow_{c}", U + "Archer/Arrow.png", 64, 64, anchor="center")
    sheet(f"monk_{c}_idle", U + "Monk/Idle.png", 192, 192, ay=UNIT_FEET["monk"])
    sheet(f"monk_{c}_run", U + "Monk/Run.png", 192, 192, ay=UNIT_FEET["monk"])
    sheet(f"monk_{c}_heal", U + "Monk/Heal.png", 192, 192, ay=UNIT_FEET["monk"])
    sheet(f"monk_{c}_healfx", U + "Monk/Heal_Effect.png", 192, 192, ay=UNIT_FEET["monk"])
    L = U + "Lancer/"
    sheet(f"lancer_{c}_idle", L + "Lancer_Idle.png", 320, 320, ax=150, ay=198)
    sheet(f"lancer_{c}_run", L + "Lancer_Run.png", 320, 320, ax=150, ay=198)
    for d in ["Right", "UpRight", "DownRight", "Up", "Down"]:
        sheet(f"lancer_{c}_attack_{d.lower()}", L + f"Lancer_{d}_Attack.png", 320, 320, ax=150, ay=198)
        sheet(f"lancer_{c}_defence_{d.lower()}", L + f"Lancer_{d}_Defence.png", 320, 320, ax=150, ay=198)

# ---- Terrain / decor ---------------------------------------------------
T = "Terrain/"
sheet("foam", T + "Tileset/Water Foam.png", 192, 192, anchor="center")
sheet("shadow", T + "Tileset/Shadow.png", 192, 192, anchor="center")
for i in (1, 2):
    sheet(f"tree{i}", T + f"Resources/Wood/Trees/Tree{i}.png", 192, 256)
for i in (3, 4):
    sheet(f"tree{i}", T + f"Resources/Wood/Trees/Tree{i}.png", 192, 192)
for i in range(1, 5):
    sheet(f"stump{i}", T + f"Resources/Wood/Trees/Stump {i}.png", 192, 256)
    sheet(f"bush{i}", T + f"Decorations/Bushes/Bushe{i}.png", 128, 128)
    sheet(f"rock{i}", T + f"Decorations/Rocks/Rock{i}.png", 64, 64)
    sheet(f"wrock{i}", T + f"Decorations/Rocks in the Water/Water Rocks_0{i}.png", 64, 64, anchor="center")
sheet("duck", T + "Decorations/Rubber Duck/Rubber duck.png", 32, 32, anchor="center")
for i in range(1, 9):
    sheet(f"cloud{i}", T + f"Decorations/Clouds/Clouds_0{i}.png", anchor="center")
sheet("sheep_idle", T + "Resources/Meat/Sheep/Sheep_Idle.png", 128, 128)
sheet("sheep_move", T + "Resources/Meat/Sheep/Sheep_Move.png", 128, 128)
sheet("sheep_grass", T + "Resources/Meat/Sheep/Sheep_Grass.png", 128, 128)
sheet("gold_pick", T + "Resources/Gold/Gold Resource/Gold_Resource_Highlight.png", 128, 128, anchor="center")
for i in range(1, 7):
    sheet(f"goldstone{i}", T + f"Resources/Gold/Gold Stones/Gold Stone {i}.png", 128, 128)
sheet("meat", T + "Resources/Meat/Meat Resource/Meat Resource.png", 64, 64, anchor="center")
sheet("wood", T + "Resources/Wood/Wood Resource/Wood Resource.png", 64, 64, anchor="center")
for i in range(1, 5):
    sheet(f"tool{i}", T + f"Resources/Tools/Tool_0{i}.png", 64, 64, anchor="center")
B = "Buildings/"
for color in ["Blue"]:
    c = color.lower()
    for b in ["Castle", "Tower", "Barracks", "Archery", "House1", "House2", "House3", "Monastery"]:
        sheet(f"{b.lower()}_{c}", B + f"{color} Buildings/{b}.png")
# ---- FX ----------------------------------------------------------------
F = "Particle FX/"
sheet("fx_explosion1", F + "Explosion_01.png", 192, 192, anchor="center")
sheet("fx_explosion2", F + "Explosion_02.png", 192, 192, anchor="center")
sheet("fx_dust1", F + "Dust_01.png", 64, 64, anchor="center")
sheet("fx_dust2", F + "Dust_02.png", 64, 64, anchor="center")
sheet("fx_fire1", F + "Fire_01.png", 64, 64, anchor="center")
sheet("fx_fire2", F + "Fire_02.png", 64, 64, anchor="center")
sheet("fx_fire3", F + "Fire_03.png", 64, 64, anchor="center")
sheet("fx_splash", F + "Water Splash.png", 192, 192, anchor="center")
# ---- UI ----------------------------------------------------------------
UI = "UI Elements/UI Elements/"
for i in range(1, 13):
    sheet(f"icon{i}", UI + f"Icons/Icon_{i:02d}.png", 64, 64, anchor="center")
for i in range(1, 4):
    sheet(f"avatar{i}", UI + f"Human Avatars/Avatars_{i:02d}.png", 256, 256, anchor="center")
sheet("cursor1", UI + "Cursors/Cursor_01.png", 64, 64, anchor="tl")
sheet("cursor2", UI + "Cursors/Cursor_02.png", 64, 64, anchor="tl")
sheet("cursor3", UI + "Cursors/Cursor_03.png", 64, 64, anchor="tl")
sheet("cursor4", UI + "Cursors/Cursor_04.png", 128, 128, anchor="center")
sheet("bigbar_fill", UI + "Bars/BigBar_Fill.png", 64, 64, anchor="tl")
sheet("smallbar_fill", UI + "Bars/SmallBar_Fill.png", 64, 64, anchor="tl")
sheet("banner_slot", UI + "Banners/Banner_Slots.png", 192, 192, anchor="center")
sheet("table_slot", UI + "Wood Table/WoodTable_Slots.png", 192, 192, anchor="center")
for nm in ["SmallBlueRoundButton_Regular", "SmallBlueRoundButton_Pressed", "SmallRedRoundButton_Regular", "SmallRedRoundButton_Pressed",
           "SmallBlueSquareButton_Regular", "SmallBlueSquareButton_Pressed", "SmallRedSquareButton_Regular", "SmallRedSquareButton_Pressed"]:
    sheet("btn_" + nm.lower(), UI + f"Buttons/{nm}.png", 128, 128, anchor="center")
for nm in ["TinyRoundBlueButton", "TinyRoundRedButton", "TinySquareBlueButton", "TinySquareRedButton"]:
    sheet("btn_" + nm.lower(), UI + f"Buttons/{nm}.png", 64, 64, anchor="center")

# 9-slices & 3-slices: measured from alpha projections
nine = {}
def nine_slice(key, path):
    im = load(path); xs, ys = projections(im)
    assert len(xs) == 3 and len(ys) == 3, (key, xs, ys)
    nine[key] = {"p": path, "xs": [v for s in xs for v in s], "ys": [v for s in ys for v in s]}
nine_slice("paper", UI + "Papers/RegularPaper.png")
nine_slice("paper_special", UI + "Papers/SpecialPaper.png")
nine_slice("banner", UI + "Banners/Banner.png")
nine_slice("table", UI + "Wood Table/WoodTable.png")
nine_slice("btn_blue", UI + "Buttons/BigBlueButton_Regular.png")
nine_slice("btn_blue_pressed", UI + "Buttons/BigBlueButton_Pressed.png")
nine_slice("btn_red", UI + "Buttons/BigRedButton_Regular.png")
nine_slice("btn_red_pressed", UI + "Buttons/BigRedButton_Pressed.png")
three = {}
def three_slice(key, path, rows=None):
    im = load(path); xs, ys = projections(im)
    assert len(xs) == 3, (key, xs)
    three[key] = {"p": path, "xs": [v for s in xs for v in s], "rows": [list(r) for r in ys]}
three_slice("bigbar", UI + "Bars/BigBar_Base.png")
three_slice("smallbar", UI + "Bars/SmallBar_Base.png")
three_slice("ribbon_big", UI + "Ribbons/BigRibbons.png")      # rows: blue, red, yellow, purple, black
three_slice("ribbon_small", UI + "Ribbons/SmallRibbons.png")  # rows: 2 per color, same order

# ---- Tileset autotile analysis ------------------------------------------
tile_im = load(T + "Tileset/Tilemap_color1.png"); ta = tile_im.split()[3]
def edge_frac(col, row, side):
    x0, y0 = col * 64, row * 64
    if side == "N": strip = ta.crop((x0, y0, x0 + 64, y0 + 1))
    if side == "S": strip = ta.crop((x0, y0 + 63, x0 + 64, y0 + 64))
    if side == "W": strip = ta.crop((x0, y0, x0 + 1, y0 + 64))
    if side == "E": strip = ta.crop((x0 + 63, y0, x0 + 64, y0 + 64))
    px = list(strip.getdata()); return sum(1 for v in px if v > 0) / len(px)
def blob_map(c0):
    m = {}
    for row in range(4):
        for col in range(4):
            fr = {s: edge_frac(c0 + col, row, s) for s in "NESW"}
            mask = (1 if fr["N"] > 0.6 else 0) | (2 if fr["E"] > 0.6 else 0) | (4 if fr["S"] > 0.6 else 0) | (8 if fr["W"] > 0.6 else 0)
            m.setdefault(mask, []).append((c0 + col, row, {k: round(v, 2) for k, v in fr.items()}))
    return m
flat = blob_map(0); hi = blob_map(5)
print("flat blob masks:", {k: [(c, r) for c, r, _ in v] for k, v in sorted(flat.items())})
print("hi   blob masks:", {k: [(c, r) for c, r, _ in v] for k, v in sorted(hi.items())})
dups = {k: v for k, v in flat.items() if len(v) != 1}
# Standard 4x4 blob layout (verified against edge-opacity analysis above):
#   TL T TR Vtop / L C R Vmid / BL B BR Vbot / Hleft Hmid Hright Single
# mask bits: N=1 E=2 S=4 W=8 (bit set = grass neighbour on that side)
LAYOUT = {15: (1, 1), 14: (1, 0), 11: (1, 2), 7: (0, 1), 13: (2, 1), 6: (0, 0), 12: (2, 0), 3: (0, 2),
          9: (2, 2), 10: (1, 3), 2: (0, 3), 8: (2, 3), 5: (3, 1), 4: (3, 0), 1: (3, 2), 0: (3, 3)}
blob = [list(LAYOUT[m]) for m in range(16)]
blobHi = [[LAYOUT[m][0] + 5, LAYOUT[m][1]] for m in range(16)]
water = load(T + "Tileset/Water Background color.png").getpixel((3, 3))
print("water color", water)
# cliff rows (elevated set): row 4 = wall top, row 5 = wall bottom, cols 5..8 = left, mid, right, single
data = {
    "base": BASE,
    "water": "#%02x%02x%02x" % water[:3],
    "tilemaps": {f"grass{i}": T + f"Tileset/Tilemap_color{i}.png" for i in range(1, 6)},
    "blob": blob,
    "blobHi": blobHi,
    "cliff": {"top": [[5, 4], [6, 4], [7, 4], [8, 4]], "bottom": [[5, 5], [6, 5], [7, 5], [8, 5]]},
    "sheets": sheets, "nine": nine, "three": three,
}
with open(OUT, "w") as f:
    f.write("// GENERATED by tools/gen_atlas.py from the Tiny Swords free pack. Do not edit by hand.\n")
    f.write("// sheets[key]: p=path fw/fh=frame size n=frames ax/ay=anchor (frame coords) u=union bbox t=per-frame trim [x,y,w,h]*n\n")
    f.write("const TS_ATLAS = " + json.dumps(data, separators=(",", ":")) + ";\n")
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB;", len(sheets), "sheets", len(nine), "nine-slices", len(three), "three-slices")
