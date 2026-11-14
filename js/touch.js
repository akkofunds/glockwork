// Dual-thumb virtual controls for phones/tablets: left floating joystick, right-side look pad,
// fire button that also aims while dragged, and contextual action buttons.

export class TouchControls {
  constructor(root, onAction) {
    this.root = root;
    this.onAction = onAction;
    this.state = { fm: 0, sm: 0, fire: false, alt: false, duck: false, walk: false, reload: false, use: false, drop: false, jumpHeld: false, jumpAt: -1e9 };
    this.lookDX = 0; this.lookDY = 0;
    this.sens = 1;
    this.stick = null; this.look = new Map();
    this._build();
  }

  _btn(label, cls, onDown, onUp) {
    const b = document.createElement('div');
    b.className = 'tbtn ' + cls;
    b.textContent = label;
    b.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      b.classList.add('on');
      for (const t of e.changedTouches) this.look.set(t.identifier, { x: t.clientX, y: t.clientY, btn: b });
      onDown && onDown();
    }, { passive: false });
    const up = (e) => {
      e.preventDefault();
      b.classList.remove('on');
      for (const t of e.changedTouches) this.look.delete(t.identifier);
      onUp && onUp();
    };
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
    this.root.appendChild(b);
    return b;
  }

  _build() {
    const r = this.root;
    r.innerHTML = '';
    r.classList.add('touch-on');
    this.base = document.createElement('div'); this.base.className = 'tstick-base';
    this.knob = document.createElement('div'); this.knob.className = 'tstick-knob';
    this.base.appendChild(this.knob);
    r.appendChild(this.base);
    this.zone = document.createElement('div'); this.zone.className = 'tzone';
    r.appendChild(this.zone);
    const s = this.state;
    this.fireBtn = this._btn('FIRE', 'fire', () => { s.fire = true; }, () => { s.fire = false; });
    this.fireBtn2 = this._btn('FIRE', 'fire2', () => { s.fire = true; }, () => { s.fire = false; });
    this._btn('AIM', 'alt', () => { s.alt = true; }, () => { s.alt = false; });
    this._btn('JUMP', 'jump', () => { s.jumpAt = performance.now(); s.jumpHeld = true; }, () => { s.jumpHeld = false; });
    this.duckBtn = this._btn('DUCK', 'duck', () => { s.duck = !s.duck; this.duckBtn.classList.toggle('latched', s.duck); });
    this._btn('R', 'reload', () => { s.reload = true; }, () => { s.reload = false; });
    this._btn('USE', 'use', () => { s.use = true; }, () => { s.use = false; });
    this._btn('⇄', 'swap', () => this.onAction('nextweapon', true));
    this._btn('NADE', 'nade', () => this.onAction('slot4', true));
    this._btn('BUY', 'buy', () => this.onAction('buy', true));
    this._btn('⤓', 'drop', () => { s.drop = true; }, () => { s.drop = false; });
    this._btn('F', 'inspect', () => this.onAction('inspect', true), () => this.onAction('inspect', false));
    this._btn('☰', 'menu', () => this.onAction('menu', true));
    this._btn('TAB', 'scores', () => this.onAction('scores', true), () => this.onAction('scores', false));
    this.walkBtn = this._btn('WALK', 'walk', () => { s.walk = !s.walk; this.walkBtn.classList.toggle('latched', s.walk); });

    const z = this.zone;
    z.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.42 && !this.stick) {
          this.stick = { id: t.identifier, x: t.clientX, y: t.clientY };
          this.base.style.display = 'block';
          this.base.style.left = (t.clientX - 60) + 'px'; this.base.style.top = (t.clientY - 60) + 'px';
          this.knob.style.transform = 'translate(0px,0px)';
        } else {
          this.look.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      }
    }, { passive: false });
    const move = (e) => {
      if (this.root.style.display === 'none') return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) {
          let dx = t.clientX - this.stick.x, dy = t.clientY - this.stick.y;
          const d = Math.hypot(dx, dy), max = 55;
          if (d > max) { dx *= max / d; dy *= max / d; }
          this.knob.style.transform = `translate(${dx}px,${dy}px)`;
          this.state.sm = dx / max; this.state.fm = -dy / max;
          this.state.walkStick = d < max * 0.55;
        } else if (this.look.has(t.identifier)) {
          const l = this.look.get(t.identifier);
          this.lookDX += (t.clientX - l.x); this.lookDY += (t.clientY - l.y);
          l.x = t.clientX; l.y = t.clientY;
        }
      }
    };
    document.addEventListener('touchmove', move, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) {
          this.stick = null; this.state.fm = 0; this.state.sm = 0;
          this.base.style.display = 'none';
        }
        if (this.look.has(t.identifier) && !this.look.get(t.identifier).btn) this.look.delete(t.identifier);
      }
    };
    z.addEventListener('touchend', end); z.addEventListener('touchcancel', end);
  }

  consumeLook() {
    const k = 2.2 * this.sens;
    const r = { dx: this.lookDX * k, dy: this.lookDY * k };
    this.lookDX = 0; this.lookDY = 0;
    return r;
  }
  show(v) { this.root.style.display = v ? 'block' : 'none'; }
}
