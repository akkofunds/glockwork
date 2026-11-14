// Zero-config matchmaking over PeerJS: friend parties (5-char codes / invite links), public queues using
// deterministic coordinator peer IDs (first client to claim the ID coordinates), and private friend matches.
import { createPeer, connectLink, acceptLinks } from './peer.js';
import { NET_CONFIG } from '../netconfig.js';
import { randomCode } from '../util.js';
import { TEAM } from '../config.js';

export const QUEUE_SIZES = { '1v1': 1, '2v2': 2, '5v5': 5, tdm: 5 };
const P = NET_CONFIG.idPrefix;

class Emitter {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] ||= []).push(f); return () => { this.h[e] = this.h[e].filter((x) => x !== f); }; }
  emit(e, ...a) { (this.h[e] || []).forEach((f) => { try { f(...a); } catch (err) { console.error(err); } }); }
}

export class Matchmaker extends Emitter {
  constructor() {
    super();
    this.name = 'Player';
    this.peer = null; // personal peer (game host/client endpoint)
    this.party = null; // { code, leader:boolean, members:[{id,name,team}], peer?, links?, link? }
    this.queue = null; // { mode, status, coordPeer?, coordLink?, entries? }
    this.gameLinkHandler = null; // set by host to receive incoming game links
    this._partyLinks = new Map();
  }

  get myId() { return this.peer?.id; }

  async ensurePeer() {
    if (this.peer && !this.peer.destroyed && !this.peer.disconnected) return this.peer;
    if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
      try { this.peer.reconnect(); await new Promise((r) => setTimeout(r, 800)); if (!this.peer.disconnected) return this.peer; } catch { /* fallthrough */ }
    }
    this.peer = await createPeer(P + 'p-' + randomCode(10).toLowerCase());
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch { /* ignore */ } });
    acceptLinks(this.peer, (link) => {
      if (link.kind === 'game' && this.gameLinkHandler) this.gameLinkHandler(link);
      else link.close();
    });
    return this.peer;
  }

  // ---------------- Party ----------------
  async createParty() {
    await this.ensurePeer();
    this.leaveParty();
    let code, ppeer;
    for (let i = 0; i < 4; i++) {
      code = randomCode(5);
      try { ppeer = await createPeer(P + 'party-' + code); break; } catch (e) { if (e.type !== 'unavailable-id') throw e; }
    }
    if (!ppeer) throw new Error('Could not create party');
    this.party = { code, leader: true, peer: ppeer, links: new Map(), members: [{ id: this.myId, name: this.name, team: TEAM.CT, leader: true }] };
    acceptLinks(ppeer, (link) => {
      if (link.kind !== 'party') { link.close(); return; }
      link.onMessage = (d) => this._onPartyMsgLeader(link, d);
      link.onClose = () => {
        this.party?.links.delete(link.id);
        if (this.party) {
          this.party.members = this.party.members.filter((m) => m.linkId !== link.id);
          this._broadcastParty();
        }
      };
    });
    this.emit('party', this.party);
    return code;
  }

  _onPartyMsgLeader(link, d) {
    let m; try { m = JSON.parse(d); } catch { return; }
    const party = this.party; if (!party) return;
    if (m.t === 'hello') {
      if (party.members.length >= 5) { link.send({ t: 'full' }); setTimeout(() => link.close(), 300); return; }
      if (this.queue) { link.send({ t: 'busy' }); setTimeout(() => link.close(), 300); return; }
      party.links.set(link.id, link);
      const cts = party.members.filter((x) => x.team === TEAM.CT).length;
      const ts = party.members.length - cts;
      party.members.push({ id: m.id, name: String(m.name || 'Player').slice(0, 20), team: cts > ts ? TEAM.T : TEAM.CT, linkId: link.id });
      this._broadcastParty();
    } else if (m.t === 'team') {
      const mem = party.members.find((x) => x.linkId === link.id);
      if (mem && (m.team === TEAM.CT || m.team === TEAM.T)) { mem.team = m.team; this._broadcastParty(); }
    } else if (m.t === 'chat') {
      this._broadcastParty({ t: 'chat', from: party.members.find((x) => x.linkId === link.id)?.name, text: String(m.text).slice(0, 120) });
    } else if (m.t === 'paccept' && this.found && this.found.pid === m.pid) {
      this.found.memberAccepts.add(link.id);
      this._maybeSendEntryAccept();
    }
  }

  setMemberTeam(id, team) {
    if (!this.party) return;
    if (this.party.leader) {
      const mem = this.party.members.find((x) => x.id === id);
      if (mem) { mem.team = team; this._broadcastParty(); }
    } else if (id === this.myId) {
      this.party.link?.send({ t: 'team', team });
    }
  }

  _broadcastParty(extra) {
    const p = this.party; if (!p || !p.leader) return;
    const msg = extra || { t: 'party', code: p.code, members: p.members.map(({ id, name, team, leader }) => ({ id, name, team, leader: !!leader })) };
    for (const l of p.links.values()) l.send(msg);
    if (!extra) this.emit('party', p);
    else if (extra.t === 'chat') this.emit('chat', extra);
  }

  async joinParty(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) throw new Error('Party codes are 5 letters/numbers');
    await this.ensurePeer();
    this.leaveParty();
    const link = await connectLink(this.peer, P + 'party-' + code, 'party', { name: this.name });
    this.party = { code, leader: false, link, members: [] };
    link.onMessage = (d) => {
      let m; try { m = JSON.parse(d); } catch { return; }
      if (m.t === 'party') { this.party.members = m.members; this.emit('party', this.party); }
      else if (m.t === 'full' || m.t === 'busy') { this.emit('error', m.t === 'full' ? 'Party is full' : 'Party is currently in queue'); }
      else if (m.t === 'qstat') this.emit('queue', { mode: m.mode, found: m.found, needed: m.needed, status: m.status });
      else if (m.t === 'match') { this.found = null; this.emit('found', null); this.emit('match', m.match); }
      else if (m.t === 'found' || m.t === 'acc' || m.t === 'decline') this._onFound(m);
      else if (m.t === 'chat') this.emit('chat', m);
    };
    link.onClose = () => { if (this.party?.link === link) { this.party = null; this.emit('party', null); this.emit('error', 'Left party (leader disconnected)'); } };
    link.send({ t: 'hello', id: this.myId, name: this.name });
    this.emit('party', this.party);
    return this.party;
  }

  leaveParty() {
    const p = this.party; if (!p) return;
    this.party = null;
    if (p.leader) {
      for (const l of p.links.values()) l.close();
      setTimeout(() => { try { p.peer.destroy(); } catch { /* ignore */ } }, 200);
    } else p.link?.close();
    this.emit('party', null);
  }

  partyChat(text) {
    if (!this.party) return;
    if (this.party.leader) this._broadcastParty({ t: 'chat', from: this.name, text });
    else this.party.link.send({ t: 'chat', text });
  }

  // Private friend match: leader hosts; roster comes from party team picks.
  startPrivateMatch(mapDesc, rules = 'defusal') {
    const p = this.party;
    if (!p || !p.leader) throw new Error('Only the party leader can start');
    const roster = p.members.map((m) => ({ id: m.id, name: m.name, team: m.team }));
    const match = { hostId: this.myId, roster, mode: 'private', rules, map: mapDesc };
    for (const l of p.links.values()) l.send({ t: 'match', match });
    this.emit('match', match);
  }

  // ---------------- Public queue ----------------
  async joinQueue(mode) {
    if (!QUEUE_SIZES[mode]) throw new Error('Unknown mode');
    if (this.party && !this.party.leader) throw new Error('Only the party leader can queue');
    const size = this.party ? this.party.members.length : 1;
    if (size > QUEUE_SIZES[mode]) throw new Error(`Party too large for ${mode}`);
    await this.ensurePeer();
    this.leaveQueue();
    const members = this.party ? this.party.members.map(({ id, name }) => ({ id, name })) : [{ id: this.myId, name: this.name }];
    this.queue = { mode, members, status: 'searching', found: size, needed: QUEUE_SIZES[mode] * 2, gen: Math.random() };
    this._queueAttempt(this.queue.gen);
    this._emitQueue();
  }

  async _queueAttempt(gen) {
    const q = this.queue; if (!q || q.gen !== gen) return;
    const coordId = P + 'q-' + q.mode;
    // Try to become the coordinator
    try {
      const cp = await createPeer(coordId);
      if (!this.queue || this.queue.gen !== gen) { cp.destroy(); return; }
      this._becomeCoordinator(cp);
      return;
    } catch (e) {
      if (e.type !== 'unavailable-id' && !/taken|unavailable/i.test(e.message || '')) {
        if (!this.queue || this.queue.gen !== gen) return;
        q.status = 'error: ' + (e.message || e.type);
        this._emitQueue();
        setTimeout(() => this._queueAttempt(gen), 3000);
        return;
      }
    }
    // Join existing coordinator
    try {
      const link = await connectLink(this.peer, coordId, 'queue', {});
      if (!this.queue || this.queue.gen !== gen) { link.close(); return; }
      q.coordLink = link;
      link.onMessage = (d) => {
        let m; try { m = JSON.parse(d); } catch { return; }
        if (m.t === 'qstat') { q.found = m.found; q.needed = m.needed; q.status = 'searching'; this._emitQueue(); }
        else if (m.t === 'found' || m.t === 'acc' || m.t === 'decline') this._onFound(m);
        else if (m.t === 'match') this._matchFound(m.match);
      };
      link.onClose = () => {
        if (this.queue === q && q.coordLink === link) {
          q.coordLink = null; q.status = 'reconnecting'; this._emitQueue();
          setTimeout(() => this._queueAttempt(gen), 300 + Math.random() * 1200);
        }
      };
      link.send({ t: 'join', entry: this.myId, members: q.members });
    } catch {
      if (this.queue && this.queue.gen === gen) setTimeout(() => this._queueAttempt(gen), 500 + Math.random() * 1500);
    }
  }

  _becomeCoordinator(cp) {
    const q = this.queue;
    q.coordPeer = cp;
    q.entries = [{ entry: this.myId, members: q.members, link: null, t: performance.now() }];
    acceptLinks(cp, (link) => {
      if (link.kind !== 'queue') { link.close(); return; }
      link.onMessage = (d) => {
        let m; try { m = JSON.parse(d); } catch { return; }
        if (m.t === 'accept') { this._coordAccept(link, m.pid); return; }
        if (m.t === 'join' && Array.isArray(m.members) && m.members.length <= QUEUE_SIZES[q.mode]) {
          q.entries = q.entries.filter((e) => e.entry !== m.entry);
          q.entries.push({ entry: m.entry, members: m.members.slice(0, 5).map((x) => ({ id: String(x.id), name: String(x.name).slice(0, 20) })), link, t: performance.now() });
          this._coordTick();
        }
      };
      link.onClose = () => {
        if (this.queue !== q) return;
        q.entries = q.entries.filter((e) => e.link !== link);
        if (q.proposal && q.proposal.chosen.some((e) => e.link === link)) this._proposalFail();
        this._coordTick();
      };
    });
    cp.on('disconnected', () => { try { cp.reconnect(); } catch { /* ignore */ } });
    q.coordTimer = setInterval(() => { if (this.queue === q) this._coordTick(); else clearInterval(q.coordTimer); }, 2000);
    this._coordTick();
  }

  _coordTick() {
    const q = this.queue; if (!q || !q.entries) return;
    const size = QUEUE_SIZES[q.mode];
    const found = q.entries.reduce((s, e) => s + e.members.length, 0);
    const needed = size * 2;
    // Try to partition free entries (FIFO preference) into two full teams, parties kept together
    const es = q.entries.filter((e) => !e.locked);
    const pick = new Array(es.length).fill(0);
    let solution = null;
    const dfs = (i, a, b) => {
      if (a === size && b === size) { solution = pick.slice(); return true; }
      if (i >= es.length) return false;
      const n = es[i].members.length;
      if (a + n <= size) { pick[i] = 1; if (dfs(i + 1, a + n, b)) return true; }
      if (b + n <= size) { pick[i] = 2; if (dfs(i + 1, a, b + n)) return true; }
      pick[i] = 0; return dfs(i + 1, a, b);
    };
    if (!q.proposal && q.mode !== 'tdm') dfs(0, 0, 0);
    // Team Deathmatch: flexible teams — launch with 2+ players once the queue has waited a bit (or is full)
    if (!q.proposal && q.mode === 'tdm') {
      const total = es.reduce((n, e) => n + e.members.length, 0);
      const oldest = es.length ? performance.now() - Math.min(...es.map((e) => e.t)) : 0;
      if (total >= 2 && (total >= 10 || oldest > 12000)) {
        let a = 0, b = 0;
        es.forEach((e, i) => {
          const n = e.members.length;
          if (a <= b && a + n <= 5) { pick[i] = 1; a += n; } else if (b + n <= 5) { pick[i] = 2; b += n; } else pick[i] = 0;
        });
        if (a > 0 && b > 0) solution = pick.slice();
      }
    }
    if (solution) {
      const chosen = es.filter((_, i) => solution[i]);
      const roster = [];
      chosen.forEach((e) => {
        const team = solution[es.indexOf(e)] === 1 ? TEAM.CT : TEAM.T;
        e.members.forEach((m) => roster.push({ id: m.id, name: m.name, team }));
        e.locked = true;
      });
      const pid = randomCode(8);
      const total = roster.length;
      q.proposal = { pid, chosen, roster, accepted: new Set(), total, timer: setTimeout(() => this._proposalTimeout(), 16000) };
      const msg = { t: 'found', pid, mode: q.mode, roster: roster.map((r) => ({ name: r.name, team: r.team })), total, ttl: 15 };
      for (const e of chosen) { if (e.link) e.link.send(msg); else this._onFound(msg); }
      return;
    }
    const f2 = q.entries.reduce((s, e) => s + e.members.length, 0);
    for (const e of q.entries) e.link?.send({ t: 'qstat', found: f2, needed });
    q.found = q.entries.find((e) => e.link === null) ? f2 : found;
    q.needed = needed;
    q.status = 'searching (coordinator)';
    this._emitQueue();
  }

  _emitQueue() {
    const q = this.queue;
    const info = q ? { mode: q.mode, found: q.found, needed: q.needed, status: q.status } : null;
    this.emit('queue', info);
    if (this.party?.leader) this._broadcastParty({ t: 'qstat', mode: q?.mode, found: q?.found, needed: q?.needed, status: q ? q.status : 'idle' });
  }

  _matchFound(match) {
    this.found = null;
    this.emit('found', null);
    const q = this.queue;
    if (q) {
      this.queue = null;
      if (q.coordLink) { const l = q.coordLink; q.coordLink = null; setTimeout(() => l.close(), 500); }
      if (q.coordPeer && !match.roster.find((r) => r.id === this.myId)) { /* not ours */ }
    }
    if (this.party?.leader) for (const l of this.party.links.values()) l.send({ t: 'match', match });
    this.emit('queue', null);
    this.emit('match', match);
  }

  // ---- match accept flow ----
  _onFound(m) {
    if (m.t === 'found') {
      this.found = { pid: m.pid, mode: m.mode, roster: m.roster, total: m.total, accepted: 0, me: false, deadline: performance.now() + m.ttl * 1000, memberAccepts: new Set() };
    } else if (m.t === 'acc') {
      if (this.found && this.found.pid === m.pid) this.found.accepted = m.n;
    } else if (m.t === 'decline') {
      this.found = null;
    }
    if (this.party?.leader) for (const l of this.party.links.values()) l.send(m);
    this.emit('found', this.found);
  }

  acceptMatch() {
    const f = this.found; if (!f || f.me) return;
    f.me = true;
    if (this.party && !this.party.leader) { this.party.link.send({ t: 'paccept', pid: f.pid }); this.emit('found', f); return; }
    this._maybeSendEntryAccept();
    this.emit('found', f);
  }

  _maybeSendEntryAccept() {
    const f = this.found; if (!f || !f.me || f.sent) return;
    if (this.party?.leader && f.memberAccepts.size < this.party.links.size) return;
    f.sent = true;
    const q = this.queue; if (!q) return;
    if (q.coordLink) q.coordLink.send({ t: 'accept', pid: f.pid });
    else if (q.coordPeer) this._coordAccept(null, f.pid);
  }

  _coordAccept(link, pid) {
    const q = this.queue, pr = q?.proposal;
    if (!pr || pr.pid !== pid) return;
    const entry = pr.chosen.find((e) => e.link === link);
    if (!entry) return;
    pr.accepted.add(entry);
    const n = [...pr.accepted].reduce((s2, e) => s2 + e.members.length, 0);
    const msg = { t: 'acc', pid, n };
    for (const e of pr.chosen) { if (e.link) e.link.send(msg); else this._onFound(msg); }
    if (pr.accepted.size === pr.chosen.length) {
      clearTimeout(pr.timer);
      q.proposal = null;
      const match = { hostId: pr.chosen[0].entry, roster: pr.roster, mode: q.mode, rules: q.mode === 'tdm' ? 'tdm' : 'defusal', map: { kind: 'default' } };
      q.entries = q.entries.filter((e) => !pr.chosen.includes(e));
      let meIncluded = false;
      for (const e of pr.chosen) {
        if (e.link) { e.link.send({ t: 'match', match }); setTimeout(() => e.link.close(), 1500); } else meIncluded = true;
      }
      if (meIncluded) {
        const cp = q.coordPeer;
        setTimeout(() => { for (const e of q.entries) e.link?.close(); try { cp.destroy(); } catch { /* ignore */ } }, 1600);
        this._matchFound(match);
      } else this._coordTick();
    }
  }

  _proposalTimeout() { this._proposalFail(true); }
  _proposalFail(timeout) {
    const q = this.queue, pr = q?.proposal;
    if (!pr) return;
    clearTimeout(pr.timer);
    q.proposal = null;
    for (const e of pr.chosen) {
      e.locked = false;
      if (pr.accepted.has(e)) { if (e.link) e.link.send({ t: 'decline', pid: pr.pid }); else this._onFound({ t: 'decline', pid: pr.pid }); }
      else if (timeout) {
        // did not accept in time: removed from the queue (CS-style)
        q.entries = q.entries.filter((x) => x !== e);
        if (e.link) { e.link.send({ t: 'decline', pid: pr.pid, kicked: true }); setTimeout(() => e.link.close(), 300); }
        else { this._onFound({ t: 'decline', pid: pr.pid }); setTimeout(() => this.leaveQueue(), 0); }
      }
    }
    this._coordTick();
  }

  leaveQueue() {
    const q = this.queue; if (!q) return;
    this.queue = null;
    q.gen = -1;
    if (q.coordLink) q.coordLink.close();
    if (q.coordTimer) clearInterval(q.coordTimer);
    if (q.coordPeer) {
      for (const e of q.entries || []) e.link?.close();
      try { q.coordPeer.destroy(); } catch { /* ignore */ }
    }
    this._emitQueue();
  }

  // Client: open a game link to the match host
  connectToHost(hostId, info) {
    return connectLink(this.peer, hostId, 'game', info, 20000);
  }
}
