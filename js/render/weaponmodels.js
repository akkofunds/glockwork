// High-detail procedural weapon meshes (single draw call each via vertex colours) for every weapon without a
// user-supplied .glb (USP-S, P250, Desert Eagle, MP9, MAC-10, M4A1-S, SSG 08, grenades, C4) and as fallbacks.
// Convention: barrel points toward -Z, +Y is up, the firing-hand grip point is at the origin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

class Parts {
  constructor() { this.geos = []; }
  _push(g, color, x, y, z, rx = 0, ry = 0, rz = 0) {
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const ng = g.index ? g : g;
    this.geos.push(ng);
    return this;
  }
  box(w, h, d, x, y, z, color, rx, ry, rz) { return this._push(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz); }
  // cylinder along Z
  cyl(r1, r2, len, x, y, z, color, seg = 10, rx = 0, ry = 0) {
    const g = new THREE.CylinderGeometry(r2, r1, len, seg);
    g.rotateX(-Math.PI / 2);
    return this._push(g, color, x, y, z, rx, ry, 0);
  }
  cylY(r1, r2, len, x, y, z, color, seg = 10, rz = 0) { return this._push(new THREE.CylinderGeometry(r1, r2, len, seg), color, x, y, z, 0, 0, rz); }
  sphere(r, x, y, z, color, seg = 8) { return this._push(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), color, x, y, z); }
  geometry() {
    const g = mergeGeometries(this.geos.map((x) => (x.index ? x.toNonIndexed() : x)), false);
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

const BLACK = '#1c1d1f', DARK = '#2c2f33', GREY = '#4a4f55', STEEL = '#7d848c', WOOD = '#7a4b28', WOOD2 = '#5e381c', OLIVE = '#4f5a3a', TAN = '#a08a62', BRASS = '#b8913a';

const BUILDERS = {
  m4a1s(p) {
    p.box(1.3, 3.0, 11, 0, 2.3, -2.2, DARK).box(1.15, 0.5, 13, 0, 4.0, -3.0, BLACK) // receiver + rail
      .box(1.2, 4.2, 1.8, 0, -1.2, 0.4, BLACK, 0.28) // grip
      .box(0.95, 6.2, 2.5, 0, -1.6, -3.6, GREY, -0.12) // mag
      .box(0.7, 1.4, 2.2, 0, 0.6, -0.9, BLACK) // trigger guard
      .cyl(0.75, 0.75, 7, 0, 2.6, 5.5, BLACK) // buffer tube
      .box(1.5, 3.8, 6.5, 0, 1.9, 9.8, DARK) // stock
      .box(1.3, 1.2, 1.8, 0, 0.2, 12.4, BLACK)
      .box(1.9, 2.3, 10, 0, 2.5, -12.5, DARK) // handguard
      .box(1.2, 0.4, 10, 0, 3.75, -12.5, BLACK)
      .cyl(0.32, 0.32, 3.5, 0, 2.5, -19, BLACK)
      .cyl(0.75, 0.8, 7.5, 0, 2.5, -24, BLACK, 14) // suppressor
      .box(0.3, 1.2, 0.5, 0, 4.6, -16.8, BLACK) // front sight
      .box(0.9, 1.0, 1.4, 0, 4.7, 0.8, BLACK) // rear sight
      .box(0.6, 0.6, 0.9, 0.85, 2.7, -1.0, STEEL); // charging/eject detail
  },
  ak47(p) {
    p.box(1.3, 2.6, 11, 0, 2.0, -2.5, DARK).box(1.2, 0.6, 10, 0, 3.4, -2.7, GREY)
      .box(1.1, 4.0, 1.7, 0, -1.2, 0.5, WOOD2, 0.3)
      .box(0.9, 4.0, 2.4, 0, -1.0, -4.2, '#8a5a2a', -0.25).box(0.9, 3.2, 2.2, 0, -3.8, -3.3, '#8a5a2a', -0.6) // curved mag
      .box(1.4, 3.6, 9, 0, 1.1, 8.4, WOOD, -0.12) // stock
      .box(1.7, 2.1, 7, 0, 2.0, -11.2, WOOD) // lower handguard
      .box(1.3, 1.2, 5.5, 0, 3.3, -11.0, WOOD2)
      .cyl(0.32, 0.32, 9, 0, 2.6, -18.5, BLACK).cyl(0.55, 0.45, 2.4, 0, 2.6, -23.6, BLACK)
      .cyl(0.25, 0.25, 7, 0, 3.6, -13.5, GREY) // gas tube
      .box(0.3, 1.4, 0.6, 0, 3.6, -21.5, BLACK).box(0.9, 0.8, 1.6, 0, 3.8, -5.8, BLACK)
      .box(0.7, 1.2, 2.0, 0, 0.6, -0.8, DARK);
  },
  awp(p) {
    p.box(1.6, 3.6, 13, 0, 1.4, 1.0, OLIVE) // chassis
      .box(1.7, 5.2, 8.5, 0, 0.6, 12.2, OLIVE).box(1.5, 1.6, 4.5, 0, -1.4, 10.8, OLIVE) // thumbhole stock
      .box(1.3, 1.2, 1.6, 0, 3.6, 13.4, BLACK) // cheek
      .box(1.2, 3.8, 1.6, 0, -1.0, 0.4, OLIVE, 0.25)
      .box(1.0, 3.2, 3.0, 0, -0.4, -3.8, BLACK) // mag
      .box(1.5, 2.4, 9, 0, 2.8, -4.5, DARK)
      .cyl(0.55, 0.45, 24, 0, 2.9, -20.5, BLACK, 12).cyl(0.75, 0.75, 2.5, 0, 2.9, -33.5, BLACK, 12)
      .cyl(1.0, 1.0, 12, 0, 5.8, -3.5, BLACK, 14).cyl(1.25, 1.0, 2.6, 0, 5.8, -10.3, BLACK, 14).cyl(1.1, 1.0, 2.2, 0, 5.8, 3.4, BLACK, 14)
      .box(0.7, 1.8, 0.7, 0, 4.4, -6.0, DARK).box(0.7, 1.8, 0.7, 0, 4.4, -1.0, DARK)
      .cyl(0.25, 0.25, 2, 1.4, 3.0, 1.5, STEEL, 6, 0, Math.PI / 2).sphere(0.45, 2.3, 3.0, 1.5, STEEL);
  },
  ssg08(p) {
    p.box(1.4, 3.2, 12, 0, 1.4, 1.0, '#3a3f44').box(1.5, 4.4, 8, 0, 0.8, 11.2, '#3a3f44')
      .box(1.1, 3.6, 1.6, 0, -1.0, 0.4, BLACK, 0.25).box(0.9, 2.6, 2.6, 0, -0.2, -3.6, BLACK)
      .box(1.3, 2.2, 8, 0, 2.7, -4.2, DARK)
      .cyl(0.45, 0.4, 22, 0, 2.8, -19, BLACK, 10)
      .cyl(0.85, 0.85, 10, 0, 5.3, -3.0, BLACK, 12).cyl(1.1, 0.85, 2.2, 0, 5.3, -9.0, BLACK, 12)
      .box(0.6, 1.6, 0.6, 0, 4.1, -5.5, DARK).box(0.6, 1.6, 0.6, 0, 4.1, -0.8, DARK)
      .cyl(0.22, 0.22, 2, 1.3, 2.9, 1.2, STEEL, 6, 0, Math.PI / 2).sphere(0.4, 2.1, 2.9, 1.2, STEEL);
  },
  mp9(p) {
    p.box(1.6, 3.0, 8.5, 0, 2.1, -2.6, '#24272b').box(1.2, 0.5, 8, 0, 3.8, -2.6, BLACK)
      .box(1.2, 4.0, 1.7, 0, -1.0, 0.3, BLACK, 0.18).box(0.85, 3.4, 1.3, 0, -3.8, 0.75, GREY, 0.18) // mag in grip
      .box(1.0, 3.0, 1.1, 0, 0.0, -6.0, BLACK, -0.1) // vertical foregrip
      .cyl(0.35, 0.35, 3, 0, 2.3, -8.3, BLACK)
      .box(0.25, 0.5, 6.5, 0.7, 2.2, 4.4, STEEL).box(0.25, 0.5, 6.5, -0.7, 2.2, 4.4, STEEL).box(1.6, 2.4, 0.5, 0, 2.0, 7.6, BLACK) // folding stock
      .box(0.7, 1.2, 2, 0, 0.6, -0.8, BLACK);
  },
  mac10(p) {
    p.box(1.8, 3.6, 8.0, 0, 2.0, -2.2, '#3b3e42').box(1.4, 0.8, 1.6, 0, 4.1, 0.5, BLACK)
      .box(1.3, 4.2, 1.8, 0, -0.8, 0.0, BLACK).box(1.0, 4.2, 1.4, 0, -4.4, 0.1, GREY) // grip + long mag
      .cyl(0.35, 0.35, 2.2, 0, 2.6, -7.2, BLACK).box(0.8, 1.0, 2, 0, 0.8, -1.2, BLACK)
      .box(0.25, 2.2, 0.25, 0.9, 1.0, -5.5, STEEL).box(0.25, 2.2, 0.25, 0.9, 1.0, 3.4, STEEL); // sling loops
  },
  usp(p) {
    p.box(1.15, 1.35, 7.4, 0, 2.15, -2.5, '#26282b').box(1.05, 0.9, 6.2, 0, 1.2, -2.1, BLACK)
      .box(1.2, 4.2, 1.9, 0, -0.9, 0.6, BLACK, 0.26)
      .box(0.6, 1.0, 1.6, 0, 0.6, -1.0, BLACK)
      .cyl(0.55, 0.55, 5.2, 0, 2.05, -8.7, BLACK, 12)
      .box(0.3, 0.5, 0.4, 0, 3.0, -5.6, STEEL).box(0.8, 0.45, 0.5, 0, 3.0, 0.7, STEEL);
  },
  p250(p) {
    p.box(1.1, 1.3, 6.8, 0, 2.1, -2.3, '#5c6066').box(1.0, 0.9, 5.6, 0, 1.2, -2.0, BLACK)
      .box(1.15, 4.0, 1.8, 0, -0.9, 0.6, BLACK, 0.26).box(0.6, 1.0, 1.5, 0, 0.6, -1.0, BLACK)
      .cyl(0.25, 0.25, 0.5, 0, 2.1, -5.9, BLACK).box(0.3, 0.5, 0.4, 0, 2.95, -5.3, STEEL);
  },
  deagle(p) {
    p.box(1.35, 1.9, 9.8, 0, 2.5, -3.4, '#8c9196').box(0.5, 0.5, 9.4, 0, 3.6, -3.4, '#6c7176')
      .box(1.25, 1.0, 7.8, 0, 1.25, -2.4, '#7c8186')
      .box(1.3, 4.4, 2.2, 0, -1.0, 0.7, '#25272a', 0.24).box(0.7, 1.2, 1.8, 0, 0.6, -1.3, '#7c8186')
      .cyl(0.3, 0.3, 0.4, 0, 2.6, -8.4, BLACK);
  },
  glock17(p) {
    p.box(1.05, 1.3, 7.2, 0, 2.05, -2.4, '#2a2b2d').box(1.0, 0.9, 6, 0, 1.15, -2.0, '#1a1b1c')
      .box(1.15, 4.1, 1.9, 0, -0.9, 0.55, '#1a1b1c', 0.3).box(0.6, 1.0, 1.6, 0, 0.6, -1.0, '#1a1b1c')
      .box(0.3, 0.45, 0.35, 0, 2.85, -5.6, '#dcdcdc').box(0.8, 0.4, 0.4, 0, 2.85, 0.8, '#dcdcdc');
  },
  knife(p) {
    // blade toward -Z
    p.box(0.22, 1.35, 5.6, 0, 0.55, -4.3, STEEL).box(0.2, 0.75, 1.6, 0, 0.92, -7.5, '#9aa1a8', 0.5)
      .box(0.25, 0.25, 4.8, 0, 1.25, -4.0, '#5d646a') // spine
      .box(0.7, 2.6, 0.45, 0, 0.3, -1.25, '#2a2a2a') // guard
      .cyl(0.62, 0.55, 4.4, 0, 0.3, 1.2, '#2f2a24', 10).cyl(0.7, 0.7, 0.6, 0, 0.3, 3.6, '#555', 10);
  },
  he(p) { p.cylY(1.25, 1.25, 3.0, 0, 0, 0, OLIVE, 12).sphere(1.25, 0, 1.4, 0, OLIVE, 10).sphere(1.25, 0, -1.4, 0, OLIVE, 10).box(0.35, 2.6, 0.4, 1.2, 1.2, 0, STEEL).cylY(0.5, 0.5, 0.8, 0, 2.6, 0, STEEL, 8); },
  flash(p) { p.cylY(1.0, 1.0, 4.2, 0, 0, 0, '#8f979e', 12).cylY(1.02, 1.02, 0.6, 0, 1.2, 0, '#2d6fb3', 12).box(0.35, 3.4, 0.4, 1.0, 0.8, 0, STEEL).cylY(0.45, 0.45, 0.8, 0, 2.5, 0, STEEL, 8); },
  smoke(p) { p.cylY(1.1, 1.1, 4.6, 0, 0, 0, '#6a7068', 12).cylY(1.12, 1.12, 0.6, 0, 1.3, 0, '#b8b8b0', 12).box(0.35, 3.6, 0.4, 1.1, 0.9, 0, STEEL).cylY(0.45, 0.45, 0.8, 0, 2.7, 0, STEEL, 8); },
  c4(p) {
    p.box(5.5, 2.2, 8.0, 0, 0, 0, '#5b4a32').box(5.0, 0.4, 3.2, 0, 1.25, -1.6, '#1d1f1c').box(4.4, 0.2, 2.0, 0, 1.5, 1.8, '#9eaa6a')
      .box(1.2, 2.4, 7.6, -2.0, 0.1, 0, '#c9b78a').box(1.2, 2.4, 7.6, 2.0, 0.1, 0, '#c9b78a')
      .sphere(0.3, 1.6, 1.5, -3.2, '#ff2020', 6);
  },
};

// Approximate grip/muzzle metadata for procedural guns
const META = {
  m4a1s: { muzzle: [0, 2.5, -28], left: [0, 1.0, -12.5], eject: [0.9, 2.7, -1.5] },
  ak47: { muzzle: [0, 2.6, -24.8], left: [0, 0.8, -11], eject: [0.9, 3.0, -2.5] },
  awp: { muzzle: [0, 2.9, -34.8], left: [0, 1.0, -7], eject: [0.9, 3.0, -1] },
  ssg08: { muzzle: [0, 2.8, -30], left: [0, 1.0, -6.5], eject: [0.9, 2.8, -1] },
  mp9: { muzzle: [0, 2.3, -9.8], left: [0, -1.4, -6.0], eject: [0.9, 2.5, -2] },
  mac10: { muzzle: [0, 2.6, -8.3], left: [-0.4, 1.2, -4.5], eject: [0.9, 2.5, -2] },
  usp: { muzzle: [0, 2.05, -11.3], left: [-0.9, -0.6, 0.4], eject: [0.7, 2.6, -1.5] },
  p250: { muzzle: [0, 2.1, -6.2], left: [-0.9, -0.6, 0.4], eject: [0.7, 2.6, -1.5] },
  deagle: { muzzle: [0, 2.6, -8.6], left: [-0.9, -0.6, 0.5], eject: [0.8, 3.0, -1.5] },
  glock17: { muzzle: [0, 2.05, -6.0], left: [-0.9, -0.6, 0.4], eject: [0.7, 2.6, -1.5] },
  knife: { muzzle: [0, 0.6, -8.5], left: null, eject: [0, 0, 0] },
  he: { muzzle: [0, 0, 0], left: null, eject: [0, 0, 0] },
  flash: { muzzle: [0, 0, 0], left: null, eject: [0, 0, 0] },
  smoke: { muzzle: [0, 0, 0], left: null, eject: [0, 0, 0] },
  c4: { muzzle: [0, 0, 0], left: [-2.5, 0, 0], eject: [0, 0, 0] },
};

const cache = new Map();
export function proceduralWeapon(key, materialFactory) {
  if (!BUILDERS[key]) key = 'glock17';
  if (!cache.has(key)) {
    const p = new Parts();
    BUILDERS[key](p);
    cache.set(key, p.geometry());
  }
  const mesh = new THREE.Mesh(cache.get(key), materialFactory());
  mesh.name = 'proc_' + key;
  const m = META[key];
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.meta = {
    muzzle: new THREE.Vector3(...m.muzzle),
    left: m.left ? new THREE.Vector3(...m.left) : null,
    eject: new THREE.Vector3(...m.eject),
    procedural: true,
  };
  return g;
}

export const PROCEDURAL_KEYS = Object.keys(BUILDERS);
