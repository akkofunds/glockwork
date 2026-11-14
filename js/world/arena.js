// "Dunewatch" — the built-in, original 3-lane desert bomb-defusal arena.
// Geometry is generated from a walkable-lane layout, batched into one mesh per material (~8 draw calls).
import * as THREE from 'three';
import { TEAM } from '../config.js';

const CELL = 50;
const BOUNDS = { x0: -1800, x1: 1800, z0: -2250, z1: 2600 };

// Walkable lanes [x1, z1, x2, z2]
const LANES = [
  [-700, 1800, 700, 2500], // T spawn
  [700, 1850, 1650, 2250], // T -> Long A
  [1250, -900, 1650, 1850], // Long A
  [650, -1750, 1650, -900], // A site
  [-650, -2150, 650, -1500], // CT spawn
  [-220, -900, 220, 1800], // Mid
  [-220, -1500, 220, -900], // Mid -> CT
  [220, -700, 900, -500], // Short (catwalk)
  [650, -900, 900, -700], // Short -> A
  [-1650, 1850, -700, 2300], // Outer B tunnel
  [-1650, -450, -1300, 1850], // Upper B tunnel
  [-1650, -1750, -600, -450], // B site
  [-650, -1750, -600, -1500], // B <-> CT
  [-600, -1150, -220, -950], // Mid -> B (window)
  [-1300, 700, -220, 900], // Lower tunnels
];

// Extra solid blocks inside lanes [x1,z1,x2,z2,height,material]
const EXTRA_SOLIDS = [
  [1250, 960, 1390, 1040, 230, 'wall'], [1510, 960, 1650, 1040, 230, 'wall'], // Long doors frame
  [-220, -960, -40, -930, 150, 'metal'], [40, -960, 220, -930, 150, 'metal'], // Mid doors
  [-1650, 300, -1500, 360, 150, 'wall'], // tunnel pillar
  [650, -1150, 700, -900, 120, 'plaster'], // A site edge wall
];

// Roofed areas (tunnels) [x1,z1,x2,z2,y]
const ROOFS = [
  [-1650, 1850, -700, 2300, 150],
  [-1650, 350, -1300, 1850, 150],
  [-1300, 700, -220, 900, 150],
];

// Cover crates [x, z, w, d, h, material]
const CRATES = [
  [-450, 2000, 64, 64, 64, 'wood'], [-450, 2000, 48, 48, 112, 'wood'], [480, 2350, 64, 96, 64, 'wood'],
  [1350, 1500, 64, 64, 64, 'wood'], [1560, 450, 64, 64, 64, 'wood'], [1560, 450, 48, 48, 112, 'wood'],
  [1320, -350, 56, 56, 56, 'wood'], [1580, -700, 64, 64, 72, 'metal'],
  [1200, -1350, 64, 64, 104, 'wood'], [1520, -1650, 64, 128, 88, 'wood'], [820, -1120, 96, 48, 64, 'wood'],
  [1000, -1650, 64, 64, 64, 'wood'], [1000, -1650, 48, 48, 112, 'wood'],
  [320, -1720, 64, 64, 64, 'wood'], [-320, -1650, 96, 48, 64, 'wood'], [420, -2090, 128, 48, 56, 'metal'],
  [0, 350, 64, 64, 64, 'wood'], [140, -250, 64, 64, 64, 'wood'], [140, -250, 48, 48, 112, 'wood'], [-150, 1300, 56, 56, 56, 'wood'],
  [520, -600, 48, 48, 44, 'wood'],
  [-1150, -1150, 64, 64, 64, 'wood'], [-1150, -1150, 48, 48, 112, 'wood'], [-1450, -1520, 96, 64, 96, 'wood'],
  [-850, -800, 64, 64, 64, 'wood'], [-1350, -650, 80, 160, 56, 'metal'], [-780, -1620, 64, 64, 64, 'wood'],
  [-1000, 2100, 64, 64, 64, 'wood'], [-1450, 1200, 48, 48, 48, 'wood'], [-700, 800, 56, 56, 56, 'wood'],
];
// Barrels [x, z]
const BARRELS = [[-1580, 1600], [-1540, 1640], [-900, 760], [1600, 1200], [600, -1700], [-1600, -900], [180, 1700], [-180, -1450]];

// A site platform & ramp
const PLATFORM = { x1: 950, z1: -1550, x2: 1450, z2: -1150, h: 40 };

export const DUNEWATCH_CONFIG = {
  name: 'Dunewatch',
  spawnCenter: { [TEAM.T]: { x: 0, y: 0, z: 2200 }, [TEAM.CT]: { x: 0, y: 0, z: -1900 } },
  buyRadius: 700,
  sites: [
    { name: 'A', x: 1200, y: 40, z: -1350, r: 330 },
    { name: 'B', x: -1130, y: 0, z: -1150, r: 400 },
  ],
  callouts: [
    { name: 'T Spawn', r: [-700, 1800, 700, 2600] }, { name: 'Outside Long', r: [700, 1850, 1650, 2250] },
    { name: 'Long Doors', r: [1250, 900, 1650, 1100] }, { name: 'Long A', r: [1250, -900, 1650, 1850] },
    { name: 'A Site', r: [650, -1750, 1650, -900] }, { name: 'CT Spawn', r: [-650, -2250, 650, -1500] },
    { name: 'Mid Doors', r: [-220, -1100, 220, -850] }, { name: 'Mid', r: [-220, -900, 220, 1800] },
    { name: 'CT Mid', r: [-220, -1500, 220, -900] }, { name: 'Catwalk', r: [220, -900, 900, -500] },
    { name: 'Upper Tunnels', r: [-1650, -450, -1300, 1850] }, { name: 'Outer Tunnels', r: [-1650, 1850, -700, 2300] },
    { name: 'B Site', r: [-1650, -1750, -600, -450] }, { name: 'B Window', r: [-600, -1150, -220, -950] },
    { name: 'Lower Tunnels', r: [-1300, 700, -220, 900] },
  ],
};

function spawnGrid(cx, cz, yaw, rows = 2) {
  const pts = [];
  const offs = [[0, 0], [-70, 0], [70, 0], [-140, 0], [140, 0], [-35, 70], [35, 70], [-105, 70], [105, 70], [0, 140]];
  const s = Math.cos(yaw) > 0 ? 1 : -1;
  for (const [ox, oz] of offs.slice(0, rows * 5)) pts.push({ x: cx + ox, y: 0, z: cz + oz * s, yaw });
  return pts;
}
DUNEWATCH_CONFIG.spawns = {
  [TEAM.T]: spawnGrid(0, 2230, 0),
  [TEAM.CT]: spawnGrid(0, -1900, Math.PI),
};

class Batch {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; }
  quad(a, b, c, d, n, uvs, colors) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nrm.push(n[0], n[1], n[2]);
    for (const u of uvs) this.uv.push(u[0], u[1]);
    for (const c of colors) this.col.push(c, c, c);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(a, b, c, n, uvs, col) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 3; i++) this.nrm.push(n[0], n[1], n[2]);
    for (const u of uvs) this.uv.push(u[0], u[1]);
    for (let i = 0; i < 3; i++) this.col.push(col, col, col);
    this.idx.push(base, base + 1, base + 2);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/* Axis-aligned box with world-space UVs and baked vertical AO gradient.
   faces: bitmask to skip faces (1:+x 2:-x 4:+y 8:-y 16:+z 32:-z) */
function box(batch, x1, y1, z1, x2, y2, z2, opts = {}) {
  const s = opts.uvScale || 128;
  const tint = opts.tint || 1;
  const aoB = (opts.ao ?? 0.68) * tint, aoT = tint;
  const skip = opts.skip || 0;
  const vb = y1 / s, vt = y2 / s;
  // +X
  if (!(skip & 1)) batch.quad([x2, y1, z2], [x2, y1, z1], [x2, y2, z1], [x2, y2, z2], [1, 0, 0], [[-z2 / s, vb], [-z1 / s, vb], [-z1 / s, vt], [-z2 / s, vt]], [aoB, aoB, aoT, aoT]);
  // -X
  if (!(skip & 2)) batch.quad([x1, y1, z1], [x1, y1, z2], [x1, y2, z2], [x1, y2, z1], [-1, 0, 0], [[z1 / s, vb], [z2 / s, vb], [z2 / s, vt], [z1 / s, vt]], [aoB, aoB, aoT, aoT]);
  // +Y
  if (!(skip & 4)) batch.quad([x1, y2, z2], [x2, y2, z2], [x2, y2, z1], [x1, y2, z1], [0, 1, 0], [[x1 / s, -z2 / s], [x2 / s, -z2 / s], [x2 / s, -z1 / s], [x1 / s, -z1 / s]], [aoT, aoT, aoT, aoT]);
  // -Y
  if (!(skip & 8)) batch.quad([x1, y1, z1], [x2, y1, z1], [x2, y1, z2], [x1, y1, z2], [0, -1, 0], [[x1 / s, z1 / s], [x2 / s, z1 / s], [x2 / s, z2 / s], [x1 / s, z2 / s]], [aoB, aoB, aoB, aoB]);
  // +Z
  if (!(skip & 16)) batch.quad([x1, y1, z2], [x2, y1, z2], [x2, y2, z2], [x1, y2, z2], [0, 0, 1], [[x1 / s, vb], [x2 / s, vb], [x2 / s, vt], [x1 / s, vt]], [aoB, aoB, aoT, aoT]);
  // -Z
  if (!(skip & 32)) batch.quad([x2, y1, z1], [x1, y1, z1], [x1, y2, z1], [x2, y2, z1], [0, 0, -1], [[-x2 / s, vb], [-x1 / s, vb], [-x1 / s, vt], [-x2 / s, vt]], [aoB, aoB, aoT, aoT]);
}

// Ramp rising toward -Z from z2 (y0) to z1 (y1)
function rampNegZ(batch, x1, x2, z1, z2, y0, y1) {
  const s = 128;
  const len = Math.hypot(z2 - z1, y1 - y0);
  const ny = (z2 - z1) / len, nz = (y1 - y0) / len;
  batch.quad([x1, y0, z2], [x2, y0, z2], [x2, y1, z1], [x1, y1, z1], [0, ny, nz], [[x1 / s, 0], [x2 / s, 0], [x2 / s, len / s], [x1 / s, len / s]], [1, 1, 1, 1]);
  batch.tri([x2, y0, z2], [x2, y0, z1], [x2, y1, z1], [1, 0, 0], [[0, 0], [1, 0], [1, 0.3]], 0.8);
  batch.tri([x1, y0, z1], [x1, y0, z2], [x1, y1, z1], [-1, 0, 0], [[0, 0], [1, 0], [0, 0.3]], 0.8);
}

function cylinder(batch, cx, cz, r, h, seg = 10) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
    const am = (a0 + a1) / 2;
    batch.quad([x1, 0, z1], [x0, 0, z0], [x0, h, z0], [x1, h, z1], [Math.cos(am), 0, Math.sin(am)], [[(i + 1) / seg, 0], [i / seg, 0], [i / seg, 1], [(i + 1) / seg, 1]], [0.7, 0.7, 1, 1]);
    batch.tri([cx, h, cz], [x1, h, z1], [x0, h, z0], [0, 1, 0], [[0.5, 0.5], [0.5 + Math.cos(a1) * 0.5, 0.5 + Math.sin(a1) * 0.5], [0.5 + Math.cos(a0) * 0.5, 0.5 + Math.sin(a0) * 0.5]], 1);
  }
}

export function buildDunewatch(textures, quality) {
  const root = new THREE.Group();
  root.name = 'Dunewatch';
  const B = { sand: new Batch(), wall: new Batch(), plaster: new Batch(), wood: new Batch(), metal: new Batch(), roof: new Batch(), tile: new Batch(), roofTop: new Batch() };

  // ---- grid of walkable cells -> merged solid blocks ----
  const nx = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL), nz = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);
  const walk = new Uint8Array(nx * nz);
  for (const [x1, z1, x2, z2] of LANES) {
    for (let i = Math.round((x1 - BOUNDS.x0) / CELL); i < Math.round((x2 - BOUNDS.x0) / CELL); i++)
      for (let j = Math.round((z1 - BOUNDS.z0) / CELL); j < Math.round((z2 - BOUNDS.z0) / CELL); j++)
        if (i >= 0 && j >= 0 && i < nx && j < nz) walk[i + j * nx] = 1;
  }
  const used = new Uint8Array(nx * nz);
  let blockId = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = i + j * nx;
    if (walk[k] || used[k]) continue;
    // greedy rectangle (cap size so building heights vary)
    let w = 1;
    while (i + w < nx && w < 14 && !walk[i + w + j * nx] && !used[i + w + j * nx]) w++;
    let h = 1;
    outer: while (j + h < nz && h < 14) {
      for (let a = 0; a < w; a++) if (walk[i + a + (j + h) * nx] || used[i + a + (j + h) * nx]) break outer;
      h++;
    }
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) used[i + a + (j + b) * nx] = 1;
    const x1 = BOUNDS.x0 + i * CELL, z1 = BOUNDS.z0 + j * CELL, x2 = x1 + w * CELL, z2 = z1 + h * CELL;
    const hash = (Math.abs(Math.sin(i * 12.9898 + j * 78.233)) * 43758.5453) % 1;
    const height = 210 + Math.floor(hash * 4) * 45;
    const mat = hash > 0.55 ? 'plaster' : 'wall';
    box(B[mat], x1, 0, z1, x2, height, z2, { skip: 8 | 4, tint: 0.92 + hash * 0.12 });
    box(B.roofTop, x1, height, z1, x2, height + 0.01, z2, { skip: 1 | 2 | 8 | 16 | 32 });
    // parapet trim
    if (w * h > 4) box(B.wall, x1 - 2, height - 10, z1 - 2, x2 + 2, height, z2 + 2, { skip: 8 | 4, ao: 0.85 });
    blockId++;
  }
  // Outer boundary walls (tall, to stop anyone escaping)
  box(B.wall, BOUNDS.x0 - 100, 0, BOUNDS.z0 - 100, BOUNDS.x0, 600, BOUNDS.z1 + 100, { skip: 8 });
  box(B.wall, BOUNDS.x1, 0, BOUNDS.z0 - 100, BOUNDS.x1 + 100, 600, BOUNDS.z1 + 100, { skip: 8 });
  box(B.wall, BOUNDS.x0, 0, BOUNDS.z0 - 100, BOUNDS.x1, 600, BOUNDS.z0, { skip: 8 });
  box(B.wall, BOUNDS.x0, 0, BOUNDS.z1, BOUNDS.x1, 600, BOUNDS.z1 + 100, { skip: 8 });

  // Ground
  B.sand.quad([BOUNDS.x0, 0, BOUNDS.z1], [BOUNDS.x1, 0, BOUNDS.z1], [BOUNDS.x1, 0, BOUNDS.z0], [BOUNDS.x0, 0, BOUNDS.z0], [0, 1, 0],
    [[BOUNDS.x0 / 256, -BOUNDS.z1 / 256], [BOUNDS.x1 / 256, -BOUNDS.z1 / 256], [BOUNDS.x1 / 256, -BOUNDS.z0 / 256], [BOUNDS.x0 / 256, -BOUNDS.z0 / 256]], [1, 1, 1, 1]);
  // Tiled floors (sites + CT spawn) slightly above sand to avoid z-fighting
  const tileRect = (x1, z1, x2, z2, y = 0.4) => B.tile.quad([x1, y, z2], [x2, y, z2], [x2, y, z1], [x1, y, z1], [0, 1, 0], [[x1 / 160, -z2 / 160], [x2 / 160, -z2 / 160], [x2 / 160, -z1 / 160], [x1 / 160, -z1 / 160]], [1, 1, 1, 1]);
  tileRect(-650, -2150, 650, -1500);
  tileRect(-1650, -1750, -600, -450);

  // Extra solids
  for (const [x1, z1, x2, z2, h, m] of EXTRA_SOLIDS) box(B[m], x1, 0, z1, x2, h, z2, { skip: 8, ao: 0.75 });
  // Long doors lintel (above head height) & mid door lintel
  box(B.wall, 1390, 150, 960, 1510, 230, 1040, { skip: 0 });
  // Arches over lane entrances
  box(B.wall, -220, 160, 1780, 220, 200, 1820, {});
  box(B.wall, 650, 150, -1160, 900, 175, -1130, {});

  // Tunnel roofs
  for (const [x1, z1, x2, z2, y] of ROOFS) {
    box(B.roof, x1, y, z1, x2, y + 20, z2, { ao: 1 });
    // support beams
    for (let z = z1 + 100; z < z2; z += 300) box(B.wood, x1, y - 14, z, x2, y, z + 14, { ao: 0.9 });
  }

  // A-site platform with ramps
  const P = PLATFORM;
  box(B.tile, P.x1, 0, P.z1, P.x2, P.h, P.z2, { skip: 8, ao: 0.8, uvScale: 160 });
  rampNegZ(B.tile, P.x1 + 60, P.x1 + 260, P.z2, P.z2 + 140, 0, P.h);
  rampNegZ(B.tile, P.x2 - 260, P.x2 - 60, P.z2, P.z2 + 140, 0, P.h);
  // steps on west side
  box(B.wall, P.x1 - 40, 0, P.z1 + 100, P.x1, 20, P.z1 + 260, { skip: 8, ao: 0.85 });

  // Crates & barrels
  for (const [x, z, w, d, h, m] of CRATES) {
    const y0 = (x > P.x1 && x < P.x2 && z > P.z1 && z < P.z2) ? P.h : 0;
    box(B[m], x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2, { skip: 8, uvScale: Math.max(w, h), ao: 0.85 });
  }
  for (const [x, z] of BARRELS) cylinder(B.metal, x, z, 13, 46, quality === 'low' ? 8 : 12);

  // ---- materials ----
  const lambert = quality === 'low';
  const mk = (map, extra = {}) => lambert
    ? new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra })
    : new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.92, metalness: 0.0, ...extra });
  const mats = {
    sand: mk(textures.sand), wall: mk(textures.wall), plaster: mk(textures.plaster), wood: mk(textures.wood),
    metal: lambert ? mk(textures.metal) : mk(textures.metal, { roughness: 0.6, metalness: 0.35 }), roof: mk(textures.roof), tile: mk(textures.tile), roofTop: mk(textures.roof),
  };
  for (const key of Object.keys(B)) {
    if (!B[key].pos.length) continue;
    const mesh = new THREE.Mesh(B[key].geometry(), mats[key]);
    mesh.name = 'map_' + key;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = key !== 'sand' && key !== 'roofTop';
    mesh.receiveShadow = true;
    if (key === 'wood' || key === 'metal') mesh.userData.thin = true;
    if (key === 'roof') mesh.userData.roof = true;
    if (key === 'roofTop') mesh.userData.noCollide = false;
    root.add(mesh);
  }

  // Bombsite markings (decals, not collidable)
  const decal = (tex, x, y, z, size, rotY = 0, wall = false) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    if (!wall) m.rotation.x = -Math.PI / 2;
    m.rotation.y = rotY;
    if (!wall) m.rotation.order = 'YXZ';
    m.position.set(x, y, z);
    m.userData.noCollide = true;
    m.renderOrder = 1;
    root.add(m);
  };
  decal(textures.letter('A'), 1200, P.h + 0.6, -1350, 150, 0);
  decal(textures.letter('A'), 1645, 120, -1350, 140, -Math.PI / 2, true);
  decal(textures.letter('B'), -1130, 0.8, -1150, 170, 0);
  decal(textures.letter('B'), -1645, 120, -1100, 150, Math.PI / 2, true);
  decal(textures.letter('A', '#e67e22'), 1645, 110, 600, 110, -Math.PI / 2, true);
  decal(textures.letter('B', '#e67e22'), -1645, 100, 1950, 100, Math.PI / 2, true);

  root.updateMatrixWorld(true);
  return { root, config: DUNEWATCH_CONFIG };
}

export function calloutAt(config, x, z) {
  if (!config.callouts) return '';
  for (const c of config.callouts) {
    const r = c.r;
    if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return c.name;
  }
  return '';
}
