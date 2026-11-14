// Buy menu (B): category grid with prices, number-key quick buy, right-click refund (same buy phase).
import { BUY_MENU, WEAPONS, GEAR, TEAM } from '../config.js';
import { escapeHtml } from '../util.js';

const STAT = (d) => d.damage ? `${d.damage} dmg · ${Math.round(d.armorPen * 100)}% pen · ${d.rpm} rpm · ${d.speed} u/s` : (d.cls === 'grenade' ? 'Utility' : '');

export class BuyMenu {
  constructor(onBuy, onRefund) {
    this.el = document.getElementById('buymenu');
    this.onBuy = onBuy; this.onRefund = onRefund;
    this.open = false;
    this.cat = 0;
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('mousedown', (e) => {
      const it = e.target.closest('[data-item]');
      const cat = e.target.closest('[data-cat]');
      if (cat) { this.cat = +cat.dataset.cat; this.pickCat = false; this.render(); return; }
      if (e.target.closest('.bm-close')) { this.toggle(false); return; }
      if (!it) return;
      if (e.button === 2) this.onRefund(it.dataset.item);
      else this.onBuy(it.dataset.item);
    });
    this.el.addEventListener('touchstart', (e) => {
      const it = e.target.closest('[data-item]');
      const cat = e.target.closest('[data-cat]');
      if (cat) { e.preventDefault(); this.cat = +cat.dataset.cat; this.render(); return; }
      if (e.target.closest('.bm-close')) { e.preventDefault(); this.toggle(false); return; }
      if (!it) return;
      e.preventDefault();
      const t0 = performance.now();
      const end = () => { it.removeEventListener('touchend', end); if (performance.now() - t0 > 450) this.onRefund(it.dataset.item); else this.onBuy(it.dataset.item); };
      it.addEventListener('touchend', end);
    }, { passive: false });
  }

  toggle(v) {
    this.open = v === undefined ? !this.open : v;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) { this.pickCat = true; this.lastKey = null; this.render(); }
  }

  key(n) {
    if (!this.open) return false;
    if (n === 0) { this.toggle(false); return true; }
    const cats = BUY_MENU;
    if (this.pickCat) {
      if (n >= 1 && n <= cats.length) { this.cat = n - 1; this.pickCat = false; this.render(); }
      return true;
    }
    const items = cats[this.cat].items;
    if (n >= 1 && n <= items.length) this.onBuy(items[n - 1]);
    return true;
  }

  update(ctx) {
    this.ctx = ctx;
    if (this.open) this.render();
  }

  render() {
    const c = this.ctx;
    if (!c) return;
    const key = JSON.stringify([this.pickCat, this.cat, c.money, c.team, c.canBuy, c.time, c.owned, c.refundable, c.reason]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const cats = BUY_MENU.map((cat, i) => `<div class="bm-cat ${i === this.cat ? 'act' : ''} ${this.pickCat ? 'pick' : ''}" data-cat="${i}"><i>${i + 1}</i>${cat.cat}</div>`).join('');
    const items = BUY_MENU[this.cat].items.map((id, i) => {
      const d = WEAPONS[id] || GEAR[id];
      let price = d.price;
      if (id === 'vesthelm' && c.armor >= 100 && !c.helmet) price = GEAR.vesthelm.upgrade;
      const teamOk = !d.team || d.team === c.team;
      if (!teamOk) return '';
      const owned = c.owned.includes(id);
      const afford = c.money >= price;
      const refund = c.refundable.includes(id);
      const dis = !c.canBuy || !afford || owned;
      return `<div class="bm-item ${dis ? 'dis' : ''} ${owned ? 'owned' : ''} ${refund ? 'refund' : ''}" data-item="${id}">
        <div class="bm-k">${i + 1}</div><div class="bm-n">${escapeHtml(d.name)}</div><div class="bm-p ${afford ? '' : 'no'}">$${price}</div>
        <div class="bm-s">${WEAPONS[id] ? STAT(WEAPONS[id]) : ''}${refund ? '<span class="rf">Right-click to refund</span>' : ''}</div></div>`;
    }).join('');
    this.el.innerHTML = `<div class="bm-wrap"><div class="bm-top"><b>BUY</b><span class="bm-money">$${c.money}</span><span class="bm-time">${c.canBuy ? `Buy time ${Math.ceil(c.time)}s` : escapeHtml(c.reason || 'Cannot buy now')}</span><span class="bm-close">✕</span></div>
      <div class="bm-body"><div class="bm-cats">${cats}</div><div class="bm-items">${items}</div></div>
      <div class="bm-help">Click to buy · Right-click (or long-press) to refund · Number keys · B / Esc to close · ${c.team === TEAM.CT ? 'CT' : 'T'} side</div></div>`;
  }
}
