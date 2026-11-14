// Procedurally synthesised, spatialised Web Audio sound effects (no audio files to download).
// Buffers are generated once; playback reuses BufferSources with HRTF (or cheap equal-power) panners.

const SR = 44100;

function noise(n, seed = 1) { const a = new Float32Array(n); let s = seed; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; a[i] = (s / 2147483647) * 2 - 1; } return a; }
function onePoleLP(buf, cutoff) { const k = Math.exp(-2 * Math.PI * cutoff / SR); let y = 0; for (let i = 0; i < buf.length; i++) { y = (1 - k) * buf[i] + k * y; buf[i] = y; } return buf; }
function onePoleHP(buf, cutoff) { const k = Math.exp(-2 * Math.PI * cutoff / SR); let y = 0, px = 0; for (let i = 0; i < buf.length; i++) { const x = buf[i]; y = k * (y + x - px); px = x; buf[i] = y; } return buf; }
function env(buf, attack, decay, curve = 3) {
  const a = attack * SR;
  for (let i = 0; i < buf.length; i++) { const e = i < a ? i / a : Math.exp(-((i - a) / SR) / decay * curve / 3); buf[i] *= e; }
  return buf;
}
function norm(buf, peak = 0.95) { let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m; return buf; }
function mix(...bufs) { const n = Math.max(...bufs.map((b) => b.length)); const o = new Float32Array(n); for (const b of bufs) for (let i = 0; i < b.length; i++) o[i] += b[i]; return o; }
function sine(n, f0, f1 = f0, amp = 1) { const o = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const f = f0 + (f1 - f0) * (i / n); ph += 2 * Math.PI * f / SR; o[i] = Math.sin(ph) * amp; } return o; }
function square(n, f, amp = 1) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (Math.sin(2 * Math.PI * f * i / SR) > 0 ? 1 : -1) * amp; return o; }
const len = (s) => Math.floor(s * SR);

function gunshot({ body = 160, crack = 2400, decay = 0.18, tail = 0.5, punch = 1, suppressed = false, seed = 1 }) {
  const n = len(tail + 0.1);
  if (suppressed) {
    const a = env(onePoleLP(noise(n, seed), 1800), 0.001, 0.05);
    const b = env(sine(n, 140, 60, 0.6), 0.001, 0.05);
    const c = env(onePoleHP(noise(n, seed + 3), 3000), 0.0005, 0.012);
    for (let i = 0; i < c.length; i++) c[i] *= 0.6;
    return norm(mix(a, b, c), 0.7);
  }
  const crackN = env(onePoleHP(noise(n, seed), crack), 0.0003, 0.012);
  const bodyN = env(onePoleLP(noise(n, seed + 7), body * 6), 0.001, decay);
  const thump = env(sine(n, body * 1.6, body * 0.4, punch), 0.0008, decay * 0.6);
  const tailN = env(onePoleLP(noise(n, seed + 13), 900), 0.02, tail);
  for (let i = 0; i < tailN.length; i++) tailN[i] *= 0.25;
  return norm(mix(crackN, bodyN, thump, tailN));
}

function buildBank() {
  const B = {};
  B.rifle = gunshot({ body: 150, crack: 2200, decay: 0.16, tail: 0.6, seed: 3 });
  B.rifle_s = gunshot({ suppressed: true, tail: 0.25, seed: 4 });
  B.pistol = gunshot({ body: 220, crack: 2800, decay: 0.09, tail: 0.35, punch: 0.7, seed: 5 });
  B.pistol_s = gunshot({ suppressed: true, tail: 0.2, seed: 6 });
  B.deagle = gunshot({ body: 120, crack: 1800, decay: 0.22, tail: 0.7, punch: 1.3, seed: 7 });
  B.smg = gunshot({ body: 240, crack: 3000, decay: 0.07, tail: 0.3, punch: 0.6, seed: 8 });
  B.sniper = gunshot({ body: 110, crack: 1900, decay: 0.25, tail: 0.9, punch: 1.2, seed: 9 });
  B.awp = gunshot({ body: 80, crack: 1500, decay: 0.35, tail: 1.3, punch: 1.6, seed: 10 });
  for (let k = 0; k < 4; k++) {
    const n = len(0.12);
    const s = env(onePoleLP(onePoleHP(noise(n, 20 + k), 200), 2200 + k * 300), 0.002, 0.03);
    const thud = env(sine(n, 90 + k * 10, 50, 0.5), 0.001, 0.025);
    B['step' + k] = norm(mix(s, thud), 0.6);
  }
  B.land = norm(mix(env(onePoleLP(noise(len(0.25), 31), 900), 0.002, 0.07), env(sine(len(0.25), 80, 40), 0.001, 0.06)), 0.8);
  B.jump = norm(env(onePoleLP(noise(len(0.12), 33), 1400), 0.005, 0.03), 0.35);
  const click = (f, seed) => norm(mix(env(onePoleHP(noise(len(0.06), seed), f), 0.0002, 0.006), env(sine(len(0.06), f / 2, f / 3, 0.4), 0.0002, 0.01)), 0.7);
  B.clickA = click(3000, 41); B.clickB = click(2000, 42); B.dry = click(4200, 43);
  B.magOut = norm(mix(click(1500, 44), env(onePoleLP(noise(len(0.15), 45), 1200), 0.01, 0.05)), 0.6);
  B.bolt = norm(mix(click(1800, 46), env(sine(len(0.2), 600, 300, 0.3), 0.01, 0.06)), 0.7);
  B.slash = norm(env(onePoleHP(onePoleLP(noise(len(0.25), 51), 5000), 900), 0.06, 0.08), 0.45);
  B.knifeHit = norm(mix(env(onePoleLP(noise(len(0.2), 52), 700), 0.001, 0.05), env(sine(len(0.2), 200, 80, 0.8), 0.001, 0.05)), 0.8);
  B.knifeWall = norm(mix(env(onePoleHP(noise(len(0.2), 53), 3000), 0.0005, 0.03), env(sine(len(0.3), 2900, 2700, 0.4), 0.001, 0.12)), 0.6);
  B.impact = norm(env(onePoleLP(noise(len(0.1), 61), 3500), 0.0005, 0.02), 0.45);
  B.flesh = norm(mix(env(onePoleLP(noise(len(0.15), 62), 900), 0.001, 0.04), env(sine(len(0.15), 160, 70, 0.7), 0.001, 0.04)), 0.8);
  B.dink = norm(mix(env(sine(len(0.5), 3200, 3150, 0.7), 0.0005, 0.15), env(sine(len(0.5), 4700, 4650, 0.4), 0.0005, 0.1), env(onePoleHP(noise(len(0.05), 63), 4000), 0.0002, 0.005)), 0.8);
  B.hitmark = norm(env(sine(len(0.06), 1800, 1500), 0.0005, 0.015), 0.5);
  B.bounce = norm(mix(env(onePoleHP(noise(len(0.12), 71), 1500), 0.0005, 0.02), env(sine(len(0.12), 700, 500, 0.5), 0.0005, 0.03)), 0.5);
  B.pin = norm(mix(click(3500, 72), env(sine(len(0.3), 5200, 5000, 0.2), 0.01, 0.1)), 0.5);
  B.throw = norm(env(onePoleLP(noise(len(0.3), 73), 2500), 0.05, 0.08), 0.4);
  B.he = (() => { const n = len(2.0); return norm(mix(env(onePoleLP(noise(n, 81), 600), 0.002, 0.5), env(sine(n, 70, 25, 1.4), 0.001, 0.35), env(onePoleHP(noise(n, 82), 2500), 0.0005, 0.05))); })();
  B.flashPop = norm(mix(env(onePoleHP(noise(len(0.6), 83), 1200), 0.0005, 0.06), env(sine(len(0.6), 300, 100), 0.001, 0.1)), 0.9);
  B.smokeHiss = (() => { const n = len(3.0); const h = onePoleHP(noise(n, 84), 2500); for (let i = 0; i < n; i++) { const t = i / SR; h[i] *= Math.min(1, t * 8) * Math.exp(-t * 0.9); } return norm(h, 0.35); })();
  B.ring = (() => { const n = len(3.5); const o = sine(n, 3600, 3550, 1); for (let i = 0; i < n; i++) { const t = i / SR; o[i] *= Math.exp(-t * 0.8) * (0.8 + 0.2 * Math.sin(t * 40)); } return norm(o, 0.25); })();
  B.beep = norm(env(sine(len(0.12), 2600, 2600), 0.002, 0.04), 0.5);
  B.plantBeep = norm(env(square(len(0.1), 1300, 0.5), 0.002, 0.03), 0.3);
  B.defuse = norm(mix(click(2600, 91), env(sine(len(0.1), 900, 900, 0.3), 0.001, 0.02)), 0.5);
  B.c4boom = (() => { const n = len(3.5); return norm(mix(env(onePoleLP(noise(n, 92), 400), 0.003, 1.1), env(sine(n, 55, 20, 1.6), 0.002, 0.8), env(onePoleHP(noise(n, 93), 1800), 0.001, 0.12))); })();
  B.pickup = norm(mix(click(2200, 94), click(1600, 95)), 0.5);
  B.zoom = norm(mix(click(3800, 96), env(onePoleHP(noise(len(0.08), 97), 5000), 0.003, 0.02)), 0.4);
  B.ui = norm(env(sine(len(0.05), 1200, 1500), 0.002, 0.012), 0.3);
  B.buy = norm(mix(env(sine(len(0.15), 900, 900, 0.5), 0.002, 0.04), env(sine(len(0.15), 1350, 1350, 0.4), 0.05, 0.05)), 0.45);
  B.deny = norm(env(square(len(0.15), 180, 0.6), 0.002, 0.05), 0.35);
  B.hurt = norm(mix(env(onePoleLP(noise(len(0.2), 98), 500), 0.002, 0.06), env(sine(len(0.2), 120, 60, 0.8), 0.001, 0.05)), 0.7);
  const chord = (fs, d, seed) => { const n = len(d); const parts = fs.map((f, i) => env(sine(n, f, f, 0.5), 0.02 + i * 0.03, d * 0.6)); return norm(mix(...parts), 0.5); };
  B.win = chord([523, 659, 784, 1046], 1.6, 1);
  B.lose = chord([392, 311, 262], 1.6, 2);
  B.roundStart = chord([440, 660], 0.6, 3);
  B.killConfirm = norm(mix(env(sine(len(0.2), 1100, 1300, 0.5), 0.002, 0.05), env(sine(len(0.2), 1650, 1700, 0.3), 0.03, 0.05)), 0.45);
  return B;
}

const SHOT_SOUND = { rifle: 'rifle', rifle_s: 'rifle_s', pistol: 'pistol', pistol_s: 'pistol_s', deagle: 'deagle', smg: 'smg', sniper: 'sniper', awp: 'awp' };

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.volume = 0.8;
    this.quality = 'low';
    this.voices = 0;
    this.maxVoices = 28;
    this.muffle = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume;
    this.lowpass = c.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 20000;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master.connect(this.lowpass); this.lowpass.connect(this.comp); this.comp.connect(c.destination);
    this.ringGain = c.createGain(); this.ringGain.gain.value = 0; this.ringGain.connect(c.destination);
    const bank = buildBank();
    for (const [k, data] of Object.entries(bank)) {
      const b = c.createBuffer(1, data.length, SR);
      b.copyToChannel(data, 0);
      this.buffers[k] = b;
    }
    if (c.state === 'suspended') c.resume();
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  setListener(x, y, z, fx, fy, fz) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(x, t); l.positionY.setValueAtTime(y, t); l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z); l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
    this.lx = x; this.ly = y; this.lz = z;
  }

  _src(name, vol, rate) {
    const b = this.buffers[name];
    if (!b || this.voices >= this.maxVoices) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(g);
    this.voices++;
    s.onended = () => { this.voices--; try { g.disconnect(); } catch { /* ignore */ } };
    return { s, g };
  }

  play(name, vol = 1, rate = 1) {
    if (!this.ctx) return;
    const v = this._src(name, vol, rate * (0.97 + Math.random() * 0.06));
    if (!v) return;
    v.g.connect(this.master);
    v.s.start();
  }

  play3D(name, x, y, z, vol = 1, rate = 1, opts = {}) {
    if (!this.ctx) return;
    const d = Math.hypot(x - (this.lx || 0), y - (this.ly || 0), z - (this.lz || 0));
    if (d > (opts.maxDist || 3500)) return;
    const v = this._src(name, vol, rate * (0.96 + Math.random() * 0.08));
    if (!v) return;
    const p = this.ctx.createPanner();
    p.panningModel = this.quality === 'low' ? 'equalpower' : 'HRTF';
    p.distanceModel = 'inverse'; p.refDistance = opts.ref || 180; p.rolloffFactor = opts.rolloff || 1.1; p.maxDistance = 5000;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    let node = v.g;
    if (opts.occluded) {
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      node.connect(f); node = f;
    }
    node.connect(p); p.connect(this.master);
    v.s.onended = () => { this.voices--; try { p.disconnect(); v.g.disconnect(); } catch { /* ignore */ } };
    v.s.start();
  }

  shot(sound, x, y, z, local, occluded) {
    const name = SHOT_SOUND[sound] || 'rifle';
    if (local) this.play(name, 0.75);
    else this.play3D(name, x, y, z, 1.0, 1, { ref: name.endsWith('_s') ? 120 : 400, rolloff: 0.9, maxDist: 6000, occluded });
  }

  // Flashbang ear ringing: muffle world + ring tone
  flashRing(amount) {
    if (!this.ctx || amount <= 0) return;
    const t = this.ctx.currentTime;
    this.lowpass.frequency.cancelScheduledValues(t);
    this.lowpass.frequency.setValueAtTime(400 + (1 - amount) * 4000, t);
    this.lowpass.frequency.exponentialRampToValueAtTime(20000, t + 1 + amount * 3.5);
    const v = this._src('ring', amount * 0.6, 1);
    if (v) { v.g.connect(this.ringGain); this.ringGain.gain.setValueAtTime(1, t); v.s.start(); }
  }
}
