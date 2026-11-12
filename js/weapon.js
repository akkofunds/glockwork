// weapon.js — Glockwork's signature pistol viewmodel.
// Everything here is procedural primitive geometry (no imported models), but
// built from ~40 individually placed parts — slide serrations front & rear,
// extractor, ejection port shadow, slide stop, takedown lever, three-dot
// sights with emissive paint, stippled grip texture, witness-hole magazine,
// beveled/crowned barrel — so it reads as a real gun silhouette instead of a
// box-with-a-barrel placeholder.

class GlockViewmodel {
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();       // whole weapon, camera-relative
    this.slideGroup = new THREE.Group();  // reciprocates on fire
    this.magazine = null;
    this.muzzleLight = null;
    this.muzzleFlashMesh = null;

    this.magSize = 12;
    this.reserve = 48;
    this.ammo = this.magSize;

    this.isReloading = false;
    this.reloadT = 0;
    this.reloadDuration = 1.75;
    this._reloadSoundsFired = {};

    this.isInspecting = false;
    this.inspectT = 0;
    this.inspectDuration = 2.6;

    this.fireRecoil = 0;
    this.muzzleFlashT = 0;

    this.bobT = 0;
    this.swayTarget = new THREE.Vector2();
    this.swayCurrent = new THREE.Vector2();

    this.ads = 0;         // 0..1 blend toward aim-down-sights pose
    this.adsTarget = 0;

    this._build();
  }

  _poly(color, metalness, roughness, map) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness, map });
  }

  _stippleTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b1e22';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.globalAlpha = 0.25 + Math.random() * 0.35;
      ctx.beginPath();
      ctx.arc(x, y, 1.1 + Math.random() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 4);
    return tex;
  }

  _magTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#26282b';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let row = 0; row < 3; row++) {
      ctx.beginPath();
      ctx.arc(size / 2, 10 + row * 16, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  _build() {
    const polymer = this._poly(0x23262b, 0.1, 0.6);
    const grip = this._poly(0x1d1f22, 0.1, 0.75, this._stippleTexture());
    const steel = this._poly(0x5a5e63, 0.92, 0.22);
    const darkSteel = this._poly(0x141516, 0.88, 0.28);
    const brass = this._poly(0xb08d4a, 0.8, 0.35);
    const magMat = this._poly(0x2a2d31, 0.65, 0.4, this._magTexture());
    const sightPaint = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x332200, roughness: 0.4 });

    // ---- Frame -----------------------------------------------------------
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.085, 0.165), polymer);
    frame.position.set(0, -0.01, 0.002);
    this.group.add(frame);

    // Beavertail (back of frame, protects hand from slide)
    const beavertail = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.03, 0.025), polymer);
    beavertail.position.set(0, 0.012, 0.09);
    this.group.add(beavertail);

    // Dust cover / accessory rail (front of frame, under barrel)
    const dustCover = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.055), polymer);
    dustCover.position.set(0, -0.02, -0.09);
    this.group.add(dustCover);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.006, 0.05), darkSteel);
    rail.position.set(0, -0.006, -0.085);
    this.group.add(rail);
    for (let i = 0; i < 3; i++) {
      const notch = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.003, 0.004), darkSteel);
      notch.position.set(0, -0.0035, -0.07 - i * 0.012);
      this.group.add(notch);
    }

    // ---- Grip --------------------------------------------------------------
    const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.115, 0.062), grip);
    gripMesh.position.set(0, -0.09, 0.048);
    gripMesh.rotation.x = 0.27;
    this.group.add(gripMesh);

    // Magazine well flare at base of grip
    const magWell = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.07), darkSteel);
    magWell.position.set(0, -0.148, 0.062);
    magWell.rotation.x = 0.27;
    this.group.add(magWell);

    // Trigger guard
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 6, 12, Math.PI * 1.3), polymer);
    guard.position.set(0, -0.025, 0.09);
    guard.rotation.set(Math.PI / 2, 0, 0);
    this.group.add(guard);
    const guardFront = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, 0.008), polymer);
    guardFront.position.set(0, -0.044, 0.065);
    this.group.add(guardFront);

    // Trigger + trigger safety blade
    this.triggerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.005), darkSteel);
    this.triggerMesh.position.set(0, -0.03, 0.095);
    this.group.add(this.triggerMesh);
    const safetyBlade = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.012, 0.003), steel);
    safetyBlade.position.set(0, -0.026, 0.096);
    this.group.add(safetyBlade);

    // Slide stop lever (left side of frame)
    const slideStop = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.018), steel);
    slideStop.position.set(0.024, 0.015, 0.04);
    this.group.add(slideStop);

    // Takedown lever
    const takedown = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.01, 0.012), darkSteel);
    takedown.position.set(0.023, 0.005, -0.01);
    this.group.add(takedown);

    // ---- Slide assembly (reciprocates) -------------------------------------
    const slideBody = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.045, 0.2), steel);
    slideBody.position.set(0, 0.045, 0.005);
    this.slideGroup.add(slideBody);

    // Beveled front
    const slideFront = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.036, 0.018), steel);
    slideFront.position.set(0, 0.045, -0.095);
    this.slideGroup.add(slideFront);

    // Ejection port (dark recess, right side)
    const ejectPort = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.045), darkSteel);
    ejectPort.position.set(0.021, 0.05, 0.02);
    this.slideGroup.add(ejectPort);

    // Extractor (small external claw at rear right of ejection port)
    const extractor = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.014), darkSteel);
    extractor.position.set(0.022, 0.05, 0.04);
    this.slideGroup.add(extractor);

    // Loaded-chamber indicator nub (top rear of slide)
    const lciNub = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.004, 0.008), brass);
    lciNub.position.set(0, 0.069, 0.03);
    this.slideGroup.add(lciNub);

    // Rear serrations
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.046, 0.0028), darkSteel);
      s.position.set(0, 0.045, 0.085 + i * 0.0055);
      this.slideGroup.add(s);
    }
    // Front serrations (closer to muzzle, modern-pistol styling)
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.046, 0.0025), darkSteel);
      s.position.set(0, 0.045, -0.055 - i * 0.005);
      this.slideGroup.add(s);
    }

    // Barrel, visible through the port, with a crowned muzzle
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.05, 12), darkSteel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.045, -0.1);
    this.slideGroup.add(barrel);
    const muzzleCrown = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0016, 6, 14), steel);
    muzzleCrown.rotation.x = Math.PI / 2;
    muzzleCrown.position.set(0, 0.045, -0.123);
    this.slideGroup.add(muzzleCrown);

    // Rear sight: notch block + two white-dot accents
    const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.012, 0.009), darkSteel);
    rearSight.position.set(0, 0.071, 0.088);
    this.slideGroup.add(rearSight);
    const rearDotL = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.003), sightPaint);
    rearDotL.position.set(-0.009, 0.072, 0.084);
    this.slideGroup.add(rearDotL);
    const rearDotR = rearDotL.clone();
    rearDotR.position.x = 0.009;
    this.slideGroup.add(rearDotR);

    // Front sight: post + single white/orange dot
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.014, 0.006), darkSteel);
    frontSight.position.set(0, 0.071, -0.105);
    this.slideGroup.add(frontSight);
    const frontDot = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x8a3300, roughness: 0.4 }));
    frontDot.position.set(0, 0.074, -0.105);
    this.slideGroup.add(frontDot);
    this.frontSight = frontSight;
    this.rearSight = rearSight;

    this.group.add(this.slideGroup);

    // ---- Magazine ---------------------------------------------------------
    this.magazine = new THREE.Group();
    const magBody = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.05), magMat);
    this.magazine.add(magBody);
    const magBase = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.012, 0.054), darkSteel);
    magBase.position.y = -0.051;
    this.magazine.add(magBase);
    this.magazine.position.set(0, -0.11, 0.05);
    this.magazine.rotation.x = 0.27;
    this.magBaseY = -0.11;
    this.group.add(this.magazine);

    // Muzzle flash light (pooling) + billboard flash
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 4.2, 2.2);
    this.muzzleLight.position.set(0, 0.045, -0.17);
    this.group.add(this.muzzleLight);
    const flashMat = new THREE.SpriteMaterial({ color: 0xffcf80, transparent: true, opacity: 0, depthTest: false });
    this.muzzleFlashMesh = new THREE.Sprite(flashMat);
    this.muzzleFlashMesh.scale.set(0.001, 0.001, 0.001);
    this.muzzleFlashMesh.position.set(0, 0.045, -0.175);
    this.group.add(this.muzzleFlashMesh);

    this.group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    // Hip-fire pose vs. ADS pose (weapon raised to eye line, centered)
    this.basePosHip = new THREE.Vector3(0.09, -0.09, -0.22);
    this.basePosADS = new THREE.Vector3(0.0, -0.045, -0.12);
    this.group.position.copy(this.basePosHip);

    this.camera.add(this.group);
  }

  canFire() {
    return !this.isReloading && !this.isInspecting && this.ammo > 0;
  }

  fire() {
    if (this.isReloading || this.isInspecting) return false;
    if (this.ammo <= 0) { AudioFX.playDryFire(); return false; }
    this.ammo--;
    this.fireRecoil = 1.0;
    this.muzzleFlashT = 1.0;
    AudioFX.playShot(1);
    return true;
  }

  startReload() {
    if (this.isReloading || this.isInspecting || this.ammo === this.magSize || this.reserve <= 0) return;
    this.isReloading = true;
    this.reloadT = 0;
    this._reloadSoundsFired = {};
  }

  startInspect() {
    if (this.isReloading || this.isInspecting) return;
    this.isInspecting = true;
    this.inspectT = 0;
  }

  setADS(active) {
    this.adsTarget = active ? 1 : 0;
  }

  // speedFactor: 0 (still) .. 1+ (sprint), airborne: bool
  update(dt, mouseDeltaX, mouseDeltaY, speedFactor, isMoving, airborne) {
    // --- Recoil / blowback decay ---
    this.fireRecoil = Math.max(0, this.fireRecoil - dt * 9);
    const blow = this.fireRecoil;
    this.slideGroup.position.z = blow * 0.048;
    this.slideGroup.position.x = 0;

    // --- Muzzle flash pooling ---
    this.muzzleFlashT = Math.max(0, this.muzzleFlashT - dt * 12);
    this.muzzleLight.intensity = this.muzzleFlashT * 3.2;
    const flashScale = 0.04 + this.muzzleFlashT * 0.05;
    this.muzzleFlashMesh.scale.set(flashScale, flashScale, flashScale);
    this.muzzleFlashMesh.material.opacity = this.muzzleFlashT;

    // --- ADS blend (smoothed 0..1) ---
    this.ads += (this.adsTarget - this.ads) * Math.min(1, dt * 11);

    // --- Reload animation: mag drops free, pause, fresh mag seats, slide taps ---
    if (this.isReloading) {
      this.reloadT += dt;
      const p = Math.min(1, this.reloadT / this.reloadDuration);
      const dip = Math.sin(p * Math.PI) * 0.085;
      this.group.position.y = -dip;
      this.group.rotation.z = Math.sin(p * Math.PI) * 0.45;

      // Phase 1 (0 - 0.35): old mag drops out and away
      // Phase 2 (0.35 - 0.7): hand off-screen (mag hidden)
      // Phase 3 (0.7 - 1.0): fresh mag seats back in with a thunk
      if (p < 0.35) {
        const dp = p / 0.35;
        this.magazine.position.y = this.magBaseY - dp * 0.1;
        this.magazine.visible = true;
        if (!this._reloadSoundsFired.drop && dp > 0.05) { AudioFX.playThunk(0.4); this._reloadSoundsFired.drop = true; }
      } else if (p < 0.7) {
        this.magazine.visible = false;
      } else {
        const sp = (p - 0.7) / 0.3;
        this.magazine.visible = true;
        this.magazine.position.y = this.magBaseY - (1 - sp) * 0.14;
        if (!this._reloadSoundsFired.seat && sp > 0.75) { AudioFX.playThunk(0.8); this._reloadSoundsFired.seat = true; }
      }
      if (p >= 1) {
        this.isReloading = false;
        const need = this.magSize - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.magazine.position.y = this.magBaseY;
        this.magazine.visible = true;
        AudioFX.playClick(1.1, 0.5);
      }
    } else if (this.isInspecting) {
      // Y-inspect: raise weapon, spin it, tilt to check chamber, settle back
      this.inspectT += dt;
      const p = Math.min(1, this.inspectT / this.inspectDuration);
      const raise = Math.sin(p * Math.PI) * 0.05;
      this.group.position.y = raise;
      this.group.rotation.y = Math.sin(p * Math.PI * 2) * 0.55 * (p < 0.8 ? 1 : (1 - p) / 0.2);
      this.group.rotation.x = -Math.sin(p * Math.PI) * 0.25;
      this.group.rotation.z = Math.sin(p * Math.PI * 1.3) * 0.12;
      if (!this._reloadSoundsFired.inspectTap1 && p > 0.3) { AudioFX.playClick(0.8, 0.3); this._reloadSoundsFired.inspectTap1 = true; }
      if (!this._reloadSoundsFired.inspectTap2 && p > 0.65) { AudioFX.playClick(1.3, 0.3); this._reloadSoundsFired.inspectTap2 = true; }
      if (p >= 1) { this.isInspecting = false; this._reloadSoundsFired = {}; }
    } else {
      // --- Normal pose blend: hip-fire <-> ADS ---
      const pos = new THREE.Vector3().lerpVectors(this.basePosHip, this.basePosADS, this.ads);
      this.group.position.copy(pos);
      this.group.rotation.set(0, 0, 0);
      this.group.position.y += blow * 0.015;
      this.group.position.z += blow * 0.03;
      this.group.rotation.x -= blow * 0.1 * (1 - this.ads * 0.6);

      // --- Procedural sway (reduced heavily while aiming) ---
      const swayScale = 1 - this.ads * 0.8;
      this.swayTarget.x = THREE.MathUtils.clamp(-mouseDeltaX * 0.02, -0.035, 0.035) * swayScale;
      this.swayTarget.y = THREE.MathUtils.clamp(-mouseDeltaY * 0.02, -0.03, 0.03) * swayScale;
      this.swayCurrent.x += (this.swayTarget.x - this.swayCurrent.x) * Math.min(1, dt * 8);
      this.swayCurrent.y += (this.swayTarget.y - this.swayCurrent.y) * Math.min(1, dt * 8);
      this.group.position.x += this.swayCurrent.x;
      this.group.position.y += this.swayCurrent.y;
      this.group.rotation.y -= this.swayCurrent.x * 2.2;
      this.group.rotation.x += this.swayCurrent.y * 1.4;

      // --- Walk bob (damped while aiming) ---
      if (isMoving && !airborne) this.bobT += dt * (6 + speedFactor * 6);
      else this.bobT += dt * 2;
      const bobAmt = (isMoving && !airborne ? (0.004 + speedFactor * 0.006) : 0.0015) * swayScale;
      this.group.position.x += Math.sin(this.bobT) * bobAmt;
      this.group.position.y += Math.abs(Math.cos(this.bobT)) * bobAmt * 0.8;

      if (airborne) this.group.position.y += 0.01 * swayScale;
    }
  }
}
