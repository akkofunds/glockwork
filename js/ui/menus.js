// Main menu (party / queue / private match / practice), in-game ESC menu, settings, crosshair editor,
// Model & Map Manager (file picker, drag-and-drop, repo path, alignment tuner, live preview, map markers).
import * as THREE from 'three';
import { SLOTS, SLOT_LABEL, DEFAULT_TUNE } from '../assets.js';
import { TEAM } from '../config.js';
import { escapeHtml } from '../util.js';
import { saveSettings } from '../settings.js';
import { PRESETS } from '../render/renderer.js';
import { BINDS } from '../input.js';
import { saveOverrides } from '../world/mapmanager.js';

const $ = (id) => document.getElementById(id);
const h = (s) => escapeHtml(s);

export class Menus {
  constructor(app) {
    this.app = app;
    this.el = $('menu');
    this.esc = $('esc-menu');
    this.tab = 'settings';
    this.partyInfo = null;
    this.queueInfo = null;
    this.mode = '5v5';
    this.preview = null;
    this.tuneSlot = 'ak47';
    this.inGame = false;
    this._bindMatchmaker();
  }

  _bindMatchmaker() {
    const mm = this.app.mm;
    mm.on('party', (p) => { this.partyInfo = p; this.renderMain(); this.renderLobbyOverlay(); });
    mm.on('queue', (q) => { this.queueInfo = q; this.renderMain(); });
    mm.on('error', (e) => this.toast(e, 'warn'));
    mm.on('chat', (m) => this.toast(`${m.from || 'Party'}: ${m.text}`));
  }

  toast(text, cls = '') {
    const t = $('toast');
    const d = document.createElement('div');
    d.className = 'toast ' + cls; d.textContent = text;
    t.appendChild(d);
    setTimeout(() => { d.classList.add('fade'); setTimeout(() => d.remove(), 500); }, 3500);
  }

  showMain(reason) {
    this.inGame = false;
    this.el.classList.remove('hidden');
    this.esc.classList.add('hidden');
    this.renderMain();
    if (reason) this.toast(reason, 'warn');
  }
  hideMain() { this.el.classList.add('hidden'); this.closePreview(); }

  renderMain() {
    if (this.el.classList.contains('hidden')) return;
    const app = this.app, mm = app.mm, p = this.partyInfo, q = this.queueInfo;
    const leader = !p || p.leader;
    const members = p ? p.members : [];
    const invite = p ? `${location.origin}${location.pathname}?party=${p.code}` : '';
    const modes = [['1v1', 'Duel', '1 vs 1'], ['2v2', 'Wingman', '2 vs 2'], ['5v5', 'Competitive', '5 vs 5']];
    const myTeam = members.find((m) => m.id === mm.myId)?.team;
    const teamList = (t) => members.filter((m) => m.team === t).map((m) => `<li>${h(m.name)}${m.leader ? ' <i class="crown">★</i>' : ''}${m.id === mm.myId ? ' <i>(you)</i>' : ''}${p.leader && m.id !== mm.myId ? ` <button class="mini" data-act="swapteam" data-id="${h(m.id)}" data-team="${t === TEAM.CT ? TEAM.T : TEAM.CT}">⇄</button>` : ''}</li>`).join('') || '<li class="empty">—</li>';
    this.el.innerHTML = `
    <div class="mm-wrap">
      <header class="mm-head">
        <div class="logo"><span class="spark"></span>FLASH<b>POINT</b></div>
        <div class="tag">Tactical bomb defusal · peer-to-peer · 100% PvP, no bots</div>
      </header>
      <div class="mm-grid">
        <section class="card play">
          <h2>Play</h2>
          <label class="fld">Callsign <input id="mm-name" maxlength="20" value="${h(app.settings.name)}"></label>
          <div class="modes">${modes.map(([id, n, s]) => `<button class="mode ${this.mode === id ? 'act' : ''}" data-act="mode" data-mode="${id}" ${p && members.length > (+id[0]) ? 'disabled' : ''}><b>${n}</b><span>${s}</span></button>`).join('')}</div>
          ${q ? `<div class="queue"><div class="spinner"></div><div><b>Searching ${h(q.mode)}…</b><span>${q.found}/${q.needed} players found</span><small>${h(q.status || '')}</small></div><button class="ghost" data-act="cancelq">Cancel</button></div>`
    : `<button class="primary big" data-act="queue" ${!leader ? 'disabled' : ''}>${!leader ? 'Leader starts the queue' : 'FIND MATCH'}</button>`}
          <p class="hint">Parties always queue onto the same team. Matches launch automatically when enough players are found.</p>
          <button class="ghost wide" data-act="practice">Practice range (solo · free roam · no bots)</button>
        </section>
        <section class="card party">
          <h2>Party</h2>
          ${p ? `
            <div class="code">Code <b>${h(p.code)}</b> <button class="mini" data-act="copy">Copy invite link</button></div>
            <input class="invite" readonly value="${h(invite)}">
            <div class="teams">
              <div class="tcol ct"><h3>Counter-Terrorists</h3><ul>${teamList(TEAM.CT)}</ul>${!p.leader && myTeam !== TEAM.CT ? '<button class="mini" data-act="myteam" data-team="1">Join CT</button>' : ''}</div>
              <div class="tcol t"><h3>Terrorists</h3><ul>${teamList(TEAM.T)}</ul>${!p.leader && myTeam !== TEAM.T ? '<button class="mini" data-act="myteam" data-team="2">Join T</button>' : ''}</div>
            </div>
            <p class="hint">Team picks apply to <b>Private Match</b>. Public queues keep the whole party together.</p>
            ${p.leader ? `<button class="primary" data-act="private" ${members.length < 2 ? 'disabled' : ''}>Start private match (${members.length} players)</button>` : '<p class="hint">Waiting for the leader…</p>'}
            <div class="row"><input id="mm-chat" placeholder="Party chat…" maxlength="120"><button class="mini" data-act="pchat">Send</button></div>
            <button class="ghost" data-act="leave">Leave party</button>
          ` : `
            <p>Queue with friends or play a private 1v1–5v5 match.</p>
            <button class="primary" data-act="create">Create party</button>
            <div class="row"><input id="mm-code" maxlength="5" placeholder="CODE" autocomplete="off"><button data-act="join">Join</button></div>
          `}
        </section>
        <section class="card misc">
          <h2>Setup</h2>
          <button class="wide" data-act="settings">Settings &amp; crosshair</button>
          <button class="wide" data-act="models">Model &amp; Map Manager</button>
          <button class="wide" data-act="controls">Controls</button>
          <div class="net ${mm.peer ? 'ok' : ''}">${mm.peer ? 'Online · ' + h(mm.myId.slice(-6)) : 'Offline (connects when you play)'}</div>
          <p class="hint small">Graphics: ${PRESETS[app.settings.quality].label}. Free signalling via PeerJS cloud; matches run peer-to-peer with an elected host.</p>
        </section>
      </div>
      <footer class="mm-foot">WASD move · Mouse aim · Space/Wheel jump · Shift walk · Ctrl crouch · B buy · E use/defuse · G drop · F inspect · Tab scores</footer>
    </div>`;
    this._wireMain();
  }

  _wireMain() {
    const app = this.app, mm = app.mm;
    const name = $('mm-name');
    name.addEventListener('change', () => { app.settings.name = name.value.trim().slice(0, 20) || app.settings.name; mm.name = app.settings.name; saveSettings(app.settings); });
    const code = $('mm-code');
    if (code) code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._act('join'); });
    const chat = $('mm-chat');
    if (chat) chat.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._act('pchat'); });
    this.el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this._act(b.dataset.act, b.dataset)));
  }

  async _act(act, data = {}) {
    const app = this.app, mm = app.mm;
    app.audio.init();
    app.audio.play('ui');
    mm.name = app.settings.name;
    try {
      switch (act) {
        case 'mode': this.mode = data.mode; this.renderMain(); break;
        case 'queue': await mm.joinQueue(this.mode); break;
        case 'cancelq': mm.leaveQueue(); break;
        case 'practice': app.startPractice(); break;
        case 'create': await mm.createParty(); break;
        case 'join': { const c = $('mm-code').value; this.toast('Joining party ' + c.toUpperCase() + '…'); await mm.joinParty(c); break; }
        case 'leave': mm.leaveParty(); break;
        case 'copy': {
          const url = `${location.origin}${location.pathname}?party=${this.partyInfo.code}`;
          try { await navigator.clipboard.writeText(url); this.toast('Invite link copied'); } catch { const i = this.el.querySelector('.invite'); i.select(); document.execCommand('copy'); this.toast('Invite link copied'); }
          break;
        }
        case 'swapteam': mm.setMemberTeam(data.id, +data.team); break;
        case 'myteam': mm.setMemberTeam(mm.myId, +data.team); break;
        case 'private': {
          const members = this.partyInfo.members;
          if (!members.some((m) => m.team === TEAM.CT) || !members.some((m) => m.team === TEAM.T)) { this.toast('Both teams need at least one player', 'warn'); break; }
          const desc = await app.hostMapDesc();
          mm.startPrivateMatch(desc);
          break;
        }
        case 'pchat': { const i = $('mm-chat'); if (i.value.trim()) { mm.partyChat(i.value.trim()); i.value = ''; } break; }
        case 'settings': this.openPanel('settings'); break;
        case 'models': this.openPanel('models'); break;
        case 'controls': this.openPanel('controls'); break;
      }
    } catch (e) {
      console.error(e);
      this.toast(e.type === 'peer-unavailable' ? 'Party not found' : (e.message || String(e)), 'warn');
    }
  }

  renderLobbyOverlay() { /* party state is shown on the main menu */ }

  // ---------------- ESC / panels ----------------
  openEsc() {
    this.inGame = true;
    this.esc.classList.remove('hidden');
    this.renderEsc();
  }
  closeEsc() { this.esc.classList.add('hidden'); this.closePreview(); this.app.markers(false); }
  get escOpen() { return !this.esc.classList.contains('hidden'); }

  openPanel(tab) {
    this.tab = tab;
    this.esc.classList.remove('hidden');
    this.renderEsc();
  }

  renderEsc() {
    const app = this.app;
    const tabs = [['settings', 'Settings'], ['crosshair', 'Crosshair'], ['models', 'Models & Map'], ['controls', 'Controls']];
    const inGame = !!app.client;
    const canTeam = app.client && (app.client.mode === 'practice' || app.client.mode === 'private');
    this.esc.innerHTML = `<div class="esc-wrap">
      <div class="esc-side">
        <div class="logo sm">FLASH<b>POINT</b></div>
        ${inGame ? '<button class="primary" data-esc="resume">Resume</button>' : '<button class="primary" data-esc="close">Back</button>'}
        ${tabs.map(([id, n]) => `<button class="${this.tab === id ? 'act' : ''}" data-tab="${id}">${n}</button>`).join('')}
        ${canTeam ? '<button data-esc="team">Switch team</button>' : ''}
        ${inGame ? '<button class="danger" data-esc="leave">Leave match</button>' : ''}
      </div>
      <div class="esc-body" id="esc-body"></div>
    </div>`;
    this.esc.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.closePreview(); this.renderEsc(); }));
    this.esc.querySelectorAll('[data-esc]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.esc;
      if (a === 'resume') app.resume();
      else if (a === 'close') this.closeEsc();
      else if (a === 'leave') app.leaveMatch(null);
      else if (a === 'team') { app.client.switchTeam(app.client.ps.team === TEAM.CT ? TEAM.T : TEAM.CT); app.resume(); }
    }));
    const body = $('esc-body');
    if (this.tab === 'settings') this._settings(body);
    else if (this.tab === 'crosshair') this._crosshair(body);
    else if (this.tab === 'models') this._models(body);
    else this._controls(body);
  }

  _slider(label, key, min, max, step, val, fmt = (v) => v) {
    return `<label class="sl"><span>${label}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${fmt(val)}</output></label>`;
  }

  _settings(body) {
    const s = this.app.settings;
    body.innerHTML = `<h2>Settings</h2>
      <label class="fld">Graphics preset <select data-k="quality">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${s.quality === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
      <p class="hint small">Competitive Low: 1.0 pixel ratio, no shadows, Lambert shading (iPhone 7 / Chromebook). Changing preset reloads the renderer.</p>
      ${this._slider('Mouse sensitivity', 'sensitivity', 0.1, 6, 0.05, s.sensitivity)}
      ${this._slider('Zoom sensitivity ratio', 'zoomSensitivity', 0.3, 2, 0.05, s.zoomSensitivity)}
      ${this._slider('Touch sensitivity', 'touchSensitivity', 0.3, 3, 0.05, s.touchSensitivity)}
      ${this._slider('Field of view (4:3 horiz.)', 'fov', 75, 110, 1, s.fov)}
      ${this._slider('Viewmodel FOV', 'vmFov', 54, 80, 1, s.vmFov)}
      ${this._slider('Master volume', 'volume', 0, 1, 0.01, s.volume, (v) => Math.round(v * 100) + '%')}
      <label class="chk"><input type="checkbox" data-k="invertY" ${s.invertY ? 'checked' : ''}> Invert mouse Y</label>
      <label class="chk"><input type="checkbox" data-k="speedometer" ${s.speedometer ? 'checked' : ''}> Velocity speedometer (u/s)</label>
      <label class="chk"><input type="checkbox" data-k="showFps" ${s.showFps ? 'checked' : ''}> Show FPS / draw calls</label>
      <details><summary>Advanced networking</summary>
        <label class="fld">Signalling server (host:port, blank = PeerJS cloud) <input data-k="signal" value="${h(localStorage.getItem('fp_signal') || '')}"></label>
      </details>`;
    body.querySelectorAll('[data-k]').forEach((inp) => {
      const k = inp.dataset.k;
      const upd = () => {
        let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
        if (inp.nextElementSibling && inp.nextElementSibling.tagName === 'OUTPUT') inp.nextElementSibling.textContent = k === 'volume' ? Math.round(v * 100) + '%' : v;
        if (k === 'signal') { try { if (v) localStorage.setItem('fp_signal', v); else localStorage.removeItem('fp_signal'); } catch { /* ignore */ } return; }
        if (k === 'quality') { s.quality = v; saveSettings(s); this.app.changeQuality(v); return; }
        s[k] = v;
        saveSettings(s);
        this.app.applySettings();
      };
      inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'checkbox' || k === 'signal' ? 'change' : 'input', upd);
    });
  }

  _crosshair(body) {
    const c = this.app.settings.crosshair;
    body.innerHTML = `<h2>Crosshair</h2>
      <div class="xh-prev"><canvas id="xh-prev" width="160" height="160"></canvas></div>
      ${this._slider('Length', 'size', 0, 15, 0.5, c.size)}
      ${this._slider('Gap', 'gap', -2, 10, 0.5, c.gap)}
      ${this._slider('Thickness', 'thickness', 0.5, 5, 0.5, c.thickness)}
      ${this._slider('Opacity', 'alpha', 0.2, 1, 0.05, c.alpha)}
      <label class="fld">Colour <input type="color" data-k="color" value="${c.color}"></label>
      <div class="swatches">${['#4cff6a', '#00ffff', '#ffff00', '#ff3b3b', '#ffffff', '#ff7bff'].map((col) => `<i data-col="${col}" style="background:${col}"></i>`).join('')}</div>
      <label class="chk"><input type="checkbox" data-k="outline" ${c.outline ? 'checked' : ''}> Outline</label>
      <label class="chk"><input type="checkbox" data-k="dot" ${c.dot ? 'checked' : ''}> Centre dot</label>
      <label class="chk"><input type="checkbox" data-k="dynamic" ${c.dynamic ? 'checked' : ''}> Dynamic (spreads with movement & firing)</label>`;
    const draw = () => {
      const cv = $('xh-prev'); const x = cv.getContext('2d');
      x.fillStyle = '#6b6152'; x.fillRect(0, 0, 160, 160);
      this.app.hud.lastXhair = '';
      this.app.hud.drawCrosshair(0);
      x.drawImage(this.app.hud.xhair, 16, 16);
    };
    draw();
    const s = this.app.settings;
    body.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
      const k = inp.dataset.k;
      c[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
      if (inp.nextElementSibling?.tagName === 'OUTPUT') inp.nextElementSibling.textContent = c[k];
      saveSettings(s); draw();
    }));
    body.querySelectorAll('[data-col]').forEach((e) => e.addEventListener('click', () => { c.color = e.dataset.col; saveSettings(s); body.querySelector('[data-k=color]').value = c.color; draw(); }));
  }

  _controls(body) {
    const rows = {};
    for (const [code, a] of Object.entries(BINDS)) (rows[a] ||= []).push(code.replace(/^Key|^Digit/, '').replace('Left', ' L').replace('Right', ' R'));
    const names = { fwd: 'Forward', back: 'Back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump (also mouse wheel)', walk: 'Walk (silent)', duck: 'Crouch', reload: 'Reload', use: 'Use / defuse / pick up', drop: 'Drop weapon / bomb', inspect: 'Inspect weapon', buy: 'Buy menu', scores: 'Scoreboard', lastweapon: 'Last weapon', slot1: 'Primary', slot2: 'Pistol', slot3: 'Knife', slot4: 'Grenades (cycle)', slot5: 'C4', menu: 'Menu', chat: 'Chat (all)', teamchat: 'Chat (team)' };
    body.innerHTML = `<h2>Controls</h2><table class="keys">${Object.entries(rows).map(([a, ks]) => `<tr><td>${names[a] || a}</td><td>${ks.map((k) => `<kbd>${h(k)}</kbd>`).join(' ')}</td></tr>`).join('')}
      <tr><td>Fire / Alt-fire (scope, Glock burst, knife stab)</td><td><kbd>Mouse 1</kbd> <kbd>Mouse 2</kbd></td></tr></table>
      <p class="hint">Touch devices get dual-thumb controls automatically: left side moves, right side looks, the FIRE button also aims while you drag it.</p>`;
  }

  _models(body) {
    const app = this.app, assets = app.assets;
    const slot = this.tuneSlot;
    const t = assets.tune(slot);
    const cfg = (s) => assets.slotConfig(s);
    const srcName = (s) => { const c = cfg(s); return c.source === 'file' ? `File: ${c.name}` : c.source === 'url' ? `Path: ${c.name}` : (s === 'map' ? 'Built-in Dunewatch' : s === 'soldier' ? 'Built-in operator' : 'Bundled model'); };
    const mapCfg = app.map?.config;
    body.innerHTML = `<h2>Model &amp; Map Manager</h2>
      <p class="hint">Assign any <b>.glb</b> (Draco supported) by file picker, drag-and-drop, or a path in your repo (e.g. <code>assets/models/my_map.glb</code>). Files are stored locally in your browser. Other weapons use built-in models.</p>
      <div class="slots">${SLOTS.map((s) => `<div class="slot ${s === slot ? 'act' : ''}" data-slot="${s}">
        <div class="sn"><b>${SLOT_LABEL[s]}</b><span>${h(srcName(s))}</span></div>
        <div class="sb"><label class="btn mini">Choose .glb<input type="file" accept=".glb,model/gltf-binary" data-file="${s}" hidden></label>
        <button class="mini" data-url="${s}">Path…</button><button class="mini" data-reset="${s}">Reset</button><button class="mini" data-tune="${s}">Tune</button></div></div>`).join('')}
      </div>
      <div class="drop" id="dropzone">Drop a .glb here to assign it to <b>${SLOT_LABEL[slot]}</b></div>
      <details class="tuner" open><summary>Model Alignment Tuner — ${SLOT_LABEL[slot]}</summary>
        ${slot === 'map' ? `
          ${this._slider('Map scale (0 = auto)', 'mscale', 0, 80, 0.5, mapCfg?.scale && app.map?.desc?.kind === 'glb' ? mapCfg.scale : 0)}
          <p class="hint small">Spawn & bombsite editing works in Practice on the loaded map. Stand where you want a point and press a button.</p>
          <div class="btnrow">
            <button class="mini" data-mp="t">Set T spawn here</button><button class="mini" data-mp="ct">Set CT spawn here</button>
            <button class="mini" data-mp="a">Set site A here</button><button class="mini" data-mp="b">Set site B here</button>
          </div>
          ${this._slider('Bombsite radius', 'srad', 150, 700, 10, mapCfg?.sites?.[0]?.r || 350)}
          ${this._slider('Buy zone radius', 'brad', 200, 1500, 10, mapCfg?.buyRadius || 700)}
          <label class="chk"><input type="checkbox" id="mk-show" ${app.markersOn ? 'checked' : ''}> Show spawn / site markers</label>
          <button class="primary" data-mp="save">Save map config &amp; restart practice</button>
        ` : `
          <div class="pv"><canvas id="pv-canvas" width="360" height="240"></canvas></div>
          ${this._slider('X', 'x', -20, 20, 0.1, t.x)}${this._slider('Y', 'y', -20, 20, 0.1, t.y)}${this._slider('Z', 'z', -20, 20, 0.1, t.z)}
          ${this._slider('Pitch', 'pitch', -180, 180, 1, t.pitch)}${this._slider('Yaw', 'yaw', -180, 180, 1, t.yaw)}${this._slider('Roll', 'roll', -180, 180, 1, t.roll)}
          ${this._slider('Scale', 'scale', 0.2, 3, 0.01, t.scale)}
          ${slot === 'soldier' ? `<label class="chk"><input type="checkbox" id="face-flip" ${cfg('soldier').faceFlip !== false ? 'checked' : ''}> Model faces +Z (glTF default) — untick if your soldier walks backwards</label>` : ''}
          <button class="mini" data-tunereset="1">Reset alignment</button>
        `}
      </details>`;
    body.querySelectorAll('[data-slot]').forEach((e) => e.addEventListener('click', (ev) => { if (ev.target.closest('button,label')) return; this.tuneSlot = e.dataset.slot; this.closePreview(); this._models(body); }));
    body.querySelectorAll('[data-tune]').forEach((b) => b.addEventListener('click', () => { this.tuneSlot = b.dataset.tune; this.closePreview(); this._models(body); }));
    body.querySelectorAll('[data-file]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      await this._assign(inp.dataset.file, () => assets.setFile(inp.dataset.file, f), body);
    }));
    body.querySelectorAll('[data-url]').forEach((b) => b.addEventListener('click', async () => {
      const url = prompt('Path or URL to a .glb (relative to the site root, e.g. assets/models/soldier.glb):', '');
      if (url) await this._assign(b.dataset.url, () => assets.setUrl(b.dataset.url, url.trim()), body);
    }));
    body.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => { await this._assign(b.dataset.reset, () => assets.reset(b.dataset.reset), body); }));
    const dz = $('dropzone');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', async (e) => {
      e.preventDefault(); dz.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) await this._assign(this.tuneSlot, () => assets.setFile(this.tuneSlot, f), body);
    });
    if (slot === 'map') {
      body.querySelectorAll('[data-mp]').forEach((b) => b.addEventListener('click', () => this._mapEdit(b.dataset.mp, body)));
      body.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => {
        inp.nextElementSibling.textContent = inp.value;
        const c = app.map?.config; if (!c) return;
        if (inp.dataset.k === 'srad') for (const s of c.sites) s.r = +inp.value;
        if (inp.dataset.k === 'brad') c.buyRadius = +inp.value;
        if (inp.dataset.k === 'mscale') this._pendingScale = +inp.value;
        app.markers(app.markersOn);
      }));
      $('mk-show').addEventListener('change', (e) => app.markers(e.target.checked));
    } else {
      body.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => {
        inp.nextElementSibling.textContent = inp.value;
        assets.setTune(slot, { [inp.dataset.k]: +inp.value });
      }));
      body.querySelector('[data-tunereset]').addEventListener('click', () => { assets.resetTune(slot); this.closePreview(); this._models(body); });
      const ff = $('face-flip');
      if (ff) ff.addEventListener('change', async () => { assets.config.soldier = { ...assets.slotConfig('soldier'), faceFlip: ff.checked }; localStorage.setItem('fp_assets', JSON.stringify(assets.config)); assets.cache.delete('soldier'); await app.reloadModels('soldier'); this.preview?.rebuild(); });
      this._openPreview();
    }
  }

  async _assign(slot, fn, body) {
    try {
      this.toast('Loading ' + SLOT_LABEL[slot] + '…');
      await fn();
      await this.app.reloadModels(slot);
      this.toast(SLOT_LABEL[slot] + ' updated');
      if (slot === 'map') this.toast('Map applies to your next practice session or hosted match');
    } catch (e) {
      console.error(e);
      this.toast('Could not load model: ' + (e.message || e), 'warn');
    }
    this.closePreview();
    this.tuneSlot = slot;
    this._models(body);
  }

  _mapEdit(what, body) {
    const app = this.app, c = app.map?.config, ps = app.client?.ps;
    if (!c) return;
    if (what === 'save') {
      const over = { spawnCenter: c.spawnCenter, sites: c.sites, buyRadius: c.buyRadius };
      if (this._pendingScale !== undefined) over.scale = this._pendingScale || undefined;
      if (app.map.desc.kind === 'glb') { saveOverrides(app.map.hash || app.map.desc.hash, over); this.toast('Map config saved'); }
      else this.toast('Built-in map uses fixed spawns; config applies to custom maps', 'warn');
      app.map = null;
      if (app.client?.mode === 'practice') app.startPractice();
      return;
    }
    if (!ps || app.client.mode !== 'practice') { this.toast('Start Practice to place points', 'warn'); return; }
    const p = { x: Math.round(ps.pos.x), y: Math.round(ps.pos.y), z: Math.round(ps.pos.z) };
    if (what === 't') c.spawnCenter[TEAM.T] = { ...p, yaw: app.client.yaw };
    if (what === 'ct') c.spawnCenter[TEAM.CT] = { ...p, yaw: app.client.yaw };
    if (what === 'a') c.sites[0] = { ...c.sites[0], ...p };
    if (what === 'b') c.sites[1] = { ...c.sites[1], ...p };
    delete c.spawns;
    app.refreshSpawns();
    app.markers(true);
    this.toast('Point set — save to keep it');
  }

  // ---------- live model preview ----------
  _openPreview() {
    this.closePreview();
    const cv = $('pv-canvas');
    if (!cv) return;
    const app = this.app;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 2.2));
    const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(2, 3, 4); scene.add(d);
    const cam = new THREE.PerspectiveCamera(35, cv.width / cv.height, 0.5, 2000);
    const holder = new THREE.Group(); scene.add(holder);
    const helpers = new THREE.Group(); scene.add(helpers);
    const pv = { r, scene, cam, holder, char: null, raf: 0 };
    const weaponFor = { ak47: 'ak47', awp: 'awp', glock17: 'glock', knife: 'knife', soldier: 'ak47' };
    const slot = this.tuneSlot;
    pv.rebuild = () => {
      holder.clear(); helpers.clear(); pv.char = null;
      if (slot === 'soldier') {
        pv.char = app.charFactory.make(TEAM.CT);
        pv.char.setWeapon('ak47', app.weaponLib.get('ak47'));
        holder.add(pv.char.root);
        cam.position.set(60, 52, -95); cam.lookAt(0, 38, 0);
        helpers.add(new THREE.GridHelper(120, 12, 0x555555, 0x333333));
      } else {
        const w = app.weaponLib.get(weaponFor[slot]);
        holder.add(w);
        const box = new THREE.Box3().setFromObject(w);
        const size = box.getSize(new THREE.Vector3()).length() || 10;
        const ctr = box.getCenter(new THREE.Vector3());
        cam.position.set(ctr.x + size * 1.15, ctr.y + size * 0.25, ctr.z + size * 0.15); cam.lookAt(ctr);
        helpers.add(new THREE.AxesHelper(6));
      }
    };
    pv.rebuild();
    let t = 0, last = performance.now();
    const loop = () => {
      if (this.preview !== pv) return;
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
      if (pv.char) pv.char.update(dt, { x: 0, y: 0, z: 0, yaw: Math.sin(t * 0.4) * 0.6, pitch: Math.sin(t * 0.9) * 0.3, duck: (Math.sin(t * 0.5) + 1) * 0.15, vx: Math.sin(t * 0.4) * 120, vz: -120, onGround: true, alive: true });
      else holder.rotation.y = Math.sin(t * 0.6) * 0.5;
      r.render(scene, cam);
      pv.raf = requestAnimationFrame(loop);
    };
    this.preview = pv;
    loop();
    pv.unsub = app.assets.onChange(() => { setTimeout(() => { if (this.preview === pv) pv.rebuild(); }, 60); });
  }
  closePreview() {
    const pv = this.preview;
    if (!pv) return;
    this.preview = null;
    cancelAnimationFrame(pv.raf);
    pv.unsub && pv.unsub();
    pv.r.dispose();
  }
}

export { DEFAULT_TUNE };
