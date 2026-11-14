// Weapon model library: every gun uses the provided .glb models (Glock-17, AK-47, AWP, knife).
import * as THREE from 'three';
import { proceduralWeapon } from './weaponmodels.js';
import { applyTune } from '../assets.js';

const GLB_SLOT = { ak47: 'ak47', awp: 'awp', glock: 'glock17', knife: 'knife' };
// procedural meshes: grenades/C4 always; guns only if a .glb fails to load
const PROC_KEY = { glock: 'glock17', ak47: 'ak47', awp: 'awp', knife: 'knife', he: 'he', flash: 'flash', smoke: 'smoke', c4: 'c4' };

export class WeaponLibrary {
  constructor(assets) {
    this.assets = assets;
    this.templates = {};
    this.quality = 'low';
    this.version = 0;
  }
  matFactory() {
    return this.quality === 'low'
      ? () => new THREE.MeshLambertMaterial({ vertexColors: true })
      : () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  }
  async load(quality) {
    this.quality = quality;
    this._procMat = null;
    const mf = this.matFactory();
    const shared = mf();
    this._procMat = shared;
    for (const id of Object.keys(PROC_KEY)) {
      let t = null;
      if (GLB_SLOT[id]) {
        const g = await this.assets.weaponTemplate(GLB_SLOT[id]);
        if (g) { t = g; t.userData.tuneSlot = GLB_SLOT[id]; }
      }
      if (!t) t = proceduralWeapon(PROC_KEY[id], () => shared);
      this.templates[id] = t;
    }
    this.refreshTunes();
    this.version++;
  }
  refreshTunes() {
    for (const t of Object.values(this.templates)) {
      if (t.userData.tuneSlot) applyTune(t, this.assets.tune(t.userData.tuneSlot));
    }
    this.version++;
  }
  // Returns a new Object3D sharing geometry/materials with the template.
  get(id) {
    const t = this.templates[id] || this.templates.knife;
    if (!t) return new THREE.Group();
    const c = t.clone(true);
    c.userData = { ...t.userData };
    return c;
  }
}
