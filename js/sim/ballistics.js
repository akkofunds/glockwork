// Hitboxes, ray-vs-hitbox tests, wall penetration and the armour damage model.
import { HG, HG_MULT } from '../config.js';

// Local-space hitboxes for a standing 72u player (feet at origin, facing -Z).
// [hitgroup, ax, ay, az, bx, by, bz, radius]  (sphere when a == b)
const HITBOXES = [
  [HG.HEAD, 0, 63.2, -0.8, 0, 63.2, -0.8, 5.4],
  [HG.CHEST, 0, 46.5, 0, 0, 55.5, 0, 9.6],
  [HG.STOMACH, 0, 33.5, 0, 0, 43, 0, 8.6],
  [HG.ARM, 8.6, 54.5, -1.5, 5.5, 45, -13.5, 3.4],
  [HG.ARM, -8.6, 54.5, -1.5, -2.5, 46, -18, 3.2],
  [HG.LEG, 4.6, 31, 0, 4.6, 3, 0, 5.4],
  [HG.LEG, -4.6, 31, 0, -4.6, 3, 0, 5.4],
];
export const HITBOX_COUNT = HITBOXES.length;

// Build world-space hitbox capsules for a pose into a Float32Array(HITBOX_COUNT*7)
export function poseHitboxes(pose, out) {
  const s = 1 - 0.25 * pose.duck; // 72 -> 54
  const c = Math.cos(pose.yaw), sn = Math.sin(pose.yaw);
  for (let i = 0; i < HITBOXES.length; i++) {
    const h = HITBOXES[i];
    const o = i * 7;
    const ax = h[1], ay = h[2] * s, az = h[3], bx = h[4], by = h[5] * s, bz = h[6];
    out[o] = pose.x + ax * c + az * sn; out[o + 1] = pose.y + ay; out[o + 2] = pose.z - ax * sn + az * c;
    out[o + 3] = pose.x + bx * c + bz * sn; out[o + 4] = pose.y + by; out[o + 5] = pose.z - bx * sn + bz * c;
    out[o + 6] = h[7];
  }
  return out;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const ocx = ox - cx, ocy = oy - cy, ocz = oz - cz;
  const b = ocx * dx + ocy * dy + ocz * dz;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : (c < 0 ? 0 : -1);
}

// Ray vs capsule (Inigo Quilez). Returns entry distance or -1.
function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const oax = ox - ax, oay = oy - ay, oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-6) return raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  if (a < 1e-6) {
    const t1 = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
    const t2 = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
    if (t1 < 0) return t2; if (t2 < 0) return t1; return Math.min(t1, t2);
  }
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h < 0) return -1;
  const t = (-b - Math.sqrt(h)) / a;
  const y = baoa + t * bard;
  if (y > 0 && y < baba) return t >= 0 ? t : -1;
  return y <= 0 ? raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r) : raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
}

const hb = new Float32Array(HITBOX_COUNT * 7);

/*
 Test a ray against a pose. inflate: extra radius (melee).
 Returns {t, hg} or null (re-used object).
*/
const rayHit = { t: 0, hg: 0 };
export function rayVsPose(ox, oy, oz, dx, dy, dz, maxDist, pose, inflate = 0) {
  // broadphase sphere
  const cx = pose.x - ox, cy = pose.y + 36 - oy, cz = pose.z - oz;
  const proj = cx * dx + cy * dy + cz * dz;
  if (proj < -50 || proj > maxDist + 50) return null;
  const px = cx - dx * proj, py = cy - dy * proj, pz = cz - dz * proj;
  if (px * px + py * py + pz * pz > (48 + inflate) * (48 + inflate)) return null;
  poseHitboxes(pose, hb);
  let best = Infinity, bestHg = -1;
  for (let i = 0; i < HITBOX_COUNT; i++) {
    const o = i * 7;
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, hb[o], hb[o + 1], hb[o + 2], hb[o + 3], hb[o + 4], hb[o + 5], hb[o + 6] + inflate);
    if (t >= 0 && t < best && t <= maxDist) {
      // prefer the head when several boxes overlap at near-identical distances
      if (bestHg === HG.HEAD && t > best - 0.5) continue;
      best = t; bestHg = HITBOXES[i][0];
    }
  }
  if (bestHg < 0) return null;
  rayHit.t = best; rayHit.hg = bestHg;
  return rayHit;
}

/*
 Armour damage model.
 Returns {health, armor} damage to apply.
*/
export function computeDamage(baseDamage, armorPen, rangeMod, hg, dist, victim, mult = 1) {
  let dmg = baseDamage * HG_MULT[hg] * Math.pow(rangeMod, dist / 500) * mult;
  let armorDmg = 0;
  const armored = victim.armor > 0 && hg !== HG.LEG && (hg !== HG.HEAD || victim.helmet);
  if (armored) {
    let health = dmg * armorPen;
    armorDmg = (dmg - health) * 0.5;
    if (armorDmg > victim.armor) {
      health = dmg - victim.armor * 2;
      armorDmg = victim.armor;
    }
    dmg = health;
  }
  return { health: Math.max(1, Math.floor(dmg)), armor: Math.floor(armorDmg), armored };
}

/*
 Trace a bullet through the world with wall penetration.
 getPoses(): iterable of {num, pose, ref}
 Returns result object with player hit (first), wall impacts, penetration count.
*/
const wh = {}; const eh = {};
export function traceBullet(world, ox, oy, oz, dx, dy, dz, def, poses, shooterNum) {
  const res = { hit: null, impacts: [], wallbang: false, end: null, travelled: 0 };
  let remainingPen = def.pen || 0;
  let dmgMult = 1;
  let cx = ox, cy = oy, cz = oz;
  let travelled = 0;
  for (let seg = 0; seg < 3; seg++) {
    const maxD = def.range - travelled;
    if (maxD <= 0) break;
    const tWall = world.raycast(cx, cy, cz, dx, dy, dz, maxD, wh);
    // players
    let best = tWall === Infinity ? maxD : tWall, bestP = null, bestHg = 0;
    for (const p of poses) {
      if (p.num === shooterNum) continue;
      const r = rayVsPose(cx, cy, cz, dx, dy, dz, best, p.pose);
      if (r && r.t < best) { best = r.t; bestP = p; bestHg = r.hg; }
    }
    if (bestP) {
      res.hit = { p: bestP, hg: bestHg, dist: travelled + best, mult: dmgMult, x: cx + dx * best, y: cy + dy * best, z: cz + dz * best };
      res.end = [res.hit.x, res.hit.y, res.hit.z];
      return res;
    }
    if (tWall === Infinity) {
      res.end = [cx + dx * maxD, cy + dy * maxD, cz + dz * maxD];
      return res;
    }
    res.impacts.push([wh.x, wh.y, wh.z, wh.nx, wh.ny, wh.nz]);
    res.end = [wh.x, wh.y, wh.z];
    travelled += tWall;
    // try penetrating: find exit by casting back from the far side
    const maxThick = remainingPen * (wh.thin ? 2.2 : 1);
    if (maxThick < 1 || Math.abs(wh.ny) > 0.7) return res; // floors/ceilings are never penetrable
    const fx = wh.x + dx * maxThick, fy = wh.y + dy * maxThick, fz = wh.z + dz * maxThick;
    const tb = world.raycast(fx, fy, fz, -dx, -dy, -dz, maxThick - 0.2, eh);
    if (tb === Infinity) {
      // either solid all the way or the exit lies beyond our capability: check point is open air
      return res;
    }
    const thickness = maxThick - tb;
    if (thickness >= maxThick) return res;
    const ex = fx - dx * tb, ey = fy - dy * tb, ez = fz - dz * tb;
    res.impacts.push([ex, ey, ez, eh.nx, eh.ny, eh.nz]);
    res.wallbang = true;
    const usedFrac = thickness / maxThick;
    dmgMult *= Math.max(0.15, (1 - usedFrac) * 0.8);
    remainingPen *= (1 - usedFrac) * 0.6;
    travelled += thickness;
    cx = ex + dx * 0.3; cy = ey + dy * 0.3; cz = ez + dz * 0.3;
  }
  return res;
}

// Does the segment a->b pass through any smoke sphere?
export function segmentThroughSmoke(ax, ay, az, bx, by, bz, smokes) {
  for (const s of smokes) {
    const r = s.radius * Math.min(1, s.grow);
    if (r <= 0) continue;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    let t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - s.x, py = ay + dy * t - s.y, pz = az + dz * t - s.z;
    if (px * px + py * py + pz * pz < r * r) return true;
  }
  return false;
}
