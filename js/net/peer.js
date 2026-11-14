// Thin PeerJS wrapper: peer creation, and "Links" = a reliable ordered channel (JSON events / file chunks)
// plus an unordered channel for 64 Hz binary traffic.
import { NET_CONFIG } from '../netconfig.js';

export function peerOptions() {
  const q = new URLSearchParams(location.search);
  let sig = q.get('signal');
  try { if (!sig) sig = localStorage.getItem('fp_signal'); } catch { /* storage unavailable */ }
  const opts = { debug: 1, config: { iceServers: NET_CONFIG.iceServers } };
  if (sig) {
    const [host, port] = sig.split(':');
    opts.host = host;
    opts.port = port ? +port : 443;
    opts.secure = !(host === 'localhost' || host.startsWith('127.') || host.startsWith('192.168.')) && opts.port === 443;
    opts.path = '/';
  } else if (NET_CONFIG.signal) Object.assign(opts, NET_CONFIG.signal);
  return opts;
}

export function createPeer(id) {
  return new Promise((resolve, reject) => {
    if (!window.Peer) { reject(new Error('PeerJS failed to load (check your connection)')); return; }
    const peer = id ? new window.Peer(id, peerOptions()) : new window.Peer(peerOptions());
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; try { peer.destroy(); } catch { /* ignore */ } reject(new Error('Signalling server timeout')); } }, 15000);
    peer.on('open', () => { if (done) return; done = true; clearTimeout(to); resolve(peer); });
    peer.on('error', (e) => {
      if (done) return;
      done = true; clearTimeout(to);
      try { peer.destroy(); } catch { /* ignore */ }
      reject(e);
    });
  });
}

export class Link {
  constructor(peerId, kind) {
    this.id = peerId;
    this.kind = kind;
    this.rel = null;
    this.fast = null;
    this.open = false;
    this.closed = false;
    this.onMessage = null; // (data:string|ArrayBuffer, link)
    this.onClose = null;
    this.onOpen = null;
    this.meta = {};
  }
  attach(conn) {
    const ch = conn.metadata?.ch || 'rel';
    if (ch === 'fast') this.fast = conn; else this.rel = conn;
    if (conn.metadata) Object.assign(this.meta, conn.metadata);
    conn.on('data', (d) => { if (this.onMessage) this.onMessage(d, this); });
    conn.on('close', () => { if (ch === 'rel') this._closed(); else this.fast = null; });
    conn.on('error', () => { if (ch === 'rel') this._closed(); });
    const markOpen = () => {
      if (ch === 'rel' && !this.open) { this.open = true; this.onOpen && this.onOpen(this); }
    };
    if (conn.open) markOpen(); else conn.on('open', markOpen);
  }
  _closed() {
    if (this.closed) return;
    this.closed = true; this.open = false;
    this.onClose && this.onClose(this);
  }
  send(obj) {
    if (!this.rel || !this.rel.open) return false;
    try { this.rel.send(typeof obj === 'string' || obj instanceof ArrayBuffer ? obj : JSON.stringify(obj)); return true; } catch { return false; }
  }
  sendFast(buf) {
    try {
      if (this.fast && this.fast.open) { this.fast.send(buf); return true; }
      if (this.rel && this.rel.open) { this.rel.send(buf); return true; }
    } catch { /* channel closed */ }
    return false;
  }
  close() {
    try { this.rel && this.rel.close(); } catch { /* ignore */ }
    try { this.fast && this.fast.close(); } catch { /* ignore */ }
    this._closed();
  }
}

// Outgoing link (opens both channels)
export function connectLink(peer, remoteId, kind, meta = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const link = new Link(remoteId, kind);
    const rel = peer.connect(remoteId, { reliable: true, serialization: 'raw', metadata: { ...meta, kind, ch: 'rel' } });
    link.attach(rel);
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; link.close(); reject(new Error('Connection timed out')); } }, timeoutMs);
    link.onOpen = () => {
      if (done) return;
      done = true; clearTimeout(to);
      try {
        const fast = peer.connect(remoteId, { reliable: false, serialization: 'raw', metadata: { ...meta, kind, ch: 'fast' } });
        link.attach(fast);
      } catch { /* fast channel optional */ }
      resolve(link);
    };
    const onErr = (e) => {
      if (done) return;
      if (e && e.type === 'peer-unavailable' && String(e.message || '').includes(remoteId)) {
        done = true; clearTimeout(to); peer.off('error', onErr); reject(e);
      }
    };
    peer.on('error', onErr);
  });
}

// Incoming link registry: groups rel+fast DataConnections from the same remote peer.
export function acceptLinks(peer, onLink) {
  const links = new Map();
  peer.on('connection', (conn) => {
    const kind = conn.metadata?.kind || 'unknown';
    const key = conn.peer + '|' + kind;
    let link = links.get(key);
    if (!link || link.closed) {
      if (conn.metadata?.ch === 'fast') {
        // fast channel arrived first or for a dead link — attach to whatever we have when possible
        link = links.get(key);
        if (!link) return;
      } else {
        link = new Link(conn.peer, kind);
        links.set(key, link);
        link.onOpen = () => onLink(link);
        link.attach(conn);
        return;
      }
    }
    link.attach(conn);
  });
  return links;
}
