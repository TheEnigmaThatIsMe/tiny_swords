'use strict';
// HUD, menus and immediate-mode buttons. All coordinates are device pixels; `u` is the UI scale.
const RIBBON = { blue: 0, red: 1, yellow: 2, purple: 3, black: 4 };
const NO_INSET = { t: 0, r: 0, b: 0, l: 0 }; // R.inset default before Renderer.resize() sets the real safe-area insets
// Largest font size <= `size` at which `str` fits in `maxW` device px (text width scales linearly with size).
function fitSize(R, str, size, maxW) { const w = R.textWidth(str, size); return w > maxW ? Math.max(6, size * maxW / w) : size; }
TS.UI = class UI {
  constructor(R, input) {
    this.R = R; this.input = input; this.clickedId = null; this.hoverCard = -1; this.vignette = null; this.vigW = 0; this.vigH = 0;
    this.A = TS.Assets;
    this.rects = {}; // device-px {x,y,w,h} per button id / card0../card2, read by the play-test driver
  }
  consumeClick(id) { if (this.clickedId === id) { this.clickedId = null; return true; } return false; }
  // --- primitives ----------------------------------------------------------
  // maxW caps the band (default: the canvas minus a small gutter); the label shrinks to fit inside it.
  ribbon(text, cx, y, style, size, minW, scale, maxW) {
    const R = this.R, u = R.ui, sc = u * 0.55 * (scale || 1);
    if (maxW === undefined) maxW = R.W - 12 * u;
    size = fitSize(R, text, size, maxW - 150 * sc);
    const tw = R.textWidth(text, size); const w = Math.min(maxW, Math.max(minW || 0, tw + 150 * sc));
    const h = R.three('ribbon_big', RIBBON[style], cx - w / 2, y, w, sc);
    R.text(text, cx, y + h * 0.47, size, '#fff8e7', 'center', 'middle', '#2a1e3a', size * 0.16);
    return h;
  }
  smallRibbon(text, cx, y, style, size, minW, scale, maxW) {
    const R = this.R, u = R.ui, sc = u * 0.55 * (scale || 1);
    if (maxW === undefined) maxW = R.W - 12 * u;
    size = fitSize(R, text, size, maxW - 90 * sc);
    const tw = R.textWidth(text, size); const w = Math.min(maxW, Math.max(minW || 0, tw + 90 * sc));
    const h = R.three('ribbon_small', RIBBON[style] * 2, cx - w / 2, y, w, sc);
    R.text(text, cx, y + h * 0.42, size, '#fff8e7', 'center', 'middle', '#2a1e3a', size * 0.16);
    return h;
  }
  panel(x, y, w, h, key) { this.R.nine(key || 'paper', x, y, w, h, this.R.ui * 0.5); }
  button(id, label, cx, cy, w, h, red) {
    const R = this.R, I = this.input, x = cx - w / 2, y = cy - h / 2;
    this.rects[id] = { x, y, w, h };
    const hover = I.mouseIn(x, y, w, h) && (!I.touch || I.buttons[0]);
    const pressed = hover && I.buttons[0];
    R.nine((red ? 'btn_red' : 'btn_blue') + (pressed ? '_pressed' : ''), x, y + (pressed ? 3 : 0), w, h, R.ui * 0.5);
    R.text(label, cx, cy + (pressed ? 4 : -2), h * 0.36, hover ? '#ffffff' : '#eaf6ff', 'center', 'middle', '#173544', h * 0.06);
    if (hover && I.clicked[0]) this.clickedId = id;
    return hover;
  }
  overlay(alpha) { this.R.rect(0, 0, this.R.W, this.R.H, '#0b0a14', alpha); }
  fit(str, size, maxW) { return fitSize(this.R, str, size, maxW); }
  compact() { const R = this.R, u = R.ui; return R.H < 560 * u || R.W < 760 * u; } // phone-sized canvas: the compact screen layouts
  wrap(str, size, maxW) {
    const words = str.split(' '), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (this.R.textWidth(t, size) > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  }
  // Like wrap(), but a two-line result is re-split at the word boundary that evens the lines out.
  wrapBalanced(str, size, maxW) {
    const lines = this.wrap(str, size, maxW); if (lines.length !== 2) return lines;
    const R = this.R, words = str.split(' '); let best = lines, bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' '), wa = R.textWidth(a, size), wb = R.textWidth(b, size);
      if (wa > maxW || wb > maxW) continue;
      const d = Math.abs(wa - wb); if (d < bestDiff) { bestDiff = d; best = [a, b]; }
    }
    return best;
  }
  // --- HUD -----------------------------------------------------------------
  drawHUD(g) {
    if (g.state === 'levelup' && this.compact()) return; // the phone level-up modal covers the whole screen
    const R = this.R, u = R.ui, P = g.player, A = this.A, I = this.input;
    const ins = R.inset || NO_INSET, il = ins.l, it = ins.t, ir = ins.r, ib = ins.b;
    const touch = !!I.touch, dpr = R.dpr, W = R.W, H = R.H;
    const narrow = W < 1000 * u;
    const fillS = A.sheet('bigbar_fill');
    // portrait avatar (top-left, kept clear of the safe-area insets)
    const ax = il + 16 * u + 42 * u, ay = it + 16 * u + 42 * u;
    R.uiSprite(A.sheet('banner_slot'), 0, ax, ay, u * 0.45);
    R.uiSprite(A.sheet('avatar1'), 0, ax, ay - 2 * u, u * 0.36);
    let bx, by, bw, bs, xy, xs, timerCx, timerY;
    if (!narrow) {
      bx = il + 110 * u; by = it + 20 * u; bw = Math.min(300 * u, R.W / 2 - 255 * u); bs = u * 0.6;
      xy = by + 35 * u; xs = u * 0.44;
      timerCx = R.W / 2; timerY = it + 12 * u;
    } else {
      // Currently `bw = min(300u, W/2 - 255u)` goes negative on narrow canvases. Shrink the bars
      // and move the centred timer/score block below them instead of trying to share the row.
      bx = il + 90 * u; by = it + 14 * u; bw = clamp(R.W - ir - bx - 20 * u, 90 * u, touch ? 220 * u : 280 * u); bs = u * 0.42;
      xy = by + 24 * u; xs = u * 0.3;
      timerCx = R.W / 2; timerY = xy + 24 * xs + 10 * u;
    }
    // HP bar
    const innerX = bx + 12 * bs, innerW = bw - 24 * bs;
    const frac = clamp(P.hp / P.maxHp, 0, 1);
    // The base sprites are opaque in the middle, so fills are drawn on top, inset to the recess (rows 20-43 of the big bar).
    R.three('bigbar', 0, bx, by, bw, bs);
    if (frac > 0) R.ctx.drawImage(fillS.img, fillS.u[0], fillS.u[1], 64, 24, Math.round(innerX), Math.round(by + 11 * bs), Math.max(2, Math.round(innerW * frac)), Math.round(24 * bs));
    R.text(Math.ceil(P.hp) + ' / ' + P.maxHp, bx + bw / 2, by + 24 * bs, (narrow ? 10 : 13) * u, '#fff', 'center', 'middle');
    // XP bar: same big frame as HP at a smaller scale, gold fill in the recess (rows 20-43), flashes white on gain
    const xInner = bx + 12 * xs, xInnerW = bw - 24 * xs, xFrac = clamp(P.xp / P.xpNext, 0, 1);
    R.three('bigbar', 0, bx, xy, bw, xs);
    if (xFrac > 0) {
      const fw = Math.max(2, Math.round(xInnerW * xFrac)), pop = clamp(g.xpPop * 4, 0, 1);
      R.rect(xInner, xy + 11 * xs, fw, 24 * xs, pop > 0.5 ? '#ffffff' : '#e8b93a');
      R.rect(xInner, xy + 11 * xs, fw, 9 * xs, pop > 0.5 ? '#ffffff' : '#ffe27a');
    }
    R.text('LV ' + P.level + '   ·   ' + Math.floor(P.xp) + ' / ' + P.xpNext + ' XP', bx + bw / 2, xy + 23 * xs, (narrow ? 8 : 10) * u * (1 + clamp(g.xpPop, 0, 0.25) * 0.5), '#fff', 'center', 'middle', '#1e1a2e', 2.5 * u);
    // timer (centred, below the bars in narrow mode so it never shares a row with them)
    const timeLeft = Math.max(0, TS.CFG.RUN_SECONDS - g.time);
    let timerBottom;
    if (!narrow) {
      this.smallRibbon(fmtTime(g.time), timerCx, timerY, 'yellow', 22 * u, 150 * u);
      R.text('DAWN IN ' + fmtTime(timeLeft), timerCx, timerY + 38 * u, 12 * u, '#fff', 'center', 'middle');
      if (g.wave > 0) R.text('WAVE ' + g.wave, timerCx, timerY + 54 * u, 12 * u, '#ffd54a', 'center', 'middle');
      timerBottom = timerY + 66 * u;
    } else {
      const rh = this.smallRibbon(fmtTime(g.time), timerCx, timerY, 'yellow', 14 * u, 110 * u, 0.85);
      R.text('DAWN IN ' + fmtTime(timeLeft), timerCx, timerY + rh + 12 * u, 9 * u, '#fff', 'center', 'middle');
      if (g.wave > 0) R.text('WAVE ' + g.wave, timerCx, timerY + rh + 26 * u, 9 * u, '#ffd54a', 'center', 'middle');
      timerBottom = timerY + rh + 34 * u;
    }
    // score / kills — always right-pinned (like desktop) so it never shares a row with the
    // centred announcement/timer block; only the sizes and the touch top-right dodge change.
    const pop = 1 + g.scorePop * 1.6;
    const scoreX = R.W - ir - (narrow ? 14 : 20) * u;
    const scoreY0 = it + (touch ? 56 * dpr + 10 * u : narrow ? 4 * u : 0);
    const sf1 = (narrow ? 10 : 12) * u, sf2 = (narrow ? 18 : 24) * u * pop, sf3 = (narrow ? 11 : 13) * u;
    const sy1 = scoreY0 + (narrow ? 16 : 22) * u, sy2 = scoreY0 + (narrow ? 32 : 44) * u, sy3 = scoreY0 + (narrow ? 50 : 68) * u;
    R.text('SCORE', scoreX, sy1, sf1, '#ffd54a', 'right', 'middle');
    R.text(fmtNum(g.score), scoreX, sy2, sf2, '#fff', 'right', 'middle');
    R.text('KILLS ' + g.kills, scoreX, sy3, sf3, '#fff', 'right', 'middle');
    let comboBottom = sy3 + (narrow ? 12 : 16) * u;
    if (g.combo >= 3 && g.comboT > 0) {
      const k = g.comboT / 2, tier = g.combo >= 20 ? '#ff4d4d' : g.combo >= 10 ? '#ff9f40' : g.combo >= 5 ? '#ffd54a' : '#ffffff';
      const szBase = narrow ? 14 : 20, szMax = narrow ? 8 : 14, szMul = narrow ? 0.4 : 0.6;
      const sz = (szBase + Math.min(szMax, g.combo * szMul)) * u * (1 + g.comboPop * 0.6);
      const cy = scoreY0 + (narrow ? 74 : 100) * u, barW = (narrow ? 80 : 120) * u, barY = cy + (narrow ? 12 : 16) * u;
      R.text('x' + g.combo + ' COMBO', scoreX, cy, sz, tier, 'right', 'middle');
      R.rect(scoreX - barW, barY, barW, 4 * u, '#2b2540'); R.rect(scoreX - barW * k, barY, barW * k, 4 * u, tier);
      comboBottom = barY + 14 * u;
    }
    // boss bar
    if (g.boss && g.boss.alive) {
      const b = g.boss;
      const w = narrow ? Math.min(300 * u, R.W - il - ir - 40 * u) : 420 * u;
      const x = R.W / 2 - w / 2;
      const y = narrow ? Math.max(timerBottom, comboBottom) + 24 * u : it + 84 * u;
      const s = narrow ? u * 0.4 : u * 0.55;
      R.text('THE WARLORD', R.W / 2, y - 8 * u, narrow ? 10 * u : 13 * u, '#ff8080', 'center', 'middle');
      const ix = x + 12 * s, iw = w - 24 * s, bf = clamp(b.hp / b.maxHp, 0, 1);
      R.three('bigbar', 0, x, y, w, s);
      if (bf > 0) R.ctx.drawImage(fillS.img, fillS.u[0], fillS.u[1], 64, 24, Math.round(ix), Math.round(y + 11 * s), Math.max(2, Math.round(iw * bf)), Math.round(24 * s));
    }
    // dash + mute (bottom-left) — hidden while touch controls own that corner (contract 7: the
    // floating-joystick rest hint lives there, and the pause screen owns the sound toggle)
    if (!touch) {
      const dx = il + 46 * u, dy = R.H - ib - 46 * u;
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
    }
    // hint
    if (g.hintT > 0) {
      R.ctx.globalAlpha = Math.min(1, g.hintT);
      // Touch mode's hint sits just above the real floating-joystick rest zone, which is tight on
      // a short landscape phone — skip it while the (2.2s) run-start banner is on screen rather
      // than overlap it. Desktop/keyboard copy is unaffected and always shows.
      if (touch && !g.announcement) {
        const zoneY = g.touch ? g.touch.rects().stickZone.y : H - ib - 220 * dpr;
        const baseY = zoneY - 18 * u, hintSize = 13 * u;
        const oneLine = 'left: move  ·  right: hold to attack  ·  arrow: dash';
        if (R.textWidth(oneLine, hintSize) <= W - 40 * u) {
          R.text(oneLine, R.W / 2, baseY, hintSize, '#fff', 'center', 'middle');
        } else {
          // Too narrow for one line (e.g. portrait) — wrap into two evenly balanced lines instead.
          R.text('left: move  ·  right: hold to attack', R.W / 2, baseY - 16 * u, hintSize, '#fff', 'center', 'middle');
          R.text('arrow: dash', R.W / 2, baseY, hintSize, '#fff', 'center', 'middle');
        }
      } else if (!touch) {
        R.text('WASD move  ·  mouse aim  ·  click / space attack  ·  shift / right-click dash', R.W / 2, R.H - 26 * u, 13 * u, '#fff', 'center', 'middle');
      }
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
    const a = g.announcement; if (!a || g.state === 'levelup' || g.state === 'paused') return; // modals own the screen
    const R = this.R, u = R.ui, k = a.t / a.dur;
    let sc = 1, alpha = 1;
    if (a.t < 0.25) sc = 0.6 + 1.6 * (a.t / 0.25) - 1.2 * sqr(a.t / 0.25); // pop-in
    if (k > 0.8) alpha = (1 - k) / 0.2;
    R.ctx.globalAlpha = alpha;
    this.ribbon(a.text, R.W / 2, R.H * 0.22, a.style, 30 * u * sc, 320 * u * sc);
    if (a.sub) {
      // Long tips ('Red line = charge path. ...') wrap to two lines on a portrait phone rather than clipping.
      const maxW = R.W - 24 * u; let sz = 15 * u, lines = this.wrapBalanced(a.sub, sz, maxW);
      if (lines.length > 2) { sz = 12 * u; lines = this.wrapBalanced(a.sub, sz, maxW); }
      for (let l = 0; l < lines.length; l++) R.text(lines[l], R.W / 2, R.H * 0.22 + 70 * u + l * (sz + 4 * u), sz, '#fff', 'center', 'middle');
    }
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
    const R = this.R, u = R.ui, W = R.W, H = R.H, I = this.input, touch = !!I.touch;
    this.overlay(0.22);
    const compact = this.compact();
    if (!compact) {
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
      R.text('Art: Tiny Swords by Pixel Frog  ·  pixelfrog-assets.itch.io/tiny-swords  ·  code & audio: original, synthesized in-browser', W / 2, H - 16 * u, 11 * u, '#fff', 'center', 'middle');
      R.text('v' + TS.VERSION, W - 12 * u, H - 16 * u, 11 * u, '#fff', 'right', 'middle');
      return;
    }
    // --- compact layout for short/narrow (phone) canvases ---------------------
    let y = 4 * u;
    const th = this.ribbon('TINY SWORDS', W / 2, y, 'blue', Math.min(26 * u, W * 0.078), Math.min(W - 24 * u, 400 * u), 0.72);
    y += th + 4 * u;
    const sh = this.smallRibbon('LAST STAND', W / 2, y, 'yellow', Math.min(13 * u, W * 0.042), Math.min(W - 60 * u, 160 * u), 0.8);
    y += sh + 8 * u;
    const pw = Math.min(W - 20 * u, 580 * u), px = W / 2 - pw / 2, py = y;
    const rowH = 15 * u, fSize = 9.5 * u;
    const kbRows = [['WASD / Arrows', 'Move'], ['Mouse', 'Aim'], ['Click / Space', 'Attack (hold)'], ['Shift / R-click', 'Dash'], ['Esc / P', 'Pause'], ['M  ·  F', 'Mute  ·  FPS']];
    const touchLines = ['Move: drag left half', 'Attack: hold right half', 'Dash: button', 'Pause: button, top-right'];
    if (touch && g.needsHomeScreen()) touchLines.push('Full screen: Share → Add to Home Screen');
    const rowCount = touch ? touchLines.length : kbRows.length;
    const ph = 30 * u + rowH * (rowCount + 3);
    this.panel(px, py, pw, ph);
    let ty = py + 14 * u;
    R.text('Hold the island 10 minutes.', W / 2, ty, fSize, '#3b2a1a', 'center', 'middle', null); ty += rowH;
    R.text('Level up, pick upgrades, survive.', W / 2, ty, fSize, '#3b2a1a', 'center', 'middle', null); ty += rowH + 8 * u;
    if (touch) {
      for (const line of touchLines) { R.text(line, W / 2, ty, fSize, '#3b2a1a', 'center', 'middle', null); ty += rowH; }
    } else {
      const cx = px + 26 * u;
      for (const [k, v] of kbRows) { R.text(k, cx, ty, fSize, '#7a2d1a', 'left', 'middle', null); R.text(v, cx + 140 * u, ty, fSize, '#3b2a1a', 'left', 'middle', null); ty += rowH; }
    }
    ty += 8 * u;
    if (g.best) R.text('BEST ' + fmtNum(g.best.score) + ' pts  ·  lvl ' + g.best.level, W / 2, ty, fSize, '#7a2d1a', 'center', 'middle', null);
    else R.text('No runs yet. Good luck.', W / 2, ty, fSize, '#7a2d1a', 'center', 'middle', null);
    const btnY = py + ph + 32 * u, btnW = Math.min(200 * u, pw * 0.6), btnH = 50 * u;
    this.button('play', 'PLAY', W / 2, btnY, btnW, btnH, false);
    R.text(touch ? 'tap PLAY' : 'or press ENTER', W / 2, btnY + btnH / 2 + 20 * u, 10 * u, '#fff', 'center', 'middle');
    R.text('v' + TS.VERSION, W - 10 * u, H - 8 * u, 9 * u, '#fff', 'right', 'middle');
  }
  drawEnd(g, won) {
    const R = this.R, u = R.ui, W = R.W, H = R.H, I = this.input, touch = !!I.touch;
    this.overlay(0.55);
    const compact = this.compact();
    if (!compact) {
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
      return;
    }
    // --- compact layout for short/narrow (phone) canvases ---------------------
    let y = 6 * u;
    const rh = this.ribbon(won ? 'DAWN BREAKS' : 'FALLEN', W / 2, y, won ? 'yellow' : 'red', 24 * u, 260 * u, 0.72);
    y += rh + 8 * u;
    R.text(won ? 'You held until sunrise.' : 'The night took the island.', W / 2, y, 11 * u, '#fff', 'center', 'middle');
    y += 20 * u;
    const pw = Math.min(W - 32 * u, 380 * u), px = W / 2 - pw / 2, py = y;
    const rows = [['Survived', fmtTime(g.time)], ['Level', String(g.player.level)], ['Kills', String(g.kills)], ['Best combo', 'x' + g.comboBest], ['Score', fmtNum(g.score)]];
    const rowH = 22 * u, ph = 16 * u + rows.length * rowH + (g.newBest ? 20 * u : 0);
    this.panel(px, py, pw, ph);
    for (let i = 0; i < rows.length; i++) {
      const ry = py + 16 * u + i * rowH;
      R.text(rows[i][0], px + 18 * u, ry, 11 * u, '#7a2d1a', 'left', 'middle', null);
      R.text(rows[i][1], px + pw - 18 * u, ry, 12 * u, '#3b2a1a', 'right', 'middle', null);
    }
    if (g.newBest) R.text('NEW BEST!', W / 2, py + ph - 12 * u, 13 * u, '#c9302c', 'center', 'middle', null);
    const btnW = Math.min(190 * u, (W - 60 * u) / 2), btnH = 46 * u, sideBySide = W - 40 * u > btnW * 2 + 20 * u;
    let hintY;
    if (sideBySide) {
      const cy = py + ph + 22 * u + btnH / 2;
      this.button('again', 'PLAY AGAIN', W / 2 - btnW / 2 - 10 * u, cy, btnW, btnH, won ? false : true);
      this.button('menu', 'MENU', W / 2 + btnW / 2 + 10 * u, cy, btnW, btnH, false);
      hintY = cy + btnH / 2 + 20 * u;
    } else {
      const bw2 = Math.min(220 * u, W - 40 * u);
      let by2 = py + ph + 22 * u + btnH / 2;
      this.button('again', 'PLAY AGAIN', W / 2, by2, bw2, btnH, won ? false : true);
      by2 += btnH + 10 * u;
      this.button('menu', 'MENU', W / 2, by2, bw2, btnH, false);
      hintY = by2 + btnH / 2 + 20 * u;
    }
    if (!touch) R.text('R / ENTER — again   ·   ESC — menu', W / 2, hintY, 10 * u, '#fff', 'center', 'middle');
  }
  drawLevelUp(g) {
    const R = this.R, u = R.ui, W = R.W, H = R.H, I = this.input, A = this.A, touch = !!I.touch;
    this.hoverCard = -1;
    if (this.compact()) { this.overlay(0.6); this.drawLevelUpCompact(g); return; }
    this.overlay(0.5);
    this.ribbon('LEVEL ' + g.player.level, W / 2, H * 0.08, 'purple', 34 * u, 360 * u);
    R.text(touch ? 'Choose an upgrade  ·  tap a card' : 'Choose an upgrade  ·  1 / 2 / 3 or click', W / 2, H * 0.08 + 82 * u, 14 * u, '#fff', 'center', 'middle');
    const headerBottom = H * 0.08 + 110 * u;
    const cwWide = Math.min(250 * u, (W - 80 * u) / 3 - 10 * u);
    const stacked = cwWide < 170 * u || headerBottom + 300 * u > H - 30 * u;
    if (!stacked) {
      const cw = cwWide, ch = 300 * u, gap = 22 * u;
      const total = cw * 3 + gap * 2, x0 = W / 2 - total / 2, y0 = headerBottom;
      for (let i = 0; i < 3; i++) {
        const c = g.choices[i], x = x0 + i * (cw + gap);
        const hover = I.mouseIn(x, y0, cw, ch) && (!touch || I.buttons[0]);
        if (hover) this.hoverCard = i;
        this.rects['card' + i] = { x, y: y0 + (hover ? -6 * u : 0), w: cw, h: ch };
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
          const cs = A.sheet('cursor4'), img = cs.img, s = u * 0.5, cw2 = 21 * s, chh = 25 * s, ox = cs.u[0] - cs.t[0], oy = cs.u[1] - cs.t[1];
          R.ctx.drawImage(img, ox + 3, oy + 3, 21, 25, x - 4 * u, yy - 4 * u, cw2, chh);
          R.ctx.drawImage(img, ox + 104, oy + 3, 21, 25, x + cw + 4 * u - cw2, yy - 4 * u, cw2, chh);
          R.ctx.drawImage(img, ox + 3, oy + 100, 21, 25, x - 4 * u, yy + ch + 4 * u - chh, cw2, chh);
          R.ctx.drawImage(img, ox + 104, oy + 100, 21, 25, x + cw + 4 * u - cw2, yy + ch + 4 * u - chh, cw2, chh);
          if (I.clicked[0]) this.clickedId = 'card' + i;
        }
      }
      return;
    }
    // --- stacked layout: three full-width rows (narrow canvas, or too tall for columns) -------
    const rowGap = 10 * u;
    const rowH = Math.min(150 * u, (H - headerBottom - 30 * u - 2 * rowGap) / 3);
    const rowW = Math.min(W - 24 * u, 760 * u), rx = W / 2 - rowW / 2;
    for (let i = 0; i < 3; i++) {
      const c = g.choices[i], y = headerBottom + i * (rowH + rowGap);
      const hover = I.mouseIn(rx, y, rowW, rowH) && (!touch || I.buttons[0]);
      if (hover) this.hoverCard = i;
      const yy = y + (hover ? -6 * u : 0);
      this.rects['card' + i] = { x: rx, y: yy, w: rowW, h: rowH };
      this.panel(rx, yy, rowW, rowH, 'paper');
      const iconSize = Math.min(rowH, 110 * u), iconCx = rx + iconSize * 0.5 + 10 * u, iconCy = yy + rowH / 2;
      R.uiSprite(A.sheet('banner_slot'), 0, iconCx, iconCy, u * 0.3);
      R.uiSpriteCentered(A.sheet(c.icon), c.frame || 0, iconCx, iconCy, c.frame !== undefined ? u * 0.45 : u * 0.62);
      const rank = g.player.upg[c.key] || 0;
      const tx0 = rx + iconSize + 26 * u, textW = rowW - iconSize - 44 * u;
      R.text('[' + (i + 1) + ']  ' + c.name, tx0, yy + 18 * u, 13 * u, '#3b2a1a', 'left', 'middle', null);
      let px2 = tx0;
      for (let r = 0; r < c.max; r++) { R.rect(px2, yy + 36 * u, 9 * u, 9 * u, r < rank ? '#c9302c' : r === rank ? '#f0a030' : '#d8c8a8'); px2 += 13 * u; }
      const lines = this.wrap(c.desc, 11 * u, textW);
      const maxLines = clamp(Math.floor((rowH - 64 * u) / (15 * u)), 1, 3);
      for (let l = 0; l < Math.min(lines.length, maxLines); l++) R.text(lines[l], tx0, yy + 54 * u + l * 15 * u, 11 * u, '#3b2a1a', 'left', 'middle', null);
      if (hover && I.clicked[0]) this.clickedId = 'card' + i;
    }
  }
  // Phone layout: a small header, then three columns in landscape or three rows in portrait. Every
  // card is sized from the canvas (minus the safe-area insets) so its text never spills past the
  // card or the screen, on a short Safari-landscape viewport included.
  drawLevelUpCompact(g) {
    const R = this.R, u = R.ui, W = R.W, H = R.H, I = this.input, A = this.A, touch = !!I.touch;
    const ins = R.inset || NO_INSET;
    const dot = (r, rank) => r < rank ? '#c9302c' : r === rank ? '#f0a030' : '#d8c8a8';
    const left = ins.l + 12 * u, right = W - ins.r - 12 * u, bottom = H - ins.b - 12 * u;
    let y = ins.t + 6 * u;
    y += this.smallRibbon('LEVEL ' + g.player.level, W / 2, y, 'purple', 15 * u, 150 * u, 0.85) + 10 * u;
    const hint = touch ? 'Choose an upgrade  ·  tap a card' : 'Choose an upgrade  ·  1 / 2 / 3 or click';
    R.text(hint, W / 2, y, this.fit(hint, 10 * u, right - left), '#fff', 'center', 'middle');
    y += 14 * u;
    const card = (i, x, cy, w, h) => {
      const hover = I.mouseIn(x, cy, w, h) && (!touch || I.buttons[0]);
      if (hover) this.hoverCard = i;
      const yy = cy + (hover ? -4 * u : 0);
      this.rects['card' + i] = { x, y: yy, w, h };
      this.panel(x, yy, w, h);
      if (hover && I.clicked[0]) this.clickedId = 'card' + i;
      return yy;
    };
    if (W > H) {
      // landscape: three columns filling the height below the header
      const gap = 10 * u, cw = Math.min(250 * u, (right - left - 2 * gap) / 3), avail = bottom - y, ch = Math.min(200 * u, avail);
      const x0 = W / 2 - (cw * 3 + 2 * gap) / 2, y0 = y + (avail - ch) * 0.4, short = ch < 190 * u;
      for (let i = 0; i < 3; i++) {
        const c = g.choices[i], x = x0 + i * (cw + gap), yy = card(i, x, y0, cw, ch), cx = x + cw / 2;
        const iconCy = yy + (short ? 30 : 42) * u;
        R.uiSprite(A.sheet('banner_slot'), 0, cx, iconCy, u * (short ? 0.2 : 0.28));
        R.uiSpriteCentered(A.sheet(c.icon), c.frame || 0, cx, iconCy, (c.frame !== undefined ? 0.3 : 0.42) * u * (short ? 0.72 : 1));
        if (!touch) R.text('[' + (i + 1) + ']', x + 10 * u, yy + 12 * u, 9 * u, '#7a2d1a', 'left', 'middle', null);
        const rank = g.player.upg[c.key] || 0;
        let ty = iconCy + (short ? 28 : 40) * u;
        R.text(c.name, cx, ty, this.fit(c.name, 12 * u, cw - 20 * u), '#3b2a1a', 'center', 'middle', null); ty += 14 * u;
        let px = cx - (c.max * 12 * u) / 2 + 6 * u;
        for (let r = 0; r < c.max; r++) { R.rect(px - 4 * u, ty - 4 * u, 8 * u, 8 * u, dot(r, rank)); px += 12 * u; }
        ty += 16 * u;
        const lines = this.wrap(c.desc, 10 * u, cw - 22 * u), maxLines = Math.max(1, Math.floor((yy + ch - 8 * u - ty) / (13 * u)));
        for (let l = 0; l < Math.min(lines.length, maxLines); l++) R.text(lines[l], cx, ty + l * 13 * u, 10 * u, '#3b2a1a', 'center', 'middle', null);
        ty += Math.min(lines.length, maxLines) * 13 * u;
        if (c.flavor && ty + 18 * u <= yy + ch - 10 * u) R.text(c.flavor, cx, yy + ch - 14 * u, this.fit(c.flavor, 8.5 * u, cw - 20 * u), '#7a2d1a', 'center', 'middle', null);
      }
      return;
    }
    // portrait: three rows, icon on the left and the text block vertically centred in each row
    const gap = 8 * u, rowW = right - left, rowH = Math.min(150 * u, (bottom - y - 2 * gap) / 3);
    const iconS = clamp(rowH * 0.6, 44 * u, 90 * u), slotSc = iconS / 185; // banner_slot is 185 px wide at scale 1
    for (let i = 0; i < 3; i++) {
      const c = g.choices[i], yy = card(i, left, y + i * (rowH + gap), rowW, rowH);
      const iconCx = left + 12 * u + iconS / 2, iconCy = yy + rowH / 2;
      R.uiSprite(A.sheet('banner_slot'), 0, iconCx, iconCy, slotSc);
      R.uiSpriteCentered(A.sheet(c.icon), c.frame || 0, iconCx, iconCy, slotSc * (c.frame !== undefined ? 1.5 : 2.1));
      const rank = g.player.upg[c.key] || 0, name = (touch ? '' : '[' + (i + 1) + ']  ') + c.name;
      const tx = left + iconS + 24 * u, textW = rowW - iconS - 36 * u;
      const maxLines = clamp(Math.floor((rowH - 40 * u) / (13 * u)), 1, 4);
      const lines = this.wrap(c.desc, 10 * u, textW).slice(0, maxLines);
      const flavor = c.flavor && rowH >= 110 * u && lines.length < maxLines;
      const blockH = 30 * u + lines.length * 13 * u + (flavor ? 15 * u : 0);
      let ty = yy + Math.max(8 * u, (rowH - blockH) / 2) + 7 * u;
      R.text(name, tx, ty, this.fit(name, 12 * u, textW), '#3b2a1a', 'left', 'middle', null); ty += 14 * u;
      let px = tx;
      for (let r = 0; r < c.max; r++) { R.rect(px, ty - 4 * u, 8 * u, 8 * u, dot(r, rank)); px += 12 * u; }
      ty += 16 * u;
      for (let l = 0; l < lines.length; l++) R.text(lines[l], tx, ty + l * 13 * u, 10 * u, '#3b2a1a', 'left', 'middle', null);
      if (flavor) R.text(c.flavor, tx, ty + lines.length * 13 * u + 2 * u, this.fit(c.flavor, 8.5 * u, textW), '#7a2d1a', 'left', 'middle', null);
    }
  }
  drawPause(g) {
    const R = this.R, u = R.ui, W = R.W, H = R.H, I = this.input, touch = !!I.touch;
    this.overlay(0.5);
    const compact = this.compact();
    if (!compact) {
      this.ribbon('PAUSED', W / 2, H * 0.18, 'blue', 40 * u, 340 * u);
      const lines = ['ESC / P — resume', 'M — mute', 'F — FPS counter', 'Q — quit to title'];
      for (let i = 0; i < lines.length; i++) R.text(lines[i], W / 2, H * 0.18 + 110 * u + i * 26 * u, 15 * u, '#fff', 'center', 'middle');
      this.button('resume', 'RESUME', W / 2, H * 0.18 + 240 * u, 240 * u, 70 * u, false);
      return;
    }
    // --- compact layout: RESUME + SOUND + QUIT stacked; keyboard hints hidden while touch ------
    let y = H * 0.05;
    const rh = this.ribbon('PAUSED', W / 2, y, 'blue', 24 * u, 220 * u, 0.75);
    y += rh + 14 * u;
    if (!touch) {
      const lines = ['ESC / P resume  ·  M mute', 'F FPS  ·  Q quit to title'];
      for (const line of lines) { R.text(line, W / 2, y, 11 * u, '#fff', 'center', 'middle'); y += 20 * u; }
      y += 6 * u;
    }
    const bw = Math.min(220 * u, W * 0.55), bh = 46 * u, gap = 12 * u;
    this.button('resume', 'RESUME', W / 2, y + bh / 2, bw, bh, false); y += bh + gap;
    this.button('sound', SFX.isMuted() ? 'SOUND: OFF' : 'SOUND: ON', W / 2, y + bh / 2, bw, bh, false); y += bh + gap;
    this.button('quit', 'QUIT', W / 2, y + bh / 2, bw, bh, true);
  }
  static drawLoading(R, frac, err) {
    const u = R.ui, c = R.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    R.rect(0, 0, R.W, R.H, '#47aba9');
    const title = 'TINY SWORDS: LAST STAND';
    R.text(title, R.W / 2, R.H / 2 - 40 * u, fitSize(R, title, 28 * u, R.W - 32 * u), '#fff', 'center', 'middle');
    const w = Math.min(320 * u, R.W - 40 * u), x = R.W / 2 - w / 2, y = R.H / 2;
    R.rect(x, y, w, 14 * u, '#1e1a2e'); R.rect(x + 2 * u, y + 2 * u, (w - 4 * u) * frac, 10 * u, '#ffd54a');
    R.text(err ? err : 'loading ' + Math.round(frac * 100) + '%', R.W / 2, y + 40 * u, 14 * u, err ? '#ff8080' : '#fff', 'center', 'middle');
  }
};
