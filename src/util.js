'use strict';
// Shared helpers + namespace. Classic scripts: top-level const/class are visible to later scripts.
const TS = {};
window.TS = TS;
TS.VERSION = '1.4.1';
const PI = Math.PI, TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => a + ((Math.random() * (b - a + 1)) | 0);
const choose = arr => arr[(Math.random() * arr.length) | 0];
const sqr = v => v * v;
function wrapAngle(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; }
function fmtTime(s) { s = Math.max(0, s | 0); const m = (s / 60) | 0, r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
function fmtNum(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
// Deterministic RNG (mulberry32) for map generation.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Fixed-capacity object pool with swap-remove. Iterate backwards when freeing inside a loop.
class Pool {
  constructor(factory, n) { this.items = new Array(n); for (let i = 0; i < n; i++) this.items[i] = factory(); this.active = 0; }
  alloc() { if (this.active >= this.items.length) return null; return this.items[this.active++]; }
  free(i) { this.active--; const t = this.items[i]; this.items[i] = this.items[this.active]; this.items[this.active] = t; }
  clear() { this.active = 0; }
}
TS.Pool = Pool;
// Value noise on a lattice, seeded.
function makeNoise(rng, size) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const ix = ((xi % size) + size) % size, iy = ((yi % size) + size) % size, ix1 = (ix + 1) % size, iy1 = (iy + 1) % size;
    const a = g[iy * size + ix], b = g[iy * size + ix1], c = g[iy1 * size + ix], d = g[iy1 * size + ix1];
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  };
}
TS.makeNoise = makeNoise;
TS.storage = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ } },
};
