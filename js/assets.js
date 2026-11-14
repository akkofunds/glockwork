// Universal .glb asset pipeline: loading (Draco), IndexedDB persistence of user files, weapon normalisation
// (orientation, real-world length, grip anchor), mesh merging per material (1 draw call per material),
// soldier normalisation (72u tall, grounded, facing -Z) and an automatic humanoid rig for static meshes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPON_LENGTH, SOLDIER_HEIGHT } from './config.js';

export const THREE_VERSION = '0.170.0';
export const SLOTS = ['map', 'soldier', 'ak47', 'awp', 'glock17', 'knife'];
export const SLOT_LABEL = { map: 'Map', soldier: 'Soldier', ak47: 'AK-47', awp: 'Sniper / AWP', glock17: 'Glock-17', knife: 'Knife' };

// Bundled defaults (Draco-compressed copies of the provided weapon models)
const DEFAULT_URL = { ak47: 'assets/models/ak47.glb', awp: 'assets/models/awp.glb', glock17: 'assets/models/glock17.glb', knife: 'assets/models/knife.glb' };
// Calibrated orientation for the bundled files: yaw (deg) so the muzzle points -Z, grip anchor [fromRear, fromBottom]
const BUNDLED_CAL = {
  ak47: { yaw: 90, grip: [0.33, 0.6], left: [0.66, 0.62] },
  glock17: { yaw: 90, grip: [0.1, 0.36], left: [0.1, 0.3], length: 13.5 },
  awp: { yaw: 180, grip: [0.22, 0.3], left: [0.5, 0.4] },
  knife: { yaw: -90, grip: [0.16, 0.5], left: null },
};
export const DEFAULT_TUNE = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, scale: 1 };

// ------------- persistence -------------
const DB_NAME = 'flashpoint-assets';
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function idbPut(key, value) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) { console.warn('IndexedDB put failed', e); }
}
export async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => { const tx = db.transaction('files', 'readonly'); const q = tx.objectStore('files').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  } catch { return null; }
}
export async function idbDel(key) {
  try {
    const db = await idb();
    await new Promise((res) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(key); tx.oncomplete = res; tx.onerror = res; });
  } catch { /* ignore */ }
}

export async function hashBytes(buf) {
  try {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    const u = new Uint8Array(buf); let h = 2166136261;
    for (let i = 0; i < u.length; i += 7) { h ^= u[i]; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16) + '_' + u.length;
  }
}

function loadConfig() {
  try { return JSON.parse(localStorage.getItem('fp_assets') || '{}'); } catch { return {}; }
}
function saveConfig(c) { try { localStorage.setItem('fp_assets', JSON.stringify(c)); } catch { /* ignore */ } }

// ------------- loader -------------
let _loader = null;
export function gltfLoader() {
  if (_loader) return _loader;
  _loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(`https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/libs/draco/gltf/`);
  _loader.setDRACOLoader(draco);
  return _loader;
}
export function parseGLB(bytes) {
  return new Promise((resolve, reject) => gltfLoader().parse(bytes, '', resolve, reject));
}

// Convert materials for the preset; keeps textures.
function downscaleTexture(tex, max) {
  const img = tex && tex.image;
  if (!img || !(img.width > max)) return tex;
  try {
    const k = max / Math.max(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const t = tex.clone();
    t.image = c;
    t.needsUpdate = true;
    return t;
  } catch { return tex; }
}

export function adaptMaterial(m, quality) {
  if (!m) return m;
  if (quality === 'low' && !m.isMeshLambertMaterial && !m.isMeshBasicMaterial) {
    // Competitive Low: Lambert shading, base colour only, textures capped at 1024 to fit 2 GB phones/Chromebooks
    const l = new THREE.MeshLambertMaterial({
      map: m.map ? downscaleTexture(m.map, 1024) : null, color: m.color ? m.color.clone() : 0xffffff, transparent: m.transparent, opacity: m.opacity,
      alphaTest: m.alphaTest || (m.transparent ? 0.3 : 0), side: m.side, vertexColors: !!m.vertexColors,
    });
    if (m.emissive) { l.emissive = m.emissive.clone(); l.emissiveMap = m.emissiveMap || null; }
    l.name = m.name;
    return l;
  }
  if (m.isMeshStandardMaterial && m.metalness > 0.6 && !m.metalnessMap) m.metalness = 0.6;
  return m;
}

// Gather all meshes in world space, grouped by material, merged into indexed geometries.
function bakeMeshes(root, quality, keepAttrs = ['position', 'normal', 'uv']) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const bones = {};
  root.traverse((o) => {
    if (o.isBone) { bones[o.name] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); }
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let g = o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!keepAttrs.includes(name)) g.deleteAttribute(name);
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    // de-quantize attributes
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name];
      if (a.isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array)) {
        const arr = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent ? a.getComponent(i, k) : a.array[i * a.itemSize + k];
        g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
      }
    }
    if (!g.index) { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); }
    g.applyMatrix4(o.matrixWorld);
    const groupsInGeo = g.groups.length ? g.groups : [{ start: 0, count: g.index.count, materialIndex: 0 }];
    for (const gr of groupsInGeo) {
      const m = mats[gr.materialIndex || 0] || mats[0];
      let sub = g;
      if (groupsInGeo.length > 1) {
        sub = g.clone();
        sub.setIndex(Array.from(g.index.array.slice(gr.start, gr.start + gr.count)));
        sub.clearGroups();
      }
      const key = m ? m.uuid : 'none';
      if (!groups.has(key)) groups.set(key, { material: m, geos: [] });
      groups.get(key).geos.push(sub);
    }
  });
  const out = [];
  for (const { material, geos } of groups.values()) {
    let merged;
    try { merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false); } catch { merged = null; }
    if (!merged) { for (const gg of geos) out.push({ geometry: gg, material: adaptMaterial(material, quality) }); continue; }
    out.push({ geometry: merged, material: adaptMaterial(material, quality) });
  }
  return { parts: out, bones };
}

function boxOf(parts) {
  const b = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); b.union(p.geometry.boundingBox); }
  return b;
}

// Heuristic muzzle detection: the thinner end of the longest horizontal axis is the muzzle.
function detectYaw(parts) {
  const b = boxOf(parts);
  const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
  const axis = sx >= sz ? 'x' : 'z';
  const lo = axis === 'x' ? b.min.x : b.min.z, hi = axis === 'x' ? b.max.x : b.max.z;
  const len = hi - lo;
  let loMin = Infinity, loMax = -Infinity, hiMin = Infinity, hiMax = -Infinity;
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const a = axis === 'x' ? pos.getX(i) : pos.getZ(i), y = pos.getY(i);
      if (a < lo + len * 0.15) { loMin = Math.min(loMin, y); loMax = Math.max(loMax, y); }
      if (a > hi - len * 0.15) { hiMin = Math.min(hiMin, y); hiMax = Math.max(hiMax, y); }
    }
  }
  const muzzleHigh = (hiMax - hiMin) < (loMax - loMin);
  if (axis === 'x') return muzzleHigh ? 90 : -90; // +X muzzle -> rotate +90 to face -Z
  return muzzleHigh ? 180 : 0;
}

/*
  Build a normalised weapon template from glTF scene.
  Returns THREE.Group whose child "inner" holds merged meshes; userData.meta has muzzle/left/eject anchors.
*/
export function normalizeWeapon(scene, key, quality, calibration) {
  const { parts } = bakeMeshes(scene, quality);
  const cal = calibration || {};
  const yaw = cal.yaw !== undefined ? cal.yaw : detectYaw(parts);
  const rot = new THREE.Matrix4().makeRotationY(yaw * Math.PI / 180);
  for (const p of parts) p.geometry.applyMatrix4(rot);
  let b = boxOf(parts);
  const len = b.max.z - b.min.z;
  const target = cal.length || WEAPON_LENGTH[key] || 30;
  const s = target / (len || 1);
  const sm = new THREE.Matrix4().makeScale(s, s, s);
  for (const p of parts) p.geometry.applyMatrix4(sm);
  b = boxOf(parts);
  const L = b.max.z - b.min.z, H = b.max.y - b.min.y;
  const grip = cal.grip || (key === 'knife' ? [0.16, 0.5] : (target < 16 ? [0.15, 0.35] : [0.3, 0.45]));
  const gx = (b.min.x + b.max.x) / 2, gy = b.min.y + H * grip[1], gz = b.max.z - L * grip[0];
  const tm = new THREE.Matrix4().makeTranslation(-gx, -gy, -gz);
  for (const p of parts) { p.geometry.applyMatrix4(tm); p.geometry.computeBoundingSphere(); p.geometry.computeBoundingBox(); }
  b = boxOf(parts);
  const inner = new THREE.Group();
  inner.name = 'inner';
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.castShadow = true;
    inner.add(m);
  }
  const group = new THREE.Group();
  group.add(inner);
  const leftFrac = cal.left === undefined ? (key === 'knife' ? null : target < 16 ? [0.1, 0.3] : [0.62, 0.55]) : cal.left;
  group.userData.meta = {
    muzzle: new THREE.Vector3(0, b.min.y + (b.max.y - b.min.y) * (key === 'knife' ? 0.5 : 0.72), b.min.z),
    left: leftFrac ? (target < 16 ? new THREE.Vector3(-0.9, -0.6, 0.4) : new THREE.Vector3(0, b.min.y + H * leftFrac[1] - 0, b.max.z - L * leftFrac[0])) : null,
    eject: new THREE.Vector3(b.max.x, b.max.y * 0.6, b.min.z + L * 0.55),
    length: L,
  };
  return group;
}

export function applyTune(group, tune) {
  const t = { ...DEFAULT_TUNE, ...(tune || {}) };
  const inner = group.getObjectByName('inner') || group.children[0];
  if (!inner) return;
  inner.position.set(t.x, t.y, t.z);
  inner.rotation.set(t.pitch * Math.PI / 180, t.yaw * Math.PI / 180, t.roll * Math.PI / 180, 'YXZ');
  inner.scale.setScalar(t.scale);
}

// ---------------- soldier -----------------
const BONE_ALIASES = {
  handR: ['righthand', 'hand_r', 'mixamorigrighthand', 'r_hand', 'hand.r', 'bip01_r_hand', 'valvebiped.bip01_r_hand'],
  handL: ['lefthand', 'hand_l', 'mixamoriglefthand', 'l_hand', 'hand.l', 'bip01_l_hand', 'valvebiped.bip01_l_hand'],
  elbowR: ['rightforearm', 'lowerarm_r', 'mixamorigrightforearm', 'forearm.r', 'bip01_r_forearm'],
  elbowL: ['leftforearm', 'lowerarm_l', 'mixamorigleftforearm', 'forearm.l', 'bip01_l_forearm'],
  shoulderR: ['rightarm', 'upperarm_r', 'mixamorigrightarm', 'upper_arm.r', 'bip01_r_upperarm'],
  shoulderL: ['leftarm', 'upperarm_l', 'mixamorigleftarm', 'upper_arm.l', 'bip01_l_upperarm'],
  hipR: ['rightupleg', 'thigh_r', 'mixamorigrightupleg', 'thigh.r', 'bip01_r_thigh'],
  hipL: ['leftupleg', 'thigh_l', 'mixamorigleftupleg', 'thigh.l', 'bip01_l_thigh'],
  kneeR: ['rightleg', 'calf_r', 'mixamorigrightleg', 'shin.r', 'bip01_r_calf'],
  kneeL: ['leftleg', 'calf_l', 'mixamorigleftleg', 'shin.l', 'bip01_l_calf'],
  footR: ['rightfoot', 'foot_r', 'mixamorigrightfoot', 'foot.r', 'bip01_r_foot'],
  footL: ['leftfoot', 'foot_l', 'mixamorigleftfoot', 'foot.l', 'bip01_l_foot'],
};
function findBone(bones, key) {
  const want = BONE_ALIASES[key];
  for (const name of Object.keys(bones)) {
    const n = name.toLowerCase().replace(/[:\s]/g, '');
    if (want.some((w) => n === w || n.endsWith(w))) return bones[name];
  }
  return null;
}

/*
  Normalise a soldier glTF into merged parts: 72u tall, feet at y=0, facing -Z.
  Returns { parts:[{geometry,material}], joints } where joints are estimated rig joint positions.
*/
export function normalizeSoldier(scene, quality, faceFlip = true) {
  const { parts, bones } = bakeMeshes(scene, quality);
  let b = boxOf(parts);
  const h = b.max.y - b.min.y || 1;
  const s = SOLDIER_HEIGHT / h;
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const m = new THREE.Matrix4().makeTranslation(-cx, -b.min.y, -cz);
  m.premultiply(new THREE.Matrix4().makeScale(s, s, s));
  if (faceFlip) m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
  for (const p of parts) { p.geometry.applyMatrix4(m); p.geometry.computeBoundingBox(); p.geometry.computeBoundingSphere(); }
  for (const k of Object.keys(bones)) bones[k].applyMatrix4(m);
  b = boxOf(parts);
  const joints = estimateJoints(parts, bones);
  return { parts, joints };
}

function estimateJoints(parts, bones) {
  const H = SOLDIER_HEIGHT;
  // hand extremes
  let maxR = 0, maxL = 0;
  const all = [];
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) all.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  for (let i = 0; i < all.length; i += 3) {
    const x = all[i], y = all[i + 1];
    if (y < H * 0.3 || y > H * 0.95) continue;
    if (x > maxR) maxR = x; if (-x > maxL) maxL = -x;
  }
  const avg = (filter) => {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = 0; i < all.length; i += 3) if (filter(all[i], all[i + 1], all[i + 2])) { sx += all[i]; sy += all[i + 1]; sz += all[i + 2]; n++; }
    return n ? new THREE.Vector3(sx / n, sy / n, sz / n) : null;
  };
  const handR = avg((x, y) => x > maxR * 0.9 && y > H * 0.3 && y < H * 0.95) || new THREE.Vector3(10, 30, 0);
  const handL = avg((x, y) => -x > maxL * 0.9 && y > H * 0.3 && y < H * 0.95) || new THREE.Vector3(-10, 30, 0);
  // torso half width at chest height
  let torso = 0;
  for (let i = 0; i < all.length; i += 3) {
    const x = Math.abs(all[i]), y = all[i + 1];
    if (y > H * 0.66 && y < H * 0.74 && x < Math.min(maxR, maxL) * 0.55) torso = Math.max(torso, x);
  }
  if (torso < 4) torso = H * 0.11;
  // legs x at knee height
  const legR = avg((x, y) => x > 0.5 && y > H * 0.2 && y < H * 0.3 && x < torso) || new THREE.Vector3(H * 0.06, 0, 0);
  const legL = avg((x, y) => x < -0.5 && y > H * 0.2 && y < H * 0.3 && -x < torso) || new THREE.Vector3(-H * 0.06, 0, 0);
  const j = {};
  j.root = new THREE.Vector3(0, 0, 0);
  j.hips = new THREE.Vector3(0, H * 0.53, 0);
  j.spine = new THREE.Vector3(0, H * 0.62, 0);
  j.chest = new THREE.Vector3(0, H * 0.72, 0);
  j.neck = new THREE.Vector3(0, H * 0.83, 0);
  j.head = new THREE.Vector3(0, H * 0.875, 0);
  j.headTop = new THREE.Vector3(0, H, 0);
  for (const side of ['R', 'L']) {
    const sg = side === 'R' ? 1 : -1;
    const hand = side === 'R' ? handR : handL;
    const sh = findBone(bones, 'shoulder' + side) || new THREE.Vector3(sg * torso * 0.98, H * 0.795, 0);
    const handB = findBone(bones, 'hand' + side);
    const handPos = handB || hand;
    const wrist = handB ? handB.clone() : handPos.clone().lerp(sh, 0.06);
    const elbow = findBone(bones, 'elbow' + side) || sh.clone().lerp(wrist, 0.5).add(new THREE.Vector3(0, 0, 1.2));
    const tip = handB ? handB.clone().add(handB.clone().sub(elbow).normalize().multiplyScalar(H * 0.06)) : hand.clone().add(hand.clone().sub(sh).normalize().multiplyScalar(H * 0.03));
    j['upperArm' + side] = sh; j['forearm' + side] = elbow; j['hand' + side] = wrist; j['handTip' + side] = tip;
    const lx = side === 'R' ? legR.x : legL.x;
    const hip = findBone(bones, 'hip' + side) || new THREE.Vector3(lx, H * 0.5, 0);
    const knee = findBone(bones, 'knee' + side) || new THREE.Vector3(lx, H * 0.28, 0.4);
    const foot = findBone(bones, 'foot' + side) || new THREE.Vector3(lx, H * 0.06, 0);
    j['thigh' + side] = hip; j['shin' + side] = knee; j['foot' + side] = foot;
    j['toe' + side] = new THREE.Vector3(foot.x, 0.5, foot.z - H * 0.1);
  }
  return j;
}

// ---------------- Asset manager -----------------
export class AssetManager {
  constructor() {
    this.config = loadConfig();
    this.cache = new Map(); // slot -> {template, info}
    this.quality = 'low';
    this.listeners = new Set();
  }
  slotConfig(slot) { return this.config[slot] || { source: 'default' }; }
  tune(slot) { return { ...DEFAULT_TUNE, ...(this.config[slot]?.tune || {}) }; }
  setTune(slot, tune) {
    this.config[slot] = { ...this.slotConfig(slot), tune: { ...this.tune(slot), ...tune } };
    saveConfig(this.config);
    this._notify(slot, true);
  }
  resetTune(slot) { if (this.config[slot]) delete this.config[slot].tune; saveConfig(this.config); this._notify(slot, true); }
  onChange(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  _notify(slot, tuneOnly = false) { for (const f of this.listeners) f(slot, tuneOnly); }

  async setFile(slot, file) {
    const bytes = await file.arrayBuffer();
    await this.setBytes(slot, bytes, file.name);
  }
  async setBytes(slot, bytes, name) {
    // validate before persisting
    await parseGLB(bytes.slice(0));
    const hash = await hashBytes(bytes);
    await idbPut('slot_' + slot, { name, bytes, hash });
    this.config[slot] = { source: 'file', name, hash, tune: this.config[slot]?.tune };
    saveConfig(this.config);
    this.cache.delete(slot);
    this._notify(slot);
  }
  async setUrl(slot, url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
    const bytes = await res.arrayBuffer();
    await parseGLB(bytes.slice(0));
    this.config[slot] = { source: 'url', url, name: url.split('/').pop(), tune: this.config[slot]?.tune };
    saveConfig(this.config);
    this.cache.delete(slot);
    this._notify(slot);
  }
  async reset(slot) {
    await idbDel('slot_' + slot);
    delete this.config[slot];
    saveConfig(this.config);
    this.cache.delete(slot);
    this._notify(slot);
  }

  async getBytes(slot) {
    const c = this.slotConfig(slot);
    if (c.source === 'file') { const r = await idbGet('slot_' + slot); return r ? { bytes: r.bytes, name: r.name, hash: r.hash } : null; }
    if (c.source === 'url') { const res = await fetch(c.url); if (!res.ok) return null; const bytes = await res.arrayBuffer(); return { bytes, name: c.name, hash: await hashBytes(bytes) }; }
    if (DEFAULT_URL[slot]) {
      const res = await fetch(DEFAULT_URL[slot]);
      if (!res.ok) return null;
      return { bytes: await res.arrayBuffer(), name: DEFAULT_URL[slot].split('/').pop(), bundled: true };
    }
    return null;
  }

  // Weapon template (Group) for a GLB-backed slot, or null when unavailable.
  async weaponTemplate(slot) {
    if (this.cache.has(slot)) return this.cache.get(slot);
    const p = (async () => {
      try {
        const src = await this.getBytes(slot);
        if (!src) return null;
        const gltf = await parseGLB(src.bytes);
        const cal = src.bundled ? BUNDLED_CAL[slot] : (this.slotConfig(slot).source === 'default' ? BUNDLED_CAL[slot] : null);
        const t = normalizeWeapon(gltf.scene, slot, this.quality, cal);
        t.userData.slot = slot;
        return t;
      } catch (e) {
        console.warn('weapon load failed', slot, e);
        return null;
      }
    })();
    this.cache.set(slot, p);
    return p;
  }

  async soldierData() {
    if (this.cache.has('soldier')) return this.cache.get('soldier');
    const p = (async () => {
      try {
        const src = await this.getBytes('soldier');
        if (!src) return null;
        const gltf = await parseGLB(src.bytes);
        return normalizeSoldier(gltf.scene, this.quality, this.slotConfig('soldier').faceFlip !== false);
      } catch (e) { console.warn('soldier load failed', e); return null; }
    })();
    this.cache.set('soldier', p);
    return p;
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.cache.clear();
  }
}
