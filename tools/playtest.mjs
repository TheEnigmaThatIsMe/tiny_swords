#!/usr/bin/env node
// Zero-dependency headless-Chrome playtest driver.
//
// Launches Chrome headless, drives a browser game over the Chrome DevTools
// Protocol (real keyboard input via Input.dispatchKeyEvent), records console
// errors / uncaught exceptions / failed network requests, takes screenshots,
// and exits with a status code reflecting what happened. See --help.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const body = raw.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) out[body] = true;
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function printUsage() {
  console.log(`Usage: node tools/playtest.mjs [options]

Options:
  --url=URL          Target URL to test (skips spawning the dev server)
  --file             Open file://<repo>/index.html directly (skips the dev server)
  --query=STRING     Query string appended to the URL (default: bot=1 on desktop,
                     which disables auto-pause; empty in --mobile mode so the bot
                     doesn't short-circuit touch input)
  --speed=N          Simulation speed multiplier passed to __game.setSpeed (default: 6)
  --minutes=N        Max game minutes to play before stopping (default: 10)
  --shots=DIR        Screenshot output directory (default: <repo>/playtest-shots,
                     or <repo>/playtest-shots/mobile-<orientation> in --mobile mode)
  --shot-every=N     Take a screenshot every N game-seconds (default: 60)
  --timeout=N        Max wall-clock seconds before giving up (default: 600)
  --chrome=PATH      Path to the Chrome binary (default: $CHROME, else the
                     standard macOS install path)
  --repo=DIR         Repo root (default: parent directory of this script)
  --mobile[=landscape|portrait]
                     Emulate a touch phone instead of desktop mouse/keyboard input
                     (default orientation: landscape, 844x390 CSS px @2x; portrait
                     is 390x844 @2x). Touch-drives the PLAY button, the on-screen
                     joystick and the attack button before handing off to the bot
                     for the timed run, and screenshots the pause and level-up
                     states along the way.
  --help             Show this help and exit

Exit codes:
  0   no errors were observed
  1   one or more errors were observed
  2   the page never became ready, or Chrome/CDP failed
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

const speed = num(args.speed, 6);
const minutes = num(args.minutes, 10);
const shotEvery = num(args['shot-every'], 60);
const timeoutSec = num(args.timeout, 600);

const mobile = args.mobile !== undefined;
const mobileOrientation = args.mobile === 'portrait' ? 'portrait' : 'landscape';
if (mobile && args.mobile !== true && args.mobile !== 'landscape' && args.mobile !== 'portrait') {
  console.error(`--mobile must be "landscape" or "portrait", got "${args.mobile}"`);
  process.exit(2);
}
const mobileMetrics = mobileOrientation === 'portrait'
  ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
  : { width: 844, height: 390, deviceScaleFactor: 2, mobile: true };

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.dirname(toolsDir);
const repoRoot = args.repo ? path.resolve(String(args.repo)) : defaultRepoRoot;

const shotsDir = args.shots
  ? path.resolve(String(args.shots))
  : path.join(repoRoot, 'playtest-shots', ...(mobile ? [`mobile-${mobileOrientation}`] : []));

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttpUp(url, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return true;
    } catch (e) {
      lastErr = e;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${url}${lastErr ? ' (' + lastErr.message + ')' : ''}`);
}

async function pollUntilTrue(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

function mmss(seconds) {
  const t = Math.max(0, Math.round(Number(seconds) || 0));
  const mm = Math.floor(t / 60);
  const ss = t % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function mmssCompact(seconds) {
  const t = Math.max(0, Math.round(Number(seconds) || 0));
  const mm = Math.floor(t / 60);
  const ss = t % 60;
  return `${String(mm).padStart(2, '0')}${String(ss).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Minimal CDP client over the global WebSocket
// ---------------------------------------------------------------------------

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    ws.addEventListener('message', (ev) => this._onMessage(ev));
    ws.addEventListener('close', () => this._onClose());
    ws.addEventListener('error', () => this._onClose());
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
      else p.resolve(msg.result);
    } else if (msg.method) {
      const hs = this.listeners.get(msg.method);
      if (hs) {
        for (const h of hs) {
          try {
            h(msg.params || {});
          } catch {
            /* a handler bug must never take down the driver */
          }
        }
      }
    }
  }

  _onClose() {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('CDP connection closed'));
    }
    this.pending.clear();
  }

  send(method, params = {}, timeoutMs = 10000) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
  }
}

async function connectCDP(port) {
  await waitForHttpUp(`http://127.0.0.1:${port}/json/version`, 15000, 150);
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target found in /json');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (e) => reject(new Error('WebSocket error: ' + (e.message || e))), {
      once: true,
    });
  });
  return new CDP(ws);
}

// ---------------------------------------------------------------------------
// Module-scope state shared between main() and cleanup/SIGINT handling
// ---------------------------------------------------------------------------

let chromeProc = null;
let serverProc = null;
let userDataDir = null;
let cdp = null;
let chromeStderr = '';

const errors = [];
const warnings = [];
let shotCount = 0;

function addError(msg) {
  errors.push(String(msg));
}
function addWarning(msg) {
  warnings.push(String(msg));
}

async function killProc(proc) {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    return;
  }
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 2000);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function cleanup() {
  if (cdp && cdp.ws) {
    try {
      cdp.ws.close();
    } catch {
      /* ignore */
    }
  }
  await killProc(chromeProc);
  await killProc(serverProc);
  if (userDataDir) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

let exiting = false;
async function cleanupAndExit(code) {
  if (exiting) return;
  exiting = true;
  await cleanup();
  process.exit(code);
}

process.on('SIGINT', () => {
  cleanupAndExit(130);
});

// ---------------------------------------------------------------------------
// CDP-backed helpers used by the flow below (close over `cdp`)
// ---------------------------------------------------------------------------

async function evalJSON(expr) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify((()=>{ return (${expr}); })())`,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const ed = result.exceptionDetails;
    const desc = ed.exception && (ed.exception.description || ed.exception.value);
    throw new Error([ed.text, desc].filter(Boolean).join(': '));
  }
  const v = result.result ? result.result.value : undefined;
  if (v === undefined) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

async function evalBool(expr) {
  try {
    return !!(await evalJSON(expr));
  } catch {
    return false;
  }
}

async function screenshot(name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotsDir, name), Buffer.from(res.data, 'base64'));
  shotCount++;
}

async function pressKey(key, code, vk) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// Touch points are CSS px (not device px) per the CDP Input domain.
async function touchStart(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
}
async function touchMove(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
}
async function touchEnd() {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(x, y) {
  await touchStart(x, y);
  await touchEnd();
}

function fmtRemote(o) {
  if (o == null) return String(o);
  if (o.type === 'string') return o.value;
  if (Object.prototype.hasOwnProperty.call(o, 'value')) {
    try {
      return typeof o.value === 'string' ? o.value : JSON.stringify(o.value);
    } catch {
      return String(o.value);
    }
  }
  if (o.unserializableValue) return o.unserializableValue;
  if (o.description) return o.description;
  return `<${o.type}>`;
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(shotsDir, { recursive: true });

  try {
    // -- Resolve target URL, spawning the dev server only when needed -------
    let targetUrl;
    if (args.file) {
      targetUrl = pathToFileURL(path.join(repoRoot, 'index.html')).href;
    } else if (args.url) {
      targetUrl = String(args.url);
    } else {
      const port = await getFreePort();
      serverProc = spawn(process.execPath, ['serve.js'], {
        cwd: repoRoot,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let serverOut = '';
      serverProc.stdout.on('data', (d) => (serverOut += d.toString()));
      serverProc.stderr.on('data', (d) => (serverOut += d.toString()));
      targetUrl = `http://127.0.0.1:${port}/`;
      try {
        await waitForHttpUp(targetUrl, 10000);
      } catch (e) {
        if (serverOut) console.error(serverOut);
        throw e;
      }
    }
    // In --mobile mode, bot=1 must NOT be the default: the bot short-circuits input handling,
    // which is exactly what the touch-driven start/joystick/attack checks below need to exercise.
    const query = args.query !== undefined ? String(args.query) : mobile ? '' : 'bot=1';
    if (query) targetUrl += (targetUrl.includes('?') ? '&' : '?') + query;
    const isFileUrl = targetUrl.startsWith('file://');

    // -- Launch Chrome --------------------------------------------------------
    const chromePath =
      args.chrome || process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const cdpPort = await getFreePort();
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playtest-chrome-'));

    const chromeArgs = [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,720',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-features=Translate',
      '--enable-unsafe-swiftshader',
    ];
    if (isFileUrl) chromeArgs.push('--allow-file-access-from-files');
    chromeArgs.push('about:blank');

    chromeProc = spawn(chromePath, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    chromeProc.stderr.on('data', (d) => (chromeStderr += d.toString()));
    chromeProc.on('error', (e) => (chromeStderr += `\n[spawn error] ${e.message}`));

    // -- Connect CDP ------------------------------------------------------------
    try {
      cdp = await connectCDP(cdpPort);
    } catch (e) {
      if (chromeStderr) console.error(chromeStderr);
      throw e;
    }

    cdp.on('Runtime.exceptionThrown', (params) => {
      const ed = params.exceptionDetails || {};
      const desc = ed.exception && (ed.exception.description || ed.exception.value);
      addError([ed.text, desc].filter(Boolean).join(': ') || 'uncaught exception');
    });

    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || []).map(fmtRemote).join(' ');
      console.log(`[console.${params.type}] ${text}`);
      if (params.type === 'error') addError(text);
      else if (params.type === 'warn' || params.type === 'warning') addWarning(text);
    });

    cdp.on('Log.entryAdded', (params) => {
      const entry = params.entry || {};
      if (entry.level === 'error') {
        addError(`[Log] ${entry.text}${entry.url ? ' (' + entry.url + ')' : ''}`);
      }
    });

    const reqUrls = new Map();
    cdp.on('Network.requestWillBeSent', (params) => {
      reqUrls.set(params.requestId, params.request && params.request.url);
    });
    cdp.on('Network.responseReceived', (params) => {
      const resp = params.response || {};
      if (resp.status >= 400) addError(`HTTP ${resp.status} ${resp.url}`);
    });
    cdp.on('Network.loadingFailed', (params) => {
      if (params.canceled) return;
      const url = reqUrls.get(params.requestId) || params.requestId;
      addError(`Network failed: ${params.errorText} ${url}`);
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');

    if (mobile) {
      await cdp.send('Emulation.setDeviceMetricsOverride', mobileMetrics);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }

    // -- Navigate and wait for the game to report ready ------------------------
    await cdp.send('Page.navigate', { url: targetUrl });

    const ready = await pollUntilTrue(
      () => evalBool('window.__game && window.__game.ready'),
      30000,
      200
    );

    if (!ready) {
      console.error('');
      console.error('=== Playtest FAILED: window.__game.ready never became true (30s) ===');
      console.error(`errors collected (${errors.length}):`);
      for (const e of errors) console.error('  - ' + e);
      console.error(`warnings collected (${warnings.length}):`);
      for (const w of warnings) console.error('  - ' + w);
      await cleanupAndExit(2);
      return;
    }

    await screenshot('00-start.png');

    // -- Start the game: a real Enter keydown on desktop, a touch tap on PLAY on mobile ---------
    let started;
    if (mobile) {
      const play = await evalJSON('window.__game.game.ui.rects.play');
      const dpr = (await evalJSON('window.__game.game.R.dpr')) || 2;
      if (!play) {
        addError('mobile: window.__game.game.ui.rects.play was not available to tap');
        started = false;
      } else {
        const cx = (play.x + play.w / 2) / dpr, cy = (play.y + play.h / 2) / dpr;
        await tap(cx, cy);
        started = await pollUntilTrue(() => evalBool('window.__game.state === "playing"'), 2000, 100);
        if (!started) addError('mobile: touchStart/touchEnd on the PLAY button did not start the game within 2s');
      }
    } else {
      await pressKey('Enter', 'Enter', 13);
      started = await pollUntilTrue(() => evalBool('window.__game.state === "playing"'), 2000, 100);
    }

    let finalState = 'menu';
    const lastStats = {
      time: 0, hp: 0, maxHp: 0, level: 0, kills: 0, score: 0, enemies: 0, fps: 0, frameMs: 0, state: 'menu', wave: 0,
    };
    const fpsSamples = [];

    if (!started) {
      addError(mobile ? 'game did not start on PLAY tap' : 'game did not start on Enter');
    } else {
      finalState = 'playing';

      if (mobile) {
        // -- Touch-drive the joystick and attack zone before handing off to the bot ------------
        const cssW = mobileMetrics.width, cssH = mobileMetrics.height;
        const x0 = Number(await evalJSON('window.__game.game.player.x')) || 0;
        const jx = cssW * 0.25, jy = cssH * 0.6;
        await touchStart(jx, jy);
        await touchMove(jx + 70, jy);
        await sleep(800);
        await touchEnd();
        const x1 = Number(await evalJSON('window.__game.game.player.x')) || 0;
        if (!(x1 - x0 > 20)) addError(`mobile: joystick drag did not move the player (dx=${(x1 - x0).toFixed(1)})`);

        const ax = cssW * 0.8, ay = cssH * 0.6;
        await touchStart(ax, ay);
        await sleep(100);
        const attacking = await evalBool('window.__game.game.ctrl.attack === true');
        if (!attacking) addError('mobile: holding the attack zone did not set ctrl.attack');
        await touchEnd();

        await screenshot('mobile-playing.png');
      }

      await evalJSON(`(window.__game.setBot(true), window.__game.setSpeed(${speed}), true)`);

      // -- Monitoring loop: one tick per wall-clock second ----------------------
      let lastShotBoundary = 0;
      let mobilePausedShotDone = false, mobileLevelupShotDone = false;
      const loopStart = Date.now();
      for (;;) {
        await sleep(1000);
        const stats = (await evalJSON('window.__game.stats')) || {};
        Object.assign(lastStats, stats);
        const t = Number(stats.time) || 0;

        console.log(
          `t=${mmss(t)} hp=${stats.hp}/${stats.maxHp} lvl=${stats.level} kills=${stats.kills} ` +
            `score=${stats.score} enemies=${stats.enemies} fps=${Math.round(stats.fps || 0)} ms=${(stats.frameMs || 0).toFixed(1)} state=${stats.state}`
        );
        if (Number.isFinite(stats.fps)) fpsSamples.push(stats.fps);

        const boundary = Math.floor(t / shotEvery);
        if (boundary > lastShotBoundary) {
          lastShotBoundary = boundary;
          await screenshot(`t${mmssCompact(t)}.png`);
        }

        if (mobile && !mobileLevelupShotDone && stats.state === 'levelup') {
          mobileLevelupShotDone = true;
          await screenshot('mobile-levelup.png');
        }
        if (mobile && !mobilePausedShotDone && t >= 30) {
          mobilePausedShotDone = true;
          await evalJSON("(window.__game.game.state = 'paused', true)");
          await sleep(150);
          await screenshot('mobile-paused.png');
          await evalJSON("(window.__game.game.state = 'playing', true)");
        }

        if (stats.state === 'gameover' || stats.state === 'victory') {
          finalState = stats.state;
          await screenshot(`end-${stats.state}.png`);
          break;
        }
        if (t >= minutes * 60) {
          finalState = stats.state;
          break;
        }
        if (Date.now() - loopStart >= timeoutSec * 1000) {
          addWarning(`wall-clock timeout (${timeoutSec}s) reached before the game ended`);
          finalState = stats.state;
          break;
        }
      }

      // -- Restart flow -----------------------------------------------------------
      await pressKey('r', 'KeyR', 82);
      const okAfterR = await pollUntilTrue(
        () => evalBool('window.__game.state === "playing" || window.__game.state === "menu"'),
        3000,
        100
      );
      if (!okAfterR) {
        addError('restart failed');
      } else {
        const stateAfterR = (await evalJSON('window.__game.state')) || '';
        if (stateAfterR === 'menu') {
          await pressKey('Enter', 'Enter', 13);
          const okAfterEnter = await pollUntilTrue(
            () => evalBool('window.__game.state === "playing"'),
            2000,
            100
          );
          if (!okAfterEnter) addError('restart failed');
        }
        await sleep(3000);
        await screenshot('restart.png');
      }
    }

    // -- Merge the game's own captured errors -----------------------------------
    try {
      const gameErrors = await evalJSON('window.__game.errors');
      if (Array.isArray(gameErrors)) {
        for (const e of gameErrors) addError(e);
      }
    } catch {
      /* best effort */
    }

    // -- Summary ------------------------------------------------------------------
    const dedupedErrors = [...new Set(errors)];
    const exitCode = dedupedErrors.length > 0 ? 1 : 0;
    const fpsMin = fpsSamples.length ? Math.min(...fpsSamples) : 0;
    const fpsAvg = fpsSamples.length ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : 0;
    const fpsMax = fpsSamples.length ? Math.max(...fpsSamples) : 0;

    console.log('');
    console.log('=== Playtest Summary ===');
    console.log(`outcome: ${finalState}`);
    console.log(`survived: ${mmss(lastStats.time)}`);
    console.log(`level: ${lastStats.level}  kills: ${lastStats.kills}  score: ${lastStats.score}`);
    console.log(`fps min/avg/max: ${fpsMin.toFixed(1)} / ${fpsAvg.toFixed(1)} / ${fpsMax.toFixed(1)}`);
    console.log(`screenshots: ${shotCount} (${shotsDir})`);
    console.log(`warnings: ${warnings.length}`);
    console.log(`errors: ${dedupedErrors.length}`);
    for (const e of dedupedErrors) console.log(`  - ${e}`);

    await cleanupAndExit(exitCode);
  } catch (e) {
    console.error('');
    console.error('FATAL: ' + (e && e.stack ? e.stack : e));
    await cleanupAndExit(2);
  }
}

main();
