// movement.js — CS:GO / Source-engine style movement.
// Ground accel/friction with instant counter-strafe deceleration, air-strafe
// acceleration (the classic CS bunnyhop trick), uncapped bhop via a jump
// buffer window so a scroll/space tap just before landing still fires.

const MOVE = {
  maxGroundSpeed: 6.2,
  maxAirSpeed: 1.6,          // wish-speed cap used inside the air-accel formula
  groundAccel: 14,
  airAccel: 55,              // high air accel = classic bhop/strafe gain
  friction: 7.5,
  gravity: -23,
  jumpVelocity: 7.6,
  playerRadius: 0.4,
  playerHeight: 1.8,
  eyeHeight: 1.62,
  jumpBufferWindow: 0.12,    // seconds — scroll/space just before landing still jumps
};

class MovementController {
  constructor(camera, colliders) {
    this.camera = camera;
    this.colliders = colliders;
    this.position = new THREE.Vector3(0, MOVE.eyeHeight, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.jumpBufferT = -1;
    this.keys = { w: false, a: false, s: false, d: false };
    this.wantsJump = false;
    this.adsFactor = 1; // 1 = normal speed, <1 while aiming down sights

    this._bindInput();
  }

  _isTypingInUI(e) {
    // While the chat box (or any text field) has focus, WASD/Space must not
    // also drive the player — otherwise typing "sword" would make you jump.
    const tag = (e.target && e.target.tagName) || '';
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (this._isTypingInUI(e)) return;
      if (e.code === 'KeyW') this.keys.w = true;
      if (e.code === 'KeyA') this.keys.a = true;
      if (e.code === 'KeyS') this.keys.s = true;
      if (e.code === 'KeyD') this.keys.d = true;
      if (e.code === 'Space') { e.preventDefault(); this._bufferJump(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW') this.keys.w = false;
      if (e.code === 'KeyA') this.keys.a = false;
      if (e.code === 'KeyS') this.keys.s = false;
      if (e.code === 'KeyD') this.keys.d = false;
    });
    // Scroll-wheel jump buffering (classic bhop bind: scroll = jump)
    window.addEventListener('wheel', (e) => {
      if (document.pointerLockElement) this._bufferJump();
    }, { passive: true });
  }

  _bufferJump() {
    this.jumpBufferT = MOVE.jumpBufferWindow;
  }

  setADS(active) {
    // Aiming down sights slows you like a real tactical shooter — you trade
    // mobility for accuracy, same trade-off the spread model already enforces.
    this.adsFactor = active ? 0.55 : 1;
  }

  resetKeys() {
    this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
  }

  teleport(x, z) {
    this.position.set(x, MOVE.eyeHeight, z);
    this.velocity.set(0, 0, 0);
  }

  setLook(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  // --- Collision helpers -------------------------------------------------
  _groundHeightAt(x, z) {
    let h = 0;
    for (const c of this.colliders) {
      if (c.type === 'ramp') {
        const { x: rx, z: rz, w, len, rise, rotX } = c.params;
        const localZ = z - rz, localX = x - rx;
        if (Math.abs(localX) <= w / 2 && localZ >= -len / 2 && localZ <= len / 2) {
          const t = (localZ + len / 2) / len; // 0..1 along ramp
          const rampY = t * Math.abs(Math.tan(rotX)) * len * 0.5 + 0.2;
          h = Math.max(h, Math.min(rampY, rise));
        }
      } else if (c.type === 'box') {
        const { x: bx, y, z: bz, w, h: bh, d } = c.params;
        if (Math.abs(x - bx) <= w / 2 + MOVE.playerRadius * 0.3 &&
            Math.abs(z - bz) <= d / 2 + MOVE.playerRadius * 0.3) {
          const top = y + bh / 2;
          // only "stand on" boxes short enough to be a step/platform from below
          if (top <= 2.6) h = Math.max(h, top);
        }
      }
    }
    return h;
  }

  _resolveHorizontal(pos) {
    for (const c of this.colliders) {
      if (c.type === 'box') {
        const { x, y, z, w, h, d } = c.params;
        const top = y + h / 2;
        if (pos.y - MOVE.eyeHeight + MOVE.playerHeight * 0.55 > y - h / 2 && pos.y - MOVE.eyeHeight < top - 0.15) {
          const halfW = w / 2 + MOVE.playerRadius;
          const halfD = d / 2 + MOVE.playerRadius;
          const dx = pos.x - x, dz = pos.z - z;
          if (Math.abs(dx) < halfW && Math.abs(dz) < halfD) {
            const overlapX = halfW - Math.abs(dx);
            const overlapZ = halfD - Math.abs(dz);
            if (overlapX < overlapZ) pos.x += Math.sign(dx || 1) * overlapX;
            else pos.z += Math.sign(dz || 1) * overlapZ;
          }
        }
      } else if (c.type === 'cylinder') {
        const { x, z, r } = c.params;
        const rr = r + MOVE.playerRadius;
        const dx = pos.x - x, dz = pos.z - z;
        const dist = Math.hypot(dx, dz);
        if (dist < rr && dist > 0.0001) {
          const push = (rr - dist);
          pos.x += (dx / dist) * push;
          pos.z += (dz / dist) * push;
        }
      }
    }
    // World bounds (soft wall)
    const bound = 78;
    pos.x = THREE.MathUtils.clamp(pos.x, -bound, bound);
    pos.z = THREE.MathUtils.clamp(pos.z, -bound, bound);
  }

  update(dt) {
    dt = Math.min(dt, 1 / 30); // clamp spiral-of-death on hitches

    // Wish direction from WASD, camera-yaw relative (Source-style)
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1);
    const right = new THREE.Vector3(Math.sin(this.yaw + Math.PI / 2), 0, Math.cos(this.yaw + Math.PI / 2)).multiplyScalar(-1);

    let wishX = 0, wishZ = 0;
    if (this.keys.w) { wishX += forward.x; wishZ += forward.z; }
    if (this.keys.s) { wishX -= forward.x; wishZ -= forward.z; }
    if (this.keys.d) { wishX += right.x; wishZ += right.z; }
    if (this.keys.a) { wishX -= right.x; wishZ -= right.z; }
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.0001) { wishX /= wishLen; wishZ /= wishLen; }
    const hasWish = wishLen > 0.0001;

    const groundY = this._groundHeightAt(this.position.x, this.position.z) + MOVE.eyeHeight;
    this.onGround = this.position.y <= groundY + 0.02 && this.velocity.y <= 0.001;

    if (this.onGround) {
      // --- Ground movement: accelerate toward wish dir, with friction first
      // (friction implements instant counter-strafe deceleration: pressing the
      // opposite direction kills current velocity almost immediately because
      // the projected speed onto the new wish dir goes negative and friction
      // + accel both oppose the old vector).
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (speed > 0.0001) {
        const drop = speed * MOVE.friction * dt;
        const newSpeed = Math.max(0, speed - drop);
        const scale = newSpeed / speed;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }
      if (hasWish) {
        const targetSpeed = MOVE.maxGroundSpeed * this.adsFactor;
        const currentSpeedInWishDir = this.velocity.x * wishX + this.velocity.z * wishZ;
        const addSpeed = targetSpeed - currentSpeedInWishDir;
        if (addSpeed > 0) {
          const accelSpeed = Math.min(addSpeed, MOVE.groundAccel * targetSpeed * dt);
          this.velocity.x += accelSpeed * wishX;
          this.velocity.z += accelSpeed * wishZ;
        }
      }

      // Jump (consumes buffer — this is what makes uncapped bhop feel smooth:
      // a jump queued by scroll/space fires the instant we touch ground again,
      // so horizontal speed is never clipped by a missed-timing landing).
      if (this.jumpBufferT > 0) {
        this.velocity.y = MOVE.jumpVelocity;
        this.jumpBufferT = -1;
        this.onGround = false;
      } else {
        this.velocity.y = 0;
        this.position.y = groundY;
      }
    } else {
      // --- Air movement: air-strafe acceleration (CS air-accelerate formula)
      if (hasWish) {
        const currentSpeedInWishDir = this.velocity.x * wishX + this.velocity.z * wishZ;
        const addSpeed = MOVE.maxAirSpeed - currentSpeedInWishDir;
        if (addSpeed > 0) {
          const accelSpeed = Math.min(addSpeed, MOVE.airAccel * MOVE.maxAirSpeed * dt);
          this.velocity.x += accelSpeed * wishX;
          this.velocity.z += accelSpeed * wishZ;
        }
      }
      this.velocity.y += MOVE.gravity * dt;
    }

    if (this.jumpBufferT > 0) this.jumpBufferT -= dt;

    // Integrate
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    this._resolveHorizontal(this.position);

    const newGroundY = this._groundHeightAt(this.position.x, this.position.z) + MOVE.eyeHeight;
    if (this.position.y < newGroundY) {
      this.position.y = newGroundY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    this.camera.position.copy(this.position);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    return {
      speedFactor: THREE.MathUtils.clamp(horizSpeed / MOVE.maxGroundSpeed, 0, 1.6),
      isMoving: hasWish && this.onGround,
      airborne: !this.onGround,
      horizSpeed,
    };
  }
}
