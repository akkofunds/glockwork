// Source-style player movement: ground friction/accelerate, air-strafe (sv_airaccelerate 12, 30 u/s air wish cap),
// bunny hopping with a jump buffer, crouch fatigue, crouch-jump hull pull-up, stair stepping and ground snapping.
import { MOVE, DT } from '../config.js';

export const BTN = {
  FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, DUCK: 32, WALK: 64,
  ATTACK: 128, ATTACK2: 256, RELOAD: 512, USE: 1024, DROP: 2048, INSPECT: 4096, MODE: 8192,
};

export const hullHeight = (duck) => MOVE.standHeight - (MOVE.standHeight - MOVE.crouchHeight) * duck;
export const eyeHeight = (duck) => MOVE.eyeStand - (MOVE.eyeStand - MOVE.eyeCrouch) * duck;

const contacts = new Float32Array(16 * 3);
const tmp = { x: 0, y: 0, z: 0 };

function friction(v, dt) {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 0.1) { v.x = 0; v.z = 0; return; }
  const control = speed < MOVE.stopSpeed ? MOVE.stopSpeed : speed;
  const drop = control * MOVE.friction * dt;
  const ns = Math.max(0, speed - drop) / speed;
  v.x *= ns; v.z *= ns;
}

function accelerate(v, wx, wz, wishspeed, accel, dt) {
  const cur = v.x * wx + v.z * wz;
  const add = wishspeed - cur;
  if (add <= 0) return;
  const acc = Math.min(accel * dt * wishspeed, add);
  v.x += acc * wx; v.z += acc * wz;
}

function airAccelerate(v, wx, wz, wishspeed, dt) {
  const wishspd = Math.min(wishspeed, MOVE.maxAirWishSpeed);
  const cur = v.x * wx + v.z * wz;
  const add = wishspd - cur;
  if (add <= 0) return;
  const acc = Math.min(MOVE.airAccelerate * wishspeed * dt, add);
  v.x += acc * wx; v.z += acc * wz;
}

function slide(ps, world, dt, horizontalOnly) {
  const v = ps.vel, p = ps.pos;
  const hs0 = Math.hypot(v.x, v.z);
  const grounded = ps.onGround;
  const h = hullHeight(ps.duck), r = MOVE.radius;
  const dist = Math.hypot(v.x, horizontalOnly ? 0 : v.y, v.z) * dt;
  const steps = Math.min(12, Math.max(1, Math.ceil(dist / 7)));
  const sdt = dt / steps;
  let ground = false;
  for (let s = 0; s < steps; s++) {
    p.x += v.x * sdt; if (!horizontalOnly) p.y += v.y * sdt; p.z += v.z * sdt;
    const nc = world.resolveCapsule(p, h, r, contacts, 16, grounded ? MOVE.stepSize : 0);
    for (let i = 0; i < nc; i++) {
      const nx = contacts[i * 3], ny = contacts[i * 3 + 1], nz = contacts[i * 3 + 2];
      // walking on walkable ground: the collision already lifted us vertically, so leave horizontal velocity alone
      if (grounded && ny > MOVE.walkableNormal) { if (v.y < 0) v.y = 0; ground = true; continue; }
      const d = v.x * nx + v.y * ny + v.z * nz;
      if (d < 0) { v.x -= nx * d; v.y -= ny * d; v.z -= nz * d; }
      if (ny > MOVE.walkableNormal) {
        ground = true;
        // walking up a slope: keep the horizontal speed you had (Source-style ground move), never launch upward
        if (grounded && ny < 0.999) {
          // the collision lift already raises us; keep full horizontal speed and stay glued to the slope
          const hs = Math.hypot(v.x, v.z);
          if (hs > 1e-3 && hs < hs0) { const k = hs0 / hs; v.x *= k; v.z *= k; }
          if (v.y > 0) v.y = 0;
        }
      }
    }
  }
  return ground;
}

// Find standable ground below the player within `dist`, stepping down in small increments so a capsule
// lands on stair treads instead of sinking into the riser.
function probeGround(ps, world, dist, edgeOk = false) {
  const h = hullHeight(ps.duck);
  // a capsule resting on a step edge reports a tilted normal: accept it when stepping
  const minNy = edgeOk ? 0.25 : MOVE.walkableNormal;
  for (let d = Math.min(1.5, dist); ; d = Math.min(dist, d + 4)) {
    tmp.x = ps.pos.x; tmp.y = ps.pos.y - d; tmp.z = ps.pos.z;
    const nc = world.resolveCapsule(tmp, h, MOVE.radius, contacts, 16, edgeOk ? MOVE.stepSize : 0);
    let ground = false;
    for (let i = 0; i < nc; i++) if (contacts[i * 3 + 1] > minNy) ground = true;
    if (ground && Math.abs(tmp.x - ps.pos.x) < 4 && Math.abs(tmp.z - ps.pos.z) < 4) return Math.min(tmp.y, ps.pos.y + 0.01);
    if (nc > 0 && !ground && d > 1.5) return null; // hit a wall/riser before any floor
    if (d >= dist) return null;
  }
}

/*
  Advance movement by one tick.
  opts: { frozen, lockMove, maxSpeed }
  returns flags object { jumped, landed, fallSpeed }
*/
const result = { jumped: false, landed: false, fallSpeed: 0 };
export function simulateMovement(ps, cmd, world, opts) {
  const dt = DT;
  const b = cmd.buttons;
  result.jumped = false; result.landed = false; result.fallSpeed = 0;
  const v = ps.vel;

  // --- crouch with fatigue ---
  const wantDuck = (b & BTN.DUCK) !== 0;
  ps.duckFatigue = Math.max(0, ps.duckFatigue - dt * 2.2);
  if (wantDuck && !(ps.prevButtons & BTN.DUCK)) ps.duckFatigue = Math.min(4, ps.duckFatigue + 0.9);
  const rate = (MOVE.duckSpeed / (1 + ps.duckFatigue * 0.55)) * dt;
  if (wantDuck && ps.duck < 1) {
    const nd = Math.min(1, ps.duck + rate);
    if (!ps.onGround) ps.pos.y += hullHeight(ps.duck) - hullHeight(nd); // pull legs up in the air
    ps.duck = nd;
  } else if (!wantDuck && ps.duck > 0) {
    const nd = Math.max(0, ps.duck - rate);
    const dh = hullHeight(nd) - hullHeight(ps.duck);
    const testY = ps.onGround ? ps.pos.y : ps.pos.y - dh;
    if (!world.capsuleOverlaps(ps.pos.x, testY + 0.6, ps.pos.z, hullHeight(nd) - 0.6, MOVE.radius - 0.6)) {
      ps.pos.y = testY; ps.duck = nd;
    }
  }

  // --- wish direction ---
  let fm = 0, sm = 0;
  if (!opts.lockMove && !opts.frozen) {
    if (b & BTN.FWD) fm += 1;
    if (b & BTN.BACK) fm -= 1;
    if (b & BTN.RIGHT) sm += 1;
    if (b & BTN.LEFT) sm -= 1;
  }
  const sy = Math.sin(ps.yaw), cy = Math.cos(ps.yaw);
  let wx = -sy * fm + cy * sm, wz = -cy * fm - sy * sm;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  let maxSpeed = opts.maxSpeed * ps.velMod;
  let mult = 1;
  if (b & BTN.WALK) mult = MOVE.walkMult;
  const duckMult = 1 - (1 - MOVE.crouchMult) * ps.duck;
  if (duckMult < mult) mult = duckMult;
  const wishspeed = wl > 0 ? maxSpeed * mult : 0;

  // --- jump (buffered press) ---
  const wasGround = ps.onGround;
  if (ps.onGround && (b & BTN.JUMP) && !(opts.frozen || opts.lockMove) && ps.jumpCooldown <= 0) {
    v.y = MOVE.jumpImpulse;
    ps.onGround = false;
    ps.jumpCooldown = 2;
    result.jumped = true;
    // a hop chained straight off a landing (no ground friction tick) builds a little speed
    if (ps.airTicks === 0 && ps.groundTicks <= 1) {
      const hs = Math.hypot(v.x, v.z);
      if (hs > 100) { const k = Math.min(MOVE.bhopGain, MOVE.maxBhopSpeed / hs); if (k > 1) { v.x *= k; v.z *= k; } }
    }
  }
  if (ps.jumpCooldown > 0) ps.jumpCooldown--;

  if (ps.onGround) {
    friction(v, dt);
    accelerate(v, wx, wz, wishspeed, MOVE.accelerate, dt);
    v.y = 0;
  } else {
    airAccelerate(v, wx, wz, wishspeed, dt);
    // air control: gently turn your momentum toward where you are looking/moving (keeps speed)
    if (wl > 0 && MOVE.airControl > 0) {
      const hs = Math.hypot(v.x, v.z);
      if (hs > 60) {
        const cur = Math.atan2(v.x, v.z), want = Math.atan2(wx, wz);
        let diff = want - cur; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
        if (Math.abs(diff) < 2.0) {
          const step = Math.max(-MOVE.airControl * dt, Math.min(MOVE.airControl * dt, diff));
          const na = cur + step;
          v.x = Math.sin(na) * hs; v.z = Math.cos(na) * hs;
        }
      }
    }
    const hs = Math.hypot(v.x, v.z);
    if (hs > MOVE.maxBhopSpeed) { const k = MOVE.maxBhopSpeed / hs; v.x *= k; v.z *= k; }
    v.y -= MOVE.gravity * dt;
  }
  if (opts.frozen) { v.x = 0; v.z = 0; }
  if (v.y < -MOVE.maxVelocity) v.y = -MOVE.maxVelocity;
  ps.velMod = Math.min(1, ps.velMod + dt * 0.9);

  const fallSpeed = -v.y;
  const sx = ps.pos.x, sy0 = ps.pos.y, sz = ps.pos.z;
  const svx = v.x, svy = v.y, svz = v.z;

  slide(ps, world, dt, false);

  // stairs/curbs are climbed inside the collision pass (low obstacles lift the capsule while grounded)
  void sx; void sy0; void sz; void svx; void svy; void svz;

  // --- ground categorisation & snapping down stairs/slopes ---
  if (v.y > 140) {
    ps.onGround = false;
  } else {
    const snapDist = (wasGround && !result.jumped) ? MOVE.stepSize : 1.5;
    const gy = probeGround(ps, world, snapDist, wasGround);
    if (gy !== null && gy <= ps.pos.y + 0.5) {
      if (!wasGround && !result.jumped) { result.landed = true; result.fallSpeed = fallSpeed; }
      ps.pos.y = gy;
      ps.onGround = true;
      if (v.y < 0) v.y = 0;
    } else {
      ps.onGround = false;
    }
  }
  if (result.jumped) ps.onGround = false;
  if (ps.onGround) { ps.groundTicks = (ps.groundTicks || 0) + 1; ps.airTicks = 0; }
  else { ps.airTicks = (ps.airTicks || 0) + 1; ps.groundTicks = 0; }
  if (result.landed) ps.groundTicks = 0, ps.airTicks = 0;
  // kill-plane safety
  if (ps.pos.y < world.min[1] - 2000) { ps.pos.y = world.max[1]; v.y = 0; }
  return result;
}
