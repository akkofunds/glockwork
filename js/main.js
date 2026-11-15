// Flashpoint — application bootstrap, game loop, match lifecycle (practice / private / public queue),
// host ticker (Web Worker heartbeat so a backgrounded host keeps simulating) and input routing.
import * as THREE from 'three';
import { loadSettings, saveSettings } from './settings.js';
import { AssetManager, idbGet, idbPut, hashBytes } from './assets.js';
import { Matchmaker } from './net/matchmaking.js';
import { MapManager, finalizeConfig } from './world/mapmanager.js';
import { GameRenderer } from './render/renderer.js';
import { ViewModel } from './render/viewmodel.js';
import { Effects } from './render/effects.js';
import { WeaponLibrary } from './render/weaponlib.js';
import { CharacterFactory } from './render/character.js';
import { AudioSystem } from './audio.js';
import { Input } from './input.js';
import { TouchControls } from './touch.js';
import { HUD } from './ui/hud.js';
import { BuyMenu } from './ui/buymenu.js';
import { Menus } from './ui/menus.js';
import { Host } from './net/host.js';
import { GameClient } from './net/client.js';
import { TICK_RATE } from './config.js';
import { isTouchDevice, escapeHtml } from './util.js';

const $ = (id) => document.getElementById(id);

// In-page link pair used when this browser is the match host (zero-latency loopback).
function loopPair() {
  const mk = () => ({ local: true, open: true, closed: false, onMessage: null, onClose: null, peer: null,
    send(d) { if (this.closed) return false; const data = typeof d === 'string' || d instanceof ArrayBuffer ? d : JSON.stringify(d); const p = this.peer; queueMicrotask(() => { if (!p.closed && p.onMessage) p.onMessage(data, p); }); return true; },
    sendFast(d) { return this.send(d); },
    close() { if (this.closed) return; this.closed = true; const p = this.peer; if (!p.closed) { p.closed = true; p.onClose && p.onClose(p); } } });
  const a = mk(), b = mk(); a.peer = b; b.peer = a;
  return [a, b];
}

class App {
  constructor() {
    this.settings = loadSettings();
    this.assets = new AssetManager();
    this.assets.quality = this.settings.quality;
    this.mm = new Matchmaker();
    this.mm.name = this.settings.name;
    this.mapManager = new MapManager();
    this.renderer = new GameRenderer($('game'), this.settings.quality);
    this.weaponLib = new WeaponLibrary(this.assets);
    this.viewmodel = new ViewModel(this.weaponLib);
    this.effects = new Effects(this.renderer.scene, this.settings.quality);
    this.effects.setNadeFactory((type) => this.weaponLib.get(type));
    this.charFactory = new CharacterFactory(this.assets);
    this.audio = new AudioSystem();
    this.audio.quality = this.settings.quality;
    this.audio.setVolume(this.settings.volume);
    this.input = new Input($('game'));
    this.hud = new HUD(this.settings);
    this.buyMenu = new BuyMenu((i) => this.client?.buy(i), (i) => this.client?.refund(i));
    this.menus = new Menus(this);
    this.client = null; this.host = null; this.map = null;
    this.markersOn = false;
    this.chatOpen = false;
    this.fps = { frames: 0, t: 0, val: 0 };
    if (isTouchDevice()) {
      this.touch = new TouchControls($('touch'), (a, down) => this._action(a, down));
      this.touch.sens = this.settings.touchSensitivity;
      this.input.touch = this.touch;
      this.touch.show(false);
      document.body.classList.add('is-touch');
    }
    this.input.onAction = (a, down, e) => this._action(a, down, e);
    this.input.onLockChange = (locked) => {
      if (!locked) this._unlockAt = performance.now();
      $('clickplay').classList.toggle('hidden', locked || !this.client);
      if (!this.client) return;
      if (!locked && !this.buyMenu.open && !this.chatOpen && !this.menus.escOpen && !this.input.touch) this.menus.openEsc();
    };
    this.renderer.onResize = () => this.viewmodel.setFov(this.settings.vmFov, this.renderer.aspect);
    this.applySettings();
    this.assets.onChange((slot, tuneOnly) => this._onAssetChange(slot, tuneOnly));
    $('game').addEventListener('click', () => { this.audio.init(); if (this.client && !this.uiBlocking()) this.input.requestLock(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.audio.init(); });
    $('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = e.target.value.trim(); if (v && this.client) this.client.chat(v, this.chatTeam); this.closeChat(); }
      else if (e.key === 'Escape') this.closeChat();
      e.stopPropagation();
    });
    this.last = performance.now();
    this._loop = this._loop.bind(this);
  }

  async init() {
    $('boot-msg').textContent = 'Loading defaults…';
    await this.assets.loadManifest();
    $('boot-msg').textContent = 'Loading weapons…';
    await this.weaponLib.load(this.settings.quality);
    $('boot-msg').textContent = 'Preparing operators…';
    await this.charFactory.rebuild(this.settings.quality);
    $('boot').classList.add('hidden');
    this.menus.showMain();
    this.mm.on('match', (m) => this.startMatch(m));
    this._ensureOwnMap(true).catch((e) => console.warn('map preload', e));
    // party invite links
    const code = new URLSearchParams(location.search).get('party');
    if (code) {
      this.menus.toast('Joining party ' + code.toUpperCase() + '…');
      this.mm.joinParty(code).catch((e) => this.menus.toast(e.type === 'peer-unavailable' ? 'Party not found or expired' : (e.message || 'Could not join party'), 'warn'));
    }
    requestAnimationFrame(this._loop);
  }

  applySettings() {
    const s = this.settings;
    this.renderer.setFov(s.fov);
    this.viewmodel.setFov(s.vmFov, this.renderer.aspect);
    this.audio.setVolume(s.volume);
    if (this.touch) this.touch.sens = s.touchSensitivity;
    $('fps').classList.toggle('hidden', !s.showFps);
    this.hud.lastXhair = '';
  }

  changeQuality(q) {
    // Antialiasing / shadow maps require a fresh WebGL context; reload keeps everything consistent.
    saveSettings(this.settings);
    if (this.client) { this.menus.toast('New graphics preset applies after this match'); return; }
    location.reload();
  }

  async _onAssetChange(slot, tuneOnly) {
    if (slot === 'soldier') { await this.charFactory.rebuild(this.settings.quality); return; }
    if (slot === 'map') { if (this.map) this.map.own = false; return; }
    if (tuneOnly) this.weaponLib.refreshTunes();
    else await this.weaponLib.load(this.settings.quality);
  }
  async reloadModels(slot) { await this._onAssetChange(slot, false); }

  uiBlocking() { return this.menus.escOpen || this.buyMenu.open || this.chatOpen || !this.client; }

  resume() {
    this.menus.closeEsc();
    if (!this.input.touch) this.input.requestLock();
  }

  openChat(team) {
    if (!this.client) return;
    this.chatOpen = true; this.chatTeam = team;
    const i = $('chat-input'); i.classList.remove('hidden'); i.placeholder = team ? 'Team chat…' : 'Chat…'; i.value = '';
    this.input.exitLock();
    setTimeout(() => i.focus(), 0);
  }
  closeChat() {
    this.chatOpen = false;
    $('chat-input').classList.add('hidden'); $('chat-input').blur();
    if (this.client && !this.input.touch) this.input.requestLock();
  }
  chatLine(name, text, team) {
    const log = $('chat-log');
    const d = document.createElement('div');
    d.innerHTML = name ? `<b class="${team === 2 ? 't' : team === 1 ? 'ct' : ''}">${escapeHtml(name)}${team ? ' (team)' : ''}:</b> ${escapeHtml(text)}` : `<i>${escapeHtml(text)}</i>`;
    log.appendChild(d);
    while (log.children.length > 6) log.removeChild(log.firstChild);
    setTimeout(() => d.classList.add('fade'), 8000);
  }

  _action(a, down, e) {
    const c = this.client;
    if (!down) {
      if (a === 'scores') this.hud.showScoreboard(false);
      return;
    }
    if (a === 'menu') {
      if (this.chatOpen) return this.closeChat();
      if (performance.now() - (this._unlockAt || 0) < 350 && this.menus.escOpen) return; // Esc that just released pointer lock
      if (this.buyMenu.open) { this.buyMenu.toggle(false); if (!this.input.touch) this.input.requestLock(); return; }
      if (!c) { if (this.menus.escOpen) this.menus.closeEsc(); return; }
      if (this.menus.escOpen) this.resume(); else { this.input.exitLock(); this.menus.openEsc(); }
      return;
    }
    if (!c || !c.ready || this.chatOpen) return;
    if (this.menus.escOpen) return;
    if (this.buyMenu.open && /^slot(\d)$/.test(a)) { this.buyMenu.key(+a.slice(4)); return; }
    switch (a) {
      case 'slot1': c.selectSlot(1); break;
      case 'slot2': c.selectSlot(2); break;
      case 'slot3': c.selectSlot(3); break;
      case 'slot4': c.selectSlot(4); break;
      case 'slot5': c.selectSlot(5); break;
      case 'lastweapon': c.selectSlot('last'); break;
      case 'nextweapon': c.selectSlot('next'); break;
      case 'inspect': c.inspect(); break;
      case 'scores': this.hud.showScoreboard(true); break;
      case 'buy': {
        if (!c.ps.alive) break;
        const open = !this.buyMenu.open;
        this.buyMenu.toggle(open);
        if (open) this.input.exitLock(); else if (!this.input.touch) this.input.requestLock();
        break;
      }
      case 'chat': if (e) e.preventDefault(); this.openChat(false); break;
      case 'teamchat': if (e) e.preventDefault(); this.openChat(true); break;
      case 'attack': if (c.ps && !c.ps.alive) c.cycleSpectate(); break;
    }
  }

  showLoading(text) { $('loading').classList.remove('hidden'); $('loading-text').textContent = text; }
  hideLoading() { $('loading').classList.add('hidden'); }

  // ---------- maps ----------
  // The map this browser hosts with: a Model-Manager map, else the repo default from manifest.json, else Dunewatch.
  async _myMap() {
    const src = await this.assets.getBytes('map');
    if (!src) return this.mapManager.buildBuiltin(this.renderer.renderer, this.settings.quality);
    const fallback = this.assets.slotConfig('map').source === 'default' ? this.assets.manifest.mapConfig || null : null;
    const m = await this.mapManager.buildGLB(src.bytes, this.settings.quality, this.assets.manifest.mapName || src.name || 'Custom Map', null, fallback);
    if (src.url) m.desc.url = src.url; // clients fetch repo maps straight from the site
    await idbPut('map_' + m.hash, { bytes: src.bytes, name: src.name });
    return m;
  }

  async hostMapDesc() {
    const m = await this._ensureOwnMap();
    return m.desc;
  }

  async _ensureOwnMap(quiet = false) {
    if (this.map && this.map.own) return this.map;
    if (this._mapPromise) { if (!quiet) this.showLoading('Building map…'); const m = await this._mapPromise; if (!quiet) this.hideLoading(); return m; }
    if (!quiet) this.showLoading('Building map…');
    this._mapPromise = this._myMap().then((m) => { m.own = true; this._installMap(m); return m; }).finally(() => { this._mapPromise = null; });
    const m = await this._mapPromise;
    if (!quiet) this.hideLoading();
    return m;
  }

  _installMap(m) {
    if (this._mapRoot && this._mapRoot !== m.root) this.renderer.scene.remove(this._mapRoot);
    this._mapRoot = m.root;
    this.map = m;
    if (!m.root.parent) this.renderer.scene.add(m.root);
    try { this.hud.setRadarImage(this.mapManager.renderRadar(this.renderer, m.root, m.world, this.settings.quality === 'low' ? 256 : 512)); } catch (e) { console.warn('radar', e); }
    if (this.markersOn) this.markers(true);
  }

  async ensureMap(desc, cfg, requestBytes) {
    if (this.map && this.map.desc.kind === desc.kind && (desc.kind === 'builtin' || this.map.desc.hash === desc.hash)) {
      if (cfg) this.map.config = finalizeConfig(cfg, this.map.world);
      return this.map;
    }
    let m;
    if (desc.kind === 'builtin') m = await this.mapManager.buildBuiltin(this.renderer.renderer, this.settings.quality);
    else {
      let rec = await idbGet('map_' + desc.hash);
      let bytes = rec?.bytes;
      if (!bytes && desc.url) {
        try { const r = await fetch(desc.url); if (r.ok) { const b = await r.arrayBuffer(); if (await hashBytes(b) === desc.hash) bytes = b; } } catch { /* fall back to host stream */ }
      }
      if (!bytes) {
        bytes = await requestBytes();
        const h = await hashBytes(bytes);
        if (h !== desc.hash) throw new Error('Map transfer corrupted');
        await idbPut('map_' + desc.hash, { bytes, name: desc.name });
      }
      m = await this.mapManager.buildGLB(bytes, this.settings.quality, desc.name, cfg);
    }
    if (cfg) m.config = finalizeConfig(cfg, m.world);
    this._installMap(m);
    return m;
  }

  refreshSpawns() {
    if (!this.map) return;
    this.map.config = finalizeConfig(this.map.config, this.map.world);
    if (this.host) this.host.cfg = this.map.config;
    if (this.client) this.client.cfg = this.map.config;
  }
  markers(on) {
    this.markersOn = on;
    this.mapManager.showMarkers(this.renderer.scene, this.map?.config, on);
  }

  // ---------- match lifecycle ----------
  _startTicker() {
    this._stopTicker();
    const src = `let t=null;onmessage=(e)=>{if(e.data==='start'){clearInterval(t);t=setInterval(()=>postMessage(0),${Math.floor(1000 / TICK_RATE / 2)});}else{clearInterval(t);}}`;
    try {
      this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.ticker.onmessage = () => this._hostTick();
      this.ticker.postMessage('start');
    } catch {
      this.ticker = { iv: setInterval(() => this._hostTick(), 1000 / TICK_RATE / 2), terminate() { clearInterval(this.iv); } };
    }
    this.hostAcc = 0; this.hostLast = performance.now();
  }
  _stopTicker() { if (this.ticker) { this.ticker.terminate(); this.ticker = null; } }
  _hostTick() {
    if (!this.host) return;
    const now = performance.now();
    this.hostAcc += Math.min(250, now - this.hostLast);
    this.hostLast = now;
    const step = 1000 / TICK_RATE;
    let n = 0;
    while (this.hostAcc >= step && n < 8) { this.hostAcc -= step; this.host.update(); n++; }
    if (n === 8) this.hostAcc = 0;
  }

  async startPractice() {
    await this._teardown();
    this.menus.hideMain();
    this.menus.closeEsc();
    try {
      const map = await this._ensureOwnMap();
      this.host = new Host({ mode: 'practice', roster: [], world: map.world, map: { desc: map.desc, config: map.config, bytes: map.bytes } });
      this.host.onEnd = () => this.leaveMatch(null);
      const [hl, cl] = loopPair();
      this.host.addLink(hl);
      this._startTicker();
      this.client = new GameClient(this, cl, { mode: 'practice', isHost: true, peerId: 'local' });
    } catch (e) {
      console.error(e);
      this.leaveMatch('Could not start practice: ' + (e.message || e));
    }
  }

  async startMatch(match) {
    this.menus.renderFound(null);
    await this._teardown();
    this.mm.leaveQueue();
    this.menus.hideMain();
    this.showLoading('Match found! Connecting…');
    this.audio.init();
    this.audio.play('roundStart', 0.6);
    try {
      if (match.hostId === this.mm.myId) {
        const map = await this._ensureOwnMap();
        this.host = new Host({ mode: match.mode, rules: match.rules || (match.mode === 'tdm' ? 'tdm' : 'defusal'), roster: match.roster, world: map.world, map: { desc: map.desc, config: map.config, bytes: map.bytes } });
        this.host.onEnd = () => this.leaveMatch(null);
        this.mm.gameLinkHandler = (link) => this.host && this.host.addLink(link);
        const [hl, cl] = loopPair();
        this.host.addLink(hl);
        this._startTicker();
        this.client = new GameClient(this, cl, { mode: match.mode, isHost: true, peerId: this.mm.myId });
      } else {
        let link = null, err = null;
        for (let i = 0; i < 4 && !link; i++) {
          try { link = await this.mm.connectToHost(match.hostId, { name: this.settings.name }); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 1200)); }
        }
        if (!link) throw err || new Error('Could not reach host');
        this.client = new GameClient(this, link, { mode: match.mode, isHost: false, peerId: this.mm.myId });
      }
    } catch (e) {
      console.error(e);
      this.leaveMatch('Could not connect to match: ' + (e.message || e.type || e));
    }
  }

  onClientReady(client) {
    this.menus.renderFound(null);
    this.hud.show(true);
    this.viewmodel.setTeam(client.ps.team);
    if (this.touch) this.touch.show(true);
    else this.input.requestLock();
    $('clickplay').classList.toggle('hidden', !!this.touch || this.input.locked);
    this.hud.clearKillfeed();
  }

  async _teardown() {
    this._stopTicker();
    if (this.client) { this.client.destroy(); this.client.link.close && this.client.link.close(); this.client = null; }
    if (this.host) { this.host.destroy(); this.host = null; }
    this.mm.gameLinkHandler = null;
    this.buyMenu.toggle(false);
    this.hud.showScoreboard(false);
    this.hud.show(false);
    if (this.touch) this.touch.show(false);
    $('clickplay').classList.add('hidden');
    this.viewmodel.setWeapon(null);
  }

  async leaveMatch(reason) {
    this.menus.renderFound(null);
    if (this._leaving) return;
    this._leaving = true;
    try {
      await this._teardown();
      this.input.exitLock();
      this.hideLoading();
      this.menus.closeEsc();
      this.menus.showMain(reason);
    } finally { this._leaving = false; }
  }

  // ---------- frame loop ----------
  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.client) {
      this.client.frame(dt);
      this.renderer.render(this.client.ready ? this.viewmodel : null);
    } else {
      this._lobbyFrame(dt);
    }
    this.renderer.adapt(dt);
    // fps
    const f = this.fps; f.frames++; f.t += dt;
    if (f.t >= 0.5) {
      f.val = Math.round(f.frames / f.t); f.frames = 0; f.t = 0;
      if (this.settings.showFps) { const i = this.renderer.renderer.info; $('fps').textContent = `${f.val} fps · ${i.render.calls} draws · ${Math.round(i.render.triangles / 1000)}k tris · ${(this.renderer.scale * 100) | 0}%`; }
    }
  }

  // ---------- Lobby: blurred map backdrop + a live 3D operator inside every party card ----------
  _buildLobby() {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xcfdcff, 0x3a2c1c, 1.3));
    const key = new THREE.DirectionalLight(0xffe6c8, 2.6); key.position.set(-1, 2, -2.2); scene.add(key);
    const rimB = new THREE.DirectionalLight(0x5aa9ff, 1.8); rimB.position.set(2, 1.2, 2); scene.add(rimB);
    const rimO = new THREE.DirectionalLight(0xff8a1f, 1.2); rimO.position.set(-2, 0.8, 2); scene.add(rimO);
    // card backdrops (gradient quads rendered with an ortho camera inside each card viewport)
    const grad = (top, bottom) => {
      const c = document.createElement('canvas'); c.width = 4; c.height = 256;
      const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, top); g.addColorStop(0.65, bottom); g.addColorStop(1, '#07090d');
      x.fillStyle = g; x.fillRect(0, 0, 4, 256);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const quad = (tex) => { const sc = new THREE.Scene(); sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, depthTest: false }))); return sc; };
    const back = { 1: quad(grad('#1d3550', '#0d1520')), 2: quad(grad('#4a3214', '#1a130b')), me: quad(grad('#5a3410', '#1c1209')) };
    const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // blurred backdrop: map rendered tiny, then upscaled with bilinear filtering
    const rt = new THREE.WebGLRenderTarget(64, 36, { depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const bgScene = new THREE.Scene();
    const bgMat = new THREE.MeshBasicMaterial({ map: rt.texture, color: 0x8a8f99, depthWrite: false, depthTest: false });
    bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));
    const cam = new THREE.PerspectiveCamera(26, 0.5, 1, 2000);
    this.lobby = { scene, back, orthoCam, rt, bgScene, cam, chars: [], key: '', t: 0, flyCam: new THREE.PerspectiveCamera(70, 16 / 9, 5, 20000) };
  }

  _lobbyFrame(dt) {
    if (!this.lobby) this._buildLobby();
    const L = this.lobby;
    L.t += dt;
    const r = this.renderer.renderer;
    const w = window.innerWidth, h = window.innerHeight;
    // 1) backdrop: slow fly-over of the current map, rendered tiny and stretched = cheap blur
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    if (this.map) {
      const fc = L.flyCam;
      const ext = Math.max(this.map.world.max[0] - this.map.world.min[0], this.map.world.max[2] - this.map.world.min[2]) * 0.3;
      fc.position.set(Math.sin(L.t * 0.03) * ext, (this.map.world.max[1] || 400) * 0.9 + 200, Math.cos(L.t * 0.03) * ext);
      fc.lookAt(0, 0, 0);
      const rw = Math.max(32, Math.round(w / 14)), rh = Math.max(18, Math.round(h / 14));
      if (L.rt.width !== rw || L.rt.height !== rh) L.rt.setSize(rw, rh);
      fc.aspect = w / h; fc.updateProjectionMatrix();
      r.setRenderTarget(L.rt); r.clear(); r.render(this.renderer.scene, fc); r.setRenderTarget(null);
      r.clear(); r.render(L.bgScene, L.orthoCam);
    } else {
      r.setClearColor(0x0b0e13); r.clear();
    }
    // 2) operators for each party member, one per card viewport
    const members = this.menus.lineup();
    const keyStr = members.map((m) => m.id + m.team).join('|') + '#' + this.charFactory.version + '#' + this.weaponLib.version;
    if (keyStr !== L.key) {
      L.key = keyStr;
      for (const c of L.chars) c.dispose();
      const guns = ['ak47', 'ak47', 'awp', 'glock', 'knife'];
      L.chars = members.map((m, i) => {
        const ch = this.charFactory.make(m.team === 2 ? 2 : 1);
        ch.setWeapon(guns[i], this.weaponLib.get(guns[i]));
        ch.x = i * 600;
        L.scene.add(ch.root);
        return ch;
      });
    }
    const views = this.menus.cardViews();
    if (!views.length) return;
    r.setScissorTest(true);
    r.autoClear = false;
    for (const v of views) {
      const ch = L.chars[v.index];
      const rc = v.rect;
      if (!ch || rc.width < 4 || rc.height < 4) continue;
      const x = rc.left, y = h - rc.bottom;
      r.setViewport(x, y, rc.width, rc.height); r.setScissor(x, y, rc.width, rc.height);
      r.clearDepth();
      r.render(v.me ? L.back.me : L.back[v.team], L.orthoCam);
      const t = L.t + v.index * 1.9;
      ch.update(dt, { x: ch.x, y: 0, z: 0, yaw: 0.62 + Math.sin(t * 0.35) * 0.05, pitch: 0.02 + Math.sin(t * 0.7) * 0.02, duck: 0, vx: 0, vz: 0, onGround: true, alive: true });
      const cam = L.cam;
      cam.aspect = rc.width / rc.height;
      cam.fov = 2 * Math.atan(46 / 150 / Math.min(1, cam.aspect * 2.1)) * 180 / Math.PI;
      cam.position.set(ch.x - 10, 44, -150);
      cam.lookAt(ch.x, 37, 0);
      cam.updateProjectionMatrix();
      r.render(L.scene, cam);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
  }
}

const app = new App();
window.__flashpoint = app;
app.init().catch((e) => {
  console.error(e);
  $('boot-msg').textContent = 'Failed to start: ' + (e.message || e);
});
export { THREE };
