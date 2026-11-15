// Deterministic per-player simulation shared by the authoritative host and client-side prediction.
// One call = one 64 Hz user command. Side effects (shots, throws, plants) are reported through ctx callbacks.
import { WEAPONS, WEAPON_CODE, WEAPON_IDS, PATTERNS, MOVE, MATCH, DEFAULT_PISTOL, GRENADE_PHYS, DT } from '../config.js';
import { simulateMovement, BTN, eyeHeight } from './movement.js';
import { rng, hashSeed, DEG, clamp } from '../util.js';

export { BTN };

export function createPlayerState(num, team) {
  return {
    num, team, alive: false, hp: 100, armor: 0, helmet: false, defuser: false, money: 800,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0,
    onGround: true, duck: 0, duckFatigue: 0, jumpCooldown: 0, airTicks: 0, groundTicks: 0, velMod: 1, prevButtons: 0, time: 0,
    inv: { primary: null, secondary: null, he: 0, flash: 0, smoke: 0, c4: false },
    active: 'knife', last: 'knife',
    w: freshWeaponState(),
  };
}

export function freshWeaponState() {
  return {
    drawEnd: 0, reloadEnd: 0, nextAttack: 0, nextAttack2: 0, recoil: 0, inacc: 0, lastShot: -10,
    burst: 0, burstNext: 0, burstMode: false, scope: 0, rezoom: 0, shotSeq: 0,
    plantStart: -1, nade: 0, nadeUnder: false, pendingSwitch: 0, ads: 0,
  };
}

export function giveDefaultLoadout(ps) {
  const pid = DEFAULT_PISTOL[ps.team];
  const d = WEAPONS[pid];
  ps.inv = { primary: null, secondary: { id: pid, mag: d.mag, res: d.reserve }, he: 0, flash: 0, smoke: 0, c4: false };
  ps.active = pid; ps.last = 'knife';
  ps.w = freshWeaponState();
}

export function owns(ps, id) {
  if (!id || id === 'none') return false;
  if (id === 'knife') return true;
  const d = WEAPONS[id];
  if (!d) return false;
  if (d.slot === 1) return ps.inv.primary?.id === id;
  if (d.slot === 2) return ps.inv.secondary?.id === id;
  if (d.slot === 4) return ps.inv[id] > 0;
  if (d.slot === 5) return ps.inv.c4;
  return false;
}

export function bestWeapon(ps) {
  if (ps.inv.primary) return ps.inv.primary.id;
  if (ps.inv.secondary) return ps.inv.secondary.id;
  return 'knife';
}

export function activeSlotData(ps) {
  const d = WEAPONS[ps.active];
  if (!d) return null;
  if (d.slot === 1) return ps.inv.primary;
  if (d.slot === 2) return ps.inv.secondary;
  return null;
}

export function maxSpeedFor(ps) {
  const d = WEAPONS[ps.active] || WEAPONS.knife;
  if (d.scopedSpeed && ps.w.scope > 0) return d.scopedSpeed;
  if (d.ads && ps.w.ads) return d.speed * d.ads.speed;
  return d.speed;
}

export function switchTo(ps, id) {
  if (id === ps.active || !owns(ps, id)) return;
  if (ps.active !== id) ps.last = ps.active;
  ps.active = id;
  const w = ps.w;
  w.drawEnd = ps.time + (WEAPONS[id].drawTime || 0.6);
  w.reloadEnd = 0; w.scope = 0; w.rezoom = 0; w.burst = 0; w.plantStart = -1; w.nade = 0; w.pendingSwitch = 0; w.ads = 0;
  w.recoil = 0; w.inacc = 0;
}

export function eyePos(ps, out) {
  out.x = ps.pos.x; out.y = ps.pos.y + eyeHeight(ps.duck); out.z = ps.pos.z;
  return out;
}

// Current inaccuracy (radians) — also used by the dynamic crosshair.
export function currentInaccuracy(ps) {
  const d = WEAPONS[ps.active];
  if (!d || !d.inacc) return 0;
  const ia = d.inacc;
  const speed = Math.hypot(ps.vel.x, ps.vel.z);
  const maxS = d.speed;
  const thr = MOVE.accuracyThreshold * maxS;
  const moveFrac = clamp((speed - thr) / (maxS * 0.95 - thr), 0, 1);
  let base;
  if (d.cls === 'sniper') base = ps.w.scope > 0 ? (ps.duck > 0.5 ? ia.crouch : ia.scoped) : ia.stand;
  else base = ps.duck > 0.5 ? ia.crouch : ia.stand;
  let move = ia.move * moveFrac;
  if (d.stationary && ps.w.scope > 0 && speed > d.stationary) move = Math.max(move, ia.move * 0.35 * clamp(speed / 60, 0, 1));
  let air = 0;
  if (!ps.onGround) air = (ia.airSlow !== undefined && Math.abs(ps.vel.y) < 60) ? ia.airSlow : ia.air;
  if (d.ads && ps.w.ads) { base *= d.ads.acc; move *= 0.75; }
  return base + move + air + ps.w.inacc;
}

export function recoilOffset(ps, out) {
  const d = WEAPONS[ps.active];
  out[0] = 0; out[1] = 0;
  if (!d || !d.pattern) return out;
  const P = PATTERNS[d.pattern];
  const r = Math.min(ps.w.recoil, P.length - 1);
  const i0 = Math.floor(r), i1 = Math.min(P.length - 1, i0 + 1), f = r - i0;
  out[0] = P[i0][0] + (P[i1][0] - P[i0][0]) * f;
  out[1] = P[i0][1] + (P[i1][1] - P[i0][1]) * f;
  return out;
}

const _eye = { x: 0, y: 0, z: 0 };
const _ro = [0, 0];
const _dir = { x: 0, y: 0, z: 0 };

function fireGun(ps, d, slot, ctx) {
  const w = ps.w, t = ps.time;
  slot.mag--;
  const inacc = currentInaccuracy(ps);
  recoilOffset(ps, _ro);
  w.recoil = Math.min(PATTERNS[d.pattern].length - 1, w.recoil + 1);
  w.inacc = Math.min(d.inacc.max, w.inacc + d.inacc.fire * (w.burst > 0 ? 1.4 : 1));
  w.lastShot = t;
  const seed = hashSeed(ps.num, w.shotSeq++);
  const r = rng(seed);
  const yaw = ps.yaw - _ro[0] * DEG;
  const pitch = clamp(ps.pitch + _ro[1] * DEG, -89 * DEG, 89 * DEG);
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const a = r() * Math.PI * 2, rad = r() * inacc;
  // up = right x forward
  const Ux = -rz * fy, Uy = rz * fx - rx * fz, Uz = rx * fy;
  const sx = Math.cos(a) * rad, sy = Math.sin(a) * rad;
  _dir.x = fx + rx * sx + Ux * sy; _dir.y = fy + Uy * sy; _dir.z = fz + rz * sx + Uz * sy;
  const l = Math.hypot(_dir.x, _dir.y, _dir.z);
  _dir.x /= l; _dir.y /= l; _dir.z /= l;
  eyePos(ps, _eye);
  ctx.onFire && ctx.onFire(ps, d, _eye, _dir, { noscope: d.cls === 'sniper' && w.scope === 0, recoil: _ro[1] });
  if (d.scope && w.scope > 0) { w.rezoom = w.scope; w.scope = 0; }
}

function startReload(ps, d, slot) {
  if (!slot || slot.mag >= d.mag || slot.res <= 0 || ps.w.reloadEnd > 0) return false;
  ps.w.reloadEnd = ps.time + d.reloadTime;
  ps.w.scope = 0; ps.w.rezoom = 0; ps.w.burst = 0; ps.w.ads = 0;
  return true;
}

function updateWeapon(ps, cmd, pressed, ctx) {
  const w = ps.w, t = ps.time, d = WEAPONS[ps.active];
  const b = cmd.buttons;
  // recovery
  if (d.inacc) w.inacc *= Math.exp(-DT * 4.6 / d.inacc.recovery);
  if (d.pattern) {
    const cycle = 60 / d.rpm;
    if (t - w.lastShot > cycle * 1.05) w.recoil = Math.max(0, w.recoil - DT * Math.max(d.recover, w.recoil * d.recover * 0.45));
  }
  const slot = activeSlotData(ps);
  if (w.reloadEnd > 0 && t >= w.reloadEnd) {
    if (slot) { const need = d.mag - slot.mag; const take = Math.min(need, slot.res); slot.mag += take; slot.res -= take; }
    w.reloadEnd = 0;
    ctx.onReloadDone && ctx.onReloadDone(ps);
  }
  if (w.rezoom && t >= w.nextAttack && w.reloadEnd === 0) { w.scope = w.rezoom; w.rezoom = 0; }
  if (w.pendingSwitch && t >= w.pendingSwitch) {
    w.pendingSwitch = 0;
    if (!owns(ps, ps.active)) {
      const target = (owns(ps, ps.last) && WEAPONS[ps.last].slot !== 4) ? ps.last : bestWeapon(ps);
      switchTo(ps, target);
    }
  }
  if (t < w.drawEnd) return;
  const canAttack = !ctx.frozen && !ctx.noAttack;

  switch (d.cls) {
    case 'knife': {
      if (!canAttack) break;
      if ((b & BTN.ATTACK) && t >= w.nextAttack) {
        w.nextAttack = t + d.slash.cycle; w.nextAttack2 = Math.max(w.nextAttack2, t + d.slash.cycle);
        w.shotSeq++;
        ctx.onKnife && ctx.onKnife(ps, false);
      } else if ((b & BTN.ATTACK2) && t >= w.nextAttack2) {
        w.nextAttack = t + d.stab.cycle; w.nextAttack2 = t + d.stab.cycle;
        w.shotSeq++;
        ctx.onKnife && ctx.onKnife(ps, true);
      }
      break;
    }
    case 'grenade': {
      const held = b & (BTN.ATTACK | BTN.ATTACK2);
      if (w.nade === 0 && held && canAttack && t >= w.nextAttack && ps.inv[ps.active] > 0) {
        w.nade = 1; w.nadeUnder = !(b & BTN.ATTACK);
        ctx.onSound && ctx.onSound(ps, 'pin');
      } else if (w.nade === 1 && !held) {
        // throw
        const pitch = ps.pitch + ((90 * DEG - Math.abs(ps.pitch)) * 10 / 90);
        const cp = Math.cos(pitch);
        const dx = -Math.sin(ps.yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(ps.yaw) * cp;
        const spd = w.nadeUnder ? GRENADE_PHYS.underhandSpeed : GRENADE_PHYS.throwSpeed * 0.9;
        eyePos(ps, _eye);
        const ox = _eye.x + dx * 16, oy = _eye.y + dy * 16 - (w.nadeUnder ? 12 : 0), oz = _eye.z + dz * 16;
        const vx = dx * spd + ps.vel.x * 1.25, vy = dy * spd + ps.vel.y * 1.0, vz = dz * spd + ps.vel.z * 1.25;
        ps.inv[ps.active]--;
        w.nade = 0; w.nextAttack = t + 0.6;
        w.pendingSwitch = t + 0.45;
        w.shotSeq++;
        ctx.onThrow && ctx.onThrow(ps, ps.active, ox, oy, oz, vx, vy, vz);
      }
      break;
    }
    case 'c4': {
      const planting = (b & BTN.ATTACK) && ps.onGround && canAttack && ctx.inBombsite && ctx.inBombsite(ps);
      if (planting) {
        if (w.plantStart < 0) { w.plantStart = t; ctx.onPlantStart && ctx.onPlantStart(ps); }
        if (t - w.plantStart >= MATCH.plantTime) {
          w.plantStart = -1;
          ps.inv.c4 = false;
          ctx.onPlant && ctx.onPlant(ps);
          switchTo(ps, bestWeapon(ps));
        }
      } else if (w.plantStart >= 0) {
        w.plantStart = -1;
        ctx.onPlantAbort && ctx.onPlantAbort(ps);
      }
      break;
    }
    default: {
      if (!slot) break;
      if ((pressed & BTN.RELOAD)) startReload(ps, d, slot);
      if ((pressed & BTN.ATTACK2) && w.reloadEnd === 0 && d.scope) {
        w.scope = (w.scope + 1) % (d.scope.length + 1); w.rezoom = 0;
        ctx.onSound && ctx.onSound(ps, 'zoom');
      }
      // hold right-click to aim down sights (AK-47, Glock-17)
      if (d.ads) w.ads = (b & BTN.ATTACK2) && w.reloadEnd === 0 ? 1 : 0;
      if ((pressed & BTN.MODE) && d.burst) {
        w.burstMode = !w.burstMode;
        ctx.onSound && ctx.onSound(ps, 'mode');
      }
      // burst continuation
      if (w.burst > 0 && t >= w.burstNext) {
        if (slot.mag > 0) { fireGun(ps, d, slot, ctx); w.burst--; w.burstNext = t + 0.055; } else w.burst = 0;
      }
      const attack = b & BTN.ATTACK;
      const want = d.auto ? attack : (pressed & BTN.ATTACK);
      if (attack && canAttack && t >= w.nextAttack && w.reloadEnd === 0 && w.burst === 0) {
        if (slot.mag <= 0) {
          if (pressed & BTN.ATTACK) ctx.onSound && ctx.onSound(ps, 'dry');
          if (!startReload(ps, d, slot)) w.nextAttack = t + 0.2;
        } else if (want) {
          fireGun(ps, d, slot, ctx);
          if (d.burst && w.burstMode) {
            w.burst = Math.min(2, slot.mag); w.burstNext = t + 0.055; w.nextAttack = t + 0.5;
          } else {
            w.nextAttack = t + 60 / d.rpm;
          }
        }
      }
    }
  }
}

/*
 ctx: { world, frozen, noAttack, isReplay, inBombsite(ps), isDefusing(ps),
        onFire, onKnife, onThrow, onPlant, onPlantStart, onPlantAbort, onDrop, onLand, onJump, onSound, onReloadDone }
*/
export function simulatePlayer(ps, cmd, ctx) {
  ps.time += DT;
  ps.yaw = cmd.yaw;
  ps.pitch = clamp(cmd.pitch, -89 * DEG, 89 * DEG);
  if (!ps.alive) { ps.prevButtons = cmd.buttons; return; }
  const pressed = cmd.buttons & ~ps.prevButtons;

  // weapon selection
  if (cmd.wpn) {
    const id = WEAPON_IDS[cmd.wpn];
    if (id && id !== ps.active && owns(ps, id) && ps.w.nade === 0) switchTo(ps, id);
  }
  // drop current weapon
  if ((pressed & BTN.DROP) && ps.w.nade === 0) {
    const id = ps.active;
    const d = WEAPONS[id];
    if (d && (d.slot === 1 || d.slot === 2 || d.slot === 5)) {
      let item = null;
      if (d.slot === 1) { item = ps.inv.primary; ps.inv.primary = null; }
      else if (d.slot === 2) { item = ps.inv.secondary; ps.inv.secondary = null; }
      else { item = { id: 'c4' }; ps.inv.c4 = false; }
      ctx.onDrop && ctx.onDrop(ps, item);
      ps.active = 'knife';
      switchTo(ps, bestWeapon(ps));
      if (ps.active === 'knife') ps.w.drawEnd = ps.time + 0.4;
    }
  }

  const planting = ps.w.plantStart >= 0;
  const defusing = ctx.isDefusing ? ctx.isDefusing(ps) : false;
  const mv = simulateMovement(ps, cmd, ctx.world, {
    frozen: ctx.frozen, lockMove: planting || defusing, maxSpeed: maxSpeedFor(ps),
  });
  if (mv.jumped && ctx.onJump) ctx.onJump(ps);
  if (mv.landed && ctx.onLand) ctx.onLand(ps, mv.fallSpeed);

  updateWeapon(ps, cmd, pressed, ctx);
  ps.prevButtons = cmd.buttons;
}

export function codeOf(id) { return WEAPON_CODE[id] || 0; }

// Compact comparison for prediction error detection
export function statesDiffer(a, b) {
  const e = 0.03;
  if (Math.abs(a.pos.x - b.pos.x) > e || Math.abs(a.pos.y - b.pos.y) > e || Math.abs(a.pos.z - b.pos.z) > e) return true;
  if (Math.abs(a.vel.x - b.vel.x) > 0.5 || Math.abs(a.vel.y - b.vel.y) > 0.5 || Math.abs(a.vel.z - b.vel.z) > 0.5) return true;
  if (a.alive !== b.alive || a.hp !== b.hp || a.armor !== b.armor || a.helmet !== b.helmet || a.money !== b.money || a.defuser !== b.defuser) return true;
  if (a.active !== b.active || a.onGround !== b.onGround || Math.abs(a.duck - b.duck) > 0.01 || a.team !== b.team) return true;
  const ai = a.inv, bi = b.inv;
  if (ai.he !== bi.he || ai.flash !== bi.flash || ai.smoke !== bi.smoke || ai.c4 !== bi.c4) return true;
  const sd = (x, y) => (!x !== !y) || (x && (x.id !== y.id || x.mag !== y.mag || x.res !== y.res));
  if (sd(ai.primary, bi.primary) || sd(ai.secondary, bi.secondary)) return true;
  const aw = a.w, bw = b.w;
  if (Math.abs(aw.nextAttack - bw.nextAttack) > 1e-6 || Math.abs(aw.reloadEnd - bw.reloadEnd) > 1e-6 || aw.scope !== bw.scope || aw.shotSeq !== bw.shotSeq || aw.nade !== bw.nade) return true;
  if (Math.abs(a.time - b.time) > 1e-6) return true;
  return false;
}
