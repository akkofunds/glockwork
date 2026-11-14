// Authoritative 64-tick match host: runs every player's commands, lag-compensated hit registration,
// economy & buy validation, round/bomb/grenade logic, and streams snapshots + reliable events to clients.
import {
  TICK_RATE, DT, LAG_COMP_TICKS, GAME_VERSION, TEAM, MATCH, ECON, WEAPONS, WEAPON_CODE, GEAR, HG, HE, DEFAULT_PISTOL, MOVE, BUYABLE,
} from '../config.js';
import { createPlayerState, simulatePlayer, giveDefaultLoadout, owns, bestWeapon, switchTo, BTN, eyePos } from '../sim/player.js';
import { traceBullet, rayVsPose, computeDamage, segmentThroughSmoke } from '../sim/ballistics.js';
import { createGrenade, stepGrenade, shouldDetonate } from '../sim/grenade.js';
import { encodeSnapshot, decodeCmds, readMessage, MSG, PF } from './protocol.js';
import { wrapAngle, clamp } from '../util.js';
import { hullHeight } from '../sim/movement.js';

export const PHASE = { WAITING: 0, WARMUP: 1, FREEZE: 2, LIVE: 3, POST: 4, HALFTIME: 5, GAMEOVER: 6, PRACTICE: 7 };
const HIST = 64;

export class Host {
  /*
   opts: { mode: 'practice'|'private'|'1v1'|'2v2'|'5v5', roster: [{id,name,team}], world, map: {desc, config, bytes?} }
  */
  constructor(opts) {
    this.mode = opts.mode;
    this.expected = opts.roster || [];
    this.world = opts.world;
    this.map = opts.map;
    this.cfg = opts.map.config;
    this.players = new Map();
    this.byPeer = new Map();
    this.nextNum = 1;
    this.tick = 0;
    this.phase = this.mode === 'practice' ? PHASE.PRACTICE : PHASE.WAITING;
    this.phaseEnd = this.tick + MATCH.connectTimeout * TICK_RATE;
    this.round = 0;
    this.score = { [TEAM.CT]: 0, [TEAM.T]: 0 };
    this.lossCounter = { [TEAM.CT]: 0, [TEAM.T]: 0 };
    this.freezeStart = 0;
    this.bomb = { state: 5, x: 0, y: 0, z: 0, end: 0, defuser: 255, defuseEnd: 0, site: 0, carrier: 255, planter: 255 };
    this.nades = [];
    this.smokes = [];
    this.items = new Map();
    this.nextItemId = 1;
    this.nextNadeId = 1;
    this.events = [];
    this.roundEndInfo = null;
    this.started = false;
    this.ended = false;
    this.onEnd = null;
    this._lastScoresTick = 0;
    this._ctx = this._makeCtx();
  }

  // ---------- connections ----------
  addLink(link) {
    link.onMessage = (d) => this._onMessage(link, d);
    link.onClose = () => this._onDisconnect(link);
  }

  _onMessage(link, data) {
    if (typeof data !== 'string') {
      if (!(data instanceof ArrayBuffer)) { if (data && data.buffer) data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); else return; }
      const p = link.player; if (!p) return;
      const { type, r } = readMessage(data);
      if (type === MSG.CMD) {
        const cmds = decodeCmds(r);
        for (const c of cmds) if (c.seq > p.lastQueued) { p.cmdQueue.push(c); p.lastQueued = c.seq; }
        if (p.cmdQueue.length > 32) p.cmdQueue.splice(0, p.cmdQueue.length - 32);
      }
      return;
    }
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'join') return this._onJoin(link, m);
    const p = link.player; if (!p) return;
    switch (m.t) {
      case 'ready': p.ready = true; if (this.phase === PHASE.PRACTICE || (this.started && !p.ps.alive && this.phase !== PHASE.LIVE)) this._spawnPracticeOrLate(p); break;
      case 'buy': this._buy(p, String(m.item)); break;
      case 'refund': this._refund(p, String(m.item)); break;
      case 'ping': p.ping = clamp(m.rtt | 0, 0, 999); link.send({ t: 'pong', c: m.c }); break;
      case 'chat': this._event({ e: 'chat', n: p.num, text: String(m.text).slice(0, 120), team: m.team ? p.ps.team : 0 }); break;
      case 'mapreq': this._sendMap(link); break;
      case 'team':
        if (this.mode === 'practice' || this.mode === 'private') {
          const team = m.team === TEAM.T ? TEAM.T : TEAM.CT;
          if (p.ps.team !== team) { p.ps.team = team; if (p.ps.alive) this._killPlayer(p, null, 'world', { silent: true }); this._broadcastRoster(); if (this.mode === 'practice') this._spawnPracticeOrLate(p); }
        }
        break;
      case 'setmap':
        break;
    }
  }

  _onJoin(link, m) {
    if (link.player) return;
    if (m.ver !== GAME_VERSION) { link.send({ t: 'reject', reason: 'Game version mismatch — refresh the page (Ctrl+Shift+R) to get the latest Flashpoint' }); setTimeout(() => link.close(), 500); return; }
    let exp = this.expected.find((r) => r.id === m.peerId);
    let p = this.byPeer.get(m.peerId);
    if (!exp && !p) {
      if (this.mode !== 'private' && this.mode !== 'practice') { link.send({ t: 'reject', reason: 'Not part of this match' }); setTimeout(() => link.close(), 500); return; }
      const cts = [...this.players.values()].filter((x) => x.ps.team === TEAM.CT).length;
      const ts = this.players.size - cts;
      exp = { id: m.peerId, name: m.name, team: cts <= ts ? TEAM.CT : TEAM.T };
    }
    if (this.players.size >= 10 && !p) { link.send({ t: 'reject', reason: 'Match full' }); setTimeout(() => link.close(), 500); return; }
    if (!p) {
      const num = this.nextNum++;
      const ps = createPlayerState(num, exp.team);
      ps.money = this.mode === 'practice' ? ECON.maxMoney : ECON.startMoney;
      giveDefaultLoadout(ps);
      p = {
        num, peerId: m.peerId, name: String(m.name || exp.name || 'Player').slice(0, 20), ps, link,
        cmdQueue: [], lastQueued: 0, lastSeq: 0, lastButtons: 0, ready: false, connected: true, ping: 0,
        hist: new Float32Array(HIST * 6), histTick: new Int32Array(HIST).fill(-1000),
        stats: { k: 0, d: 0, a: 0, dmg: 0, hs: 0, mvp: 0, score: 0 }, damageBy: new Map(), buys: [], kills: 0,
      };
      this.players.set(num, p);
      this.byPeer.set(m.peerId, p);
    } else {
      p.link = link; p.connected = true; p.cmdQueue = []; p.lastQueued = p.lastSeq;
    }
    link.player = p;
    link.send({
      t: 'welcome', num: p.num, mode: this.mode, map: this.map.desc, cfg: this.cfg, tick: this.tick,
      roster: this._rosterList(), items: [...this.items.values()].map((it) => this._itemMsg(it)),
      smokes: this.smokes.map((s) => ({ x: s.x, y: s.y, z: s.z, end: s.end, start: s.start })),
      ackSeq: p.lastSeq,
    });
    this._broadcastRoster();
    this._event({ e: 'msg', text: `${p.name} joined` });
  }

  _onDisconnect(link) {
    const p = link.player; if (!p || p.link !== link) return;
    p.connected = false; p.link = null;
    if (p.ps.alive) this._killPlayer(p, null, 'world', { silent: true });
    this._event({ e: 'msg', text: `${p.name} disconnected` });
    this.players.delete(p.num);
    this.byPeer.delete(p.peerId);
    this._broadcastRoster();
    if (this.started && this.mode !== 'practice') {
      const cts = [...this.players.values()].filter((x) => x.ps.team === TEAM.CT).length;
      const ts = [...this.players.values()].filter((x) => x.ps.team === TEAM.T).length;
      if ((cts === 0 || ts === 0) && this.phase !== PHASE.GAMEOVER) {
        this._gameOver(cts === 0 ? TEAM.T : TEAM.CT, 'forfeit');
      } else if (this.phase === PHASE.LIVE) this._checkRoundEnd();
    }
  }

  _rosterList() {
    return [...this.players.values()].map((p) => ({ num: p.num, name: p.name, team: p.ps.team, peerId: p.peerId }));
  }
  _broadcastRoster() { this._event({ e: 'roster', list: this._rosterList() }); }

  // ---------- map streaming ----------
  _sendMap(link) {
    const bytes = this.map.bytes;
    if (!bytes) return;
    const CH = 16000;
    const total = Math.ceil(bytes.byteLength / CH);
    let i = 0;
    const pump = () => {
      if (link.closed) return;
      const dc = link.rel?.dataChannel;
      while (i < total && (!dc || dc.bufferedAmount < 512 * 1024)) {
        const chunk = bytes.slice(i * CH, Math.min(bytes.byteLength, (i + 1) * CH));
        const buf = new ArrayBuffer(9 + chunk.byteLength);
        const dv = new DataView(buf);
        dv.setUint8(0, 3); dv.setUint32(1, i, true); dv.setUint32(5, total, true);
        new Uint8Array(buf, 9).set(new Uint8Array(chunk));
        link.send(buf);
        i++;
      }
      if (i < total) setTimeout(pump, 30);
    };
    pump();
  }

  // ---------- event queue ----------
  _event(ev, to = 0, except = 0) { ev._to = to; ev._ex = except; this.events.push(ev); }

  // ---------- spawning ----------
  _spawnPoints(team) {
    const list = this.cfg.spawns[team] || [];
    return list.length ? list : [{ x: 0, y: 0, z: 0, yaw: 0 }];
  }

  _placeAtSpawn(p, index) {
    const sp = this._spawnPoints(p.ps.team);
    const s = sp[index % sp.length];
    const ps = p.ps;
    ps.pos.x = s.x; ps.pos.y = s.y; ps.pos.z = s.z;
    ps.vel.x = 0; ps.vel.y = 0; ps.vel.z = 0;
    ps.yaw = s.yaw; ps.pitch = 0; ps.duck = 0; ps.onGround = true; ps.velMod = 1; ps.duckFatigue = 0;
    p.forceAngles = true;
    this._event({ e: 'spawn', yaw: s.yaw }, p.num);
  }

  _spawnPracticeOrLate(p) {
    if (this.phase === PHASE.PRACTICE) {
      giveDefaultLoadout(p.ps);
      p.ps.alive = true; p.ps.hp = 100; p.ps.money = ECON.maxMoney;
      this._placeAtSpawn(p, p.num);
    }
  }

  // ---------- match flow ----------
  _startMatch() {
    this.started = true;
    this.round = 0;
    this.score[TEAM.CT] = 0; this.score[TEAM.T] = 0;
    this.lossCounter[TEAM.CT] = 0; this.lossCounter[TEAM.T] = 0;
    for (const p of this.players.values()) {
      p.ps.money = ECON.startMoney; p.ps.alive = false; p.ps.armor = 0; p.ps.helmet = false; p.ps.defuser = false;
      p.stats = { k: 0, d: 0, a: 0, dmg: 0, hs: 0, mvp: 0, score: 0 };
    }
    this._event({ e: 'matchStart' });
    this._startRound(true);
  }

  _startRound(resetAll) {
    this.round++;
    this.phase = PHASE.FREEZE;
    this.freezeStart = this.tick;
    this.phaseEnd = this.tick + MATCH.freezeTime * TICK_RATE;
    this.roundEndInfo = null;
    for (const it of this.items.values()) this._event({ e: 'item-', id: it.id });
    this.items.clear();
    this.nades = []; this.smokes = [];
    this.bomb = { state: 5, x: 0, y: 0, z: 0, end: 0, defuser: 255, defuseEnd: 0, site: 0, carrier: 255, planter: 255 };
    const idx = { [TEAM.CT]: 0, [TEAM.T]: 0 };
    const ts = [];
    for (const p of this.players.values()) {
      const ps = p.ps;
      if (resetAll || !ps.alive) {
        giveDefaultLoadout(ps);
        ps.armor = 0; ps.helmet = false; ps.defuser = false;
      } else {
        // survivors keep gear; refill nothing, reset weapon timers
        ps.inv.c4 = false;
        const keep = owns(ps, ps.active) && ps.active !== 'c4' ? ps.active : bestWeapon(ps);
        ps.w = { ...ps.w, drawEnd: 0, reloadEnd: 0, nextAttack: 0, nextAttack2: 0, recoil: 0, inacc: 0, burst: 0, scope: 0, rezoom: 0, plantStart: -1, nade: 0, pendingSwitch: 0 };
        ps.active = keep;
      }
      ps.alive = true; ps.hp = 100;
      p.damageBy = new Map(); p.buys = []; p.kills = 0;
      this._placeAtSpawn(p, idx[ps.team]++);
      if (ps.team === TEAM.T) ts.push(p);
    }
    if (ts.length) {
      const carrier = ts[Math.floor(Math.random() * ts.length)];
      carrier.ps.inv.c4 = true;
      this.bomb.state = 0; this.bomb.carrier = carrier.num;
    }
    this._event({ e: 'round', n: this.round, half: this.round === MATCH.halfRound + 1 });
  }

  _endRound(winner, reason) {
    if (this.phase !== PHASE.LIVE) return;
    this.phase = PHASE.POST;
    this.phaseEnd = this.tick + MATCH.postRoundTime * TICK_RATE;
    this.score[winner]++;
    const loser = winner === TEAM.CT ? TEAM.T : TEAM.CT;
    const bombWin = reason === 'bomb' || reason === 'defuse';
    const planted = this.bomb.state === 2 || this.bomb.state === 3 || this.bomb.state === 4 || this.bomb.planter !== 255;
    const lossIdx = Math.min(this.lossCounter[loser], 4);
    const lossBonus = ECON.lossBonus[lossIdx];
    for (const p of this.players.values()) {
      const ps = p.ps;
      if (ps.team === winner) this._addMoney(p, bombWin ? ECON.winBomb : ECON.winElim);
      else {
        let income = lossBonus;
        if (ps.team === TEAM.T && planted) income += ECON.plantBonus;
        if (ps.team === TEAM.T && ps.alive && !planted) income = 0; // saving penalty
        this._addMoney(p, income);
      }
    }
    this.lossCounter[loser] = Math.min(4, this.lossCounter[loser] + 1);
    this.lossCounter[winner] = Math.max(0, this.lossCounter[winner] - 1);
    // MVP
    let mvp = null;
    if (reason === 'defuse') mvp = this.players.get(this.bomb.defuser) || null;
    else if (reason === 'bomb') mvp = this.players.get(this.bomb.planter) || null;
    if (!mvp) {
      for (const p of this.players.values()) if (p.ps.team === winner && (!mvp || p.kills > mvp.kills)) mvp = p;
    }
    if (mvp) { mvp.stats.mvp++; mvp.stats.score += 2; }
    this.roundEndInfo = { winner, reason };
    this._event({ e: 'roundEnd', winner, reason, mvp: mvp ? mvp.num : 0, score: { ...this.score }, lossBonus });
  }

  _addMoney(p, amount) {
    p.ps.money = clamp(p.ps.money + amount, 0, this.mode === 'practice' ? ECON.maxMoney : ECON.maxMoney);
  }

  _gameOver(winner, reason) {
    this.phase = PHASE.GAMEOVER;
    this.phaseEnd = this.tick + MATCH.matchEndTime * TICK_RATE;
    this._event({ e: 'matchEnd', winner, reason, score: { ...this.score }, stats: this._scoreList(0) });
  }

  _halftime() {
    this.phase = PHASE.HALFTIME;
    this.phaseEnd = this.tick + MATCH.halftimeTime * TICK_RATE;
    this._event({ e: 'halftime', score: { ...this.score } });
  }

  _swapTeams() {
    const s = this.score[TEAM.CT]; this.score[TEAM.CT] = this.score[TEAM.T]; this.score[TEAM.T] = s;
    for (const p of this.players.values()) {
      p.ps.team = p.ps.team === TEAM.CT ? TEAM.T : TEAM.CT;
      p.ps.money = ECON.startMoney; p.ps.alive = false;
    }
    this.lossCounter[TEAM.CT] = 0; this.lossCounter[TEAM.T] = 0;
    this._broadcastRoster();
    this._event({ e: 'swap' });
  }

  _checkRoundEnd() {
    if (this.phase !== PHASE.LIVE) return;
    let ct = 0, t = 0, ctTotal = 0, tTotal = 0;
    for (const p of this.players.values()) {
      if (p.ps.team === TEAM.CT) { ctTotal++; if (p.ps.alive) ct++; }
      else { tTotal++; if (p.ps.alive) t++; }
    }
    if (ctTotal > 0 && ct === 0) return this._endRound(TEAM.T, 'elim');
    if (tTotal > 0 && t === 0 && this.bomb.state !== 2) return this._endRound(TEAM.CT, 'elim');
  }

  // ---------- simulation context ----------
  _makeCtx() {
    const host = this;
    const ctx = {
      world: this.world, frozen: false, noAttack: false, isReplay: false, player: null, viewTick: 0,
      inBombsite: (ps) => ps.team === TEAM.T && host._siteAt(ps.pos) !== 0,
      isDefusing: (ps) => host.bomb.defuser === ps.num,
      onFire: (ps, def, eye, dir, info) => host._fire(ctx.player, def, eye, dir, info, ctx.viewTick),
      onKnife: (ps, stab) => host._knife(ctx.player, stab, ctx.viewTick),
      onThrow: (ps, type, x, y, z, vx, vy, vz) => host._throw(ctx.player, type, x, y, z, vx, vy, vz),
      onPlantStart: (ps) => host._event({ e: 'snd', k: 'plantStart', n: ps.num, x: ps.pos.x, y: ps.pos.y, z: ps.pos.z }, 0, ps.num),
      onPlantAbort: () => {},
      onPlant: (ps) => host._plant(ctx.player),
      onDrop: (ps, item) => host._dropItem(ctx.player, item, true),
      onLand: (ps, fallSpeed) => {
        if (fallSpeed > MOVE.fallDamageSpeed) {
          const dmg = Math.round((fallSpeed - MOVE.fallDamageSpeed) * (100 / (MOVE.fatalFallSpeed - MOVE.fallDamageSpeed)));
          host._applyDamage(ctx.player, null, 'world', dmg, 0, HG.GENERIC, {});
        }
        if (fallSpeed > 200) host._event({ e: 'snd', k: 'land', n: ps.num, x: ps.pos.x, y: ps.pos.y, z: ps.pos.z }, 0, ps.num);
      },
      onJump: (ps) => host._event({ e: 'snd', k: 'jump', n: ps.num, x: ps.pos.x, y: ps.pos.y, z: ps.pos.z }, 0, ps.num),
      onSound: (ps, k) => host._event({ e: 'snd', k, n: ps.num, x: ps.pos.x, y: ps.pos.y, z: ps.pos.z }, 0, ps.num),
      onReloadDone: () => {},
    };
    return ctx;
  }

  _siteAt(pos) {
    const sites = this.cfg.sites || [];
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (Math.hypot(pos.x - s.x, pos.z - s.z) <= s.r && Math.abs(pos.y - s.y) < 160) return i + 1;
    }
    return 0;
  }

  _inBuyZone(p) {
    if (this.phase === PHASE.PRACTICE) return true;
    const sp = this.cfg.spawnCenter?.[p.ps.team];
    if (!sp) return true;
    return Math.hypot(p.ps.pos.x - sp.x, p.ps.pos.z - sp.z) <= (this.cfg.buyRadius || MATCH.buyZoneRadius);
  }

  _canBuyNow(p) {
    if (!p.ps.alive) return false;
    if (this.phase === PHASE.PRACTICE) return true;
    if (this.phase !== PHASE.FREEZE && this.phase !== PHASE.LIVE) return false;
    if (this.tick > this.freezeStart + MATCH.buyTime * TICK_RATE) return false;
    return this._inBuyZone(p);
  }

  // ---------- lag compensation ----------
  _record() {
    for (const p of this.players.values()) {
      const i = this.tick % HIST, o = i * 6;
      p.hist[o] = p.ps.pos.x; p.hist[o + 1] = p.ps.pos.y; p.hist[o + 2] = p.ps.pos.z;
      p.hist[o + 3] = p.ps.yaw; p.hist[o + 4] = p.ps.duck; p.hist[o + 5] = p.ps.alive ? 1 : 0;
      p.histTick[i] = this.tick;
    }
  }

  _poseAt(p, viewTick, out) {
    const vt = clamp(viewTick, this.tick - LAG_COMP_TICKS, this.tick);
    const t0 = Math.floor(vt), f = vt - t0;
    const i0 = ((t0 % HIST) + HIST) % HIST, i1 = (((t0 + 1) % HIST) + HIST) % HIST;
    if (p.histTick[i0] !== t0) {
      out.x = p.ps.pos.x; out.y = p.ps.pos.y; out.z = p.ps.pos.z; out.yaw = p.ps.yaw; out.duck = p.ps.duck; out.alive = p.ps.alive;
      return out;
    }
    const h = p.hist, a = i0 * 6;
    const useB = p.histTick[i1] === t0 + 1 && f > 0;
    const b = useB ? i1 * 6 : a;
    const k = useB ? f : 0;
    out.x = h[a] + (h[b] - h[a]) * k; out.y = h[a + 1] + (h[b + 1] - h[a + 1]) * k; out.z = h[a + 2] + (h[b + 2] - h[a + 2]) * k;
    out.yaw = h[a + 3] + wrapAngle(h[b + 3] - h[a + 3]) * k; out.duck = h[a + 4] + (h[b + 4] - h[a + 4]) * k;
    out.alive = h[a + 5] > 0.5 && p.ps.alive;
    return out;
  }

  _rewoundPoses(shooter, viewTick) {
    const list = [];
    for (const p of this.players.values()) {
      if (p === shooter || !p.ps.alive) continue;
      const pose = this._poseAt(p, viewTick, {});
      if (!pose.alive) continue;
      list.push({ num: p.num, pose, ref: p });
    }
    return list;
  }

  // ---------- combat ----------
  _fire(p, def, eye, dir, info, viewTick) {
    const poses = this._rewoundPoses(p, viewTick);
    const res = traceBullet(this.world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, def, poses, p.num);
    const end = res.end || [eye.x + dir.x * 4096, eye.y + dir.y * 4096, eye.z + dir.z * 4096];
    const smoke = segmentThroughSmoke(eye.x, eye.y, eye.z, end[0], end[1], end[2], this.smokes);
    const r1 = (v) => Math.round(v * 10) / 10;
    const ev = { e: 'shot', n: p.num, w: WEAPON_CODE[p.ps.active], o: [r1(eye.x), r1(eye.y), r1(eye.z)], end: end.map(r1), imp: res.impacts.map((a) => a.map((v, i) => (i < 3 ? r1(v) : Math.round(v * 100) / 100))) };
    if (res.hit) {
      const victim = res.hit.p.ref;
      ev.blood = [r1(res.hit.x), r1(res.hit.y), r1(res.hit.z)];
      const dmg = computeDamage(def.damage, def.armorPen, def.rangeMod, res.hit.hg, res.hit.dist, victim.ps, res.hit.mult);
      this._applyDamage(victim, p, p.ps.active, dmg.health, dmg.armor, res.hit.hg, {
        wallbang: res.wallbang, smoke, noscope: info.noscope, armored: dmg.armored, dir: [dir.x, dir.z], bullet: true,
      });
    }
    this._event(ev, 0, p.num);
  }

  _knife(p, stab, viewTick) {
    const def = WEAPONS.knife;
    const spec = stab ? def.stab : def.slash;
    const eye = eyePos(p.ps, {});
    const cp = Math.cos(p.ps.pitch);
    const dx = -Math.sin(p.ps.yaw) * cp, dy = Math.sin(p.ps.pitch), dz = -Math.cos(p.ps.yaw) * cp;
    const wallT = this.world.raycast(eye.x, eye.y, eye.z, dx, dy, dz, spec.range, null);
    let best = null, bestT = Math.min(spec.range, wallT), bestHg = 0;
    for (const { pose, ref } of this._rewoundPoses(p, viewTick)) {
      const r = rayVsPose(eye.x, eye.y, eye.z, dx, dy, dz, bestT, pose, 7);
      if (r && r.t <= bestT) { best = { ref, pose }; bestT = r.t; bestHg = r.hg; }
    }
    if (best) {
      // backstab: attacker behind victim (victim facing away)
      const vx = best.pose.x - p.ps.pos.x, vz = best.pose.z - p.ps.pos.z;
      const l = Math.hypot(vx, vz) || 1;
      const fx = -Math.sin(best.pose.yaw), fz = -Math.cos(best.pose.yaw);
      const back = (fx * vx + fz * vz) / l > 0.475;
      const base = back ? spec.back : spec.front;
      const dmg = computeDamage(base, def.armorPen, 1, HG.GENERIC, 0, best.ref.ps, 1);
      this._applyDamage(best.ref, p, 'knife', dmg.health, dmg.armor, HG.CHEST, { armored: dmg.armored, dir: [dx, dz], knife: true, backstab: back });
      this._event({ e: 'snd', k: 'knifeHit', n: p.num, x: eye.x + dx * bestT, y: eye.y + dy * bestT, z: eye.z + dz * bestT });
    } else if (wallT <= spec.range) {
      this._event({ e: 'snd', k: 'knifeWall', n: p.num, x: eye.x + dx * wallT, y: eye.y + dy * wallT, z: eye.z + dz * wallT });
    } else {
      this._event({ e: 'snd', k: stab ? 'stab' : 'slash', n: p.num, x: eye.x, y: eye.y, z: eye.z }, 0, p.num);
    }
  }

  _applyDamage(victim, attacker, weapon, health, armorDmg, hg, flags) {
    const vps = victim.ps;
    if (!vps.alive) return;
    if (this.phase !== PHASE.LIVE && this.phase !== PHASE.POST && this.phase !== PHASE.PRACTICE) return;
    if (attacker && attacker !== victim && attacker.ps.team === vps.team) {
      if (this.phase === PHASE.PRACTICE) return;
      health = Math.max(1, Math.floor(health * 0.33)); armorDmg = Math.floor(armorDmg * 0.33);
    }
    const before = vps.hp;
    vps.hp = Math.max(0, vps.hp - health);
    vps.armor = Math.max(0, vps.armor - armorDmg);
    if (flags.bullet && vps.onGround) vps.velMod = Math.min(vps.velMod, flags.armored && hg !== HG.HEAD ? 0.6 : 0.45);
    const dealt = before - vps.hp;
    if (attacker && attacker !== victim) {
      if (attacker.ps.team !== vps.team) attacker.stats.dmg += dealt;
      victim.damageBy.set(attacker.num, (victim.damageBy.get(attacker.num) || 0) + dealt);
      this._event({ e: 'hit', hg, kill: vps.hp <= 0, armored: flags.armored, dmg: dealt, v: victim.num }, attacker.num);
    }
    const src = attacker ? attacker.ps.pos : null;
    this._event({ e: 'dmg', amt: dealt, hg, armored: !!flags.armored, from: attacker ? attacker.num : 0, sx: src ? src.x : vps.pos.x, sz: src ? src.z : vps.pos.z, hp: vps.hp }, victim.num);
    if (vps.hp <= 0) this._killPlayer(victim, attacker, weapon, { ...flags, hs: hg === HG.HEAD });
  }

  _killPlayer(victim, attacker, weapon, flags) {
    const vps = victim.ps;
    if (!vps.alive) return;
    vps.alive = false; vps.hp = 0;
    victim.stats.d++;
    // drop gear
    if (vps.inv.primary) this._dropItem(victim, vps.inv.primary, false);
    else if (vps.inv.secondary && vps.inv.secondary.id !== DEFAULT_PISTOL[vps.team]) this._dropItem(victim, vps.inv.secondary, false);
    if (vps.inv.c4) this._dropItem(victim, { id: 'c4' }, false);
    vps.inv = { primary: null, secondary: null, he: 0, flash: 0, smoke: 0, c4: false };
    vps.armor = 0; vps.helmet = false; vps.defuser = false;
    vps.active = 'knife';
    if (this.bomb.defuser === victim.num) { this.bomb.defuser = 255; this.bomb.defuseEnd = 0; this._event({ e: 'defuseAbort' }); }
    let assister = null;
    if (attacker && attacker !== victim) {
      if (attacker.ps.team !== vps.team) {
        attacker.stats.k++; attacker.kills++; attacker.stats.score += 2;
        if (flags.hs) attacker.stats.hs++;
        const reward = this.phase === PHASE.PRACTICE ? 0 : (WEAPONS[weapon]?.reward ?? 300);
        this._addMoney(attacker, reward);
        if (reward) this._event({ e: 'money', amt: reward, why: `Kill with ${WEAPONS[weapon]?.name || weapon}` }, attacker.num);
      } else {
        attacker.stats.k--; attacker.stats.score -= 2;
        this._addMoney(attacker, ECON.teamKillPenalty);
        this._event({ e: 'money', amt: ECON.teamKillPenalty, why: 'Team kill' }, attacker.num);
      }
    }
    for (const [num, d] of victim.damageBy) {
      if (attacker && num === attacker.num) continue;
      const a = this.players.get(num);
      if (a && d >= 41 && a.ps.team !== vps.team) { a.stats.a++; a.stats.score += 1; if (!assister) assister = a; }
    }
    if (!flags.silent) {
      this._event({
        e: 'kill', k: attacker ? attacker.num : 0, v: victim.num, w: weapon, hs: !!flags.hs, wb: !!flags.wallbang,
        sm: !!flags.smoke, ns: !!flags.noscope, bs: !!flags.backstab, a: assister ? assister.num : 0,
      });
    }
    if (this.phase === PHASE.PRACTICE) {
      setTimeout(() => { if (this.players.get(victim.num) === victim) this._spawnPracticeOrLate(victim); }, 2000);
    }
    this._checkRoundEnd();
  }

  _throw(p, type, x, y, z, vx, vy, vz) {
    const g = createGrenade(this.nextNadeId++, type, p.num, x, y, z, vx, vy, vz, this.tick);
    this.nades.push(g);
    this._event({ e: 'nade', id: g.id, type, n: p.num, x, y, z, vx, vy, vz });
  }

  _detonate(g) {
    g.detonated = true;
    const ev = { e: 'det', id: g.id, type: g.type, x: g.x, y: g.y, z: g.z, n: g.owner };
    if (g.type === 'he') {
      const owner = this.players.get(g.owner) || null;
      for (const p of this.players.values()) {
        if (!p.ps.alive) continue;
        const cx = p.ps.pos.x, cy = p.ps.pos.y + hullHeight(p.ps.duck) * 0.55, cz = p.ps.pos.z;
        const dist = Math.hypot(cx - g.x, cy - g.y, cz - g.z);
        if (dist > HE.radius) continue;
        if (!this.world.lineOfSight(g.x, g.y + 4, g.z, cx, cy, cz)) continue;
        let dmg = HE.maxDamage * Math.pow(1 - dist / HE.radius, 1.15);
        let armorDmg = 0;
        if (p.ps.armor > 0) { const h = dmg * HE.armorFactor; armorDmg = (dmg - h) * 0.5; dmg = h; }
        if (dmg >= 1) this._applyDamage(p, owner, 'he', Math.round(dmg), Math.round(armorDmg), HG.GENERIC, { armored: p.ps.armor > 0 });
      }
    } else if (g.type === 'smoke') {
      const s = { x: g.x, y: g.y + 40, z: g.z, radius: WEAPONS.smoke.radius, start: this.tick, end: this.tick + WEAPONS.smoke.duration * TICK_RATE, grow: 0 };
      this.smokes.push(s);
      ev.end = s.end;
    }
    this._event(ev);
  }

  _plant(p) {
    const site = this._siteAt(p.ps.pos);
    this.bomb = { state: 2, x: p.ps.pos.x, y: p.ps.pos.y, z: p.ps.pos.z, end: this.tick + MATCH.bombTimer * TICK_RATE, defuser: 255, defuseEnd: 0, site, carrier: 255, planter: p.num };
    this.phaseEnd = this.bomb.end;
    this._addMoney(p, ECON.planterReward);
    p.stats.score += 2;
    this._event({ e: 'money', amt: ECON.planterReward, why: 'Planted the bomb' }, p.num);
    this._event({ e: 'planted', site, n: p.num, x: p.ps.pos.x, y: p.ps.pos.y, z: p.ps.pos.z });
  }

  _dropItem(p, item, thrown) {
    if (!item) return;
    const ps = p.ps;
    const fx = -Math.sin(ps.yaw), fz = -Math.cos(ps.yaw);
    let x = ps.pos.x + (thrown ? fx * 40 : 0), z = ps.pos.z + (thrown ? fz * 40 : 0);
    let y = ps.pos.y + 40;
    // keep inside walls
    if (thrown && !this.world.lineOfSight(ps.pos.x, y, ps.pos.z, x, y, z)) { x = ps.pos.x + fx * 4; z = ps.pos.z + fz * 4; }
    const gy = this.world.groundHeight(x, y, z, 2000);
    y = gy === null ? ps.pos.y : gy;
    if (item.id === 'c4') {
      this.bomb.state = 1; this.bomb.carrier = 255;
      this.bomb.x = x; this.bomb.y = y; this.bomb.z = z;
      this.bomb.dropTick = this.tick;
      this.bomb.dropBy = p.num;
      this._event({ e: 'bombDrop', x, y, z });
      return;
    }
    const it = { id: this.nextItemId++, wid: item.id, mag: item.mag, res: item.res, x, y, z, yaw: ps.yaw + Math.PI / 2, by: p.num, tick: this.tick };
    this.items.set(it.id, it);
    // invalidate refunds for this item
    p.buys = p.buys.filter((b) => b.ref !== item);
    this._event(this._itemMsg(it));
    return it.id;
  }
  _itemMsg(it) { return { e: 'item+', id: it.id, w: it.wid, x: it.x, y: it.y, z: it.z, yaw: it.yaw }; }

  _pickupLogic(p, useEdge) {
    const ps = p.ps;
    if (!ps.alive) return;
    // bomb pickup for T
    if (this.bomb.state === 1 && ps.team === TEAM.T) {
      const d = Math.hypot(ps.pos.x - this.bomb.x, ps.pos.y - this.bomb.y, ps.pos.z - this.bomb.z);
      const recentlyMine = this.bomb.dropBy === ps.num && this.tick - this.bomb.dropTick < TICK_RATE;
      if (d < 48 && !recentlyMine) {
        ps.inv.c4 = true; this.bomb.state = 0; this.bomb.carrier = p.num;
        this._event({ e: 'bombPick', n: p.num });
      }
    }
    let swapTarget = null, swapDist = 90;
    for (const it of this.items.values()) {
      const dx = it.x - ps.pos.x, dy = it.y - ps.pos.y, dz = it.z - ps.pos.z;
      const d = Math.hypot(dx, dz);
      if (Math.abs(dy) > 80) continue;
      const def = WEAPONS[it.wid];
      const slotKey = def.slot === 1 ? 'primary' : 'secondary';
      const recentlyMine = it.by === p.num && this.tick - it.tick < TICK_RATE;
      if (d < 40 && !ps.inv[slotKey] && !recentlyMine) { this._takeItem(p, it, slotKey); continue; }
      if (useEdge && d < swapDist) {
        // must roughly look at it
        const fx = -Math.sin(ps.yaw), fz = -Math.cos(ps.yaw);
        if ((dx * fx + dz * fz) / (d || 1) > 0.5 || d < 30) { swapTarget = it; swapDist = d; }
      }
    }
    if (swapTarget) {
      const def = WEAPONS[swapTarget.wid];
      const slotKey = def.slot === 1 ? 'primary' : 'secondary';
      if (ps.inv[slotKey]) {
        const old = ps.inv[slotKey]; ps.inv[slotKey] = null;
        this._dropItem(p, old, true);
      }
      this._takeItem(p, swapTarget, slotKey);
    }
  }

  _takeItem(p, it, slotKey) {
    const ps = p.ps;
    ps.inv[slotKey] = { id: it.wid, mag: it.mag, res: it.res };
    this.items.delete(it.id);
    this._event({ e: 'item-', id: it.id });
    this._event({ e: 'snd', k: 'pickup', n: p.num, x: it.x, y: it.y, z: it.z });
    const cur = WEAPONS[ps.active];
    if (!owns(ps, ps.active) || (cur.slot === WEAPONS[it.wid].slot) || (cur.slot > WEAPONS[it.wid].slot && cur.slot === 3)) switchTo(ps, it.wid);
  }

  _bombLogic() {
    const b = this.bomb;
    if (b.state !== 2) return;
    // defusing
    let defuser = b.defuser !== 255 ? this.players.get(b.defuser) : null;
    if (defuser) {
      const ps = defuser.ps;
      const ok = ps.alive && (defuser.lastButtons & BTN.USE) && Math.hypot(ps.pos.x - b.x, ps.pos.y - b.y, ps.pos.z - b.z) < MATCH.defuseRange + 20;
      if (!ok) { b.defuser = 255; b.defuseEnd = 0; this._event({ e: 'defuseAbort' }); defuser = null; }
      else if (this.tick >= b.defuseEnd) {
        b.state = 3; b.defuser = defuser.num;
        this._addMoney(defuser, ECON.defuserReward);
        defuser.stats.score += 2;
        this._event({ e: 'defused', n: defuser.num });
        if (this.phase === PHASE.LIVE) this._endRound(TEAM.CT, 'defuse');
        return;
      }
    }
    if (!defuser && this.phase === PHASE.LIVE) {
      for (const p of this.players.values()) {
        const ps = p.ps;
        if (!ps.alive || ps.team !== TEAM.CT || !(p.lastButtons & BTN.USE) || !ps.onGround) continue;
        const eye = eyePos(ps, {});
        const d = Math.hypot(eye.x - b.x, eye.y - (b.y + 4), eye.z - b.z);
        if (d > MATCH.defuseRange + 20) continue;
        const fx = -Math.sin(ps.yaw) * Math.cos(ps.pitch), fy = Math.sin(ps.pitch), fz = -Math.cos(ps.yaw) * Math.cos(ps.pitch);
        const dot = ((b.x - eye.x) * fx + (b.y + 4 - eye.y) * fy + (b.z - eye.z) * fz) / (d || 1);
        if (dot < 0.6 && d > 36) continue;
        b.defuser = p.num;
        b.defuseEnd = this.tick + (ps.defuser ? MATCH.defuseKitTime : MATCH.defuseTime) * TICK_RATE;
        this._event({ e: 'defuseStart', n: p.num, kit: ps.defuser, end: b.defuseEnd });
        break;
      }
    }
    if (this.tick >= b.end) {
      b.state = 4;
      this._event({ e: 'exploded', x: b.x, y: b.y, z: b.z });
      for (const p of this.players.values()) {
        if (!p.ps.alive) continue;
        const d = Math.hypot(p.ps.pos.x - b.x, p.ps.pos.y - b.y, p.ps.pos.z - b.z);
        if (d > MATCH.bombRadius) continue;
        let dmg = MATCH.bombDamage * Math.exp(-((d / (MATCH.bombRadius / 3)) ** 2));
        if (p.ps.armor > 0) dmg *= 0.5;
        if (dmg >= 1) this._applyDamage(p, null, 'c4', Math.round(dmg), 0, HG.GENERIC, {});
      }
      if (this.phase === PHASE.LIVE) this._endRound(TEAM.T, 'bomb');
    }
  }

  // ---------- buying ----------
  _buy(p, item) {
    const ps = p.ps;
    const fail = (why) => this._event({ e: 'buyFail', item, why }, p.num);
    if (!this._canBuyNow(p)) return fail(this._inBuyZone(p) ? 'Buy time is over' : 'You are not in a buy zone');
    const practice = this.phase === PHASE.PRACTICE;
    const pay = (cost) => { if (!practice) ps.money -= cost; };
    const grenadeCount = ps.inv.he + ps.inv.flash + ps.inv.smoke;
    if (!BUYABLE.has(item)) return fail('Not for sale');
    if (WEAPONS[item]) {
      const def = WEAPONS[item];
      if (def.team && def.team !== ps.team) return fail('Not available for your team');
      if (!def.price && def.cls !== 'pistol') return fail('Not for sale');
      if (ps.money < def.price && !practice) return fail('Insufficient funds');
      if (def.slot === 1 || def.slot === 2) {
        const key = def.slot === 1 ? 'primary' : 'secondary';
        if (ps.inv[key]?.id === item) return fail('Already owned');
        let replaced = 0;
        if (ps.inv[key]) { const old = ps.inv[key]; ps.inv[key] = null; replaced = this._dropItem(p, old, true) || 0; }
        const ref = { id: item, mag: def.mag, res: def.reserve };
        ps.inv[key] = ref;
        pay(def.price);
        switchTo(ps, item);
        p.buys.push({ item, cost: practice ? 0 : def.price, ref, replaced });
      } else if (def.slot === 4) {
        const max = def.max || 1;
        if (ps.inv[item] >= max) return fail('You cannot carry any more');
        if (grenadeCount >= 4) return fail('Grenade limit reached');
        ps.inv[item]++;
        pay(def.price);
        p.buys.push({ item, cost: practice ? 0 : def.price });
      } else return fail('Not for sale');
    } else if (GEAR[item]) {
      const g = GEAR[item];
      if (item === 'kevlar') {
        if (ps.armor >= 100) return fail('Already have full armor');
        if (ps.money < g.price && !practice) return fail('Insufficient funds');
        ps.armor = 100; pay(g.price);
        p.buys.push({ item, cost: practice ? 0 : g.price });
      } else if (item === 'vesthelm') {
        if (ps.armor >= 100 && ps.helmet) return fail('Already have armor and helmet');
        const upgrade = ps.armor >= 100;
        const cost = upgrade ? g.upgrade : g.price;
        if (ps.money < cost && !practice) return fail('Insufficient funds');
        ps.armor = 100; ps.helmet = true; pay(cost);
        p.buys.push({ item, cost: practice ? 0 : cost, upgrade });
      } else if (item === 'defuser') {
        if (ps.team !== TEAM.CT) return fail('CT only');
        if (ps.defuser) return fail('Already owned');
        if (ps.money < g.price && !practice) return fail('Insufficient funds');
        ps.defuser = true; pay(g.price);
        p.buys.push({ item, cost: practice ? 0 : g.price });
      }
    } else return fail('Unknown item');
    this._event({ e: 'buyOk', item }, p.num);
  }

  _refund(p, item) {
    const ps = p.ps;
    const fail = (why) => this._event({ e: 'buyFail', item, why }, p.num);
    if (!this._canBuyNow(p)) return fail('Refunds are only possible during buy time');
    for (let i = p.buys.length - 1; i >= 0; i--) {
      const b = p.buys[i];
      if (b.item !== item) continue;
      const def = WEAPONS[item];
      if (def && (def.slot === 1 || def.slot === 2)) {
        const key = def.slot === 1 ? 'primary' : 'secondary';
        if (ps.inv[key] !== b.ref || b.ref.mag !== def.mag || b.ref.res !== def.reserve) return fail('Item was used or dropped');
        ps.inv[key] = null;
        // give back the weapon this purchase replaced if it is still lying where it was dropped
        const back = b.replaced && this.items.get(b.replaced);
        if (back) { ps.inv[key] = { id: back.wid, mag: back.mag, res: back.res }; this.items.delete(back.id); this._event({ e: 'item-', id: back.id }); }
        if (ps.active === item) switchTo(ps, bestWeapon(ps));
        if (!owns(ps, ps.active)) ps.active = bestWeapon(ps);
      } else if (def && def.slot === 4) {
        if (ps.inv[item] <= 0) return fail('Item was used');
        ps.inv[item]--;
        if (ps.active === item && ps.inv[item] <= 0) switchTo(ps, bestWeapon(ps));
      } else if (item === 'kevlar' || item === 'vesthelm') {
        if (ps.armor < 100) return fail('Armor is damaged');
        if (item === 'vesthelm' && b.upgrade) ps.helmet = false;
        else { ps.armor = 0; ps.helmet = false; }
      } else if (item === 'defuser') {
        if (!ps.defuser) return fail('Not owned');
        ps.defuser = false;
      }
      ps.money = Math.min(ECON.maxMoney, ps.money + b.cost);
      p.buys.splice(i, 1);
      this._event({ e: 'refundOk', item, amt: b.cost }, p.num);
      return;
    }
    fail('Nothing to refund');
  }

  // ---------- main tick ----------
  update() {
    this.tick++;
    const ctx = this._ctx;
    const frozen = this.phase === PHASE.FREEZE;
    ctx.frozen = frozen;
    ctx.noAttack = !(this.phase === PHASE.LIVE || this.phase === PHASE.POST || this.phase === PHASE.PRACTICE || this.phase === PHASE.FREEZE);

    for (const p of this.players.values()) {
      let n = 0;
      while (p.cmdQueue.length && n < 8) {
        const c = p.cmdQueue.shift();
        if (c.seq <= p.lastSeq) continue;
        n++;
        p.lastSeq = c.seq;
        if (p.forceAngles) { c.yaw = p.ps.yaw; c.pitch = p.ps.pitch; }
        if (!Number.isFinite(c.yaw) || !Number.isFinite(c.pitch)) continue;
        ctx.player = p; ctx.viewTick = Number.isFinite(c.viewTick) ? c.viewTick : this.tick;
        const prevReload = p.ps.w.reloadEnd;
        const useEdge = (c.buttons & BTN.USE) && !(p.lastButtons & BTN.USE);
        simulatePlayer(p.ps, c, ctx);
        p.lastButtons = c.buttons;
        if (prevReload === 0 && p.ps.w.reloadEnd > 0) this._event({ e: 'snd', k: 'reload', n: p.num, w: p.ps.active, x: p.ps.pos.x, y: p.ps.pos.y, z: p.ps.pos.z }, 0, p.num);
        this._pickupLogic(p, useEdge);
      }
      if (p.forceAngles && n > 0) p.forceAngles = false;
    }
    this._record();

    // grenades
    for (const g of this.nades) {
      const bounced = stepGrenade(this.world, g, DT);
      if (bounced && g.bounces < 6) this._event({ e: 'snd', k: 'bounce', x: g.x, y: g.y, z: g.z });
      if (shouldDetonate(g)) this._detonate(g);
    }
    this.nades = this.nades.filter((g) => !g.detonated);
    for (const s of this.smokes) s.grow = Math.min(1, (this.tick - s.start) / (TICK_RATE * 1.2));
    this.smokes = this.smokes.filter((s) => this.tick < s.end);

    this._bombLogic();
    this._phaseLogic();

    if (this.tick - this._lastScoresTick >= TICK_RATE) { this._lastScoresTick = this.tick; this._sendScores(); }
    this._flush();
  }

  _phaseLogic() {
    const t = this.tick;
    switch (this.phase) {
      case PHASE.WAITING: {
        const allIn = this.expected.length > 0 && this.expected.every((r) => { const p = this.byPeer.get(r.id); return p && p.ready; });
        const readyCount = [...this.players.values()].filter((p) => p.ready).length;
        const teamsOk = [TEAM.CT, TEAM.T].every((tm) => [...this.players.values()].some((p) => p.ready && p.ps.team === tm));
        if ((allIn || (t >= this.phaseEnd && readyCount >= 2)) && teamsOk) {
          this.phase = PHASE.WARMUP; this.phaseEnd = t + MATCH.warmupTime * TICK_RATE;
          for (const p of this.players.values()) { p.ps.alive = true; giveDefaultLoadout(p.ps); this._placeAtSpawn(p, p.num); }
          this._event({ e: 'warmup' });
        } else if (t >= this.phaseEnd && !teamsOk && this.mode !== 'private') {
          this._gameOver(TEAM.CT, 'not enough players'); this.phase = PHASE.GAMEOVER; this.phaseEnd = t + 3 * TICK_RATE;
        } else if (t >= this.phaseEnd) this.phaseEnd = t + 5 * TICK_RATE;
        break;
      }
      case PHASE.WARMUP:
        if (t >= this.phaseEnd) this._startMatch();
        break;
      case PHASE.FREEZE:
        if (t >= this.phaseEnd) { this.phase = PHASE.LIVE; this.phaseEnd = t + MATCH.roundTime * TICK_RATE; this._event({ e: 'live' }); }
        break;
      case PHASE.LIVE:
        if (this.bomb.state !== 2 && t >= this.phaseEnd) this._endRound(TEAM.CT, 'time');
        break;
      case PHASE.POST:
        if (t >= this.phaseEnd) {
          const sCT = this.score[TEAM.CT], sT = this.score[TEAM.T];
          if (sCT >= MATCH.winRounds || sT >= MATCH.winRounds) this._gameOver(sCT > sT ? TEAM.CT : TEAM.T, 'score');
          else if (this.round >= MATCH.maxRounds) this._gameOver(sCT === sT ? 0 : sCT > sT ? TEAM.CT : TEAM.T, sCT === sT ? 'draw' : 'score');
          else if (this.round === MATCH.halfRound) this._halftime();
          else this._startRound(false);
        }
        break;
      case PHASE.HALFTIME:
        if (t >= this.phaseEnd) { this._swapTeams(); this._startRound(true); }
        break;
      case PHASE.GAMEOVER:
        if (t >= this.phaseEnd && !this.ended) {
          this.ended = true;
          this._event({ e: 'close' });
          this._flush();
          if (this.onEnd) setTimeout(() => this.onEnd(), 300);
        }
        break;
    }
  }

  _scoreList(forTeam) {
    return [...this.players.values()].map((p) => ({
      num: p.num, k: p.stats.k, d: p.stats.d, a: p.stats.a, dmg: p.stats.dmg, hs: p.stats.hs, mvp: p.stats.mvp, score: p.stats.score,
      ping: p.link && p.link.local ? 0 : p.ping, money: !forTeam || p.ps.team === forTeam ? p.ps.money : -1, alive: p.ps.alive, team: p.ps.team,
      hp: p.ps.hp,
    }));
  }

  _sendScores() {
    const ct = this._scoreList(TEAM.CT), t = this._scoreList(TEAM.T);
    for (const p of this.players.values()) {
      if (!p.link) continue;
      p.link.send({ t: 'ev', l: [{ e: 'scores', list: p.ps.team === TEAM.T ? t : ct, rounds: this.round, loss: { ...this.lossCounter } }] });
    }
  }

  _flush() {
    const evs = this.events;
    this.events = [];
    const bomb = this.bomb;
    const others = [];
    for (const p of this.players.values()) {
      const ps = p.ps;
      let f = 0;
      if (ps.alive) f |= PF.ALIVE;
      if (ps.onGround) f |= PF.GROUND;
      if (p.lastButtons & BTN.WALK) f |= PF.WALK;
      if (ps.w.scope > 0) f |= PF.SCOPED;
      if (ps.w.plantStart >= 0) f |= PF.PLANTING;
      if (bomb.defuser === p.num) f |= PF.DEFUSING;
      if (ps.w.reloadEnd > 0) f |= PF.RELOADING;
      if (ps.inv.c4) f |= PF.C4;
      if (ps.helmet) f |= PF.HELMET;
      if (ps.w.nade) f |= PF.NADE;
      if (ps.team === TEAM.T) f |= PF.TEAM_T;
      if (ps.defuser) f |= PF.DEFUSER;
      if (ps.time - ps.w.lastShot < 0.1) f |= PF.FIRING;
      others.push({ num: p.num, flags: f, x: ps.pos.x, y: ps.pos.y, z: ps.pos.z, yaw: wrapAngle(ps.yaw), pitch: ps.pitch, duck: ps.duck, wpn: WEAPON_CODE[ps.active] || 0, hp: ps.hp, armor: ps.armor });
    }
    const snapBase = {
      tick: this.tick, phase: this.phase, phaseEnd: this.phaseEnd, round: this.round,
      scoreCT: this.score[TEAM.CT], scoreT: this.score[TEAM.T],
      bomb: { state: bomb.state, x: bomb.x, y: bomb.y, z: bomb.z, end: bomb.end, defuser: bomb.defuser, defuseEnd: bomb.defuseEnd, site: bomb.site, carrier: bomb.carrier },
      players: others,
    };
    for (const p of this.players.values()) {
      if (!p.link) continue;
      const mine = evs.filter((e) => (!e._to || e._to === p.num) && e._ex !== p.num);
      if (mine.length) p.link.send({ t: 'ev', l: mine });
      snapBase.ackSeq = p.lastSeq;
      snapBase.own = JSON.stringify(p.ps);
      p.link.sendFast(encodeSnapshot(snapBase));
    }
  }

  destroy() {
    for (const p of this.players.values()) if (p.link && !p.link.local) p.link.close();
    this.players.clear();
  }
}
