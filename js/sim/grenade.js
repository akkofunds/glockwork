// Grenade projectile physics, run identically on host (authoritative) and clients (visual prediction).
import { GRENADE_PHYS, WEAPONS } from '../config.js';

const hit = {};

export function createGrenade(id, type, owner, x, y, z, vx, vy, vz, t0) {
  return { id, type, owner, x, y, z, vx, vy, vz, t0, age: 0, resting: false, still: 0, detonated: false, bounces: 0 };
}

// Advance one step. Returns true if the grenade bounced this step (for sounds).
export function stepGrenade(world, g, dt) {
  if (g.detonated) return false;
  g.age += dt;
  if (g.resting) { g.still += dt; return false; }
  g.vy -= GRENADE_PHYS.gravity * dt;
  let bounced = false;
  let remaining = dt;
  for (let iter = 0; iter < 4 && remaining > 0; iter++) {
    const sp = Math.hypot(g.vx, g.vy, g.vz);
    if (sp < 1e-3) break;
    const dx = g.vx / sp, dy = g.vy / sp, dz = g.vz / sp;
    const dist = sp * remaining;
    const t = world.raycast(g.x, g.y, g.z, dx, dy, dz, dist + GRENADE_PHYS.radius, hit);
    if (t === Infinity || t > dist + GRENADE_PHYS.radius) {
      g.x += g.vx * remaining; g.y += g.vy * remaining; g.z += g.vz * remaining;
      break;
    }
    const travel = Math.max(0, t - GRENADE_PHYS.radius);
    g.x += dx * travel; g.y += dy * travel; g.z += dz * travel;
    remaining -= travel / sp;
    // reflect
    const vn = g.vx * hit.nx + g.vy * hit.ny + g.vz * hit.nz;
    g.vx -= 2 * vn * hit.nx; g.vy -= 2 * vn * hit.ny; g.vz -= 2 * vn * hit.nz;
    const e = GRENADE_PHYS.elasticity;
    g.vx *= e; g.vy *= e; g.vz *= e;
    if (hit.ny > 0.7) { g.vx *= 0.75; g.vz *= 0.75; }
    g.x += hit.nx * 0.5; g.y += hit.ny * 0.5; g.z += hit.nz * 0.5;
    g.bounces++;
    bounced = true;
    if (hit.ny > 0.7 && Math.hypot(g.vx, g.vy, g.vz) < 45) {
      g.vx = 0; g.vy = 0; g.vz = 0; g.resting = true; break;
    }
  }
  return bounced;
}

export function shouldDetonate(g) {
  const d = WEAPONS[g.type];
  if (g.type === 'smoke') return (g.age >= 1.5 && g.resting && g.still > 0.1) || g.age >= 4.5;
  return g.age >= d.fuse;
}
