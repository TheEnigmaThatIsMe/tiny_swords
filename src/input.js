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
    this.gestureEnd = null; // called inside the handler of a gesture's final event (fullscreen needs that)
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
    window.addEventListener('mouseup', e => {
      if (this.fromTouch()) return;
      if (e.button < 3) this.buttons[e.button] = false;
      if (this.gestureEnd) this.gestureEnd();
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mouseleave', () => { this.buttons[0] = this.buttons[2] = false; });
    // --- touch (and pen) -------------------------------------------------
    // Touch Events are the primary path wherever the browser has them: iOS Safari's Pointer
    // Events drop or mis-capture contacts (WebKit bug 220196 and friends), while its Touch Events
    // are the mature path every mobile engine relies on. Pointer Events cover touch and pen on
    // browsers without Touch Events. Every contact gets its own never-reused id, so a released
    // touch that lingers one frame can never be confused with a new one whose browser identifier
    // was recycled (Chrome reuses touch identifiers immediately).
    this.byNative = new Map();  // browser identifier / pointerId -> our id, for live contacts only
    this.seq = 0;
    const begin = (native, cx, cy) => {
      const id = ++this.seq, x = cx * this.R.dpr, y = cy * this.R.dpr;
      this.byNative.set(native, id);
      this.touches.set(id, { id, x, y, sx: x, sy: y, t0: this.lastTouchAt, role: null, up: false });
      this.newTouches.push(id);
    };
    const move = (native, cx, cy) => {
      const t = this.touches.get(this.byNative.get(native));
      if (t && !t.up) { t.x = cx * this.R.dpr; t.y = cy * this.R.dpr; }
    };
    // Keep the entry until endFrame() so a touch that goes down and up between two frames is
    // still seen by Touch.poll(); deleting here drops fast taps whenever a frame runs long.
    const end = native => {
      const id = this.byNative.get(native); this.byNative.delete(native);
      const t = this.touches.get(id);
      if (t && !t.up) { t.up = true; this.endedTouches.push(id); }
    };
    if ('ontouchstart' in window) {
      const onTouch = (kind, e) => {
        this.lastTouchAt = performance.now();
        this.touch = true;
        const cts = e.changedTouches;
        for (let i = 0; i < cts.length; i++) {
          const c = cts[i];
          if (kind === 0) begin(c.identifier, c.clientX, c.clientY);
          else if (kind === 1) move(c.identifier, c.clientX, c.clientY);
          else end(c.identifier);
        }
        // Audio unlock on both ends of the gesture: WebKit only counts some of them as activation.
        if (kind !== 1 && this.anyGesture) this.anyGesture();
        if (kind === 2 && this.gestureEnd) this.gestureEnd();
        // Stops scroll, pinch-zoom, double-tap zoom and the synthetic mouse events after a tap.
        e.preventDefault();
      };
      canvas.addEventListener('touchstart', e => onTouch(0, e), { passive: false });
      canvas.addEventListener('touchmove', e => onTouch(1, e), { passive: false });
      canvas.addEventListener('touchend', e => onTouch(2, e), { passive: false });
      canvas.addEventListener('touchcancel', e => onTouch(2, e), { passive: false });
    } else {
      canvas.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse') return;
        this.lastTouchAt = performance.now();
        this.touch = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* stale pointer id */ }
        begin(e.pointerId, e.clientX, e.clientY);
        if (this.anyGesture) this.anyGesture();
        e.preventDefault();
      });
      canvas.addEventListener('pointermove', e => {
        if (e.pointerType === 'mouse') return;
        this.lastTouchAt = performance.now();
        move(e.pointerId, e.clientX, e.clientY);
        e.preventDefault();
      });
      const up = e => {
        if (e.pointerType === 'mouse') return;
        this.lastTouchAt = performance.now();
        end(e.pointerId);
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        if (this.gestureEnd) this.gestureEnd();
      };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseTouches(); });
  }
  // True while the browser may still be emitting compatibility mouse events for a touch.
  fromTouch() { return performance.now() - this.lastTouchAt < 700; }
  releaseTouches() {
    for (const id of this.touches.keys()) this.endedTouches.push(id);
    this.touches.clear();
    this.byNative.clear();
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
