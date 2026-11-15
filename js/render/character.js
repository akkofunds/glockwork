// Third-person operators: a sculpted procedural tactical operator (default) or any user .glb soldier,
// auto-rigged onto a shared humanoid skeleton. Procedural animation: stride cycle, crouch, aim pitch,
// two-bone IK arms gripping the weapon socket (weapons sit outside the torso — no clipping) and death falls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TEAM, WEAPONS } from '../config.js';
import { damp, clamp } from '../util.js';
import { applyTune } from '../assets.js';

const BONES = [
  ['root', null], ['hips', 'root'], ['spine', 'hips'], ['chest', 'spine'], ['neck', 'chest'], ['head', 'neck'],
  ['upperArmR', 'chest'], ['forearmR', 'upperArmR'], ['handR', 'forearmR'],
  ['upperArmL', 'chest'], ['forearmL', 'upperArmL'], ['handL', 'forearmL'],
  ['thighR', 'hips'], ['shinR', 'thighR'], ['footR', 'shinR'],
  ['thighL', 'hips'], ['shinL', 'thighL'], ['footL', 'shinL'],
];
const BONE_INDEX = Object.fromEntries(BONES.map(([n], i) => [n, i]));
const SEG_END = {
  hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', head: 'headTop',
  upperArmR: 'forearmR', forearmR: 'handR', handR: 'handTipR', upperArmL: 'forearmL', forearmL: 'handL', handL: 'handTipL',
  thighR: 'shinR', shinR: 'footR', footR: 'toeR', thighL: 'shinL', shinL: 'footL', footL: 'toeL',
};
const SEG_RADIUS = { hips: 8, spine: 8.5, chest: 9.5, neck: 3.4, head: 6, upperArmR: 3.6, forearmR: 3.0, handR: 2.4, upperArmL: 3.6, forearmL: 3.0, handL: 2.4, thighR: 5.5, shinR: 4.2, footR: 3.2, thighL: 5.5, shinL: 4.2, footL: 3.2 };

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const PROC_JOINTS = {
  root: V(0, 0, 0), hips: V(0, 38, 0), spine: V(0, 45, 0), chest: V(0, 52, 0), neck: V(0, 60.5, 0), head: V(0, 63, 0), headTop: V(0, 72, 0),
  upperArmR: V(8.6, 57.5, 0), forearmR: V(9.6, 46, 0.6), handR: V(10.2, 35.5, 0), handTipR: V(10.4, 31, -0.5),
  upperArmL: V(-8.6, 57.5, 0), forearmL: V(-9.6, 46, 0.6), handL: V(-10.2, 35.5, 0), handTipL: V(-10.4, 31, -0.5),
  thighR: V(4.4, 37, 0), shinR: V(4.6, 20, -0.4), footR: V(4.7, 3.6, 0.6), toeR: V(4.7, 0.6, -6),
  thighL: V(-4.4, 37, 0), shinL: V(-4.6, 20, -0.4), footL: V(-4.7, 3.6, 0.6), toeL: V(-4.7, 0.6, -6),
};

const PALETTE = {
  [TEAM.CT]: { uniform: '#3b4a5b', uniform2: '#2e3b49', vest: '#222c37', pouch: '#2a3542', helmet: '#26313b', pad: '#1b2128', glove: '#16191c', boot: '#15171a', band: '#5aa9ff', visor: '#0d1620', skin: '#c4987a', face: '#20262c', rim: '#4d9bff' },
  [TEAM.T]: { uniform: '#8a7452', uniform2: '#6f5c3f', vest: '#5a4a31', pouch: '#6a573a', helmet: '#5f5038', pad: '#3f3527', glove: '#2b241b', boot: '#2a2119', band: '#ffae3d', visor: '#2a2016', skin: '#b98b68', face: '#b19a72', rim: '#ffa733' },
};

// ---------- geometry helpers ----------
class RigParts {
  constructor() { this.geos = []; }
  add(geo, color, bone) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const bi = BONE_INDEX[bone];
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    this.geos.push(g);
  }
  box(w, h, d, x, y, z, color, bone, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
    this.add(g, color, bone);
  }
  limb(a, b, r1, r2, color, bone, seg = 8) {
    const dir = b.clone().sub(a); const len = dir.length();
    const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize());
    g.applyQuaternion(q);
    const mid = a.clone().add(b).multiplyScalar(0.5); g.translate(mid.x, mid.y, mid.z);
    this.add(g, color, bone);
  }
  sphere(r, x, y, z, color, bone, sx = 1, sy = 1, sz = 1, seg = 10, phiLen = Math.PI) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(5, Math.floor(seg * 0.7)), 0, Math.PI * 2, 0, phiLen);
    g.scale(sx, sy, sz); g.translate(x, y, z);
    this.add(g, color, bone);
  }
  geometry() {
    const g = mergeGeometries(this.geos, false);
    g.computeVertexNormals();
    return g;
  }
}

function buildOperatorGeometry(team) {
  const P = PALETTE[team];
  const J = PROC_JOINTS;
  const r = new RigParts();
  for (const s of ['R', 'L']) {
    const sg = s === 'R' ? 1 : -1;
    // boots
    r.box(3.8, 3.8, 9.2, sg * 4.7, 1.9, -1.6, P.boot, 'foot' + s);
    r.box(4.0, 1.0, 9.6, sg * 4.7, 0.5, -1.6, '#0c0c0c', 'foot' + s);
    r.limb(V(sg * 4.7, 3, 0.6), V(sg * 4.7, 7.5, 0.4), 2.5, 2.3, P.boot, 'shin' + s);
    // shins + knee pads
    r.limb(V(sg * 4.7, 5, 0.4), V(sg * 4.6, 21, -0.3), 2.5, 3.0, P.uniform, 'shin' + s);
    r.box(3.6, 4.0, 1.4, sg * 4.6, 19.8, -3.0, P.pad, 'shin' + s, 0.1);
    r.sphere(3.0, sg * 4.6, 20.5, -0.3, P.uniform2, 'shin' + s);
    // thighs
    r.limb(V(sg * 4.6, 20, -0.3), V(sg * 4.4, 38, 0), 3.2, 4.3, P.uniform, 'thigh' + s);
    r.box(1.4, 5.0, 4.0, sg * 8.0, 29, 0, P.uniform2, 'thigh' + s); // cargo pocket
    // arms
    r.sphere(3.3, sg * 8.6, 57, 0, P.uniform, 'upperArm' + s);
    r.limb(J['upperArm' + s], J['forearm' + s], 2.8, 2.4, P.uniform, 'upperArm' + s);
    r.box(4.6, 2.0, 5.6, sg * 8.9, 59.2, 0, P.pad, 'upperArm' + s, 0, 0, sg * -0.35); // shoulder pad
    r.limb(J['upperArm' + s].clone().lerp(J['forearm' + s], 0.3), J['upperArm' + s].clone().lerp(J['forearm' + s], 0.42), 2.95, 2.95, P.band, 'upperArm' + s, 10); // team armband
    r.sphere(2.6, J['forearm' + s].x, J['forearm' + s].y, J['forearm' + s].z, P.pad, 'forearm' + s);
    r.limb(J['forearm' + s], J['hand' + s], 2.35, 1.95, P.uniform2, 'forearm' + s);
    r.box(2.6, 4.6, 3.0, J['hand' + s].x, J['hand' + s].y - 2.2, -0.2, P.glove, 'hand' + s);
    r.box(2.2, 2.0, 1.0, J['hand' + s].x + sg * 0.2, J['hand' + s].y - 2.5, -1.9, P.glove, 'hand' + s);
  }
  // pelvis, belt, holster
  r.box(13.2, 7.2, 8.2, 0, 36.2, 0, P.uniform2, 'hips');
  r.box(13.8, 1.8, 8.8, 0, 39.6, 0, '#1e1e1e', 'hips');
  r.box(2.2, 5.6, 3.6, 7.6, 34, 0.6, '#1c1c1c', 'hips');
  r.box(3.2, 2.6, 2.0, -5.5, 38, -4.4, P.pouch, 'hips');
  // torso
  r.box(12.0, 7.6, 7.4, 0, 43.6, 0, P.uniform, 'spine');
  r.box(14.4, 10.5, 8.2, 0, 52.4, 0, P.uniform, 'chest');
  r.box(13.0, 11.5, 1.8, 0, 50.6, -4.6, P.vest, 'chest'); // front plate carrier
  r.box(13.0, 11.5, 1.8, 0, 50.6, 4.6, P.vest, 'chest');
  r.box(14.8, 4.0, 9.6, 0, 46.8, 0, P.vest, 'spine'); // cummerbund
  for (const x of [-3.6, 0, 3.6]) r.box(3.0, 3.8, 1.8, x, 46.6, -6.0, P.pouch, 'spine'); // mag pouches
  r.box(4.4, 3.0, 1.6, -3.8, 53.5, -6.0, P.pouch, 'chest');
  r.box(2.0, 4.6, 1.4, 4.2, 53.6, -5.9, '#1c1c1c', 'chest'); // radio
  r.box(1.0, 1.4, 1.0, 4.2, 56.8, -5.9, '#111', 'chest');
  r.box(10.0, 2.4, 8.2, 0, 58.0, 0, P.uniform2, 'chest'); // collar
  r.box(8, 10, 3, 0, 50.5, 6.6, P.pouch, 'chest'); // hydration pack
  // neck & head
  r.limb(V(0, 58.5, 0), V(0, 62.5, 0), 2.6, 2.4, team === TEAM.T ? P.face : P.skin, 'neck');
  r.sphere(4.4, 0, 65.6, -0.2, team === TEAM.T ? P.face : P.skin, 'head', 0.95, 1.12, 1.0);
  r.box(6.2, 2.0, 1.2, 0, 63.4, -4.1, P.face, 'head'); // balaclava / shemagh lower face
  r.box(7.4, 1.9, 1.0, 0, 66.3, -4.5, P.visor, 'head'); // goggles / visor
  r.box(1.2, 2.8, 2.8, 5.0, 65.4, 0, '#1e1e1e', 'head'); // ear pro
  r.box(1.2, 2.8, 2.8, -5.0, 65.4, 0, '#1e1e1e', 'head');
  r.sphere(5.4, 0, 67.0, 0.3, P.helmet, 'head', 1.0, 0.95, 1.08, 14, Math.PI * 0.55); // helmet shell
  r.box(10.6, 0.9, 1.2, 0, 66.3, 5.4, P.helmet, 'head');
  r.box(3.4, 1.6, 1.0, 0, 70.0, -4.6, '#151515', 'head'); // NVG mount
  r.box(2.0, 3.0, 1.0, 5.6, 68.2, -1.0, P.pad, 'head'); // helmet rail
  r.box(2.0, 3.0, 1.0, -5.6, 68.2, -1.0, P.pad, 'head');
  return r.geometry();
}

// ---------- auto-rig for static meshes ----------
const PARENT = Object.fromEntries(BONES.map(([n, p]) => [n, p]));
function adjacent(a, b) { return PARENT[a] === b || PARENT[b] === a; }

function segDist(px, py, pz, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = px - a.x, apy = py - a.y, apz = pz - a.z;
  const l2 = abx * abx + aby * aby + abz * abz || 1;
  let t = (apx * abx + apy * aby + apz * abz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function autoRigGeometry(geometry, J) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const names = Object.keys(SEG_END);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let b1 = null, d1 = Infinity, b2 = null, d2 = Infinity;
    for (const name of names) {
      const a = J[name], b = J[SEG_END[name]];
      if (!a || !b) continue;
      let d = segDist(x, y, z, a, b) / SEG_RADIUS[name];
      // keep arm/leg sides honest
      if (name.endsWith('R') && x < -1) d += 3; else if (name.endsWith('L') && x > 1) d += 3;
      if (d < d1) { b2 = b1; d2 = d1; b1 = name; d1 = d; } else if (d < d2) { b2 = name; d2 = d; }
    }
    si[i * 4] = BONE_INDEX[b1];
    if (b2 && adjacent(b1, b2)) {
      const p1 = Math.pow(Math.max(d1, 1e-3), 4), p2 = Math.pow(Math.max(d2, 1e-3), 4);
      const w1 = p2 / (p1 + p2);
      si[i * 4 + 1] = BONE_INDEX[b2];
      sw[i * 4] = w1; sw[i * 4 + 1] = 1 - w1;
    } else sw[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
}

function makeSkeleton(J) {
  const bones = {};
  for (const [name, parent] of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const p = J[name].clone();
    if (parent) p.sub(J[parent]);
    b.position.copy(p);
    bones[name] = b;
    if (parent) bones[parent].add(b);
  }
  return bones;
}

function rimify(material, color) {
  material.userData.rimColor = new THREE.Color(color);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: material.userData.rimColor };
    shader.fragmentShader = 'uniform vec3 rimColor;\n' + shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `{ float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
         outgoingLight += rimColor * pow(rim, 3.0) * 0.32; }
       #include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () => 'rim' + color;
  return material;
}

// Build a character template (Group with SkinnedMesh + bones) for a team.
export function buildTemplate(team, quality, soldier) {
  const J = soldier ? soldier.joints : PROC_JOINTS;
  const model = new THREE.Group();
  model.name = 'character';
  const bones = makeSkeleton(J);
  model.add(bones.root);
  model.updateMatrixWorld(true);
  const boneList = BONES.map(([n]) => bones[n]);
  const skeleton = new THREE.Skeleton(boneList);
  const meshes = [];
  const pal = PALETTE[team];
  if (soldier) {
    for (const part of soldier.parts) {
      const g = part.geometry.clone();
      autoRigGeometry(g, J);
      let mat = part.material ? part.material.clone() : new THREE.MeshLambertMaterial({ color: 0x888888 });
      rimify(mat, pal.rim);
      const sm = new THREE.SkinnedMesh(g, mat);
      meshes.push(sm);
    }
    // team colour comes from the rim light (no extra armband meshes on custom soldiers)
  } else {
    const g = buildOperatorGeometry(team);
    const mat = quality === 'low'
      ? new THREE.MeshLambertMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
    rimify(mat, pal.rim);
    meshes.push(new THREE.SkinnedMesh(g, mat));
  }
  for (const m of meshes) {
    m.castShadow = quality !== 'low';
    m.frustumCulled = false;
    model.add(m);
    m.bind(skeleton, m.matrixWorld);
  }
  model.userData.joints = J;
  return model;
}

// ---------- IK helpers ----------
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
function aimBone(bone, childLocalRest, targetDirWorld) {
  bone.parent.getWorldQuaternion(_q);
  _v.copy(childLocalRest).normalize().applyQuaternion(_q);
  _q2.setFromUnitVectors(_v, _v2.copy(targetDirWorld).normalize());
  // local = parentQ^-1 * (delta * parentQ)
  _q2.multiply(_q);
  bone.quaternion.copy(_q.invert().multiply(_q2));
  bone.updateMatrixWorld(true);
}

function twoBoneIK(upper, lower, end, target, pole) {
  const A = upper.getWorldPosition(new THREE.Vector3());
  const sc = upper.getWorldScale(_v3).x;
  const l1 = lower.position.length() * sc, l2 = end.position.length() * sc;
  const toT = target.clone().sub(A);
  let d = toT.length();
  const dir = toT.normalize();
  d = clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pd = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const elbow = A.clone().add(dir.clone().multiplyScalar(a)).add(pd.multiplyScalar(h));
  aimBone(upper, lower.position, elbow.clone().sub(A));
  const T = A.clone().add(dir.multiplyScalar(d));
  aimBone(lower, end.position, T.sub(elbow));
}

// Weapon hold offsets (aim frame relative to shoulder pivot): [x, y, z]
const HOLD = {
  rifle: [4.6, -4.2, -9.5], smg: [4.2, -4.0, -10.5], sniper: [4.4, -3.6, -8.5], pistol: [2.4, -2.6, -16.5],
  knife: [6.5, -12, -9], grenade: [7.5, -4, -7], c4: [0, -11, -10],
};

export class Character {
  constructor(template, team) {
    this.team = team;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.joints = template.userData.joints; // keep Vector3 refs (clone() JSON-copies userData)
    this.model = SkeletonUtils.clone(template);
    this.root.add(this.model);
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.rest = {};
    for (const n in this.bones) this.rest[n] = this.bones[n].position.clone();
    this.weaponHolder = new THREE.Group();
    this.model.add(this.weaponHolder);
    this.weapon = null;
    this.weaponId = null;
    this.phase = 0;
    this.alive = true;
    this.deathT = 0;
    this.kick = 0;
    this.smooth = { speed: 0, mx: 0, mz: 0, duck: 0, air: 0, aim: 0 };
    this.c4 = null;
  }

  setWeapon(id, object) {
    if (this.weapon) this.weaponHolder.remove(this.weapon);
    this.weapon = object; this.weaponId = id;
    if (object) this.weaponHolder.add(object);
  }

  fire() { this.kick = 1; }

  setVisible(v) { this.root.visible = v; }

  /*
   s: { x,y,z,yaw,pitch,duck,vx,vz,onGround,alive,reloading,planting,defusing,nade }
  */
  update(dt, s) {
    const root = this.root;
    root.position.set(s.x, s.y, s.z);
    if (!s.alive) {
      if (this.alive) { this.alive = false; this.deathT = 0; this.deathDir = Math.random() < 0.5 ? 1 : -1; }
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.55);
      const e = k * k * (3 - 2 * k);
      root.rotation.set(e * Math.PI * 0.5 * 0.96, s.yaw, e * 0.25 * this.deathDir);
      root.position.y = s.y + e * 4;
      this.weaponHolder.visible = false;
      return;
    }
    if (!this.alive) { this.alive = true; this.weaponHolder.visible = true; }
    root.rotation.set(0, s.yaw, 0);
    const B = this.bones, R = this.rest;
    const sm = this.smooth;
    // local move velocity
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const fwd = -(s.vx * sy + s.vz * cy); // + forward
    const right = s.vx * cy - s.vz * sy;
    const speed = Math.hypot(s.vx, s.vz);
    sm.speed = damp(sm.speed, speed, 10, dt);
    sm.mx = damp(sm.mx, speed > 5 ? right / speed : 0, 8, dt);
    sm.mz = damp(sm.mz, speed > 5 ? fwd / speed : 1, 8, dt);
    sm.duck = damp(sm.duck, s.duck, 14, dt);
    sm.air = damp(sm.air, s.onGround ? 0 : 1, 10, dt);
    // ready (shouldered) by default like CS2; only lowered a little while sprinting and not shooting
    const aimTarget = s.aiming ? 1 : Math.max(0.35, 1 - Math.max(0, sm.speed - 150) / 140);
    sm.aim = damp(sm.aim, aimTarget, aimTarget > sm.aim ? 14 : 5, dt);
    const wcls = WEAPONS[this.weaponId]?.cls || 'rifle';
    const longGun = wcls === 'rifle' || wcls === 'sniper' || wcls === 'smg';
    // bladed stance: torso turns so the support shoulder leads; head counter-rotates to keep looking forward
    const blade = longGun ? -(0.42 + 0.18 * sm.aim) : wcls === 'pistol' ? -0.12 : wcls === 'knife' ? -0.3 : 0;
    const settle = Math.max(0, 1 - sm.speed / 160); // full stance when standing, softer while running
    const crouch = sm.duck + (s.planting || s.defusing ? 0.8 : 0);
    const cr = Math.min(1, crouch);
    this.phase += (sm.speed * dt) / (cr > 0.5 ? 40 : 58) * Math.PI;
    const strideAmp = Math.min(1, sm.speed / 240) * (cr > 0.5 ? 8 : 13) * (1 - sm.air);

    // hips
    const hipDrop = cr * 13 + Math.abs(Math.sin(this.phase)) * strideAmp * 0.08;
    B.hips.position.set(R.hips.x, R.hips.y - hipDrop, R.hips.z + cr * 2.5);
    B.hips.rotation.set(cr * 0.35, blade * 0.45 * settle, 0);
    // spine aim pitch (+ counter-lean from crouch)
    const pitch = clamp(s.pitch, -1.3, 1.3);
    const bl = blade * (0.55 + 0.45 * settle);
    B.spine.rotation.set(pitch * 0.22 - cr * 0.2 + (longGun ? 0.06 : 0), bl * 0.3 + Math.sin(this.phase) * 0.04 * strideAmp / 13, 0, 'YXZ');
    B.chest.rotation.set(pitch * 0.3 - cr * 0.1, bl * 0.25, 0, 'YXZ');
    B.neck.rotation.set(pitch * 0.15, -bl * 0.45, 0, 'YXZ');
    // cheek weld when aiming a long gun: head tips down and toward the stock
    B.head.rotation.set(pitch * 0.2 + (longGun ? 0.12 * sm.aim : 0), -bl * 0.5, longGun ? -0.18 * sm.aim : 0, 'YXZ');
    this.model.updateMatrixWorld(true);

    // legs IK: foot targets in model space -> world
    for (const side of ['R', 'L']) {
      const sg = side === 'R' ? 1 : -1;
      const ph = this.phase + (side === 'R' ? 0 : Math.PI);
      const swing = Math.sin(ph) * strideAmp;
      const lift = Math.max(0, Math.cos(ph)) * strideAmp * 0.45;
      const stag = (longGun || wcls === 'knife' ? 1 : 0.5) * settle; // support foot forward, strong foot back
      const fx = (this._restModel('foot' + side).x) + sm.mx * swing * 0.6 + sg * cr * 1.5 + sg * 2.2 * stag;
      const fz = this._restModel('foot' + side).z - sm.mz * swing - sm.air * 4 + (cr > 0.5 ? (side === 'R' ? 3 : -5) : 0) + (side === 'R' ? 6 : -6) * stag;
      const fy = this._restModel('foot' + side).y + lift + sm.air * 9;
      const target = this.model.localToWorld(new THREE.Vector3(fx, fy, fz));
      const pole = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion);
      twoBoneIK(B['thigh' + side], B['shin' + side], B['foot' + side], target, pole);
      B['foot' + side].quaternion.identity();
    }

    // weapon socket in model space, anchored to the real shoulder and eye of whatever soldier model is loaded
    const cls = wcls;
    const meta = this.weapon?.userData.meta || {};
    this.kick = Math.max(0, this.kick - dt * 10);
    const shoulderR = this._boneModelPos('upperArmR');
    const head = this._boneModelPos('head');
    const eye = head.clone().add(new THREE.Vector3(0, 3.0, -3.0));
    const aimQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, 0, 'YXZ'));
    // relaxed = hip-fire ready: gun level and pointing where you look, held lower at the chest
    const relaxQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.9 - 0.04, 0.05, 0, 'YXZ'));
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    if (longGun) {
      const rear = meta.rear ?? 11, top = meta.top ?? 3.5;
      // aimed: butt in the shoulder pocket, sights under the eye
      const buttA = new THREE.Vector3(shoulderR.x - 1.4, eye.y - top - 3.2, shoulderR.z - 0.5);
      const posA = buttA.clone().add(new THREE.Vector3(0, 0, -rear).applyQuaternion(aimQ));
      // relaxed (low/patrol ready): butt tucked under the armpit, muzzle forward and slightly down
      const buttR = new THREE.Vector3(shoulderR.x - 2.6, shoulderR.y - 5.5, shoulderR.z - 2.0);
      const posR = buttR.clone().add(new THREE.Vector3(0, 0, -rear).applyQuaternion(relaxQ));
      pos.lerpVectors(posR, posA, sm.aim);
      q.slerpQuaternions(relaxQ, aimQ, sm.aim);
    } else if (cls === 'pistol') {
      const top = meta.top ?? 2.8;
      // aimed: arms extended, sights just below the eye line; relaxed: low ready at chest
      const posA = new THREE.Vector3(1.0, eye.y - top - 3.6, eye.z - 17).sub(eye).applyQuaternion(aimQ).add(eye);
      const posR = new THREE.Vector3(2.0, shoulderR.y - 9, shoulderR.z - 14);
      pos.lerpVectors(posR, posA, sm.aim);
      const pr = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.9 - 0.06, 0, 0, 'YXZ'));
      q.slerpQuaternions(pr, aimQ, sm.aim);
    } else if (cls === 'knife') {
      // natural forward grip: hand in front of the hip, blade angled forward and slightly down
      pos.set(shoulderR.x - 0.5, shoulderR.y - 21, shoulderR.z - 8);
      q.setFromEuler(new THREE.Euler(-0.32, -0.08, 0.1, 'YXZ'));
    } else if (cls === 'grenade') {
      pos.set(shoulderR.x, shoulderR.y - 6, shoulderR.z - 7); q.copy(relaxQ);
    } else {
      pos.set(0, shoulderR.y - 16, shoulderR.z - 10); q.copy(relaxQ);
    }
    let tilt = 0;
    if (s.reloading) { pos.y -= 2; tilt = 0.5; }
    if (s.planting || s.defusing) { pos.y -= 6; pos.z += 2; }
    pos.add(new THREE.Vector3(0, 0, this.kick * 1.4).applyQuaternion(q));
    this.weaponHolder.position.copy(pos);
    this.weaponHolder.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.kick * 0.12, 0, tilt)));
    this.weaponHolder.updateMatrixWorld(true);

    // arms IK to grip points
    const gripR = new THREE.Vector3(0, cls === 'knife' ? -0.3 : -0.6, cls === 'knife' ? 0.2 : 1.2);
    this.weaponHolder.localToWorld(gripR);
    const poleR = new THREE.Vector3(1, longGun ? -1.4 + 1.1 * sm.aim : -1.4, 0.5).applyQuaternion(root.quaternion);
    twoBoneIK(B.upperArmR, B.forearmR, B.handR, gripR, poleR);
    let left, poleL;
    if (meta.left && (cls === 'rifle' || cls === 'sniper' || cls === 'smg' || cls === 'pistol' || cls === 'c4')) {
      left = meta.left.clone();
      if (cls === 'pistol') left.set(-0.9, -1.4, 0.8);
      if (s.reloading) left.add(new THREE.Vector3(0, -3, 6));
      this.weaponHolder.localToWorld(left);
      poleL = new THREE.Vector3(-0.5, -1.4, 0.1).applyQuaternion(root.quaternion);
    } else {
      // free left arm hangs naturally at the side, elbow slightly bent behind
      const sh = this._boneModelPos('upperArmL');
      left = this.model.localToWorld(sh.clone().add(new THREE.Vector3(-0.8, -24, -2.5)));
      poleL = new THREE.Vector3(-0.15, -0.2, 1).applyQuaternion(root.quaternion);
    }
    twoBoneIK(B.upperArmL, B.forearmL, B.handL, left, poleL);
  }

  _restModel(name) {
    if (!this._restCache) this._restCache = {};
    if (!this._restCache[name]) {
      const j = this.joints[name];
      this._restCache[name] = new THREE.Vector3(j.x, j.y, j.z);
    }
    return this._restCache[name];
  }
  _boneModelPos(name) {
    const p = new THREE.Vector3();
    this.bones[name].getWorldPosition(p);
    return this.model.worldToLocal(p);
  }

  attachC4(mesh) {
    if (this.c4 === mesh) return;
    if (this.c4 && this.c4.parent === this.bones.chest) this.bones.chest.remove(this.c4);
    this.c4 = mesh;
    if (mesh) { mesh.position.set(0, -2, 7.2); mesh.rotation.set(Math.PI / 2, 0, 0); this.bones.chest.add(mesh); }
  }

  dispose() {
    this.root.parent?.remove(this.root);
  }
}

// Factory: caches templates per team; rebuilds when soldier asset changes.
export class CharacterFactory {
  constructor(assets) { this.assets = assets; this.templates = {}; this.quality = 'low'; }
  async rebuild(quality) {
    this.quality = quality;
    const soldier = await this.assets.soldierData();
    this.templates[TEAM.CT] = buildTemplate(TEAM.CT, quality, soldier);
    this.templates[TEAM.T] = buildTemplate(TEAM.T, quality, soldier);
    const tune = this.assets.tune('soldier');
    for (const t of Object.values(this.templates)) {
      const m = t;
      m.position.set(tune.x, tune.y, tune.z);
      m.rotation.set(tune.pitch * Math.PI / 180, tune.yaw * Math.PI / 180, tune.roll * Math.PI / 180);
      m.scale.setScalar(tune.scale);
    }
    this.version = (this.version || 0) + 1;
  }
  make(team) { return new Character(this.templates[team] || this.templates[TEAM.CT], team); }
}

export { applyTune };
