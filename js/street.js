// Riding a city's buses, light rail and metro: a seat by the window looking
// out at the street (or the tunnel). The city is painted once into wide
// tiling strips (skyline, shopfronts) and slid past; lamps, trees, people,
// cars and stops are drawn on top, fixed to the street.
import { OL, shade, mixHex, person, outlined, glossyRect, season } from './toon.js';
import { TRANSIT } from './data.js';
import { eraOf, buildingSprite } from './buildings.js';

const TW = 1600;
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

const cache = new Map();
function tile(key, w, h, px, paint) {
  const k = `${key}|${px}`;
  let c = cache.get(k);
  if (!c) {
    if (cache.size > 16) cache.clear();
    c = document.createElement('canvas');
    c.width = Math.ceil(w * px); c.height = Math.ceil(h * px);
    const x = c.getContext('2d');
    x.scale(px, px); x.lineJoin = 'round';
    paint(x);
    cache.set(k, c);
  }
  return c;
}
function pxOf(ctx) { const t = ctx.getTransform(); return Math.min(2, Math.round(Math.hypot(t.a, t.b) * 2) / 2 || 1); }
function slide(ctx, img, off, y, w, h, x0, x1) {
  let x = -(((off % w) + w) % w) + x0;
  for (; x < x1; x += w) ctx.drawImage(img, x, y, w + 0.5, h);
}

// ---------- painted strips ----------
const SKY_H = 260;
function paintSkyline(c, seed, snow, era) {
  const r = rng(seed);
  // two rows: pale far towers, then nearer blocks
  for (const [row, col, hmin, hmax] of [[0, '#9fb4d0', 90, 230], [1, '#7f93b5', 60, 170]]) {
    for (let x = -20; x < TW + 20;) {
      const w = 40 + r() * 70, h = hmin + r() * (hmax - hmin);
      const cc = shade(col, (r() - 0.5) * 0.12);
      // drawn again one tile over where it crosses an edge, so the strip tiles seamlessly
      const copies = [0];
      if (x + w > TW) copies.push(-TW);
      if (x < 0) copies.push(TW);
      const wins = [];
      for (let wy = SKY_H - h + 8; wy < SKY_H - 6; wy += 12) for (let wx = 6; wx < w - 6; wx += 10) if (r() < 0.55) wins.push([wx, wy]);
      const aerial = r() < 0.15;
      for (const ox of copies) {
        c.fillStyle = cc; c.fillRect(x + ox, SKY_H - h, w, h);
        c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x + ox, SKY_H - h, w * 0.25, h);
        c.fillStyle = row ? 'rgba(255,240,200,0.35)' : 'rgba(255,255,255,0.25)';
        for (const [wx, wy] of wins) c.fillRect(x + ox + wx, wy, 4, 5);
        if (snow > 0.3) { c.fillStyle = '#f4f7fb'; c.fillRect(x + ox, SKY_H - h - 3, w, 4); }
        if (aerial) { c.fillStyle = cc; c.fillRect(x + ox + w / 2 - 1.5, SKY_H - h - 18, 3, 18); }
      }
      x += w + (row ? 2 : 14) + r() * 10;
    }
  }
  if (era !== 'classic') eraRow(c, r, era);
}
// The era's landmark buildings, hazy, between the far and near rows.
function eraRow(c, r, era) {
  const kinds = era === 'modern' ? ['glass', 'glass', 'resi', 'tvTower', 'glass', 'resi'] : ['decoTower', 'decoTower', 'decoBlock', 'decoTower'];
  let k = 0;
  for (let x = 20; x < TW - 100; x += 120 + r() * 110, k++) {
    const kind = kinds[k % kinds.length], spr = buildingSprite(kind, Math.floor(r() * 4));
    const w = kind === 'tvTower' ? 90 : 64 + r() * 26, h = (spr.h * w) / 120;
    const sc = Math.min(1, (SKY_H - 10) / h), ww = w * sc, hh = h * sc;
    c.globalAlpha = 0.88; c.drawImage(spr.c, x, SKY_H - hh, ww, hh); // a little hazy
    c.globalAlpha = 1;
  }
}

const SHOP_H = 280;
const WALLS = ['#e8a45c', '#d9785a', '#f2d48a', '#9cc7a4', '#c9a2d6', '#8fbfe0', '#e7e1d2', '#d8b48c'];
const AWN = ['#e0594a', '#2d6cdf', '#3f9a5a', '#f3a712', '#8e6bd9'];
function paintShops(c, seed, snow) {
  const r = rng(seed);
  for (let x = 0; x < TW;) {
    const w = Math.min(TW - x, 110 + Math.floor(r() * 4) * 30), h = 170 + r() * 100;
    const wall = WALLS[Math.floor(r() * WALLS.length)], awn = AWN[Math.floor(r() * AWN.length)];
    const top = SHOP_H - h;
    // the building
    c.fillStyle = wall; c.fillRect(x, top, w, h);
    c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(x + w - 8, top, 8, h);
    c.fillStyle = shade(wall, -0.25); c.fillRect(x - 2, top - 8, w + 4, 10); // cornice
    if (snow > 0.3) { c.fillStyle = '#f4f7fb'; c.fillRect(x - 2, top - 12, w + 4, 5); }
    c.strokeStyle = OL; c.lineWidth = 2.5; c.strokeRect(x, top, w, h);
    // upper floors
    const floors = Math.floor((h - 100) / 44);
    for (let f = 0; f < floors; f++) for (let wx = x + 14; wx < x + w - 24; wx += 30) {
      const wy = top + 16 + f * 44;
      c.fillStyle = '#a9def5'; c.fillRect(wx, wy, 18, 26);
      c.strokeStyle = OL; c.lineWidth = 2; c.strokeRect(wx, wy, 18, 26);
      c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(wx + 2, wy + 2, 5, 22);
      if (r() < 0.25) { c.fillStyle = '#e0594a'; c.fillRect(wx - 2, wy + 24, 22, 5); } // a window box
    }
    // the shop: a big window, a door, an awning and a sign
    const sy = SHOP_H - 92;
    c.fillStyle = '#5a4a3f'; c.fillRect(x + 6, sy - 26, w - 12, 18);
    c.fillStyle = '#fff3d6'; c.font = '900 12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(['CAFÉ', 'BAKERY', 'BOOKS', 'FLOWERS', 'TOYS', 'MARKET', 'BANK', 'HATS', 'TEA', 'RADIO'][Math.floor(r() * 10)], x + w / 2, sy - 17);
    c.fillStyle = '#bfe6f7'; c.fillRect(x + 10, sy + 10, w - 52, 70);
    c.strokeStyle = OL; c.lineWidth = 2.5; c.strokeRect(x + 10, sy + 10, w - 52, 70);
    c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(x + 16, sy + 14, 10, 62);
    c.fillStyle = shade(wall, -0.35); c.fillRect(x + w - 36, sy + 18, 24, 62);
    c.strokeRect(x + w - 36, sy + 18, 24, 62);
    // striped awning
    for (let ax = x + 6, k = 0; ax < x + w - 6; ax += 14, k++) {
      c.fillStyle = k % 2 ? '#fbf6ea' : awn;
      c.beginPath(); c.moveTo(ax, sy - 6); c.lineTo(ax + 14, sy - 6); c.lineTo(ax + 16, sy + 8); c.lineTo(ax - 2, sy + 8); c.closePath(); c.fill();
    }
    c.strokeStyle = OL; c.lineWidth = 2; c.strokeRect(x + 6, sy - 6, w - 12, 14);
    x += w;
  }
}

// ---------- the ride ----------
// S: { mode, stopNames, s (position along the route), dir, seg (street length
// between stops), light, wait, fromName, toName, riders (0..1 how full) }
export function drawStreetRide(R, ctx, W, H, dt, S) {
  const { mode, stopNames, s, dir, light, wait } = S;
  const metro = mode === 'metro', tram = mode === 'tram';
  const portrait = H > W * 1.2;
  const sway = !wait ? Math.sin(R.clock * 2.6) * 1.2 : 0;
  const win = portrait ? { x: 18, y: H * 0.14, w: W - 36, h: H * 0.42 } : { x: 30, y: H * 0.12, w: W - 60, h: H * 0.5 };
  const top = win.y, bot = win.y + win.h;
  const px = pxOf(ctx);
  const snow = season.snow;
  const skey = Math.round(snow * 4);

  ctx.save();
  ctx.beginPath(); ctx.roundRect(win.x, win.y + sway, win.w, win.h, 22); ctx.clip();
  const groundY = bot - win.h * 0.2; // kerb line
  const X = (worldX, k = 1) => W / 2 + (worldX - s) * dir * k; // street position to screen

  if (!metro) {
    R.drawSky(ctx, W, H, groundY - win.h * 0.35, light, (R.clock / 600 + 0.15) % 1);
    R.drawClouds(ctx, W, groundY - win.h * 0.35, s * 0.05, light);
    const era = eraOf(R.g.year());
    const sk = tile(`sky${skey}${era}`, TW, SKY_H, Math.min(px, 1.5), (c) => paintSkyline(c, 11, snow, era));
    const skH = Math.min(win.h * 0.75, SKY_H);
    slide(ctx, sk, s * dir * 0.12, groundY - win.h * 0.1 - skH, TW * (skH / SKY_H), skH, 0, W);
    const sh = tile(`shops${skey}`, TW, SHOP_H, px, (c) => paintShops(c, 23, snow));
    const shH = Math.min(win.h * (era === 'classic' ? 0.72 : 0.6), SHOP_H); // lower shops let the big city show behind
    slide(ctx, sh, s * dir * 0.55, groundY - shH, TW * (shH / SHOP_H), shH, 0, W);
    // pavement, kerb and road
    ctx.fillStyle = mixHex('#c9c3b8', '#f4f7fb', snow * 0.8); ctx.fillRect(0, groundY, W, win.h * 0.08);
    ctx.strokeStyle = 'rgba(43,33,64,0.25)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let gx = -((s * dir * 0.8) % 46 + 46) % 46; gx < W; gx += 46) { ctx.moveTo(gx, groundY); ctx.lineTo(gx - 10, groundY + win.h * 0.08); }
    ctx.stroke();
    ctx.fillStyle = '#9a948a'; ctx.fillRect(0, groundY + win.h * 0.08, W, 4);
    const roadY = groundY + win.h * 0.08 + 4;
    ctx.fillStyle = mixHex('#4a4652', '#d8dde6', snow * 0.6); ctx.fillRect(0, roadY, W, bot - roadY + 10);
    if (tram) {
      ctx.fillStyle = '#c9ced6';
      for (const ry of [roadY + 10, roadY + 22]) ctx.fillRect(0, ry, W, 2.5);
    } else {
      ctx.fillStyle = '#f2d48a';
      for (let lx = -((s * dir) % 90 + 90) % 90; lx < W; lx += 90) ctx.fillRect(lx, roadY + 18, 44, 4);
    }
    // street furniture fixed to the pavement: lamps, trees and people
    const left = s - W, right = s + W;
    for (let i = Math.floor(Math.min(left, right) / 230); i * 230 < Math.max(left, right); i++) {
      const x = X(i * 230);
      if (x < -40 || x > W + 40) continue;
      if (i % 3 === 1) {
        // a street tree in a little bed
        const th = win.h * 0.32;
        ctx.fillStyle = '#6d4a2f'; ctx.fillRect(x - 3, groundY - th * 0.45, 6, th * 0.45);
        outlined(ctx, () => { ctx.arc(x, groundY - th * 0.62, th * 0.24, 0, Math.PI * 2); ctx.moveTo(x - th * 0.12 + th * 0.18, groundY - th * 0.78); ctx.arc(x - th * 0.12, groundY - th * 0.78, th * 0.18, 0, Math.PI * 2); }, season.autumn > 0.5 ? '#e2853a' : snow > 0.5 ? '#e8eef6' : '#4fae4a', 2);
      } else {
        // a lamp post
        const lh = win.h * 0.5;
        ctx.fillStyle = OL; ctx.fillRect(x - 2.5, groundY - lh, 5, lh);
        outlined(ctx, () => ctx.roundRect(x - 7, groundY - lh - 10, 14, 12, 3), '#ffe28a', 2);
        R.lights.push({ kind: 'lamp', x, y: groundY - lh - 4, r: 30 });
      }
      if (hash(i, 3) < 0.6) {
        const wx = x + 60 + Math.sin(R.clock * 0.6 + i) * 30;
        person(ctx, wx, groundY + 2, 1.6, 300 + i, R.clock, { standing: true });
      }
    }
    // the odd car going the other way
    const cp = (R.clock * 260) % (W * 4);
    if (cp < W + 200) {
      const cx = W + 100 - cp, cy = bot - 18, col = AWN[Math.floor(R.clock / 7) % AWN.length];
      glossyRect(ctx, cx - 50, cy - 28, 100, 26, 10, col, { lw: 2.5 });
      glossyRect(ctx, cx - 30, cy - 46, 58, 22, 8, col, { lw: 2.5 });
      outlined(ctx, () => ctx.roundRect(cx - 24, cy - 42, 22, 15, 3), '#a9def5', 1.5);
      outlined(ctx, () => ctx.roundRect(cx + 2, cy - 42, 22, 15, 3), '#a9def5', 1.5);
      for (const wx of [cx - 30, cx + 30]) outlined(ctx, () => ctx.arc(wx, cy, 9, 0, Math.PI * 2), '#3a3340', 2);
    }
    // stops: a shelter, a sign and people waiting
    stopNames.forEach((name, i) => {
      const x = X(i * S.seg);
      if (x < -160 || x > W + 160) return;
      const sh2 = win.h * 0.36;
      outlined(ctx, () => ctx.rect(x - 60, groundY - sh2, 120, sh2), 'rgba(169,222,245,0.45)', 2.5);
      glossyRect(ctx, x - 66, groundY - sh2 - 10, 132, 12, 4, TRANSIT[mode].color, { lw: 2 });
      ctx.fillStyle = OL; ctx.fillRect(x + 66, groundY - sh2 - 30, 4, sh2 + 30);
      glossyRect(ctx, x + 56, groundY - sh2 - 52, 26, 26, 13, TRANSIT[mode].color, { lw: 2 });
      ctx.font = '900 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      ctx.fillText(tram ? 'T' : 'B', x + 69, groundY - sh2 - 39);
      glossyRect(ctx, x - 50, groundY - sh2 + 8, 100, 18, 4, '#2b2140', { lw: 1.5, gloss: false });
      ctx.font = '800 11px system-ui'; ctx.fillStyle = '#fff3c4'; ctx.fillText(name, x, groundY - sh2 + 17);
      for (let k = 0; k < 4; k++) person(ctx, x - 40 + k * 26, groundY + 2, 1.6, 700 + i * 7 + k, R.clock, { standing: true });
    });
    if (tram) {
      // the overhead wire, with a hanger now and then
      ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, top + 18); ctx.lineTo(W, top + 18); ctx.stroke();
      ctx.beginPath();
      for (let i = Math.floor((s - W) / 300); i * 300 < s + W; i++) { const x = X(i * 300, 0.9); ctx.moveTo(x, top); ctx.lineTo(x, top + 18); }
      ctx.stroke();
    }
  } else {
    // the metro: a dark tunnel with lights rushing past, then bright stations
    ctx.fillStyle = '#23252e'; ctx.fillRect(0, top - 10, W, win.h + 20);
    ctx.fillStyle = '#2d303b'; ctx.fillRect(0, top + win.h * 0.55, W, win.h * 0.5);
    ctx.strokeStyle = 'rgba(120,130,150,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (const cy of [top + win.h * 0.2, top + win.h * 0.24, top + win.h * 0.7]) { ctx.moveTo(0, cy); ctx.lineTo(W, cy); }
    ctx.stroke();
    for (let i = Math.floor((s - W) / 170); i * 170 < s + W; i++) {
      const x = X(i * 170, 1.4);
      if (x < -30 || x > W + 30) continue;
      ctx.fillStyle = '#ffe9a8'; ctx.fillRect(x - 16, top + win.h * 0.3, 32, 6);
      R.lights.push({ kind: 'lamp', x, y: top + win.h * 0.31, r: 40 });
    }
    stopNames.forEach((name, i) => {
      const cx = X(i * S.seg);
      const half = 520;
      if (cx + half < 0 || cx - half > W) return;
      // tiled station wall, name boards, a platform edge and people waiting
      const x0 = cx - half, x1 = cx + half;
      ctx.fillStyle = '#efe6cf'; ctx.fillRect(x0, top - 10, x1 - x0, win.h * 0.78);
      ctx.strokeStyle = 'rgba(160,140,110,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let yy = top; yy < top + win.h * 0.78; yy += 14) { ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); }
      for (let xx = x0; xx < x1; xx += 22) { ctx.moveTo(xx, top - 10); ctx.lineTo(xx, top + win.h * 0.78); }
      ctx.stroke();
      ctx.fillStyle = TRANSIT.metro.color; ctx.fillRect(x0, top + win.h * 0.12, x1 - x0, 10);
      for (let bx = x0 + 120; bx < x1 - 60; bx += 300) {
        glossyRect(ctx, bx - 70, top + win.h * 0.3, 140, 30, 6, '#2d6cdf', { lw: 2.5 });
        ctx.font = '900 14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        ctx.fillText(name, bx, top + win.h * 0.3 + 15);
      }
      ctx.fillStyle = '#b9b2a2'; ctx.fillRect(x0, top + win.h * 0.78, x1 - x0, win.h * 0.3);
      ctx.fillStyle = '#f2c94c'; ctx.fillRect(x0, top + win.h * 0.78, x1 - x0, 5);
      for (let k = 0; k < 8; k++) person(ctx, x0 + 80 + k * ((x1 - x0 - 160) / 7), top + win.h * 0.8, 1.7, 900 + i * 13 + k, R.clock, { standing: true });
    });
  }
  R.nightGlow(ctx, W, H, metro ? 1 : light);
  // glass reflection
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.moveTo(win.x + win.w * 0.2, top); ctx.lineTo(win.x + win.w * 0.38, top); ctx.lineTo(win.x + win.w * 0.12, bot); ctx.lineTo(win.x - win.w * 0.06, bot); ctx.fill();
  ctx.restore();

  // ---------- inside the vehicle ----------
  const th = metro ? { wall: '#cfd5dc', panel: '#b9c0c9', seat: '#e0783a', pole: '#c9ced6', frame: '#4a4f5a' }
    : tram ? { wall: '#e9e2cf', panel: '#2f8f8a', seat: '#2f6b5a', pole: '#f2c94c', frame: '#2f8f8a' }
      : { wall: '#f2f4f6', panel: '#2d6cdf', seat: '#3e66a3', pole: '#f2c94c', frame: '#2b2140' };
  ctx.save();
  ctx.translate(0, sway);
  ctx.fillStyle = th.wall;
  ctx.beginPath(); ctx.rect(-10, -20, W + 20, H + 40); ctx.roundRect(win.x, win.y, win.w, win.h, 22); ctx.fill('evenodd');
  ctx.fillStyle = th.panel; ctx.fillRect(0, bot + 14, W, H - bot);
  ctx.strokeStyle = OL; ctx.lineWidth = 12; ctx.beginPath(); ctx.roundRect(win.x, win.y, win.w, win.h, 22); ctx.stroke();
  ctx.strokeStyle = th.frame; ctx.lineWidth = 7; ctx.stroke();
  // the route display above the window
  const dy = Math.max(70, top - 40);
  glossyRect(ctx, W * 0.18, dy - 16, W * 0.64, 28, 6, '#1a1a1f', { lw: 2.5, gloss: false });
  ctx.font = '800 13px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffb347';
  ctx.fillText(`${TRANSIT[mode].icon} ${wait ? 'Now: ' + S.fromName : 'Next: ' + S.toName}`, W / 2, dy - 2);
  // hanging straps that swing with the motion
  const swing = Math.sin(R.clock * 2.6) * (wait ? 0.02 : 0.12) + (S.accel || 0) * 0.02;
  for (let i = 0; i < 5; i++) {
    const hx = W * (0.12 + i * 0.19), hy = top - 8;
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(swing + Math.sin(R.clock * 3 + i) * 0.03);
    ctx.strokeStyle = '#6b6575'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 30); ctx.stroke();
    outlined(ctx, () => ctx.ellipse(0, 38, 8, 9, 0, 0, Math.PI * 2), th.pole, 2);
    ctx.fillStyle = th.wall; ctx.beginPath(); ctx.ellipse(0, 38, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = OL; ctx.fillRect(0, top - 12, W, 4);
  // a grab pole
  glossyRect(ctx, W * 0.84, top - 12, 10, H, 5, th.pole, { lw: 2 });
  // seats with fellow passengers, more of them when it's busy
  const seatTop = Math.max(bot + 70, H * (portrait ? 0.72 : 0.78));
  const busy = S.riders || 0;
  [[-20, W * 0.46], [W * 0.54, W + 20]].forEach(([x0, x1], i) => {
    if (busy > (i ? 0.5 : 0.15)) person(ctx, (x0 + x1) / 2 + (i ? -14 : 12), seatTop + 6, 2.6, 1200 + i * 17, R.clock, { back: true });
    glossyRect(ctx, x0, seatTop, x1 - x0, H - seatTop + 30, 24, th.seat, { lw: 3 });
    ctx.fillStyle = shade(th.seat, 0.25); ctx.fillRect(x0 + 2, seatTop + 20, x1 - x0 - 4, 5);
  });
  ctx.restore();
}
