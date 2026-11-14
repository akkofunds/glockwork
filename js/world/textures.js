// Procedural canvas textures (no texture downloads). Size scales with the graphics preset.
import * as THREE from 'three';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function noiseLayer(ctx, size, cells, alpha, light, dark, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const [nc, nctx] = canvas(cells);
  const img = nctx.createImageData(cells, cells);
  for (let i = 0; i < cells * cells; i++) {
    const v = rnd();
    const col = v > 0.5 ? light : dark;
    img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = Math.abs(v - 0.5) * 2 * 255 * alpha;
  }
  nctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(nc, 0, 0, size, size);
}

function speckle(ctx, size, count, colors, maxR, seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.globalAlpha = 0.15 + rnd() * 0.35;
    const r = 0.5 + rnd() * maxR;
    ctx.fillRect(rnd() * size, rnd() * size, r, r);
  }
  ctx.globalAlpha = 1;
}

function finish(c, renderer, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function makeTextures(renderer, quality) {
  const S = quality === 'low' ? 256 : 512;
  const T = {};

  // Sand ground
  {
    const [c, x] = canvas(S);
    x.fillStyle = '#d6b88a'; x.fillRect(0, 0, S, S);
    noiseLayer(x, S, 32, 0.35, [236, 210, 165], [170, 140, 100], 2);
    noiseLayer(x, S, 128, 0.25, [240, 220, 180], [160, 130, 95], 5);
    speckle(x, S, S * 6, ['#8f7350', '#f2dfb8', '#a88a62'], 2.2, 11);
    // footprint-like ripples
    x.globalAlpha = 0.08; x.strokeStyle = '#7a5f3e';
    for (let i = 0; i < 14; i++) { x.beginPath(); x.moveTo(0, (i / 14) * S + 6); x.bezierCurveTo(S * 0.3, (i / 14) * S - 6, S * 0.6, (i / 14) * S + 10, S, (i / 14) * S); x.stroke(); }
    x.globalAlpha = 1;
    T.sand = finish(c, renderer);
  }
  // Sandstone block wall
  {
    const [c, x] = canvas(S);
    x.fillStyle = '#cdaa78'; x.fillRect(0, 0, S, S);
    noiseLayer(x, S, 64, 0.3, [230, 205, 160], [150, 120, 85], 7);
    const rows = 6, bh = S / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (S / 6);
      for (let b = -1; b < 4; b++) {
        const bx = b * (S / 3) + off;
        const tone = 0.9 + ((r * 7 + b * 13) % 5) * 0.035;
        x.fillStyle = `rgba(${Math.round(205 * tone)},${Math.round(170 * tone)},${Math.round(120 * tone)},0.55)`;
        x.fillRect(bx + 3, r * bh + 3, S / 3 - 6, bh - 6);
      }
      x.fillStyle = 'rgba(95,72,45,0.55)'; x.fillRect(0, r * bh, S, 3);
      for (let b = -1; b < 4; b++) x.fillRect(b * (S / 3) + off, r * bh, 3, bh);
    }
    speckle(x, S, S * 4, ['#6e5535', '#e8d2a8'], 2, 17);
    T.wall = finish(c, renderer);
  }
  // Plaster
  {
    const [c, x] = canvas(S);
    x.fillStyle = '#e0cfae'; x.fillRect(0, 0, S, S);
    noiseLayer(x, S, 16, 0.25, [245, 232, 205], [185, 160, 125], 9);
    noiseLayer(x, S, 96, 0.18, [250, 240, 220], [170, 145, 110], 13);
    // exposed brick patches
    x.fillStyle = 'rgba(160,100,70,0.35)';
    for (let i = 0; i < 3; i++) {
      const px = (i * 0.31 + 0.1) * S, py = (i * 0.27 + 0.2) * S;
      for (let k = 0; k < 4; k++) x.fillRect(px + (k % 2) * 14, py + k * 10, 26, 7);
    }
    x.strokeStyle = 'rgba(90,70,50,0.35)'; x.lineWidth = 1;
    for (let i = 0; i < 6; i++) { x.beginPath(); let px = (i * 0.17) * S, py = (i * 0.29 % 1) * S; x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += 10 - ((i + k) % 3) * 8; py += 9; x.lineTo(px, py); } x.stroke(); }
    T.plaster = finish(c, renderer);
  }
  // Wooden crate
  {
    const [c, x] = canvas(S);
    x.fillStyle = '#8b6439'; x.fillRect(0, 0, S, S);
    const planks = 5;
    for (let i = 0; i < planks; i++) {
      x.fillStyle = i % 2 ? '#93693c' : '#835c33';
      x.fillRect(0, (i / planks) * S, S, S / planks - 2);
      x.strokeStyle = 'rgba(60,38,18,0.35)';
      for (let g = 0; g < 8; g++) { x.beginPath(); x.moveTo(0, (i / planks) * S + g * 6 + 3); x.lineTo(S, (i / planks) * S + g * 6 + 1 + (g % 3)); x.stroke(); }
    }
    const fw = S * 0.1;
    x.fillStyle = '#6b4724'; x.fillRect(0, 0, S, fw); x.fillRect(0, S - fw, S, fw); x.fillRect(0, 0, fw, S); x.fillRect(S - fw, 0, fw, S);
    x.save(); x.translate(S / 2, S / 2); x.rotate(Math.PI / 4); x.fillRect(-S * 0.72, -fw / 2, S * 1.44, fw); x.restore();
    x.fillStyle = '#3c3c3c';
    for (const [px, py] of [[fw / 2, fw / 2], [S - fw / 2, fw / 2], [fw / 2, S - fw / 2], [S - fw / 2, S - fw / 2]]) { x.beginPath(); x.arc(px, py, 4, 0, 7); x.fill(); }
    T.wood = finish(c, renderer);
  }
  // Painted metal
  {
    const [c, x] = canvas(S);
    x.fillStyle = '#4f6a63'; x.fillRect(0, 0, S, S);
    noiseLayer(x, S, 64, 0.25, [110, 140, 130], [40, 55, 50], 21);
    x.strokeStyle = 'rgba(20,30,28,0.5)'; x.lineWidth = 4;
    for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(0, (i / 4) * S); x.lineTo(S, (i / 4) * S); x.stroke(); }
    speckle(x, S, S * 3, ['#b07a4a', '#8a5a35', '#d8c8a8'], 3, 23);
    T.metal = finish(c, renderer);
  }
  // Roof / concrete
  {
    const [c, x] = canvas(S);
    x.fillStyle = '#a39276'; x.fillRect(0, 0, S, S);
    noiseLayer(x, S, 48, 0.3, [190, 175, 150], [110, 95, 75], 31);
    speckle(x, S, S * 5, ['#5a4c3a', '#d6c6a6'], 2, 37);
    T.roof = finish(c, renderer);
  }
  // Floor tiles (bombsites, CT spawn)
  {
    const [c, x] = canvas(S);
    x.fillStyle = '#b39a77'; x.fillRect(0, 0, S, S);
    const n = 4, ts = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const tone = 0.88 + ((i * 3 + j * 5) % 4) * 0.04;
      x.fillStyle = `rgb(${Math.round(190 * tone)},${Math.round(165 * tone)},${Math.round(128 * tone)})`;
      x.fillRect(i * ts + 2, j * ts + 2, ts - 4, ts - 4);
    }
    noiseLayer(x, S, 64, 0.22, [220, 200, 170], [120, 100, 75], 41);
    T.tile = finish(c, renderer);
  }
  T.letter = (ch, color = '#c0392b') => {
    const [c, x] = canvas(256);
    x.clearRect(0, 0, 256, 256);
    x.font = 'bold 210px Impact, Arial Black, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = color; x.globalAlpha = 0.85;
    x.fillText(ch, 128, 140);
    // stencil wear
    x.globalCompositeOperation = 'destination-out';
    speckle(x, 256, 900, ['#000'], 3, ch.charCodeAt(0));
    x.globalCompositeOperation = 'source-over';
    const t = finish(c, renderer, false);
    return t;
  };
  return T;
}
