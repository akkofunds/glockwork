// ui.js — Lobby screen wiring, player cards, chat box behaviour.

const UI = {
  selectedMap: 'shipyard',
  selectedMode: 'ffa',

  init(net, onStart) {
    this.net = net;
    this.onStart = onStart;

    document.querySelectorAll('.map-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.map-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedMap = card.dataset.map;
      });
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedMode = btn.dataset.mode;
      });
    });

    document.getElementById('hostBtn').addEventListener('click', async () => {
      const name = this._name();
      this._status('Opening party...');
      try {
        const id = await net.host(name);
        document.getElementById('roomIdDisplay').textContent = id;
        this._status('Party open. Share the Room ID or invite link.');
      } catch (e) {
        this._status('Failed to host: ' + e.message);
      }
    });

    document.getElementById('joinBtn').addEventListener('click', async () => {
      const name = this._name();
      const roomId = document.getElementById('joinIdInput').value.trim();
      if (!roomId) { this._status('Enter a Room ID first.'); return; }
      this._status('Joining party...');
      try {
        await net.join(roomId, name);
        document.getElementById('roomIdDisplay').textContent = roomId;
        this._status('Joined! Waiting for host to start the match.');
      } catch (e) {
        this._status('Failed to join: ' + e.message);
      }
    });

    document.getElementById('copyInviteBtn').addEventListener('click', () => {
      const id = net.roomId;
      if (!id) { this._status('Host or join a party first.'); return; }
      const url = `${location.origin}${location.pathname}?room=${id}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      this._status('Invite link copied to clipboard.');
    });

    document.getElementById('startBtn').addEventListener('click', () => {
      if (!net.isHost) {
        this._status('Only the party host can start the match.');
        return;
      }
      net.startMatch(this.selectedMap, this.selectedMode);
    });

    net.onPlayerListChanged = (players, myId) => this.renderPlayerCards(players, myId);
    net.onMatchStart = (map, mode) => {
      this.selectedMap = map;
      this.onStart(map, mode);
    };

    // Auto-fill join field from ?room= invite link
    const params = new URLSearchParams(location.search);
    if (params.get('room')) document.getElementById('joinIdInput').value = params.get('room');

    this.renderPlayerCards(new Map(), null);
  },

  _name() {
    const v = document.getElementById('nameInput').value.trim();
    return v || `AGENT_${Math.floor(Math.random() * 90 + 10)}`;
  },

  _status(msg) {
    document.getElementById('lobbyStatus').textContent = msg;
  },

  renderPlayerCards(players, myId) {
    const wrap = document.getElementById('playerCards');
    wrap.innerHTML = '';
    if (players.size === 0) {
      wrap.innerHTML = '<div class="player-card"><span class="pname">No players yet</span></div>';
      return;
    }
    for (const [id, p] of players) {
      const el = document.createElement('div');
      el.className = 'player-card' + (id === myId ? ' self' : '');
      el.innerHTML = `<div class="avatar"></div><span class="pname">${this._esc(p.name)}</span>
        <span class="ptag">${id === myId ? 'YOU' : 'READY'}</span>`;
      wrap.appendChild(el);
    }
  },

  _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // ---------------- In-game chat ----------------
  initGameChat(net, onOpen) {
    const wrap = document.getElementById('chatInputWrap');
    const input = document.getElementById('chatInput');
    const log = document.getElementById('chatLog');
    let chatOpen = false;

    const appendEntry = (name, msg) => {
      const entry = document.createElement('div');
      entry.className = 'chat-entry';
      entry.innerHTML = `<span class="cn">${this._esc(name)}:</span>${this._esc(msg)}`;
      log.prepend(entry);
      while (log.children.length > 8) log.removeChild(log.lastChild);
      setTimeout(() => entry.remove(), 9000);
    };

    net.onChatMessage = (name, msg) => appendEntry(name, msg);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (!chatOpen) {
          chatOpen = true;
          wrap.classList.remove('hidden');
          input.value = '';
          input.focus();
          if (onOpen) onOpen();
          if (document.pointerLockElement) document.exitPointerLock();
        } else {
          const msg = input.value.trim();
          if (msg) net.sendChat(msg);
          chatOpen = false;
          wrap.classList.add('hidden');
          input.blur();
        }
      } else if (e.code === 'Escape' && chatOpen) {
        chatOpen = false;
        wrap.classList.add('hidden');
        input.blur();
      }
    });

    return { isChatOpen: () => chatOpen };
  },

  killFeedEntry(killer, victim) {
    const feed = document.getElementById('killFeed');
    const el = document.createElement('div');
    el.className = 'kf-entry';
    el.innerHTML = `<b>${this._esc(killer)}</b> eliminated <b>${this._esc(victim)}</b>`;
    feed.prepend(el);
    while (feed.children.length > 5) feed.removeChild(feed.lastChild);
    setTimeout(() => el.remove(), 5000);
  },
};
