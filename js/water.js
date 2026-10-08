// The look of open water, after a pixel-art lily pond: deep blue with soft
// lighter streaks, lily pads with a bright rim and a notch, and pink water
// lilies with yellow hearts. Used by the map and every Focus view.
// Each piece is painted once into a small cached image and then stamped.
import { OL } from './toon.js';

export const WATER = {
  base: '#3a74b4',   // open water
  deep: '#33689f',   // the middle of a lake
  streak: '#4c87c4', // lighter bands
  glint: '#6aa6da',  // the brightest bit of a band
  shore: '#7cc0e8',  // the bright edge where water meets the bank
  river: '#3f7cbb',
};

const cache = new Map();
function pxOf(ctx) { const t = ctx.getTransform(); return Math.round(Math.hypot(t.a, t.b) * 4) / 4 || 1; }
// sprite resolution in half steps, so a handful of cached sizes cover every use
const qpx = (p) => Math.min(3, Math.max(1, Math.round(p * 2) / 2));
function sprite(key, w, h, px, paint) {
  const k = `${key}|${px}`;
  let c = cache.get(k);
  if (!c) {
    if (cache.size > 80) cache.clear();
    c = document.createElement('canvas');
    c.width = Math.ceil(w * px); c.height = Math.ceil(h * px);
    const x = c.getContext('2d');
    x.scale(px, px);
    x.lineJoin = 'round'; x.lineCap = 'round';
    paint(x);
    cache.set(k, c);
  }
  return c;
}

// A band of lighter water: a long soft strip with a brighter core.
// Drawn centred on (x, y), w wide and h tall (h small for perspective).
export function drawStreak(ctx, x, y, w, h, variant = 0, alpha = 1) {
  if (w < 2 || h < 0.4) return;
  const px = qpx(pxOf(ctx) * Math.min(1, w / 120));
  const v = variant % 3;
  const img = sprite(`streak${v}`, 120, 16, px, (c) => {
    c.fillStyle = WATER.streak;
    const parts = [[[6, 5, 70, 6], [40, 9, 62, 5]], [[2, 6, 56, 5], [30, 3, 80, 6]], [[10, 5, 96, 6]]][v];
    for (const [sx, sy, sw, sh] of parts) { c.beginPath(); c.roundRect(sx, sy, sw, sh, sh / 2); c.fill(); }
    c.fillStyle = WATER.glint;
    for (const [sx, sy, sw, sh] of parts) { c.beginPath(); c.roundRect(sx + sw * 0.2, sy + 1, sw * 0.45, sh - 3, (sh - 3) / 2); c.fill(); }
  });
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * alpha;
  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  ctx.globalAlpha = a;
}

// A lily pad seen from above, squashed by `flat` (1 = straight down, small
// = seen low across the water). r is its radius across.
export function drawPad(ctx, x, y, r, flat = 1, turn = 0) {
  if (r < 1) return;
  const px = qpx(pxOf(ctx) * Math.min(1, r / 20));
  const v = Math.abs(Math.round(turn)) % 4;
  const img = sprite(`pad${v}`, 48, 48, px, (c) => {
    const a0 = v * 1.6 + 0.3;
    // a ring of brighter water round the pad
    c.beginPath(); c.arc(24, 24, 22, 0, Math.PI * 2); c.fillStyle = 'rgba(124,192,232,0.55)'; c.fill();
    const pad = (rr) => { c.beginPath(); c.moveTo(24, 24); c.arc(24, 24, rr, a0 + 0.28, a0 + Math.PI * 2 - 0.28); c.closePath(); };
    pad(19); c.fillStyle = '#4f8f3e'; c.fill(); c.lineWidth = 2.2; c.strokeStyle = OL; c.stroke();
    pad(16); c.fillStyle = '#6aa84f'; c.fill();
    c.beginPath(); c.arc(24, 24, 11, a0 + Math.PI * 0.9, a0 + Math.PI * 1.7); c.lineTo(24, 24); c.closePath(); c.fillStyle = '#8cc46a'; c.fill();
    // veins
    c.strokeStyle = 'rgba(60,110,45,0.6)'; c.lineWidth = 1;
    for (let i = 1; i < 5; i++) { const a = a0 + 0.28 + i * ((Math.PI * 2 - 0.56) / 5); c.beginPath(); c.moveTo(24, 24); c.lineTo(24 + Math.cos(a) * 14, 24 + Math.sin(a) * 14); c.stroke(); }
  });
  ctx.drawImage(img, x - r * 1.16, y - r * 1.16 * flat, r * 2.32, r * 2.32 * flat);
}

// A pink water lily standing on the water at (x, y), s px wide.
export function drawLotus(ctx, x, y, s) {
  if (s < 2) return;
  const px = qpx(pxOf(ctx) * Math.min(1, s / 30));
  const img = sprite('lotus', 40, 30, px, (c) => {
    const petal = (cx, cy, ang, len, wid, col) => {
      c.save(); c.translate(cx, cy); c.rotate(ang);
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(wid, -len * 0.45, 0, -len); c.quadraticCurveTo(-wid, -len * 0.45, 0, 0); c.closePath();
      c.fillStyle = col; c.fill(); c.lineWidth = 1.4; c.strokeStyle = OL; c.stroke();
      c.beginPath(); c.moveTo(0, -len * 0.2); c.quadraticCurveTo(wid * 0.35, -len * 0.55, 0, -len * 0.85); c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1; c.stroke();
      c.restore();
    };
    const bx = 20, by = 26;
    for (const a of [-1.35, 1.35, -1.0, 1.0]) petal(bx, by, a, 14, 5, '#f7b4d6');
    for (const a of [-0.65, 0.65, -0.35, 0.35]) petal(bx, by, a, 17, 5.5, '#f28cc0');
    petal(bx, by, 0, 18, 6, '#ec6fae');
    for (const a of [-0.2, 0.2]) petal(bx, by - 1, a, 13, 4.5, '#e2559c');
    // golden heart
    c.beginPath(); c.ellipse(bx, by - 10, 4, 2.6, 0, 0, Math.PI * 2); c.fillStyle = '#ffd84a'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = OL; c.stroke();
    c.fillStyle = '#fff3a0'; c.beginPath(); c.arc(bx - 1, by - 11, 1.2, 0, Math.PI * 2); c.fill();
  });
  ctx.drawImage(img, x - s / 2, y - s * 0.86, s, s * 0.75);
}
