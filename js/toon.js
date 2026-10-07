// Chunky cartoon drawing helpers: bold outlines, glossy highlights, little people.
import { hash, clamp } from './rng.js';

export const OL = '#2b2140'; // outline colour used everywhere

// Current season, set each frame by whoever is drawing: snow cover and autumn (0..1).
export const season = { snow: 0, autumn: 0 };

export function mixHex(a, b, t) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

// Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour.
export function shade(color, amt) {
  let r, g, b;
  if (color[0] === '#') { const n = parseInt(color.slice(1), 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
  else [r, g, b] = color.match(/\d+/g).map(Number); // rgb(...) from an earlier shade()
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Fill a path with a darker belly (a hard gradient stop, so no clipping is
// needed), add a glossy highlight near the top, then outline it.
export function glossy(ctx, path, box, color, { lw = 2.5, gloss = true, belly = 0.22 } = {}) {
  ctx.beginPath(); path();
  if (belly) {
    const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
    const dark = shade(color, -belly);
    g.addColorStop(0, color); g.addColorStop(0.68, color); g.addColorStop(0.7, dark); g.addColorStop(1, dark);
    ctx.fillStyle = g;
  } else ctx.fillStyle = color;
  ctx.fill();
  if (lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = OL; ctx.lineJoin = 'round'; ctx.stroke(); }
  if (gloss && box.h > 6) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.roundRect(box.x + Math.min(10, box.w * 0.12), box.y + Math.max(2.5, box.h * 0.12), box.w - Math.min(20, box.w * 0.24), Math.max(2, box.h * 0.13), box.h * 0.065);
    ctx.fill();
  }
}

export function glossyRect(ctx, x, y, w, h, r, color, opts) {
  glossy(ctx, () => ctx.roundRect(x, y, w, h, r), { x, y, w, h }, color, opts);
}

export function outlined(ctx, path, fill, lw = 2.5) {
  ctx.beginPath(); path();
  ctx.fillStyle = fill; ctx.fill();
  if (lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = OL; ctx.lineJoin = 'round'; ctx.stroke(); }
}

// A union of circles with one clean outline round the whole shape.
export function blob(ctx, circles, fill, lw, outline = OL) {
  if (lw > 0) {
    ctx.strokeStyle = outline; ctx.lineWidth = lw * 2;
    for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.fillStyle = fill;
  for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
}

const SKINS = ['#f7d4b5', '#e8b48a', '#c98a55', '#8d5524', '#f1c27d'];
const HAIR = ['#3b2a20', '#f0c419', '#d0452f', '#1d1d1d', '#8e5b3a', '#7b4bb7', '#f08a24'];
const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#e84393', '#34495e'];

// A little person. (x, y) is the shoulder line; s scales them.
export function person(ctx, x, y, s, seed, t, { back = false, standing = false, cap = null } = {}) {
  const h = (k) => hash(seed, k);
  const bob = Math.sin(t * 1.4 + seed * 1.7) * 0.2 * s;
  const lw = clamp(s * 1.1, 0.7, 1.8);
  y += bob;
  if (standing) {
    ctx.fillStyle = '#3a3340';
    ctx.fillRect(x - 3.2 * s, y + 6 * s, 2.6 * s, 6 * s);
    ctx.fillRect(x + 0.6 * s, y + 6 * s, 2.6 * s, 6 * s);
  }
  outlined(ctx, () => ctx.roundRect(x - 5 * s, y - 1 * s, 10 * s, 8 * s, [4 * s, 4 * s, 1 * s, 1 * s]), SHIRTS[Math.floor(h(1) * SHIRTS.length)], lw);
  const hy = y - 5.6 * s, r = 4.6 * s;
  outlined(ctx, () => ctx.arc(x, hy, r, 0, Math.PI * 2), SKINS[Math.floor(h(2) * SKINS.length)], lw);
  const hair = HAIR[Math.floor(h(3) * HAIR.length)];
  const style = Math.floor(h(4) * 4);
  ctx.fillStyle = cap || hair;
  ctx.beginPath();
  if (back) ctx.arc(x, hy, r, 0, Math.PI * 2);
  else if (cap) { ctx.arc(x, hy - 0.5 * s, r * 1.02, Math.PI * 1.05, Math.PI * 1.95); ctx.rect(x - r, hy - r * 0.55, r * 2.4, r * 0.35); }
  else if (style === 0) ctx.arc(x, hy - 0.6 * s, r, Math.PI * 1.05, Math.PI * 1.95);
  else if (style === 1) { ctx.arc(x, hy - 0.8 * s, r, Math.PI * 0.95, Math.PI * 2.05); ctx.arc(x, hy - r - 1 * s, 2 * s, 0, Math.PI * 2); }
  else if (style === 2) { ctx.arc(x, hy - 0.5 * s, r * 1.05, Math.PI * 0.9, Math.PI * 2.1); ctx.rect(x - r * 1.05, hy - 0.5 * s, 2 * s, r * 1.1); }
  else ctx.arc(x, hy - 1.2 * s, r * 0.9, Math.PI, 0);
  ctx.fill();
  if (!back) {
    ctx.fillStyle = OL;
    ctx.beginPath(); ctx.arc(x - 1.6 * s, hy + 0.6 * s, 0.75 * s, 0, Math.PI * 2); ctx.arc(x + 1.8 * s, hy + 0.6 * s, 0.75 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,120,120,0.45)';
    ctx.beginPath(); ctx.arc(x - 3 * s, hy + 2 * s, 1 * s, 0, Math.PI * 2); ctx.arc(x + 3.2 * s, hy + 2 * s, 1 * s, 0, Math.PI * 2); ctx.fill();
  }
}

// Cartoon trees. kind 0 = conifer, otherwise round.
export function toonTree(ctx, x, y, h, kind, light = 1, sway = 0) {
  if (h < 3) return;
  const lw = clamp(h * 0.035, 0.6, 2.4);
  const k = 0.55 + 0.45 * light;
  const tint = (c) => shade(c, -(1 - k) * 0.6);
  const leaf = (c, alt) => mixHex(mixHex(c, alt, season.autumn * 0.9), '#e8eef6', season.snow * 0.35);
  if (h < 22) {
    // far away: one outlined shape is enough
    ctx.beginPath();
    if (kind === 0) { ctx.moveTo(x, y - h); ctx.lineTo(x - h * 0.3, y - h * 0.12); ctx.lineTo(x + h * 0.3, y - h * 0.12); ctx.closePath(); }
    else ctx.arc(x, y - h * 0.58, h * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = tint(kind === 0 ? mixHex('#2fa35f', '#e8eef6', season.snow * 0.45) : leaf('#4cbf56', '#f0a23a')); ctx.fill();
    if (h > 10) { ctx.lineWidth = lw; ctx.strokeStyle = OL; ctx.stroke(); }
    return;
  }
  outlined(ctx, () => ctx.rect(x - h * 0.045, y - h * 0.32, h * 0.09, h * 0.32), tint('#8a5a35'), lw);
  const sx = sway * h * 0.03;
  if (kind === 0) {
    const g = tint('#2fa35f'), d = tint('#22804a');
    for (let i = 0; i < 3; i++) {
      const top = y - h * (0.45 + i * 0.2) - h * 0.1, base = y - h * (0.18 + i * 0.2), w = h * (0.34 - i * 0.07);
      const ox = sx * (i + 1) * 0.5;
      outlined(ctx, () => { ctx.moveTo(x + ox, top); ctx.lineTo(x - w + ox * 0.5, base); ctx.lineTo(x + w + ox * 0.5, base); ctx.closePath(); }, i === 0 ? d : g, lw);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(x + sx, y - h); ctx.lineTo(x - h * 0.12 + sx, y - h * 0.68); ctx.lineTo(x - h * 0.02 + sx, y - h * 0.7); ctx.fill();
    if (season.snow > 0.05) {
      // snow resting on each tier
      ctx.fillStyle = `rgba(250,252,255,${Math.min(1, season.snow * 1.2)})`;
      for (let i = 0; i < 3; i++) {
        const top = y - h * (0.45 + i * 0.2) - h * 0.1, w = h * (0.34 - i * 0.07), ox = sx * (i + 1) * 0.5;
        ctx.beginPath(); ctx.moveTo(x + ox, top); ctx.lineTo(x - w * 0.45 + ox, top + h * 0.12); ctx.quadraticCurveTo(x + ox, top + h * 0.17, x + w * 0.45 + ox, top + h * 0.12); ctx.closePath(); ctx.fill();
      }
    }
  } else {
    const r = h * 0.3, cy = y - h * 0.62;
    const c = kind === 1 ? leaf('#4cbf56', '#f0a23a') : leaf('#7ccc4a', '#e2603a');
    blob(ctx, [[x + sx, cy - r * 0.2, r], [x - r * 0.65 + sx * 0.7, cy + r * 0.25, r * 0.7], [x + r * 0.65 + sx * 0.7, cy + r * 0.25, r * 0.72]], tint(c), lw);
    ctx.fillStyle = tint(shade(c, -0.22));
    ctx.beginPath(); ctx.arc(x + r * 0.45 + sx, cy + r * 0.45, r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath(); ctx.arc(x - r * 0.35 + sx, cy - r * 0.45, r * 0.32, 0, Math.PI * 2); ctx.fill();
    if (season.snow > 0.05) {
      ctx.fillStyle = `rgba(250,252,255,${Math.min(1, season.snow * 1.2)})`;
      ctx.beginPath(); ctx.ellipse(x + sx, cy - r * 0.75, r * 0.8, r * 0.38, 0, Math.PI, 0); ctx.quadraticCurveTo(x + sx, cy - r * 0.55, x - r * 0.8 + sx, cy - r * 0.75); ctx.fill();
    }
  }
}

// Puffy flat-bottomed cloud (circles on a rounded base; no clipping).
export function toonCloud(ctx, x, y, s, fill, rim) {
  const circles = [[x, y - 14 * s, 22 * s], [x - 26 * s, y - 4 * s, 14 * s], [x + 24 * s, y - 6 * s, 16 * s], [x - 10 * s, y - 6 * s, 15 * s], [x + 9 * s, y - 5 * s, 15 * s]];
  const base = () => ctx.roundRect(x - 38 * s, y - 8 * s, 76 * s, 18 * s, 9 * s);
  ctx.strokeStyle = rim; ctx.lineWidth = 3;
  for (const [cx, cy, r] of circles) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); base(); ctx.stroke();
  ctx.fillStyle = fill;
  for (const [cx, cy, r] of circles) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); base(); ctx.fill();
}

// A bumpy layer of snow resting on a roof from x to x + w at height y, with icicles.
export function snowCap(ctx, x, y, w, amt, { lw = 1.5, icicles = true } = {}) {
  if (amt < 0.05 || w < 4) return;
  const h = 2.5 + amt * 4.5;
  const n = Math.max(2, Math.round(w / 14));
  ctx.globalAlpha = Math.min(1, amt * 1.4);
  ctx.beginPath();
  ctx.moveTo(x - 1, y + 2);
  ctx.lineTo(x - 1, y - h * 0.4);
  for (let i = 0; i < n; i++) {
    const x0 = x + (i * w) / n, x1 = x + ((i + 1) * w) / n;
    ctx.quadraticCurveTo((x0 + x1) / 2, y - h * (i % 2 ? 1.05 : 1.35), x1, y - h * 0.4);
  }
  ctx.lineTo(x + w + 1, y + 2);
  ctx.closePath();
  ctx.fillStyle = '#fbfdff'; ctx.fill();
  ctx.lineWidth = lw; ctx.strokeStyle = OL; ctx.lineJoin = 'round'; ctx.stroke();
  if (icicles && amt > 0.4) {
    ctx.fillStyle = '#d6f0ff'; ctx.lineWidth = 1;
    for (let ix = x + 6; ix < x + w - 4; ix += 11 + ((ix * 7) % 5)) {
      const len = 3 + ((ix * 13) % 5);
      ctx.beginPath(); ctx.moveTo(ix - 2, y + 1.5); ctx.lineTo(ix, y + 1.5 + len); ctx.lineTo(ix + 2, y + 1.5); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
