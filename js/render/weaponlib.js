// Weapon model library: every gun uses the user's .glb models (rifles/SMGs -> AK-47 model, snipers -> AWP model,
// pistols -> Glock-17 model, knife -> knife model). Procedural meshes are only used for grenades/C4, or as a
// last-resort fallback if a .glb fails to load.
import * as THREE from 'three';
import { proceduralWeapon } from './weaponmodels.js';
import { applyTune } from '../assets.js';

const GLB_SLOT = {
  ak47: 'ak47', m4a1s: 'ak47', mac10: 'ak47', mp9: 'ak47',
  awp: 'awp', ssg08: 'awp',
  glock: 'glock17', usp: 'glock17', p250: 'glock17', deagle: 'glock17',
  knife: 'knife',
};
const PROC_KEY = { glock: 'glock17', usp: 'usp', p250: 'p250', deagle: 'deagle', mac10: 'mac10', mp9: 'mp9', ak47: 'ak47', m4a1s: 'm4a1s', ssg08: 'ssg08', awp: 'awp', knife: 'knife', he: 'he', flash: 'flash', smoke: 'smoke', c4: 'c4' };

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
