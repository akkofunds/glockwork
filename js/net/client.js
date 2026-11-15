// Game client: 64 Hz command generation with client-side prediction + server reconciliation, remote player
// interpolation, event handling (kills, damage, grenades, bomb, economy) and per-frame presentation.
import * as THREE from 'three';
import {
  DT, TICK_RATE, INTERP_TICKS, GAME_VERSION, TEAM, TEAM_NAME, WEAPONS, WEAPON_IDS, WEAPON_CODE, MATCH, FLASH, HG, GEAR,
} from '../config.js';
import {
  createPlayerState, simulatePlayer, statesDiffer, owns, currentInaccuracy, recoilOffset, activeSlotData, eyePos,
} from '../sim/player.js';
import { eyeHeight } from '../sim/movement.js';
import { createGrenade, stepGrenade, shouldDetonate } from '../sim/grenade.js';
import { encodeCmds, decodeSnapshot, readMessage, MSG, PF } from './protocol.js';
import { PHASE } from './host.js';
import { DEG, clamp, wrapAngle, lerpAngle, damp, deepClone, fmtTime, escapeHtml } from '../util.js';
import { calloutAt } from '../world/arena.js';
import { c4Mesh } from '../render/effects.js';
import { WEAPON_GLYPH } from '../ui/hud.js';

const HIST = 128;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _fwd = new THREE.Vector3();

export class GameClient {
  constructor(app, link, opts) {
    this.app = app;
    this.link = link;
    this.mode = opts.mode;
    this.isHost = !!opts.isHost;
    this.num = 0;
    this.ready = false;
    this.roster = new Map();
    this.scores = new Map();
    this.cfg = null;
    this.world = null;
    this.ps = null;
    this.prevPos = { x: 0, y: 0, z: 0 };
    this.prevDuck = 0;
    this.history = new Array(HIST);
    this.seq = 0;
    this.ackSeq = 0;
    this.acc = 0;
    this.yaw = 0; this.pitch = 0;
    this.wantWeapon = 0;
    this.snapTick = 0;
    this.tickOffset = null;
    this.phase = PHASE.WAITING; this.phaseEnd = 0; this.round = 0; this.scoreCT = 0; this.scoreT = 0;
    this.bomb = { state: 5, x: 0, y: 0, z: 0, end: 0, defuser: 255, defuseEnd: 0, site: 0, carrier: 255 };
    this.remotes = new Map();
    this.items = new Map();
    this.nades = new Map();
    this.smokes = [];
    this.smoothErr = new THREE.Vector3();
    this.aimPunch = 0; this.aimPunchYaw = 0;
    this.shake = 0;
    this.myBuys = [];
    this.buyEndTick = 0;
    this.spectate = 0;
    this.deathT = 0; this.killer = 0;
    this.lastBeep = 0;
    this.closed = false;
    this.mapChunks = null;
    this.rtt = 0;
    this.matchOver = null;
    this.c4World = c4Mesh(app.weaponLib); this.c4World.visible = false;
    this.c4Carried = c4Mesh(app.weaponLib);
    app.renderer.scene.add(this.c4World);
    this._makeCtx();
    link.onMessage = (d) => this.onMessage(d);
    link.onClose = () => { if (!this.closed) this.app.leaveMatch(this.matchOver ? null : 'Disconnected from host'); };
    link.send({ t: 'join', name: app.settings.name, peerId: opts.peerId, ver: GAME_VERSION });
    this._pingTimer = setInterval(() => link.send({ t: 'ping', c: performance.now(), rtt: Math.round(this.rtt) }), 1000);
  }

  _makeCtx() {
    const c = this;
    const base = {
      world: null, frozen: false, noAttack: false, isReplay: false,
      inBombsite: (ps) => ps.team === TEAM.T && c._siteAt(ps.pos) !== 0,
      isDefusing: (ps) => c.bomb.defuser === ps.num,
    };
    this.ctxReplay = { ...base, isReplay: true };
    this.ctx = {
      ...base,
      onFire: (ps, def, eye, dir, info) => c._localFire(ps, def, eye, dir, info),
      onKnife: (ps, stab) => { c.app.viewmodel.onKnife(stab); c.app.audio.play('slash', 0.6); },
      onThrow: () => { c.app.viewmodel.onThrow(); c.app.audio.play('throw', 0.6); },
      onSound: (ps, k) => {
        const a = c.app.audio;
        if (k === 'zoom') a.play('zoom', 0.6); else if (k === 'dry') a.play('dry', 0.7); else if (k === 'pin') a.play('pin', 0.6); else if (k === 'mode') a.play('clickA', 0.5);
      },
      onJump: () => c.app.audio.play('jump', 0.35),
      onLand: (ps, speed) => { if (speed > 150) { c.app.audio.play('land', Math.min(1, speed / 500)); c.app.viewmodel.onLand(speed); } },
      onPlantStart: () => c.app.audio.play('plantBeep', 0.5),
      onPlant: () => {},
      onDrop: () => c.app.audio.play('pickup', 0.4),
    };
  }

  _siteAt(pos) {
    const sites = this.cfg?.sites || [];
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (Math.hypot(pos.x - s.x, pos.z - s.z) <= s.r && Math.abs(pos.y - s.y) < 160) return i + 1;
    }
    return 0;
  }

  // ---------------- networking ----------------
  onMessage(data) {
    if (typeof data !== 'string') {
      if (!(data instanceof ArrayBuffer)) { if (data && data.buffer) data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); else return; }
      const u8 = new Uint8Array(data);
      if (u8[0] === 3) return this._onMapChunk(data);
      const { type, r } = readMessage(data);
      if (type === MSG.SNAP && this.ready) this._onSnapshot(decodeSnapshot(r));
      return;
    }
    let m; try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'welcome': this._onWelcome(m); break;
      case 'reject': this.app.leaveMatch(m.reason); break;
      case 'pong': this.rtt = performance.now() - m.c; break;
      case 'ev': for (const e of m.l) this._onEvent(e); break;
    }
  }

  async _onWelcome(m) {
    this.num = m.num;
    this.mode = m.mode;
    this.rules = m.rules || 'defusal';
    for (const r of m.roster) this.roster.set(r.num, r);
    this.app.showLoading('Loading map…');
    try {
      const map = await this.app.ensureMap(m.map, m.cfg, () => this._requestMap());
      this.world = map.world;
      this.cfg = map.config;
      this.ctx.world = this.world; this.ctxReplay.world = this.world;
    } catch (e) {
      console.error(e);
      this.app.leaveMatch('Failed to load map: ' + (e.message || e));
      return;
    }
    for (const it of m.items || []) this._onEvent(it);
    const now = this._now();
    for (const s of m.smokes || []) { this.app.effects.startSmoke(-1, s.x, s.y, s.z, now - (m.tick - s.start) / TICK_RATE, now + (s.end - m.tick) / TICK_RATE); this.smokes.push({ x: s.x, y: s.y, z: s.z, end: s.end }); }
    this.ps = createPlayerState(this.num, this.roster.get(this.num)?.team || TEAM.CT);
    this.seq = m.ackSeq || 0; this.ackSeq = this.seq;
    this.ready = true;
    this.app.hideLoading();
    this.app.onClientReady(this);
    this.link.send({ t: 'ready' });
  }

  _requestMap() {
    return new Promise((resolve, reject) => {
      this.mapChunks = { parts: [], got: 0, total: -1, resolve, reject };
      this.link.send({ t: 'mapreq' });
      setTimeout(() => { if (this.mapChunks && this.mapChunks.got < this.mapChunks.total) reject(new Error('Map transfer timed out')); }, 120000);
    });
  }
  _onMapChunk(buf) {
    const mc = this.mapChunks; if (!mc) return;
    const dv = new DataView(buf);
    const idx = dv.getUint32(1, true), total = dv.getUint32(5, true);
    mc.total = total;
    if (!mc.parts[idx]) { mc.parts[idx] = new Uint8Array(buf, 9); mc.got++; }
    this.app.showLoading(`Downloading map from host… ${Math.round((mc.got / total) * 100)}%`);
    if (mc.got === total) {
      const size = mc.parts.reduce((s, p) => s + p.byteLength, 0);
      const out = new Uint8Array(size);
      let o = 0; for (const p of mc.parts) { out.set(p, o); o += p.byteLength; }
      this.mapChunks = null;
      mc.resolve(out.buffer);
    }
  }

  _now() { return performance.now() / 1000; }
  serverTickNow() {
    if (this.tickOffset === null) return this.snapTick;
    return this._now() * TICK_RATE + this.tickOffset;
  }
  renderTick() { return this.serverTickNow() - INTERP_TICKS; }

  _onSnapshot(s) {
    if (s.tick <= this.snapTick) return;
    this.snapTick = s.tick;
    const sample = s.tick - this._now() * TICK_RATE;
    if (this.tickOffset === null || Math.abs(sample - this.tickOffset) > 12) this.tickOffset = sample;
    else this.tickOffset += (sample - this.tickOffset) * (sample > this.tickOffset ? 0.2 : 0.02);
    const prevPhase = this.phase;
    this.phase = s.phase; this.phaseEnd = s.phaseEnd; this.round = s.round; this.scoreCT = s.scoreCT; this.scoreT = s.scoreT;
    if (s.phase === PHASE.FREEZE && prevPhase !== PHASE.FREEZE) this.buyEndTick = s.phaseEnd + (MATCH.buyTime - MATCH.freezeTime) * TICK_RATE;
    if (s.phase === PHASE.LIVE && !this.buyEndTick) this.buyEndTick = s.phaseEnd - (MATCH.roundTime - (MATCH.buyTime - MATCH.freezeTime)) * TICK_RATE;
    this.bomb = s.bomb;
    for (const p of s.players) {
      if (p.num === this.num) continue;
      let r = this.remotes.get(p.num);
      if (!r) { r = { samples: [], char: null, wpn: -1, team: 0, stepDist: 0, lastX: p.x, lastZ: p.z, ground: true, alive: true }; this.remotes.set(p.num, r); }
      r.samples.push({ tick: s.tick, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, duck: p.duck, flags: p.flags, wpn: p.wpn, hp: p.hp, armor: p.armor });
      if (r.samples.length > 40) r.samples.splice(0, r.samples.length - 40);
      r.seen = s.tick;
    }
    for (const [num, r] of this.remotes) if (s.tick - r.seen > TICK_RATE * 2 && !this.roster.has(num)) { this._removeRemote(num); }
    if (s.own) this._reconcile(JSON.parse(s.own), s.ackSeq);
  }

  _reconcile(server, ack) {
    this.ackSeq = Math.max(this.ackSeq, ack);
    const h = this.history[ack % HIST];
    const prevTeam = this.ps.team, prevAlive = this.ps.alive;
    if (h && h.seq === ack && !statesDiffer(h.state, server)) return;
    // correction: rewind to authoritative state and replay unacknowledged commands
    const bx = this.ps.pos.x, by = this.ps.pos.y, bz = this.ps.pos.z;
    this.ps = server;
    this._setFrame();
    for (let q = ack + 1; q <= this.seq; q++) {
      const e = this.history[q % HIST];
      if (!e || e.seq !== q) continue;
      simulatePlayer(this.ps, e.cmd, this.ctxReplay);
      e.state = deepClone(this.ps);
    }
    const ex = bx - this.ps.pos.x, ey = by - this.ps.pos.y, ez = bz - this.ps.pos.z;
    if (Math.hypot(ex, ey, ez) < 48) this.smoothErr.add(_v.set(ex, ey, ez)); else this.smoothErr.set(0, 0, 0);
    this.prevPos.x = this.ps.pos.x; this.prevPos.y = this.ps.pos.y; this.prevPos.z = this.ps.pos.z;
    if (prevTeam !== this.ps.team) this.app.viewmodel.setTeam(this.ps.team);
    if (!prevAlive && this.ps.alive) { this.spectate = 0; this.deathT = 0; }
  }

  _setFrame() {
    const ph = this.phase;
    const c = this.ctx, r = this.ctxReplay;
    c.frozen = r.frozen = ph === PHASE.FREEZE;
    c.noAttack = r.noAttack = !(ph === PHASE.LIVE || ph === PHASE.POST || ph === PHASE.PRACTICE || ph === PHASE.FREEZE || ph === PHASE.TDM);
  }

  // ---------------- local actions ----------------
  selectSlot(n) {
    const ps = this.ps; if (!ps || !ps.alive) return;
    let id = null;
    if (n === 1) id = ps.inv.primary?.id;
    else if (n === 2) id = ps.inv.secondary?.id;
    else if (n === 3) id = 'knife';
    else if (n === 4) {
      const g = ['he', 'flash', 'smoke'].filter((x) => ps.inv[x] > 0);
      if (!g.length) return;
      const cur = g.indexOf(ps.active);
      id = g[(cur + 1) % g.length];
    } else if (n === 5) id = ps.inv.c4 ? 'c4' : null;
    else if (n === 'last') id = owns(ps, ps.last) ? ps.last : null;
    else if (n === 'next') {
      const order = [ps.inv.primary?.id, ps.inv.secondary?.id, 'knife', ...['he', 'flash', 'smoke'].filter((x) => ps.inv[x] > 0), ps.inv.c4 ? 'c4' : null].filter(Boolean);
      id = order[(order.indexOf(ps.active) + 1) % order.length];
    }
    if (id) { this.wantWeapon = WEAPON_CODE[id]; this.app.audio.play('clickB', 0.25); }
  }
  inspect() { if (this.ps?.alive) this.app.viewmodel.onInspect(); }
  buy(item) { this.link.send({ t: 'buy', item }); }
  refund(item) { this.link.send({ t: 'refund', item }); }
  chat(text, team) { this.link.send({ t: 'chat', text, team }); }
  switchTeam(team) { this.link.send({ t: 'team', team }); }
  cycleSpectate() {
    const alive = [...this.remotes.entries()].filter(([n, r]) => r.alive && (this.roster.get(n)?.team === this.ps.team || this.ps.team === 0)).map(([n]) => n);
    if (!alive.length) { this.spectate = 0; return; }
    const i = alive.indexOf(this.spectate);
    this.spectate = alive[(i + 1) % alive.length];
  }

  _tickCmd() {
    const ps = this.ps;
    const app = this.app;
    this._setFrame();
    this.seq++;
    let buttons = app.input.buttons();
    if (app.uiBlocking()) buttons &= ~(0x80 | 0x100); // no firing while a menu is up
    if (this.chatOpen) buttons = 0;
    if (this.wantWeapon && WEAPON_CODE[ps.active] === this.wantWeapon) this.wantWeapon = 0;
    const cmd = {
      seq: this.seq, buttons,
      yaw: Math.fround(this.yaw), pitch: Math.fround(this.pitch),
      viewTick: Math.fround(this.renderTick()), wpn: this.wantWeapon,
    };
    this.prevPos.x = ps.pos.x; this.prevPos.y = ps.pos.y; this.prevPos.z = ps.pos.z; this.prevDuck = ps.duck;
    const prevReload = ps.w.reloadEnd;
    simulatePlayer(ps, cmd, this.ctx);
    if (prevReload === 0 && ps.w.reloadEnd > 0) { app.viewmodel.onReload(ps.w.reloadEnd - ps.time); app.audio.play('magOut', 0.5); this._reloadClick = ps.w.reloadEnd - 0.5; }
    if (this._reloadClick && ps.time >= this._reloadClick) { app.audio.play('clickA', 0.5); this._reloadClick = 0; }
    this.history[this.seq % HIST] = { seq: this.seq, cmd, state: deepClone(ps) };
    // send the last few unacknowledged commands for loss resilience
    const out = [];
    for (let q = Math.max(this.ackSeq + 1, this.seq - 5); q <= this.seq; q++) { const e = this.history[q % HIST]; if (e && e.seq === q) out.push(e.cmd); }
    this.link.sendFast(encodeCmds(out));
  }

  _localFire(ps, def, eye, dir, info) {
    const app = this.app;
    app.viewmodel.onFire(def.cls);
    app.audio.shot(def.sound, 0, 0, 0, true);
    const hit = {};
    const t = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, def.range, hit);
    const end = t === Infinity ? def.range : t;
    // tracer from (approximate) muzzle
    const cam = app.renderer.camera;
    app.viewmodel.muzzleCameraSpace(_v);
    _v.multiplyScalar(0.6).applyMatrix4(cam.matrixWorld);
    if (Math.random() < (def.cls === 'smg' || def.cls === 'rifle' ? 0.55 : 0.9)) app.effects.tracer(_v.x, _v.y, _v.z, eye.x + dir.x * end, eye.y + dir.y * end, eye.z + dir.z * end);
    if (t !== Infinity) {
      app.effects.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.thin);
      app.audio.play3D('impact', hit.x, hit.y, hit.z, 0.5);
    }
    // brass
    if (def.cls !== 'knife') {
      app.viewmodel.ejectCameraSpace(_v2);
      _v2.multiplyScalar(0.6).applyMatrix4(cam.matrixWorld);
      _fwd.set(1, 0.6, 0.2).applyQuaternion(cam.quaternion).multiplyScalar(140);
      app.effects.shell(_v2.x, _v2.y, _v2.z, _fwd.x + ps.vel.x, _fwd.y, _fwd.z + ps.vel.z, ps.pos.y);
    }
  }

  // ---------------- events ----------------
  _name(n) { return this.roster.get(n)?.name || (n === 0 ? '' : 'Player'); }
  _team(n) { return n === this.num ? this.ps?.team : this.roster.get(n)?.team; }

  _onEvent(e) {
    const app = this.app, hud = app.hud, audio = app.audio, fx = app.effects;
    switch (e.e) {
      case 'roster': {
        const nums = new Set();
        for (const r of e.list) { this.roster.set(r.num, r); nums.add(r.num); }
        for (const n of [...this.roster.keys()]) if (!nums.has(n)) { this.roster.delete(n); this._removeRemote(n); }
        for (const [n, r] of this.remotes) if (r.char && r.team !== this.roster.get(n)?.team) this._removeRemote(n);
        break;
      }
      case 'scores': for (const s of e.list) this.scores.set(s.num, s); this.loss = e.loss; break;
      case 'spawn': this.yaw = e.yaw; this.pitch = 0; break;
      case 'warmup': hud.banner('<b>WARMUP</b><small>Match starts shortly</small>', 'neutral', 3); break;
      case 'matchStart': hud.banner('<b>MATCH STARTED</b><small>First to 7 rounds</small>', 'neutral', 3); break;
      case 'tdmStart': hud.banner(`<b>TEAM DEATHMATCH</b><small>First team to ${e.limit} kills · buy anywhere with B</small>`, 'neutral', 4); audio.play('roundStart', 0.6); break;
      case 'round': {
        this.myBuys = [];
        this.smokes = [];
        fx.clearSmokes();
        for (const [, g] of this.nades) g.detonated = true;
        this.nades.clear();
        hud.clearKillfeed();
        this.spectate = 0; this.killer = 0;
        hud.banner(`<b>ROUND ${e.n}</b><small>${e.n === 1 || e.half ? 'Pistol round · $800' : 'Buy phase'}</small>`, 'neutral', 2.5);
        audio.play('roundStart', 0.5);
        app.viewmodel.setTeam(this.roster.get(this.num)?.team || TEAM.CT);
        break;
      }
      case 'live': audio.play('beep', 0.4); break;
      case 'roundEnd': {
        const myTeam = this.ps?.team;
        const win = e.winner === myTeam;
        const reason = { elim: 'Enemies eliminated', time: 'Time ran out', bomb: 'Target bombed', defuse: 'Bomb defused' }[e.reason] || '';
        hud.banner(`<b>${TEAM_NAME[e.winner].toUpperCase()} WIN</b><small>${reason}${e.mvp ? ` · MVP: ${escapeHtml(this._name(e.mvp))}` : ''}</small>`, e.winner === TEAM.T ? 't' : 'ct', 5);
        audio.play(win ? 'win' : 'lose', 0.6);
        break;
      }
      case 'halftime': hud.banner('<b>HALFTIME</b><small>Teams switch sides · Money resets to $800</small>', 'neutral', 6); break;
      case 'swap': break;
      case 'matchEnd': {
        this.matchOver = e;
        const myTeam = this.ps?.team;
        const txt = e.winner === 0 ? 'DRAW' : (e.winner === myTeam ? 'VICTORY' : 'DEFEAT');
        hud.banner(`<b>${txt}</b><small>${e.score[TEAM.CT]} – ${e.score[TEAM.T]}${e.reason === 'forfeit' ? ' · Opponents left' : ''}</small>`, e.winner === myTeam ? 'ct' : 't', 12);
        audio.play(e.winner === myTeam ? 'win' : 'lose', 0.7);
        for (const s of e.stats || []) this.scores.set(s.num, s);
        app.hud.showScoreboard(true);
        break;
      }
      case 'close': this.closed = true; setTimeout(() => app.leaveMatch(null), 1500); break;
      case 'kill': {
        const mine = e.k === this.num, meDied = e.v === this.num;
        hud.addKill({ killer: this._name(e.k), kt: this._team(e.k), victim: this._name(e.v), vt: this._team(e.v), w: e.w, hs: e.hs, wb: e.wb, sm: e.sm, ns: e.ns, bs: e.bs, assist: e.a ? this._name(e.a) : '', mine, meDied });
        if (mine && e.v !== this.num) audio.play('killConfirm', 0.55);
        if (meDied) {
          this.deathT = 0; this.killer = e.k;
          hud.message(e.k && e.k !== this.num ? `Killed by ${this._name(e.k)} · ${WEAPON_GLYPH[e.w] || e.w}${e.hs ? ' (headshot)' : ''}` : 'You died', 4, 'death');
          app.buyMenu.toggle(false);
        }
        const r = this.remotes.get(e.v);
        if (r) r.alive = false;
        break;
      }
      case 'dmg': {
        const ps = this.ps;
        if (!ps) break;
        const ang = Math.atan2(e.sx - ps.pos.x, e.sz - ps.pos.z);
        const rel = wrapAngle(Math.PI - ang + this.yaw);
        if (e.from) hud.damageFrom(rel);
        if (!(e.armored && e.hg !== HG.HEAD)) { this.aimPunch += Math.min(4, e.amt * 0.08) * DEG; this.aimPunchYaw += (Math.random() - 0.5) * 1.5 * DEG; }
        audio.play('hurt', 0.6);
        break;
      }
      case 'hit': {
        hud.hitmarker(e.kill, e.hg === HG.HEAD);
        audio.play(e.hg === HG.HEAD ? (e.armored ? 'dink' : 'flesh') : 'hitmark', e.hg === HG.HEAD ? 0.7 : 0.4);
        break;
      }
      case 'shot': this._remoteShot(e); break;
      case 'snd': this._sound(e); break;
      case 'nade': {
        const g = createGrenade(e.id, e.type, e.n, e.x, e.y, e.z, e.vx, e.vy, e.vz, 0);
        this.nades.set(e.id, g);
        if (e.n !== this.num) audio.play3D('throw', e.x, e.y, e.z, 0.6);
        break;
      }
      case 'det': this._detonate(e); break;
      case 'item+': {
        const old = this.items.get(e.id); if (old) app.renderer.scene.remove(old);
        const m = app.weaponLib.get(e.w);
        m.position.set(e.x, e.y + 1.6, e.z);
        m.rotation.set(0, e.yaw || 0, Math.PI / 2, 'YXZ');
        m.userData.wid = e.w;
        app.renderer.scene.add(m);
        this.items.set(e.id, m);
        break;
      }
      case 'item-': {
        const m = this.items.get(e.id);
        if (m) { app.renderer.scene.remove(m); this.items.delete(e.id); }
        break;
      }
      case 'bombDrop': audio.play3D('bounce', e.x, e.y, e.z, 0.6); break;
      case 'bombPick': if (this._team(this.num) === TEAM.T) hud.message(`${this._name(e.n)} picked up the bomb`, 2); break;
      case 'planted': {
        const site = this.cfg?.sites?.[e.site - 1]?.name || '';
        hud.banner(`<b>BOMB PLANTED</b><small>${site ? 'Bombsite ' + site + ' · ' : ''}40 seconds to detonation</small>`, 't', 3.5);
        audio.play('plantBeep', 0.7);
        this.lastBeep = 0;
        break;
      }
      case 'defuseStart': if (e.n !== this.num) audio.play3D('defuse', this.bomb.x, this.bomb.y, this.bomb.z, 0.8); else audio.play('defuse', 0.6); break;
      case 'defuseAbort': break;
      case 'defused': hud.banner('<b>BOMB DEFUSED</b>', 'ct', 3); audio.play('defuse', 0.9); break;
      case 'exploded': {
        fx.bigExplosion(e.x, e.y, e.z);
        audio.play3D('c4boom', e.x, e.y, e.z, 1.4, 1, { ref: 1200, maxDist: 12000 });
        this.shake = 1.2;
        break;
      }
      case 'buyOk': this.myBuys.push(e.item); audio.play('buy', 0.5); break;
      case 'refundOk': { const i = this.myBuys.lastIndexOf(e.item); if (i >= 0) this.myBuys.splice(i, 1); audio.play('pickup', 0.5); hud.moneyPop(e.amt, 'Refund'); break; }
      case 'buyFail': audio.play('deny', 0.5); hud.message(e.why, 1.8, 'warn'); break;
      case 'money': hud.moneyPop(e.amt, e.why); break;
      case 'msg': app.chatLine(null, e.text); break;
      case 'chat': app.chatLine(this._name(e.n), e.text, e.team ? this._team(e.n) : 0); break;
    }
  }

  _sound(e) {
    const a = this.app.audio;
    const map = { jump: ['jump', 0.4], land: ['land', 0.8], reload: ['magOut', 0.7], zoom: ['zoom', 0.5], dry: ['dry', 0.6], pin: ['pin', 0.6], bounce: ['bounce', 0.7], pickup: ['pickup', 0.6], knifeHit: ['knifeHit', 0.9], knifeWall: ['knifeWall', 0.8], slash: ['slash', 0.6], stab: ['slash', 0.7], plantStart: ['plantBeep', 0.8], mode: ['clickA', 0.4] };
    const s = map[e.k]; if (!s) return;
    if (e.n === this.num && (e.k === 'knifeHit' || e.k === 'knifeWall')) { a.play(s[0], s[1]); return; }
    a.play3D(s[0], e.x, e.y + 40, e.z, s[1]);
  }

  _remoteShot(e) {
    const app = this.app;
    const def = WEAPONS[WEAPON_IDS[e.w]];
    const r = this.remotes.get(e.n);
    const o = e.o, end = e.end;
    const dx = end[0] - o[0], dy = end[1] - o[1], dz = end[2] - o[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    // muzzle approx: right/down/forward of eye
    const yaw = Math.atan2(-dx, -dz);
    const mx = o[0] + (dx / L) * 22 + Math.cos(yaw) * 5, my = o[1] - 5 + (dy / L) * 22, mz = o[2] + (dz / L) * 22 - Math.sin(yaw) * 5;
    if (def && def.cls !== 'knife') {
      app.effects.tracer(mx, my, mz, end[0], end[1], end[2]);
      if (!def.suppressed) app.effects.muzzle(mx, my, mz, def.cls === 'sniper' ? 22 : 14);
      const eye = this._eyeWorld();
      const occluded = eye ? !this.world.lineOfSight(eye.x, eye.y, eye.z, o[0], o[1], o[2]) : false;
      app.audio.shot(def.sound, o[0], o[1], o[2], false, occluded);
    }
    for (const i of e.imp || []) app.effects.impact(i[0], i[1], i[2], i[3], i[4], i[5], false);
    if (e.blood) app.effects.blood(e.blood[0], e.blood[1], e.blood[2], dx / L, dz / L, false);
    if (e.blood && this.app.audio) app.audio.play3D('flesh', e.blood[0], e.blood[1], e.blood[2], 0.6);
    if (r && r.char) r.char.fire();
  }

  _detonate(e) {
    const app = this.app, fx = app.effects, audio = app.audio;
    const g = this.nades.get(e.id);
    if (g) { g.detonated = true; this.nades.delete(e.id); }
    if (e.type === 'he') {
      fx.explosion(e.x, e.y, e.z);
      audio.play3D('he', e.x, e.y, e.z, 1.2, 1, { ref: 500, maxDist: 8000 });
      const eye = this._eyeWorld();
      if (eye) { const d = Math.hypot(eye.x - e.x, eye.y - e.y, eye.z - e.z); if (d < 900) this.shake = Math.max(this.shake, 0.7 * (1 - d / 900)); }
    } else if (e.type === 'flash') {
      audio.play3D('flashPop', e.x, e.y, e.z, 1.0, 1, { ref: 400 });
      fx.muzzle(e.x, e.y, e.z, 120);
      this._applyFlash(e);
    } else if (e.type === 'smoke') {
      const now = this._now();
      fx.startSmoke(e.id, e.x, e.y + 40, e.z, now, now + WEAPONS.smoke.duration);
      audio.play3D('smokeHiss', e.x, e.y, e.z, 0.8);
      this.smokes.push({ x: e.x, y: e.y + 40, z: e.z, end: e.end || (this.serverTickNow() + WEAPONS.smoke.duration * TICK_RATE) });
    }
  }

  _applyFlash(e) {
    const eye = this._eyeWorld();
    if (!eye || !this.ps?.alive) return;
    const dx = e.x - eye.x, dy = e.y + 4 - eye.y, dz = e.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > FLASH.range) return;
    if (!this.world.lineOfSight(eye.x, eye.y, eye.z, e.x, e.y + 4, e.z)) return;
    const cam = this.app.renderer.camera;
    cam.getWorldDirection(_fwd);
    const dot = (_fwd.x * dx + _fwd.y * dy + _fwd.z * dz) / (d || 1);
    const angle = dot > 0.6 ? 1 : dot > 0.2 ? 0.7 : dot > -0.3 ? 0.35 : 0.15;
    const dist = clamp(1 - (d - 250) / 1550, 0.12, 1);
    const amount = angle * dist;
    this.app.hud.setFlash(Math.min(1, amount * 1.5), FLASH.maxDuration * amount);
    this.app.audio.flashRing(amount);
  }

  _eyeWorld() {
    const cam = this.app.renderer.camera;
    return cam.position;
  }

  _removeRemote(num) {
    const r = this.remotes.get(num);
    if (r && r.char) { r.char.dispose(); }
    this.remotes.delete(num);
  }

  // ---------------- per-frame ----------------
  frame(dt) {
    if (!this.ready || !this.ps) return;
    const app = this.app;
    // look input
    const [dx, dy] = app.input.consumeLook();
    const ps = this.ps;
    const def = WEAPONS[ps.active];
    let sens = app.settings.sensitivity * 0.022 * DEG;
    if (def?.scope && ps.w.scope > 0) sens *= app.settings.zoomSensitivity * (def.scope[ps.w.scope - 1] / 90);
    if (!app.uiBlocking() || app.input.touch) {
      this.yaw = wrapAngle(this.yaw - dx * sens);
      this.pitch = clamp(this.pitch - dy * sens * (app.settings.invertY ? -1 : 1), -89 * DEG, 89 * DEG);
    }
    // fixed-rate commands
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= DT && n < 8) { this.acc -= DT; this._tickCmd(); n++; }
    if (n === 8) this.acc = 0;
    // grenade visuals
    for (const g of this.nades.values()) {
      g._acc = (g._acc || 0) + dt;
      while (g._acc >= DT) { g._acc -= DT; stepGrenade(this.world, g, DT); }
    }
    app.effects.syncNades([...this.nades.values()]);
    const stick = this.serverTickNow();
    this.smokes = this.smokes.filter((s) => s.end > stick);
    this._present(dt);
  }

  _present(dt) {
    const app = this.app;
    const ps = this.ps;
    const cam = app.renderer.camera;
    const alpha = clamp(this.acc / DT, 0, 1);
    this.smoothErr.multiplyScalar(Math.exp(-dt * 12));
    const rt = this.renderTick();
    // remote players
    let specTarget = null;
    const radarPlayers = [];
    for (const [num, r] of this.remotes) {
      const st = this._interp(r, rt);
      if (!st) continue;
      const rosterTeam = this.roster.get(num)?.team || ((st.flags & PF.TEAM_T) ? TEAM.T : TEAM.CT);
      const team = (st.flags & PF.TEAM_T) ? TEAM.T : TEAM.CT;
      void rosterTeam;
      if (!r.char || r.team !== team || r.charVersion !== app.charFactory.version) {
        if (r.char) r.char.dispose();
        r.char = app.charFactory.make(team); r.team = team; r.charVersion = app.charFactory.version; r.wpn = -1;
        app.renderer.scene.add(r.char.root);
      }
      const alive = !!(st.flags & PF.ALIVE);
      if (alive && !r.alive) r.char.alive = false; // respawn: reset death anim
      r.alive = alive;
      if (st.wpn !== r.wpn || r.libVersion !== app.weaponLib.version) {
        r.wpn = st.wpn; r.libVersion = app.weaponLib.version;
        const id = WEAPON_IDS[st.wpn] || 'knife';
        r.char.setWeapon(id, app.weaponLib.get(id));
      }
      // velocity estimate
      const vx = (st.x - (r.px ?? st.x)) / Math.max(dt, 1e-3), vz = (st.z - (r.pz ?? st.z)) / Math.max(dt, 1e-3);
      r.vx = damp(r.vx || 0, clamp(vx, -400, 400), 12, dt); r.vz = damp(r.vz || 0, clamp(vz, -400, 400), 12, dt);
      r.px = st.x; r.pz = st.z;
      const onGround = !!(st.flags & PF.GROUND);
      r.char.update(dt, { x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch, duck: st.duck, vx: r.vx, vz: r.vz, onGround, alive, reloading: !!(st.flags & PF.RELOADING), planting: !!(st.flags & PF.PLANTING), defusing: !!(st.flags & PF.DEFUSING) });
      r.char.attachC4(st.flags & PF.C4 ? this.c4Carried : null);
      // footsteps
      const sp = Math.hypot(r.vx, r.vz);
      if (alive && onGround && sp > 140 && !(st.flags & PF.WALK)) {
        r.stepDist += sp * dt;
        if (r.stepDist > 76) {
          r.stepDist = 0;
          const eye = cam.position;
          const occ = !this.world.lineOfSight(eye.x, eye.y, eye.z, st.x, st.y + 40, st.z);
          app.audio.play3D('step' + Math.floor(Math.random() * 4), st.x, st.y + 5, st.z, 0.9, 1, { ref: 160, rolloff: 1.4, maxDist: 1800, occluded: occ });
        }
      }
      if (onGround && !r.ground && alive) app.audio.play3D('land', st.x, st.y, st.z, 0.5, 1, { ref: 150, maxDist: 1500 });
      r.ground = onGround;
      r.state = st;
      if (num === this.spectate && alive) specTarget = { num, st };
      const enemy = team !== ps.team;
      let visible = !enemy;
      if (enemy && alive && ps.alive) visible = this.world.lineOfSight(cam.position.x, cam.position.y, cam.position.z, st.x, st.y + 50, st.z);
      if (visible || !alive) radarPlayers.push({ x: st.x, z: st.z, yaw: st.yaw, alive, team, enemy, c4: !!(st.flags & PF.C4) });
    }

    // camera
    let ex, ey, ez, cyaw = this.yaw, cpitch = this.pitch;
    if (ps.alive) {
      ex = this.prevPos.x + (ps.pos.x - this.prevPos.x) * alpha + this.smoothErr.x;
      ey = this.prevPos.y + (ps.pos.y - this.prevPos.y) * alpha + this.smoothErr.y + eyeHeight(this.prevDuck + (ps.duck - this.prevDuck) * alpha);
      ez = this.prevPos.z + (ps.pos.z - this.prevPos.z) * alpha + this.smoothErr.z;
      const ro = recoilOffset(ps, [0, 0]);
      this.aimPunch = damp(this.aimPunch, 0, 7, dt); this.aimPunchYaw = damp(this.aimPunchYaw, 0, 7, dt);
      cpitch += ro[1] * 0.45 * DEG + this.aimPunch;
      cyaw -= ro[0] * 0.45 * DEG + this.aimPunchYaw;
      this.spectate = 0;
    } else {
      this.deathT += dt;
      if (!specTarget && this.deathT > 3) { this.cycleSpectate(); }
      if (specTarget) {
        const st = specTarget.st;
        ex = st.x; ey = st.y + eyeHeight(st.duck); ez = st.z; cyaw = st.yaw; cpitch = st.pitch;
      } else {
        // death cam: hover over body, look toward killer
        ex = ps.pos.x; ey = ps.pos.y + 90 + Math.min(1, this.deathT) * 40; ez = ps.pos.z;
        const k = this.remotes.get(this.killer)?.state;
        if (k) { cyaw = Math.atan2(-(k.x - ex), -(k.z - ez)); cpitch = Math.atan2(k.y + 50 - ey, Math.hypot(k.x - ex, k.z - ez)); }
      }
    }
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt); cpitch += (Math.random() - 0.5) * this.shake * 0.03; cyaw += (Math.random() - 0.5) * this.shake * 0.03; }
    cam.position.set(ex, ey, ez);
    cam.rotation.set(cpitch, cyaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    app.renderer.followShadow(ex, ez);
    cam.getWorldDirection(_fwd);
    app.audio.setListener(ex, ey, ez, _fwd.x, _fwd.y, _fwd.z);

    // zoom
    const def = WEAPONS[ps.active];
    const scoped = ps.alive && def?.scope && ps.w.scope > 0;
    app.renderer.applyZoom(scoped ? def.scope[ps.w.scope - 1] : 1);

    // viewmodel
    const vm = app.viewmodel;
    if (ps.alive && (vm.id !== ps.active || vm.libVersion !== app.weaponLib.version)) vm.setWeapon(ps.active, def?.drawTime);
    if (vm.t.reloadDur > 0 && ps.w.reloadEnd === 0) vm.cancelReload();
    vm.update(dt, {
      speed: Math.hypot(ps.vel.x, ps.vel.z), onGround: ps.onGround, duck: ps.duck, lookDX: app.input.lookDX, lookDY: app.input.lookDY,
      scoped, planting: ps.w.plantStart >= 0, defusing: this.bomb.defuser === this.num, primed: ps.w.nade === 1, visible: ps.alive,
    });

    // bomb visuals
    const b = this.bomb;
    const bombVisible = b.state === 1 || b.state === 2 || b.state === 3;
    this.c4World.visible = bombVisible;
    if (bombVisible) {
      this.c4World.position.set(b.x, b.y + 1.2, b.z);
      const led = this.c4World.getObjectByName('led');
      if (b.state === 2) {
        const left = (b.end - this.serverTickNow()) / TICK_RATE;
        const interval = clamp(0.12 + 0.88 * Math.pow(Math.max(0, left) / MATCH.bombTimer, 1.4), 0.12, 1);
        const now = this._now();
        if (now - this.lastBeep >= interval && left > 0) { this.lastBeep = now; app.audio.play3D('beep', b.x, b.y + 5, b.z, 0.9, 1, { ref: 300, maxDist: 4000 }); if (led) led.visible = true; }
        if (led && now - this.lastBeep > 0.08) led.visible = false;
      } else if (led) led.visible = b.state !== 3;
    }
    this.c4Carried.visible = true;

    // items spin
    for (const m of this.items.values()) m.rotation.y += dt * 0.0;

    // HUD
    this._hud(dt, radarPlayers);
    app.effects.update(dt, cam, this._now());
  }

  _interp(r, rt) {
    const s = r.samples;
    if (!s.length) return null;
    if (rt <= s[0].tick) return s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].tick <= rt) {
        const a = s[i], b = s[i + 1];
        if (!b) return a;
        const f = (rt - a.tick) / (b.tick - a.tick);
        const out = r._out || (r._out = {});
        out.x = a.x + (b.x - a.x) * f; out.y = a.y + (b.y - a.y) * f; out.z = a.z + (b.z - a.z) * f;
        out.yaw = lerpAngle(a.yaw, b.yaw, f); out.pitch = a.pitch + (b.pitch - a.pitch) * f; out.duck = a.duck + (b.duck - a.duck) * f;
        out.flags = f < 0.5 ? a.flags : b.flags; out.wpn = f < 0.5 ? a.wpn : b.wpn; out.hp = b.hp; out.armor = b.armor;
        if ((a.flags & PF.ALIVE) !== (b.flags & PF.ALIVE)) { out.x = b.x; out.y = b.y; out.z = b.z; }
        return out;
      }
    }
    return s[s.length - 1];
  }

  _hud(dt, radarPlayers) {
    const app = this.app, hud = app.hud, ps = this.ps;
    const tick = this.serverTickNow();
    const left = (this.phaseEnd - tick) / TICK_RATE;
    if (this.mode !== 'practice' && (this.phase === PHASE.WAITING || this.phase === PHASE.WARMUP)) {
      const titles = { private: this.rules === 'tdm' ? 'PRIVATE · TEAM DEATHMATCH' : 'PRIVATE MATCH', '1v1': 'DUEL', '2v2': 'WINGMAN', '5v5': 'COMPETITIVE', tdm: 'TEAM DEATHMATCH' };
      const list = (t) => [...this.roster.values()].filter((r) => r.team === t).map((r) => ({ name: r.name, me: r.num === this.num, ready: r.num === this.num || this.remotes.has(r.num) }));
      hud.versus({ mode: titles[this.mode] || this.mode, map: (this.cfg?.name || 'Map').toUpperCase(), ct: list(TEAM.CT), t: list(TEAM.T),
        status: this.phase === PHASE.WARMUP ? `Match starts in ${Math.max(0, Math.ceil(left))}` : 'Waiting for players…' });
    } else hud.versus(null);
    let timerHtml = fmtTime(left), roundLabel = `Round ${this.round}`;
    const planted = this.bomb.state === 2;
    if (this.phase === PHASE.WAITING) { timerHtml = '<small>WAITING</small>'; roundLabel = 'Waiting for players'; }
    else if (this.phase === PHASE.WARMUP) { roundLabel = 'Warmup'; }
    else if (this.phase === PHASE.PRACTICE) { timerHtml = '<small>PRACTICE</small>'; roundLabel = 'Free roam · no bots'; }
    else if (this.phase === PHASE.TDM) roundLabel = 'Team Deathmatch · first to 50';
    else if (this.phase === PHASE.HALFTIME) roundLabel = 'Halftime';
    else if (this.phase === PHASE.GAMEOVER) { timerHtml = '<small>FINAL</small>'; roundLabel = 'Match over'; }
    else if (planted) timerHtml = `<span class="bombicon">${'<svg viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="7" width="18" height="11" rx="1.5" fill="currentColor"/><circle cx="17" cy="11" r="1.6" fill="#fff"/></svg>'}</span>`;
    else if (this.phase === PHASE.FREEZE) roundLabel = `Round ${this.round} · Buy`;
    const team = (t) => [...this.roster.values()].filter((r) => r.team === t).map((r) => ({
      name: r.name, me: r.num === this.num, alive: r.num === this.num ? ps.alive : !!this.remotes.get(r.num)?.alive,
    }));
    hud.updateTop({ scoreCT: this.scoreCT, scoreT: this.scoreT, timerHtml, roundLabel, bombPlanted: planted, freeze: this.phase === PHASE.FREEZE, ct: team(TEAM.CT), t: team(TEAM.T) });

    // vitals (spectated player when dead)
    const slot = activeSlotData(ps);
    const def = WEAPONS[ps.active];
    const canBuy = this._canBuy();
    let callout = calloutAt(this.cfg, ps.pos.x, ps.pos.z);
    if (!callout && this.cfg?.sites) { const s = this._siteAt(ps.pos); if (s) callout = 'Bombsite ' + this.cfg.sites[s - 1].name; }
    if (ps.alive) {
      const ammo = def.cls === 'grenade' ? null : slot;
      hud.updateVitals(ps, def.name, ammo ? ammo.mag : null, ammo ? ammo.res : 0, ps.money, callout, canBuy.ok);
      hud.updateInventory(ps);
    } else {
      const spec = this.spectate && this.remotes.get(this.spectate)?.state;
      hud.updateVitals({ hp: spec ? spec.hp : 0, armor: spec ? spec.armor : 0, helmet: false, defuser: false }, spec ? `Spectating ${this._name(this.spectate)}` : 'Dead', null, 0, ps.money, callout, false);
      hud.updateInventory({ inv: { primary: null, secondary: null, he: 0, flash: 0, smoke: 0, c4: false }, active: '' });
    }
    // radar
    const me = ps.alive ? ps.pos : (this.spectate && this.remotes.get(this.spectate)?.state) || ps.pos;
    if (ps.alive) radarPlayers.push({ x: ps.pos.x, z: ps.pos.z, yaw: this.yaw, alive: true, team: ps.team, enemy: false, self: true });
    const bombVisible = this.bomb.state === 1 || this.bomb.state === 2 ? (ps.team === TEAM.T || this.bomb.state === 2) : false;
    this._radarT = (this._radarT || 0) + dt;
    if (this._radarT > 1 / 20) {
      this._radarT = 0;
      hud.drawRadar(me, radarPlayers.filter((p) => !p.self), { visible: bombVisible, x: this.bomb.x, z: this.bomb.z, planted: this.bomb.state === 2 }, this.smokes, this.cfg, ps.alive ? this.yaw : (this.remotes.get(this.spectate)?.state?.yaw || this.yaw));
    }
    // crosshair (rises with the spray pattern so it sits where bullets land)
    hud.drawCrosshair(ps.alive ? currentInaccuracy(ps) : 0);
    if (ps.alive && app.settings.crosshair.recoil !== false) {
      const ro = recoilOffset(ps, this._ro || (this._ro = [0, 0]));
      const cam = app.renderer.camera;
      const tv = Math.tan((cam.fov * DEG) / 2), th = tv * cam.aspect;
      const h2 = window.innerHeight / 2, w2 = window.innerWidth / 2;
      hud.setCrosshairOffset(Math.tan(-ro[0] * 0.55 * DEG) / th * w2 * -1, -Math.tan(ro[1] * 0.55 * DEG) / tv * h2);
    } else hud.setCrosshairOffset(0, 0);
    // progress bars
    if (ps.alive && ps.w.plantStart >= 0) hud.progress('Planting bomb…', (ps.time - ps.w.plantStart) / MATCH.plantTime, 'plant');
    else if (this.bomb.defuser === this.num && this.bomb.state === 2) {
      const total = (ps.defuser ? MATCH.defuseKitTime : MATCH.defuseTime) * TICK_RATE;
      hud.progress(ps.defuser ? 'Defusing (kit)…' : 'Defusing…', 1 - (this.bomb.defuseEnd - tick) / total, 'defuse');
    } else hud.progress('', null);
    // contextual hint
    const smoke = app.effects.smokeCover(app.renderer.camera.position.x, app.renderer.camera.position.y, app.renderer.camera.position.z, this._now());
    hud.frame(dt, {
      scoped: ps.alive && def?.scope && ps.w.scope > 0, hideCrosshair: !ps.alive || (def?.cls === 'sniper') || app.uiBlocking(),
      smoke: smoke * 0.95, lowHp: ps.alive && ps.hp <= 25, speed: ps.alive ? Math.hypot(ps.vel.x, ps.vel.z) : undefined,
    });
    // buy menu
    if (app.buyMenu.open) {
      if (!ps.alive) app.buyMenu.toggle(false);
      const owned = [];
      if (ps.inv.primary) owned.push(ps.inv.primary.id);
      if (ps.inv.secondary) owned.push(ps.inv.secondary.id);
      if (ps.armor >= 100) owned.push('kevlar');
      if (ps.armor >= 100 && ps.helmet) owned.push('vesthelm');
      if (ps.defuser) owned.push('defuser');
      for (const g of ['he', 'smoke']) if (ps.inv[g] >= 1) owned.push(g);
      if (ps.inv.flash >= 2) owned.push('flash');
      app.buyMenu.update({
        money: this.phase === PHASE.PRACTICE || this.phase === PHASE.TDM ? 16000 : ps.money, team: ps.team, canBuy: canBuy.ok, reason: canBuy.reason,
        time: Math.ceil(canBuy.time), owned, refundable: [...new Set(this.myBuys)], armor: ps.armor, helmet: ps.helmet,
      });
    }
    if (app.hud.scoreboardOpen) app.hud.renderScoreboard(this._scoreData());
  }

  _canBuy() {
    const ps = this.ps;
    if (!ps.alive) return { ok: false, reason: 'You are dead', time: 0 };
    if (this.phase === PHASE.PRACTICE || this.phase === PHASE.TDM) return { ok: true, time: 99 };
    if (this.phase !== PHASE.FREEZE && this.phase !== PHASE.LIVE) return { ok: false, reason: 'Buy time is over', time: 0 };
    const left = (this.buyEndTick - this.serverTickNow()) / TICK_RATE;
    if (left <= 0) return { ok: false, reason: 'Buy time is over', time: 0 };
    const sp = this.cfg?.spawnCenter?.[ps.team];
    if (sp && Math.hypot(ps.pos.x - sp.x, ps.pos.z - sp.z) > (this.cfg.buyRadius || MATCH.buyZoneRadius)) return { ok: false, reason: 'Not in buy zone', time: left };
    return { ok: true, time: left };
  }

  _scoreData() {
    const list = (team) => [...this.roster.values()].filter((r) => r.team === team).map((r) => {
      const s = this.scores.get(r.num) || { k: 0, d: 0, a: 0, dmg: 0, hs: 0, mvp: 0, score: 0, ping: 0, money: -1 };
      const rem = this.remotes.get(r.num);
      const alive = r.num === this.num ? this.ps.alive : !!rem?.alive;
      return {
        name: r.name, me: r.num === this.num, alive, k: s.k, d: s.d, a: s.a, hsp: s.k > 0 ? Math.round((s.hs / s.k) * 100) : 0,
        adr: Math.round(s.dmg / Math.max(1, this.round - (this.phase === PHASE.LIVE || this.phase === PHASE.FREEZE ? 1 : 0) || 1)),
        mvp: s.mvp, score: s.score, ping: r.num === this.num ? Math.round(this.rtt) : s.ping, money: s.money,
        c4: r.num === this.num ? this.ps.inv.c4 : !!(rem?.state && rem.state.flags & PF.C4),
        kit: r.num === this.num ? this.ps.defuser : !!(rem?.state && rem.state.flags & PF.DEFUSER),
      };
    }).sort((a, b) => b.score - a.score);
    const titles = { practice: 'Practice', private: this.rules === 'tdm' ? 'Private · Team Deathmatch' : 'Private Match', '1v1': 'Duel 1v1', '2v2': 'Wingman 2v2', '5v5': 'Competitive 5v5', tdm: 'Team Deathmatch' };
    return { title: `${titles[this.mode] || this.mode} · ${this.cfg?.name || ''}`, ct: list(TEAM.CT), t: list(TEAM.T), scoreCT: this.scoreCT, scoreT: this.scoreT };
  }

  destroy() {
    this.closed = true;
    clearInterval(this._pingTimer);
    for (const n of [...this.remotes.keys()]) this._removeRemote(n);
    for (const m of this.items.values()) this.app.renderer.scene.remove(m);
    this.items.clear();
    this.app.renderer.scene.remove(this.c4World);
    this.c4Carried.parent?.remove(this.c4Carried);
    this.app.effects.syncNades([]);
    this.app.effects.clearSmokes();
    this.app.effects.clearDecals();
  }
}

export { GEAR, eyePos, shouldDetonate };
