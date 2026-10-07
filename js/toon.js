// Chunky cartoon drawing helpers: bold outlines, glossy highlights, little people.
import { hash, clamp } from './rng.js';

export const OL = '#2b2140'; // outline colour used everywhere

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
  const bob = Math.sin(t * 2.6 + seed * 1.7) * 0.6 * s;
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
  if (h < 22) {
    // far away: one outlined shape is enough
    ctx.beginPath();
    if (kind === 0) { ctx.moveTo(x, y - h); ctx.lineTo(x - h * 0.3, y - h * 0.12); ctx.lineTo(x + h * 0.3, y - h * 0.12); ctx.closePath(); }
    else ctx.arc(x, y - h * 0.58, h * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = tint(kind === 0 ? '#2fa35f' : '#4cbf56'); ctx.fill();
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
  } else {
    const r = h * 0.3, cy = y - h * 0.62;
    const c = kind === 1 ? '#4cbf56' : '#7ccc4a';
    blob(ctx, [[x + sx, cy - r * 0.2, r], [x - r * 0.65 + sx * 0.7, cy + r * 0.25, r * 0.7], [x + r * 0.65 + sx * 0.7, cy + r * 0.25, r * 0.72]], tint(c), lw);
    ctx.fillStyle = tint(shade(c, -0.22));
    ctx.beginPath(); ctx.arc(x + r * 0.45 + sx, cy + r * 0.45, r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath(); ctx.arc(x - r * 0.35 + sx, cy - r * 0.45, r * 0.32, 0, Math.PI * 2); ctx.fill();
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
