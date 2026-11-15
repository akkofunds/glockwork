// First-person viewmodel (rendered in its own pass so it never clips into walls): gloved hands + sleeves,
// weapon bob/sway, recoil kick, draw, reload, knife slash/stab, grenade throw, C4 typing and the
// multi-stage inspect (F) that shows both sides of a gun or wrist-flips/spins the knife.
import * as THREE from 'three';
import { WEAPONS, TEAM } from '../config.js';
import { damp, clamp, DEG } from '../util.js';

const BASE = {
  rifle: { p: [5.2, -6.6, -15.5], r: [0.02, 0.05, 0] },
  smg: { p: [4.8, -6.0, -14], r: [0.02, 0.05, 0] },
  sniper: { p: [5.4, -6.8, -15.5], r: [0.02, 0.04, 0] },
  pistol: { p: [3.9, -5.0, -15.5], r: [0.03, 0.08, 0] },
  knife: { p: [5.4, -6.6, -12.5], r: [0.35, 0.35, -0.25] },
  grenade: { p: [5.0, -5.8, -12.5], r: [0.2, 0.2, 0] },
  c4: { p: [0.8, -7.2, -14], r: [0.5, 0, 0] },
};

const INSPECT_GUN = [
  [0, 0, 0, 0, 0, 0, 0], [0.45, 0.12, 0.95, 0.55, -2.6, 2.2, 2.2], [1.55, 0.18, 1.0, 0.6, -2.6, 2.4, 2.2],
  [2.05, -0.12, -0.75, -0.65, -1.4, 1.8, 2.0], [3.0, -0.1, -0.8, -0.7, -1.4, 1.8, 2.0], [3.5, 0, 0, 0, 0, 0, 0],
];
const TAU = Math.PI * 2;
const INSPECT_KNIFE = [
  [0, 0, 0, 0, 0, 0, 0], [0.35, 0.2, 0.55, 0, -2, 2.5, 1.5], [1.0, 0.2, 0.55, TAU, -2, 2.5, 1.5], [1.35, 0.2, -0.45, TAU, -1, 2.2, 1.5],
  [1.9, 0.2 + TAU, -0.45, TAU, -1, 5.5, 1.5], [2.3, 0.2 + TAU, -0.45, TAU, -1, 2.5, 1.5], [2.8, TAU, 0, TAU, 0, 0, 0],
];

function sampleKeys(keys, t, out) {
  if (t <= keys[0][0]) { for (let i = 0; i < 6; i++) out[i] = keys[0][i + 1]; return out; }
  for (let k = 0; k < keys.length - 1; k++) {
    const a = keys[k], b = keys[k + 1];
    if (t >= a[0] && t <= b[0]) {
      let f = (t - a[0]) / (b[0] - a[0]);
      f = f * f * (3 - 2 * f);
      for (let i = 0; i < 6; i++) out[i] = a[i + 1] + (b[i + 1] - a[i + 1]) * f;
      return out;
    }
  }
  const l = keys[keys.length - 1];
  for (let i = 0; i < 6; i++) out[i] = l[i + 1];
  return out;
}

function muzzleTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.25, 'rgba(255,210,120,0.9)'); g.addColorStop(0.6, 'rgba(255,140,40,0.35)'); g.addColorStop(1, 'rgba(255,100,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.globalCompositeOperation = 'lighter';
  x.fillStyle = 'rgba(255,230,160,0.7)';
  for (let i = 0; i < 6; i++) { x.save(); x.translate(64, 64); x.rotate((i / 6) * TAU); x.beginPath(); x.moveTo(0, -5); x.lineTo(62, 0); x.lineTo(0, 5); x.fill(); x.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class ViewModel {
  constructor(lib) {
    this.lib = lib;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 300);
    this.scene.add(new THREE.HemisphereLight(0xfff3dd, 0x5a4a3a, 1.6));
    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.6); this.sun.position.set(0.4, 1, 0.3); this.scene.add(this.sun);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.holder = new THREE.Group();
    this.root.add(this.holder);
    this.weapon = null;
    this.id = null;
    this.team = TEAM.CT;
    this.t = { draw: 1, drawDur: 0.6, reload: 0, reloadDur: 0, inspect: -1, knife: -1, knifeStab: false, throwT: -1, kick: 0, kickRot: 0 };
    this.bob = 0; this.swayX = 0; this.swayY = 0; this.land = 0; this.duck = 0;
    this.primed = false;
    this._k = new Array(6).fill(0);
    this._buildHands();
    const mt = muzzleTexture();
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: mt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    this.flashT = 0;
    this.libVersion = -1;
  }

  _buildHands() {
    const glove = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.85, metalness: 0.05 });
    const knuckle = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.7 });
    this.sleeveMat = new THREE.MeshStandardMaterial({ color: 0x3b4a5b, roughness: 0.9 });
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);
    const M = (g, m = glove) => new THREE.Mesh(g, m);
    // ---- firing hand: origin = top of the pistol grip, grip runs down (-Y), muzzle toward -Z ----
    const mkGripHand = () => {
      const h = new THREE.Group();
      const palm = M(cap(0.8, 1.7)); palm.scale.set(0.55, 1, 0.95); palm.position.set(0.62, -1.55, 0.45); palm.rotation.x = -0.2; h.add(palm);
      const web = M(cap(0.42, 1.2), knuckle); web.rotation.x = Math.PI / 2; web.position.set(0.55, -0.35, 0.1); h.add(web);
      // middle/ring/pinky wrapped around the front of the grip
      for (let i = 0; i < 3; i++) {
        const ring = M(new THREE.TorusGeometry(0.82 - i * 0.03, 0.33, 6, 14, Math.PI * 1.1));
        ring.rotation.set(-Math.PI / 2, 0, -0.08); ring.scale.set(0.8, 1, 1.1); ring.position.set(0.08, -1.15 - i * 0.66, 0.05 + i * 0.12);
        h.add(ring);
      }
      // thumb along the left side of the grip
      const thumb = M(cap(0.3, 1.5)); thumb.rotation.set(Math.PI / 2 - 0.2, 0.35, 0); thumb.position.set(-0.62, -0.2, -0.35); h.add(thumb);
      // trigger finger: pivots at the knuckle, rests on the trigger, curls back when firing
      const pivot = new THREE.Group(); pivot.position.set(0.32, -0.42, -0.72);
      const f1 = M(cap(0.27, 0.8)); f1.rotation.x = Math.PI / 2; f1.position.set(-0.12, -0.05, -0.55); pivot.add(f1);
      const f2 = M(cap(0.25, 0.55)); f2.rotation.x = Math.PI / 2 + 0.75; f2.position.set(-0.2, -0.38, -1.2); pivot.add(f2);
      h.add(pivot);
      h.userData.trigger = pivot;
      return h;
    };
    // ---- support hand on a handguard (axis along Z): palm underneath, fingers up the left side ----
    const mkGuardHand = () => {
      const h = new THREE.Group();
      const palm = M(cap(0.8, 1.6)); palm.rotation.x = Math.PI / 2; palm.scale.set(1, 1, 0.6); palm.position.set(0.15, -1.25, 0.2); h.add(palm);
      for (let i = 0; i < 4; i++) {
        const ring = M(new THREE.TorusGeometry(1.05, 0.28, 6, 12, Math.PI * 0.95));
        ring.rotation.set(0, 0, Math.PI * 0.62); ring.position.set(0, -0.1, -0.85 + i * 0.6); ring.scale.set(1, 1.05, 1);
        h.add(ring);
      }
      const thumb = M(cap(0.3, 1.3)); thumb.rotation.x = Math.PI / 2; thumb.position.set(1.0, -0.45, -0.3); h.add(thumb);
      return h;
    };
    // ---- knife fist (handle axis along Z) ----
    const mkFist = () => {
      const h = new THREE.Group();
      const palm = M(cap(0.85, 1.7)); palm.rotation.x = Math.PI / 2; palm.scale.set(0.65, 1, 1); palm.position.set(0.95, -0.1, 0.1); h.add(palm);
      for (let i = 0; i < 4; i++) {
        const ring = M(new THREE.TorusGeometry(0.82, 0.3, 6, 12, Math.PI * 1.45));
        ring.rotation.set(0, 0, -Math.PI * 0.55); ring.position.set(0, 0, -1.1 + i * 0.62);
        h.add(ring);
      }
      const thumb = M(cap(0.3, 1.4)); thumb.rotation.x = Math.PI / 2; thumb.position.set(0.25, 0.85, -0.9); h.add(thumb);
      return h;
    };
    this.handR = mkGripHand();
    this.handGuard = mkGuardHand();
    this.handCup = mkGripHand(); this.handCup.scale.x = -1; this.handCup.userData.trigger.visible = false;
    this.fist = mkFist();
    this.handL = this.handGuard;
    const armGeo = new THREE.CylinderGeometry(1.05, 1.5, 1, 14); armGeo.translate(0, 0.5, 0);
    const cuffGeo = new THREE.CylinderGeometry(1.12, 1.12, 1.0, 14);
    this.armR = new THREE.Mesh(armGeo, this.sleeveMat); this.armL = new THREE.Mesh(armGeo, this.sleeveMat);
    this.cuffR = new THREE.Mesh(cuffGeo, glove); this.cuffL = new THREE.Mesh(cuffGeo, glove);
    this.scene.add(this.armR, this.armL, this.cuffR, this.cuffL);
    this.trigT = 0;
  }

  setTeam(team) {
    this.team = team;
    this.sleeveMat.color.set(team === TEAM.T ? 0x8a7452 : 0x3b4a5b);
  }

  setFov(hfovDeg, aspect) {
    this.camera.fov = 2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) * 0.75) / DEG;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setWeapon(id, drawTime) {
    if (id === this.id && this.libVersion === this.lib.version) return;
    this.libVersion = this.lib.version;
    if (this.weapon) this.holder.remove(this.weapon);
    this.id = id;
    this.weapon = id ? this.lib.get(id) : null;
    if (this.weapon) {
      this.weapon.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      this.holder.add(this.weapon);
      this.weapon.add(this.flash);
      const m = this.weapon.userData.meta;
      if (m) this.flash.position.copy(m.muzzle).add(new THREE.Vector3(0, 0, -1.5));
    }
    this.t.draw = 0; this.t.drawDur = drawTime || WEAPONS[id]?.drawTime || 0.6;
    this.t.reload = 0; this.t.reloadDur = 0; this.t.inspect = -1; this.t.knife = -1; this.t.throwT = -1; this.primed = false;
  }

  onFire(cls) {
    this.trigT = 0.11;
    const big = cls === 'sniper' ? 2.4 : cls === 'pistol' ? 1.2 : cls === 'smg' ? 0.8 : 1.0;
    this.t.kick = Math.min(3, this.t.kick + 1.4 * big);
    this.t.kickRot = Math.min(0.35, this.t.kickRot + 0.05 * big);
    this.t.inspect = -1;
    this.flashT = 0.05;
    this.flash.visible = true;
    const s = 4 + Math.random() * 3 * (cls === 'sniper' ? 1.8 : 1);
    this.flash.scale.set(s, s, s);
    this.flash.rotation.z = Math.random() * TAU;
  }
  onReload(dur) { this.t.reload = 0.0001; this.t.reloadDur = dur; this.t.inspect = -1; }
  cancelReload() { this.t.reloadDur = 0; this.t.reload = 0; }
  onInspect() { if (this.t.draw >= this.t.drawDur && this.t.reloadDur === 0) this.t.inspect = 0; }
  onKnife(stab) { this.t.knife = 0; this.t.knifeStab = stab; this.t.inspect = -1; }
  onThrow() { this.t.throwT = 0; this.primed = false; }
  onLand(speed) { this.land = Math.min(3, speed / 200); }

  /*
   st: { speed, onGround, duck, lookDX, lookDY, scoped, planting, defusing, primed, visible }
  */
  update(dt, st) {
    const t = this.t;
    this.root.visible = !!(st.visible && this.weapon && !st.scoped);
    this.armR.visible = this.armL.visible = this.cuffR.visible = this.cuffL.visible = this.root.visible;
    if (!this.weapon) return;
    const cls = WEAPONS[this.id]?.cls || 'rifle';
    const base = BASE[cls] || BASE.rifle;
    t.draw = Math.min(t.drawDur, t.draw + dt);
    // bob & sway
    const sp = st.onGround ? Math.min(1.2, st.speed / 250) : 0;
    this.bob += dt * (3 + sp * 9) * (sp > 0.05 ? 1 : 0.3);
    this.swayX = damp(this.swayX, clamp(-st.lookDX * 0.012, -1.6, 1.6), 9, dt);
    this.swayY = damp(this.swayY, clamp(st.lookDY * 0.012, -1.2, 1.2), 9, dt);
    this.land = damp(this.land, 0, 6, dt);
    this.duck = damp(this.duck, st.duck, 10, dt);
    t.kick = damp(t.kick, 0, 16, dt);
    t.kickRot = damp(t.kickRot, 0, 12, dt);
    let px = base.p[0] + Math.sin(this.bob) * 0.32 * sp + this.swayX;
    let py = base.p[1] - Math.abs(Math.cos(this.bob)) * 0.28 * sp - this.swayY - this.land * 0.9 - this.duck * 0.4;
    let pz = base.p[2] + t.kick;
    let rx = base.r[0] + t.kickRot + this.swayY * 0.03, ry = base.r[1] + this.swayX * 0.04, rz = base.r[2] + Math.sin(this.bob) * 0.02 * sp;
    // draw
    if (t.draw < t.drawDur) {
      const e = 1 - Math.pow(1 - t.draw / t.drawDur, 3);
      py -= (1 - e) * 10; rx -= (1 - e) * 0.9; rz += (1 - e) * 0.3;
    }
    // reload
    let leftDrop = 0;
    if (t.reloadDur > 0) {
      t.reload += dt;
      const f = t.reload / t.reloadDur;
      if (f >= 1) { t.reloadDur = 0; t.reload = 0; }
      else {
        const inF = Math.min(1, f / 0.15), outF = Math.min(1, (1 - f) / 0.18);
        const k = Math.min(inF, outF);
        const e = k * k * (3 - 2 * k);
        rx -= 0.28 * e; rz += 0.55 * e; py -= 2.0 * e; px -= 1.0 * e;
        leftDrop = Math.sin(Math.min(1, f / 0.8) * Math.PI) * e;
      }
    }
    // inspect
    if (t.inspect >= 0) {
      t.inspect += dt;
      const keys = cls === 'knife' ? INSPECT_KNIFE : INSPECT_GUN;
      if (t.inspect >= keys[keys.length - 1][0]) t.inspect = -1;
      else {
        const k = sampleKeys(keys, t.inspect, this._k);
        rx += k[0]; ry += k[1]; rz += k[2]; px += k[3]; py += k[4]; pz += k[5];
      }
    }
    // knife attacks
    if (t.knife >= 0) {
      t.knife += dt;
      const dur = t.knifeStab ? 0.65 : 0.38;
      const f = t.knife / dur;
      if (f >= 1) t.knife = -1;
      else if (t.knifeStab) {
        const e = Math.sin(f * Math.PI);
        pz -= 8 * e; py += 1.5 * e; rx -= 0.5 * e; px -= 2 * e;
      } else {
        const e = Math.sin(f * Math.PI);
        px += (1 - f * 2) * 4 * e; ry += (0.9 - f * 1.8) * e; rz -= 0.6 * e; pz -= 3 * e;
      }
    }
    // grenade
    if (cls === 'grenade') {
      if (st.primed) { py += 2.5; pz += 3; rx -= 0.5; px += 1; }
      if (t.throwT >= 0) {
        t.throwT += dt;
        const f = Math.min(1, t.throwT / 0.3);
        pz -= 10 * f; py += 4 * Math.sin(f * Math.PI); rx += 0.9 * f;
        if (f >= 1) { this.holder.visible = false; }
      } else this.holder.visible = true;
    } else this.holder.visible = true;
    if (cls === 'c4' && st.planting) { py -= 1.5 + Math.abs(Math.sin(performance.now() * 0.012)) * 0.4; pz += 1; }
    if (st.defusing) { py -= 4; rx -= 0.4; }

    this.holder.position.set(px, py, pz);
    this.holder.rotation.set(rx, ry, rz, 'YXZ');
    // muzzle flash
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }

    // hands
    this.root.updateMatrixWorld(true);
    const meta = this.weapon.userData.meta || {};
    const L = meta.length || 12;
    for (const hnd of [this.handR, this.handGuard, this.handCup, this.fist]) if (hnd.parent !== this.weapon) this.weapon.add(hnd);
    this.handGuard.visible = this.handCup.visible = this.fist.visible = false;
    this.trigT = Math.max(0, this.trigT - dt);
    const pull = this.trigT > 0 ? Math.sin((1 - this.trigT / 0.11) * Math.PI) : 0;
    this.handR.userData.trigger.rotation.x = pull * 0.55;
    if (cls === 'knife') {
      // fist around the handle (handle sits just behind the grip origin), thumb along the spine
      this.handR.visible = false;
      this.fist.visible = true;
      this.fist.position.set(0, 0.25, -0.2);
      this.fist.rotation.set(0, 0, 0);
      this.handL = this.fist;
    } else {
      this.handR.visible = true;
      this.handR.position.set(0, 0, 0);
      this.handR.rotation.set(cls === 'pistol' ? -0.22 : -0.28, 0, 0);
      this.handL = this.handR;
    }
    let left = null;
    if (meta.left && (cls === 'rifle' || cls === 'smg' || cls === 'sniper')) {
      left = this.handGuard;
      left.position.copy(meta.left).add(new THREE.Vector3(0, -0.2 - leftDrop * 4, leftDrop * 5));
      left.rotation.set(0, 0, 0);
    } else if (cls === 'pistol') {
      left = this.handCup;
      left.position.set(-0.35, -0.55, 0.35);
      left.rotation.set(-0.22, 0.05, 0.04);
      left.scale.set(-0.96, 0.96, 0.96);
    } else if (cls === 'c4') {
      left = this.handGuard;
      left.position.set(-2.6, -0.4, 1.0); left.rotation.set(0, 0, 0.6);
    }
    if (left) left.visible = this.root.visible;
    this.leftHand = left;
    this.rightHand = cls === 'knife' ? this.fist : this.handR;
    this.weapon.updateMatrixWorld(true);
    this._arm(this.rightHand, this.armR, this.cuffR, new THREE.Vector3(10, -15, 4), true, cls === 'knife');
    if (this.leftHand) this._arm(this.leftHand, this.armL, this.cuffL, new THREE.Vector3(cls === 'pistol' ? -3 : -8, -15, 4), this.root.visible, this.leftHand === this.handGuard);
    else this.armL.visible = this.cuffL.visible = false;
  }

  _arm(hand, arm, cuff, elbow, visible, axial = false) {
    arm.visible = cuff.visible = visible && this.holder.visible;
    if (!arm.visible) return;
    // wrist: behind the palm (grip hands) or under/behind the fist (hands around a horizontal axis)
    const w = axial ? new THREE.Vector3(0.6, -1.2, 1.9) : new THREE.Vector3(0.8, -2.6, 1.3);
    hand.localToWorld(w);
    const dir = elbow.clone().sub(w);
    const len = dir.length();
    arm.position.copy(w);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    arm.scale.set(1, len, 1);
    cuff.position.copy(w).add(dir.clone().multiplyScalar(0.6));
    cuff.quaternion.copy(arm.quaternion);
  }

  // Muzzle position in camera space (for tracer origin approximation)
  muzzleCameraSpace(out) {
    if (!this.weapon || !this.weapon.userData.meta) return out.set(4, -4, -20);
    out.copy(this.weapon.userData.meta.muzzle);
    this.weapon.localToWorld(out);
    return out;
  }
  ejectCameraSpace(out) {
    if (!this.weapon || !this.weapon.userData.meta) return out.set(5, -3, -10);
    out.copy(this.weapon.userData.meta.eject);
    this.weapon.localToWorld(out);
    return out;
  }
}
