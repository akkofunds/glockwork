// Procedural meshes (single draw call each via vertex colours) for
// grenades and the C4, and last-resort fallbacks if a provided .glb gun model fails to load.
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
  ak47: { muzzle: [0, 2.6, -24.8], left: [0, 0.8, -11], eject: [0.9, 3.0, -2.5] },
  awp: { muzzle: [0, 2.9, -34.8], left: [0, 1.0, -7], eject: [0.9, 3.0, -1] },
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
