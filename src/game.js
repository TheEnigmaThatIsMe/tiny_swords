'use strict';
// Game orchestration: run state, spawner + difficulty curve, combat glue, upgrades, camera, bot, debug API.
TS.CFG = {
  RUN_SECONDS: 600, BOSS_AT: 480, MAX_ENEMIES: 100, SURGE_EVERY: 60,
  spawnRate: t => 0.55 + 0.32 * t,               // enemy heads per second, t in minutes
  surgeCount: t => Math.round(5 + 3 * t),
  hpMult: t => 1 + 0.11 * t,
  dmgMult: t => 1 + 0.05 * t,
};
const UPGRADES = [
  { key: 'edge', name: 'Sharpened Edge', icon: 'icon5', max: 5, desc: '+25% sword damage.', flavor: 'Cuts deeper.' },
  { key: 'quick', name: 'Quick Hands', icon: 'icon7', max: 4, desc: '+15% attack speed. Chains come out faster.', flavor: 'Blur of steel.' },
  { key: 'arc', name: 'Wide Arc', icon: 'warrior_blue_attack1', frame: 2, max: 3, desc: '+15% reach and a wider swing arc. Hit more of the crowd.', flavor: 'Sweep the field.' },
  { key: 'heavy', name: 'Heavy Blows', icon: 'icon1', max: 2, desc: '+40% knockback and hits stun enemies longer.', flavor: 'Send them flying.' },
  { key: 'fleet', name: 'Fleet Foot', icon: 'icon8', max: 3, desc: '+12% move speed.', flavor: 'Never get cornered.' },
  { key: 'iron', name: 'Iron Skin', icon: 'icon6', max: 4, desc: '+30 max HP and heal 30 now.', flavor: 'Built to last.' },
  { key: 'vamp', name: 'Vampiric Blade', icon: 'icon4', max: 3, desc: 'Heal 2 HP on every kill.', flavor: 'Feast on the horde.' },
  { key: 'whirl', name: 'Whirlwind', icon: 'warrior_blue_attack2', frame: 2, max: 1, desc: 'Every third chained swing becomes a 360° spin for 150% damage.', flavor: 'Nowhere is safe.' },
  { key: 'dashm', name: 'Dash Mastery', icon: 'fx_dust2', frame: 1, max: 3, desc: '-25% dash cooldown, +25% dash distance.', flavor: 'Blink and miss.' },
  { key: 'gold', name: 'Gold Rush', icon: 'icon3', max: 2, desc: 'Coins worth +50% and a +40% wider magnet.', flavor: 'Fortune favours.' },
  { key: 'second', name: 'Second Wind', icon: 'warrior_blue_guard', frame: 2, max: 1, desc: 'Once per run, survive a killing blow with 50% HP.', flavor: 'Not today.' },
  { key: 'adren', name: 'Adrenaline', icon: 'fx_fire3', frame: 3, max: 1, desc: 'Below 35% HP: +30% damage, attack speed and move speed.', flavor: 'Cornered beast.' },
  { key: 'lucky', name: 'Lucky Strike', icon: 'fx_explosion1', frame: 2, max: 3, desc: '+10% critical chance. Crits deal double damage.', flavor: 'Right between the eyes.' },
];
const INTRO = { warrior: ['WARRIORS LANDED', 'They wind up before swinging. Step in after the miss.'], archer: ['ARCHERS SIGHTED', 'Close the distance. Dash through arrows.'], lancer: ['LANCERS!', 'Red line = charge path. Sidestep, then punish the stagger.'], monk: ['MONKS ARRIVE', 'They heal the horde. Kill them first.'] };

TS.Game = class Game {
  constructor(R, input, ui) {
    this.R = R; this.input = input; this.ui = ui; this.fx = new TS.Effects();
    this.player = new TS.Player();
    this.enemies = new Pool(() => new TS.Enemy(), 220);
    this.arrows = new Pool(() => new TS.Arrow(), 96);
    this.pickups = new Pool(() => new TS.Pickup(), 320);
    this.sheep = new Pool(() => new TS.Sheep(), 8);
    this.drawList = [];
    this.ctrl = { mx: 0, my: 0, aimX: 0, aimY: 0, attack: false, attackPressed: false, dash: false };
    this.bot = false; this.speed = 1; this.showFps = false; this.speedSteps = 1;
    this.best = TS.storage.get('ts_laststand_best', null);
    this.stats = { time: 0, hp: 0, maxHp: 0, level: 1, kills: 0, score: 0, enemies: 0, fps: 0, frameMs: 0, updateMs: 0, drawMs: 0, state: 'menu', wave: 0, fxCount: 0, draws: 0 };
    this.sfxOpts = { pitch: 1, vol: 1, pan: 0 };
    this.cell = 96; this.gcols = 0; this.grows = 0; this.buckets = []; this.used = [];
    this.state = 'menu'; this.time = 0; this.menuT = 0; this.announcement = null; this.queue = [];
    this.camX = 0; this.camY = 0;
    this.newWorld();
    this.resetRunVars();
  }
  // ---------------------------------------------------------------------
  newWorld() {
    this.world = new TS.World((Math.random() * 1e9) | 0);
    const w = this.world;
    this.gcols = Math.ceil(w.width / this.cell); this.grows = Math.ceil(w.height / this.cell);
    if (this.buckets.length < this.gcols * this.grows) { this.buckets.length = 0; for (let i = 0; i < this.gcols * this.grows; i++) this.buckets.push([]); }
    this.player.reset(w.cx, w.cy);
    this.sheep.clear();
    for (let i = 0; i < 4; i++) { const t = w.grassFar(w.cx, w.cy, 300); const s = this.sheep.alloc(); s.init(w.tileCenterX(t), w.tileCenterY(t)); }
    this.camX = w.cx - this.R.viewW / 2; this.camY = w.cy - this.R.viewH / 2;
  }
  resetRunVars() {
    this.time = 0; this.wave = 0; this.score = 0; this.kills = 0; this.combo = 0; this.comboT = 0; this.comboBest = 0; this.comboPop = 0; this.scorePop = 0;
    this.spawnAcc = 0; this.surgeT = TS.CFG.SURGE_EVERY; this.surgeLeft = 0; this.surgeTick = 0; this.surgeSide = 0;
    this.bossSpawned = false; this.boss = null; this.dawnAnnounced = false; this.introduced = {};
    this.hpMult = 1; this.dmgMult = 1; this.levelQueue = 0; this.choices = null; this.dyingT = 0; this.timeScale = 1;
    this.hintT = 14; this.newBest = false; this.sheepT = 40; this.musicT = 0; this.botPickT = 0; this.announcement = null; this.queue.length = 0;
  }
  startRun() {
    this.newWorld();
    this.enemies.clear(); this.arrows.clear(); this.pickups.clear(); this.fx.reset();
    this.resetRunVars();
    this.state = 'playing';
    SFX.init(); SFX.startMusic(); SFX.setIntensity(0.1);
    this.announce('HOLD THE LINE', 'blue', 2.2, 'Dawn comes at 10:00');
  }
  toMenu() { this.state = 'menu'; this.enemies.clear(); this.arrows.clear(); this.pickups.clear(); this.fx.reset(); this.newWorld(); this.resetRunVars(); SFX.stopMusic(); }
  announce(text, style, dur, sub) {
    if (this.announcement) { this.queue.push({ text, style, dur, sub, t: 0 }); return; }
    this.announcement = { text, style, dur, sub, t: 0 };
  }
  // ---- audio helper with distance attenuation ---------------------------
  sfxAt(name, x, y, opts) {
    const P = this.player, d = Math.sqrt(sqr(x - P.x) + sqr(y - P.y));
    const o = this.sfxOpts;
    o.pitch = opts && opts.pitch !== undefined ? opts.pitch : 1;
    o.vol = (opts && opts.vol !== undefined ? opts.vol : 1) * clamp(1 - (d - 260) / 900, 0.12, 1);
    o.pan = clamp((x - P.x) / 700, -1, 1);
    SFX.play(name, o);
  }
  // ---- per-frame input → ctrl ------------------------------------------
  pollInput() {
    const I = this.input, R = this.R, P = this.player, c = this.ctrl;
    if (I.hit('KeyF')) this.showFps = !this.showFps;
    if (I.hit('KeyM')) { SFX.init(); SFX.toggleMute(); SFX.play('click'); }
    if (this.state === 'menu') {
      if (I.hit('Enter') || I.hit('Space') || this.ui.consumeClick('play')) this.startRun();
    } else if (this.state === 'playing') {
      if (I.hit('Escape') || I.hit('KeyP')) { this.state = 'paused'; SFX.play('click'); }
    } else if (this.state === 'paused') {
      if (I.hit('Escape') || I.hit('KeyP') || this.ui.consumeClick('resume')) { this.state = 'playing'; SFX.play('click'); }
      if (I.hit('KeyQ')) this.toMenu();
    } else if (this.state === 'levelup') {
      for (let i = 0; i < 3; i++) if (I.hit('Digit' + (i + 1)) || I.hit('Numpad' + (i + 1)) || this.ui.consumeClick('card' + i)) { this.chooseUpgrade(i); break; }
    } else if (this.state === 'gameover' || this.state === 'victory') {
      if (I.hit('KeyR') || I.hit('Enter') || this.ui.consumeClick('again')) this.startRun();
      else if (I.hit('Escape')) this.toMenu();
    }
    if (this.bot) return;
    c.mx = I.axisX(); c.my = I.axisY();
    if (I.mouseMoved) { c.aimX = this.camX + I.mouseX / R.zoom; c.aimY = this.camY + I.mouseY / R.zoom; }
    else { const dx = c.mx || P.facing, dy = c.my; c.aimX = P.x + dx * 100; c.aimY = P.y - 20 + dy * 100; }
    c.attack = I.buttons[0] || I.down('Space');
    c.attackPressed = c.attackPressed || I.clicked[0] || I.hit('Space');
    c.dash = c.dash || I.clicked[2] || I.hit('ShiftLeft') || I.hit('ShiftRight');
  }
  // ---- fixed step ------------------------------------------------------
  step(dt) {
    const fx = this.fx;
    if (this.state === 'menu' || this.state === 'paused' || this.state === 'levelup') {
      this.world.updateAmbient(dt);
      if (this.state === 'menu') { this.menuT += dt; this.player.anim.update(dt); for (let i = 0; i < this.sheep.active; i++) this.sheep.items[i].update(dt, this); }
      if (this.state === 'levelup' && this.bot) { this.botPickT -= dt; if (this.botPickT <= 0) this.botChoose(); }
      this.updateAnnouncement(dt);
      return;
    }
    if (fx.hitstop > 0) { fx.hitstop -= dt; fx.updateRealtime(dt); return; }
    if (this.state === 'dying') { this.dyingT -= dt; if (this.dyingT <= 0) { this.endRun(false); return; } }
    dt *= this.timeScale;
    this.world.updateAmbient(dt);
    if (this.state === 'playing') this.time += dt;
    const tmin = this.time / 60;
    this.hpMult = TS.CFG.hpMult(tmin); this.dmgMult = TS.CFG.dmgMult(tmin);
    if (this.hintT > 0) this.hintT -= dt;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    if (this.comboPop > 0) this.comboPop -= dt * 4; if (this.scorePop > 0) this.scorePop -= dt * 4;
    if (this.state === 'playing') this.updateSpawns(dt, tmin);
    if (this.bot && this.state === 'playing') this.botThink();
    const c = this.ctrl;
    if (this.player.alive && this.state !== 'victory') this.player.update(dt, c, this);
    c.attackPressed = false; c.dash = false;
    const E = this.enemies;
    for (let i = 0; i < E.active; i++) { const e = E.items[i]; if (e.alive) e.update(dt, this); }
    this.rebuildGrid(); this.separate();
    for (let i = E.active - 1; i >= 0; i--) if (!E.items[i].alive) E.free(i);
    const A = this.arrows;
    for (let i = A.active - 1; i >= 0; i--) { const a = A.items[i]; a.update(dt, this); if (!a.alive) A.free(i); }
    const K = this.pickups;
    for (let i = K.active - 1; i >= 0; i--) { const k = K.items[i]; k.update(dt, this); if (!k.alive) K.free(i); }
    const S = this.sheep;
    for (let i = S.active - 1; i >= 0; i--) { const s = S.items[i]; s.update(dt, this); if (!s.alive) S.free(i); }
    this.sheepT -= dt; if (this.sheepT <= 0 && S.active < 4) { this.sheepT = 45; const t = this.world.grassFar(this.player.x, this.player.y, 500); const s = S.alloc(); if (s) { s.init(this.world.tileCenterX(t), this.world.tileCenterY(t)); fx.fx(TS.SPR.dust2, s.x, s.y - 6, { fps: 20, layer: 0 }); } }
    fx.update(dt);
    this.updateAnnouncement(dt);
    this.updateCamera(dt);
    if (this.state === 'playing') {
      this.checkLevel();
      if (this.time >= TS.CFG.RUN_SECONDS) this.endRun(true);
      this.musicT -= dt; if (this.musicT <= 0) { this.musicT = 1; SFX.setIntensity(Math.min(1, 0.15 + 0.6 * Math.min(1, this.time / 480) + (this.boss && this.boss.alive ? 0.25 : 0))); }
    }
  }
  updateAnnouncement(dt) {
    const a = this.announcement; if (!a) return;
    a.t += dt;
    if (a.t >= a.dur) { this.announcement = this.queue.length ? this.queue.shift() : null; }
  }
  updateCamera(dt) {
    const P = this.player, R = this.R, w = this.world;
    const lx = clamp((P.aimX - P.x) * 0.16, -110, 110), ly = clamp((P.aimY - P.y) * 0.16, -80, 80);
    const tx = P.x + lx - R.viewW / 2, ty = P.y - 24 + ly - R.viewH / 2;
    const k = 1 - Math.exp(-7 * dt);
    this.camX += (tx - this.camX) * k; this.camY += (ty - this.camY) * k;
    const minX = w.minX, maxX = w.maxX - R.viewW, minY = w.minY, maxY = w.maxY - R.viewH;
    this.camX = maxX < minX ? (minX + maxX) / 2 : clamp(this.camX, minX, maxX);
    this.camY = maxY < minY ? (minY + maxY) / 2 : clamp(this.camY, minY, maxY);
  }
  // ---- spatial hash + separation ----------------------------------------
  rebuildGrid() {
    const used = this.used, B = this.buckets;
    for (let i = 0; i < used.length; i++) used[i].length = 0;
    used.length = 0;
    const E = this.enemies, cs = this.cell;
    for (let i = 0; i < E.active; i++) {
      const e = E.items[i]; if (!e.alive) continue;
      const cx = clamp((e.x / cs) | 0, 0, this.gcols - 1), cy = clamp((e.y / cs) | 0, 0, this.grows - 1);
      const b = B[cy * this.gcols + cx]; if (b.length === 0) used.push(b); b.push(e);
    }
  }
  separate() {
    const E = this.enemies, B = this.buckets, cs = this.cell, gc = this.gcols, gr = this.grows, P = this.player;
    for (let i = 0; i < E.active; i++) {
      const e = E.items[i]; if (!e.alive || e.state === 'charge' || e.state === 'spawn') continue;
      const cx = clamp((e.x / cs) | 0, 0, gc - 1), cy = clamp((e.y / cs) | 0, 0, gr - 1);
      const m1 = e.r * e.r;
      for (let yy = Math.max(0, cy - 1); yy <= Math.min(gr - 1, cy + 1); yy++) for (let xx = Math.max(0, cx - 1); xx <= Math.min(gc - 1, cx + 1); xx++) {
        const b = B[yy * gc + xx];
        for (let k = 0; k < b.length; k++) {
          const o = b[k]; if (o === e || o.state === 'spawn') continue;
          const rr = e.r + o.r; let dx = e.x - o.x, dy = e.y - o.y;
          if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
          let d2 = dx * dx + dy * dy; if (d2 >= rr * rr) continue;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy; }
          const d = Math.sqrt(d2), overlap = rr - d, w = (o.r * o.r) / (m1 + o.r * o.r);
          e.x += dx / d * overlap * w; e.y += dy / d * overlap * w;
        }
      }
    }
    // player vs enemies (dash passes through)
    if (P.alive && P.state !== 'dash') {
      const cx = clamp((P.x / cs) | 0, 0, gc - 1), cy = clamp((P.y / cs) | 0, 0, gr - 1);
      for (let yy = Math.max(0, cy - 1); yy <= Math.min(gr - 1, cy + 1); yy++) for (let xx = Math.max(0, cx - 1); xx <= Math.min(gc - 1, cx + 1); xx++) {
        const b = B[yy * gc + xx];
        for (let k = 0; k < b.length; k++) {
          const o = b[k]; if (o.state === 'spawn') continue;
          const rr = P.r + o.r - 2; let dx = P.x - o.x, dy = P.y - o.y;
          if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
          let d2 = dx * dx + dy * dy; if (d2 >= rr * rr) continue;
          if (d2 < 0.01) { dx = 0.5; dy = 0; d2 = 0.25; }
          const d = Math.sqrt(d2), overlap = rr - d, wp = o.state === 'charge' ? 1 : 0.35;
          P.x += dx / d * overlap * wp; P.y += dy / d * overlap * wp;
          if (o.state !== 'charge' && !o.boss) { o.x -= dx / d * overlap * (1 - wp); o.y -= dy / d * overlap * (1 - wp); }
        }
      }
    }
  }
  // ---- spawning ---------------------------------------------------------
  pickType(t) {
    const wP = 10 - Math.min(5, t * 0.6);
    const wW = t >= 1 ? Math.min(6, 1 + 2 * (t - 1)) : 0;
    const wA = t >= 2 ? Math.min(4, 1 + 1.5 * (t - 2)) : 0;
    const wL = t >= 3.5 ? Math.min(2.5, 0.6 + 0.7 * (t - 3.5)) : 0;
    const wM = t >= 5 ? Math.min(2, 0.6 + 0.6 * (t - 5)) : 0;
    let r = Math.random() * (wP + wW + wA + wL + wM);
    if ((r -= wP) < 0) return 'pawn'; if ((r -= wW) < 0) return 'warrior'; if ((r -= wA) < 0) return 'archer'; if ((r -= wL) < 0) return 'lancer'; return 'monk';
  }
  sideFilter(side) {
    const w = this.world, cx = w.gw / 2, cy = w.gh / 2;
    if (side === 0) return (c, r) => r < cy - 3; if (side === 1) return (c, r) => c > cx + 5; if (side === 2) return (c, r) => r > cy + 3; return (c, r) => c < cx - 5;
  }
  spawnOne(type, side, t) {
    const w = this.world, P = this.player;
    const tile = w.shoreFar(P.x, P.y, 560, side === undefined ? null : this.sideFilter(side));
    const x = w.tileCenterX(tile), y = w.tileCenterY(tile);
    const n = type === 'pawn' ? randInt(2, 3) : 1;
    const elite = t >= 6 && Math.random() < 0.08 + 0.03 * (t - 6);
    let made = 0;
    for (let i = 0; i < n; i++) {
      const e = this.enemies.alloc(); if (!e) break;
      made++;
      e.init(type, x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 30, elite ? 'black' : 'red', elite, false, this);
      this.fx.fx(TS.SPR.splash, e.x, e.y - 20, { fps: 18, scale: 0.9 });
    }
    this.sfxAt('spawn', x, y, { vol: 0.5 });
    if (INTRO[type] && !this.introduced[type]) { this.introduced[type] = true; this.announce(INTRO[type][0], type === 'lancer' ? 'red' : 'purple', 2.6, INTRO[type][1]); }
    return made;
  }
  updateSpawns(dt, t) {
    const E = this.enemies;
    this.spawnAcc += TS.CFG.spawnRate(t) * dt;
    while (this.spawnAcc >= 1) { if (E.active >= TS.CFG.MAX_ENEMIES) { this.spawnAcc = 0; break; } this.spawnAcc -= Math.max(1, this.spawnOne(this.pickType(t), undefined, t)); }
    this.surgeT -= dt;
    if (this.surgeT <= 0) {
      this.surgeT = TS.CFG.SURGE_EVERY; this.wave++; this.surgeLeft = TS.CFG.surgeCount(t); this.surgeSide = randInt(0, 3); this.surgeTick = 0;
      this.announce('WAVE ' + this.wave, 'red', 2.2, ['from the north', 'from the east', 'from the south', 'from the west'][this.surgeSide]);
      SFX.play('wave');
    }
    if (this.surgeLeft > 0) { this.surgeTick -= dt; if (this.surgeTick <= 0) { this.surgeTick = 0.14; if (E.active < TS.CFG.MAX_ENEMIES + 20) this.surgeLeft -= Math.max(1, this.spawnOne(this.pickType(t), this.surgeSide, t)); else this.surgeLeft--; } }
    if (!this.bossSpawned && this.time >= TS.CFG.BOSS_AT) {
      this.bossSpawned = true;
      const w = this.world, tile = w.shoreFar(this.player.x, this.player.y, 600, null);
      const e = E.alloc();
      if (e) { e.init('lancer', w.tileCenterX(tile), w.tileCenterY(tile), 'black', true, true, this); this.boss = e; this.fx.fx(TS.SPR.splash, e.x, e.y - 20, { fps: 14, scale: 1.6 }); }
      this.announce('THE WARLORD LANDS', 'black', 3, 'Three charges in a row. Survive it, or slay it.');
      SFX.play('boss'); this.fx.shake(0.7);
    }
    if (!this.dawnAnnounced && this.time >= TS.CFG.RUN_SECONDS - 30) { this.dawnAnnounced = true; this.announce('DAWN IS NEAR', 'yellow', 2.5, 'Thirty seconds. Hold!'); }
  }
  spawnArrow(x, y, vx, vy, dmg) { const a = this.arrows.alloc(); if (a) a.init(x, y, vx, vy, dmg); }
  spawnPickup(type, x, y, val) { let k = this.pickups.alloc(); if (!k) { k = this.pickups.items[0]; } k.init(type, x, y, val); }
  collect(k) {
    const P = this.player;
    if (k.type === 'gold') { const v = Math.round(k.val * P.goldMult); this.score += v; this.scorePop = 0.2; this.fx.text(P.x, P.y - 60, '+' + v, '#ffd54a', 14); this.sfxAt('coin', P.x, P.y, { vol: 0.5 }); this.fx.spark(k.x, k.y - 10, 4, '#ffd54a', 120, 2, 300); }
    else { P.heal(k.val, this); this.sfxAt('meat', P.x, P.y); this.fx.burst(P.x, P.y - 30, 12, ['#7CFC8A', '#ffffff'], 140); }
  }
  // ---- combat glue -------------------------------------------------------
  onEnemyKilled(e) {
    this.kills++; this.combo++; this.comboT = 2; this.comboPop = 1; if (this.combo > this.comboBest) this.comboBest = this.combo;
    const mult = (1 + 0.1 * Math.min(20, this.combo - 1)) * (1 + 0.1 * (this.time / 60));
    const pts = Math.round(e.scoreValue * mult); this.score += pts; this.scorePop = 0.25;
    this.player.xp += e.xpValue;
    if (this.player.lifesteal) this.player.heal(this.player.lifesteal, this);
    const gold = e.boss ? 40 : e.elite ? randInt(5, 8) : e.type === 'pawn' ? 1 : randInt(1, 3);
    for (let i = 0; i < gold; i++) this.spawnPickup('gold', e.x, e.y, 5);
    if (Math.random() < (e.elite ? 0.3 : 0.05)) this.spawnPickup('meat', e.x, e.y, 20);
    this.fx.fx(TS.SPR.dust2, e.x, e.y - 6, { fps: 22, layer: 0, scale: e.scale });
    this.fx.burst(e.x, e.y - 24 * e.scale, e.elite ? 24 : 10, e.color === 'black' ? ['#3a3a4a', '#8a3a4a', '#ffffff'] : ['#c0392b', '#ffffff', '#f5b7b1'], 200);
    this.fx.text(e.x, e.y - 76 * e.scale, '+' + pts, '#ffd54a', 15);
    this.sfxAt('kill', e.x, e.y, { pitch: e.type === 'lancer' ? 0.7 : 1 });
    if (e.elite || e.boss) { this.fx.fx(TS.SPR.explosion2, e.x, e.y - 30 * e.scale, { fps: 18, scale: e.boss ? 1.8 : 1 }); this.fx.shake(e.boss ? 1 : 0.5); this.fx.stop(e.boss ? 0.2 : 0.09); this.sfxAt('boom', e.x, e.y); }
    if (e.boss) { this.boss = null; this.score += 1500; this.announce('WARLORD SLAIN', 'yellow', 3, '+1500'); }
  }
  onPlayerDeath() {
    this.state = 'dying'; this.dyingT = 1.6; this.timeScale = 0.25;
    this.fx.shake(0.9); this.fx.stop(0.15); this.fx.screenFlash('#ff2a2a', 0.5);
    this.fx.fx(TS.SPR.explosion2, this.player.x, this.player.y - 30, { fps: 16, scale: 1.2 });
    this.fx.burst(this.player.x, this.player.y - 20, 30, ['#4aa3ff', '#ffffff', '#ffd54a'], 260);
    SFX.stopMusic(); SFX.play('gameover');
  }
  endRun(won) {
    this.timeScale = 1;
    if (won) {
      const E = this.enemies;
      for (let i = 0; i < E.active; i++) { const e = E.items[i]; if (e.alive) { e.alive = false; this.fx.fx(TS.SPR.dust2, e.x, e.y - 6, { fps: 22, layer: 0 }); this.spawnPickup('gold', e.x, e.y, 5); } }
      for (let i = E.active - 1; i >= 0; i--) if (!E.items[i].alive) E.free(i);
      this.score += 2000; this.fx.screenFlash('#ffe9b0', 0.8); SFX.stopMusic(); SFX.play('victory');
    }
    this.state = won ? 'victory' : 'gameover';
    const rec = { score: Math.round(this.score), time: Math.round(this.time), level: this.player.level, kills: this.kills, won };
    if (!this.best || rec.score > this.best.score) { this.best = rec; this.newBest = true; TS.storage.set('ts_laststand_best', rec); }
  }
  // ---- upgrades -----------------------------------------------------------
  checkLevel() {
    const P = this.player;
    while (P.xp >= P.xpNext) { P.xp -= P.xpNext; P.level++; P.xpNext = P.xpFor(P.level); this.levelQueue++; }
    if (this.levelQueue > 0) this.openLevelUp();
  }
  openLevelUp() {
    const P = this.player, avail = UPGRADES.filter(u => (P.upg[u.key] || 0) < u.max);
    for (let i = avail.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = avail[i]; avail[i] = avail[j]; avail[j] = t; }
    this.choices = avail.slice(0, 3);
    while (this.choices.length < 3) this.choices.push({ key: 'rations', name: 'Rations', icon: 'meat', max: 1, desc: 'Heal 40 HP.', flavor: 'Simple pleasures.' });
    this.state = 'levelup'; this.botPickT = 0.3;
    SFX.play('levelup'); this.fx.screenFlash('#ffffff', 0.35);
    this.fx.text(P.x, P.y - 90, 'LEVEL UP!', '#ffd54a', 26);
  }
  chooseUpgrade(i) {
    const P = this.player, c = this.choices[i]; if (!c) return;
    if (c.key === 'rations') P.heal(40, this);
    else { P.upg[c.key] = (P.upg[c.key] || 0) + 1; P.recalc(); if (c.key === 'iron') P.heal(30, this); }
    this.levelQueue--; this.choices = null; this.state = 'playing';
    P.invT = Math.max(P.invT, 0.6);
    this.fx.burst(P.x, P.y - 30, 24, ['#ffd54a', '#ffffff', '#c973ff'], 220);
    SFX.play('select');
  }
  // ---- bot (play-test / demo) -----------------------------------------------
  setBot(on) { this.bot = !!on; if (!on) { const c = this.ctrl; c.mx = c.my = 0; c.attack = false; } }
  botChoose() { const pri = ['edge', 'iron', 'quick', 'vamp', 'arc', 'whirl', 'second', 'fleet', 'dashm', 'lucky', 'heavy', 'adren', 'gold', 'rations']; let best = 0, bi = 99; for (let i = 0; i < 3; i++) { const k = pri.indexOf(this.choices[i].key); if (k >= 0 && k < bi) { bi = k; best = i; } } this.chooseUpgrade(best); }
  botThink() {
    const P = this.player, E = this.enemies, c = this.ctrl;
    let near = null, nd = 1e9, threat = null, count = 0, cxs = 0, cys = 0, wind = null, windD = 1e9, winds = 0;
    for (let i = 0; i < E.active; i++) {
      const e = E.items[i]; if (!e.alive) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = Math.sqrt(dx * dx + dy * dy);
      let score = d; if (e.type === 'monk') score *= 0.5; if (e.type === 'archer') score *= 0.75;
      if (score < nd) { nd = score; near = e; }
      if (d < 110) { count++; cxs += dx; cys += dy; }
      if ((e.state === 'windup' || e.state === 'poke') && d < 120) { winds++; if (d < windD) { windD = d; wind = e; } }
      if (e.type === 'lancer' && (e.state === 'telegraph' || e.state === 'charge') && d < 380) {
        const along = -(dx * e.dx + dy * e.dy); // player position relative to the lancer, projected on its charge direction
        const perp = Math.abs(dx * e.dy - dy * e.dx);
        if (along > 0 && perp < 80) threat = e;
      }
    }
    c.mx = 0; c.my = 0; c.attack = false;
    let meat = null;
    if (P.hp < P.maxHp * 0.5) { const K = this.pickups; let bd = 500 * 500; for (let i = 0; i < K.active; i++) { const k = K.items[i]; if (k.type !== 'meat') continue; const d2 = sqr(k.x - P.x) + sqr(k.y - P.y); if (d2 < bd) { bd = d2; meat = k; } } }
    if (threat) {
      const px = -threat.dy, py = threat.dx; const side = ((P.x - threat.x) * px + (P.y - threat.y) * py) >= 0 ? 1 : -1;
      c.mx = px * side; c.my = py * side; if (P.dashCd <= 0 && Math.sqrt(sqr(threat.x - P.x) + sqr(threat.y - P.y)) < 260) c.dash = true;
    } else if (wind) { const dx = P.x - wind.x, dy = P.y - wind.y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy)); c.mx = dx / d; c.my = dy / d; if (winds >= 2 && P.dashCd <= 0) c.dash = true; }
    else if (meat) { const dx = meat.x - P.x, dy = meat.y - P.y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy)); c.mx = dx / d; c.my = dy / d; }
    else if (near) {
      const dx = near.x - P.x, dy = near.y - P.y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const w = this.world, ccx = w.cx - P.x, ccy = w.cy - P.y, cd = Math.sqrt(ccx * ccx + ccy * ccy);
      if (count > 6 && P.hp < P.maxHp * 0.6) { const l = Math.max(1, Math.sqrt(cxs * cxs + cys * cys)); c.mx = -cxs / l; c.my = -cys / l; if (count > 9 && P.dashCd <= 0) c.dash = true; }
      else if (d > 280) { if (cd > 240) { c.mx = ccx / cd; c.my = ccy / cd; } } // fight from open ground: let far enemies come to you
      else if (d > P.reach * 0.7) { c.mx = dx / d; c.my = dy / d; }
    } else { const w = this.world, ccx = w.cx - P.x, ccy = w.cy - P.y, cd = Math.sqrt(ccx * ccx + ccy * ccy); if (cd > 240) { c.mx = ccx / cd; c.my = ccy / cd; } }
    if (near) { c.aimX = near.x; c.aimY = near.y; const d = Math.sqrt(sqr(near.x - P.x) + sqr(near.y - P.y)); if (d < P.reach + near.r + 18) { c.attack = true; c.attackPressed = true; } }
    else { c.aimX = P.x + 100; c.aimY = P.y; }
    // arrows incoming
    const A = this.arrows;
    for (let i = 0; i < A.active; i++) { const a = A.items[i]; const rx = P.x - a.x, ry = P.y - 20 - a.y; const t = (rx * a.vx + ry * a.vy) / (a.vx * a.vx + a.vy * a.vy); if (t > 0 && t < 0.35) { const cx = a.x + a.vx * t - P.x, cy = a.y + a.vy * t - (P.y - 20); if (cx * cx + cy * cy < 40 * 40) { c.mx = -a.vy / 470; c.my = a.vx / 470; break; } } }
    // keep off the water edge: nudge to island centre if standing near water
    if (!this.world.isGrassAt(P.x + c.mx * 40, P.y + c.my * 40)) { const dx = this.world.cx - P.x, dy = this.world.cy - P.y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy)); c.mx = dx / d; c.my = dy / d; }
  }
  // ---- render ----------------------------------------------------------------
  render() {
    const R = this.R, w = this.world, fx = this.fx, P = this.player, st = this.state;
    if (st === 'menu') { this.camX = w.cx + Math.sin(this.menuT * 0.11) * 260 - R.viewW / 2; this.camY = w.cy + Math.cos(this.menuT * 0.09) * 140 - 60 - R.viewH / 2; }
    R.camX = this.camX; R.camY = this.camY;
    if (st === 'playing' || st === 'dying') fx.applyShake(R); else { R.shakeX = 0; R.shakeY = 0; }
    R.begin();
    w.drawWater(R); w.drawWaterDecor(R); w.drawFoam(R); w.drawGround(R);
    const E = this.enemies;
    fx.drawGround(R);
    for (let i = 0; i < E.active; i++) { const e = E.items[i]; if (e.state === 'telegraph' && R.visible(e.x - 500, e.y - 500, 1000, 1000)) e.drawTelegraph(R); }
    if (P.alive && st !== 'menu') { const c = R.ctx; R.worldTransform(); c.globalAlpha = 0.35; c.strokeStyle = '#eaf6ff'; c.lineWidth = 3; c.beginPath(); c.ellipse(P.x, P.y + 2, 24, 12, 0, 0, TAU); c.stroke(); c.globalAlpha = 1; R.identity(); }
    // shadows
    for (let i = 0; i < E.active; i++) { const e = E.items[i]; if (R.visible(e.x - 60, e.y - 60, 120, 120)) e.drawShadow(R); }
    if (P.alive) { const s = TS.SPR.shadow; R.imageWorld(s.img, s.u[0], s.u[1], s.u[2], s.u[3], P.x - 26, P.y - 11, 52, 24, 0.7); }
    for (let i = 0; i < this.sheep.active; i++) this.sheep.items[i].drawShadow(R);
    // depth-sorted layer
    const L = this.drawList; L.length = 0;
    const dec = w.decor; for (let i = 0; i < dec.length; i++) { const d = dec[i]; if (R.visible(d.x - 128, d.y - 260, 256, 300)) L.push(d); }
    const bld = w.buildings; for (let i = 0; i < bld.length; i++) { const b = bld[i]; if (R.visible(b.x - 200, b.y - 340, 400, 380)) L.push(b); }
    for (let i = 0; i < E.active; i++) { const e = E.items[i]; if (R.visible(e.x - 200, e.y - 300, 400, 400)) { e.sy = e.y; L.push(e); } }
    if (P.alive || st === 'dying') { P.sy = P.y; L.push(P); }
    for (let i = 0; i < this.sheep.active; i++) L.push(this.sheep.items[i]);
    const K = this.pickups; for (let i = 0; i < K.active; i++) { const k = K.items[i]; if (R.visible(k.x - 40, k.y - 60, 80, 90)) L.push(k); }
    const A = this.arrows; for (let i = 0; i < A.active; i++) { const a = A.items[i]; a.sy = a.y + 30; L.push(a); }
    L.sort((a, b) => a.sy - b.sy);
    for (let i = 0; i < L.length; i++) L[i].draw(R, this);
    fx.drawAir(R);
    for (let i = 0; i < E.active; i++) E.items[i].drawHpBar(R);
    w.drawCloudShadows(R); w.drawClouds(R);
    this.drawTint();
    fx.drawFlash(R);
    // UI
    const ui = this.ui;
    if (st === 'menu') ui.drawMenu(this);
    else if (st === 'playing' || st === 'dying' || st === 'paused' || st === 'levelup') { ui.drawHUD(this); if (st === 'paused') ui.drawPause(this); if (st === 'levelup') ui.drawLevelUp(this); }
    else if (st === 'gameover') ui.drawEnd(this, false);
    else if (st === 'victory') ui.drawEnd(this, true);
    if (this.showFps) ui.drawFps(this);
  }
  drawTint() {
    const t = this.state === 'menu' ? 0 : this.time; let a, color = '#1a2350';
    if (t < 90) { color = '#ffb347'; a = 0.06 * (1 - t / 90); }
    else if (t < 180) a = 0.2 * ((t - 90) / 90);
    else if (t < 500) a = 0.2;
    else if (t < 570) a = 0.2 * (1 - (t - 500) / 70);
    else { color = '#ffb347'; a = 0.12 * Math.min(1, (t - 570) / 30); }
    if (this.state === 'victory') { color = '#ffd88a'; a = 0.18; }
    if (a > 0.005) this.R.rect(0, 0, this.R.W, this.R.H, color, a);
  }
  publicState() { const s = this.state; return s === 'dying' ? 'playing' : s; }
};
