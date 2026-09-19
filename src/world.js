'use strict';
// Island generation, baked ground, decorations, obstacles, collision, ambient layers.
const TILE = 64;
TS.World = class World {
  constructor(seed) {
    this.seed = seed;
    this.gw = 46; this.gh = 32; this.margin = 4;          // grid incl. 4-tile water border
    this.width = this.gw * TILE; this.height = this.gh * TILE;
    this.time = 0;
    const A = TS.Assets;
    this.foamS = A.sheet('foam'); this.shadowS = A.sheet('shadow');
    let tries = 0;
    do { this.rng = mulberry32(seed + tries * 7919); this.generate(); tries++; } while (this.grassCount < 500 && tries < 8);
    this.analyze();
    this.placeBuildings();
    this.placeDecor();
    this.buildNav();
    this.placeWaterDecor();
    this.makeClouds();
    this.bake();
  }
  idx(c, r) { return r * this.gw + c; }
  isGrass(c, r) { return c >= 0 && r >= 0 && c < this.gw && r < this.gh && this.tiles[r * this.gw + c] === 1; }
  isGrassAt(x, y) { return this.isGrass(Math.floor(x / TILE), Math.floor(y / TILE)); }
  generate() {
    const gw = this.gw, gh = this.gh, m = this.margin, rng = this.rng;
    const t = this.tiles = new Uint8Array(gw * gh);
    const cx = gw / 2, cy = gh / 2, rx = gw / 2 - m - 0.5, ry = gh / 2 - m - 0.5;
    const noise = makeNoise(rng, 16);
    for (let r = m; r < gh - m; r++) for (let c = m; c < gw - m; c++) {
      const nx = (c + 0.5 - cx) / rx, ny = (r + 0.5 - cy) / ry, d = nx * nx + ny * ny;
      const n = noise(c * 0.27 + 3.1, r * 0.27 + 7.7);
      if (d < 0.5 + 0.62 * n) t[this.idx(c, r)] = 1;
    }
    for (let r = (cy - 3) | 0; r <= (cy + 2) | 0; r++) for (let c = (cx - 4) | 0; c <= (cx + 3) | 0; c++) t[this.idx(c, r)] = 1;
    const n4 = (c, r) => (this.isGrass(c, r - 1) ? 1 : 0) + (this.isGrass(c + 1, r) ? 1 : 0) + (this.isGrass(c, r + 1) ? 1 : 0) + (this.isGrass(c - 1, r) ? 1 : 0);
    for (let pass = 0; pass < 5; pass++) {
      for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
        const i = this.idx(c, r);
        if (t[i] === 1) {
          const N = this.isGrass(c, r - 1), S = this.isGrass(c, r + 1), E = this.isGrass(c + 1, r), W = this.isGrass(c - 1, r);
          const cnt = (N ? 1 : 0) + (S ? 1 : 0) + (E ? 1 : 0) + (W ? 1 : 0);
          if (cnt < 2 || (N && S && !E && !W) || (E && W && !N && !S)) t[i] = 0;
        }
      }
      for (let r = m; r < gh - m; r++) for (let c = m; c < gw - m; c++) {
        const i = this.idx(c, r);
        if (t[i] === 0 && n4(c, r) >= 3) t[i] = 1;
      }
    }
    // keep only the component connected to the centre
    const keep = new Uint8Array(gw * gh); const stack = [this.idx(cx | 0, cy | 0)]; keep[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop(); const c = i % gw, r = (i / gw) | 0;
      const nb = [[c, r - 1], [c + 1, r], [c, r + 1], [c - 1, r]];
      for (let k = 0; k < 4; k++) { const j = this.idx(nb[k][0], nb[k][1]); if (this.isGrass(nb[k][0], nb[k][1]) && !keep[j]) { keep[j] = 1; stack.push(j); } }
    }
    let count = 0;
    for (let i = 0; i < t.length; i++) { t[i] = keep[i]; count += keep[i]; }
    this.grassCount = count;
    // second colour patches on interior tiles
    const p = this.patch = new Uint8Array(gw * gh);
    const noise2 = makeNoise(rng, 16);
    for (let r = 1; r < gh - 1; r++) for (let c = 1; c < gw - 1; c++) {
      if (!this.isGrass(c, r)) continue;
      let ok = true;
      for (let dr = -1; dr <= 1 && ok; dr++) for (let dc = -1; dc <= 1; dc++) if (!this.isGrass(c + dc, r + dr)) { ok = false; break; }
      if (ok && noise2(c * 0.33 + 11, r * 0.33 + 5) > 0.56) p[this.idx(c, r)] = 1;
    }
    const isP = (c, r) => c >= 0 && r >= 0 && c < gw && r < gh && p[r * gw + c] === 1;
    for (let pass = 0; pass < 2; pass++) for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
      if (!isP(c, r)) continue;
      const N = isP(c, r - 1), S = isP(c, r + 1), E = isP(c + 1, r), W = isP(c - 1, r);
      const cnt = (N ? 1 : 0) + (S ? 1 : 0) + (E ? 1 : 0) + (W ? 1 : 0);
      if (cnt < 2 || (N && S && !E && !W) || (E && W && !N && !S)) p[this.idx(c, r)] = 0;
    }
  }
  analyze() {
    const gw = this.gw, gh = this.gh;
    this.shore = []; this.grassTiles = [];
    let minC = gw, maxC = 0, minR = gh, maxR = 0;
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
      if (!this.isGrass(c, r)) continue;
      this.grassTiles.push(this.idx(c, r));
      if (c < minC) minC = c; if (c > maxC) maxC = c; if (r < minR) minR = r; if (r > maxR) maxR = r;
      let sh = false;
      for (let dr = -1; dr <= 1 && !sh; dr++) for (let dc = -1; dc <= 1; dc++) if ((dc || dr) && !this.isGrass(c + dc, r + dr)) { sh = true; break; }
      if (sh) this.shore.push(this.idx(c, r));
    }
    this.bx0 = minC - 1; this.by0 = minR - 1; this.bx1 = maxC + 2; this.by1 = maxR + 2; // ground canvas tile bounds
    this.gx0 = this.bx0 * TILE; this.gy0 = this.by0 * TILE;
    this.gwid = (this.bx1 - this.bx0) * TILE; this.ghei = (this.by1 - this.by0) * TILE;
    this.cx = (gw / 2) * TILE; this.cy = (gh / 2) * TILE;
    // camera bounds (world px)
    this.minX = this.gx0 - TILE; this.minY = this.gy0 - TILE; this.maxX = this.gx0 + this.gwid + TILE; this.maxY = this.gy0 + this.ghei + TILE;
    this.reserved = new Uint8Array(gw * gh);
  }
  blobMask(c, r, fn) { return (fn(c, r - 1) ? 1 : 0) | (fn(c + 1, r) ? 2 : 0) | (fn(c, r + 1) ? 4 : 0) | (fn(c - 1, r) ? 8 : 0); }
  // ---- buildings ---------------------------------------------------------
  placeBuildings() {
    this.buildings = []; this.obstacles = []; this.rects = [];
    const gw = this.gw, gh = this.gh, cx = gw >> 1, cy = gh >> 1;
    const fits = (c, r, w, h) => { for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) if (!this.isGrass(cc, rr) || this.reserved[this.idx(cc, rr)]) return false; return true; };
    const reserve = (c, r, w, h) => { for (let rr = r - 1; rr < r + h + 1; rr++) for (let cc = c - 1; cc < c + w + 1; cc++) if (cc >= 0 && rr >= 0 && cc < gw && rr < gh) this.reserved[this.idx(cc, rr)] = 1; };
    const add = (key, c, r, w, h, blockH) => {
      const s = TS.Assets.sheet(key);
      const x = (c + w / 2) * TILE, y = (r + h) * TILE - 6;
      const b = { s, x, y, sy: y, w: w * TILE, kind: 'building', draw(R) { R.sprite(this.s, 0, this.x, this.y); } };
      this.buildings.push(b);
      this.rects.push({ x0: x - w * TILE / 2 + 6, y0: y - blockH, w: w * TILE - 12, h: blockH });
      reserve(c, r, w, h);
      return b;
    };
    // castle: highest fully-grass 5x4 block near the centre column
    outer: for (let r = this.margin; r < cy - 2; r++) for (let dc = 0; dc < 6; dc++) for (const sgn of [1, -1]) {
      const c = cx - 2 + dc * sgn;
      if (fits(c, r, 5, 4)) { this.castle = add('castle_blue', c, r, 5, 4, 120); break outer; }
    }
    // two towers on the flanks
    for (const side of [-1, 1]) {
      outer2: for (let d = 0; d < gw / 2; d++) for (let dr = 0; dr < 6; dr++) for (const s2 of [1, -1]) {
        const c = side < 0 ? this.margin + d : gw - this.margin - 2 - d, r = cy - 1 + dr * s2;
        if (fits(c, r, 2, 2)) { add('tower_blue', c, r, 2, 2, 70); break outer2; }
      }
    }
    // a couple of houses south of the centre
    let houses = 0;
    for (let r = cy + 4; r < gh - this.margin && houses < 2; r++) for (let c = cx - 8; c < cx + 8 && houses < 2; c += 5) {
      if (fits(c, r, 2, 3) && this.rng() < 0.6) { add(houses === 0 ? 'house1_blue' : 'house2_blue', c, r, 2, 3, 70); houses++; }
    }
    // reserve the centre spawn zone
    for (let r = cy - 3; r <= cy + 2; r++) for (let c = cx - 4; c <= cx + 3; c++) this.reserved[this.idx(c, r)] = 1;
  }
  // ---- decorations -------------------------------------------------------
  placeDecor() {
    const rng = this.rng, A = TS.Assets;
    this.decor = [];
    const placed = [];
    const far = (x, y, min) => { for (let i = 0; i < placed.length; i++) { const p = placed[i]; if (sqr(p.x - x) + sqr(p.y - y) < sqr(min + p.r)) return false; } return true; };
    const shoreSet = new Uint8Array(this.gw * this.gh); for (let i = 0; i < this.shore.length; i++) shoreSet[this.shore[i]] = 1;
    const tiles = this.grassTiles.slice(); // shuffled candidates
    for (let i = tiles.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = tiles[i]; tiles[i] = tiles[j]; tiles[j] = t; }
    const mk = (key, x, y, opts) => {
      const s = A.sheet(key);
      const d = { s, x, y, sy: y, kind: 'decor', fps: opts.fps || 0, phase: rng() * 100, flip: rng() < 0.5, shadowW: opts.shadowW || 0, r: opts.r || 0,
        draw(R, g) { const f = this.fps ? ((g.world.time * this.fps + this.phase) | 0) % this.s.n : 0; R.sprite(this.s, f, this.x, this.y, this.flip); } };
      this.decor.push(d);
      placed.push({ x, y, r: opts.space || 40 });
      if (opts.r) this.obstacles.push({ x, y: y - (opts.oy || 0), r: opts.r });
      return d;
    };
    let trees = 0, bushes = 0, rocks = 0, stones = 0, stumps = 0;
    for (let k = 0; k < tiles.length; k++) {
      const i = tiles[k]; if (this.reserved[i]) continue;
      const c = i % this.gw, r = (i / this.gw) | 0;
      const x = c * TILE + 32 + (rng() - 0.5) * 30, y = r * TILE + 40 + (rng() - 0.5) * 20;
      const nearShore = shoreSet[i] === 1 || (this.rng() < 0.15);
      if (trees < 18 && nearShore && far(x, y, 70)) { mk(choose(['tree1', 'tree2', 'tree3', 'tree4']), x, y, { fps: 6, r: 15, oy: 6, space: 60, shadowW: 90 }); trees++; continue; }
      if (bushes < 16 && rng() < 0.5 && far(x, y, 50)) { mk('bush' + randInt(1, 4), x, y, { fps: 5, space: 40, shadowW: 60 }); bushes++; continue; }
      if (rocks < 9 && rng() < 0.35 && far(x, y, 50)) { mk('rock' + randInt(1, 4), x, y, { r: 12, oy: 4, space: 40, shadowW: 44 }); rocks++; continue; }
      if (stones < 5 && rng() < 0.3 && far(x, y, 60)) { mk('goldstone' + randInt(3, 6), x, y, { r: 18, oy: 8, space: 50, shadowW: 70 }); stones++; continue; }
      if (stumps < 3 && rng() < 0.25 && far(x, y, 50)) { mk('stump' + randInt(1, 4), x, y, { r: 12, oy: 4, space: 40, shadowW: 46 }); stumps++; continue; }
    }
  }
  placeWaterDecor() {
    const rng = this.rng, A = TS.Assets;
    this.waterDecor = [];
    let n = 0, guard = 0;
    while (n < 36 && guard++ < 2000) {
      const c = (rng() * this.gw) | 0, r = (rng() * this.gh) | 0;
      let ok = !this.isGrass(c, r);
      for (let dr = -1; dr <= 1 && ok; dr++) for (let dc = -1; dc <= 1; dc++) if (this.isGrass(c + dc, r + dr)) { ok = false; break; }
      if (!ok) continue;
      this.waterDecor.push({ s: A.sheet('wrock' + randInt(1, 4)), x: c * TILE + 32, y: r * TILE + 32, phase: rng() * 16, fps: 8 });
      n++;
    }
    const d = this.waterDecor[0];
    if (d) this.waterDecor.push({ s: A.sheet('duck'), x: d.x + 40, y: d.y + 30, phase: 0, fps: 4 });
  }
  makeClouds() {
    const A = TS.Assets, rng = this.rng;
    this.clouds = [];
    for (let i = 0; i < 6; i++) {
      const s = A.sheet('cloud' + randInt(1, 8));
      const sc = document.createElement('canvas'); sc.width = s.u[2]; sc.height = s.u[3];
      const g = sc.getContext('2d');
      g.drawImage(s.img, s.u[0], s.u[1], s.u[2], s.u[3], 0, 0, s.u[2], s.u[3]);
      g.globalCompositeOperation = 'source-in'; g.fillStyle = '#1b2a3a'; g.fillRect(0, 0, sc.width, sc.height);
      this.clouds.push({ s, shadow: sc, x: rng() * this.width, y: rng() * this.height, vx: 14 + rng() * 12, scale: 0.8 + rng() * 0.6 });
    }
  }
  updateAmbient(dt) {
    this.time += dt;
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i]; c.x += c.vx * dt;
      if (c.x - 400 > this.width) { c.x = -400; c.y = this.rng() * this.height; }
    }
  }
  // ---- baking -----------------------------------------------------------
  bake() {
    const cv = document.createElement('canvas'); cv.width = this.gwid; cv.height = this.ghei;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.translate(-this.gx0, -this.gy0);
    const sh = this.shadowS;
    const drawShadow = (x, y, w, h, alpha) => {
      g.globalAlpha = alpha;
      g.drawImage(sh.img, sh.u[0], sh.u[1], sh.u[2], sh.u[3], x - w / 2, y - h / 2, w, h);
      g.globalAlpha = 1;
    };
    for (let i = 0; i < this.shore.length; i++) { const t = this.shore[i]; const c = t % this.gw, r = (t / this.gw) | 0; drawShadow(c * TILE + 38, r * TILE + 46, 86, 86, 0.9); }
    const tm1 = TS.Assets.tilemap('grass1'), tm2 = TS.Assets.tilemap('grass2');
    const blob = TS_ATLAS.blob;
    const isG = (c, r) => this.isGrass(c, r);
    const isP = (c, r) => c >= 0 && r >= 0 && c < this.gw && r < this.gh && this.patch[r * this.gw + c] === 1;
    for (let i = 0; i < this.grassTiles.length; i++) {
      const t = this.grassTiles[i]; const c = t % this.gw, r = (t / this.gw) | 0;
      const b = blob[this.blobMask(c, r, isG)];
      g.drawImage(tm1.img, tm1.ox + b[0] * TILE, tm1.oy + b[1] * TILE, TILE, TILE, c * TILE, r * TILE, TILE, TILE);
      if (isP(c, r)) { const b2 = blob[this.blobMask(c, r, isP)]; g.drawImage(tm2.img, tm2.ox + b2[0] * TILE, tm2.oy + b2[1] * TILE, TILE, TILE, c * TILE, r * TILE, TILE, TILE); }
    }
    for (let i = 0; i < this.decor.length; i++) { const d = this.decor[i]; if (d.shadowW) drawShadow(d.x + 3, d.y - 2, d.shadowW, d.shadowW * 0.5, 0.75); }
    for (let i = 0; i < this.buildings.length; i++) { const b = this.buildings[i]; drawShadow(b.x + 8, b.y - 20, b.w + 40, 90, 0.8); }
    this.ground = cv;
  }
  // ---- queries ----------------------------------------------------------
  tileCenterX(i) { return (i % this.gw) * TILE + 32; }
  tileCenterY(i) { return ((i / this.gw) | 0) * TILE + 32; }
  // Random landing tile (see buildSpawnTiles) at least `min` px from (px,py); falls back to the farthest sampled.
  shoreFar(px, py, min, sideFilter) {
    const tiles = this.spawnTiles;
    let best = -1, bestD = -1;
    for (let k = 0; k < 16; k++) {
      const i = tiles[(Math.random() * tiles.length) | 0];
      if (sideFilter && !sideFilter(i % this.gw, (i / this.gw) | 0)) continue;
      const d = sqr(this.tileCenterX(i) - px) + sqr(this.tileCenterY(i) - py);
      if (d >= min * min) return i;
      if (d > bestD) { bestD = d; best = i; }
    }
    return best >= 0 ? best : tiles[(Math.random() * tiles.length) | 0];
  }
  grassFar(px, py, min) {
    let best = -1, bestD = -1;
    for (let k = 0; k < 20; k++) {
      const i = this.grassTiles[(Math.random() * this.grassTiles.length) | 0];
      if (this.reserved[i]) continue;
      const d = sqr(this.tileCenterX(i) - px) + sqr(this.tileCenterY(i) - py);
      if (d >= min * min) return i;
      if (d > bestD) { bestD = d; best = i; }
    }
    return best >= 0 ? best : this.grassTiles[0];
  }
  // ---- navigation: blocked grid + Dijkstra flow field toward the player ----
  buildNav() {
    const gw = this.gw, gh = this.gh, n = gw * gh;
    const b = this.blocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = this.tiles[i] ? 0 : 1;
    for (let k = 0; k < this.rects.length; k++) {
      const q = this.rects[k];
      // A tile is a wall only when the collision rect covers its centre. A building's upper rows are
      // drawn height, not footprint: they stay open to enemies exactly as they are to the player, so
      // the flow field never marks a strip as impassable that bodies can physically wander into.
      const c0 = Math.ceil((q.x0 - 32) / TILE), c1 = Math.floor((q.x0 + q.w - 32) / TILE), r0 = Math.ceil((q.y0 - 32) / TILE), r1 = Math.floor((q.y0 + q.h - 32) / TILE);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (c >= 0 && r >= 0 && c < gw && r < gh) b[r * gw + c] = 1;
    }
    // Every obstacle tile is off-limits to routing so the field never steers a body into a gap between
    // a boulder and the shore that is narrower than the body. Trunks and big stones (1) also cut line of
    // sight; small rocks and stumps (2) do not, since arrows fly over them (see blocksArrow).
    for (let k = 0; k < this.obstacles.length; k++) { const o = this.obstacles[k], i = Math.floor(o.y / TILE) * gw + Math.floor(o.x / TILE); if (o.r >= 14) b[i] = 1; else if (!b[i]) b[i] = 2; }
    this.dist = new Float32Array(n); this.flowX = new Float32Array(n); this.flowY = new Float32Array(n);
    this.hi = new Int32Array(n * 8); this.hk = new Float32Array(n * 8); this.flowTile = -1;
    this.buildSpawnTiles();
  }
  // Open tiles joined to the main body of the island (4-connected, which is exactly what the flow
  // field can reach since it never cuts corners). Enemies spawn only on shore tiles in that body that
  // are outside every building's reserved ring, so a landing can never start in a wall, on a trunk or
  // in a pocket between a tower and the water that the flow field cannot lead out of.
  buildSpawnTiles() {
    const gw = this.gw, gh = this.gh, n = gw * gh, b = this.blocked;
    const comp = new Int32Array(n).fill(-1), stack = new Int32Array(n), sizes = [];
    for (let s = 0; s < n; s++) {
      if (b[s] || comp[s] >= 0) continue;
      const id = sizes.length; let sp = 0, size = 0; stack[sp++] = s; comp[s] = id;
      while (sp > 0) {
        const i = stack[--sp]; size++;
        const c = i % gw, r = (i / gw) | 0;
        if (r > 0 && !b[i - gw] && comp[i - gw] < 0) { comp[i - gw] = id; stack[sp++] = i - gw; }
        if (r < gh - 1 && !b[i + gw] && comp[i + gw] < 0) { comp[i + gw] = id; stack[sp++] = i + gw; }
        if (c > 0 && !b[i - 1] && comp[i - 1] < 0) { comp[i - 1] = id; stack[sp++] = i - 1; }
        if (c < gw - 1 && !b[i + 1] && comp[i + 1] < 0) { comp[i + 1] = id; stack[sp++] = i + 1; }
      }
      sizes.push(size);
    }
    let main = 0; for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[main]) main = k;
    const reach = this.reachable = new Uint8Array(n);
    for (let i = 0; i < n; i++) reach[i] = comp[i] === main ? 1 : 0;
    const shore = this.shore, reserved = this.reserved;
    let tiles = [];
    for (let k = 0; k < shore.length; k++) { const i = shore[k]; if (reach[i] && !reserved[i]) tiles.push(i); }
    if (tiles.length < 8) { tiles = []; for (let k = 0; k < shore.length; k++) { const i = shore[k]; if (reach[i]) tiles.push(i); } }
    if (!tiles.length) tiles = shore.slice();
    this.spawnTiles = tiles;
  }
  // Recomputes only when the player changes tile. ~1.5k tiles, well under a millisecond.
  computeFlow(px, py) {
    const gw = this.gw, gh = this.gh, dist = this.dist, blocked = this.blocked, hi = this.hi, hk = this.hk;
    const sc = clamp(Math.floor(px / TILE), 0, gw - 1), sr = clamp(Math.floor(py / TILE), 0, gh - 1), start = sr * gw + sc;
    if (start === this.flowTile) return;
    this.flowTile = start;
    dist.fill(1e9); dist[start] = 0;
    let hn = 0;
    const push = (i, k) => { let j = hn++; hi[j] = i; hk[j] = k; while (j > 0) { const p = (j - 1) >> 1; if (hk[p] <= hk[j]) break; const ti = hi[p], tk = hk[p]; hi[p] = hi[j]; hk[p] = hk[j]; hi[j] = ti; hk[j] = tk; j = p; } };
    const pop = () => { const top = hi[0]; hn--; if (hn > 0) { hi[0] = hi[hn]; hk[0] = hk[hn]; let j = 0; for (;;) { const l = 2 * j + 1, r = l + 1; let m = j; if (l < hn && hk[l] < hk[m]) m = l; if (r < hn && hk[r] < hk[m]) m = r; if (m === j) break; const ti = hi[m], tk = hk[m]; hi[m] = hi[j]; hk[m] = hk[j]; hi[j] = ti; hk[j] = tk; j = m; } } return top; };
    push(start, 0);
    while (hn > 0) {
      const k = hk[0], i = pop();
      if (k > dist[i]) continue;
      const c = i % gw, r = (i / gw) | 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= gw || nr >= gh) continue;
        const ni = nr * gw + nc; if (blocked[ni]) continue;
        if (dr && dc && (blocked[r * gw + nc] || blocked[nr * gw + c])) continue; // no corner cutting
        const nd = k + (dr && dc ? 1.41421 : 1);
        if (nd < dist[ni]) { dist[ni] = nd; push(ni, nd); }
      }
    }
    const fx = this.flowX, fy = this.flowY;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] >= 1e9) { fx[i] = 0; fy[i] = 0; continue; }
      const c = i % gw, r = (i / gw) | 0; let best = dist[i], bx = 0, by = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= gw || nr >= gh) continue;
        const ni = nr * gw + nc; if (blocked[ni] && ni !== start) continue;
        if (dr && dc && (blocked[r * gw + nc] || blocked[nr * gw + c])) continue;
        if (dist[ni] < best) { best = dist[ni]; bx = dc; by = dr; }
      }
      const l = Math.sqrt(bx * bx + by * by) || 1; fx[i] = bx / l; fy[i] = by / l;
    }
  }
  // Writes the flow direction at (x,y) into out.ux/out.uy; false when unknown or at the goal.
  flowAt(x, y, out) {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    if (c < 0 || r < 0 || c >= this.gw || r >= this.gh) return false;
    const gw = this.gw, dist = this.dist, i = r * gw + c;
    if (dist[i] < 1e9) { out.ux = this.flowX[i]; out.uy = this.flowY[i]; return out.ux !== 0 || out.uy !== 0; }
    // Off the field (shoved onto a trunk tile, lured behind a wall): walk to the centre of the
    // best-connected neighbouring tile instead of pressing straight at the player through whatever is in the way.
    let best = 1e9, bc = 0, br = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= gw || nr >= this.gh) continue;
      const d = dist[nr * gw + nc]; if (d < best) { best = d; bc = nc; br = nr; }
    }
    if (best >= 1e9) return false;
    const tx = bc * TILE + 32 - x, ty = br * TILE + 32 - y, l = Math.sqrt(tx * tx + ty * ty) || 1;
    out.ux = tx / l; out.uy = ty / l;
    return true;
  }
  // Straight-line visibility across the blocked grid (walls, water, trunks).
  los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy), steps = Math.ceil(len / 24);
    for (let s = 1; s < steps; s++) {
      const t = s / steps, c = Math.floor((x0 + dx * t) / TILE), r = Math.floor((y0 + dy * t) / TILE);
      if (c < 0 || r < 0 || c >= this.gw || r >= this.gh || this.blocked[r * this.gw + c] === 1) return false;
    }
    return true;
  }
  // Does an arrow whose ground point is (x,y) hit a building wall or a tree trunk / boulder?
  blocksArrow(x, y) {
    const rects = this.rects;
    for (let i = 0; i < rects.length; i++) { const q = rects[i]; if (x > q.x0 && x < q.x0 + q.w && y > q.y0 - 50 && y < q.y0 + q.h) return true; }
    const obs = this.obstacles;
    for (let i = 0; i < obs.length; i++) { const o = obs[i]; if (o.r < 14) continue; const dx = x - o.x, dy = y - o.y, rr = o.r + 4; if (dx * dx + dy * dy < rr * rr) return true; }
    return false;
  }
  // ---- collision --------------------------------------------------------
  resolveRect(e, rx, ry, rw, rh) {
    const px = clamp(e.x, rx, rx + rw), py = clamp(e.y, ry, ry + rh);
    let dx = e.x - px, dy = e.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 >= e.r * e.r) return false;
    if (d2 < 1e-6) { // centre inside: push out through the nearest face
      const l = e.x - rx, r = rx + rw - e.x, t = e.y - ry, b = ry + rh - e.y;
      const m = Math.min(l, r, t, b);
      if (m === l) e.x = rx - e.r; else if (m === r) e.x = rx + rw + e.r; else if (m === t) e.y = ry - e.r; else e.y = ry + rh + e.r;
      return true;
    }
    const d = Math.sqrt(d2), push = e.r - d;
    e.x += dx / d * push; e.y += dy / d * push;
    return true;
  }
  collide(e) {
    const tc = Math.floor(e.x / TILE), tr = Math.floor(e.y / TILE);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const c = tc + dc, r = tr + dr;
      if (!this.isGrass(c, r)) this.resolveRect(e, c * TILE, r * TILE, TILE, TILE);
    }
    const obs = this.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i]; const dx = e.x - o.x, dy = e.y - o.y, rr = e.r + o.r;
      if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), push = rr - d; e.x += dx / d * push; e.y += dy / d * push; }
    }
    const rects = this.rects;
    for (let i = 0; i < rects.length; i++) { const q = rects[i]; this.resolveRect(e, q.x0, q.y0, q.w, q.h); }
  }
  // Is a straight segment blocked by water within `len`? (used to stop lancer charges at the shore)
  // ---- drawing ----------------------------------------------------------
  drawWater(R) { R.rect(0, 0, R.W, R.H, TS_ATLAS.water); }
  drawWaterDecor(R) {
    const t = this.time;
    for (let i = 0; i < this.waterDecor.length; i++) {
      const d = this.waterDecor[i];
      if (!R.visible(d.x - 40, d.y - 40, 80, 80)) continue;
      R.sprite(d.s, ((t * d.fps + d.phase) | 0) % d.s.n, d.x, d.y);
    }
  }
  drawFoam(R) {
    const t = this.time, fs = this.foamS, gw = this.gw;
    for (let i = 0; i < this.shore.length; i++) {
      const ti = this.shore[i]; const c = ti % gw, r = (ti / gw) | 0;
      const x = c * TILE + 32, y = r * TILE + 32;
      if (!R.visible(x - 48, y - 48, 96, 96)) continue;
      R.sprite(fs, ((t * 9 + (c * 3 + r * 5)) | 0) % fs.n, x, y);
    }
  }
  drawGround(R) {
    const z = R.zoom;
    const vx0 = Math.max(this.gx0, R.camX - 8), vy0 = Math.max(this.gy0, R.camY - 8);
    const vx1 = Math.min(this.gx0 + this.gwid, R.camX + R.viewW + 8), vy1 = Math.min(this.gy0 + this.ghei, R.camY + R.viewH + 8);
    if (vx1 <= vx0 || vy1 <= vy0) return;
    const sx = Math.floor(vx0 - this.gx0), sy = Math.floor(vy0 - this.gy0);
    const sw = Math.ceil(vx1 - this.gx0) - sx, sh = Math.ceil(vy1 - this.gy0) - sy;
    R.imageWorld(this.ground, sx, sy, sw, sh, this.gx0 + sx, this.gy0 + sy, sw, sh);
  }
  drawCloudShadows(R) {
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i], w = c.shadow.width * c.scale, h = c.shadow.height * c.scale;
      const x = c.x + 60, y = c.y + 140;
      if (!R.visible(x, y, w, h)) continue;
      R.imageWorld(c.shadow, 0, 0, c.shadow.width, c.shadow.height, x, y, w, h, 0.22);
    }
  }
  drawClouds(R) {
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i], s = c.s, w = s.u[2] * c.scale, h = s.u[3] * c.scale;
      if (!R.visible(c.x, c.y, w, h)) continue;
      R.imageWorld(s.img, s.u[0], s.u[1], s.u[2], s.u[3], c.x, c.y, w, h, 0.92);
    }
  }
};
