// Pre-allocated, zero-GC effect pools: tracers, impact decals, dust/blood particles, brass shells,
// remote muzzle flashes, volumetric smoke clouds, explosions, grenade projectiles and the C4 model.
import * as THREE from 'three';
import { WEAPONS } from '../config.js';

function radialTexture(stops, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function holeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(10,8,6,1)'); g.addColorStop(0.18, 'rgba(25,20,15,0.95)'); g.addColorStop(0.35, 'rgba(60,45,30,0.55)'); g.addColorStop(1, 'rgba(60,45,30,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(30,22,14,0.5)';
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.3; x.beginPath(); x.moveTo(32, 32); x.lineTo(32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function smokeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const px = 30 + Math.random() * 68, py = 30 + Math.random() * 68, r = 18 + Math.random() * 30;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(235,235,232,0.32)'); g.addColorStop(1, 'rgba(235,235,232,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
const _hide = new THREE.Matrix4().makeScale(0, 0, 0);
const _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

export class Effects {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    // --- tracers ---
    this.maxTracers = 48;
    const tg = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(this.maxTracers * 6);
    this.tracerCol = new Float32Array(this.maxTracers * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracerLines.frustumCulled = false;
    this.tracers = Array.from({ length: this.maxTracers }, () => ({ life: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, speed: 0, dist: 0, t: 0 }));
    this.tracerIdx = 0;
    scene.add(this.tracerLines);

    // --- decals ---
    this.maxDecals = quality === 'low' ? 96 : 192;
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), this.maxDecals);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.maxDecals; i++) this.decals.setMatrixAt(i, _hide);
    this.decals.frustumCulled = false;
    this.decalIdx = 0;
    scene.add(this.decals);

    // --- particles (dust, blood, sparks) as camera-facing instanced quads ---
    this.maxParticles = quality === 'low' ? 96 : 192;
    const pm = new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]), transparent: true, depthWrite: false });
    this.particles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), pm, this.maxParticles);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParticles * 3), 3);
    this.particles.frustumCulled = false;
    this.parts = Array.from({ length: this.maxParticles }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, g: 0 }));
    this.partIdx = 0;
    for (let i = 0; i < this.maxParticles; i++) this.particles.setMatrixAt(i, _hide);
    scene.add(this.particles);

    // --- shells ---
    this.maxShells = 24;
    this.shellMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 6), new THREE.MeshLambertMaterial({ color: 0xc89b3c, emissive: 0x2a1a00 }), this.maxShells);
    this.shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shellMesh.frustumCulled = false;
    this.shells = Array.from({ length: this.maxShells }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, floor: 0, spin: 0 }));
    this.shellIdx = 0;
    for (let i = 0; i < this.maxShells; i++) this.shellMesh.setMatrixAt(i, _hide);
    scene.add(this.shellMesh);

    // --- remote muzzle flashes ---
    const flashTex = radialTexture([[0, 'rgba(255,250,220,1)'], [0.3, 'rgba(255,200,90,0.9)'], [1, 'rgba(255,120,20,0)']]);
    this.flashes = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; s.userData.life = 0;
      scene.add(s); this.flashes.push(s);
    }
    this.flashIdx = 0;

    // --- smoke clouds ---
    this.smokeTex = smokeTexture();
    this.smokeMat = new THREE.MeshLambertMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, color: 0xd8d8d4, emissive: 0x3a3a38, side: THREE.DoubleSide });
    this.puffsPerSmoke = quality === 'low' ? 18 : 30;
    this.smokes = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.smokeMat, this.puffsPerSmoke);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; m.visible = false; m.renderOrder = 5;
      const puffs = Array.from({ length: this.puffsPerSmoke }, () => ({ ox: 0, oy: 0, oz: 0, size: 0, rot: 0, rs: 0 }));
      scene.add(m);
      this.smokes.push({ mesh: m, puffs, active: false, x: 0, y: 0, z: 0, start: 0, end: 0, id: 0 });
    }

    // --- explosion flash ---
    this.boom = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, 'rgba(255,255,230,1)'], [0.25, 'rgba(255,190,80,0.95)'], [0.6, 'rgba(200,80,20,0.4)'], [1, 'rgba(80,30,10,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.boom.visible = false; this.boomT = 0; this.boomSize = 300;
    scene.add(this.boom);

    // --- grenade projectiles ---
    this.nadeMeshes = new Map();
    this.camera = null;
  }

  setNadeFactory(f) { this.nadeFactory = f; }

  tracer(ax, ay, az, bx, by, bz, color = [1, 0.85, 0.5]) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.maxTracers;
    t.ax = ax; t.ay = ay; t.az = az; t.bx = bx; t.by = by; t.bz = bz;
    t.dist = Math.hypot(bx - ax, by - ay, bz - az);
    t.t = 0; t.life = 1; t.col = color;
  }

  decal(x, y, z, nx, ny, nz) {
    _p.set(x + nx * 0.15, y + ny * 0.15, z + nz * 0.15);
    _q.setFromUnitVectors(_z, _s.set(nx, ny, nz));
    _q.multiply(_q2.setFromAxisAngle(_z, Math.random() * Math.PI * 2));
    const sc = 0.8 + Math.random() * 0.5;
    _m.compose(_p, _q, _s.set(sc, sc, sc));
    this.decals.setMatrixAt(this.decalIdx, _m);
    this.decalIdx = (this.decalIdx + 1) % this.maxDecals;
    this.decals.instanceMatrix.needsUpdate = true;
  }
  clearDecals() {
    for (let i = 0; i < this.maxDecals; i++) this.decals.setMatrixAt(i, _hide);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  particle(x, y, z, vx, vy, vz, life, size, grow, r, g, b, gravity = 0) {
    const i = this.partIdx;
    this.partIdx = (this.partIdx + 1) % this.maxParticles;
    const p = this.parts[i];
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.size = size; p.grow = grow; p.g = gravity;
    this.particles.instanceColor.setXYZ(i, r, g, b);
    this.particles.instanceColor.needsUpdate = true;
  }

  impact(x, y, z, nx, ny, nz, thin) {
    this.decal(x, y, z, nx, ny, nz);
    const n = this.quality === 'low' ? 3 : 6;
    for (let i = 0; i < n; i++) {
      this.particle(x, y, z, nx * 40 + (Math.random() - 0.5) * 60, ny * 40 + Math.random() * 50, nz * 40 + (Math.random() - 0.5) * 60, 0.5 + Math.random() * 0.4, 3 + Math.random() * 3, 14, thin ? 0.55 : 0.78, thin ? 0.42 : 0.68, thin ? 0.28 : 0.52, 120);
    }
    this.particle(x, y, z, 0, 0, 0, 0.08, 4, 30, 1, 0.85, 0.5);
  }

  blood(x, y, z, dx, dz, hs) {
    const n = hs ? 9 : 5;
    for (let i = 0; i < n; i++) this.particle(x, y, z, dx * 80 + (Math.random() - 0.5) * 70, Math.random() * 60, dz * 80 + (Math.random() - 0.5) * 70, 0.35 + Math.random() * 0.3, 3 + Math.random() * 3, 10, 0.55, 0.04, 0.04, 300);
    if (hs) this.particle(x, y, z, 0, 10, 0, 0.5, 6, 20, 0.6, 0.06, 0.05, 0);
  }

  shell(x, y, z, vx, vy, vz, floorY) {
    const s = this.shells[this.shellIdx];
    this.shellIdx = (this.shellIdx + 1) % this.maxShells;
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz; s.life = 2.5; s.floor = floorY; s.rx = Math.random() * 6; s.ry = Math.random() * 6; s.spin = 15 + Math.random() * 10;
  }

  muzzle(x, y, z, size = 14) {
    const s = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    s.position.set(x, y, z); s.scale.set(size, size, size); s.visible = true; s.userData.life = 0.05;
    s.material.rotation = Math.random() * Math.PI * 2;
  }

  explosion(x, y, z) {
    this.boom.position.set(x, y + 20, z); this.boom.visible = true; this.boomT = 0.45;
    for (let i = 0; i < (this.quality === 'low' ? 14 : 28); i++) {
      const a = Math.random() * Math.PI * 2, s = 100 + Math.random() * 220;
      this.particle(x, y + 10, z, Math.cos(a) * s, 60 + Math.random() * 200, Math.sin(a) * s, 0.8 + Math.random() * 0.8, 16 + Math.random() * 18, 40, 0.35, 0.3, 0.26, 150);
    }
  }
  bigExplosion(x, y, z) {
    this.explosion(x, y, z); this.boomSize = 900;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, s = 200 + Math.random() * 500;
      this.particle(x, y + 10, z, Math.cos(a) * s, 100 + Math.random() * 400, Math.sin(a) * s, 1.5 + Math.random(), 40 + Math.random() * 40, 60, 0.3, 0.27, 0.24, 100);
    }
  }

  startSmoke(id, x, y, z, startTime, endTime) {
    let s = this.smokes.find((q) => !q.active) || this.smokes.reduce((a, b) => (a.start < b.start ? a : b));
    s.active = true; s.id = id; s.x = x; s.y = y; s.z = z; s.start = startTime; s.end = endTime;
    s.mesh.visible = true;
    for (const p of s.puffs) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 105;
      p.ox = Math.cos(a) * r; p.oz = Math.sin(a) * r; p.oy = -30 + Math.random() * 95 - r * 0.15;
      p.size = 95 + Math.random() * 70; p.rot = Math.random() * 6; p.rs = (Math.random() - 0.5) * 0.15;
    }
  }
  clearSmokes() { for (const s of this.smokes) { s.active = false; s.mesh.visible = false; } }

  // nades: {id, type, x,y,z}
  syncNades(nades) {
    const seen = new Set();
    for (const g of nades) {
      seen.add(g.id);
      let m = this.nadeMeshes.get(g.id);
      if (!m && this.nadeFactory) { m = this.nadeFactory(g.type); this.scene.add(m); this.nadeMeshes.set(g.id, m); }
      if (m) { m.position.set(g.x, g.y, g.z); m.rotation.x += 0.2; m.rotation.z += 0.13; }
    }
    for (const [id, m] of this.nadeMeshes) if (!seen.has(id)) { this.scene.remove(m); this.nadeMeshes.delete(id); }
  }

  update(dt, camera, now) {
    // tracers
    const tp = this.tracerPos, tc = this.tracerCol;
    for (let i = 0; i < this.maxTracers; i++) {
      const t = this.tracers[i];
      const o = i * 6;
      if (t.life <= 0) { tp[o] = tp[o + 1] = tp[o + 2] = tp[o + 3] = tp[o + 4] = tp[o + 5] = 0; continue; }
      t.t += dt * 9000;
      const head = Math.min(t.dist, t.t), tail = Math.max(0, head - 380);
      if (tail >= t.dist) { t.life = 0; continue; }
      const k0 = tail / t.dist, k1 = head / t.dist;
      tp[o] = t.ax + (t.bx - t.ax) * k0; tp[o + 1] = t.ay + (t.by - t.ay) * k0; tp[o + 2] = t.az + (t.bz - t.az) * k0;
      tp[o + 3] = t.ax + (t.bx - t.ax) * k1; tp[o + 4] = t.ay + (t.by - t.ay) * k1; tp[o + 5] = t.az + (t.bz - t.az) * k1;
      const c = t.col;
      tc[o] = c[0] * 0.15; tc[o + 1] = c[1] * 0.15; tc[o + 2] = c[2] * 0.15; tc[o + 3] = c[0]; tc[o + 4] = c[1]; tc[o + 5] = c[2];
    }
    this.tracerLines.geometry.attributes.position.needsUpdate = true;
    this.tracerLines.geometry.attributes.color.needsUpdate = true;

    // particles (billboards)
    const cq = camera.quaternion;
    let any = false;
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      if (p.life <= 0) { this.particles.setMatrixAt(i, _hide); continue; }
      p.vy -= p.g * dt;
      p.vx *= 1 - dt * 2.5; p.vz *= 1 - dt * 2.5;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = p.life / p.max;
      const sz = (p.size + p.grow * (1 - k)) * Math.min(1, k * 3);
      _m.compose(_p.set(p.x, p.y, p.z), cq, _s.set(sz, sz, sz));
      this.particles.setMatrixAt(i, _m);
    }
    if (any) this.particles.instanceMatrix.needsUpdate = true;

    // shells
    let anyShell = false;
    for (let i = 0; i < this.maxShells; i++) {
      const s = this.shells[i];
      if (s.life <= 0) continue;
      anyShell = true;
      s.life -= dt;
      if (s.life <= 0) { this.shellMesh.setMatrixAt(i, _hide); continue; }
      s.vy -= 800 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < s.floor + 0.3) { s.y = s.floor + 0.3; s.vy = Math.abs(s.vy) * 0.35; s.vx *= 0.6; s.vz *= 0.6; s.spin *= 0.6; }
      s.rx += s.spin * dt; s.ry += s.spin * 0.7 * dt;
      _q.setFromEuler(_e.set(s.rx, s.ry, Math.PI / 2));
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(1, 1, 1));
      this.shellMesh.setMatrixAt(i, _m);
    }
    if (anyShell) this.shellMesh.instanceMatrix.needsUpdate = true;

    for (const f of this.flashes) if (f.visible) { f.userData.life -= dt; if (f.userData.life <= 0) f.visible = false; }
    if (this.boom.visible) {
      this.boomT -= dt;
      const k = Math.max(0, this.boomT / 0.45);
      const s = this.boomSize * (1.2 - k * 0.6);
      this.boom.scale.set(s, s, s); this.boom.material.opacity = k;
      if (this.boomT <= 0) { this.boom.visible = false; this.boomSize = 300; }
    }

    // smokes
    for (const s of this.smokes) {
      if (!s.active) continue;
      const age = now - s.start, left = s.end - now;
      if (left <= -2) { s.active = false; s.mesh.visible = false; continue; }
      const grow = Math.min(1, age / 1.4);
      const fade = Math.max(0, Math.min(1, (left + 2) / 3));
      let idx = 0;
      for (const p of s.puffs) {
        p.rot += p.rs * dt;
        const sz = p.size * (0.3 + 0.7 * grow) * (0.6 + 0.4 * fade);
        _q.copy(cq).multiply(_q2.setFromAxisAngle(_z, p.rot));
        _m.compose(_p.set(s.x + p.ox * grow, s.y + p.oy * grow + age * 0.6, s.z + p.oz * grow), _q, _s.set(sz, sz, sz));
        s.mesh.setMatrixAt(idx++, _m);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
      this.smokeMat.opacity = 1;
    }
  }

  // Fraction 0..1 of how deep the camera is inside a smoke (for screen overlay)
  smokeCover(x, y, z, now) {
    let best = 0;
    for (const s of this.smokes) {
      if (!s.active) continue;
      const grow = Math.min(1, (now - s.start) / 1.4);
      const left = s.end - now;
      const d = Math.hypot(x - s.x, (y - s.y) * 1.3, z - s.z);
      const r = 150 * grow * Math.max(0, Math.min(1, (left + 1) / 2.5));
      if (r > 0 && d < r) best = Math.max(best, 1 - d / r);
    }
    return best;
  }
}

export function c4Mesh(lib) {
  const m = lib.get('c4');
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.45, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  led.position.set(1.6, 1.6, -3.2); led.name = 'led';
  m.add(led);
  return m;
}
export const isGrenade = (id) => WEAPONS[id]?.cls === 'grenade';
