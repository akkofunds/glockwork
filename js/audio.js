// audio.js — Fully synthesized weapon SFX via the Web Audio API.
// No sample files to ship/load: every sound is built from oscillators and
// filtered noise at play-time, generated fresh (and cheaply) per call.

const AudioFX = {
  ctx: null,

  _ensureCtx() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  _noiseBuffer(ctx, duration) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  },

  // Sharp crack + low thump — a 9mm-ish pop, not a cartoon "pew".
  playShot(volume = 1) {
    const ctx = this._ensureCtx();
    const t0 = ctx.currentTime;

    // Crack: short filtered noise burst
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(ctx, 0.12);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.value = 2400;
    crackFilter.Q.value = 0.7;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.9 * volume, t0);
    crackGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    noise.connect(crackFilter).connect(crackGain).connect(ctx.destination);
    noise.start(t0); noise.stop(t0 + 0.12);

    // Thump: quick low-frequency sine for body/punch
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.08);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.8 * volume, t0);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.12);

    // Tiny distant tail (room slap) so single shots don't feel dry
    const tail = ctx.createBufferSource();
    tail.buffer = this._noiseBuffer(ctx, 0.18);
    const tailFilter = ctx.createBiquadFilter();
    tailFilter.type = 'lowpass';
    tailFilter.frequency.value = 900;
    const tailGain = ctx.createGain();
    tailGain.gain.setValueAtTime(0.0, t0);
    tailGain.gain.linearRampToValueAtTime(0.12 * volume, t0 + 0.02);
    tailGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    tail.connect(tailFilter).connect(tailGain).connect(ctx.destination);
    tail.start(t0); tail.stop(t0 + 0.2);
  },

  // Metallic mechanical click — slide release, mag seat, inspect taps.
  playClick(pitch = 1, volume = 0.6) {
    const ctx = this._ensureCtx();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(900 * pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(300 * pitch, t0 + 0.03);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5 * volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.05);
  },

  // Low thunk — magazine dropping free / seating home.
  playThunk(volume = 0.7) {
    const ctx = this._ensureCtx();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.09);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6 * volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.13);
  },

  // Empty-mag dry fire click.
  playDryFire() {
    this.playClick(1.6, 0.4);
  },
};
