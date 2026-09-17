'use strict';
// Pooled particles, FX sprites, floating text, slash wedges, screen shake, hit-stop, screen flash.
TS.Effects = class Effects {
  constructor() {
    this.particles = new Pool(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 3, color: '#fff', grav: 0, drag: 0 }), 800);
    this.sprites = new Pool(() => ({ s: null, x: 0, y: 0, t: 0, fps: 12, scale: 1, flip: false, alpha: 1, layer: 1, follow: null, fid: 0, oy: 0 }), 200);
    this.texts = new Pool(() => ({ x: 0, y: 0, vy: 0, text: '', color: '#fff', size: 18, life: 0, max: 1 }), 140);
    this.wedges = new Pool(() => ({ x: 0, y: 0, a: 0, half: 1, r: 80, life: 0, max: 0.12, color: '#fff', ring: false }), 32);
    this.trauma = 0; this.hitstop = 0; this.flash = 0; this.flashColor = '#ffffff';
  }
  reset() { this.particles.clear(); this.sprites.clear(); this.texts.clear(); this.wedges.clear(); this.trauma = 0; this.hitstop = 0; this.flash = 0; }
  spark(x, y, n, color, speed, size, grav) {
    for (let i = 0; i < n; i++) {
      const p = this.particles.alloc(); if (!p) return;
      const a = Math.random() * TAU, v = speed * (0.4 + Math.random() * 0.8);
      p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v - speed * 0.3;
      p.life = p.max = 0.25 + Math.random() * 0.35; p.size = size || 3; p.color = color; p.grav = grav === undefined ? 700 : grav; p.drag = 2.5;
    }
  }
  burst(x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
      const p = this.particles.alloc(); if (!p) return;
      const a = Math.random() * TAU, v = speed * (0.3 + Math.random() * 0.9);
      p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v * 0.6;
      p.life = p.max = 0.3 + Math.random() * 0.4; p.size = 2 + ((Math.random() * 3) | 0); p.color = colors[(Math.random() * colors.length) | 0]; p.grav = 0; p.drag = 3;
    }
  }
  fx(s, x, y, opts) {
    const e = this.sprites.alloc(); if (!e) return null;
    e.s = s; e.x = x; e.y = y; e.t = 0; e.fps = (opts && opts.fps) || 14; e.scale = (opts && opts.scale) || 1; e.flip = !!(opts && opts.flip);
    e.alpha = (opts && opts.alpha !== undefined) ? opts.alpha : 1; e.layer = (opts && opts.layer !== undefined) ? opts.layer : 1;
    e.follow = (opts && opts.follow) || null; e.fid = e.follow ? e.follow.id : 0; e.oy = (opts && opts.oy) || 0;
    return e;
  }
  text(x, y, str, color, size, vy) {
    const t = this.texts.alloc(); if (!t) return;
    t.x = x + (Math.random() - 0.5) * 16; t.y = y; t.vy = vy === undefined ? -70 : vy; t.text = str; t.color = color; t.size = size || 18; t.life = t.max = 0.8;
  }
  wedge(x, y, a, half, r, color, ring) {
    const w = this.wedges.alloc(); if (!w) return;
    w.x = x; w.y = y; w.a = a; w.half = half; w.r = r; w.life = w.max = ring ? 0.22 : 0.13; w.color = color || '#ffffff'; w.ring = !!ring;
  }
  shake(v) { this.trauma = Math.min(1, this.trauma + v); }
  stop(sec) { if (sec > this.hitstop) this.hitstop = sec; }
  screenFlash(color, amount) { this.flashColor = color; this.flash = Math.max(this.flash, amount); }
  update(dt) {
    const P = this.particles;
    for (let i = P.active - 1; i >= 0; i--) {
      const p = P.items[i];
      p.life -= dt; if (p.life <= 0) { P.free(i); continue; }
      p.vy += p.grav * dt; const d = 1 - Math.min(1, p.drag * dt); p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    const S = this.sprites;
    for (let i = S.active - 1; i >= 0; i--) {
      const e = S.items[i];
      e.t += dt * e.fps;
      if (e.t >= e.s.n) { S.free(i); continue; }
      if (e.follow) { if (e.follow.alive && e.follow.id === e.fid) { e.x = e.follow.x; e.y = e.follow.y + e.oy; } else { S.free(i); continue; } }
    }
    const T = this.texts;
    for (let i = T.active - 1; i >= 0; i--) {
      const t = T.items[i];
      t.life -= dt; if (t.life <= 0) { T.free(i); continue; }
      t.y += t.vy * dt; t.vy *= (1 - Math.min(1, 4 * dt));
    }
    const W = this.wedges;
    for (let i = W.active - 1; i >= 0; i--) { const w = W.items[i]; w.life -= dt; if (w.life <= 0) W.free(i); }
    this.trauma = Math.max(0, this.trauma - 2.6 * dt);
    this.flash = Math.max(0, this.flash - 3 * dt);
  }
  updateRealtime(dt) { this.trauma = Math.max(0, this.trauma - 2.6 * dt); }
  applyShake(R) {
    const amp = this.trauma * this.trauma * 16 * R.zoom;
    R.shakeX = (Math.random() * 2 - 1) * amp; R.shakeY = (Math.random() * 2 - 1) * amp;
  }
  drawGround(R) {
    const c = R.ctx, W = this.wedges;
    if (W.active) {
      R.worldTransform();
      for (let i = 0; i < W.active; i++) {
        const w = W.items[i], k = w.life / w.max;
        c.globalAlpha = 0.55 * k; c.fillStyle = w.color;
        c.beginPath();
        if (w.ring) { c.arc(w.x, w.y, w.r * (1.2 - 0.2 * k), 0, TAU); c.arc(w.x, w.y, w.r * 0.55, 0, TAU, true); }
        else { c.moveTo(w.x, w.y); c.arc(w.x, w.y, w.r, w.a - w.half, w.a + w.half); c.closePath(); }
        c.fill();
      }
      c.globalAlpha = 1; R.identity(); R.drawCalls += W.active;
    }
    const S = this.sprites;
    for (let i = 0; i < S.active; i++) { const e = S.items[i]; if (e.layer === 0) R.sprite(e.s, e.t | 0, e.x, e.y, e.flip, e.scale, e.alpha); }
  }
  drawAir(R) {
    const S = this.sprites, c = R.ctx;
    for (let i = 0; i < S.active; i++) { const e = S.items[i]; if (e.layer === 1) R.sprite(e.s, e.t | 0, e.x, e.y, e.flip, e.scale, e.alpha); }
    const P = this.particles;
    if (P.active) {
      R.worldTransform();
      for (let i = 0; i < P.active; i++) {
        const p = P.items[i];
        c.globalAlpha = Math.min(1, p.life / p.max * 1.5); c.fillStyle = p.color;
        c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      c.globalAlpha = 1; R.identity(); R.drawCalls += P.active;
    }
    const T = this.texts;
    for (let i = 0; i < T.active; i++) {
      const t = T.items[i], k = t.life / t.max;
      const pop = 1 + Math.max(0, (k - 0.75)) * 2.4;
      c.globalAlpha = Math.min(1, k * 2.5);
      R.text(t.text, t.x * R.zoom + R.ox, t.y * R.zoom + R.oy, t.size * R.ui * pop, t.color, 'center', 'middle');
    }
    c.globalAlpha = 1;
  }
  drawFlash(R) { if (this.flash > 0) R.rect(0, 0, R.W, R.H, this.flashColor, Math.min(0.6, this.flash)); }
};
