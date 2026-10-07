// Lush, layered trees for the Focus views. Each design is painted once into a
// sprite (leafy clumps in several shades, leaf texture, a solid trunk that runs
// up into the foliage) and reused, so the detail costs almost nothing per frame.
// Sprites are repainted when the season changes (autumn colour, snow).
import { hash, mulberry32 } from './rng.js';
import { OL, mixHex, season, mipFor } from './toon.js';

// dark, mid, light, highlight
const LEAF = [
  ['#1f4a3a', '#2f7a4a', '#5fae4a', '#a8d65a'], // green
  ['#1d3f5a', '#28707a', '#3fa39a', '#86dcc4'], // teal
  ['#2a2f6e', '#344f96', '#4a82ad', '#86c4cc'], // blue
  ['#2c4a2a', '#4f7a32', '#86a83a', '#cbd85c'], // olive
  ['#43286a', '#74408f', '#a95fae', '#e3a0d8'], // blossom
];
const WEIGHTS = [0.34, 0.26, 0.16, 0.18, 0.06];
const AUTUMN = [
  ['#5a2418', '#a8402a', '#e0702f', '#f6b44a'],
  ['#5a3a14', '#a8701e', '#e0a52a', '#f6d75a'],
];
const PINE = [
  ['#183f30', '#2a6b3e', '#4f9a3c', '#93c94a'],
  ['#173a40', '#245f55', '#3f8a63', '#7fc08a'],
];
const TRUNK = ['#7a3a3a', '#562535', '#a0584a'];
const SHAPES = 3;

const cache = new Map();
let cacheKey = '';

function pick(h) {
  let acc = 0;
  for (let i = 0; i < WEIGHTS.length; i++) { acc += WEIGHTS[i]; if (h < acc) return i; }
  return 0;
}

function leafColors(variant) {
  const base = LEAF[variant];
  const fall = AUTUMN[variant % 2];
  const a = variant === 4 ? season.autumn * 0.3 : season.autumn * 0.9; // blossom keeps its colour
  return base.map((c, i) => mixHex(mixHex(c, fall[i], a), '#e8eef6', season.snow * (i === 3 ? 0.4 : 0.15)));
}

function circle(x, cx, cy, r) { x.moveTo(cx + r, cy); x.arc(cx, cy, r, 0, Math.PI * 2); }

// A sturdy trunk with flared roots, grooved bark, a knot or two, branches that
// fork up into the crown, and a few tufts of grass at its foot.
function paintTrunk(x, cx, gY, topY, wBase, wTop, r, { branches = true } = {}) {
  const hgt = gY - topY;
  // soft shadow on the ground
  x.fillStyle = 'rgba(25,20,60,0.28)';
  x.beginPath(); x.ellipse(cx, gY, wBase * 2.3, wBase * 0.42, 0, 0, Math.PI * 2); x.fill();

  // branches first, so the trunk and crown sit over their bases
  if (branches) {
    x.lineCap = 'round';
    for (const side of [-1, 1]) {
      // fork just below the crown so the branches show before vanishing into the leaves
      const by = topY + hgt * (0.4 + r() * 0.08), len = 38 + r() * 18;
      const ex = cx + side * (wTop + len), ey = by - len * (0.5 + r() * 0.25);
      const bend = () => { x.beginPath(); x.moveTo(cx + side * wTop * 0.3, by + 10); x.quadraticCurveTo(cx + side * (wTop + len * 0.35), by - len * 0.1, ex, ey); };
      bend(); x.strokeStyle = OL; x.lineWidth = 13; x.stroke();
      bend(); x.strokeStyle = side < 0 ? TRUNK[0] : TRUNK[1]; x.lineWidth = 8; x.stroke();
      // a twig off each branch
      const tx = cx + side * (wTop + len * 0.55), ty = by - len * 0.35;
      x.beginPath(); x.moveTo(tx, ty); x.lineTo(tx + side * 12, ty - 16);
      x.strokeStyle = OL; x.lineWidth = 8; x.stroke();
      x.strokeStyle = side < 0 ? TRUNK[0] : TRUNK[1]; x.lineWidth = 4; x.stroke();
    }
  }

  // trunk with roots flaring out at the base
  const rootL = wBase * (1.7 + r() * 0.3), rootR = wBase * (1.7 + r() * 0.3);
  const path = () => {
    x.beginPath();
    x.moveTo(cx - wTop, topY);
    x.quadraticCurveTo(cx - wTop * 0.85, gY - hgt * 0.35, cx - wBase, gY - wBase * 0.9);
    // left roots
    x.quadraticCurveTo(cx - wBase * 1.15, gY - 3, cx - rootL, gY + 1);
    x.quadraticCurveTo(cx - wBase * 0.9, gY + 3, cx - wBase * 0.55, gY - 1);
    x.quadraticCurveTo(cx - wBase * 0.45, gY + 5, cx - wBase * 0.15, gY + 3);
    // right roots
    x.quadraticCurveTo(cx + wBase * 0.3, gY + 5, cx + wBase * 0.6, gY);
    x.quadraticCurveTo(cx + wBase * 0.95, gY + 3, cx + rootR, gY + 1);
    x.quadraticCurveTo(cx + wBase * 1.15, gY - 3, cx + wBase, gY - wBase * 0.9);
    x.quadraticCurveTo(cx + wTop * 0.85, gY - hgt * 0.35, cx + wTop, topY);
    x.closePath();
  };
  path(); x.fillStyle = TRUNK[0]; x.fill();
  x.save(); path(); x.clip();
  // shaded right side and a lit edge down the left
  x.fillStyle = TRUNK[1];
  x.beginPath(); x.moveTo(cx + wTop * 0.2, topY - 2); x.quadraticCurveTo(cx + wBase * 0.15, gY - hgt * 0.4, cx + wBase * 0.35, gY + 6); x.lineTo(cx + rootR + 4, gY + 6); x.lineTo(cx + wTop + 10, topY - 2); x.closePath(); x.fill();
  x.strokeStyle = TRUNK[2]; x.lineWidth = 3.5; x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx - wTop * 0.55, topY + 4); x.quadraticCurveTo(cx - wBase * 0.6, gY - hgt * 0.35, cx - wBase * 0.75, gY - 6); x.stroke();
  // grooved bark: wavy vertical lines, some broken, darker on the shaded side
  for (let i = 0; i < 6; i++) {
    const f = (i + 0.5) / 6 - 0.5; // across the trunk
    const segs = 3 + Math.floor(r() * 2);
    x.strokeStyle = f > 0.05 ? 'rgba(25,10,30,0.45)' : 'rgba(40,15,30,0.32)';
    x.lineWidth = 2;
    let y = topY + r() * 10;
    for (let k = 0; k < segs && y < gY - 6; k++) {
      const len = 14 + r() * 26;
      const wy0 = wTop + (wBase - wTop) * ((y - topY) / hgt);
      const wy1 = wTop + (wBase - wTop) * Math.min(1, (y + len - topY) / hgt);
      x.beginPath();
      x.moveTo(cx + f * wy0 * 1.7, y);
      x.quadraticCurveTo(cx + f * (wy0 + wy1) * 0.85 + (r() - 0.5) * 4, y + len / 2, cx + f * wy1 * 1.7, y + len);
      x.stroke();
      y += len + 4 + r() * 10;
    }
  }
  // a knot with a lighter rim
  if (hgt > 70) {
    const ky = topY + hgt * (0.35 + r() * 0.3), kx = cx + (r() - 0.6) * wTop * 0.8;
    x.fillStyle = 'rgba(25,10,30,0.55)';
    x.beginPath(); x.ellipse(kx, ky, 4.5, 6.5, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = TRUNK[2]; x.lineWidth = 1.6;
    x.beginPath(); x.ellipse(kx, ky, 6.5, 8.5, 0, Math.PI * 0.9, Math.PI * 1.8); x.stroke();
  }
  x.restore();
  path(); x.lineWidth = 4; x.strokeStyle = OL; x.lineJoin = 'round'; x.stroke();

  // tufts of grass (or snow) at its foot
  const tuft = mixHex('#4f9a3a', '#f4f8fd', season.snow * 0.9);
  const tuftHi = mixHex('#7cc04a', '#ffffff', season.snow * 0.9);
  for (const tx of [cx - rootL - 4, cx - wBase * 0.3, cx + rootR + 2]) {
    const th = 8 + r() * 6;
    x.beginPath();
    x.moveTo(tx - 7, gY + 3); x.lineTo(tx - 4, gY - th); x.lineTo(tx - 1, gY - 1); x.lineTo(tx + 2, gY - th - 3); x.lineTo(tx + 4, gY - 1); x.lineTo(tx + 7, gY - th + 2); x.lineTo(tx + 8, gY + 3);
    x.closePath();
    x.fillStyle = tuft; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
    x.strokeStyle = tuftHi; x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(tx - 4, gY - th + 3); x.lineTo(tx - 3, gY - 2); x.stroke();
  }
}

function paintBroadleaf(variant, shape) {
  const W = 300, H = 330, gY = 318, cx = W / 2;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const r = mulberry32(variant * 131 + shape * 17 + 7);
  const [dark, mid, light, hi] = leafColors(variant);
  const cyC = 136, RX = 108, RY = 80;
  paintTrunk(x, cx, gY, cyC + 30, 22, 14, r);

  // canopy: a dome of leafy clumps
  const clumps = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = -Math.PI / 2 + (i / N) * Math.PI * 2 + (r() - 0.5) * 0.3;
    const below = Math.sin(a) > 0;
    clumps.push([cx + Math.cos(a) * RX * (0.78 + r() * 0.1), cyC + Math.sin(a) * RY * (below ? 0.62 : 0.95), 30 + r() * 14]);
  }
  for (let i = 0; i < 5; i++) clumps.push([cx + (r() - 0.5) * RX * 0.9, cyC + (r() - 0.6) * RY * 0.8, 34 + r() * 12]);
  // backing so no sky shows between clumps (only in the outline and the dark base)
  const backing = [[cx, cyC, RY * 0.95], [cx - RX * 0.4, cyC + 6, RY * 0.7], [cx + RX * 0.4, cyC + 6, RY * 0.7]];
  const union = () => { x.beginPath(); for (const [px, py, pr] of [...clumps, ...backing]) circle(x, px, py, pr); };

  union(); x.strokeStyle = OL; x.lineWidth = 9; x.stroke();
  union(); x.fillStyle = dark; x.fill();
  x.save(); union(); x.clip();
  // mid tone, lifted up and left so the undersides stay dark
  x.beginPath(); for (const [px, py, pr] of clumps) circle(x, px - pr * 0.1, py - pr * 0.16, pr * 0.88); x.fillStyle = mid; x.fill();
  // light tops on the upper clumps
  x.beginPath();
  for (const [px, py, pr] of clumps) if (py < cyC + 12) circle(x, px - pr * 0.2, py - pr * 0.3, pr * 0.62);
  x.fillStyle = light; x.fill();
  // foliage texture: little scalloped leaf edges in shadow, bright leaves where the light hits
  x.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    const lx = cx + Math.cos(a) * RX * d, ly = cyC + Math.sin(a) * RY * d * 0.95;
    const up = (cyC - ly) / RY - ((lx - cx) / RX) * 0.45; // how "lit" this spot is
    const sz = 6 + r() * 4;
    if (up < 0.15) {
      x.strokeStyle = up < -0.35 ? 'rgba(15,12,45,0.35)' : 'rgba(15,12,45,0.22)';
      x.lineWidth = 2.6;
      x.beginPath(); x.arc(lx, ly - sz * 0.4, sz, Math.PI * 0.15, Math.PI * 0.85); x.stroke();
    } else {
      x.fillStyle = up > 0.5 ? hi : light;
      x.save(); x.translate(lx, ly); x.rotate(-0.5 + (r() - 0.5) * 1.2);
      x.beginPath(); x.ellipse(0, 0, sz, sz * 0.45, 0, 0, Math.PI * 2); x.fill();
      x.restore();
    }
  }
  if (season.snow > 0.05) {
    // snow settles on the very top of the crown only
    x.fillStyle = `rgba(250,252,255,${Math.min(1, season.snow * 1.2)})`;
    x.beginPath();
    for (const [px, py, pr] of clumps) if (py < cyC - RY * 0.35) { x.moveTo(px + pr * 0.75, py - pr * 0.6); x.ellipse(px - pr * 0.05, py - pr * 0.62, pr * 0.75, pr * 0.24, 0, 0, Math.PI * 2); }
    x.fill();
  }
  x.restore();
  return { c, gY };
}

function paintPine(variant, shape) {
  const W = 270, H = 342, gY = 330, cx = W / 2;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const r = mulberry32(variant * 71 + shape * 29 + 3);
  const [dark, mid, light, hi] = PINE[variant].map((col, i) => mixHex(col, '#e8eef6', season.snow * (i === 3 ? 0.35 : 0.1)));
  paintTrunk(x, cx, gY, gY - 90, 14, 10, r, { branches: false });
  const tiers = 5;
  const tierInfo = [];
  for (let i = 0; i < tiers; i++) {
    const yb = gY - 58 - i * (40 + shape * 2), yt = yb - 84;
    const hw = 124 - i * 21 + (r() - 0.5) * 8;
    const tier = (scale, lift) => {
      const w = hw * scale, b = yb - lift, t = yt;
      x.beginPath();
      x.moveTo(cx, t);
      x.quadraticCurveTo(cx + w * 0.42, t + (b - t) * 0.4, cx + w, b + 6);
      const n = 8;
      for (let j = 1; j <= n; j++) {
        const px = cx + w - (j * 2 * w) / n;
        const py = b + (j % 2 ? -9 : 5) + Math.abs(px - cx) / w * 6;
        x.lineTo(px, py);
      }
      x.quadraticCurveTo(cx - w * 0.42, t + (b - t) * 0.4, cx, t);
      x.closePath();
    };
    tier(1, 0); x.fillStyle = dark; x.fill(); x.lineWidth = 4; x.strokeStyle = OL; x.lineJoin = 'round'; x.stroke();
    tier(0.84, 9); x.fillStyle = mid; x.fill();
    // fronds: brighter on the lit (left) side
    x.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (let f = 0; f < 5; f++) {
        const sx = cx + side * 3, sy = yt + 14 + f * 11;
        const ex = cx + side * hw * (0.36 + f * 0.12), ey = yb - 4 - f * 1.5;
        x.strokeStyle = side < 0 ? light : mixHex(mid, light, 0.45); x.lineWidth = 6;
        x.beginPath(); x.moveTo(sx, sy); x.quadraticCurveTo((sx + ex) / 2, sy + (ey - sy) * 0.15, ex, ey); x.stroke();
        if (side < 0) { x.strokeStyle = hi; x.lineWidth = 2; x.stroke(); }
      }
    }
    tierInfo.push({ yb, hw });
    if (season.snow > 0.05 && i === tiers - 1) {
      x.fillStyle = `rgba(250,252,255,${Math.min(1, season.snow * 1.2)})`;
      x.beginPath(); x.moveTo(cx, yt - 1);
      x.quadraticCurveTo(cx - hw * 0.2, yt + 18, cx - hw * 0.42, yt + 36);
      x.quadraticCurveTo(cx - hw * 0.15, yt + 28, cx, yt + 25);
      x.quadraticCurveTo(cx + hw * 0.15, yt + 28, cx + hw * 0.38, yt + 34);
      x.quadraticCurveTo(cx + hw * 0.2, yt + 18, cx, yt - 1);
      x.fill();
    }
  }
  if (season.snow > 0.05) {
    // snow pillows resting on the fronds of every tier
    x.globalAlpha = Math.min(1, season.snow * 1.2);
    // lumpy, uneven snow along each tier's boughs: clumps of varying size with gaps
    for (const { yb, hw } of tierInfo.slice(0, -1)) {
      const lx = cx - hw * (0.68 + r() * 0.2), rx = cx + hw * (0.66 + r() * 0.2);
      const sag = 16 + r() * 12, midX = cx + (r() - 0.5) * hw * 0.25;
      // points along a curve that sags from the middle down to each side
      const n = 12, pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = t < 0.5 ? lx + (midX - lx) * (t / 0.5) : midX + (rx - midX) * ((t - 0.5) / 0.5);
        const edge = Math.abs(t - 0.5) * 2;
        pts.push([px, yb - 2 - sag * (1 - edge * edge) + (r() - 0.5) * 5, edge]);
      }
      // one continuous band, with an occasional gap
      const gap = r() < 0.6 ? 2 + Math.floor(r() * (n - 4)) : -1;
      const runs = [pts.slice(0, gap > 0 ? gap : pts.length), gap > 0 ? pts.slice(gap + 1) : []].filter((run) => run.length > 1);
      // clumps heaped along the band, bigger in the middle
      const blobs = [];
      for (const [px, py, edge] of pts) if (r() < 0.55) blobs.push([px + (r() - 0.5) * 6, py - 2 - r() * 3, (3.5 + r() * 4) * (1.1 - edge * 0.5)]);
      for (const side of [-1, 1]) if (r() < 0.7) blobs.push([cx + side * hw * (0.84 + r() * 0.1), yb + 1 + r() * 3, 3 + r() * 2.5]);
      const band = (run) => { x.beginPath(); run.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); };
      x.lineCap = 'round'; x.lineJoin = 'round';
      for (const run of runs) { band(run); x.strokeStyle = 'rgba(43,33,64,0.6)'; x.lineWidth = 11; x.stroke(); }
      x.beginPath(); for (const [bx, by, br] of blobs) circle(x, bx, by, br + 1.4);
      x.fillStyle = 'rgba(43,33,64,0.6)'; x.fill();
      for (const run of runs) { band(run); x.strokeStyle = '#fbfdff'; x.lineWidth = 7.5; x.stroke(); }
      x.beginPath(); for (const [bx, by, br] of blobs) circle(x, bx, by, br);
      x.fillStyle = '#fbfdff'; x.fill();
      x.fillStyle = '#dbe8f6';
      x.beginPath(); for (const [bx, by, br] of blobs) circle(x, bx + br * 0.25, by + br * 0.35, br * 0.45); x.fill();
    }
    x.globalAlpha = 1;
  }
  return { c, gY };
}

// Draw a tree standing at (x, y), h pixels tall. kind 0 = pine, otherwise broadleaf.
export function drawTree(ctx, x, y, h, kind, seed) {
  if (h < 2) return;
  const pine = kind === 0;
  if (h < 9) {
    // too small for detail: one simple shape
    ctx.fillStyle = pine ? PINE[0][1] : leafColors(pick(hash(seed, 5)))[1];
    ctx.beginPath();
    if (pine) { ctx.moveTo(x, y - h); ctx.lineTo(x - h * 0.3, y); ctx.lineTo(x + h * 0.3, y); }
    else ctx.arc(x, y - h * 0.6, h * 0.36, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const k = `${Math.round(season.snow * 4)}:${Math.round(season.autumn * 4)}`;
  if (k !== cacheKey) { cache.clear(); cacheKey = k; }
  const variant = pine ? Math.floor(hash(seed, 5) * PINE.length) : pick(hash(seed, 5));
  const shape = Math.floor(hash(seed, 6) * SHAPES);
  const id = `${pine ? 'p' : 'b'}${variant}.${shape}`;
  let spr = cache.get(id);
  if (!spr) { spr = pine ? paintPine(variant, shape) : paintBroadleaf(variant, shape); cache.set(id, spr); }
  const scale = h / spr.gY;
  const w = spr.c.width * scale, fullH = spr.c.height * scale;
  // half the trees are mirrored, using a flipped copy made once
  let src = spr.c;
  if (hash(seed, 7) < 0.5) {
    if (!spr.flip) {
      const f = document.createElement('canvas');
      f.width = spr.c.width; f.height = spr.c.height;
      const fx = f.getContext('2d');
      fx.scale(-1, 1); fx.drawImage(spr.c, -f.width, 0);
      spr.flip = f;
    }
    src = spr.flip;
  }
  ctx.drawImage(mipFor(src, w), x - w / 2, y - h, w, fullH);
}
