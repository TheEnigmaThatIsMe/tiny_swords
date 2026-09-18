'use strict';
// Keyboard + mouse + touch state. Coordinates are device pixels (multiplied by dpr).
TS.Input = class Input {
  constructor(canvas, renderer) {
    this.canvas = canvas; this.R = renderer;
    this.keys = Object.create(null);
    this.pressedList = [];
    this.pressed = Object.create(null);
    this.mouseX = -1000; this.mouseY = -1000; this.mouseMoved = false;
    this.buttons = [false, false, false];
    this.clicked = [false, false, false];
    this.anyGesture = null; // callback for first user gesture (audio unlock)
    // --- touch ---------------------------------------------------------
    // `touch` drives the touch layouts and hints; it flips on the first real touch and
    // back off on a real mouse event (never on the compatibility mouse events after a tap).
    let coarse = false;
    try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { coarse = false; }
    this.touch = coarse && (navigator.maxTouchPoints || 0) > 0;
    this.touches = new Map();   // pointerId -> { id, x, y, sx, sy, t0, role }
    this.newTouches = [];       // ids that went down since the last endFrame()
    this.endedTouches = [];     // ids that came up since the last endFrame()
    this.lastTouchAt = -1e9;    // compatibility mouse events arrive right after a touch
    const prevent = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1 };
    window.addEventListener('keydown', e => {
      if (e.code in prevent) e.preventDefault();
      if (!this.keys[e.code]) { this.pressed[e.code] = true; this.pressedList.push(e.code); }
      this.keys[e.code] = true;
      if (this.anyGesture) this.anyGesture();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in this.keys) this.keys[k] = false; this.buttons[0] = this.buttons[2] = false; this.releaseTouches(); });
    canvas.addEventListener('mousemove', e => {
      if (this.fromTouch()) return;
      this.touch = false;
      this.mouseX = e.clientX * this.R.dpr; this.mouseY = e.clientY * this.R.dpr; this.mouseMoved = true;
    });
    canvas.addEventListener('mousedown', e => {
      e.preventDefault();
      if (this.fromTouch()) return;
      this.touch = false;
      this.mouseX = e.clientX * this.R.dpr; this.mouseY = e.clientY * this.R.dpr;
      if (e.button < 3) { this.buttons[e.button] = true; this.clicked[e.button] = true; }
      if (this.anyGesture) this.anyGesture();
    });
    window.addEventListener('mouseup', e => { if (e.button < 3 && !this.fromTouch()) this.buttons[e.button] = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mouseleave', () => { this.buttons[0] = this.buttons[2] = false; });
    // --- pointer events (touch / pen only) ------------------------------
    const pos = e => [e.clientX * this.R.dpr, e.clientY * this.R.dpr];
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      this.lastTouchAt = performance.now();
      this.touch = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* stale pointer id */ }
      const p = pos(e);
      this.touches.set(e.pointerId, { id: e.pointerId, x: p[0], y: p[1], sx: p[0], sy: p[1], t0: this.lastTouchAt, role: null, up: false });
      this.newTouches.push(e.pointerId);
      if (this.anyGesture) this.anyGesture();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse') return;
      this.lastTouchAt = performance.now();
      const t = this.touches.get(e.pointerId);
      if (t) { const p = pos(e); t.x = p[0]; t.y = p[1]; }
      e.preventDefault();
    });
    const up = e => {
      if (e.pointerType === 'mouse') return;
      this.lastTouchAt = performance.now();
      // Keep the entry until endFrame() so a touch that goes down and up between two frames is
      // still seen by Touch.poll(); deleting here drops fast taps whenever a frame runs long.
      const t = this.touches.get(e.pointerId);
      if (t && !t.up) { t.up = true; this.endedTouches.push(e.pointerId); }
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    // Stop the browser's scroll/zoom gestures and the synthetic mouse events that follow a tap.
    const swallow = e => { this.lastTouchAt = performance.now(); e.preventDefault(); };
    canvas.addEventListener('touchstart', swallow, { passive: false });
    canvas.addEventListener('touchmove', swallow, { passive: false });
    canvas.addEventListener('touchend', swallow, { passive: false });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseTouches(); });
  }
  // True while the browser may still be emitting compatibility mouse events for a touch.
  fromTouch() { return performance.now() - this.lastTouchAt < 700; }
  releaseTouches() {
    for (const id of this.touches.keys()) this.endedTouches.push(id);
    this.touches.clear();
  }
  down(code) { return !!this.keys[code]; }
  // Edge-triggered: true only on the frame the key went down.
  hit(code) { return !!this.pressed[code]; }
  endFrame() {
    for (let i = 0; i < this.pressedList.length; i++) this.pressed[this.pressedList[i]] = false;
    this.pressedList.length = 0;
    this.clicked[0] = this.clicked[1] = this.clicked[2] = false;
    this.newTouches.length = 0; this.endedTouches.length = 0;
    for (const [id, t] of this.touches) if (t.up) this.touches.delete(id); // released touches live one full frame
  }
  axisX() { return (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0); }
  axisY() { return (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0) - (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0); }
  mouseIn(x, y, w, h) { return this.mouseX >= x && this.mouseY >= y && this.mouseX < x + w && this.mouseY < y + h; }
};
