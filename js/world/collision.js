// Static triangle-soup collision world with a 3D spatial hash.
// Used by movement (vertical capsule push-out), bullets (DDA raycast), grenades, LOS checks.

const CELL = 128;
const INV = 1 / CELL;
const OFF = 4096;
const key = (x, y, z) => ((x + OFF) * 8192 + (y + OFF)) * 8192 + (z + OFF);

export class CollisionWorld {
  constructor() {
    this._v = []; // flat vertices (9 per tri)
    this._flags = [];
    this.tris = null; // Float32Array 9 per tri
    this.normals = null; // Float32Array 3 per tri
    this.flags = null; // Uint8Array per tri (bit0: thin / easily penetrable)
    this.count = 0;
    this.grid = new Map();
    this.stamp = null;
    this.stampId = 1;
    this.result = new Int32Array(4096);
    this.resultCount = 0;
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  // positions: flat array of world-space vertex coords. indices optional.
  addTriangles(positions, indices, flag = 0) {
    const v = this._v;
    const n = indices ? indices.length : positions.length / 3;
    for (let i = 0; i < n; i += 3) {
      const a = indices ? indices[i] : i, b = indices ? indices[i + 1] : i + 1, c = indices ? indices[i + 2] : i + 2;
      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
      const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
      const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
      // skip degenerate
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      if (nx * nx + ny * ny + nz * nz < 1e-8) continue;
      v.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      this._flags.push(flag);
    }
  }

  // Add every mesh under a THREE.Object3D (world matrices must be up to date)
  addObject(root, THREE, filter) {
    const p = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || o.userData.noCollide) return;
      if (filter && !filter(o)) return;
      const g = o.geometry;
      const pos = g.attributes.position;
      if (!pos) return;
      const arr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
      }
      this.addTriangles(arr, g.index ? g.index.array : null, o.userData.thin ? 1 : 0);
    });
  }

  build() {
    const v = this._v;
    this.count = v.length / 9;
    this.tris = new Float32Array(v);
    this.flags = new Uint8Array(this._flags);
    this.normals = new Float32Array(this.count * 3);
    this.stamp = new Uint32Array(this.count);
    const grid = new Map();
    const t = this.tris;
    for (let i = 0; i < this.count; i++) {
      const o = i * 9;
      const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2];
      const wx = t[o + 6] - t[o], wy = t[o + 7] - t[o + 1], wz = t[o + 8] - t[o + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.normals[i * 3] = nx / l; this.normals[i * 3 + 1] = ny / l; this.normals[i * 3 + 2] = nz / l;
      const minx = Math.min(t[o], t[o + 3], t[o + 6]), maxx = Math.max(t[o], t[o + 3], t[o + 6]);
      const miny = Math.min(t[o + 1], t[o + 4], t[o + 7]), maxy = Math.max(t[o + 1], t[o + 4], t[o + 7]);
      const minz = Math.min(t[o + 2], t[o + 5], t[o + 8]), maxz = Math.max(t[o + 2], t[o + 5], t[o + 8]);
      this.min[0] = Math.min(this.min[0], minx); this.min[1] = Math.min(this.min[1], miny); this.min[2] = Math.min(this.min[2], minz);
      this.max[0] = Math.max(this.max[0], maxx); this.max[1] = Math.max(this.max[1], maxy); this.max[2] = Math.max(this.max[2], maxz);
      const x0 = Math.floor(minx * INV), x1 = Math.floor(maxx * INV);
      const y0 = Math.floor(miny * INV), y1 = Math.floor(maxy * INV);
      const z0 = Math.floor(minz * INV), z1 = Math.floor(maxz * INV);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const k = key(x, y, z);
        let cell = grid.get(k);
        if (!cell) { cell = []; grid.set(k, cell); }
        cell.push(i);
      }
    }
    this.grid = new Map();
    for (const [k, arr] of grid) this.grid.set(k, Int32Array.from(arr));
    this._v = []; this._flags = [];
    return this;
  }

  _nextStamp() {
    this.stampId++;
    if (this.stampId > 0xfffffff0) { this.stamp.fill(0); this.stampId = 1; }
    return this.stampId;
  }

  // Collect unique triangle indices overlapping an AABB into this.result
  queryBox(minx, miny, minz, maxx, maxy, maxz) {
    const s = this._nextStamp();
    let n = 0;
    const x0 = Math.floor(minx * INV), x1 = Math.floor(maxx * INV);
    const y0 = Math.floor(miny * INV), y1 = Math.floor(maxy * INV);
    const z0 = Math.floor(minz * INV), z1 = Math.floor(maxz * INV);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const cell = this.grid.get(key(x, y, z));
      if (!cell) continue;
      for (let i = 0; i < cell.length; i++) {
        const ti = cell[i];
        if (this.stamp[ti] === s) continue;
        this.stamp[ti] = s;
        if (n >= this.result.length) { const r = new Int32Array(this.result.length * 2); r.set(this.result); this.result = r; }
        this.result[n++] = ti;
      }
    }
    this.resultCount = n;
    return n;
  }

  // Closest point on triangle ti to point p. Writes into out[0..2].
  closestPointOnTri(ti, px, py, pz, out) {
    const t = this.tris, o = ti * 9;
    const ax = t[o], ay = t[o + 1], az = t[o + 2];
    const bx = t[o + 3], by = t[o + 4], bz = t[o + 5];
    const cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return; }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w; return;
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom, w = vc * denom;
    out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
  }

  /*
   Resolve a vertical capsule (feet at pos, total height h, radius r) out of the world geometry.
   pos: {x,y,z} mutated. contacts: Float32Array(3*N) receives push normals; returns contact count.
  */
  resolveCapsule(pos, h, r, contacts, maxContacts = 16) {
    const cp = _cp, rp = _rp;
    let nc = 0;
    for (let iter = 0; iter < 4; iter++) {
      const n = this.queryBox(pos.x - r - 1, pos.y - 1, pos.z - r - 1, pos.x + r + 1, pos.y + h + 1, pos.z + r + 1);
      let moved = false;
      for (let k = 0; k < n; k++) {
        const ti = this.result[k];
        const ay = pos.y + r; // bottom sphere centre (re-evaluated after every push)
        const by = pos.y + h - r; // top sphere centre
        const N = this.normals;
        const nx = N[ti * 3], ny = N[ti * 3 + 1], nz = N[ti * 3 + 2];
        const t = this.tris, o = ti * 9;
        // reference point: intersection of capsule axis with tri plane (or a vertex if parallel)
        let refx, refy, refz;
        if (Math.abs(ny) > 1e-4) {
          const tt = (nx * (t[o] - pos.x) + ny * (t[o + 1] - ay) + nz * (t[o + 2] - pos.z)) / ny;
          this.closestPointOnTri(ti, pos.x, ay + tt, pos.z, rp);
          refx = rp[0]; refy = rp[1]; refz = rp[2];
        } else { refx = t[o]; refy = t[o + 1]; refz = t[o + 2]; this.closestPointOnTri(ti, pos.x, clampf(refy, ay, by), pos.z, rp); refy = rp[1]; }
        const cy = clampf(refy, ay, by);
        this.closestPointOnTri(ti, pos.x, cy, pos.z, cp);
        let dx = pos.x - cp[0], dy = cy - cp[1], dz = pos.z - cp[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-5) { dx = nx; dy = ny; dz = nz; d = 1; } else { dx /= d; dy /= d; dz /= d; }
        // Ignore contacts from the back side of single-sided geometry when deeply inside.
        if (dx * nx + dy * ny + dz * nz < -0.2 && d < r * 0.5) continue;
        const pen = r - (d === 1 && d2 < 1e-10 ? 0 : Math.sqrt(d2));
        pos.x += dx * pen; pos.y += dy * pen; pos.z += dz * pen;
        moved = true;
        if (nc < maxContacts) { contacts[nc * 3] = dx; contacts[nc * 3 + 1] = dy; contacts[nc * 3 + 2] = dz; nc++; }
      }
      if (!moved) break;
    }
    return nc;
  }

  // True if capsule overlaps geometry (no resolution)
  capsuleOverlaps(px, py, pz, h, r) {
    const cp = _cp;
    const n = this.queryBox(px - r, py, pz - r, px + r, py + h, pz + r);
    const ay = py + r, by = py + h - r;
    for (let k = 0; k < n; k++) {
      const ti = this.result[k];
      for (let s = 0; s <= 4; s++) {
        const cy = ay + (by - ay) * (s / 4);
        this.closestPointOnTri(ti, px, cy, pz, cp);
        const dx = px - cp[0], dy = cy - cp[1], dz = pz - cp[2];
        if (dx * dx + dy * dy + dz * dz < r * r * 0.98) return true;
      }
    }
    return false;
  }

  // Möller–Trumbore against one triangle; returns t or -1
  rayTri(ti, ox, oy, oz, dx, dy, dz) {
    const t = this.tris, o = ti * 9;
    const e1x = t[o + 3] - t[o], e1y = t[o + 4] - t[o + 1], e1z = t[o + 5] - t[o + 2];
    const e2x = t[o + 6] - t[o], e2y = t[o + 7] - t[o + 1], e2z = t[o + 8] - t[o + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-7 && det < 1e-7) return -1;
    const inv = 1 / det;
    const sx = ox - t[o], sy = oy - t[o + 1], sz = oz - t[o + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return tt > 1e-4 ? tt : -1;
  }

  /*
   Raycast using 3D-DDA through the hash grid. dir must be normalized.
   Returns distance (Infinity if none); fills hit {t, nx, ny, nz, tri, x, y, z}.
  */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, hit) {
    const s = this._nextStamp();
    let best = Infinity, bestTri = -1;
    let ix = Math.floor(ox * INV), iy = Math.floor(oy * INV), iz = Math.floor(oz * INV);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(CELL / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / Math.abs(dx)) : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? (iy + 1) * CELL - oy : oy - iy * CELL) / Math.abs(dy)) : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (iz + 1) * CELL - oz : oz - iz * CELL) / Math.abs(dz)) : Infinity;
    let tCur = 0;
    let guard = 0;
    while (tCur <= maxDist && guard++ < 512) {
      const cell = this.grid.get(key(ix, iy, iz));
      if (cell) {
        for (let i = 0; i < cell.length; i++) {
          const ti = cell[i];
          if (this.stamp[ti] === s) continue;
          this.stamp[ti] = s;
          const tt = this.rayTri(ti, ox, oy, oz, dx, dy, dz);
          if (tt > 0 && tt < best && tt <= maxDist) { best = tt; bestTri = ti; }
        }
      }
      const tNext = Math.min(tMaxX, tMaxY, tMaxZ);
      if (best <= tNext) break;
      tCur = tNext;
      if (tMaxX === tNext) { ix += stepX; tMaxX += tDeltaX; }
      else if (tMaxY === tNext) { iy += stepY; tMaxY += tDeltaY; }
      else { iz += stepZ; tMaxZ += tDeltaZ; }
      // early out if we left world bounds
      if (ox + dx * tCur < this.min[0] - CELL || ox + dx * tCur > this.max[0] + CELL ||
          oy + dy * tCur < this.min[1] - CELL || oy + dy * tCur > this.max[1] + CELL ||
          oz + dz * tCur < this.min[2] - CELL || oz + dz * tCur > this.max[2] + CELL) break;
    }
    if (hit) {
      hit.t = best; hit.tri = bestTri;
      if (bestTri >= 0) {
        let nx = this.normals[bestTri * 3], ny = this.normals[bestTri * 3 + 1], nz = this.normals[bestTri * 3 + 2];
        if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
        hit.nx = nx; hit.ny = ny; hit.nz = nz;
        hit.x = ox + dx * best; hit.y = oy + dy * best; hit.z = oz + dz * best;
        hit.thin = this.flags[bestTri] & 1;
      }
    }
    return best;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-3) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.5, null) === Infinity;
  }

  // Drop a point onto the floor below it (returns y or null)
  groundHeight(x, y, z, maxDrop = 4096) {
    const t = this.raycast(x, y, z, 0, -1, 0, maxDrop, _hit);
    return t === Infinity ? null : y - t;
  }
}
const _cp = new Float64Array(3);
const _rp = new Float64Array(3);
const _hit = {};
const clampf = (v, a, b) => (v < a ? a : v > b ? b : v);
