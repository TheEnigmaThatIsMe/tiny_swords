/*
 * SFX -- zero-dependency Web Audio synthesizer for a pixel-art arena sword game.
 * Classic browser script (no import/export, no modules, no external files).
 * Exposes exactly one global: window.SFX
 *
 * SFX.init() / SFX.resume() / SFX.setMuted() / SFX.toggleMute() / SFX.isMuted() /
 * SFX.setVolume() / SFX.play(name, opts) / SFX.startMusic() / SFX.stopMusic() /
 * SFX.setIntensity() / SFX.isMusicPlaying() / SFX.pauseMusic() / SFX.resumeMusic() / SFX.isMusicPaused()
 *
 * Sounds: swing, hit, crit, kill, hurt, dash, coin, meat, levelup, select,
 * wave, arrow, charge, heal, boss, victory, gameover, boom, parry, click,
 * spawn, whirl, pickup.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  var NOISE_SECONDS = 2;
  var MAX_VOICES = 24;
  var THROTTLE_MS = 35;
  var MUSIC_BUS_LEVEL = 0.16;
  var MUSIC_FADE_SEC = 0.5;
  var SCHEDULE_AHEAD_SEC = 0.12;
  var SCHEDULER_INTERVAL_MS = 25;
  var CATCHUP_THRESHOLD_SEC = 0.2;

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var ctx = null;
  var masterGain = null;
  var musicBus = null;
  var noiseBuffer = null;
  var muted = false;
  var volume = 0.5;
  var activeVoices = 0;
  var lastPlayTimes = Object.create(null);

  // ---------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------
  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function nowMs() {
    try {
      return Date.now();
    } catch (e) {
      return 0;
    }
  }

  function randVar() {
    // +/- 6% random multiplier so repeated hits/kills/swings/coins vary.
    return 1 + (Math.random() * 2 - 1) * 0.06;
  }

  function msFallback(sec) {
    // Generous defensive cleanup timer in case onended never fires.
    return Math.ceil(sec * 2000) + 250;
  }

  // ---------------------------------------------------------------------
  // Shared noise buffer (2s of white noise) + per-play noise source helper
  // ---------------------------------------------------------------------
  function buildNoiseBuffer(audioCtx) {
    var length = Math.max(1, Math.floor(audioCtx.sampleRate * NOISE_SECONDS));
    var buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  function noiseSource(maxDur) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = false;
    var room = NOISE_SECONDS - (maxDur || 0.05) - 0.01;
    if (!(room > 0)) room = 0;
    src._offset = Math.random() * room;
    return src;
  }

  // ---------------------------------------------------------------------
  // Per-voice output chain: gain (+ optional StereoPanner) -> masterGain
  // ---------------------------------------------------------------------
  function outputChain(vol, pan) {
    var g = ctx.createGain();
    g.gain.value = vol;
    var cleanup = [g];
    if (pan && Math.abs(pan) > 0.001 && typeof ctx.createStereoPanner === 'function') {
      try {
        var p = ctx.createStereoPanner();
        p.pan.value = clamp(pan, -1, 1);
        g.connect(p);
        p.connect(masterGain);
        cleanup.push(p);
        return { node: g, cleanup: cleanup };
      } catch (e) {
        // fall through to direct connection below
      }
    }
    g.connect(masterGain);
    return { node: g, cleanup: cleanup };
  }

  // ---------------------------------------------------------------------
  // Voice bookkeeping: disconnect nodes + decrement counters on end, with
  // a defensive timeout fallback in case onended never fires.
  // ---------------------------------------------------------------------
  function trackVoice(endedNode, nodes, fallbackMs, countsAsSfx) {
    if (countsAsSfx) activeVoices++;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (countsAsSfx) activeVoices = activeVoices > 0 ? activeVoices - 1 : 0;
      for (var i = 0; i < nodes.length; i++) {
        try { nodes[i].disconnect(); } catch (e) {}
      }
    }
    var attached = false;
    try {
      endedNode.onended = finish;
      attached = true;
    } catch (e) {}
    try {
      setTimeout(finish, fallbackMs || 500);
    } catch (e) {
      if (!attached) finish();
    }
  }

  function trackSfxVoice(endedNode, nodes, fallbackMs) {
    trackVoice(endedNode, nodes, fallbackMs, true);
  }

  function trackMusicVoice(endedNode, nodes, fallbackMs) {
    trackVoice(endedNode, nodes, fallbackMs, false);
  }

  // ---------------------------------------------------------------------
  // Lifecycle: init / resume / mute / volume
  // ---------------------------------------------------------------------
  function applyVolume() {
    if (!masterGain) return;
    try {
      masterGain.gain.value = muted ? 0 : volume;
    } catch (e) {}
  }

  function init() {
    try {
      if (!ctx) {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return false;
        ctx = new Ctor();
        masterGain = ctx.createGain();
        masterGain.gain.value = muted ? 0 : volume;
        try { masterGain.connect(ctx.destination); } catch (e) {}
        musicBus = ctx.createGain();
        musicBus.gain.value = 0.0001;
        try { musicBus.connect(masterGain); } catch (e) {}
        noiseBuffer = buildNoiseBuffer(ctx);
      }
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        resume();
      }
      return ctx.state === 'running';
    } catch (e) {
      return false;
    }
  }

  function resume() {
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        var p = ctx.resume();
        if (p && typeof p.then === 'function') {
          p.then(function () {}, function () {});
        }
      }
    } catch (e) {}
  }

  function setMuted(b) {
    muted = !!b;
    applyVolume();
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  function isMuted() {
    return muted;
  }

  function setVolume(v) {
    if (typeof v !== 'number' || isNaN(v)) return;
    volume = clamp(v, 0, 1);
    applyVolume();
  }

  // ---------------------------------------------------------------------
  // Sound voices. Each sndX(now, opts) builds a short-lived node graph,
  // schedules its envelope, and registers cleanup. opts = {pitch,vol,pan}
  // are already validated/clamped by play().
  // ---------------------------------------------------------------------

  function sndSwing(now, o) {
    try {
      var pitch = o.pitch * randVar();
      var dur = 0.12;
      var out = outputChain(0.5 * o.vol, o.pan);
      var src = noiseSource(dur + 0.05);
      var filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(1200 * pitch, now);
      filter.frequency.exponentialRampToValueAtTime(300 * pitch, now + dur);
      src.connect(filter);
      filter.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + dur + 0.02);
      trackSfxVoice(src, [src, filter].concat(out.cleanup), msFallback(0.16));
    } catch (e) {}
  }

  function sndHit(now, o) {
    try {
      var pitch = o.pitch * randVar();
      var out = outputChain(0.45 * o.vol, o.pan);
      var osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(220 * pitch, now);
      osc.frequency.exponentialRampToValueAtTime(90 * pitch, now + 0.06);
      var og = ctx.createGain();
      og.gain.setValueAtTime(0.8, now);
      og.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(og);
      og.connect(out.node);
      osc.start(now);
      osc.stop(now + 0.07);
      var src = noiseSource(0.05);
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.3, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      src.connect(ng);
      ng.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + 0.1);
      trackSfxVoice(src, [osc, og, src, ng].concat(out.cleanup), msFallback(0.12));
    } catch (e) {}
  }

  function sndCrit(now, o) {
    try {
      var pitch = o.pitch * randVar();
      var out = outputChain(0.5 * o.vol, o.pan);
      var nodes = [];
      var mults = [1, 1.5];
      for (var i = 0; i < mults.length; i++) {
        var t0 = now + i * 0.03;
        var osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(260 * pitch * mults[i], t0);
        osc.frequency.exponentialRampToValueAtTime(100 * pitch * mults[i], t0 + 0.06);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.7, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
        osc.connect(g);
        g.connect(out.node);
        osc.start(t0);
        osc.stop(t0 + 0.09);
        nodes.push(osc, g);
      }
      var src = noiseSource(0.06);
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.35, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      src.connect(ng);
      ng.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + 0.15);
      nodes.push(src, ng);
      trackSfxVoice(src, nodes.concat(out.cleanup), msFallback(0.2));
    } catch (e) {}
  }

  function sndKill(now, o) {
    try {
      var pitch = o.pitch * randVar();
      var out = outputChain(0.5 * o.vol, o.pan);
      var freqs = [660, 440, 220];
      var nodes = [];
      for (var i = 0; i < freqs.length; i++) {
        var t0 = now + i * 0.06;
        var osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freqs[i] * pitch;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.6, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
        osc.connect(g);
        g.connect(out.node);
        osc.start(t0);
        osc.stop(t0 + 0.1);
        nodes.push(osc, g);
      }
      var src = noiseSource(0.12);
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.4, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      src.connect(filter);
      filter.connect(ng);
      ng.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + 0.23);
      nodes.push(src, filter, ng);
      trackSfxVoice(src, nodes.concat(out.cleanup), msFallback(0.28));
    } catch (e) {}
  }

  function sndHurt(now, o) {
    try {
      var pitch = o.pitch;
      var out = outputChain(0.55 * o.vol, o.pan);
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110 * pitch, now);
      osc.frequency.exponentialRampToValueAtTime(45 * pitch, now + 0.18);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.8, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(g);
      g.connect(out.node);
      osc.start(now);
      osc.stop(now + 0.19);
      var src = noiseSource(0.16);
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.3, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      src.connect(filter);
      filter.connect(ng);
      ng.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + 0.19);
      trackSfxVoice(src, [osc, g, src, filter, ng].concat(out.cleanup), msFallback(0.24));
    } catch (e) {}
  }

  function sndDash(now, o) {
    try {
      var dur = 0.16;
      var src = noiseSource(dur + 0.05);
      var filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1;
      filter.frequency.setValueAtTime(400 * o.pitch, now);
      filter.frequency.exponentialRampToValueAtTime(2400 * o.pitch, now + dur);
      var out = outputChain(0.4 * o.vol, o.pan);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.6, now);
      g.gain.linearRampToValueAtTime(0.0001, now + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + dur + 0.02);
      trackSfxVoice(src, [src, filter, g].concat(out.cleanup), msFallback(0.24));
    } catch (e) {}
  }

  function sndCoin(now, o) {
    try {
      var pitch = o.pitch * randVar();
      var out = outputChain(0.4 * o.vol, o.pan);
      var tones = [[1318.51, 0], [1975.53, 0.06]];
      var nodes = [];
      var lastOsc = null;
      for (var i = 0; i < tones.length; i++) {
        var t0 = now + tones[i][1];
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = tones[i][0] * pitch;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.6, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
        osc.connect(g);
        g.connect(out.node);
        osc.start(t0);
        osc.stop(t0 + 0.1);
        nodes.push(osc, g);
        lastOsc = osc;
      }
      trackSfxVoice(lastOsc, nodes.concat(out.cleanup), msFallback(0.2));
    } catch (e) {}
  }

  function sndMeat(now, o) {
    try {
      var out = outputChain(0.4 * o.vol, o.pan);
      var offsets = [0, 0.1];
      var nodes = [];
      var lastSrc = null;
      for (var i = 0; i < offsets.length; i++) {
        var t0 = now + offsets[i];
        var src = noiseSource(0.09);
        var filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200 * o.pitch, t0);
        filter.frequency.exponentialRampToValueAtTime(300 * o.pitch, t0 + 0.08);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.6, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
        src.connect(filter);
        filter.connect(g);
        g.connect(out.node);
        src.start(t0, src._offset);
        src.stop(t0 + 0.1);
        nodes.push(src, filter, g);
        lastSrc = src;
      }
      trackSfxVoice(lastSrc, nodes.concat(out.cleanup), msFallback(0.25));
    } catch (e) {}
  }

  function sndLevelup(now, o) {
    try {
      var out = outputChain(0.45 * o.vol, o.pan);
      var freqs = [523.25, 659.25, 783.99, 1046.50];
      var nodes = [];
      var lastOsc = null;
      for (var i = 0; i < freqs.length; i++) {
        var t0 = now + i * 0.09;
        var isLast = i === freqs.length - 1;
        var sustain = isLast ? 0.4 : 0.15;
        var osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freqs[i] * o.pitch;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.5, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.02 + sustain);
        osc.connect(g);
        g.connect(out.node);
        osc.start(t0);
        osc.stop(t0 + 0.02 + sustain + 0.03);
        nodes.push(osc, g);
        lastOsc = osc;
      }
      trackSfxVoice(lastOsc, nodes.concat(out.cleanup), msFallback(0.8));
    } catch (e) {}
  }

  function sndSelect(now, o) {
    try {
      var out = outputChain(0.35 * o.vol, o.pan);
      var osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1000 * o.pitch;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.5, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(g);
      g.connect(out.node);
      osc.start(now);
      osc.stop(now + 0.06);
      trackSfxVoice(osc, [osc, g].concat(out.cleanup), msFallback(0.1));
    } catch (e) {}
  }

  function sndWave(now, o) {
    try {
      var out = outputChain(0.45 * o.vol, o.pan);
      var parts = [[174.61, 0, 0.35], [233.08, 0.35, 0.35]];
      var nodes = [];
      var lastOsc = null;
      for (var i = 0; i < parts.length; i++) {
        var freq = parts[i][0];
        var t0 = now + parts[i][1];
        var dur = parts[i][2];
        var osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq * o.pitch;
        var lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 6;
        var lfoGain = ctx.createGain();
        lfoGain.gain.value = freq * 0.02;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.5, t0 + 0.05);
        g.gain.setValueAtTime(0.5, t0 + dur - 0.1);
        g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(out.node);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
        lfo.start(t0);
        lfo.stop(t0 + dur + 0.02);
        nodes.push(osc, lfo, lfoGain, g);
        lastOsc = osc;
      }
      trackSfxVoice(lastOsc, nodes.concat(out.cleanup), msFallback(0.8));
    } catch (e) {}
  }

  function sndArrow(now, o) {
    try {
      var out = outputChain(0.35 * o.vol, o.pan);
      var src = noiseSource(0.07);
      var filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.5;
      filter.frequency.setValueAtTime(3000 * o.pitch, now);
      filter.frequency.exponentialRampToValueAtTime(1200 * o.pitch, now + 0.06);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.5, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      src.connect(filter);
      filter.connect(g);
      g.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + 0.08);
      trackSfxVoice(src, [src, filter, g].concat(out.cleanup), msFallback(0.15));
    } catch (e) {}
  }

  function sndCharge(now, o) {
    try {
      var dur = 0.35;
      var out = outputChain(0.4 * o.vol, o.pan);
      var osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(200 * o.pitch, now);
      osc.frequency.linearRampToValueAtTime(800 * o.pitch, now + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.3, now);
      g.gain.linearRampToValueAtTime(0.5, now + dur);
      osc.connect(g);
      g.connect(out.node);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      trackSfxVoice(osc, [osc, g].concat(out.cleanup), msFallback(0.45));
    } catch (e) {}
  }

  function sndHeal(now, o) {
    try {
      var out = outputChain(0.4 * o.vol, o.pan);
      var freqs = [880.00, 1318.51];
      var nodes = [];
      var lastOsc = null;
      for (var i = 0; i < freqs.length; i++) {
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freqs[i] * o.pitch;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.4, now + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(g);
        g.connect(out.node);
        osc.start(now);
        osc.stop(now + 0.52);
        nodes.push(osc, g);
        lastOsc = osc;
      }
      trackSfxVoice(lastOsc, nodes.concat(out.cleanup), msFallback(0.6));
    } catch (e) {}
  }

  function sndBoss(now, o) {
    try {
      var out = outputChain(0.5 * o.vol, o.pan);
      var drone = ctx.createOscillator();
      drone.type = 'sawtooth';
      drone.frequency.value = 55 * o.pitch;
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      var dg = ctx.createGain();
      dg.gain.setValueAtTime(0.0001, now);
      dg.gain.linearRampToValueAtTime(0.6, now + 0.1);
      dg.gain.setValueAtTime(0.6, now + 1.3);
      dg.gain.linearRampToValueAtTime(0.0001, now + 1.5);
      drone.connect(filter);
      filter.connect(dg);
      dg.connect(out.node);
      drone.start(now);
      drone.stop(now + 1.52);
      var horn = ctx.createOscillator();
      horn.type = 'sawtooth';
      horn.frequency.value = 110 * o.pitch;
      var hg = ctx.createGain();
      hg.gain.setValueAtTime(0.5, now);
      hg.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      horn.connect(hg);
      hg.connect(out.node);
      horn.start(now);
      horn.stop(now + 0.42);
      trackSfxVoice(drone, [drone, filter, dg, horn, hg].concat(out.cleanup), msFallback(1.6));
    } catch (e) {}
  }

  function sndVictory(now, o) {
    try {
      var out = outputChain(0.5 * o.vol, o.pan);
      var freqs = [523.25, 659.25, 783.99, 1046.50, 1318.51];
      var nodes = [];
      var lastOsc = null;
      for (var i = 0; i < freqs.length; i++) {
        var t0 = now + i * 0.18;
        var isLast = i === freqs.length - 1;
        var dur = isLast ? 0.5 : 0.22;
        var osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freqs[i] * o.pitch;
        var filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2200;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.45, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(filter);
        filter.connect(g);
        g.connect(out.node);
        osc.start(t0);
        osc.stop(t0 + dur + 0.03);
        nodes.push(osc, filter, g);
        lastOsc = osc;
      }
      trackSfxVoice(lastOsc, nodes.concat(out.cleanup), msFallback(1.4));
    } catch (e) {}
  }

  function sndGameover(now, o) {
    try {
      var out = outputChain(0.45 * o.vol, o.pan);
      var freqs = [440.00, 392.00, 349.23, 329.63];
      var nodes = [];
      var lastOsc = null;
      for (var i = 0; i < freqs.length; i++) {
        var t0 = now + i * 0.32;
        var isLast = i === freqs.length - 1;
        var dur = isLast ? 0.6 : 0.34;
        var osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freqs[i] * o.pitch;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.45, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(g);
        g.connect(out.node);
        osc.start(t0);
        osc.stop(t0 + dur + 0.03);
        nodes.push(osc, g);
        lastOsc = osc;
      }
      trackSfxVoice(lastOsc, nodes.concat(out.cleanup), msFallback(1.7));
    } catch (e) {}
  }

  function sndBoom(now, o) {
    try {
      var dur = 0.6;
      var out = outputChain(0.7 * o.vol, o.pan);
      var src = noiseSource(dur + 0.05);
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3000 * o.pitch, now);
      filter.frequency.exponentialRampToValueAtTime(100 * o.pitch, now + dur);
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.8, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + dur);
      src.connect(filter);
      filter.connect(ng);
      ng.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + dur + 0.02);
      var sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(80 * o.pitch, now);
      sub.frequency.exponentialRampToValueAtTime(30 * o.pitch, now + dur);
      var sg = ctx.createGain();
      sg.gain.setValueAtTime(0.9, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + dur);
      sub.connect(sg);
      sg.connect(out.node);
      sub.start(now);
      sub.stop(now + dur + 0.02);
      trackSfxVoice(sub, [src, filter, ng, sub, sg].concat(out.cleanup), msFallback(0.7));
    } catch (e) {}
  }

  function sndParry(now, o) {
    try {
      var out = outputChain(0.4 * o.vol, o.pan);
      var freqs = [1400, 2100];
      var nodes = [];
      var lastOsc = null;
      for (var i = 0; i < freqs.length; i++) {
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freqs[i] * o.pitch;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.5, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(g);
        g.connect(out.node);
        osc.start(now);
        osc.stop(now + 0.21);
        nodes.push(osc, g);
        lastOsc = osc;
      }
      trackSfxVoice(lastOsc, nodes.concat(out.cleanup), msFallback(0.3));
    } catch (e) {}
  }

  function sndClick(now, o) {
    try {
      var out = outputChain(0.3 * o.vol, o.pan);
      var osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1400 * o.pitch;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.4, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(g);
      g.connect(out.node);
      osc.start(now);
      osc.stop(now + 0.05);
      trackSfxVoice(osc, [osc, g].concat(out.cleanup), msFallback(0.08));
    } catch (e) {}
  }

  function sndSpawn(now, o) {
    try {
      var out = outputChain(0.4 * o.vol, o.pan);
      var src = noiseSource(0.2);
      var filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(1500 * o.pitch, now);
      filter.frequency.exponentialRampToValueAtTime(2500 * o.pitch, now + 0.1);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.5, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      src.connect(filter);
      filter.connect(g);
      g.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + 0.21);
      trackSfxVoice(src, [src, filter, g].concat(out.cleanup), msFallback(0.3));
    } catch (e) {}
  }

  function sndWhirl(now, o) {
    try {
      var dur = 0.3;
      var out = outputChain(0.4 * o.vol, o.pan);
      var src = noiseSource(dur + 0.05);
      var filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.8;
      filter.frequency.setValueAtTime(800 * o.pitch, now);
      filter.frequency.linearRampToValueAtTime(1600 * o.pitch, now + dur / 2);
      filter.frequency.linearRampToValueAtTime(500 * o.pitch, now + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.5, now + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, now + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(out.node);
      src.start(now, src._offset);
      src.stop(now + dur + 0.02);
      trackSfxVoice(src, [src, filter, g].concat(out.cleanup), msFallback(0.4));
    } catch (e) {}
  }

  function sndPickup(now, o) {
    try {
      var out = outputChain(0.35 * o.vol, o.pan);
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 1500 * o.pitch;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.4, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(g);
      g.connect(out.node);
      osc.start(now);
      osc.stop(now + 0.05);
      trackSfxVoice(osc, [osc, g].concat(out.cleanup), msFallback(0.08));
    } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // Dispatch table + public play()
  // ---------------------------------------------------------------------
  var SOUND_MAP = Object.create(null);
  SOUND_MAP.swing = sndSwing;
  SOUND_MAP.hit = sndHit;
  SOUND_MAP.crit = sndCrit;
  SOUND_MAP.kill = sndKill;
  SOUND_MAP.hurt = sndHurt;
  SOUND_MAP.dash = sndDash;
  SOUND_MAP.coin = sndCoin;
  SOUND_MAP.meat = sndMeat;
  SOUND_MAP.levelup = sndLevelup;
  SOUND_MAP.select = sndSelect;
  SOUND_MAP.wave = sndWave;
  SOUND_MAP.arrow = sndArrow;
  SOUND_MAP.charge = sndCharge;
  SOUND_MAP.heal = sndHeal;
  SOUND_MAP.boss = sndBoss;
  SOUND_MAP.victory = sndVictory;
  SOUND_MAP.gameover = sndGameover;
  SOUND_MAP.boom = sndBoom;
  SOUND_MAP.parry = sndParry;
  SOUND_MAP.click = sndClick;
  SOUND_MAP.spawn = sndSpawn;
  SOUND_MAP.whirl = sndWhirl;
  SOUND_MAP.pickup = sndPickup;

  function play(name, opts) {
    try {
      if (!ctx || !masterGain) return;
      var fn = SOUND_MAP[name];
      if (typeof fn !== 'function') return;
      var t = nowMs();
      var last = lastPlayTimes[name] || 0;
      if (t - last < THROTTLE_MS) return;
      if (activeVoices >= MAX_VOICES) return;
      lastPlayTimes[name] = t;
      opts = opts || {};
      var pitch = typeof opts.pitch === 'number' && isFinite(opts.pitch) ? opts.pitch : 1;
      pitch = clamp(pitch, 0.5, 2);
      var vol = typeof opts.vol === 'number' && isFinite(opts.vol) ? opts.vol : 1;
      vol = clamp(vol, 0, 4);
      var pan = typeof opts.pan === 'number' && isFinite(opts.pan) ? opts.pan : 0;
      pan = clamp(pan, -1, 1);
      fn(ctx.currentTime, { pitch: pitch, vol: vol, pan: pan });
    } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // Procedural music: lookahead scheduler over a 4-chord A-minor loop.
  // Chords: Am, F, C, G -- one bar (4 beats) each.
  // ---------------------------------------------------------------------
  var CHORDS = [
    { bass: 110.00, padRoot: 220.00, padFifth: 329.63, arp: [440.00, 523.25, 659.25, 880.00] },  // Am
    { bass: 87.31,  padRoot: 174.61, padFifth: 261.63, arp: [349.23, 440.00, 523.25, 698.46] },  // F
    { bass: 130.81, padRoot: 261.63, padFifth: 392.00, arp: [523.25, 659.25, 783.99, 1046.50] }, // C
    { bass: 98.00,  padRoot: 196.00, padFifth: 293.66, arp: [392.00, 493.88, 587.33, 783.99] }   // G
  ];

  var music = {
    playing: false,
    timerId: null,
    nextStepTime: 0,
    step: 0,
    bar: 0,
    intensity: 0,
    pendingIntensity: 0
  };

  function currentBpm() {
    return 96 + 64 * music.intensity;
  }

  function stepDuration() {
    return (60 / currentBpm()) / 4;
  }

  function barDuration() {
    return (60 / currentBpm()) * 4;
  }

  function schedulePad(chord, t) {
    try {
      var dur = barDuration() + 0.15;
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + Math.min(0.4, dur * 0.3));
      g.gain.setValueAtTime(0.5, t + Math.max(dur * 0.3, dur - 0.3));
      g.gain.linearRampToValueAtTime(0, t + dur);
      filter.connect(g);
      g.connect(musicBus);
      var oscs = [];
      var tones = [chord.padRoot, chord.padFifth];
      var detunes = [-4, 4];
      for (var i = 0; i < tones.length; i++) {
        for (var j = 0; j < detunes.length; j++) {
          var o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = tones[i];
          o.detune.value = detunes[j];
          o.connect(filter);
          o.start(t);
          o.stop(t + dur + 0.05);
          oscs.push(o);
        }
      }
      trackMusicVoice(oscs[oscs.length - 1], oscs.concat([filter, g]), msFallback(dur + 0.2));
    } catch (e) {}
  }

  function scheduleBass(chord, t) {
    try {
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = chord.bass;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g);
      g.connect(musicBus);
      o.start(t);
      o.stop(t + 0.4);
      trackMusicVoice(o, [o, g], msFallback(0.45));
    } catch (e) {}
  }

  function scheduleKick(t) {
    try {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g);
      g.connect(musicBus);
      o.start(t);
      o.stop(t + 0.14);
      trackMusicVoice(o, [o, g], msFallback(0.2));
    } catch (e) {}
  }

  function scheduleSnare(t) {
    try {
      var src = noiseSource(0.16);
      var filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      src.connect(filter);
      filter.connect(g);
      g.connect(musicBus);
      src.start(t, src._offset);
      src.stop(t + 0.16);
      trackMusicVoice(src, [src, filter, g], msFallback(0.2));
    } catch (e) {}
  }

  function scheduleHat(t) {
    try {
      var src = noiseSource(0.05);
      var filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 7000;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(filter);
      filter.connect(g);
      g.connect(musicBus);
      src.start(t, src._offset);
      src.stop(t + 0.05);
      trackMusicVoice(src, [src, filter, g], msFallback(0.1));
    } catch (e) {}
  }

  function scheduleArp(chord, step, t) {
    try {
      var tone = chord.arp[step % chord.arp.length];
      var o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = tone;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g);
      g.connect(musicBus);
      o.start(t);
      o.stop(t + 0.1);
      trackMusicVoice(o, [o, g], msFallback(0.15));
    } catch (e) {}
  }

  function scheduleStepEvents(step, t) {
    var chord = CHORDS[music.bar];
    var beatStep = (step % 4 === 0);
    var beatNum = step / 4;
    if (step === 0) {
      schedulePad(chord, t);
    }
    if (beatStep && (beatNum === 0 || beatNum === 2)) {
      scheduleBass(chord, t);
      if (music.intensity >= 0.3) scheduleKick(t);
    }
    if (beatStep && (beatNum === 1 || beatNum === 3) && music.intensity >= 0.5) {
      scheduleSnare(t);
    }
    if (step % 2 === 0 && music.intensity >= 0.35) {
      scheduleHat(t);
    }
    if (music.intensity >= 0.7) {
      scheduleArp(chord, step, t);
    }
  }

  function schedulerTick() {
    if (!music.playing || !ctx) return;
    try {
      var now = ctx.currentTime;
      if (music.nextStepTime < now - CATCHUP_THRESHOLD_SEC) {
        // Clock jumped far ahead (e.g. backgrounded tab) -- don't replay
        // a huge backlog of steps all at once, just resync quietly.
        music.nextStepTime = now + 0.05;
        music.step = 0;
      }
      while (music.nextStepTime < now + SCHEDULE_AHEAD_SEC) {
        scheduleStepEvents(music.step, music.nextStepTime);
        music.nextStepTime += stepDuration();
        music.step++;
        if (music.step >= 16) {
          music.step = 0;
          music.bar = (music.bar + 1) % CHORDS.length;
        }
        if (music.step % 4 === 0) {
          music.intensity = music.pendingIntensity;
        }
      }
    } catch (e) {}
  }

  function startMusic() {
    try {
      if (!ctx || !musicBus) return;
      if (music.playing) return;
      music.playing = true;
      music.paused = false;
      music.step = 0;
      music.bar = 0;
      music.intensity = music.pendingIntensity;
      var now = ctx.currentTime;
      music.nextStepTime = now + 0.05;
      var cur = musicBus.gain.value;
      if (!(cur > 0)) cur = 0.0001;
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setValueAtTime(cur, now);
      musicBus.gain.linearRampToValueAtTime(MUSIC_BUS_LEVEL, now + MUSIC_FADE_SEC);
      music.timerId = setInterval(schedulerTick, SCHEDULER_INTERVAL_MS);
    } catch (e) {}
  }

  function stopMusic() {
    try {
      if (!ctx || !music.playing) return;
      var now = ctx.currentTime;
      if (musicBus) {
        var cur = musicBus.gain.value;
        musicBus.gain.cancelScheduledValues(now);
        musicBus.gain.setValueAtTime(cur, now);
        musicBus.gain.linearRampToValueAtTime(0.0001, now + MUSIC_FADE_SEC);
      }
      music.playing = false;
      music.paused = false;
      if (music.timerId !== null) {
        clearInterval(music.timerId);
        music.timerId = null;
      }
    } catch (e) {}
  }

  // Pause keeps the loop position but silences the bus and stops scheduling;
  // resume resyncs the step clock so no backlog of notes plays at once.
  function pauseMusic() {
    try {
      if (!ctx || !music.playing || music.paused) return;
      music.paused = true;
      var now = ctx.currentTime;
      if (musicBus) {
        var cur = musicBus.gain.value;
        musicBus.gain.cancelScheduledValues(now);
        musicBus.gain.setValueAtTime(cur, now);
        musicBus.gain.linearRampToValueAtTime(0.0001, now + 0.15);
      }
      if (music.timerId !== null) {
        clearInterval(music.timerId);
        music.timerId = null;
      }
    } catch (e) {}
  }

  function resumeMusic() {
    try {
      if (!ctx || !music.playing || !music.paused) return;
      music.paused = false;
      var now = ctx.currentTime;
      music.nextStepTime = now + 0.05;
      if (musicBus) {
        var cur = musicBus.gain.value;
        if (!(cur > 0)) cur = 0.0001;
        musicBus.gain.cancelScheduledValues(now);
        musicBus.gain.setValueAtTime(cur, now);
        musicBus.gain.linearRampToValueAtTime(MUSIC_BUS_LEVEL, now + MUSIC_FADE_SEC);
      }
      music.timerId = setInterval(schedulerTick, SCHEDULER_INTERVAL_MS);
    } catch (e) {}
  }

  function isMusicPaused() {
    return !!(music.playing && music.paused);
  }

  function setIntensity(x) {
    if (typeof x !== 'number' || isNaN(x)) return;
    music.pendingIntensity = clamp(x, 0, 1);
    if (!music.playing) {
      music.intensity = music.pendingIntensity;
    }
  }

  function isMusicPlaying() {
    return !!music.playing;
  }

  // ---------------------------------------------------------------------
  // Public API -- the one and only global this file exposes.
  // ---------------------------------------------------------------------
  var SFX = {
    init: init,
    resume: resume,
    setMuted: setMuted,
    toggleMute: toggleMute,
    isMuted: isMuted,
    setVolume: setVolume,
    play: play,
    startMusic: startMusic,
    stopMusic: stopMusic,
    pauseMusic: pauseMusic,
    resumeMusic: resumeMusic,
    isMusicPaused: isMusicPaused,
    setIntensity: setIntensity,
    isMusicPlaying: isMusicPlaying
  };

  window.SFX = SFX;
})();
