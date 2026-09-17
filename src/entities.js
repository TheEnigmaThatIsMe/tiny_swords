'use strict';
// Player, enemies (pawn / warrior / archer / lancer / monk, elites, boss), arrows, pickups, sheep.
let nextEntityId = 1;

class Anim {
  constructor() { this.s = null; this.fps = 10; this.t = 0; this.frame = 0; this.loop = true; }
  set(s, fps, loop) { if (this.s !== s) { this.s = s; this.t = 0; this.frame = 0; } this.fps = fps; this.loop = loop !== false; }
  restart(s, fps, loop) { this.s = s; this.t = 0; this.frame = 0; this.fps = fps; this.loop = loop !== false; }
  update(dt) { this.t += dt * this.fps; const n = this.s.n; this.frame = this.loop ? ((this.t | 0) % n) : Math.min(n - 1, this.t | 0); }
}
TS.Anim = Anim;

// Sprite tables per faction colour, built once after assets load.
TS.buildSprites = function () {
  const A = TS.Assets, SPR = TS.SPR = {};
  for (const c of ['red', 'black']) {
    SPR[c] = {
      pawn: { idle: A.sheet('pawn_' + c + '_idle'), run: A.sheet('pawn_' + c + '_run'), attack: A.sheet('pawn_' + c + '_attack') },
      warrior: { idle: A.sheet('warrior_' + c + '_idle'), run: A.sheet('warrior_' + c + '_run'), attack: A.sheet('warrior_' + c + '_attack1') },
      archer: { idle: A.sheet('archer_' + c + '_idle'), run: A.sheet('archer_' + c + '_run'), attack: A.sheet('archer_' + c + '_shoot') },
      monk: { idle: A.sheet('monk_' + c + '_idle'), run: A.sheet('monk_' + c + '_run'), attack: A.sheet('monk_' + c + '_heal'), healfx: A.sheet('monk_' + c + '_healfx') },
      lancer: { idle: A.sheet('lancer_' + c + '_idle'), run: A.sheet('lancer_' + c + '_run'),
        attack: { right: A.sheet('lancer_' + c + '_attack_right'), upright: A.sheet('lancer_' + c + '_attack_upright'), downright: A.sheet('lancer_' + c + '_attack_downright'), up: A.sheet('lancer_' + c + '_attack_up'), down: A.sheet('lancer_' + c + '_attack_down') },
        defence: { right: A.sheet('lancer_' + c + '_defence_right'), upright: A.sheet('lancer_' + c + '_defence_upright'), downright: A.sheet('lancer_' + c + '_defence_downright'), up: A.sheet('lancer_' + c + '_defence_up'), down: A.sheet('lancer_' + c + '_defence_down') } },
    };
  }
  SPR.blue = { warrior: { idle: A.sheet('warrior_blue_idle'), run: A.sheet('warrior_blue_run'), attack1: A.sheet('warrior_blue_attack1'), attack2: A.sheet('warrior_blue_attack2'), guard: A.sheet('warrior_blue_guard') } };
  SPR.arrow = A.sheet('arrow_red'); SPR.shadow = A.sheet('shadow');
  SPR.dust1 = A.sheet('fx_dust1'); SPR.dust2 = A.sheet('fx_dust2'); SPR.explosion1 = A.sheet('fx_explosion1'); SPR.explosion2 = A.sheet('fx_explosion2'); SPR.splash = A.sheet('fx_splash');
  SPR.gold = A.sheet('gold_pick'); SPR.meat = A.sheet('meat');
  SPR.sheep = { idle: A.sheet('sheep_idle'), move: A.sheet('sheep_move'), grass: A.sheet('sheep_grass') };
};

const ETYPES = {
  pawn:    { hp: 28,  speed: 150, dmg: 7,  r: 14, xp: 3,  score: 10, range: 46,  windup: 0.32, recover: 0.4,  cd: 1.0, kbRes: 0,    interrupt: 2 },
  warrior: { hp: 90,  speed: 108, dmg: 12, r: 18, xp: 8,  score: 30, range: 76,  windup: 0.5,  recover: 0.55, cd: 1.5, kbRes: 0.3,  interrupt: 1 },
  archer:  { hp: 45,  speed: 125, dmg: 8, r: 14, xp: 6,  score: 25, keepMin: 230, keepMax: 420, shootRange: 480, shootT: 0.55, cd: 2.8, kbRes: 0, interrupt: 2 },
  lancer:  { hp: 180, speed: 82,  dmg: 22, r: 22, xp: 20, score: 60, chargeRange: 440, telegraph: 0.7, chargeSpeed: 720, chargeT: 0.5, stagger: 0.9, cd: 3.2, pokeRange: 100, pokeDmg: 12, pokeWind: 0.45, pokeCd: 1.8, kbRes: 0.75, interrupt: 0 },
  monk:    { hp: 60,  speed: 100, dmg: 0,  r: 15, xp: 10, score: 40, keepMin: 200, keepMax: 330, healRange: 240, healT: 0.9, healAmt: 0.25, cd: 3.0, kbRes: 0, interrupt: 2 },
};
TS.ETYPES = ETYPES;

// Pick a lancer direction sheet key for a direction vector. Returns key; sets obj.dirFlip.
function lancerDir(o, dx, dy) {
  const deg = Math.atan2(dy, dx) * 180 / PI, ad = Math.abs(deg);
  o.dirFlip = ad > 112.5;
  if (ad <= 22.5 || ad > 157.5) return 'right';
  if (ad <= 67.5 || ad > 112.5) return deg > 0 ? 'downright' : 'upright';
  return deg > 0 ? 'down' : 'up';
}

// ---------------------------------------------------------------------------
class Player {
  constructor() {
    this.id = nextEntityId++; this.anim = new Anim(); this.alive = true; this.r = 16; this.kind = 'player';
    this.trail = new Float32Array(8); this.upg = {};
    this.reset(0, 0);
  }
  reset(x, y) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.kbx = 0; this.kby = 0;
    this.alive = true; this.state = 'idle'; this.facing = 1; this.aimA = 0; this.aimX = x + 100; this.aimY = y;
    this.hp = 120; this.level = 1; this.xp = 0; this.xpNext = this.xpFor(1);
    for (const k of ['edge', 'quick', 'arc', 'heavy', 'fleet', 'iron', 'vamp', 'whirl', 'dashm', 'gold', 'second', 'adren', 'lucky']) this.upg[k] = 0;
    this.secondUsed = false; this.recalc(); this.hp = this.maxHp;
    this.attackT = 0; this.attackDur = 0.36; this.combo = 0; this.chain = 0; this.hitDone = false; this.queued = false; this.whirling = false; this.swingA = 0;
    this.dashT = 0; this.dashCd = 0; this.dashDx = 1; this.dashDy = 0; this.trailT = 0; this.trailN = 0;
    this.invT = 0; this.hurtT = 0; this.moving = false; this.runDust = 0; this.hitsThisSwing = 0; this.reviveT = 0;
    this.anim.restart(TS.SPR.blue.warrior.idle, 8, true);
  }
  xpFor(level) { return Math.round(16 + level * 8 + level * level * 2.2); }
  recalc() {
    const u = this.upg;
    this.dmg = 15 * (1 + 0.25 * u.edge);
    this.atkSpeed = 1 + 0.15 * u.quick;
    this.reach = 88 * (1 + 0.15 * u.arc); this.half = 1.15 + 0.2 * u.arc;
    this.kb = 260 * (1 + 0.4 * u.heavy); this.stunBonus = 0.12 * u.heavy;
    this.speed = 195 * (1 + 0.12 * u.fleet);
    const oldMax = this.maxHp || 120; this.maxHp = 120 + 25 * u.iron; if (this.hp) this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - oldMax));
    this.dashCdMax = 1.6 * Math.pow(0.75, u.dashm); this.dashDist = 150 * Math.pow(1.25, u.dashm);
    this.crit = 0.05 + 0.1 * u.lucky; this.lifesteal = 1 * u.vamp; this.magnet = 130 * (1 + 0.4 * u.gold); this.goldMult = 1 + 0.5 * u.gold;
  }
  adrenaline() { return this.upg.adren && this.hp < this.maxHp * 0.35 ? 1.3 : 1; }
  heal(n, g) { const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + n); const got = Math.round(this.hp - before); if (got > 0 && g) g.fx.text(this.x, this.y - 70, '+' + got, '#7CFC8A', 18); }
  update(dt, ctrl, g) {
    const W = g.world, S = TS.SPR.blue.warrior;
    if (this.invT > 0) this.invT -= dt; if (this.hurtT > 0) this.hurtT -= dt; if (this.dashCd > 0) this.dashCd -= dt; if (this.reviveT > 0) this.reviveT -= dt;
    // aim
    this.aimX = ctrl.aimX; this.aimY = ctrl.aimY;
    const adx = this.aimX - this.x, ady = this.aimY - (this.y - 20);
    this.aimA = Math.atan2(ady, adx);
    let mx = ctrl.mx, my = ctrl.my; const ml = Math.sqrt(mx * mx + my * my); if (ml > 1) { mx /= ml; my /= ml; }
    this.moving = ml > 0.1;
    // dash
    if (ctrl.dash && this.dashCd <= 0 && this.state !== 'dash') {
      this.state = 'dash'; this.dashT = 0.2; this.dashCd = this.dashCdMax; this.invT = Math.max(this.invT, 0.25);
      if (this.moving) { this.dashDx = mx; this.dashDy = my; } else { this.dashDx = Math.cos(this.aimA); this.dashDy = Math.sin(this.aimA); }
      this.trailN = 0; this.trailT = 0; this.queued = false;
      g.sfxAt('dash', this.x, this.y); g.fx.fx(TS.SPR.dust2, this.x, this.y - 6, { fps: 24, layer: 0, scale: 1.2 });
    }
    // attack start / chaining
    const wantAttack = ctrl.attack || ctrl.attackPressed;
    if (this.state === 'attack') {
      this.attackT += dt * this.atkSpeed * this.adrenaline();
      const p = this.attackT / this.attackDur;
      if (!this.hitDone && p >= 0.5) { this.hitDone = true; this.doHit(g); }
      if (p >= 0.5 && wantAttack) this.queued = true;
      if (p >= 1 || (p >= 0.72 && this.queued)) {
        if (this.queued) this.startAttack(g, true); else { this.state = 'idle'; this.chain = 0; }
      }
    } else if (this.state === 'dash') {
      this.dashT -= dt;
      this.trailT -= dt;
      if (this.trailT <= 0 && this.trailN < 4) { this.trail[this.trailN * 2] = this.x; this.trail[this.trailN * 2 + 1] = this.y; this.trailN++; this.trailT = 0.035; }
      if (this.dashT <= 0) { this.state = 'idle'; if (wantAttack) this.startAttack(g, false); }
    } else if (wantAttack) { this.startAttack(g, false); }
    // movement
    let spd = this.speed * this.adrenaline();
    if (this.state === 'attack') spd *= 0.35;
    if (this.state === 'dash') { this.vx = this.dashDx * this.dashDist / 0.2; this.vy = this.dashDy * this.dashDist / 0.2; }
    else { this.vx = mx * spd; this.vy = my * spd; }
    this.x += (this.vx + this.kbx) * dt; this.y += (this.vy + this.kby) * dt;
    const kd = 1 - Math.min(1, 9 * dt); this.kbx *= kd; this.kby *= kd;
    W.collide(this);
    if (this.state === 'dash') this.facing = this.dashDx < 0 ? -1 : 1; else this.facing = adx < 0 ? -1 : 1;
    // run dust
    if (this.moving && this.state !== 'attack') { this.runDust -= dt; if (this.runDust <= 0) { this.runDust = 0.28; g.fx.fx(TS.SPR.dust1, this.x - this.facing * 10, this.y - 2, { fps: 20, layer: 0, scale: 0.8, alpha: 0.8 }); } }
    // animation
    if (this.state === 'attack') { const s = this.whirling || this.combo === 1 ? S.attack2 : S.attack1; this.anim.set(s, 1, false); this.anim.frame = Math.min(3, (this.attackT / this.attackDur * 4) | 0); }
    else if (this.state === 'dash') { this.anim.set(S.run, 22, true); this.anim.update(dt); }
    else if (this.moving) { this.anim.set(S.run, 11, true); this.anim.update(dt); }
    else { this.anim.set(S.idle, 8, true); this.anim.update(dt); }
  }
  startAttack(g, chained) {
    this.state = 'attack'; this.attackT = 0; this.hitDone = false; this.queued = false;
    this.chain = chained ? this.chain + 1 : 0;
    this.combo = this.chain % 2;
    this.whirling = this.upg.whirl > 0 && chained && (this.chain % 3 === 2);
    this.attackDur = 0.36;
    this.swingA = this.aimA;
    g.sfxAt(this.whirling ? 'whirl' : 'swing', this.x, this.y, { pitch: this.combo ? 0.9 : 1.05 });
  }
  doHit(g) {
    const half = this.whirling ? PI : this.half, reach = this.reach * (this.whirling ? 1.2 : 1) * (this.combo ? 1.08 : 1);
    let dmg = this.dmg * (this.combo ? 1.25 : 1) * (this.whirling ? 1.5 : 1) * this.adrenaline();
    const ox = this.x, oy = this.y - 6, a = this.swingA;
    g.fx.wedge(ox, oy, a, half, reach, '#ffffff', this.whirling);
    let hits = 0, anyCrit = false; const kills0 = g.kills;
    const E = g.enemies;
    for (let i = 0; i < E.active; i++) {
      const e = E.items[i]; if (!e.alive || e.state === 'spawn') continue;
      const dx = e.x - ox, dy = e.y - oy; const d = Math.sqrt(dx * dx + dy * dy);
      if (d > reach + e.r) continue;
      if (half < PI && d > 22 && Math.abs(wrapAngle(Math.atan2(dy, dx) - a)) > half) continue;
      const crit = Math.random() < this.crit; if (crit) anyCrit = true;
      e.takeHit(dmg * (crit ? 2 : 1), ox, oy, this.kb, crit, this.stunBonus, g, true);
      hits++;
    }
    // one impact sound per swing, weighted by how much it connected, instead of one per enemy
    const kills = g.kills - kills0;
    if (hits > 0) g.sfxAt(anyCrit ? 'crit' : 'hit', ox, oy, { pitch: 1.05 - Math.min(0.3, hits * 0.03), vol: Math.min(1, 0.75 + hits * 0.05) });
    if (kills > 0) g.sfxAt('kill', ox, oy, { pitch: 1 - Math.min(0.35, (kills - 1) * 0.08), vol: Math.min(1, 0.8 + kills * 0.05) });
    const SH = g.sheep;
    for (let i = 0; i < SH.active; i++) {
      const s = SH.items[i]; if (!s.alive) continue;
      const dx = s.x - ox, dy = s.y - oy; const d = Math.sqrt(dx * dx + dy * dy);
      if (d > reach + s.r) continue;
      if (half < PI && d > 22 && Math.abs(wrapAngle(Math.atan2(dy, dx) - a)) > half) continue;
      s.die(g); hits++;
    }
    this.hitsThisSwing = hits;
    if (hits > 0) { g.fx.stop(Math.min(0.09, 0.04 + 0.008 * hits)); g.fx.shake(Math.min(0.6, 0.18 + 0.05 * hits)); }
  }
  takeDamage(dmg, sx, sy, g) {
    if (!this.alive || this.invT > 0 || this.state === 'dash') return false;
    dmg = Math.round(dmg);
    this.hp -= dmg; this.hurtT = 0.45; this.invT = 0.7;
    const a = Math.atan2(this.y - sy, this.x - sx); this.kbx += Math.cos(a) * 240; this.kby += Math.sin(a) * 240;
    g.fx.shake(0.55); g.fx.stop(0.07); g.fx.screenFlash('#ff2a2a', 0.3);
    g.fx.text(this.x, this.y - 80, '-' + dmg, '#ff5555', 22);
    g.fx.spark(this.x, this.y - 30, 8, '#ff7b7b', 180, 3);
    g.sfxAt('hurt', this.x, this.y);
    if (this.hp <= 0) {
      if (this.upg.second > 0 && !this.secondUsed) {
        this.secondUsed = true; this.hp = Math.round(this.maxHp * 0.5); this.invT = 2.0; this.reviveT = 2.0;
        g.fx.screenFlash('#ffffff', 0.7); g.fx.burst(this.x, this.y - 30, 40, ['#fff', '#ffe066', '#7CFC8A'], 300); g.fx.text(this.x, this.y - 90, 'SECOND WIND!', '#ffe066', 24);
        g.sfxAt('levelup', this.x, this.y); g.announce('SECOND WIND', 'yellow', 1.6);
      } else { this.hp = 0; this.alive = false; g.onPlayerDeath(); }
    }
    return true;
  }
  draw(R, g) {
    const S = TS.SPR.blue.warrior, flip = this.facing < 0;
    if (this.state === 'dash') {
      for (let i = 0; i < this.trailN; i++) R.spriteTint(S.run, this.anim.frame, this.trail[i * 2], this.trail[i * 2 + 1], flip, 1, '#9fe0ff', 0.12 + 0.08 * i);
    }
    if (this.invT > 0 && this.hurtT <= 0 && ((g.time * 20) | 0) % 2 === 0 && this.state !== 'dash') { R.sprite(this.anim.s, this.anim.frame, this.x, this.y, flip, 1, 0.5); return; }
    R.sprite(this.anim.s, this.anim.frame, this.x, this.y, flip);
    if (this.hurtT > 0 && ((this.hurtT * 24) | 0) % 2 === 0) R.spriteTint(this.anim.s, this.anim.frame, this.x, this.y, flip, 1, '#ffffff', 0.75);
  }
}
TS.Player = Player;

// ---------------------------------------------------------------------------
class Enemy {
  constructor() { this.anim = new Anim(); this.alive = false; this.id = 0; this.kind = 'enemy'; this.x = 0; this.y = 0; this.r = 14; this.sy = 0; }
  init(type, x, y, color, elite, boss, g) {
    const cfg = ETYPES[type];
    this.id = nextEntityId++; this.type = type; this.cfg = cfg; this.color = color; this.elite = elite; this.boss = boss;
    this.spr = TS.SPR[color][type];
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.kbx = 0; this.kby = 0;
    this.scale = boss ? 1.5 : elite ? 1.15 : 1;
    this.r = cfg.r * this.scale;
    const hpMul = g.hpMult * (boss ? 20 : elite ? 2.6 : 1);
    this.maxHp = Math.round(cfg.hp * hpMul); this.hp = this.maxHp;
    this.dmg = cfg.dmg * g.dmgMult * (boss ? 1.4 : elite ? 1.3 : 1);
    this.speed = cfg.speed * (0.9 + Math.random() * 0.2) * (boss ? 1.2 : 1);
    this.alive = true; this.state = 'spawn'; this.st = 0.5; this.cd = 0.6 + Math.random() * 0.8; this.cd2 = 1; this.flash = 0; this.stun = 0; this.hpBarT = 0;
    this.facing = x > g.player.x ? -1 : 1; this.aimA = 0; this.dx = 1; this.dy = 0; this.dirKey = 'right'; this.dirFlip = false;
    this.phase = Math.random() * TAU; this.shot = false; this.chargeHit = false; this.chain = 0; this.healTarget = null; this.healTid = 0; this.scanT = 0; this.ux = 0; this.uy = 0; this.hasLos = true;
    this.anim.restart(this.spr.idle, 8, true);
    this.xpValue = Math.round(cfg.xp * (boss ? 10 : elite ? 3 : 1)); this.scoreValue = cfg.score * (boss ? 25 : elite ? 3 : 1);
  }
  // movement helpers ------------------------------------------------------
  keepBand(dx, dy, d, min, max, W, P) { // archers & monks: stay inside a distance band with a clear line to the player
    let mx = 0, my = 0;
    this.hasLos = d <= max + 40 ? W.los(this.x, this.y, P.x, P.y) : false;
    if (d > max || !this.hasLos) { if (W.flowAt(this.x, this.y, this)) { mx = this.ux; my = this.uy; } else { mx = dx / d; my = dy / d; } }
    else if (d < min) { mx = -dx / d; my = -dy / d; }
    else { const s = Math.sin(this.phase + this.st * 1.3) * 0.5; mx = -dy / d * s; my = dx / d * s; }
    this.vx = mx * this.speed; this.vy = my * this.speed;
  }
  update(dt, g) {
    const P = g.player, cfg = this.cfg, W = g.world;
    if (this.flash > 0) this.flash -= dt; if (this.stun > 0) this.stun -= dt; if (this.cd > 0) this.cd -= dt; if (this.cd2 > 0) this.cd2 -= dt; if (this.hpBarT > 0) this.hpBarT -= dt;
    const dx = P.x - this.x, dy = P.y - this.y; const d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
    this.vx = 0; this.vy = 0;
    switch (this.state) {
      case 'spawn':
        this.st -= dt; this.anim.set(this.spr.idle, 8, true); this.anim.update(dt);
        if (this.st <= 0) this.state = 'chase';
        break;
      case 'chase': {
        this.st += dt;
        const t = this.type;
        if (this.stun <= 0 && P.alive) {
          if (t === 'archer' || t === 'monk') this.keepBand(dx, dy, d, cfg.keepMin, cfg.keepMax, W, P);
          else {
            let ux = dx / d, uy = dy / d;
            // route around buildings, trunks and water unless the player is close and in plain sight
            if (d > 100 && (d > 420 || !W.los(this.x, this.y, P.x, P.y)) && W.flowAt(this.x, this.y, this)) { ux = this.ux; uy = this.uy; }
            if (t === 'pawn') { const j = Math.sin(g.time * 3.1 + this.phase) * 0.45; ux += -uy * j; uy += ux * j; }
            const stopD = t === 'lancer' ? 60 : cfg.range * 0.8;
            if (d > stopD) { this.vx = ux * this.speed; this.vy = uy * this.speed; }
          }
        }
        // decide actions
        if (P.alive && this.stun <= 0) {
          if ((t === 'pawn' || t === 'warrior') && this.cd <= 0 && d < cfg.range + P.r) {
            this.state = 'windup'; this.st = cfg.windup; this.aimA = Math.atan2(dy, dx); this.anim.restart(this.spr.attack, 1, false); this.anim.frame = 0;
          } else if (t === 'archer' && this.cd <= 0 && d < cfg.shootRange && d > 90 && this.hasLos) {
            this.state = 'shoot'; this.st = cfg.shootT; this.shot = false; this.anim.restart(this.spr.attack, 1, false);
          } else if (t === 'lancer') {
            if (this.cd <= 0 && d < cfg.chargeRange * this.scale && d > 70 && W.los(this.x, this.y, P.x, P.y)) this.startTelegraph(dx, dy, d, g, this.boss ? 4 : 1, this.boss ? 0.5 : undefined);
            else if (this.cd2 <= 0 && d < cfg.pokeRange * this.scale + P.r) {
              this.state = 'poke'; this.st = cfg.pokeWind; this.aimA = Math.atan2(dy, dx); this.dirKey = lancerDir(this, dx, dy); this.anim.restart(this.spr.attack[this.dirKey], 1, false);
            }
          } else if (t === 'monk' && this.cd <= 0) {
            this.scanT -= dt;
            if (this.scanT <= 0) { this.scanT = 0.25; this.findHealTarget(g); if (this.healTarget) { this.state = 'heal'; this.st = cfg.healT; this.shot = false; this.anim.restart(this.spr.attack, 1, false); } }
          }
        }
        const moving = this.vx !== 0 || this.vy !== 0;
        if (moving) this.facing = this.vx < 0 ? -1 : 1; else this.facing = dx < 0 ? -1 : 1;
        if (this.state === 'chase') { this.anim.set(moving ? this.spr.run : this.spr.idle, moving ? 10 : 8, true); this.anim.update(dt); }
        break;
      }
      case 'windup': {
        this.st -= dt; this.facing = Math.cos(this.aimA) < 0 ? -1 : 1;
        this.anim.frame = this.st > cfg.windup * 0.4 ? 0 : 1;
        if (this.st <= 0) {
          const inRange = d < cfg.range * this.scale + P.r + 6 && (this.type !== 'warrior' || Math.abs(wrapAngle(Math.atan2(dy, dx) - this.aimA)) < 1.3);
          if (inRange) P.takeDamage(this.dmg, this.x, this.y, g);
          g.sfxAt('swing', this.x, this.y, { pitch: 0.8, vol: 0.6 });
          this.state = 'recover'; this.st = cfg.recover; this.cd = cfg.cd * (0.9 + Math.random() * 0.3);
        }
        break;
      }
      case 'recover':
        this.st -= dt; this.anim.frame = this.st > cfg.recover * 0.5 ? 2 : 3;
        if (this.anim.s.n === 3) this.anim.frame = Math.min(2, this.anim.frame);
        if (this.st <= 0) this.state = 'chase';
        break;
      case 'shoot': {
        this.st -= dt; this.facing = dx < 0 ? -1 : 1;
        const p = 1 - this.st / cfg.shootT; this.anim.frame = Math.min(7, (p * 8) | 0);
        if (!this.shot && p >= 0.62) {
          this.shot = true;
          const lead = 0.28; const tx = P.x + P.vx * lead - this.x, ty = P.y - 20 + P.vy * lead - (this.y - 26);
          const l = Math.max(1, Math.sqrt(tx * tx + ty * ty)), sp = 440;
          g.spawnArrow(this.x + this.facing * 12, this.y - 26, tx / l * sp, ty / l * sp, this.dmg);
          g.sfxAt('arrow', this.x, this.y);
        }
        if (this.st <= 0) { this.state = 'chase'; this.cd = cfg.cd * (0.85 + Math.random() * 0.4); }
        break;
      }
      case 'telegraph':
        this.st -= dt; this.anim.set(this.spr.defence[this.dirKey], 10, true); this.anim.update(dt); this.facing = this.dirFlip ? -1 : 1;
        if (this.st <= 0) { this.state = 'charge'; this.st = cfg.chargeT; this.chargeHit = false; this.anim.restart(this.spr.attack[this.dirKey], 14, false); g.fx.fx(TS.SPR.dust2, this.x, this.y - 4, { fps: 22, layer: 0, scale: 1.4 }); }
        break;
      case 'charge': {
        this.st -= dt;
        const sp = cfg.chargeSpeed * (this.boss ? 1.15 : 1);
        const ox = this.x, oy = this.y;
        this.x += this.dx * sp * dt; this.y += this.dy * sp * dt;
        const bx = this.x, by = this.y;
        W.collide(this);
        const blocked = Math.abs(this.x - bx) + Math.abs(this.y - by) > 1.5;
        this.anim.update(dt); this.anim.frame = Math.min(this.anim.s.n - 1, 1 + ((this.st * 10) | 0) % 2);
        if (!this.chargeHit && P.alive) {
          const pdx = P.x - this.x, pdy = P.y - this.y; const rr = this.r + P.r + 4;
          if (pdx * pdx + pdy * pdy < rr * rr) { this.chargeHit = true; if (P.takeDamage(this.dmg, ox, oy, g)) g.fx.stop(0.1); }
        }
        if (((this.st * 20) | 0) !== (((this.st + dt) * 20) | 0)) g.fx.fx(TS.SPR.dust1, this.x - this.dx * 20, this.y - 2, { fps: 24, layer: 0, alpha: 0.8 });
        if (this.st <= 0 || blocked) {
          this.chain--;
          if (this.chain > 0 && P.alive) { const ndx = P.x - this.x, ndy = P.y - this.y; this.startTelegraph(ndx, ndy, Math.max(1, Math.sqrt(ndx * ndx + ndy * ndy)), g, this.chain, 0.42); }
          else { this.state = 'stagger'; this.st = this.boss ? 0.6 : cfg.stagger; this.anim.restart(this.spr.idle, 12, true); if (blocked) { g.fx.shake(0.3); g.sfxAt('boom', this.x, this.y, { vol: 0.5, pitch: 1.4 }); } }
        }
        return; // collide already applied
      }
      case 'stagger':
        this.st -= dt; this.anim.update(dt);
        if (this.st <= 0) { this.state = 'chase'; this.cd = cfg.cd * (0.9 + Math.random() * 0.3); }
        break;
      case 'poke': {
        this.st -= dt; this.facing = this.dirFlip ? -1 : 1;
        this.anim.frame = this.st > cfg.pokeWind * 0.35 ? 0 : 1;
        if (this.st <= 0) {
          this.anim.frame = 2;
          if (d < cfg.pokeRange * this.scale + P.r + 8 && Math.abs(wrapAngle(Math.atan2(dy, dx) - this.aimA)) < 0.9) P.takeDamage(cfg.pokeDmg * g.dmgMult * (this.boss ? 1.6 : 1), this.x, this.y, g);
          g.sfxAt('swing', this.x, this.y, { pitch: 0.7, vol: 0.6 });
          this.cd2 = cfg.pokeCd; this.state = 'recover'; this.st = 0.35;
        }
        break;
      }
      case 'heal': {
        this.st -= dt; const p = 1 - this.st / cfg.healT; this.anim.frame = Math.min(10, (p * 11) | 0);
        const t = this.healTarget;
        if (!this.shot && p >= 0.5) {
          this.shot = true;
          if (t && t.alive && t.id === this.healTid) {
            const amt = Math.round(t.maxHp * cfg.healAmt); t.hp = Math.min(t.maxHp, t.hp + amt); t.hpBarT = 2.5;
            g.fx.fx(this.spr.healfx, t.x, t.y - 20, { fps: 14, follow: t, oy: -20 });
            g.fx.text(t.x, t.y - 60 * t.scale, '+' + amt, '#7CFC8A', 18); g.sfxAt('heal', this.x, this.y);
          }
        }
        if (this.st <= 0) { this.state = 'chase'; this.cd = cfg.cd * (0.9 + Math.random() * 0.4); this.healTarget = null; }
        break;
      }
    }
    // integrate
    this.x += (this.vx + this.kbx) * dt; this.y += (this.vy + this.kby) * dt;
    const kd = 1 - Math.min(1, 9 * dt); this.kbx *= kd; this.kby *= kd;
    W.collide(this);
  }
  startTelegraph(dx, dy, d, g, chain, dur) {
    this.state = 'telegraph'; this.st = dur || this.cfg.telegraph; this.chain = chain;
    this.dx = dx / d; this.dy = dy / d; this.dirKey = lancerDir(this, dx, dy); this.facing = this.dirFlip ? -1 : 1;
    this.anim.restart(this.spr.defence[this.dirKey], 10, true);
    g.sfxAt('charge', this.x, this.y, { pitch: this.boss ? 0.7 : 1 });
  }
  findHealTarget(g) {
    const E = g.enemies, cfg = this.cfg; let best = null, bestFrac = 0.8;
    for (let i = 0; i < E.active; i++) {
      const e = E.items[i]; if (!e.alive || e === this || e.hp >= e.maxHp) continue;
      const dx = e.x - this.x, dy = e.y - this.y; if (dx * dx + dy * dy > cfg.healRange * cfg.healRange) continue;
      const f = e.hp / e.maxHp; if (f < bestFrac) { bestFrac = f; best = e; }
    }
    this.healTarget = best; this.healTid = best ? best.id : 0;
  }
  takeHit(dmg, ax, ay, kb, crit, stunBonus, g, quiet) {
    if (!this.alive) return;
    if (this.state === 'stagger') { dmg *= 2; crit = true; }
    dmg = Math.round(dmg);
    this.hp -= dmg; this.flash = 0.09; this.hpBarT = 3;
    const k = kb * (1 - this.cfg.kbRes) * (this.boss ? 0.1 : this.elite ? 0.55 : 1);
    const a = Math.atan2(this.y - ay, this.x - ax); this.kbx += Math.cos(a) * k; this.kby += Math.sin(a) * k;
    if (!this.boss) this.stun = Math.max(this.stun, 0.12 + stunBonus);
    const it = this.cfg.interrupt;
    if (it === 2 && (this.state === 'windup' || this.state === 'shoot' || this.state === 'heal')) { this.state = 'chase'; this.cd = Math.max(this.cd, 0.4); }
    else if (it === 1 && this.state === 'windup' && this.st > this.cfg.windup * 0.35) { this.state = 'chase'; this.cd = Math.max(this.cd, 0.5); }
    g.fx.text(this.x, this.y - 58 * this.scale, String(dmg), crit ? '#ffb347' : '#ffffff', crit ? 26 : 18);
    g.fx.spark(this.x, this.y - 28 * this.scale, crit ? 14 : 6, crit ? '#ffd166' : '#ffffff', crit ? 260 : 180, 3);
    if (!quiet) g.sfxAt(crit ? 'crit' : 'hit', this.x, this.y);
    if (crit) g.fx.fx(TS.SPR.explosion1, this.x, this.y - 30 * this.scale, { fps: 24, scale: 0.7 });
    if (this.hp <= 0) this.die(g, quiet);
  }
  die(g, quiet) { this.alive = false; g.onEnemyKilled(this, quiet); }
  drawShadow(R) { const s = TS.SPR.shadow, w = this.r * 3.2, h = this.r * 1.6; R.imageWorld(s.img, s.u[0], s.u[1], s.u[2], s.u[3], this.x - w / 2, this.y - h / 2 + 2, w, h, 0.7); }
  drawTelegraph(R) {
    if (this.state !== 'telegraph') return;
    const c = R.ctx, cfg = this.cfg, len = cfg.chargeSpeed * (this.boss ? 1.15 : 1) * cfg.chargeT + 30, w = this.r * 2 + 8;
    const k = 1 - this.st / (this.boss ? 0.42 : cfg.telegraph);
    R.worldTransform();
    c.globalAlpha = 0.28 + 0.25 * Math.sin(k * 20);
    c.fillStyle = '#ff3b3b';
    c.setTransform(R.zoom * this.dx, R.zoom * this.dy, -R.zoom * this.dy, R.zoom * this.dx, this.x * R.zoom + R.ox, this.y * R.zoom + R.oy);
    c.fillRect(0, -w / 2, len * k, w);
    c.globalAlpha = 0.5; c.fillRect(0, -w / 2, len, 3); c.fillRect(0, w / 2 - 3, len, 3);
    c.globalAlpha = 1; R.identity(); R.drawCalls += 3;
  }
  draw(R, g) {
    const flip = this.facing < 0;
    let alpha = this.state === 'spawn' ? 1 - this.st / 0.5 : 1;
    if (this.state === 'stagger') { const wob = Math.sin(g.time * 30) * 4; R.sprite(this.anim.s, this.anim.frame, this.x + wob, this.y, flip, this.scale, alpha); }
    else R.sprite(this.anim.s, this.anim.frame, this.x, this.y, flip, this.scale, alpha);
    if (this.flash > 0) R.spriteTint(this.anim.s, this.anim.frame, this.x, this.y, flip, this.scale, '#ffffff', 0.85);
    else if ((this.state === 'windup' && this.st < this.cfg.windup * 0.45) || (this.state === 'poke' && this.st < this.cfg.pokeWind * 0.5)) R.spriteTint(this.anim.s, this.anim.frame, this.x, this.y, flip, this.scale, '#ff3030', 0.35 + 0.25 * Math.sin(g.time * 40));
    if (this.state === 'stagger') R.text('*', this.x * R.zoom + R.ox, (this.y - 70 * this.scale) * R.zoom + R.oy + Math.sin(g.time * 12) * 3 * R.zoom, 22 * R.ui, '#ffe066', 'center', 'middle');
  }
  drawHpBar(R) {
    if (this.boss || this.hpBarT <= 0 || this.hp >= this.maxHp) return;
    const w = 40 * this.scale * R.zoom, h = 5 * R.zoom;
    const x = this.x * R.zoom + R.ox - w / 2, y = (this.y - 62 * this.scale) * R.zoom + R.oy;
    R.rect(x - 1, y - 1, w + 2, h + 2, '#1e1a2e', 0.8); R.rect(x, y, w * Math.max(0, this.hp / this.maxHp), h, this.elite ? '#c973ff' : '#ff4b4b');
  }
}
TS.Enemy = Enemy;

// ---------------------------------------------------------------------------
class Arrow {
  constructor() { this.alive = false; this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.life = 0; this.dmg = 0; this.kind = 'arrow'; this.sy = 0; }
  init(x, y, vx, vy, dmg) { this.alive = true; this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.dmg = dmg; this.life = 1.5; this.a = Math.atan2(vy, vx); }
  update(dt, g) {
    this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt;
    if (g.world.blocksArrow(this.x, this.y + 22)) { this.alive = false; g.fx.fx(TS.SPR.dust1, this.x, this.y + 8, { fps: 22, alpha: 0.8 }); return; }
    const P = g.player; const dx = P.x - this.x, dy = (P.y - 22) - this.y; const rr = P.r + 8;
    if (P.alive && dx * dx + dy * dy < rr * rr) {
      if (P.takeDamage(this.dmg, this.x - this.vx, this.y - this.vy, g)) { this.alive = false; return; }
      if (P.state === 'dash' || P.invT > 0) { /* passes through during i-frames */ }
    }
    if (this.life <= 0) { this.alive = false; g.fx.fx(TS.SPR.dust1, this.x, this.y + 22, { fps: 20, layer: 0, alpha: 0.7 }); }
  }
  draw(R) { R.spriteRot(TS.SPR.arrow, 0, this.x, this.y, this.a); }
}
TS.Arrow = Arrow;

// ---------------------------------------------------------------------------
class Pickup {
  constructor() { this.alive = false; this.kind = 'pickup'; this.x = 0; this.y = 0; this.sy = 0; }
  init(type, x, y, val) {
    this.alive = true; this.type = type; this.x = x; this.y = y; this.val = val; this.sy = y;
    const a = Math.random() * TAU, v = 60 + Math.random() * 120;
    this.vx = Math.cos(a) * v; this.vy = Math.sin(a) * v * 0.6; this.z = 10; this.vz = 160 + Math.random() * 120;
    this.magnet = false; this.spd = 120; this.life = type === 'gold' ? 30 : 60; this.t = Math.random() * 10;
  }
  update(dt, g) {
    const P = g.player; this.t += dt; this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    if (!this.magnet) {
      this.x += this.vx * dt; this.y += this.vy * dt; const d = 1 - Math.min(1, 3 * dt); this.vx *= d; this.vy *= d;
      this.vz -= 900 * dt; this.z += this.vz * dt; if (this.z < 0) { this.z = 0; this.vz = -this.vz * 0.4; if (this.vz < 30) this.vz = 0; }
      if (!g.world.isGrassAt(this.x, this.y)) { this.vx = -this.vx * 0.5; this.vy = -this.vy * 0.5; g.world.collide(this); }
      const dx = P.x - this.x, dy = P.y - this.y;
      if (P.alive && dx * dx + dy * dy < P.magnet * P.magnet) this.magnet = true;
    } else {
      const dx = P.x - this.x, dy = P.y - 16 - this.y - this.z; const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      this.spd = Math.min(1100, this.spd + 2200 * dt);
      this.x += dx / d * this.spd * dt; this.y += dy / d * this.spd * dt;
      if (d < 22) { this.alive = false; g.collect(this); }
    }
    this.sy = this.y;
  }
  draw(R) {
    const s = TS.SPR.shadow, w = 22, h = 10;
    R.imageWorld(s.img, s.u[0], s.u[1], s.u[2], s.u[3], this.x - w / 2, this.y - h / 2, w, h, 0.5);
    const blink = this.life < 4 && ((this.life * 8) | 0) % 2 === 0;
    if (blink) return;
    if (this.type === 'gold') R.sprite(TS.SPR.gold, ((this.t * 8) | 0) % 6, this.x, this.y - 8 - this.z);
    else R.sprite(TS.SPR.meat, 0, this.x, this.y - 12 - this.z + Math.sin(this.t * 4) * 3, false, 0.8);
  }
}
Pickup.prototype.r = 8;
TS.Pickup = Pickup;

// ---------------------------------------------------------------------------
class Sheep {
  constructor() { this.alive = false; this.kind = 'sheep'; this.anim = new Anim(); this.r = 12; this.x = 0; this.y = 0; this.sy = 0; this.id = 0; }
  init(x, y) { this.alive = true; this.id = nextEntityId++; this.x = x; this.y = y; this.state = 'idle'; this.st = 1 + Math.random() * 2; this.facing = 1; this.tx = x; this.ty = y; this.anim.restart(TS.SPR.sheep.idle, 6, true); this.hp = 1; }
  update(dt, g) {
    const P = g.player, S = TS.SPR.sheep;
    this.st -= dt;
    const dx = this.x - P.x, dy = this.y - P.y, d2 = dx * dx + dy * dy;
    if (d2 < 120 * 120 && P.alive && this.state !== 'flee') { this.state = 'flee'; this.st = 0.8; }
    if (this.state === 'flee') {
      const d = Math.max(1, Math.sqrt(d2)); this.x += dx / d * 120 * dt; this.y += dy / d * 120 * dt; this.facing = dx < 0 ? -1 : 1;
      this.anim.set(S.move, 14, true);
      if (this.st <= 0) { this.state = 'idle'; this.st = 1; }
    } else if (this.state === 'move') {
      const mx = this.tx - this.x, my = this.ty - this.y; const d = Math.sqrt(mx * mx + my * my);
      if (d < 4 || this.st <= 0) { this.state = 'graze'; this.st = 2 + Math.random() * 3; this.anim.restart(S.grass, 8, true); }
      else { this.x += mx / d * 45 * dt; this.y += my / d * 45 * dt; this.facing = mx < 0 ? -1 : 1; this.anim.set(S.move, 8, true); }
    } else {
      this.anim.set(this.state === 'graze' ? S.grass : S.idle, this.state === 'graze' ? 8 : 6, true);
      if (this.st <= 0) {
        if (Math.random() < 0.5) { this.state = 'move'; this.st = 3; this.tx = this.x + (Math.random() - 0.5) * 240; this.ty = this.y + (Math.random() - 0.5) * 160; }
        else { this.state = this.state === 'graze' ? 'idle' : 'graze'; this.st = 1.5 + Math.random() * 2.5; }
      }
    }
    this.anim.update(dt);
    g.world.collide(this);
    this.sy = this.y;
  }
  die(g) {
    this.alive = false;
    g.spawnPickup('meat', this.x, this.y, 20);
    g.fx.fx(TS.SPR.dust2, this.x, this.y - 8, { fps: 20, layer: 0 });
    g.fx.burst(this.x, this.y - 14, 12, ['#ffffff', '#f0f0f0'], 120);
    g.fx.text(this.x, this.y - 40, 'BAA!', '#ffffff', 16);
    g.sfxAt('kill', this.x, this.y, { pitch: 1.5, vol: 0.6 });
    g.score += 5;
  }
  drawShadow(R) { const s = TS.SPR.shadow; R.imageWorld(s.img, s.u[0], s.u[1], s.u[2], s.u[3], this.x - 18, this.y - 8, 36, 16, 0.6); }
  draw(R) { R.sprite(this.anim.s, this.anim.frame, this.x, this.y, this.facing < 0); }
}
TS.Sheep = Sheep;
