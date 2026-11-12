// main.js — Engine bootstrap, render loop, shooting, remote player sync, HUD.

(function () {
  const net = new NetworkManager();
  let scene, camera, renderer, clock;
  let movement, weapon, mapData;
  let remotePlayers = new Map(); // id -> {mesh, target:{x,y,z,yaw}, nameTag}
  let myHP = 100;
  let chatCtl = null;
  let raf = null;

  // --- Mouse look state ---
  let yaw = 0, pitch = 0;
  let lastMouseDX = 0, lastMouseDY = 0;
  let mouseDXAccum = 0, mouseDYAccum = 0;

  // --- ADS state ---
  let isADS = false;
  const HIP_FOV = 90;
  const ADS_FOV = 55;

  // --- FPS counter ---
  let frameCount = 0, fpsTimer = 0;

  // --- Networking tick ---
  let netTickTimer = 0;
  const NET_TICK = 1 / 20; // 20hz state sync is plenty for a small lobby

  function initRenderer() {
    const canvas = document.getElementById('gameCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace ?? renderer.outputColorSpace;

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  function loadMap(mapKey) {
    // Clear previous map/scene
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 500);
    camera.rotation.order = 'YXZ';

    const builder = MAPS[mapKey] || MAPS.shipyard;
    mapData = builder(scene);

    movement = new MovementController(camera, mapData.colliders);
    const spawn = mapData.spawnPoints[Math.floor(Math.random() * mapData.spawnPoints.length)];
    movement.teleport(spawn.x, spawn.z);

    weapon = new GlockViewmodel(camera);

    // Rebuild remote player meshes for the new scene
    remotePlayers.forEach(rp => scene.add(rp.mesh));
  }

  function makeRemotePlayerMesh(name) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff4655, roughness: 0.6, metalness: 0.2 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.35, 1.0, 4, 8) : new THREE.CylinderGeometry(0.35, 0.35, 1.7, 8), bodyMat);
    body.position.y = 0.9;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), bodyMat);
    head.position.y = 1.65;
    head.castShadow = true;
    group.add(head);
    return group;
  }

  function ensureRemotePlayer(id, name) {
    if (remotePlayers.has(id)) return remotePlayers.get(id);
    const mesh = makeRemotePlayerMesh(name);
    scene.add(mesh);
    const rp = { mesh, target: { x: 0, y: 0, z: 0, yaw: 0 }, current: { x: 0, y: 0, z: 0 } };
    remotePlayers.set(id, rp);
    return rp;
  }

  function removeRemotePlayer(id) {
    const rp = remotePlayers.get(id);
    if (rp) { scene.remove(rp.mesh); remotePlayers.delete(id); }
  }

  // --- Pointer lock -------------------------------------------------------
  function setupPointerLock() {
    const canvas = document.getElementById('gameCanvas');
    const overlay = document.getElementById('pointerLockOverlay');
    overlay.addEventListener('click', () => canvas.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
      overlay.classList.toggle('hidden', document.pointerLockElement === canvas);
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      const sensitivity = 0.0022;
      yaw -= e.movementX * sensitivity;
      pitch -= e.movementY * sensitivity;
      pitch = THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
      mouseDXAccum += e.movementX;
      mouseDYAccum += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) tryFire();
      if (e.button === 2) setADS(true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) setADS(false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => setADS(false));
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'KeyR') weapon && weapon.startReload();
      if (e.code === 'KeyY') weapon && weapon.startInspect();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas) setADS(false);
    });
  }

  function setADS(active) {
    if (isADS === active) return;
    isADS = active;
    weapon && weapon.setADS(active);
    movement && movement.setADS(active);
    document.getElementById('crosshair').classList.toggle('ads-hidden', active);
    document.getElementById('adsVignette').classList.toggle('active', active);
  }

  // --- Shooting with movement-based accuracy spread -----------------------
  function tryFire() {
    if (chatCtl && chatCtl.isChatOpen()) return;
    if (!weapon.canFire()) {
      if (weapon.ammo === 0) weapon.startReload();
      return;
    }
    weapon.fire();
    updateAmmoHUD();

    // Accuracy model: standing & grounded = pinpoint; moving/airborne = wide cone.
    const speedFactor = lastMoveState ? lastMoveState.speedFactor : 0;
    const airborne = lastMoveState ? lastMoveState.airborne : false;
    const baseSpread = 0.0015;
    const moveSpread = speedFactor * 0.045;
    const airSpread = airborne ? 0.05 : 0;
    const adsTightening = isADS ? 0.3 : 1;
    const spread = (baseSpread + moveSpread + airSpread) * adsTightening;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const raycaster = new THREE.Raycaster(camera.getWorldPosition(new THREE.Vector3()), dir, 0.1, 200);
    const hitTargets = [];
    remotePlayers.forEach((rp, id) => hitTargets.push({ id, mesh: rp.mesh }));
    const meshes = hitTargets.map(h => h.mesh);
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
      // Find which remote player owns the hit object
      let hitObj = intersects[0].object;
      let ownerId = null;
      outer: for (const [id, rp] of remotePlayers) {
        let o = hitObj;
        while (o) { if (o === rp.mesh) { ownerId = id; break outer; } o = o.parent; }
      }
      if (ownerId) {
        net.sendKill(net.localName, (net.players.get(ownerId) || {}).name || 'Agent');
      }
    }
  }

  function updateAmmoHUD() {
    const ammoEl = document.getElementById('ammoValue');
    ammoEl.innerHTML = `${weapon.ammo}<span class="ammo-reserve">/${weapon.reserve}</span>`;
    document.getElementById('reloadPrompt').classList.toggle('hidden', !weapon.isReloading);
  }

  let lastMoveState = null;

  // --- Main loop ------------------------------------------------------------
  function animate() {
    raf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    movement.setLook(yaw, pitch);
    lastMoveState = movement.update(dt);

    // Smooth FOV zoom toward the ADS target
    const targetFov = isADS ? ADS_FOV : HIP_FOV;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
    }

    const mdx = mouseDXAccum, mdy = mouseDYAccum;
    mouseDXAccum = 0; mouseDYAccum = 0;
    weapon.update(dt, mdx, mdy, lastMoveState.speedFactor, lastMoveState.isMoving, lastMoveState.airborne);
    updateAmmoHUD();

    // Interpolate remote players toward last received network state
    remotePlayers.forEach(rp => {
      rp.mesh.position.x += (rp.target.x - rp.mesh.position.x) * Math.min(1, dt * 10);
      rp.mesh.position.z += (rp.target.z - rp.mesh.position.z) * Math.min(1, dt * 10);
      rp.mesh.position.y += (rp.target.y - rp.mesh.position.y) * Math.min(1, dt * 10);
      rp.mesh.rotation.y += (rp.target.yaw - rp.mesh.rotation.y) * Math.min(1, dt * 10);
    });

    // Network state tick
    netTickTimer += dt;
    if (netTickTimer >= NET_TICK) {
      netTickTimer = 0;
      net.sendState({ x: camera.position.x, y: camera.position.y - MOVE_EYE_OFFSET(), z: camera.position.z, yaw });
    }

    renderer.render(scene, camera);

    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      document.getElementById('fpsCounter').textContent = `${Math.round(frameCount / fpsTimer)} FPS`;
      frameCount = 0; fpsTimer = 0;
    }
  }

  function MOVE_EYE_OFFSET() { return 1.62; }

  // --- Wire network player events to remote meshes -------------------------
  function wireNetworkToGame() {
    net.onPlayerState = (id, data) => {
      const name = (net.players.get(id) || {}).name || 'Agent';
      const rp = ensureRemotePlayer(id, name);
      rp.target.x = data.x; rp.target.y = data.y; rp.target.z = data.z; rp.target.yaw = data.yaw || 0;
    };
    net.onPlayerLeft = (id) => removeRemotePlayer(id);
    net.onKillFeed = (killer, victim) => UI.killFeedEntry(killer, victim);
  }

  // --- Boot ------------------------------------------------------------------
  function startMatch(mapKey, mode) {
    isADS = false;
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');

    initRenderer();
    loadMap(mapKey);
    setupPointerLock();
    clock = new THREE.Clock();
    chatCtl = UI.initGameChat(net, () => movement.resetKeys());
    wireNetworkToGame();
    updateAmmoHUD();
    if (raf) cancelAnimationFrame(raf);
    animate();
  }

  window.addEventListener('DOMContentLoaded', () => {
    UI.init(net, startMatch);
  });
})();
