'use strict';
// On-screen touch controls: floating joystick (left half), attack + dash (bottom right), pause (top right).
// Sizes are CSS px * R.dpr (never R.ui) so every button keeps a thumb-sized footprint on any phone.
TS.Touch = class Touch {
  constructor(input, renderer) {
    this.I = input; this.R = renderer; this.A = TS.Assets;
    this.roles = new Map();        // pointerId -> 'ui' | 'pause' | 'dash' | 'attack' | 'stick'
    this.stickId = -1; this.stickOx = 0; this.stickOy = 0; this.stickX = 0; this.stickY = 0;
    this.stickDown = false; this.stickActive = false;
    this.mx = 0; this.my = 0;
    this.attack = false; this.attackPressed = false; this.dashPressed = false; this.pausePressed = false;
    this.uiHeld = false;
  }
  // --- geometry, device px -------------------------------------------------
  attackC() { const R = this.R, d = R.dpr, i = R.inset; return { x: R.W - i.r - 76 * d, y: R.H - i.b - 76 * d, r: 40 * d }; }
  dashC() { const R = this.R, d = R.dpr, i = R.inset; return { x: R.W - i.r - 150 * d, y: R.H - i.b - 58 * d, r: 32 * d }; }
  pauseR() { const R = this.R, d = R.dpr, i = R.inset; return { x: R.W - i.r - 56 * d, y: i.t + 12 * d, w: 44 * d, h: 44 * d }; }
  // The pause button reserves a 56x56 CSS square in the corner; the 44x44 art sits inside it.
  pauseHitR() { const R = this.R, d = R.dpr, i = R.inset; return { x: R.W - i.r - 56 * d, y: i.t, w: 56 * d, h: 56 * d }; }
  stickRest() { const R = this.R, d = R.dpr, i = R.inset; return { x: i.l + 110 * d, y: R.H - i.b - 110 * d }; }
  rects() {
    const R = this.R, d = R.dpr, i = R.inset, a = this.attackC(), s = this.dashC(), p = this.pauseR();
    return {
      attack: { x: a.x - a.r, y: a.y - a.r, w: a.r * 2, h: a.r * 2 },
      dash: { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 },
      pause: { x: p.x, y: p.y, w: p.w, h: p.h },
      stickZone: { x: i.l, y: R.H - i.b - 220 * d, w: 220 * d, h: 220 * d },
    };
  }
  clearEdges() { this.attackPressed = false; this.dashPressed = false; this.pausePressed = false; }
  // --- per-frame -----------------------------------------------------------
  poll(game) {
    const I = this.I, R = this.R, d = R.dpr;
    // A touch keeps its role for its whole life; drop roles whose touch has ended.
    if (this.roles.size) { for (const id of Array.from(this.roles.keys())) if (!I.touches.has(id)) this.roles.delete(id); }
    if (this.stickId >= 0 && !I.touches.has(this.stickId)) this.stickId = -1;
    const playing = game.state === 'playing';
    const s = this.dashC(), p = this.pauseHitR();
    for (let n = 0; n < I.newTouches.length; n++) {
      const id = I.newTouches[n], t = I.touches.get(id);
      if (!t) continue;
      let role = null;
      if (!playing) {
        // Menus and modals: a tap is a left click at that point, so ui.button() works unchanged.
        role = 'ui';
        I.mouseX = t.x; I.mouseY = t.y; I.clicked[0] = true; I.buttons[0] = true; this.uiHeld = true;
      } else if (t.x >= p.x && t.x < p.x + p.w && t.y >= p.y && t.y < p.y + p.h) { role = 'pause'; this.pausePressed = true; }
      else if (sqr(t.x - s.x) + sqr(t.y - s.y) <= sqr(s.r * 1.15)) { role = 'dash'; this.dashPressed = true; }
      else if (t.x >= R.W / 2) { role = 'attack'; this.attackPressed = true; }
      else if (t.y > R.inset.t + 110 * d && this.stickId < 0) { role = 'stick'; this.stickId = id; this.stickOx = t.x; this.stickOy = t.y; }
      if (role) { this.roles.set(id, role); t.role = role; }
    }
    // Held ui touch keeps the left button down so hover/pressed art reads correctly.
    let uiDown = false, uiT = -1, uiX = 0, uiY = 0;
    for (const [id, role] of this.roles) {
      if (role !== 'ui') continue;
      const t = I.touches.get(id); if (!t) continue;
      uiDown = true;
      if (t.t0 >= uiT) { uiT = t.t0; uiX = t.x; uiY = t.y; }
    }
    if (uiDown && !playing) { I.buttons[0] = true; I.mouseX = uiX; I.mouseY = uiY; this.uiHeld = true; }
    else if (this.uiHeld) { I.buttons[0] = false; this.uiHeld = false; }
    // Stick: floating origin at the touch point, dead zone 12 CSS px, full tilt at 60.
    this.stickDown = false; this.stickActive = false; this.mx = 0; this.my = 0;
    if (this.stickId >= 0) {
      const t = I.touches.get(this.stickId);
      if (t) {
        this.stickDown = true;
        const dx = t.x - this.stickOx, dy = t.y - this.stickOy, len = Math.sqrt(dx * dx + dy * dy);
        const dead = 12 * d, maxR = 60 * d, k = len > maxR ? maxR / len : 1;
        this.stickX = this.stickOx + dx * k; this.stickY = this.stickOy + dy * k;
        if (len > dead) { this.stickActive = true; this.mx = dx / len; this.my = dy / len; }
      }
    }
    this.attack = false;
    for (const [id, role] of this.roles) if (role === 'attack' && I.touches.has(id)) { this.attack = true; break; }
  }
  // --- drawing -------------------------------------------------------------
  disc(x, y, r, fill, fillA, stroke, strokeA, lw) {
    const c = this.R.ctx;
    c.beginPath(); c.arc(x, y, r, 0, TAU);
    if (fill) { c.globalAlpha = fillA; c.fillStyle = fill; c.fill(); }
    if (stroke) { c.globalAlpha = strokeA; c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
    c.globalAlpha = 1;
  }
  iconScale(sheet, frame, target) { const t = sheet.t, i = frame * 6; return target / Math.max(1, Math.max(t[i + 2], t[i + 3])); }
  draw(game) {
    const R = this.R, c = R.ctx, d = R.dpr, P = game.player, A = this.A;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    // --- joystick ---
    if (this.stickDown) {
      this.disc(this.stickOx, this.stickOy, 60 * d, '#0b0a14', 0.3, '#eaf6ff', 0.4, 3 * d);
      this.disc(this.stickX, this.stickY, 26 * d, '#eaf6ff', 0.6, '#2a1e3a', 0.5, 3 * d);
    } else {
      const rest = this.stickRest();
      this.disc(rest.x, rest.y, 60 * d, '#0b0a14', 0.14, '#eaf6ff', 0.2, 3 * d);
      this.disc(rest.x, rest.y, 26 * d, '#eaf6ff', 0.14, null, 0, 0);
    }
    // --- dash (left of and above attack) ---
    const s = this.dashC();
    this.disc(s.x, s.y, s.r, '#0b0a14', 0.34, '#eaf6ff', 0.35, 3 * d);
    const dustS = A.sheet('fx_dust2');
    R.uiSpriteCentered(dustS, 1, s.x, s.y, this.iconScale(dustS, 1, s.r * 1.4));
    const cdMax = P.dashCdMax || 1, cd = clamp((P.dashCd || 0) / cdMax, 0, 1);
    if (cd > 0.001) {
      c.globalAlpha = 0.6; c.fillStyle = '#0b0a14';
      c.beginPath(); c.moveTo(s.x, s.y); c.arc(s.x, s.y, s.r, -PI / 2, -PI / 2 + TAU * cd); c.closePath(); c.fill();
      c.globalAlpha = 1;
    }
    // --- attack ---
    const a = this.attackC(), held = this.attack;
    this.disc(a.x, a.y, a.r, held ? '#2a1e3a' : '#0b0a14', held ? 0.5 : 0.34, '#eaf6ff', held ? 0.55 : 0.35, 3 * d);
    const swordS = A.sheet('warrior_blue_attack1');
    c.globalAlpha = held ? 0.7 : 1;
    R.uiSpriteCentered(swordS, 2, a.x, a.y, this.iconScale(swordS, 2, a.r * 1.3));
    c.globalAlpha = 1;
    // --- pause ---
    const p = this.pauseR();
    R.nine('btn_blue', p.x, p.y, p.w, p.h, d * 0.3);
    c.fillStyle = '#eaf6ff';
    const bw = 5 * d, bh = 18 * d, bx = p.x + p.w / 2, by = p.y + p.h / 2;
    c.fillRect(Math.round(bx - bw * 1.6), Math.round(by - bh / 2), Math.round(bw), Math.round(bh));
    c.fillRect(Math.round(bx + bw * 0.6), Math.round(by - bh / 2), Math.round(bw), Math.round(bh));
    R.drawCalls += 8;
    c.restore();
    R.lastFont = '';
  }
};
