'use strict';
// Keyboard + mouse state. Coordinates are device pixels (multiplied by dpr).
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
    const prevent = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1 };
    window.addEventListener('keydown', e => {
      if (e.code in prevent) e.preventDefault();
      if (!this.keys[e.code]) { this.pressed[e.code] = true; this.pressedList.push(e.code); }
      this.keys[e.code] = true;
      if (this.anyGesture) this.anyGesture();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in this.keys) this.keys[k] = false; this.buttons[0] = this.buttons[2] = false; });
    canvas.addEventListener('mousemove', e => { this.mouseX = e.clientX * this.R.dpr; this.mouseY = e.clientY * this.R.dpr; this.mouseMoved = true; });
    canvas.addEventListener('mousedown', e => {
      this.mouseX = e.clientX * this.R.dpr; this.mouseY = e.clientY * this.R.dpr;
      if (e.button < 3) { this.buttons[e.button] = true; this.clicked[e.button] = true; }
      if (this.anyGesture) this.anyGesture();
      e.preventDefault();
    });
    window.addEventListener('mouseup', e => { if (e.button < 3) this.buttons[e.button] = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mouseleave', () => { this.buttons[0] = this.buttons[2] = false; });
  }
  down(code) { return !!this.keys[code]; }
  // Edge-triggered: true only on the frame the key went down.
  hit(code) { return !!this.pressed[code]; }
  endFrame() {
    for (let i = 0; i < this.pressedList.length; i++) this.pressed[this.pressedList[i]] = false;
    this.pressedList.length = 0;
    this.clicked[0] = this.clicked[1] = this.clicked[2] = false;
  }
  axisX() { return (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0); }
  axisY() { return (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0) - (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0); }
  mouseIn(x, y, w, h) { return this.mouseX >= x && this.mouseY >= y && this.mouseX < x + w && this.mouseY < y + h; }
};
