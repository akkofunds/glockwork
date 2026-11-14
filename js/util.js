// Shared math, RNG and binary serialization helpers (no allocations in hot paths where avoidable).

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

// Mulberry32 — deterministic per-shot RNG shared by host and client so spread matches exactly.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashSeed = (a, b, c = 0) => (Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663) ^ Math.imul(c + 1, 83492791)) >>> 0;

// Forward vector for yaw/pitch (yaw 0 looks toward -Z, positive pitch looks up)
export function angleToDir(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

export function randomCode(len = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += chars[buf[i] % chars.length];
  return s;
}

export class BinaryWriter {
  constructor(size = 2048) { this.buf = new ArrayBuffer(size); this.dv = new DataView(this.buf); this.o = 0; }
  reset() { this.o = 0; return this; }
  ensure(n) {
    if (this.o + n <= this.buf.byteLength) return;
    const nb = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = nb; this.dv = new DataView(nb);
  }
  u8(v) { this.ensure(1); this.dv.setUint8(this.o, v); this.o += 1; }
  u16(v) { this.ensure(2); this.dv.setUint16(this.o, v, true); this.o += 2; }
  i16(v) { this.ensure(2); this.dv.setInt16(this.o, clamp(Math.round(v), -32768, 32767), true); this.o += 2; }
  u32(v) { this.ensure(4); this.dv.setUint32(this.o, v >>> 0, true); this.o += 4; }
  f32(v) { this.ensure(4); this.dv.setFloat32(this.o, v, true); this.o += 4; }
  f64(v) { this.ensure(8); this.dv.setFloat64(this.o, v, true); this.o += 8; }
  str(s) {
    const b = textEncoder.encode(s);
    this.u32(b.length); this.ensure(b.length);
    new Uint8Array(this.buf, this.o, b.length).set(b); this.o += b.length;
  }
  result() { return this.buf.slice(0, this.o); }
}
export class BinaryReader {
  constructor(buf) { this.dv = new DataView(buf); this.buf = buf; this.o = 0; }
  u8() { const v = this.dv.getUint8(this.o); this.o += 1; return v; }
  u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  i16() { const v = this.dv.getInt16(this.o, true); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.o, true); this.o += 8; return v; }
  str() { const n = this.u32(); const s = textDecoder.decode(new Uint8Array(this.buf, this.o, n)); this.o += n; return s; }
}
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function deepClone(o) {
  if (o === null || typeof o !== 'object') return o;
  if (Array.isArray(o)) return o.map(deepClone);
  const r = {};
  for (const k in o) r[k] = deepClone(o[k]);
  return r;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const isTouchDevice = () => (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
export const isLowEndDevice = () => {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const cros = /CrOS/.test(ua);
  const android = /Android/.test(ua);
  const weak = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4;
  return ios || cros || android || weak;
};

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
