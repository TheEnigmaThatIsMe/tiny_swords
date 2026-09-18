'use strict';
// Bootstrap: canvas, asset loading, fixed-timestep loop, debug API (window.__game).
(function () {
  const STEP = 1 / 60;
  const canvas = document.getElementById('game');
  const R = new TS.Renderer(canvas);
  const input = new TS.Input(canvas, R);
  // Resize robustness: iOS reports stale sizes right after a rotation or a URL-bar slide,
  // so re-measure a couple of times after the event. Coalesced to at most one resize per frame.
  let resizePending = false;
  function doResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => { resizePending = false; R.resize(); });
  }
  function resizeSettled() { doResize(); setTimeout(doResize, 150); setTimeout(doResize, 500); }
  window.addEventListener('resize', doResize);
  window.addEventListener('orientationchange', resizeSettled);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeSettled);
  const errors = [];
  window.addEventListener('error', e => { errors.push(String(e.message || e)); });
  window.addEventListener('unhandledrejection', e => { errors.push('unhandledrejection: ' + String(e.reason)); });
  const dbg = window.__game = { ready: false, state: 'loading', stats: null, errors, version: TS.VERSION, setBot() {}, setSpeed() {}, start() {}, restart() {} };
  let progress = 0, loadErr = null;
  function drawLoading() { TS.UI.drawLoading(R, progress, loadErr); if (!dbg.ready) requestAnimationFrame(drawLoading); }
  requestAnimationFrame(drawLoading);
  TS.Assets.load((done, total) => { progress = done / total; }).then(() => {
    TS.buildSprites();
    const ui = new TS.UI(R, input);
    const game = new TS.Game(R, input, ui);
    input.anyGesture = () => { SFX.init(); SFX.resume(); };
    const params = new URLSearchParams(location.search);
    if (params.get('fps') === '1') game.showFps = true;
    dbg.ready = true; dbg.stats = game.stats; dbg.game = game; dbg.touch = game.touch;
    dbg.setBot = on => game.setBot(on);
    dbg.setSpeed = n => { game.speed = Math.max(1, Math.min(20, n | 0)); };
    dbg.start = () => { if (game.state === 'menu') game.startRun(); };
    dbg.restart = () => game.startRun();
    if (params.get('bot') === '1') { game.setBot(true); }
    let last = performance.now(), acc = 0, fpsEma = 60, frameEma = 16.7, rafPending = false, lastRafAt = performance.now();
    // Auto-pause when the window loses focus (not in bot mode, which runs unattended).
    const autoPause = () => { if (game.state === 'playing' && !game.bot) { game.state = 'paused'; SFX.pauseMusic(); } };
    window.addEventListener('blur', autoPause);
    document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
    function rafFrame(now) { rafPending = false; lastRafAt = performance.now(); frame(now); }
    function schedule() { if (!rafPending) { rafPending = true; requestAnimationFrame(rafFrame); } }
    // Watchdog: if requestAnimationFrame stalls (hidden or headless tab), keep stepping on a timer.
    setInterval(() => { if (performance.now() - lastRafAt > 250) frame(performance.now()); }, 16);
    function frame(now) {
      schedule();
      const t0 = performance.now();
      let dt = (now - last) / 1000; last = now;
      if (dt > 0.25) dt = 0.25;
      fpsEma += (1 / Math.max(1e-3, dt) - fpsEma) * 0.05;
      game.pollInput();
      acc += dt * game.speed;
      const maxSteps = 5 * game.speed; let steps = 0;
      while (acc >= STEP && steps < maxSteps) { game.step(STEP); acc -= STEP; steps++; }
      if (steps >= maxSteps) acc = 0;
      const t1 = performance.now();
      game.render();
      const t2 = performance.now();
      input.endFrame();
      dbg.state = game.publicState();
      const s = game.stats;
      s.time = game.time; s.hp = Math.max(0, Math.round(game.player.hp)); s.maxHp = game.player.maxHp; s.level = game.player.level; s.kills = game.kills; s.score = Math.round(game.score);
      s.enemies = game.enemies.active; s.fps = fpsEma; frameEma += ((t2 - t0) - frameEma) * 0.1; s.frameMs = frameEma; s.updateMs = t1 - t0; s.drawMs = t2 - t1; s.state = dbg.state; s.wave = game.wave;
      s.fxCount = game.fx.particles.active + game.fx.sprites.active + game.fx.texts.active; s.draws = R.drawCalls;
    }
    schedule();
  }).catch(err => { loadErr = err.message || String(err); errors.push(loadErr); console.error(err); });
})();
