// network.js — PeerJS-based P2P lobby, state sync, and chat.
// Host acts as the authority that relays every message to all connections
// (simple star topology — good enough for small tactical lobbies, no server
// needed at all beyond PeerJS's free signalling broker).

class NetworkManager {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.roomId = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.players = new Map();     // peerId -> {name, map, mode, x,y,z,yaw, hp, ...}
    this.myId = null;
    this.localName = 'AGENT';

    this.onPlayerListChanged = null;
    this.onChatMessage = null;
    this.onMatchStart = null;
    this.onPlayerState = null;
    this.onPlayerLeft = null;
    this.onKillFeed = null;
  }

  _send(conn, data) {
    try { if (conn.open) conn.send(data); } catch (e) { /* ignore */ }
  }

  _broadcast(data, exceptId) {
    for (const [id, conn] of this.connections) {
      if (id === exceptId) continue;
      this._send(conn, data);
    }
  }

  host(name) {
    this.localName = name || this.localName;
    this.isHost = true;
    this.peer = new Peer();
    return new Promise((resolve, reject) => {
      this.peer.on('open', (id) => {
        this.myId = id;
        this.roomId = id;
        this.players.set(id, { name: this.localName, ready: true });
        this._emitPlayerList();
        resolve(id);
      });
      this.peer.on('connection', (conn) => this._handleIncoming(conn));
      this.peer.on('error', (err) => reject(err));
    });
  }

  join(roomId, name) {
    this.localName = name || this.localName;
    this.isHost = false;
    this.roomId = roomId;
    this.peer = new Peer();
    return new Promise((resolve, reject) => {
      this.peer.on('open', (id) => {
        this.myId = id;
        const conn = this.peer.connect(roomId, { reliable: true });
        conn.on('open', () => {
          this.connections.set(roomId, conn);
          this._send(conn, { t: 'hello', name: this.localName, id: this.myId });
          this._wireConn(conn);
          resolve(id);
        });
        conn.on('error', (err) => reject(err));
      });
      this.peer.on('error', (err) => reject(err));
    });
  }

  _handleIncoming(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
    });
    this._wireConn(conn);
  }

  _wireConn(conn) {
    conn.on('data', (data) => this._onData(conn, data));
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.players.delete(conn.peer);
      this._emitPlayerList();
      if (this.onPlayerLeft) this.onPlayerLeft(conn.peer);
      if (this.isHost) this._broadcast({ t: 'leave', id: conn.peer });
    });
  }

  _onData(conn, data) {
    switch (data.t) {
      case 'hello': {
        this.players.set(conn.peer, { name: data.name, ready: true });
        this._emitPlayerList();
        if (this.isHost) {
          // Tell newcomer about everyone, then tell everyone about newcomer
          this._send(conn, { t: 'roster', players: Array.from(this.players.entries()) });
          this._broadcast({ t: 'join', id: conn.peer, name: data.name }, conn.peer);
        }
        break;
      }
      case 'roster': {
        for (const [id, p] of data.players) this.players.set(id, p);
        this._emitPlayerList();
        break;
      }
      case 'join': {
        this.players.set(data.id, { name: data.name, ready: true });
        this._emitPlayerList();
        break;
      }
      case 'leave': {
        this.players.delete(data.id);
        this._emitPlayerList();
        break;
      }
      case 'chat': {
        if (this.onChatMessage) this.onChatMessage(data.name, data.msg, data.id);
        if (this.isHost) this._broadcast(data, conn.peer);
        break;
      }
      case 'matchStart': {
        if (this.onMatchStart) this.onMatchStart(data.map, data.mode);
        if (this.isHost) this._broadcast(data, conn.peer);
        break;
      }
      case 'state': {
        if (this.onPlayerState) this.onPlayerState(data.id, data);
        if (this.isHost) this._broadcast(data, conn.peer);
        break;
      }
      case 'kill': {
        if (this.onKillFeed) this.onKillFeed(data.killer, data.victim);
        if (this.isHost) this._broadcast(data, conn.peer);
        break;
      }
    }
  }

  _emitPlayerList() {
    if (this.onPlayerListChanged) this.onPlayerListChanged(this.players, this.myId);
  }

  sendChat(msg) {
    const data = { t: 'chat', name: this.localName, msg, id: this.myId };
    if (this.onChatMessage) this.onChatMessage(this.localName, msg, this.myId);
    if (this.isHost) this._broadcast(data);
    else { const conn = this.connections.get(this.roomId); this._send(conn, data); }
  }

  startMatch(map, mode) {
    const data = { t: 'matchStart', map, mode };
    if (this.isHost) this._broadcast(data);
    if (this.onMatchStart) this.onMatchStart(map, mode);
  }

  sendState(stateObj) {
    const data = { t: 'state', id: this.myId, ...stateObj };
    if (this.isHost) this._broadcast(data);
    else { const conn = this.connections.get(this.roomId); this._send(conn, data); }
  }

  sendKill(killer, victim) {
    const data = { t: 'kill', killer, victim };
    if (this.onKillFeed) this.onKillFeed(killer, victim);
    if (this.isHost) this._broadcast(data);
    else { const conn = this.connections.get(this.roomId); this._send(conn, data); }
  }

  get playerCount() { return this.players.size || 1; }
}
