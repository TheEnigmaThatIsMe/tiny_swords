'use strict';
// Canvas 2D renderer. World-space draws snap to device pixels; UI draws are in device pixels scaled by `ui`.
TS.VIEW_H = 810; // world pixels visible vertically (zoom snaps to half steps so 2x pixel art stays crisp)
TS.Renderer = class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.zoom = 1; this.ui = 1; this.dpr = 1;
    this.W = 1; this.H = 1;
    this.camX = 0; this.camY = 0; this.shakeX = 0; this.shakeY = 0; this.ox = 0; this.oy = 0;
    this.drawCalls = 0;
    this.scratch = document.createElement('canvas'); this.scratch.width = 320; this.scratch.height = 320;
    this.sctx = this.scratch.getContext('2d');
    this.fontCache = new Map();
    this.lastFont = '';
    this.resize();
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, window.innerWidth), h = Math.max(240, window.innerHeight);
    this.W = Math.floor(w * this.dpr); this.H = Math.floor(h * this.dpr);
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.zoom = Math.max(0.5, Math.ceil((this.H / TS.VIEW_H) * 2) / 2);
    this.ui = clamp(this.zoom, 1, 2.5);
    this.viewW = this.W / this.zoom; this.viewH = this.H / this.zoom;
    this.ctx.imageSmoothingEnabled = false;
    this.lastFont = '';
  }
  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.globalAlpha = 1;
    this.ox = Math.round(-this.camX * this.zoom + this.shakeX);
    this.oy = Math.round(-this.camY * this.zoom + this.shakeY);
    this.drawCalls = 0;
  }
  // Is a world-space box (x,y,w,h) visible?
  visible(x, y, w, h) {
    const sx = x * this.zoom + this.ox, sy = y * this.zoom + this.oy;
    return sx + w * this.zoom >= 0 && sy + h * this.zoom >= 0 && sx <= this.W && sy <= this.H;
  }
  screenToWorldX(sx) { return (sx - this.ox) / this.zoom; }
  screenToWorldY(sy) { return (sy - this.oy) / this.zoom; }
  // --- world sprites -----------------------------------------------------
  sprite(s, frame, x, y, flip, scale, alpha) {
    if (scale === undefined) scale = 1;
    const i4 = frame * 4, t = s.t;
    const tx = t[i4], ty = t[i4 + 1], tw = t[i4 + 2], th = t[i4 + 3];
    const z = this.zoom * scale;
    const ax = x * this.zoom + this.ox, ay = y * this.zoom + this.oy; // device anchor
    const dw = Math.round(tw * z), dh = Math.round(th * z);
    const dy = Math.round(ay + (ty - s.ay) * z);
    const c = this.ctx;
    if (alpha !== undefined && alpha !== 1) c.globalAlpha = alpha;
    if (!flip) {
      const dx = Math.round(ax + (tx - s.ax) * z);
      if (dx + dw < 0 || dy + dh < 0 || dx > this.W || dy > this.H) { if (alpha !== undefined && alpha !== 1) c.globalAlpha = 1; return; }
      c.drawImage(s.img, frame * s.fw + tx, ty, tw, th, dx, dy, dw, dh);
    } else {
      const dx = Math.round(ax - (tx - s.ax + tw) * z);
      if (dx + dw < 0 || dy + dh < 0 || dx > this.W || dy > this.H) { if (alpha !== undefined && alpha !== 1) c.globalAlpha = 1; return; }
      c.setTransform(-1, 0, 0, 1, dx + dw, dy);
      c.drawImage(s.img, frame * s.fw + tx, ty, tw, th, 0, 0, dw, dh);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (alpha !== undefined && alpha !== 1) c.globalAlpha = 1;
    this.drawCalls++;
  }
  // Sprite rotated around its anchor (used for arrows).
  spriteRot(s, frame, x, y, angle, scale, alpha) {
    if (scale === undefined) scale = 1;
    const i4 = frame * 4, t = s.t;
    const tx = t[i4], ty = t[i4 + 1], tw = t[i4 + 2], th = t[i4 + 3];
    const z = this.zoom * scale;
    const c = this.ctx;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    if (alpha !== undefined && alpha !== 1) c.globalAlpha = alpha;
    c.setTransform(cos * z, sin * z, -sin * z, cos * z, x * this.zoom + this.ox, y * this.zoom + this.oy);
    c.drawImage(s.img, frame * s.fw + tx, ty, tw, th, tx - s.ax, ty - s.ay, tw, th);
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (alpha !== undefined && alpha !== 1) c.globalAlpha = 1;
    this.drawCalls++;
  }
  // Solid-colour silhouette of a frame (hit flash). Uses a scratch canvas + source-in; no pixel reads (file:// safe).
  spriteTint(s, frame, x, y, flip, scale, color, alpha) {
    const i4 = frame * 4, t = s.t;
    const tx = t[i4], ty = t[i4 + 1], tw = t[i4 + 2], th = t[i4 + 3];
    const sc = this.sctx;
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, tw, th);
    sc.drawImage(s.img, frame * s.fw + tx, ty, tw, th, 0, 0, tw, th);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = color; sc.fillRect(0, 0, tw, th);
    sc.globalCompositeOperation = 'source-over';
    const z = this.zoom * scale;
    const ax = x * this.zoom + this.ox, ay = y * this.zoom + this.oy;
    const dw = Math.round(tw * z), dh = Math.round(th * z), dy = Math.round(ay + (ty - s.ay) * z);
    const c = this.ctx;
    c.globalAlpha = alpha;
    if (!flip) {
      c.drawImage(this.scratch, 0, 0, tw, th, Math.round(ax + (tx - s.ax) * z), dy, dw, dh);
    } else {
      const dx = Math.round(ax - (tx - s.ax + tw) * z);
      c.setTransform(-1, 0, 0, 1, dx + dw, dy);
      c.drawImage(this.scratch, 0, 0, tw, th, 0, 0, dw, dh);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    c.globalAlpha = 1;
    this.drawCalls += 2;
  }
  // Draw a 64px tile from a tilemap image at world tile coords (used only when baking the ground canvas).
  // --- world primitives ----------------------------------------------------
  worldTransform() { this.ctx.setTransform(this.zoom, 0, 0, this.zoom, this.ox, this.oy); }
  identity() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); }
  // --- UI (device pixels) --------------------------------------------------
  uiSprite(s, frame, sx, sy, scale, alpha) {
    const i4 = frame * 4, t = s.t;
    const tx = t[i4], ty = t[i4 + 1], tw = t[i4 + 2], th = t[i4 + 3];
    const c = this.ctx;
    if (alpha !== undefined && alpha !== 1) c.globalAlpha = alpha;
    c.drawImage(s.img, frame * s.fw + tx, ty, tw, th, Math.round(sx + (tx - s.ax) * scale), Math.round(sy + (ty - s.ay) * scale), Math.round(tw * scale), Math.round(th * scale));
    if (alpha !== undefined && alpha !== 1) c.globalAlpha = 1;
    this.drawCalls++;
  }
  // Draw a frame so its trimmed box is centred on (cx, cy), regardless of the sheet's anchor.
  uiSpriteCentered(s, frame, cx, cy, scale) {
    const i4 = frame * 4, t = s.t, tx = t[i4], ty = t[i4 + 1], tw = t[i4 + 2], th = t[i4 + 3];
    this.uiSprite(s, frame, cx - (tx + tw / 2 - s.ax) * scale, cy - (ty + th / 2 - s.ay) * scale, scale);
  }
  // 9-slice panel; x,y,w,h in device px; corner pieces drawn at native size * scale.
  nine(key, x, y, w, h, scale) {
    const n = TS_ATLAS.nine[key], img = n.img, xs = n.xs, ys = n.ys, c = this.ctx;
    const lw = (xs[1] - xs[0]) * scale, rw = (xs[5] - xs[4]) * scale, th = (ys[1] - ys[0]) * scale, bh = (ys[5] - ys[4]) * scale;
    const mw = Math.max(1, w - lw - rw), mh = Math.max(1, h - th - bh);
    const sx = [xs[0], xs[1] - xs[0], xs[2], xs[3] - xs[2], xs[4], xs[5] - xs[4]];
    const sy = [ys[0], ys[1] - ys[0], ys[2], ys[3] - ys[2], ys[4], ys[5] - ys[4]];
    const dx = [x, lw, x + lw, mw, x + lw + mw, rw];
    const dy = [y, th, y + th, mh, y + th + mh, bh];
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) {
      c.drawImage(img, sx[q * 2], sy[r * 2], sx[q * 2 + 1], sy[r * 2 + 1], Math.round(dx[q * 2]), Math.round(dy[r * 2]), Math.round(dx[q * 2 + 1]), Math.round(dy[r * 2 + 1]));
    }
    this.drawCalls += 9;
  }
  // 3-slice horizontal strip (bars, ribbons). Returns the drawn height.
  three(key, row, x, y, w, scale) {
    const t = TS_ATLAS.three[key], img = t.img, xs = t.xs, r = t.rows[row], c = this.ctx;
    const y0 = r[0], h = r[1] - r[0];
    const lw = (xs[1] - xs[0]) * scale, rw = (xs[5] - xs[4]) * scale, mw = Math.max(1, w - lw - rw), dh = Math.round(h * scale);
    c.drawImage(img, xs[0], y0, xs[1] - xs[0], h, Math.round(x), Math.round(y), Math.round(lw), dh);
    c.drawImage(img, xs[2], y0, xs[3] - xs[2], h, Math.round(x + lw), Math.round(y), Math.round(mw), dh);
    c.drawImage(img, xs[4], y0, xs[5] - xs[4], h, Math.round(x + lw + mw), Math.round(y), Math.round(rw), dh);
    this.drawCalls += 3;
    return dh;
  }
  threeHeight(key, row, scale) { const r = TS_ATLAS.three[key].rows[row]; return (r[1] - r[0]) * scale; }
  font(size) {
    size = Math.round(size);
    let f = this.fontCache.get(size);
    if (!f) { f = 'bold ' + size + 'px Verdana, "DejaVu Sans", Geneva, sans-serif'; this.fontCache.set(size, f); }
    if (f !== this.lastFont) { this.ctx.font = f; this.lastFont = f; }
  }
  text(str, x, y, size, color, align, baseline, strokeColor, strokeW) {
    const c = this.ctx;
    this.font(size);
    c.textAlign = align || 'left'; c.textBaseline = baseline || 'alphabetic';
    if (strokeColor !== null) {
      c.lineJoin = 'round'; c.lineWidth = strokeW || Math.max(2, size * 0.18);
      c.strokeStyle = strokeColor || '#1e1a2e';
      c.strokeText(str, x, y);
    }
    c.fillStyle = color || '#fff';
    c.fillText(str, x, y);
    this.drawCalls += 2;
  }
  textWidth(str, size) { this.font(size); return this.ctx.measureText(str).width; }
  rect(x, y, w, h, color, alpha) {
    const c = this.ctx;
    if (alpha !== undefined) c.globalAlpha = alpha;
    c.fillStyle = color; c.fillRect(x, y, w, h);
    if (alpha !== undefined) c.globalAlpha = 1;
    this.drawCalls++;
  }
};
// Arbitrary image in world coordinates (cloud shadows, baked ground).
TS.Renderer.prototype.imageWorld = function (img, sx, sy, sw, sh, x, y, w, h, alpha) {
  const c = this.ctx;
  if (alpha !== undefined && alpha !== 1) c.globalAlpha = alpha;
  c.drawImage(img, sx, sy, sw, sh, Math.round(x * this.zoom + this.ox), Math.round(y * this.zoom + this.oy), Math.round(w * this.zoom), Math.round(h * this.zoom));
  if (alpha !== undefined && alpha !== 1) c.globalAlpha = 1;
  this.drawCalls++;
};
