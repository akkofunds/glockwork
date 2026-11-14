// Network configuration. Edit this file to add TURN servers (needed for some mobile carriers / strict NATs)
// or to point at a self-hosted PeerJS signalling server. Leave `signal` null to use the free PeerJS cloud.
// You can also override the signalling server at runtime with ?signal=host:port (e.g. ?signal=localhost:9000).
import { GAME_VERSION } from './config.js';

export const NET_CONFIG = {
  signal: null, // e.g. { host: 'peer.example.com', port: 443, path: '/', secure: true }
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
  ],
  idPrefix: `flashpoint-v${GAME_VERSION}-`,
};
