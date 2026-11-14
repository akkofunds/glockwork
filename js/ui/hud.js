// In-match HUD: score/round clock with alive avatars, rotating radar + callout, kill feed with badges,
// HP/armour, ammo/cash, inventory, dynamic crosshair, hit markers, damage direction, banners,
// plant/defuse progress, speedometer, scope/flash/smoke overlays and the Tab scoreboard.
import { TEAM, WEAPONS, WEAPON_IDS, TEAM_SHORT } from '../config.js';
import { escapeHtml, fmtTime } from '../util.js';

const $ = (id) => document.getElementById(id);

const ICON = {
  hs: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 18h8M10 22h4" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="1.8" fill="currentColor"/></svg>',
  wb: '<svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="18" fill="currentColor" opacity=".5"/><path d="M2 12h20M17 8l5 4-5 4" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  sm: '<svg viewBox="0 0 24 24" class="ic"><circle cx="8" cy="13" r="5" fill="currentColor" opacity=".7"/><circle cx="15" cy="11" r="6" fill="currentColor" opacity=".55"/><circle cx="12" cy="16" r="5" fill="currentColor" opacity=".6"/></svg>',
  ns: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 5l14 14" stroke="currentColor" stroke-width="2"/></svg>',
  bs: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 20L18 6l2 2L6 22z" fill="currentColor"/><path d="M16 4l4 4" stroke="currentColor" stroke-width="2"/></svg>',
  bomb: '<svg viewBox="0 0 24 24" class="ic"><rect x="3" y="7" width="18" height="11" rx="1.5" fill="currentColor"/><rect x="6" y="9" width="7" height="4" fill="#111"/><circle cx="17" cy="11" r="1.4" fill="#f33"/></svg>',
  kit: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 18L14 8l2 2L6 20z" fill="currentColor"/><path d="M15 3l6 6-3 3-6-6z" fill="currentColor"/></svg>',
  armor: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="currentColor"/></svg>',
  helmet: '<svg viewBox="0 0 24 24" class="ic"><path d="M3 15a9 9 0 0118 0v2H3z" fill="currentColor"/><rect x="2" y="16" width="20" height="2.5" fill="currentColor"/></svg>',
  hp: '<svg viewBox="0 0 24 24" class="ic"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor"/></svg>',
};

const WEAPON_GLYPH = {
  knife: 'KNIFE', glock: 'GLOCK', usp: 'USP-S', p250: 'P250', deagle: 'DEAGLE', mac10: 'MAC-10', mp9: 'MP9', ak47: 'AK-47',
  m4a1s: 'M4A1-S', ssg08: 'SSG 08', awp: 'AWP', he: 'HE', flash: 'FLASH', smoke: 'SMOKE', c4: 'C4', world: 'WORLD',
};

export class HUD {
  constructor(settings) {
    this.settings = settings;
    this.el = $('hud');
    this.cache = {};
    this.killfeed = [];
    this.xhair = $('xhair');
    this.xctx = this.xhair.getContext('2d');
    this.lastXhair = '';
    this.radar = $('radar');
    this.rctx = this.radar.getContext('2d');
    this.radarImg = null;
    this.hitT = 0; this.hitKill = false;
    this.dmgIndicators = [];
    this.bannerT = 0;
    this.msgT = 0;
    this.flash = 0; this.flashHold = 0;
    this.bloodT = 0;
    this.moneyPopT = 0;
    this.scoreboardOpen = false;
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  set(id, html, key = id) {
    if (this.cache[key] === html) return;
    this.cache[key] = html;
    const e = $(id);
    if (e) e.innerHTML = html;
  }
  text(id, t) {
    if (this.cache[id] === t) return;
    this.cache[id] = t;
    const e = $(id);
    if (e) e.textContent = t;
  }
  cls(id, c, on) {
    const k = id + '|' + c;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    $(id)?.classList.toggle(c, on);
  }

  setRadarImage(r) { this.radarImg = r; }

  // ---------- crosshair ----------
  drawCrosshair(spread) {
    const c = this.settings.crosshair;
    const dyn = c.dynamic ? Math.min(28, spread * 300) : 0;
    const key = `${c.size}|${c.gap}|${c.thickness}|${c.color}|${c.outline}|${c.dot}|${c.alpha}|${Math.round(dyn)}`;
    if (key === this.lastXhair) return;
    this.lastXhair = key;
    const x = this.xctx, S = 128, m = S / 2;
    x.clearRect(0, 0, S, S);
    const len = c.size * 2, gap = c.gap * 1.5 + 2 + dyn, th = Math.max(1, c.thickness * 1.5);
    const rects = [[m - th / 2, m - gap - len, th, len], [m - th / 2, m + gap, th, len], [m - gap - len, m - th / 2, len, th], [m + gap, m - th / 2, len, th]];
    if (c.dot) rects.push([m - th / 2, m - th / 2, th, th]);
    x.globalAlpha = c.alpha;
    if (c.outline) { x.fillStyle = '#000'; for (const r of rects) x.fillRect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2); }
    x.fillStyle = c.color;
    for (const r of rects) x.fillRect(r[0], r[1], r[2], r[3]);
  }

  // ---------- radar ----------
  drawRadar(me, players, bomb, smokes, mapCfg, yaw) {
    const x = this.rctx, S = this.radar.width, m = S / 2;
    const R = this.radarImg;
    const range = 1500; // world units shown from centre to edge
    const k = m / range;
    x.save();
    x.clearRect(0, 0, S, S);
    x.beginPath(); x.arc(m, m, m - 1, 0, Math.PI * 2); x.clip();
    x.fillStyle = 'rgba(10,12,15,0.85)'; x.fillRect(0, 0, S, S);
    x.translate(m, m);
    x.rotate(yaw);
    if (R) {
      const scale = (R.ext * 2) / R.canvas.width;
      x.globalAlpha = 0.9;
      x.drawImage(R.canvas, (R.cx - R.ext - me.x) * k, (R.cz - R.ext - me.z) * k, R.canvas.width * scale * k, R.canvas.height * scale * k);
      x.globalAlpha = 1;
    }
    // bombsites
    x.font = `bold ${Math.round(16 * S / 200)}px Rajdhani, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const s of mapCfg.sites || []) {
      const px = (s.x - me.x) * k, pz = (s.z - me.z) * k;
      x.strokeStyle = 'rgba(255,80,60,0.6)'; x.lineWidth = 1.5;
      x.beginPath(); x.arc(px, pz, s.r * k, 0, Math.PI * 2); x.stroke();
      x.save(); x.translate(px, pz); x.rotate(-yaw); x.fillStyle = 'rgba(255,120,90,0.95)'; x.fillText(s.name, 0, 0); x.restore();
    }
    for (const s of smokes) {
      x.fillStyle = 'rgba(200,200,200,0.45)';
      x.beginPath(); x.arc((s.x - me.x) * k, (s.z - me.z) * k, 140 * k, 0, Math.PI * 2); x.fill();
    }
    // players
    for (const p of players) {
      const px = (p.x - me.x) * k, pz = (p.z - me.z) * k;
      if (!p.alive) {
        x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1.5;
        x.beginPath(); x.moveTo(px - 3, pz - 3); x.lineTo(px + 3, pz + 3); x.moveTo(px + 3, pz - 3); x.lineTo(px - 3, pz + 3); x.stroke();
        continue;
      }
      x.fillStyle = p.enemy ? '#ff4b4b' : (p.team === TEAM.T ? '#ffae3d' : '#5aa9ff');
      x.save(); x.translate(px, pz); x.rotate(-p.yaw);
      x.beginPath(); x.moveTo(0, -6); x.lineTo(4, 3); x.lineTo(-4, 3); x.closePath(); x.fill();
      x.restore();
      if (p.c4) { x.fillStyle = '#ff3b3b'; x.fillRect(px + 4, pz - 8, 5, 4); }
    }
    if (bomb && bomb.visible) {
      const px = (bomb.x - me.x) * k, pz = (bomb.z - me.z) * k;
      x.fillStyle = bomb.planted ? (Math.floor(performance.now() / 300) % 2 ? '#ff2b2b' : '#ffb0b0') : '#ff6b3b';
      x.fillRect(px - 5, pz - 3.5, 10, 7);
    }
    x.restore();
    // self arrow (always points up)
    x.fillStyle = '#ffffff';
    x.beginPath(); x.moveTo(m, m - 8); x.lineTo(m + 5, m + 5); x.lineTo(m, m + 2); x.lineTo(m - 5, m + 5); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.15)'; x.lineWidth = 2; x.beginPath(); x.arc(m, m, m - 2, 0, Math.PI * 2); x.stroke();
  }

  // ---------- top bar ----------
  updateTop(st) {
    this.text('score-ct', String(st.scoreCT));
    this.text('score-t', String(st.scoreT));
    this.set('round-timer', st.timerHtml);
    this.text('round-label', st.roundLabel);
    this.cls('timer-box', 'bomb', !!st.bombPlanted);
    this.cls('timer-box', 'freeze', !!st.freeze);
    const av = (list) => list.map((p) => `<i class="av ${p.alive ? '' : 'dead'} ${p.me ? 'me' : ''}" title="${escapeHtml(p.name)}">${escapeHtml(p.name.slice(0, 1).toUpperCase())}</i>`).join('');
    this.set('alive-ct', av(st.ct));
    this.set('alive-t', av(st.t));
  }

  updateVitals(ps, weaponName, mag, res, money, callout, buyable) {
    const hpCls = ps.hp <= 20 ? 'low' : '';
    this.set('hp-box', `<span class="v ${hpCls}">${ICON.hp}${ps.hp}</span><span class="v armor">${ps.helmet ? ICON.helmet : ICON.armor}${ps.armor}</span>${ps.defuser ? `<span class="v kit">${ICON.kit}</span>` : ''}`);
    this.set('ammo-box', mag === null ? `<div class="wname">${escapeHtml(weaponName)}</div>` : `<div class="ammo"><b class="${mag === 0 ? 'empty' : ''}">${mag}</b><span>/ ${res}</span></div><div class="wname">${escapeHtml(weaponName)}</div>`);
    this.set('money', `$${money}${buyable ? '<i class="buyz">BUY</i>' : ''}`);
    this.text('callout', callout || '');
  }

  updateInventory(ps) {
    const items = [];
    const slot = (n, id, extra = '') => items.push(`<div class="inv ${ps.active === id ? 'act' : ''}"><i>${n}</i>${WEAPON_GLYPH[id]}${extra}</div>`);
    if (ps.inv.primary) slot(1, ps.inv.primary.id);
    if (ps.inv.secondary) slot(2, ps.inv.secondary.id);
    slot(3, 'knife');
    for (const g of ['he', 'flash', 'smoke']) if (ps.inv[g] > 0) slot(4, g, ps.inv[g] > 1 ? ` ×${ps.inv[g]}` : '');
    if (ps.inv.c4) slot(5, 'c4');
    this.set('inv-list', items.join(''));
  }

  // ---------- killfeed ----------
  addKill(k) {
    const el = document.createElement('div');
    el.className = 'kf' + (k.mine ? ' mine' : '') + (k.meDied ? ' died' : '');
    const badge = [k.ns ? ICON.ns : '', k.sm ? ICON.sm : '', k.wb ? ICON.wb : '', k.hs ? ICON.hs : '', k.bs ? ICON.bs : ''].join('');
    const tc = (t) => (t === TEAM.T ? 't' : 'ct');
    el.innerHTML = (k.killer ? `<span class="${tc(k.kt)}">${escapeHtml(k.killer)}</span>${k.assist ? ` <span class="as">+ ${escapeHtml(k.assist)}</span>` : ''}` : '')
      + ` <span class="wpn">${WEAPON_GLYPH[k.w] || escapeHtml(k.w)}</span>${badge} <span class="${tc(k.vt)}">${escapeHtml(k.victim)}</span>`;
    const feed = $('killfeed');
    feed.appendChild(el);
    while (feed.children.length > 6) feed.removeChild(feed.firstChild);
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 600); }, k.mine || k.meDied ? 9000 : 6000);
  }
  clearKillfeed() { $('killfeed').innerHTML = ''; }

  hitmarker(kill, hs) {
    this.hitT = 0.22; this.hitKill = kill;
    const h = $('hitmarker');
    h.className = 'show' + (kill ? ' kill' : '') + (hs ? ' hs' : '');
  }

  damageFrom(angle) {
    const el = document.createElement('div');
    el.className = 'dmgind';
    el.style.transform = `translate(-50%,-50%) rotate(${angle}rad) translateY(-90px)`;
    $('dmg-indicators').appendChild(el);
    setTimeout(() => el.remove(), 1200);
    this.bloodT = 0.5;
  }

  banner(html, cls = '', dur = 3) {
    const b = $('banner');
    b.innerHTML = html; b.className = 'show ' + cls;
    this.bannerT = dur;
  }
  message(text, dur = 2.5, cls = '') {
    const m = $('center-msg');
    m.textContent = text; m.className = 'show ' + cls;
    this.msgT = dur;
  }
  moneyPop(amt, why) {
    const e = $('money-pop');
    e.innerHTML = `<b class="${amt >= 0 ? 'pos' : 'neg'}">${amt >= 0 ? '+' : '-'}$${Math.abs(amt)}</b> ${escapeHtml(why || '')}`;
    e.className = 'show';
    this.moneyPopT = 2.5;
  }

  progress(label, frac, cls = '') {
    const p = $('progress');
    if (frac === null) { this.cls('progress', 'show', false); return; }
    this.cls('progress', 'show', true);
    this.text('progress-label', label);
    const bar = $('progress-bar');
    bar.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%';
    p.dataset.kind = cls;
  }

  setFlash(amount, duration) {
    this.flash = Math.max(this.flash, amount);
    this.flashHold = Math.max(this.flashHold, duration * 0.35);
    this.flashDur = duration;
  }

  frame(dt, opts) {
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) $('hitmarker').className = ''; }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) $('banner').className = ''; }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) $('center-msg').className = ''; }
    if (this.moneyPopT > 0) { this.moneyPopT -= dt; if (this.moneyPopT <= 0) $('money-pop').className = ''; }
    // flash overlay
    if (this.flashHold > 0) this.flashHold -= dt;
    else if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / Math.max(0.5, (this.flashDur || 2) * 0.65));
    const fo = $('flash-overlay');
    const fa = Math.min(1, this.flash).toFixed(3);
    if (this.cache.flash !== fa) { this.cache.flash = fa; fo.style.opacity = fa; }
    const so = (opts.smoke || 0).toFixed(2);
    if (this.cache.smoke !== so) { this.cache.smoke = so; $('smoke-overlay').style.opacity = so; }
    if (this.bloodT > 0) this.bloodT -= dt;
    const bo = Math.max(0, this.bloodT * 1.2 + (opts.lowHp ? 0.25 : 0)).toFixed(2);
    if (this.cache.blood !== bo) { this.cache.blood = bo; $('blood-overlay').style.opacity = bo; }
    this.cls('scope-overlay', 'show', !!opts.scoped);
    this.cls('crosshair', 'hidden', !!opts.hideCrosshair);
    if (this.settings.speedometer) this.text('speedo', opts.speed !== undefined ? `${Math.round(opts.speed)} u/s` : '');
    else this.text('speedo', '');
  }

  // ---------- scoreboard ----------
  showScoreboard(v) { this.scoreboardOpen = v; $('scoreboard').classList.toggle('hidden', !v); }
  renderScoreboard(data) {
    if (!this.scoreboardOpen) return;
    const row = (p) => `<tr class="${p.me ? 'me' : ''} ${p.alive ? '' : 'dead'}"><td class="nm">${escapeHtml(p.name)}${p.c4 ? ' ' + ICON.bomb : ''}${p.kit ? ' ' + ICON.kit : ''}</td><td>${p.money >= 0 ? '$' + p.money : ''}</td><td>${p.k}</td><td>${p.d}</td><td>${p.a}</td><td>${p.hsp}%</td><td>${p.adr}</td><td>${p.mvp ? '★' + p.mvp : ''}</td><td>${p.score}</td><td>${p.ping}</td></tr>`;
    const table = (team, list, score) => `<div class="sb-team ${team === TEAM.T ? 't' : 'ct'}"><div class="sb-head"><b>${score}</b><span>${team === TEAM.T ? 'TERRORISTS' : 'COUNTER-TERRORISTS'}</span></div>
      <table><thead><tr><th class="nm">Player</th><th>Money</th><th>K</th><th>D</th><th>A</th><th>HS</th><th>ADR</th><th>MVP</th><th>Score</th><th>Ping</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`;
    this.set('scoreboard', `<div class="sb-title">${escapeHtml(data.title)}</div>${table(TEAM.CT, data.ct, data.scoreCT)}${table(TEAM.T, data.t, data.scoreT)}`);
  }
}

export { WEAPON_GLYPH, ICON, TEAM_SHORT, WEAPON_IDS, WEAPONS, fmtTime };
