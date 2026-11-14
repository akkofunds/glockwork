// WebGL renderer setup with graphics presets, adaptive resolution, sky, fog, lighting and the two-pass
// (world + viewmodel) render.
import * as THREE from 'three';
import { DEG } from '../util.js';

export const PRESETS = {
  low: { label: 'Competitive Low', maxPixelRatio: 1.0, shadows: false, antialias: false, toneMapping: false, far: 9000, adaptive: true, minScale: 0.6 },
  medium: { label: 'Medium', maxPixelRatio: 1.25, shadows: true, antialias: true, toneMapping: true, far: 12000, adaptive: true, minScale: 0.75 },
  high: { label: 'High', maxPixelRatio: 2.0, shadows: true, antialias: true, toneMapping: true, far: 14000, adaptive: false, minScale: 1 },
};

export class GameRenderer {
  constructor(canvas, quality) {
    this.canvas = canvas;
    this.quality = quality;
    this.preset = PRESETS[quality];
    this.scale = 1;
    this._create();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, 1, 1, this.preset.far);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.hfov = 90;
    this._setupEnvironment();
    this.frameTimes = [];
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }

  _create() {
    const p = this.preset;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: p.antialias, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = p.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = p.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
  }

  _setupEnvironment() {
    const s = this.scene;
    const fogCol = new THREE.Color(0xd9c9ad);
    s.fog = new THREE.Fog(fogCol, 2500, this.preset.far * 0.9);
    s.background = fogCol;
    // sky dome
    const skyGeo = new THREE.SphereGeometry(this.preset.far * 0.8, 24, 12);
    const cols = [];
    const top = new THREE.Color(0x5e8fc9), mid = new THREE.Color(0xbfd4e6), hor = new THREE.Color(0xe8d8bb);
    const pos = skyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / (this.preset.far * 0.8);
      const c = y > 0.25 ? mid.clone().lerp(top, Math.min(1, (y - 0.25) / 0.6)) : hor.clone().lerp(mid, Math.max(0, y / 0.25));
      cols.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    s.add(this.sky);
    this.hemi = new THREE.HemisphereLight(0xd6e4ff, 0x9a7a52, this.quality === 'low' ? 1.25 : 1.05);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, this.quality === 'low' ? 1.6 : 2.2);
    this.sun.position.set(1200, 2600, 900);
    this.sun.target.position.set(0, 0, 0);
    s.add(this.sun, this.sun.target);
    if (this.preset.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      const cam = this.sun.shadow.camera;
      cam.left = -1400; cam.right = 1400; cam.top = 1400; cam.bottom = -1400; cam.near = 100; cam.far = 6000;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 2;
    }
  }

  setFov(hfov) {
    this.hfov = hfov;
    this.applyZoom(1);
  }
  // CS-style: horizontal FOV defined at 4:3, so vertical FOV is fixed regardless of aspect
  applyZoom(zoomHfov) {
    const h = zoomHfov && zoomHfov !== 1 ? zoomHfov : this.hfov;
    this.camera.fov = 2 * Math.atan(Math.tan((h * DEG) / 2) * 0.75) / DEG;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio) * this.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.aspect = w / h;
    if (this.onResize) this.onResize(w, h);
  }

  // Adaptive resolution keeps frame time under ~16.6 ms on weak GPUs
  adapt(dt) {
    if (!this.preset.adaptive) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let ns = this.scale;
    if (avg > 1 / 50) ns = Math.max(this.preset.minScale, this.scale - 0.1);
    else if (avg < 1 / 58 && this.scale < 1) ns = Math.min(1, this.scale + 0.05);
    if (ns !== this.scale) { this.scale = ns; this.resize(); }
  }

  followShadow(x, z) {
    if (!this.preset.shadows) return;
    const sx = Math.round(x / 64) * 64, sz = Math.round(z / 64) * 64;
    this.sun.position.set(sx + 1200, 2600, sz + 900);
    this.sun.target.position.set(sx, 0, sz);
  }

  render(viewmodel) {
    const r = this.renderer;
    r.info.reset();
    r.clear();
    this.sky.position.copy(this.camera.position);
    r.render(this.scene, this.camera);
    if (viewmodel && viewmodel.root.visible) {
      r.clearDepth();
      r.render(viewmodel.scene, viewmodel.camera);
    }
  }

  dispose() {
    window.removeEventListener('resize', this._resize);
    this.renderer.dispose();
  }
}
