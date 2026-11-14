// Map Manager: builds the built-in arena or a custom .glb map (auto-scaled, spatial-hashed collision),
// resolves spawn / bombsite configuration (auto-guess + per-map overrides), live marker helpers,
// and renders a top-down radar image.
import * as THREE from 'three';
import { CollisionWorld } from './collision.js';
import { buildDunewatch } from './arena.js';
import { makeTextures } from './textures.js';
import { parseGLB, adaptMaterial, hashBytes } from '../assets.js';
import { TEAM } from '../config.js';

function loadOverrides(hash) {
  try { return JSON.parse(localStorage.getItem('fp_mapcfg_' + hash) || 'null'); } catch { return null; }
}
export function saveOverrides(hash, cfg) {
  try { localStorage.setItem('fp_mapcfg_' + hash, JSON.stringify(cfg)); } catch { /* ignore */ }
}

function spawnRing(c, yaw, world) {
  const pts = [];
  const offs = [[0, 0], [-70, 0], [70, 0], [-140, 0], [140, 0], [-35, 70], [35, 70], [-105, 70], [105, 70], [0, 140]];
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (const [ox, oz] of offs) {
    let x = c.x + ox * cs + oz * sn, z = c.z - ox * sn + oz * cs;
    let y = world ? world.groundHeight(x, c.y + 80, z, 400) : c.y;
    if (y === null || (world && world.capsuleOverlaps(x, y + 2, z, 70, 15))) { x = c.x; z = c.z; y = c.y; }
    pts.push({ x, y, z, yaw });
  }
  return pts;
}

// Lowest floor under (x,z) with standing room above it (skips roofs and overhangs).
// Lowest floor under (x,z) with standing room above it (skips roofs and overhangs).
// openSky: also require a clear view of the sky (avoids spawning inside props, nooks or sealed rooms).
export function lowestFloor(world, x, top, z, bottom, openSky = false) {
  let y = top, best = null;
  const hit = {};
  for (let i = 0; i < 24 && y > bottom; i++) {
    const t = world.raycast(x, y, z, 0, -1, 0, y - bottom, hit);
    if (t === Infinity) break;
    const fy = y - t;
    if (hit.ny > 0.7 && !world.capsuleOverlaps(x, fy + 1, z, 72, 16)) {
      const sky = !openSky || world.raycast(x, fy + 80, z, 0, 1, 0, Math.max(10, top - fy), null) === Infinity;
      const room = !openSky || [0, 1, 2, 3].every((k) => world.raycast(x, fy + 40, z, Math.cos(k * 1.5708), 0, Math.sin(k * 1.5708), 120, null) === Infinity || false) || sky;
      if (sky && room) best = fy;
    }
    y = fy - 2;
  }
  return best;
}

export function finalizeConfig(base, world) {
  const cfg = JSON.parse(JSON.stringify(base));
  const T = TEAM.T, CT = TEAM.CT;
  if (!cfg.spawns || !cfg.spawns[T] || !cfg.spawns[T].length) {
    cfg.spawns = {
      [T]: spawnRing(cfg.spawnCenter[T], cfg.spawnCenter[T].yaw ?? 0, world),
      [CT]: spawnRing(cfg.spawnCenter[CT], cfg.spawnCenter[CT].yaw ?? Math.PI, world),
    };
  }
  return cfg;
}

export class MapManager {
  constructor() {
    this.current = null; // { root, world, config, desc, bytes }
    this.markers = null;
  }

  async buildBuiltin(renderer, quality) {
    const tex = makeTextures(renderer, quality);
    const { root, config } = buildDunewatch(tex, quality);
    const world = new CollisionWorld();
    world.addObject(root, THREE);
    world.build();
    const cfg = finalizeConfig(config, world);
    return { root, world, config: cfg, desc: { kind: 'builtin', name: 'dunewatch', title: 'Dunewatch' }, bytes: null };
  }

  /*
   Build a custom map from .glb bytes. scaleOverride: number or null (auto).
  */
  async buildGLB(bytes, quality, name = 'Custom Map', cfgFromHost = null, fallbackCfg = null) {
    const hash = await hashBytes(bytes);
    const gltf = await parseGLB(bytes.slice(0));
    const root = new THREE.Group();
    root.name = 'CustomMap';
    const scene = gltf.scene;
    root.add(scene);
    scene.traverse((o) => {
      if (o.isMesh) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => adaptMaterial(m, quality)) : adaptMaterial(o.material, quality);
        o.castShadow = quality !== 'low'; o.receiveShadow = quality !== 'low';
        o.matrixAutoUpdate = false;
        // invisible / trigger-like meshes don't collide
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.transparent && m.opacity < 0.2) o.userData.noCollide = true;
        if (/sky|trigger|clip_none|nocollide/i.test(o.name)) o.userData.noCollide = true;
      }
    });
    scene.updateMatrixWorld(true);
    const over = cfgFromHost || loadOverrides(hash) || fallbackCfg || {};
    // Normalise any map: plausible size (game maps are ~1.5k-16k units across), centred on the origin, floor at y=0.
    let box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.z) || 1;
    // Prefer standard unit conversions (Sketchfab's 0.01 root, metres -> inches) before a size guess.
    const fits = (k) => extent * k >= 1800 && extent * k <= 16000;
    const autoScale = fits(1) ? 1 : fits(100) ? 100 : fits(39.37) ? 39.37 : fits(0.01) ? 0.01 : 4500 / extent;
    const scale = over.scale || autoScale;
    scene.scale.multiplyScalar(scale);
    scene.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(scene);
    const ctr = box.getCenter(new THREE.Vector3());
    scene.position.x -= ctr.x; scene.position.z -= ctr.z; scene.position.y -= box.min.y;
    scene.updateMatrixWorld(true);
    scene.traverse((o) => { if (o.isMesh) o.updateMatrix(); });
    box = new THREE.Box3().setFromObject(scene);
    const world = new CollisionWorld();
    world.addObject(root, THREE);
    world.build();
    // default config guess: spawns at the two ends of the longest axis, sites at quarter points
    const c = box.getCenter(new THREE.Vector3());
    const alongZ = (box.max.z - box.min.z) >= (box.max.x - box.min.x);
    const L = alongZ ? box.max.z - box.min.z : box.max.x - box.min.x;
    // the map's main ground level = most common open-sky floor height (keeps spawns off rooftops)
    const hist = new Map();
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
      const x = box.min.x + (box.max.x - box.min.x) * (i + 0.5) / 24, z = box.min.z + (box.max.z - box.min.z) * (j + 0.5) / 24;
      const y = lowestFloor(world, x, box.max.y + 10, z, box.min.y - 10, true);
      if (y !== null) { const k = Math.round(y / 48); hist.set(k, (hist.get(k) || 0) + 1); }
    }
    let groundLevel = null, bestN = 0;
    for (const [k, n] of hist) if (n > bestN) { bestN = n; groundLevel = k * 48; }
    const at = (f, side) => {
      const p = alongZ ? new THREE.Vector3(c.x + side * (box.max.x - box.min.x) * 0.25, box.max.y, box.min.z + L * f) : new THREE.Vector3(box.min.x + L * f, box.max.y, c.z + side * (box.max.z - box.min.z) * 0.25);
      // spiral outward until we find real, standable, open-sky floor (then relax the sky requirement)
      for (const openSky of [true, false]) {
        for (let r = 0; r <= 2400; r += 64) {
          const steps = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 96);
          for (let k = 0; k < steps; k++) {
            const a = (k / steps) * Math.PI * 2;
            const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
            const y = lowestFloor(world, x, box.max.y + 10, z, box.min.y - 10, openSky);
            if (y !== null && (groundLevel === null || Math.abs(y - groundLevel) <= 160 || !openSky)) return { x, y, z };
          }
        }
      }
      return { x: p.x, y: box.min.y, z: p.z };
    };
    const tC = at(0.92, 0), ctC = at(0.08, 0);
    const yawT = alongZ ? 0 : Math.PI / 2, yawCT = alongZ ? Math.PI : -Math.PI / 2;
    const guess = {
      name,
      spawnCenter: { [TEAM.T]: { ...tC, yaw: yawT }, [TEAM.CT]: { ...ctC, yaw: yawCT } },
      buyRadius: 700,
      sites: [{ name: 'A', ...at(0.3, 1), r: 350 }, { name: 'B', ...at(0.3, -1), r: 350 }],
      callouts: [],
    };
    const base = {
      ...guess,
      ...(over.spawnCenter ? { spawnCenter: over.spawnCenter } : {}),
      ...(over.sites ? { sites: over.sites } : {}),
      ...(over.buyRadius ? { buyRadius: over.buyRadius } : {}),
      scale,
    };
    const cfg = finalizeConfig(base, world);
    return { root, world, config: cfg, desc: { kind: 'glb', name, hash, size: bytes.byteLength, title: name }, bytes, hash };
  }

  // Visual helpers for spawn & site positions (Map Manager editing)
  showMarkers(scene, cfg, visible) {
    if (this.markers) { scene.remove(this.markers); this.markers = null; }
    if (!visible || !cfg) return;
    const g = new THREE.Group();
    const pillar = (x, y, z, color, label, r = 0) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 160, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthTest: false }));
      m.position.set(x, y + 80, z); m.renderOrder = 20; g.add(m);
      if (r) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 6, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 2, z); ring.renderOrder = 20; g.add(ring);
      }
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const ctx = c.getContext('2d'); ctx.font = 'bold 40px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, 128, 46);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      s.scale.set(160, 40, 1); s.position.set(x, y + 190, z); s.renderOrder = 21; g.add(s);
    };
    pillar(cfg.spawnCenter[TEAM.T].x, cfg.spawnCenter[TEAM.T].y, cfg.spawnCenter[TEAM.T].z, 0xffae3d, 'T SPAWN', cfg.buyRadius);
    pillar(cfg.spawnCenter[TEAM.CT].x, cfg.spawnCenter[TEAM.CT].y, cfg.spawnCenter[TEAM.CT].z, 0x5aa9ff, 'CT SPAWN', cfg.buyRadius);
    for (const s of cfg.sites) pillar(s.x, s.y, s.z, 0xff4040, 'SITE ' + s.name, s.r);
    for (const sp of [...cfg.spawns[TEAM.T], ...cfg.spawns[TEAM.CT]]) {
      const d = new THREE.Mesh(new THREE.ConeGeometry(8, 18, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
      d.position.set(sp.x, sp.y + 9, sp.z); d.renderOrder = 20; g.add(d);
    }
    this.markers = g;
    scene.add(g);
  }

  // Top-down orthographic capture for the radar
  renderRadar(renderer, root, world, size = 512) {
    const min = world.min, max = world.max;
    const w = max[0] - min[0], d = max[2] - min[2];
    const ext = Math.max(w, d) / 2 + 50;
    const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
    const cam = new THREE.OrthographicCamera(-ext, ext, ext, -ext, 1, 20000);
    cam.position.set(cx, max[1] + 1000, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    const rt = new THREE.WebGLRenderTarget(size, size);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0f12);
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const hidden = [];
    root.traverse((o) => { if (o.isMesh && (o.userData.roof)) { hidden.push(o); o.visible = false; } });
    const parent = root.parent;
    scene.add(root);
    const r = renderer.renderer;
    const prevFog = null; void prevFog;
    r.setRenderTarget(rt);
    r.clear();
    r.render(scene, cam);
    const px = new Uint8Array(size * size * 4);
    r.readRenderTargetPixels(rt, 0, 0, size, size, px);
    r.setRenderTarget(null);
    for (const o of hidden) o.visible = true;
    if (parent) parent.add(root);
    rt.dispose();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    // flip Y, and tint: walkable floors brighter, walls darker via height probe
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const si = ((size - 1 - y) * size + x) * 4, di = (y * size + x) * 4;
      const l = (px[si] * 0.3 + px[si + 1] * 0.59 + px[si + 2] * 0.11);
      img.data[di] = l * 0.55 + 20; img.data[di + 1] = l * 0.6 + 24; img.data[di + 2] = l * 0.62 + 28; img.data[di + 3] = 235;
    }
    ctx.putImageData(img, 0, 0);
    // walls: darken cells whose top is much higher than floor level
    const step = (ext * 2) / size;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) {
      const wx = cx - ext + x * step, wz = cz - ext + y * step;
      const h = world.groundHeight(wx, max[1] + 10, wz, max[1] - min[1] + 50);
      if (h === null || h > min[1] + 170) ctx.fillRect(x, y, 2, 2);
    }
    return { canvas, cx, cz, ext };
  }
}
