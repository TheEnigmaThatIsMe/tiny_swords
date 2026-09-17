'use strict';
// HUD, menus and immediate-mode buttons. All coordinates are device pixels; `u` is the UI scale.
const RIBBON = { blue: 0, red: 1, yellow: 2, purple: 3, black: 4 };
TS.UI = class UI {
  constructor(R, input) {
    this.R = R; this.input = input; this.clickedId = null; this.hoverCard = -1; this.vignette = null; this.vigW = 0; this.vigH = 0;
    this.A = TS.Assets;
  }
  consumeClick(id) { if (this.clickedId === id) { this.clickedId = null; return true; } return false; }
  // --- primitives ----------------------------------------------------------
  ribbon(text, cx, y, style, size, minW) {
    const R = this.R, u = R.ui, sc = u * 0.55;
    const tw = R.textWidth(text, size); const w = Math.max(minW || 0, tw + 150 * sc);
    const h = R.three('ribbon_big', RIBBON[style], cx - w / 2, y, w, sc);
    R.text(text, cx, y + h * 0.47, size, '#fff8e7', 'center', 'middle', '#2a1e3a', size * 0.16);
    return h;
  }
  smallRibbon(text, cx, y, style, size, minW) {
    const R = this.R, u = R.ui, sc = u * 0.55;
    const tw = R.textWidth(text, size); const w = Math.max(minW || 0, tw + 90 * sc);
    const h = R.three('ribbon_small', RIBBON[style] * 2, cx - w / 2, y, w, sc);
    R.text(text, cx, y + h * 0.42, size, '#fff8e7', 'center', 'middle', '#2a1e3a', size * 0.16);
    return h;
  }
  panel(x, y, w, h, key) { this.R.nine(key || 'paper', x, y, w, h, this.R.ui * 0.5); }
  button(id, label, cx, cy, w, h, red) {
    const R = this.R, I = this.input, x = cx - w / 2, y = cy - h / 2;
    const hover = I.mouseIn(x, y, w, h);
    const pressed = hover && I.buttons[0];
    R.nine((red ? 'btn_red' : 'btn_blue') + (pressed ? '_pressed' : ''), x, y + (pressed ? 3 : 0), w, h, R.ui * 0.5);
    R.text(label, cx, cy + (pressed ? 4 : -2), h * 0.36, hover ? '#ffffff' : '#eaf6ff', 'center', 'middle', '#173544', h * 0.06);
    if (hover && I.clicked[0]) this.clickedId = id;
    return hover;
  }
  overlay(alpha) { this.R.rect(0, 0, this.R.W, this.R.H, '#0b0a14', alpha); }
  wrap(str, size, maxW) {
    const words = str.split(' '), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (this.R.textWidth(t, size) > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  }
  // --- HUD -----------------------------------------------------------------
  drawHUD(g) {
    const R = this.R, u = R.ui, P = g.player, A = this.A;
    // portrait
    R.uiSprite(A.sheet('banner_slot'), 0, 16 * u + 42 * u, 16 * u + 42 * u, u * 0.45);
    R.uiSprite(A.sheet('avatar1'), 0, 16 * u + 42 * u, 16 * u + 40 * u, u * 0.36);
    // HP bar
    const bx = 110 * u, by = 20 * u, bw = 300 * u, bs = u * 0.6;
    const fillS = A.sheet('bigbar_fill');
    const innerX = bx + 12 * bs, innerW = bw - 24 * bs;
    const frac = clamp(P.hp / P.maxHp, 0, 1);
    // The base sprites are opaque in the middle, so fills are drawn on top, inset to the recess (rows 20-43 of the big bar).
    R.three('bigbar', 0, bx, by, bw, bs);
    if (frac > 0) R.ctx.drawImage(fillS.img, 0, 20, 64, 24, Math.round(innerX), Math.round(by + 11 * bs), Math.max(2, Math.round(innerW * frac)), Math.round(24 * bs));
    R.text(Math.ceil(P.hp) + ' / ' + P.maxHp, bx + bw / 2, by + 24 * bs, 13 * u, '#fff', 'center', 'middle');
    // XP bar (small bar recess is rows 30-35, starting 10px into the left cap)
    const xy = by + 38 * u, xs = u * 0.85;
    const xInner = bx + 10 * xs, xInnerW = bw - 20 * xs, xFrac = clamp(P.xp / P.xpNext, 0, 1);
    R.three('smallbar', 0, bx, xy, bw, xs);
    if (xFrac > 0) { const fw = Math.max(2, Math.round(xInnerW * xFrac)); R.rect(xInner, xy + 8 * xs, fw, 6 * xs, '#ffd54a'); R.rect(xInner, xy + 8 * xs, fw, 2 * xs, '#fff3b0'); }
    R.text('LV ' + P.level, bx + bw + 10 * u, xy + 9 * xs, 15 * u, '#ffd54a', 'left', 'middle');
    R.text(Math.floor(P.xp) + ' / ' + P.xpNext + ' XP', bx + bw / 2, xy + 9 * xs, 9 * u, '#fff', 'center', 'middle', '#1e1a2e', 2 * u);
    // timer
    const timeLeft = Math.max(0, TS.CFG.RUN_SECONDS - g.time);
    this.smallRibbon(fmtTime(g.time), R.W / 2, 12 * u, 'yellow', 22 * u, 150 * u);
    R.text('DAWN IN ' + fmtTime(timeLeft), R.W / 2, 50 * u, 12 * u, '#fff', 'center', 'middle');
    if (g.wave > 0) R.text('WAVE ' + g.wave, R.W / 2, 66 * u, 12 * u, '#ffd54a', 'center', 'middle');
    // score / kills
    const pop = 1 + g.scorePop * 1.6;
    R.text('SCORE', R.W - 20 * u, 22 * u, 12 * u, '#ffd54a', 'right', 'middle');
    R.text(fmtNum(g.score), R.W - 20 * u, 44 * u, 24 * u * pop, '#fff', 'right', 'middle');
    R.text('KILLS ' + g.kills, R.W - 20 * u, 68 * u, 13 * u, '#fff', 'right', 'middle');
    if (g.combo >= 3 && g.comboT > 0) {
      const k = g.comboT / 2, tier = g.combo >= 20 ? '#ff4d4d' : g.combo >= 10 ? '#ff9f40' : g.combo >= 5 ? '#ffd54a' : '#ffffff';
      const sz = (20 + Math.min(14, g.combo * 0.6)) * u * (1 + g.comboPop * 0.6);
      R.text('x' + g.combo + ' COMBO', R.W - 20 * u, 100 * u, sz, tier, 'right', 'middle');
      R.rect(R.W - 20 * u - 120 * u, 116 * u, 120 * u, 4 * u, '#2b2540'); R.rect(R.W - 20 * u - 120 * u * k, 116 * u, 120 * u * k, 4 * u, tier);
    }
    // boss bar
    if (g.boss && g.boss.alive) {
      const b = g.boss, w = 420 * u, x = R.W / 2 - w / 2, y = 84 * u, s = u * 0.55;
      R.text('THE WARLORD', R.W / 2, y - 8 * u, 13 * u, '#ff8080', 'center', 'middle');
      const ix = x + 12 * s, iw = w - 24 * s, bf = clamp(b.hp / b.maxHp, 0, 1);
      R.three('bigbar', 0, x, y, w, s);
      if (bf > 0) R.ctx.drawImage(fillS.img, 0, 20, 64, 24, Math.round(ix), Math.round(y + 11 * s), Math.max(2, Math.round(iw * bf)), Math.round(24 * s));
    }
    // dash + mute (bottom-left)
    const dx = 46 * u, dy = R.H - 46 * u;
    R.uiSprite(A.sheet('btn_smallblueroundbutton_regular'), 0, dx, dy, u * 0.6);
    R.uiSprite(A.sheet('icon8'), 0, dx, dy, u * 0.6);
    if (P.dashCd > 0) {
      const c = R.ctx, f = P.dashCd / P.dashCdMax;
      c.globalAlpha = 0.6; c.fillStyle = '#0b0a14'; c.beginPath(); c.moveTo(dx, dy); c.arc(dx, dy, 26 * u, -PI / 2, -PI / 2 + TAU * f); c.closePath(); c.fill(); c.globalAlpha = 1;
    }
    R.text('DASH', dx, dy + 36 * u, 10 * u, '#fff', 'center', 'middle');
    const mx = dx + 70 * u;
    R.uiSprite(A.sheet('icon12'), 0, mx, dy, u * 0.5, SFX.isMuted() ? 0.4 : 1);
    if (SFX.isMuted()) R.uiSprite(A.sheet('icon9'), 0, mx + 8 * u, dy - 8 * u, u * 0.3);
    R.text('M', mx, dy + 36 * u, 10 * u, '#fff', 'center', 'middle');
    // hint
    if (g.hintT > 0) {
      R.ctx.globalAlpha = Math.min(1, g.hintT);
      R.text('WASD move  ·  mouse aim  ·  click / space attack  ·  shift / right-click dash', R.W / 2, R.H - 26 * u, 13 * u, '#fff', 'center', 'middle');
      R.ctx.globalAlpha = 1;
    }
    // low hp vignette
    if (P.hp / P.maxHp < 0.35 && P.alive) {
      if (!this.vignette || this.vigW !== R.W || this.vigH !== R.H) {
        const gr = R.ctx.createRadialGradient(R.W / 2, R.H / 2, R.H * 0.35, R.W / 2, R.H / 2, R.H * 0.85);
        gr.addColorStop(0, 'rgba(180,0,0,0)'); gr.addColorStop(1, 'rgba(180,0,0,1)'); this.vignette = gr; this.vigW = R.W; this.vigH = R.H;
      }
      const c = R.ctx; c.globalAlpha = 0.28 + 0.14 * Math.sin(g.time * 7); c.fillStyle = this.vignette; c.fillRect(0, 0, R.W, R.H); c.globalAlpha = 1;
    }
    this.drawAnnouncement(g);
  }
  drawAnnouncement(g) {
    const a = g.announcement; if (!a) return;
    const R = this.R, u = R.ui, k = a.t / a.dur;
    let sc = 1, alpha = 1;
    if (a.t < 0.25) sc = 0.6 + 1.6 * (a.t / 0.25) - 1.2 * sqr(a.t / 0.25); // pop-in
    if (k > 0.8) alpha = (1 - k) / 0.2;
    R.ctx.globalAlpha = alpha;
    this.ribbon(a.text, R.W / 2, R.H * 0.22, a.style, 30 * u * sc, 320 * u * sc);
    if (a.sub) R.text(a.sub, R.W / 2, R.H * 0.22 + 70 * u, 15 * u, '#fff', 'center', 'middle');
    R.ctx.globalAlpha = 1;
  }
  drawFps(g) {
    const R = this.R, u = R.ui, s = g.stats;
    const x = R.W - 230 * u, y = 130 * u;
    R.rect(x, y, 214 * u, 74 * u, '#0b0a14', 0.65);
    R.text('FPS ' + s.fps.toFixed(0) + '   ' + s.frameMs.toFixed(1) + ' ms/frame', x + 8 * u, y + 16 * u, 12 * u, s.fps < 50 ? '#ff8080' : '#7CFC8A', 'left', 'middle', null);
    R.text('update ' + s.updateMs.toFixed(2) + ' ms   draw ' + s.drawMs.toFixed(2) + ' ms', x + 8 * u, y + 34 * u, 11 * u, '#fff', 'left', 'middle', null);
    R.text('enemies ' + s.enemies + '  fx ' + s.fxCount + '  draws ' + s.draws, x + 8 * u, y + 50 * u, 11 * u, '#fff', 'left', 'middle', null);
    R.text('zoom ' + R.zoom + '  ' + R.W + 'x' + R.H + '  F to hide', x + 8 * u, y + 65 * u, 10 * u, '#bbb', 'left', 'middle', null);
  }
  // --- screens ---------------------------------------------------------------
  drawMenu(g) {
    const R = this.R, u = R.ui, W = R.W, H = R.H;
    this.overlay(0.22);
    this.ribbon('TINY SWORDS', W / 2, H * 0.09, 'blue', 46 * u, 520 * u);
    this.smallRibbon('LAST STAND', W / 2, H * 0.09 + 78 * u, 'yellow', 22 * u, 220 * u);
    const pw = Math.min(W - 40 * u, 720 * u), ph = 228 * u, px = W / 2 - pw / 2, py = H * 0.09 + 132 * u;
    this.panel(px, py, pw, ph);
    const tx = px + 34 * u; let ty = py + 40 * u;
    R.text('Hold the island until dawn (10:00). Slay the horde, level up, pick upgrades.', W / 2, ty, 14 * u, '#3b2a1a', 'center', 'middle', null); ty += 22 * u;
    R.text('Chain sword swings to hit crowds. Dash through danger. Fall, and the night wins.', W / 2, ty, 14 * u, '#3b2a1a', 'center', 'middle', null); ty += 36 * u;
    const lines = [['WASD / Arrows', 'Move'], ['Mouse', 'Aim'], ['Left click / Space', 'Attack (hold to chain)'], ['Shift / Right click', 'Dash (invulnerable)'], ['Esc / P', 'Pause'], ['M  ·  F', 'Mute  ·  FPS counter']];
    for (let i = 0; i < lines.length; i++) {
      const col = i % 2, row = (i / 2) | 0, cx = px + (col ? pw * 0.5 : 0) + 34 * u, cy = ty + row * 26 * u;
      R.text(lines[i][0], cx, cy, 12.5 * u, '#7a2d1a', 'left', 'middle', null);
      R.text(lines[i][1], cx + 148 * u, cy, 12.5 * u, '#3b2a1a', 'left', 'middle', null);
    }
    ty += 3 * 26 * u + 4 * u;
    if (g.best) R.text('BEST   ' + fmtNum(g.best.score) + ' pts   ·   ' + fmtTime(g.best.time) + '   ·   level ' + g.best.level, W / 2, ty, 14 * u, '#7a2d1a', 'center', 'middle', null);
    else R.text('No runs yet. Good luck.', W / 2, ty, 14 * u, '#7a2d1a', 'center', 'middle', null);
    this.button('play', 'PLAY', W / 2, py + ph + 56 * u, 240 * u, 76 * u, false);
    R.text('or press ENTER', W / 2, py + ph + 110 * u, 12 * u, '#fff', 'center', 'middle');
    R.text('Art: Tiny Swords by Pixel Frog (free pack)  ·  audio synthesized in-browser  ·  no downloads, no dependencies', W / 2, H - 16 * u, 11 * u, '#fff', 'center', 'middle');
  }
  drawEnd(g, won) {
    const R = this.R, u = R.ui, W = R.W, H = R.H;
    this.overlay(0.55);
    this.ribbon(won ? 'DAWN BREAKS' : 'FALLEN', W / 2, H * 0.12, won ? 'yellow' : 'red', 44 * u, 420 * u);
    R.text(won ? 'You held the line until sunrise.' : 'The night took the island.', W / 2, H * 0.12 + 92 * u, 16 * u, '#fff', 'center', 'middle');
    const pw = 420 * u, ph = 250 * u, px = W / 2 - pw / 2, py = H * 0.12 + 118 * u;
    this.panel(px, py, pw, ph);
    const rows = [['Survived', fmtTime(g.time)], ['Level', String(g.player.level)], ['Kills', String(g.kills)], ['Best combo', 'x' + g.comboBest], ['Score', fmtNum(g.score)]];
    for (let i = 0; i < rows.length; i++) {
      const y = py + 40 * u + i * 32 * u;
      R.text(rows[i][0], px + 40 * u, y, 15 * u, '#7a2d1a', 'left', 'middle', null);
      R.text(rows[i][1], px + pw - 40 * u, y, 17 * u, '#3b2a1a', 'right', 'middle', null);
    }
    if (g.newBest) R.text('NEW BEST!', W / 2, py + ph - 26 * u, 18 * u, '#c9302c', 'center', 'middle', null);
    this.button('again', 'PLAY AGAIN', W / 2, py + ph + 54 * u, 260 * u, 72 * u, won ? false : true);
    R.text('R / ENTER — play again      ESC — title', W / 2, py + ph + 106 * u, 12 * u, '#fff', 'center', 'middle');
  }
  drawLevelUp(g) {
    const R = this.R, u = R.ui, W = R.W, H = R.H, I = this.input, A = this.A;
    this.overlay(0.5);
    this.ribbon('LEVEL ' + g.player.level, W / 2, H * 0.08, 'purple', 34 * u, 360 * u);
    R.text('Choose an upgrade  ·  1 / 2 / 3 or click', W / 2, H * 0.08 + 82 * u, 14 * u, '#fff', 'center', 'middle');
    const cw = Math.min(250 * u, (W - 80 * u) / 3 - 10 * u), ch = 300 * u, gap = 22 * u;
    const total = cw * 3 + gap * 2, x0 = W / 2 - total / 2, y0 = H * 0.08 + 110 * u;
    this.hoverCard = -1;
    for (let i = 0; i < 3; i++) {
      const c = g.choices[i], x = x0 + i * (cw + gap), hover = I.mouseIn(x, y0, cw, ch);
      if (hover) this.hoverCard = i;
      this.panel(x, y0 + (hover ? -6 * u : 0), cw, ch, hover ? 'paper' : 'paper');
      const yy = y0 + (hover ? -6 * u : 0);
      R.uiSprite(A.sheet('banner_slot'), 0, x + cw / 2, yy + 62 * u, u * 0.36);
      R.uiSpriteCentered(A.sheet(c.icon), c.frame || 0, x + cw / 2, yy + 62 * u, c.frame !== undefined ? u * 0.6 : u * 0.85);
      R.text('[' + (i + 1) + ']', x + 18 * u, yy + 22 * u, 13 * u, '#7a2d1a', 'left', 'middle', null);
      const rank = g.player.upg[c.key] || 0;
      R.text(c.name, x + cw / 2, yy + 122 * u, 17 * u, '#3b2a1a', 'center', 'middle', null);
      let px = x + cw / 2 - (c.max * 14 * u) / 2 + 7 * u;
      for (let r = 0; r < c.max; r++) { R.rect(px - 5 * u, yy + 140 * u, 10 * u, 10 * u, r < rank ? '#c9302c' : r === rank ? '#f0a030' : '#d8c8a8'); px += 14 * u; }
      const lines = this.wrap(c.desc, 13 * u, cw - 40 * u);
      for (let l = 0; l < lines.length; l++) R.text(lines[l], x + cw / 2, yy + 172 * u + l * 19 * u, 13 * u, '#3b2a1a', 'center', 'middle', null);
      if (c.flavor) R.text(c.flavor, x + cw / 2, yy + ch - 26 * u, 11 * u, '#7a2d1a', 'center', 'middle', null);
      if (hover) {
        const cs = A.sheet('cursor4'), img = cs.img, s = u * 0.5, cw2 = 21 * s, chh = 25 * s;
        R.ctx.drawImage(img, 3, 3, 21, 25, x - 4 * u, yy - 4 * u, cw2, chh);
        R.ctx.drawImage(img, 104, 3, 21, 25, x + cw + 4 * u - cw2, yy - 4 * u, cw2, chh);
        R.ctx.drawImage(img, 3, 100, 21, 25, x - 4 * u, yy + ch + 4 * u - chh, cw2, chh);
        R.ctx.drawImage(img, 104, 100, 21, 25, x + cw + 4 * u - cw2, yy + ch + 4 * u - chh, cw2, chh);
        if (I.clicked[0]) this.clickedId = 'card' + i;
      }
    }
  }
  drawPause(g) {
    const R = this.R, u = R.ui, W = R.W, H = R.H;
    this.overlay(0.5);
    this.ribbon('PAUSED', W / 2, H * 0.18, 'blue', 40 * u, 340 * u);
    const lines = ['ESC / P — resume', 'M — mute', 'F — FPS counter', 'Q — quit to title'];
    for (let i = 0; i < lines.length; i++) R.text(lines[i], W / 2, H * 0.18 + 110 * u + i * 26 * u, 15 * u, '#fff', 'center', 'middle');
    this.button('resume', 'RESUME', W / 2, H * 0.18 + 240 * u, 240 * u, 70 * u, false);
  }
  static drawLoading(R, frac, err) {
    const u = R.ui, c = R.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    R.rect(0, 0, R.W, R.H, '#47aba9');
    R.text('TINY SWORDS: LAST STAND', R.W / 2, R.H / 2 - 40 * u, 28 * u, '#fff', 'center', 'middle');
    const w = 320 * u, x = R.W / 2 - w / 2, y = R.H / 2;
    R.rect(x, y, w, 14 * u, '#1e1a2e'); R.rect(x + 2 * u, y + 2 * u, (w - 4 * u) * frac, 10 * u, '#ffd54a');
    R.text(err ? err : 'loading ' + Math.round(frac * 100) + '%', R.W / 2, y + 40 * u, 14 * u, err ? '#ff8080' : '#fff', 'center', 'middle');
  }
};
