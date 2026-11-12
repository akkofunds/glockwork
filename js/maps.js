// maps.js — Realistic tactical arenas.
// Uses InstancedMesh for every repeated prop (containers, crates, pillars) to keep
// draw calls low. Unique one-off geometry (ground, ramps, walls) stays as single meshes.

const MAPS = {};

function makeProceduralTexture(baseColor, noiseColor, size = 256, cell = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < (size / cell) * (size / cell) * 0.35; i++) {
    const x = Math.floor(Math.random() * (size / cell)) * cell;
    const y = Math.floor(Math.random() * (size / cell)) * cell;
    ctx.fillStyle = noiseColor;
    ctx.globalAlpha = 0.04 + Math.random() * 0.08;
    ctx.fillRect(x, y, cell, cell);
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function addCollider(colliders, mesh, type, params) {
  // Simple AABB / cylinder colliders used by the movement controller.
  colliders.push({ mesh, type, params });
}

// ---------------------------------------------------------------- SHIPYARD
function buildShipyard(scene) {
  const group = new THREE.Group();
  const colliders = [];
  const spawnPoints = [];

  scene.fog = new THREE.FogExp2(0x1a2028, 0.010);
  scene.background = new THREE.Color(0x151b22);

  // Lighting: cool overcast industrial daylight
  const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x1a1510, 0.65);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xcfd9e8, 1.4);
  sun.position.set(-40, 60, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0005;
  group.add(sun);

  // Ground
  const groundTex = makeProceduralTexture('#2b323b', '#000000', 512, 6);
  groundTex.repeat.set(20, 20);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0.05 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  addCollider(colliders, null, 'ground', { y: 0 });

  // Perimeter walls (unique geometry, low count — fine without instancing)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x33404a, roughness: 0.8, metalness: 0.2 });
  const wallDefs = [
    [0, 4, -80, 160, 8, 1], [0, 4, 80, 160, 8, 1],
    [-80, 4, 0, 1, 8, 160], [80, 4, 0, 1, 8, 160],
  ];
  wallDefs.forEach(([x, y, z, w, h, d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
    group.add(m);
    addCollider(colliders, m, 'box', { x, y: h / 2, z, w, h, d });
  });

  // Shipping containers — repeated geometry, instanced
  const containerGeo = new THREE.BoxGeometry(6, 5.8, 2.4);
  const containerColors = [0xb23a2b, 0x2b6cb2, 0x2f8f4e, 0xc9a227];
  const containerMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.5, vertexColors: false });
  const containerLayout = [
    [-20, -30, 0], [-13.5, -30, 0], [-20, -27.6, 0],
    [15, 10, Math.PI / 2], [15, 16.4, Math.PI / 2],
    [-10, 25, 0.3], [-3, 25, 0.3],
    [30, -5, Math.PI / 2], [30, 1.4, Math.PI / 2], [30, -5, Math.PI / 2],
    [8, -22, 0], [8, -22, 0],
  ];
  const containerInst = new THREE.InstancedMesh(containerGeo, containerMat, containerLayout.length);
  containerInst.castShadow = containerInst.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const stackHeights = {};
  containerLayout.forEach(([x, z, rot], i) => {
    const key = `${x},${z}`;
    stackHeights[key] = (stackHeights[key] || 0);
    const y = 2.9 + stackHeights[key] * 5.9;
    stackHeights[key]++;
    dummy.position.set(x, y, z);
    dummy.rotation.y = rot;
    dummy.updateMatrix();
    containerInst.setMatrixAt(i, dummy.matrix);
    containerInst.setColorAt(i, new THREE.Color(containerColors[i % containerColors.length]));
    addCollider(colliders, null, 'box', { x, y, z, w: rot ? 2.4 : 6, h: 5.8, d: rot ? 6 : 2.4 });
  });
  containerInst.instanceColor.needsUpdate = true;
  group.add(containerInst);

  // Crates (small cover / head-glitch boxes) — instanced
  const crateGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 });
  const cratePositions = [
    [-2, -8, 0], [-0.4, -8, 0], [5, 5, 0], [5, 6.6, 0], [5, 5, 1.6],
    [-25, 5, 0], [20, -15, 0], [20, -16.6, 0], [-12, -2, 0], [2, 18, 0], [2, 19.6, 0],
  ];
  const crateInst = new THREE.InstancedMesh(crateGeo, crateMat, cratePositions.length);
  crateInst.castShadow = crateInst.receiveShadow = true;
  cratePositions.forEach(([x, z, stack], i) => {
    const y = 0.7 + stack * 1.4;
    dummy.position.set(x, y, z); dummy.rotation.y = (i * 0.37) % 1;
    dummy.updateMatrix();
    crateInst.setMatrixAt(i, dummy.matrix);
    addCollider(colliders, null, 'box', { x, y, z, w: 1.4, h: 1.4, d: 1.4 });
  });
  group.add(crateInst);

  // Ramp
  const ramp = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.4, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a4450, roughness: 0.85 })
  );
  ramp.position.set(-30, 1.4, 15);
  ramp.rotation.x = -0.3;
  ramp.castShadow = ramp.receiveShadow = true;
  group.add(ramp);
  addCollider(colliders, ramp, 'ramp', { x: -30, z: 15, w: 6, len: 10, rise: 2.8, rotX: -0.3 });

  // Scattered pillars for sightline breaks — instanced
  const pillarGeo = new THREE.CylinderGeometry(0.9, 0.9, 7, 10);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x454f58, roughness: 0.75, metalness: 0.3 });
  const pillarPos = [[-40, -40], [40, -40], [-40, 40], [40, 40], [0, -60], [0, 60]];
  const pillarInst = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarPos.length);
  pillarInst.castShadow = pillarInst.receiveShadow = true;
  pillarPos.forEach(([x, z], i) => {
    dummy.position.set(x, 3.5, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    pillarInst.setMatrixAt(i, dummy.matrix);
    addCollider(colliders, null, 'cylinder', { x, z, r: 0.9, h: 7 });
  });
  group.add(pillarInst);

  spawnPoints.push(
    { x: -35, z: -35 }, { x: 35, z: -35 }, { x: -35, z: 35 }, { x: 35, z: 35 },
    { x: 0, z: -55 }, { x: 0, z: 55 }, { x: -55, z: 0 }, { x: 55, z: 0 }
  );

  scene.add(group);
  return { group, colliders, spawnPoints, skyColor: 0x151b22 };
}

// ---------------------------------------------------------------- COURTYARD
function buildCourtyard(scene) {
  const group = new THREE.Group();
  const colliders = [];
  const spawnPoints = [];

  scene.fog = new THREE.FogExp2(0xd8c79a, 0.006);
  scene.background = new THREE.Color(0xcfe3f2);

  const hemi = new THREE.HemisphereLight(0xfff2d6, 0x8a6a3a, 0.8);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2cf, 1.8);
  sun.position.set(50, 70, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0005;
  group.add(sun);

  const groundTex = makeProceduralTexture('#d8bd82', '#5a3f20', 512, 6);
  groundTex.repeat.set(20, 20);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.9, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  addCollider(colliders, null, 'ground', { y: 0 });

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcaa968, roughness: 0.95 });
  const wallDefs = [
    [0, 5, -75, 150, 10, 1], [0, 5, 75, 150, 10, 1],
    [-75, 5, 0, 1, 10, 150], [75, 5, 0, 1, 10, 150],
  ];
  wallDefs.forEach(([x, y, z, w, h, d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
    group.add(m);
    addCollider(colliders, m, 'box', { x, y: h / 2, z, w, h, d });
  });

  // Sandstone cover boxes — instanced (head-glitch height ~1.3m)
  const boxGeo = new THREE.BoxGeometry(2, 1.3, 2);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xe2c48c, roughness: 0.85 });
  const boxLayout = [
    [-10, -10], [10, -10], [-10, 10], [10, 10], [0, -20], [0, 20],
    [-25, 0], [25, 0], [-18, -18], [18, 18], [-18, 18], [18, -18],
  ];
  const boxInst = new THREE.InstancedMesh(boxGeo, boxMat, boxLayout.length);
  boxInst.castShadow = boxInst.receiveShadow = true;
  const dummy = new THREE.Object3D();
  boxLayout.forEach(([x, z], i) => {
    dummy.position.set(x, 0.65, z); dummy.rotation.y = (i * 0.21) % 1; dummy.updateMatrix();
    boxInst.setMatrixAt(i, dummy.matrix);
    addCollider(colliders, null, 'box', { x, y: 0.65, z, w: 2, h: 1.3, d: 2 });
  });
  group.add(boxInst);

  // Columns — instanced
  const colGeo = new THREE.CylinderGeometry(1.1, 1.1, 8, 12);
  const colMat = new THREE.MeshStandardMaterial({ color: 0xe8d4a8, roughness: 0.8 });
  const colPos = [[-30, -30], [30, -30], [-30, 30], [30, 30], [-30, 0], [30, 0], [0, -35], [0, 35]];
  const colInst = new THREE.InstancedMesh(colGeo, colMat, colPos.length);
  colInst.castShadow = colInst.receiveShadow = true;
  colPos.forEach(([x, z], i) => {
    dummy.position.set(x, 4, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    colInst.setMatrixAt(i, dummy.matrix);
    addCollider(colliders, null, 'cylinder', { x, z, r: 1.1, h: 8 });
  });
  group.add(colInst);

  // Central ramp up to a mid platform
  const ramp = new THREE.Mesh(
    new THREE.BoxGeometry(5, 0.4, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8bd82, roughness: 0.9 })
  );
  ramp.position.set(0, 1.1, -5);
  ramp.rotation.x = -0.28;
  ramp.castShadow = ramp.receiveShadow = true;
  group.add(ramp);
  addCollider(colliders, ramp, 'ramp', { x: 0, z: -5, w: 5, len: 8, rise: 2.2, rotX: -0.28 });

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.6, 6),
    new THREE.MeshStandardMaterial({ color: 0xe2c48c, roughness: 0.85 })
  );
  platform.position.set(0, 2.2, -12);
  platform.castShadow = platform.receiveShadow = true;
  group.add(platform);
  addCollider(colliders, platform, 'box', { x: 0, y: 2.2, z: -12, w: 10, h: 0.6, d: 6 });

  spawnPoints.push(
    { x: -32, z: -32 }, { x: 32, z: -32 }, { x: -32, z: 32 }, { x: 32, z: 32 },
    { x: 0, z: -50 }, { x: 0, z: 50 }, { x: -50, z: 0 }, { x: 50, z: 0 }
  );

  scene.add(group);
  return { group, colliders, spawnPoints, skyColor: 0xcfe3f2 };
}

MAPS.shipyard = buildShipyard;
MAPS.courtyard = buildCourtyard;
