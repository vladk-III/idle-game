// Painted landscape for the side-on views (trackside and passenger): towering
// cumulus clouds, a far mountain range with lit and shaded faces and snow,
// rock spires, layered hills with grassy edges and tree lines, meadow
// patches, and the aurora on clear winter nights. Art direction after
// CraftPix's pixel-art backgrounds (https://craftpix.net), redrawn in code.
//
// Each layer is painted once into a wide image that tiles seamlessly, then
// slid along with parallax each frame: a handful of image draws per frame.
import { mixHex, shade } from './toon.js';

const TW = 1400; // tile width in view units

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

const cache = new Map();
function tile(key, w, h, px, paint) {
  const k = `${key}|${px}`;
  let c = cache.get(k);
  if (!c) {
    if (cache.size > 24) cache.clear();
    c = document.createElement('canvas');
    c.width = Math.ceil(w * px); c.height = Math.ceil(h * px);
    const x = c.getContext('2d');
    x.scale(px, px);
    paint(x);
    cache.set(k, c);
  }
  return c;
}
function pxOf(ctx) { const t = ctx.getTransform(); return Math.min(2, Math.round(Math.hypot(t.a, t.b) * 2) / 2 || 1); }

// season tint for greens: autumn turns them gold, snow turns them white
function tint(col, season, snowAmt = 0.85) {
  return mixHex(mixHex(col, '#c9a54a', season.autumn * 0.5), '#eef4fb', season.snow * snowAmt);
}

// draw a horizontally tiling image so that it fills [x0, x1)
function slide(ctx, img, off, y, w, h, x0, x1) {
  const tw = w;
  let x = -(((off % tw) + tw) % tw) + x0;
  for (; x < x1; x += tw) ctx.drawImage(img, x, y, tw + 0.5, h);
}

// ---------- the far range: mountains and rock spires ----------
const MH = 240;
function paintMountains(c, season, seed) {
  const r = rng(seed);
  const lit = mixHex('#d8c2a6', '#e9edf5', season.snow * 0.6), dark = '#5d74ab', far = '#8ea4cf';
  const snow = '#f4f7fb', snowShade = '#b9cbe8';
  // a faint further range first
  c.fillStyle = far;
  c.beginPath(); c.moveTo(0, MH);
  for (let x = 0; x <= TW; x += 20) c.lineTo(x, MH - 70 - 30 * Math.sin((x / TW) * Math.PI * 6 + 1) - 14 * Math.sin((x / TW) * Math.PI * 14));
  c.lineTo(TW, MH); c.closePath(); c.fill();
  const peaks = [];
  let x = 60;
  while (x < TW - 40) { peaks.push({ x, h: 110 + r() * 120, w: 120 + r() * 140, spire: r() < 0.22 }); x += 170 + r() * 160; }
  for (const p of peaks) {
    for (const ox of [-TW, 0, TW]) {
      const cx = p.x + ox;
      if (cx + p.w < 0 || cx - p.w > TW) continue;
      if (p.spire) drawSpire(c, cx, p, r, season);
      else drawPeak(c, cx, p, lit, dark, snow, snowShade, season, seed + p.x);
    }
  }
  // haze at the foot so the hills sit in front
  const g = c.createLinearGradient(0, MH - 70, 0, MH);
  g.addColorStop(0, 'rgba(170,205,230,0)'); g.addColorStop(1, 'rgba(170,205,230,0.75)');
  c.fillStyle = g; c.fillRect(0, MH - 70, TW, 70);
}
function drawPeak(c, cx, p, lit, dark, snow, snowShade, season, seed) {
  const r = rng(seed | 0);
  const top = MH - p.h, L = cx - p.w, R = cx + p.w;
  // jagged outline: left ridge, summit, right ridge
  const left = [[L, MH]], right = [];
  for (let i = 1; i < 6; i++) { const t = i / 6; left.push([L + (cx - L) * t + (r() - 0.5) * 12, MH - p.h * t * (0.85 + r() * 0.15)]); }
  for (let i = 5; i > 0; i--) { const t = i / 6; right.push([R - (R - cx) * t + (r() - 0.5) * 12, MH - p.h * t * (0.8 + r() * 0.15)]); }
  const poly = [...left, [cx, top], ...right, [R, MH]];
  c.fillStyle = dark; c.beginPath(); poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
  // the sunlit side: from the summit down to a crease right of centre
  const crease = cx + p.w * (0.08 + r() * 0.12);
  c.fillStyle = lit; c.beginPath(); c.moveTo(L, MH); left.forEach(([x, y]) => c.lineTo(x, y)); c.lineTo(cx, top);
  c.lineTo(cx + p.w * 0.05, top + p.h * 0.3); c.lineTo(crease, MH); c.closePath(); c.fill();
  // facets: darker and lighter wedges on the lit face
  for (let i = 0; i < 7; i++) {
    const fy = top + p.h * (0.25 + r() * 0.65), fx = L + (cx - L) * (0.3 + r() * 0.8);
    c.fillStyle = r() < 0.5 ? shade(lit, -0.12) : shade(lit, 0.08);
    c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + 8 + r() * 18, fy + 22 + r() * 30); c.lineTo(fx - 6 - r() * 10, fy + 26 + r() * 30); c.closePath(); c.fill();
  }
  // snow on the upper slopes (more in winter)
  const sl = 0.3 + season.snow * 0.35;
  c.fillStyle = snow; c.beginPath(); c.moveTo(cx, top);
  for (let i = 0; i <= 5; i++) { const t = i / 5; c.lineTo(cx - p.w * sl * t + (i % 2 ? 6 : -4), top + p.h * sl * (t * 0.95) + (i % 2 ? 10 : 0)); }
  c.lineTo(cx + p.w * 0.05, top + p.h * 0.3); c.closePath(); c.fill();
  c.fillStyle = snowShade; c.beginPath(); c.moveTo(cx, top);
  for (let i = 0; i <= 5; i++) { const t = i / 5; c.lineTo(cx + p.w * sl * t * 0.9 + (i % 2 ? -5 : 4), top + p.h * sl * t + (i % 2 ? 12 : 0)); }
  c.lineTo(cx + p.w * 0.05, top + p.h * 0.3); c.closePath(); c.fill();
  // patches of forest low down
  c.fillStyle = tint('#5f8a3a', season, 0.6);
  for (let i = 0; i < 5; i++) {
    const fx = L + p.w * 2 * (0.15 + r() * 0.7), fy = MH - p.h * (0.12 + r() * 0.22), fw = 20 + r() * 40;
    c.beginPath(); c.moveTo(fx - fw, fy + 8); c.lineTo(fx - fw * 0.4, fy - 6); c.lineTo(fx + fw * 0.5, fy - 2); c.lineTo(fx + fw, fy + 10); c.closePath(); c.fill();
  }
}
function drawSpire(c, cx, p, r, season) {
  // a cluster of chunky weathered rock stacks with uneven tops
  const cols = [['#9a96a8', '#6e6152'], ['#a8a2b0', '#7a6c5c']];
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const w = 46 + r() * 44, h = p.h * (0.32 + r() * 0.3), x = cx - p.w * 0.45 + i * (p.w * 0.9 / n) + r() * 14;
    const [lit, dark] = cols[i % 2];
    const outline = [[x - w * 0.55, MH], [x - w * 0.48, MH - h * 0.7], [x - w * 0.3, MH - h * 0.96], [x - w * 0.05, MH - h], [x + w * 0.22, MH - h * 0.9], [x + w * 0.42, MH - h * 0.62], [x + w * 0.55, MH]];
    c.fillStyle = dark;
    c.beginPath(); outline.forEach(([px, py], k) => (k ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath(); c.fill();
    // the sunlit left part, with a few ledges
    c.fillStyle = lit;
    c.beginPath(); c.moveTo(x - w * 0.55, MH); c.lineTo(x - w * 0.48, MH - h * 0.7); c.lineTo(x - w * 0.3, MH - h * 0.96); c.lineTo(x - w * 0.05, MH - h);
    c.lineTo(x + w * 0.02, MH - h * 0.55); c.lineTo(x - w * 0.08, MH); c.closePath(); c.fill();
    c.fillStyle = shade(lit, 0.1);
    for (let k = 0; k < 3; k++) { const yy = MH - h * (0.25 + r() * 0.6); c.beginPath(); c.moveTo(x - w * 0.46, yy); c.lineTo(x - w * 0.1, yy - 4); c.lineTo(x - w * 0.12, yy + 3); c.closePath(); c.fill(); }
    c.fillStyle = shade(dark, -0.12);
    c.beginPath(); c.moveTo(x + w * 0.2, MH - h * 0.85); c.lineTo(x + w * 0.32, MH - h * 0.3); c.lineTo(x + w * 0.24, MH - h * 0.28); c.closePath(); c.fill();
    // grass creeping up the foot
    c.fillStyle = tint('#5f8a3a', season, 0.6);
    c.beginPath(); c.moveTo(x - w * 0.6, MH); c.quadraticCurveTo(x, MH - h * 0.22, x + w * 0.6, MH); c.closePath(); c.fill();
    if (season.snow > 0.3) { c.fillStyle = '#f4f7fb'; c.beginPath(); c.moveTo(x - w * 0.3, MH - h * 0.96); c.lineTo(x - w * 0.05, MH - h); c.lineTo(x + w * 0.22, MH - h * 0.9); c.lineTo(x - w * 0.05, MH - h * 0.88); c.closePath(); c.fill(); }
  }
}

// ---------- rolling hills with a grassy edge ----------
const HH = 120;
function grassEdge(c, pts, col) {
  // a tufty top edge: tiny spikes along the outline
  c.fillStyle = col;
  c.beginPath(); c.moveTo(0, HH);
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    c.lineTo(x, y);
    if (i % 2 === 0) { c.lineTo(x + 2, y - 4); c.lineTo(x + 4, y); }
  }
  c.lineTo(TW, HH); c.closePath(); c.fill();
}
function hillLine(seed, base, amp, f1, f2) {
  const pts = [];
  for (let x = 0; x <= TW; x += 6) {
    const t = (x / TW) * Math.PI * 2;
    pts.push([x, base - amp * (0.55 * Math.sin(t * f1 + seed) + 0.3 * Math.sin(t * f2 + seed * 2.3) + 0.15 * Math.sin(t * (f2 + 3) + seed))]);
  }
  return pts;
}
function paintFarHills(c, season, seed) {
  const r = rng(seed);
  const pts = hillLine(seed % 7, 60, 26, 2, 5);
  grassEdge(c, pts, tint('#78b8a0', season));
  // a tree line along the crest
  c.fillStyle = tint('#4f8f78', season, 0.5);
  for (let x = 0; x < TW; x += 9 + r() * 14) {
    if (r() < 0.35) continue;
    const y = pts[Math.min(pts.length - 1, Math.round(x / 6))][1] + 4, h = 10 + r() * 14;
    c.beginPath(); c.moveTo(x - h * 0.3, y); c.lineTo(x, y - h); c.lineTo(x + h * 0.3, y); c.closePath(); c.fill();
  }
  // lighter fields
  c.fillStyle = tint('#93c9ae', season);
  for (let i = 0; i < 9; i++) { const x = r() * TW, y = 78 + r() * 30, w = 60 + r() * 120; c.beginPath(); c.ellipse(x, y, w, 5 + r() * 5, 0, 0, Math.PI * 2); c.fill(); }
}
function paintNearHills(c, season, seed) {
  const r = rng(seed);
  const pts = hillLine(seed % 5 + 1, 70, 22, 3, 7);
  grassEdge(c, pts, tint('#5aa85a', season));
  // sunny patches and darker hollows
  for (let i = 0; i < 14; i++) {
    const x = r() * TW, y = 82 + r() * 34, w = 40 + r() * 110;
    c.fillStyle = i % 3 ? tint('#8cc95c', season) : tint('#4b9550', season);
    c.beginPath(); c.ellipse(x, y, w, 4 + r() * 5, 0, 0, Math.PI * 2); c.fill();
  }
  // round bushes sitting on the crest
  for (let x = 30; x < TW - 30; x += 70 + r() * 140) {
    const y = pts[Math.round(x / 6)][1] + 6, s = 10 + r() * 12;
    c.fillStyle = tint('#3f8a4a', season, 0.6);
    for (const [dx, dy, rr] of [[-s * 0.6, 0, s * 0.7], [s * 0.5, 1, s * 0.75], [0, -s * 0.4, s]]) { c.beginPath(); c.arc(x + dx, y + dy, rr, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = tint('#6cbf5a', season, 0.6);
    c.beginPath(); c.arc(x - s * 0.25, y - s * 0.6, s * 0.5, 0, Math.PI * 2); c.fill();
  }
}

// ---------- towering cumulus ----------
function paintCumulus(c, w, h, seed) {
  const r = rng(seed);
  const base = h * 0.86;
  const blobs = [];
  // a flat-bottomed heap: wide at the base, a tower in the middle
  for (let i = 0; i < 26; i++) {
    const t = r(), tower = Math.exp(-((t - 0.5) ** 2) / 0.04);
    const x = w * (0.1 + t * 0.8), rr = 18 + r() * 26 + tower * 22;
    const y = base - rr * 0.6 - tower * (h * 0.5) * r();
    blobs.push([x, Math.min(base - rr * 0.4, y), rr]);
  }
  const draw = (col, dx, dy, k) => { c.fillStyle = col; for (const [x, y, rr] of blobs) { c.beginPath(); c.arc(x + dx * rr, y + dy * rr, rr * k, 0, Math.PI * 2); c.fill(); } };
  c.save();
  c.beginPath(); c.rect(0, 0, w, base + 2); c.clip();
  draw('#8fb2d6', 0, 0.08, 1.0);          // shadowed underside
  draw('#c3d6ea', -0.06, -0.06, 0.92);    // mid
  draw('#e9f0f5', -0.14, -0.16, 0.74);    // lit tops
  draw('#ffffff', -0.2, -0.24, 0.45);     // brightest
  c.restore();
  // cool blue shadow along the flat base
  c.fillStyle = 'rgba(111,184,224,0.55)';
  c.beginPath(); c.ellipse(w * 0.5, base - 4, w * 0.38, 6, 0, 0, Math.PI * 2); c.fill();
}

// ---------- the aurora ----------
function drawAurora(ctx, W, top, bottom, t, amt) {
  ctx.globalAlpha = amt;
  for (let band = 0; band < 3; band++) {
    const y0 = top + (bottom - top) * (0.15 + band * 0.22);
    for (let x = -10; x < W + 10; x += 6) {
      const k = x / W;
      const y = y0 + Math.sin(k * 5 + t * 0.12 + band * 2) * 26 + Math.sin(k * 13 - t * 0.2 + band) * 9;
      const len = 30 + 26 * (0.5 + 0.5 * Math.sin(k * 23 + band * 4 + t * 0.5));
      const a = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(k * 41 + t * 0.9 + band));
      ctx.fillStyle = `rgba(60,230,190,${a})`;
      ctx.fillRect(x, y, 6, len);
      ctx.fillStyle = `rgba(120,255,220,${a * 0.9})`;
      ctx.fillRect(x, y, 6, 3);
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- public ----------
// Draws the sky's big clouds and the far layers between the sky and the
// meadow. hz: where the meadow starts; sc: scroll; t: clock.
export function drawLandscape(ctx, W, H, hz, sc, t, opts) {
  const { season, seed = 1, light = 1, night = 0, wet = 0, x0 = 0, x1 = W } = opts;
  const px = pxOf(ctx);
  const skey = `${Math.round(season.snow * 4)}:${Math.round(season.autumn * 4)}`;
  // big clouds drifting very slowly, washed out when it's overcast
  if (wet < 0.85) {
    for (let i = 0; i < 3; i++) {
      const cw = 260 + (i % 2) * 120, ch = 200 + (i % 2) * 60;
      const img = tile(`cu${i}`, cw, ch, Math.min(px, 1.5), (c) => paintCumulus(c, cw, ch, seed * 13 + i * 101));
      const span = W + cw * 2;
      const x = ((i * 0.37 * span - t * (2 + i) - sc * 0.01) % span + span) % span - cw;
      const s = Math.min(1, H / 700) * (0.8 + 0.25 * i);
      ctx.globalAlpha = (1 - wet) * (0.35 + 0.65 * light);
      ctx.drawImage(img, x, hz - ch * s * 0.8 - 26 * i, cw * s, ch * s);
    }
    ctx.globalAlpha = 1;
  }
  if (night > 0.6 && season.snow > 0.3 && wet < 0.3) drawAurora(ctx, W, hz - H * 0.45, hz - 30, t, (night - 0.6) * 2.5 * (1 - wet / 0.3));
  // mountains, far hills, near hills
  const mh = Math.min(H * 0.32, 230), fh = Math.min(H * 0.12, 95), nh = Math.min(H * 0.085, 70);
  const m = tile(`mnt${skey}`, TW, MH, px, (c) => paintMountains(c, season, seed));
  slide(ctx, m, sc * 0.03, hz + 8 - mh, TW * (mh / MH), mh, x0, x1);
  const f = tile(`far${skey}`, TW, HH, px, (c) => paintFarHills(c, season, seed + 7));
  slide(ctx, f, sc * 0.08, hz + 10 - fh, TW * (fh / HH), fh, x0, x1);
  const n = tile(`near${skey}`, TW, HH, px, (c) => paintNearHills(c, season, seed + 19));
  slide(ctx, n, sc * 0.16, hz + 12 - nh, TW * (nh / HH), nh, x0, x1);
}

// Soft lighter grass patches and specks of flowers on the meadow, scrolling
// with the ground at depth p (0 far .. 1 near).
export function drawMeadow(ctx, W, top, bottom, sc, season, x0 = 0, x1 = W, speed = 0.3) {
  const px = pxOf(ctx);
  const skey = `${Math.round(season.snow * 4)}:${Math.round(season.autumn * 4)}`;
  const h = bottom - top;
  if (h < 8) return;
  const img = tile(`meadow${skey}`, TW, 100, Math.min(px, 1.5), (c) => {
    const r = rng(77);
    for (let i = 0; i < 26; i++) {
      const x = r() * TW, y = 8 + r() * 86, w = 40 + r() * 160;
      c.fillStyle = i % 4 ? tint('#a6d86e', season) : tint('#5fa84a', season);
      c.globalAlpha = 0.55;
      for (const ox of [-TW, 0, TW]) { c.beginPath(); c.ellipse(x + ox, y, w, 3 + r() * 4, 0, 0, Math.PI * 2); c.fill(); }
    }
    c.globalAlpha = 1;
    if (season.snow < 0.4) {
      const cols = season.autumn > 0.4 ? ['#e2603a', '#f0a23a'] : ['#fff6d8', '#ffd84a', '#ff8fa3'];
      for (let i = 0; i < 160; i++) { c.fillStyle = cols[i % cols.length]; c.fillRect(r() * TW, 4 + r() * 92, 2, 2); }
    }
  });
  slide(ctx, img, sc * speed, top, TW, h, x0, x1);
}
