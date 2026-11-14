// Keyboard + mouse (Pointer Lock) input with a 50 ms jump buffer fed by Space and the mouse wheel.
import { BTN } from './sim/movement.js';

export const BINDS = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'walk', ShiftRight: 'walk', ControlLeft: 'duck', ControlRight: 'duck', KeyC: 'duck',
  KeyR: 'reload', KeyE: 'use', KeyG: 'drop', KeyF: 'inspect', KeyB: 'buy', Tab: 'scores', KeyQ: 'lastweapon',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5', Escape: 'menu', KeyM: 'menu',
  KeyT: 'chat', KeyY: 'chat', KeyU: 'teamchat',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.mouseL = false; this.mouseR = false;
    this.clickL = false; this.clickR = false;
    this.dx = 0; this.dy = 0;
    this.lookDX = 0; this.lookDY = 0;
    this.jumpAt = -1e9;
    this.locked = false;
    this.enabled = false; // gameplay input active
    this.uiOpen = false;
    this.onAction = null; // (name, down, event)
    this.touch = null;
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      const a = BINDS[e.code];
      if (!a) return;
      if (a === 'scores' || a === 'jump' || (this.locked && a !== 'menu')) e.preventDefault();
      if (e.repeat) return;
      this.held.add(a);
      if (a === 'jump') this.jumpAt = performance.now();
      this.onAction && this.onAction(a, true, e);
    });
    document.addEventListener('keyup', (e) => {
      const a = BINDS[e.code];
      if (!a) return;
      this.held.delete(a);
      this.onAction && this.onAction(a, false, e);
    });
    window.addEventListener('blur', () => { this.held.clear(); this.mouseL = this.mouseR = false; });
    c.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouseL = true; this.clickL = true; }
      if (e.button === 2) { this.mouseR = true; this.clickR = true; }
      this.onAction && this.onAction(e.button === 0 ? 'attack' : e.button === 2 ? 'attack2' : 'mouse' + e.button, true, e);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseL = false;
      if (e.button === 2) this.mouseR = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // guard against the occasional huge delta some browsers emit on lock
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    c.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.jumpAt = performance.now();
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) { this.mouseL = this.mouseR = false; this.held.clear(); }
      this.onLockChange && this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (this.touch) return;
    const fallback = () => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* needs a click: "Click to play" is shown */ } };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(fallback);
    } catch { fallback(); }
    // capture Ctrl+W etc. where supported (Chromium fullscreen)
    if (navigator.keyboard && navigator.keyboard.lock && document.fullscreenElement) navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape']).catch(() => {});
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  consumeLook() {
    let dx = this.dx, dy = this.dy;
    this.dx = 0; this.dy = 0;
    if (this.touch) { const t = this.touch.consumeLook(); dx += t.dx; dy += t.dy; }
    this.lookDX = dx; this.lookDY = dy;
    return [dx, dy];
  }

  buttons() {
    const h = this.held;
    let b = 0;
    const t = this.touch ? this.touch.state : null;
    if (h.has('fwd') || (t && t.fm > 0.3)) b |= BTN.FWD;
    if (h.has('back') || (t && t.fm < -0.3)) b |= BTN.BACK;
    if (h.has('left') || (t && t.sm < -0.3)) b |= BTN.LEFT;
    if (h.has('right') || (t && t.sm > 0.3)) b |= BTN.RIGHT;
    if (h.has('walk') || (t && t.walk)) b |= BTN.WALK;
    if (h.has('duck') || (t && t.duck)) b |= BTN.DUCK;
    // latched clicks guarantee a quick tap is seen by at least one 64 Hz command even on slow frames
    if (this.mouseL || this.clickL || (t && t.fire)) b |= BTN.ATTACK;
    if (this.mouseR || this.clickR || (t && t.alt)) b |= BTN.ATTACK2;
    this.clickL = false; this.clickR = false;
    if (h.has('reload') || (t && t.reload)) b |= BTN.RELOAD;
    if (h.has('use') || (t && t.use)) b |= BTN.USE;
    if (h.has('inspect')) b |= BTN.INSPECT;
    if (h.has('drop') || (t && t.drop)) b |= BTN.DROP;
    if (performance.now() - this.jumpAt <= 50 || (t && performance.now() - t.jumpAt <= 50)) b |= BTN.JUMP;
    return b;
  }
}
