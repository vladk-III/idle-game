// Detailed cartoon cottages for the Focus views, after a classic village tile
// set: a stone foundation, a ground floor of cobbles, brick or plaster, a
// half-timbered upper floor that juts out a little, a fish-scale tiled roof
// with a stone chimney, arched plank doors, blue-glass windows with flower
// boxes, and the odd hedge, street lamp or balcony. Each design is painted
// once into a sprite (front gable plus side wall, slight 3/4 view) and reused;
// sprites repaint when snow comes or goes.
import { hash, mulberry32 } from './rng.js';
import { OL, shade, season, mipFor, drawAffine } from './toon.js';

// roof tile colours: base, dark, light
const TILES = [
  ['#c8463a', '#8e2c2a', '#e8705a'],
  ['#8a5a3c', '#5e3b26', '#b07a52'],
  ['#d8782f', '#9a4e1c', '#f2a052'],
  ['#4a6ab8', '#2f467e', '#7894d8'],
];
const GROUND = ['stone', 'brick', 'plaster', 'stone'];
const TIMBER = [
  { c: '#6b3f2a', hi: '#8f5a3c' }, // dark oak
  { c: '#7a6a2a', hi: '#a0903c' }, // olive
  { c: '#eef2f6', hi: '#ffffff' }, // painted white
];
const PLASTER = ['#f6ead2', '#f0d2a8', '#f6ead2'];

const SW = 280, SH = 290, GY = 278; // sprite size and ground line
const FX0 = 44;                      // left edge of the front wall
const cache = new Map();
let cacheKey = '';

function poly(x, pts) { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); }
function blobs(x, pts) {
  x.beginPath(); for (const [px, py, pr] of pts) { x.moveTo(px + pr + 1.5, py); x.arc(px, py, pr + 1.5, 0, Math.PI * 2); }
  x.fillStyle = OL; x.fill();
  x.beginPath(); for (const [px, py, pr] of pts) { x.moveTo(px + pr, py); x.arc(px, py, pr, 0, Math.PI * 2); }
  x.fillStyle = '#fbfdff'; x.fill();
}

// Fill a clipped area with a wall material.
function material(x, kind, area, r, dark = 0) {
  x.save(); area(); x.clip();
  const d = (c) => (dark ? shade(c, -dark) : c);
  if (kind === 'stone') {
    x.fillStyle = d('#8f9690'); x.fillRect(0, 0, SW, SH);
    for (let y = GY + 4; y > 0; y -= 13) {
      let sx = -r() * 22;
      while (sx < SW) {
        const w = 15 + r() * 15;
        x.beginPath(); x.roundRect(sx + 1.2, y - 12, w - 2.4, 11, 5);
        x.fillStyle = d(['#b3bab2', '#a4ab9f', '#c0c6bc'][Math.floor(r() * 3)]); x.fill();
        x.lineWidth = 1.4; x.strokeStyle = 'rgba(43,33,64,0.55)'; x.stroke();
        if (r() < 0.22) { x.fillStyle = d('#7aa04a'); x.beginPath(); x.ellipse(sx + w * 0.3, y - 3, w * 0.25, 2.4, 0, 0, Math.PI * 2); x.fill(); }
        sx += w;
      }
    }
  } else if (kind === 'brick') {
    x.fillStyle = d('#e8c9a0'); x.fillRect(0, 0, SW, SH);
    for (let y = GY + 4, row = 0; y > 0; y -= 8, row++) {
      for (let bx = (row % 2) * -9; bx < SW; bx += 18) {
        x.fillStyle = d(['#d0623e', '#c4553a', '#dc7048'][Math.floor(r() * 3)]);
        x.fillRect(bx + 1, y - 7, 16, 6);
      }
    }
  } else {
    x.fillStyle = d('#f0c896'); x.fillRect(0, 0, SW, SH);
    // a few cracks in the plaster
    x.strokeStyle = d('#c89a66'); x.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      const cx = r() * SW, cy = GY - r() * 120;
      x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + 4, cy + 6); x.lineTo(cx + 2, cy + 11); x.moveTo(cx + 4, cy + 6); x.lineTo(cx + 9, cy + 8); x.stroke();
    }
  }
  x.restore();
}

// Multi-pane window with a blue glass look, wooden frame and sill.
function windowPanes(x, wx, wy, ww, wh, frame, wins, flowers) {
  x.beginPath(); x.roundRect(wx - 4, wy - 4, ww + 8, wh + 8, 2);
  x.fillStyle = frame; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  x.fillStyle = '#34428c'; x.fillRect(wx, wy, ww, wh);
  const cols = ww > 26 ? 3 : 2, rows = wh > 26 ? 3 : 2;
  const pw = ww / cols, ph = wh / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    x.fillStyle = (i + j) % 2 ? '#5068c0' : '#4558a8';
    x.fillRect(wx + i * pw + 1, wy + j * ph + 1, pw - 2, ph - 2);
    x.fillStyle = 'rgba(200,220,255,0.55)';
    x.fillRect(wx + i * pw + 2, wy + j * ph + 2, 2, ph * 0.5);
  }
  x.strokeStyle = frame; x.lineWidth = 2;
  for (let i = 1; i < cols; i++) { x.beginPath(); x.moveTo(wx + i * pw, wy); x.lineTo(wx + i * pw, wy + wh); x.stroke(); }
  for (let j = 1; j < rows; j++) { x.beginPath(); x.moveTo(wx, wy + j * ph); x.lineTo(wx + ww, wy + j * ph); x.stroke(); }
  wins.push({ x: wx, y: wy, w: ww, h: wh });
  x.beginPath(); x.roundRect(wx - 6, wy + wh + 3, ww + 12, 5, 2); x.fillStyle = shade(frame, -0.15); x.fill(); x.lineWidth = 1.6; x.strokeStyle = OL; x.stroke();
  if (flowers) {
    x.beginPath(); x.roundRect(wx - 3, wy + wh + 8, ww + 6, 7, 2); x.fillStyle = '#8a5a35'; x.fill(); x.stroke();
    for (let i = 0; i < 6; i++) {
      const fx = wx - 1 + (i * (ww + 2)) / 5;
      x.fillStyle = '#3f8a35'; x.beginPath(); x.arc(fx, wy + wh + 8, 3, 0, Math.PI * 2); x.fill();
      if (i % 2 === 0) { x.fillStyle = '#e8384a'; x.beginPath(); x.arc(fx + 1, wy + wh + 5.5, 2.6, 0, Math.PI * 2); x.fill(); x.fillStyle = '#ffd84a'; x.fillRect(fx, wy + wh + 5, 1.5, 1.5); }
    }
  }
}

// House geometry in sprite pixels, shared by all the pieces.
function geometry(wide) {
  const fx0 = FX0, fx1 = wide ? FX0 + 140 : FX0 + 116;
  const groundTop = GY - 56, wallTop = GY - 104, jet = 5;
  const ux0 = fx0 - jet, ux1 = fx1 + jet;
  const mid = (fx0 + fx1) / 2, apexY = wallTop - (fx1 - fx0) * 0.6;
  const ov = 9;
  return {
    fx0, fx1, groundTop, wallTop, jet, ux0, ux1, mid, apexY, ov,
    eL: [ux0 - ov, wallTop + ov * 0.6], eR: [ux1 + ov, wallTop + ov * 0.6], ap: [mid, apexY - 7],
  };
}
const DEPTH = 120; // sprite pixels from front to back

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineCap = 'round';
  return { c, x };
}

// The front: ground floor, timbered upper floor and gable, door, windows,
// bargeboards and anything standing beside the house.
function paintFront(roofIdx, groundIdx, wide, extra) {
  const { c, x } = canvas(SW, SH);
  const r = mulberry32(roofIdx * 97 + groundIdx * 13 + (wide ? 5 : 1) + extra * 7);
  const ground = GROUND[groundIdx];
  const timber = TIMBER[(roofIdx + groundIdx) % TIMBER.length];
  const plaster = PLASTER[(roofIdx + groundIdx) % PLASTER.length];
  const wins = [];
  const { fx0, fx1, groundTop, wallTop, ux0, ux1, mid, apexY, eL, eR, ap } = geometry(wide);

  // ground floor and foundation
  const frontLow = () => poly(x, [[fx0, GY], [fx0, groundTop], [fx1, groundTop], [fx1, GY]]);
  material(x, ground, frontLow, r);
  frontLow(); x.lineWidth = 3; x.strokeStyle = OL; x.stroke();
  poly(x, [[fx0 - 2, GY + 2], [fx0 - 2, GY - 9], [fx1 + 2, GY - 9], [fx1 + 2, GY + 2]]);
  x.fillStyle = '#9aa29a'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.strokeStyle = 'rgba(43,33,64,0.4)'; x.lineWidth = 1.2;
  for (let bx = fx0 + 12; bx < fx1; bx += 16) { x.beginPath(); x.moveTo(bx, GY - 9); x.lineTo(bx, GY + 1); x.stroke(); }

  // half-timbered upper floor and gable
  const frontHigh = () => poly(x, [[ux0, groundTop], [ux0, wallTop], [mid, apexY], [ux1, wallTop], [ux1, groundTop]]);
  frontHigh(); x.fillStyle = plaster; x.fill();
  x.save(); frontHigh(); x.clip();
  x.strokeStyle = timber.c; x.lineWidth = 7; x.lineCap = 'butt';
  const panels = wide ? 3 : 2;
  const pw = (ux1 - ux0) / panels;
  x.beginPath();
  for (let i = 0; i <= panels; i++) { const px = ux0 + i * pw + (i === 0 ? 3.5 : i === panels ? -3.5 : 0); x.moveTo(px, groundTop); x.lineTo(px, wallTop); }
  x.moveTo(ux0, wallTop + 3); x.lineTo(ux1, wallTop + 3);
  x.moveTo(mid, wallTop); x.lineTo(mid, apexY + 6);
  x.moveTo(mid, wallTop - (wallTop - apexY) * 0.35); x.lineTo(mid - (mid - ux0) * 0.55, wallTop);
  x.moveTo(mid, wallTop - (wallTop - apexY) * 0.35); x.lineTo(mid + (ux1 - mid) * 0.55, wallTop);
  x.stroke();
  const winPanels = wide ? [0, 2] : [0];
  x.lineWidth = 5;
  for (let i = 0; i < panels; i++) {
    if (winPanels.includes(i)) continue;
    const a = ux0 + i * pw + 4, b = ux0 + (i + 1) * pw - 4;
    x.beginPath(); x.moveTo(a, groundTop - 2); x.lineTo(b, wallTop + 6); x.moveTo(b, groundTop - 2); x.lineTo(a, wallTop + 6); x.stroke();
  }
  x.strokeStyle = timber.hi; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(ux0 + 1.5, wallTop + 4); x.lineTo(ux0 + 1.5, groundTop - 4); x.stroke();
  x.restore();
  frontHigh(); x.lineWidth = 3; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.roundRect(ux0 - 2, groundTop - 4, ux1 - ux0 + 4, 8, 2);
  x.fillStyle = timber.c; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.moveTo(ux0, groundTop - 2); x.lineTo(ux1, groundTop - 2); x.strokeStyle = timber.hi; x.lineWidth = 1.5; x.stroke();
  for (let bx = ux0 + 8; bx < ux1 - 4; bx += 16) {
    x.beginPath(); x.roundRect(bx, groundTop + 4, 6, 5, 1); x.fillStyle = shade(timber.c, -0.2); x.fill(); x.lineWidth = 1.2; x.strokeStyle = OL; x.stroke();
  }

  // arched plank door in a stone surround
  const dw = 26, dh = 40;
  const dX = wide ? fx0 + 18 : mid - dw / 2 + (r() < 0.5 ? -26 : 26);
  x.beginPath(); x.moveTo(dX - 5, GY - 8); x.lineTo(dX - 5, GY - dh + 4); x.arc(dX + dw / 2, GY - dh + 4, dw / 2 + 5, Math.PI, 0); x.lineTo(dX + dw + 5, GY - 8); x.closePath();
  x.fillStyle = '#b3bab2'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  const doorPath = () => { x.beginPath(); x.moveTo(dX, GY - 8); x.lineTo(dX, GY - dh + 4); x.arc(dX + dw / 2, GY - dh + 4, dw / 2, Math.PI, 0); x.lineTo(dX + dw, GY - 8); x.closePath(); };
  doorPath(); x.fillStyle = '#8a5a35'; x.fill();
  x.save(); doorPath(); x.clip();
  x.strokeStyle = '#5e3b26'; x.lineWidth = 1.6;
  for (let px = dX + dw / 4; px < dX + dw; px += dw / 4) { x.beginPath(); x.moveTo(px, GY - dh - 10); x.lineTo(px, GY); x.stroke(); }
  x.fillStyle = '#3a3340';
  for (const hy of [GY - dh + 10, GY - 18]) x.fillRect(dX, hy, dw * 0.55, 3);
  x.restore();
  doorPath(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.fillStyle = '#f5c542'; x.beginPath(); x.arc(dX + dw - 6, GY - 8 - dh / 2.4, 2.2, 0, Math.PI * 2); x.fill();

  // windows
  const bigX = wide ? fx0 + 66 : (dX < mid ? mid + 8 : fx0 + 12);
  windowPanes(x, bigX, GY - 46, wide ? 34 : 30, 28, timber.c, wins, false);
  if (wide) windowPanes(x, fx0 + 110, GY - 46, 22, 28, timber.c, wins, false);
  for (const pi of winPanels) windowPanes(x, ux0 + pi * pw + pw / 2 - 12, wallTop + 12, 24, 22, timber.c, wins, true);
  const ry = wallTop - (wallTop - apexY) * 0.45;
  x.beginPath(); x.arc(mid, ry, 10, 0, Math.PI * 2); x.fillStyle = timber.c; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.arc(mid, ry, 6.5, 0, Math.PI * 2); x.fillStyle = '#4558a8'; x.fill();
  x.strokeStyle = timber.c; x.lineWidth = 1.8;
  x.beginPath(); x.moveTo(mid - 6.5, ry); x.lineTo(mid + 6.5, ry); x.moveTo(mid, ry - 6.5); x.lineTo(mid, ry + 6.5); x.stroke();
  wins.push({ x: mid - 5, y: ry - 5, w: 10, h: 10 });

  if (wide && extra === 2) {
    const bx0 = ux0 + pw + 6, bx1 = ux0 + 2 * pw - 6, by = groundTop - 6;
    x.beginPath(); x.roundRect(bx0 - 4, by - 2, bx1 - bx0 + 8, 6, 2); x.fillStyle = timber.c; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
    x.strokeStyle = '#3a3340'; x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(bx0, by - 20); x.lineTo(bx1, by - 20);
    for (let px = bx0; px <= bx1; px += 5) { x.moveTo(px, by - 20); x.lineTo(px, by - 2); }
    x.stroke();
  }

  // bargeboards over the gable
  x.lineWidth = 12; x.strokeStyle = OL;
  x.beginPath(); x.moveTo(eL[0], eL[1]); x.lineTo(ap[0], ap[1]); x.lineTo(eR[0], eR[1]); x.stroke();
  x.lineWidth = 7; x.strokeStyle = timber.c; x.stroke();
  x.lineWidth = 2; x.strokeStyle = timber.hi;
  x.beginPath(); x.moveTo(eL[0] + 3, eL[1] - 3); x.lineTo(ap[0], ap[1] - 3); x.stroke();

  // a hedge or a street lamp beside some houses
  if (extra === 0) {
    const hx = fx0 - 36, leaves = [];
    for (let i = 0; i < 9; i++) leaves.push([hx + 4 + (i % 5) * 7, GY - 8 - Math.floor(i / 5) * 9 - r() * 3, 7 + r() * 2]);
    x.beginPath(); for (const [px, py, pr] of leaves) { x.moveTo(px + pr + 2, py); x.arc(px, py, pr + 2, 0, Math.PI * 2); }
    x.fillStyle = OL; x.fill();
    x.beginPath(); for (const [px, py, pr] of leaves) { x.moveTo(px + pr, py); x.arc(px, py, pr, 0, Math.PI * 2); }
    x.fillStyle = '#3f8a35'; x.fill();
    x.fillStyle = '#6cbf4a';
    for (const [px, py, pr] of leaves) { x.beginPath(); x.arc(px - pr * 0.3, py - pr * 0.35, pr * 0.45, 0, Math.PI * 2); x.fill(); }
    if (season.snow > 0.05) blobs(x, leaves.filter((l) => l[1] < GY - 12).map(([px, py, pr]) => [px, py - pr * 0.5, pr * 0.6]));
  } else if (extra === 1 || !wide) {
    const lx = fx0 - 20;
    x.lineWidth = 2; x.strokeStyle = OL; x.fillStyle = '#2f6b4a';
    x.beginPath(); x.roundRect(lx - 3, GY - 70, 6, 70, 2); x.fill(); x.stroke();
    x.beginPath(); x.roundRect(lx - 6, GY - 6, 12, 6, 2); x.fill(); x.stroke();
    x.beginPath(); x.arc(lx, GY - 78, 9, 0, Math.PI * 2); x.fillStyle = '#fbf6e0'; x.fill(); x.stroke();
    x.beginPath(); x.roundRect(lx - 6, GY - 90, 12, 5, 2); x.fillStyle = '#2f6b4a'; x.fill(); x.stroke();
    wins.push({ x: lx - 6, y: GY - 84, w: 12, h: 12, lamp: true });
  }

  if (season.snow > 0.05) {
    x.globalAlpha = Math.min(1, season.snow * 1.2);
    const edge = () => { x.beginPath(); x.moveTo(eL[0], eL[1] - 3); x.lineTo(ap[0], ap[1] - 4); x.lineTo(eR[0], eR[1] - 3); };
    edge(); x.lineWidth = 11; x.strokeStyle = OL; x.stroke();
    edge(); x.lineWidth = 7.5; x.strokeStyle = '#fbfdff'; x.stroke();
    const lumps = [];
    for (let i = 0; i < 6; i++) {
      const t = r(), e0 = r() < 0.5 ? eL : eR;
      lumps.push([e0[0] + (ap[0] - e0[0]) * t, e0[1] + (ap[1] - e0[1]) * t - 5, 3.5 + r() * 3.5]);
    }
    blobs(x, lumps);
    edge(); x.lineWidth = 6; x.strokeStyle = '#fbfdff'; x.stroke();
    x.fillStyle = '#fbfdff'; x.lineWidth = 1.5; x.strokeStyle = OL;
    x.beginPath(); x.roundRect(ux0 - 2, groundTop - 8, ux1 - ux0 + 4, 5, 2.5); x.fill(); x.stroke();
    x.globalAlpha = 1;
  }
  return { c, wins };
}

// The side wall, as a flat texture: u runs from the front corner to the back.
function paintSide(roofIdx, groundIdx, wide) {
  const { groundTop, wallTop } = geometry(wide);
  const h = GY + 2 - wallTop;
  const { c, x } = canvas(DEPTH, h);
  const r = mulberry32(roofIdx * 53 + groundIdx * 11 + (wide ? 3 : 1));
  const timber = TIMBER[(roofIdx + groundIdx) % TIMBER.length];
  const plaster = PLASTER[(roofIdx + groundIdx) % PLASTER.length];
  const wins = [];
  const gT = groundTop - wallTop;
  // the whole side sits a little in shadow
  material(x, GROUND[groundIdx], () => { x.beginPath(); x.rect(0, gT, DEPTH, h - gT); }, r, 0.15);
  x.fillStyle = shade(plaster, -0.12); x.fillRect(0, 0, DEPTH, gT);
  x.strokeStyle = shade(timber.c, -0.1); x.lineWidth = 6; x.lineCap = 'butt';
  x.beginPath();
  for (const px of [3, DEPTH / 2, DEPTH - 3]) { x.moveTo(px, 0); x.lineTo(px, gT); }
  x.moveTo(0, 3); x.lineTo(DEPTH, 3);
  x.moveTo(8, gT - 2); x.lineTo(DEPTH / 2 - 6, 8);
  x.stroke(); x.lineCap = 'round';
  // jetty beam along the side, then the foundation
  x.fillStyle = timber.c; x.fillRect(0, gT - 4, DEPTH, 8);
  x.strokeStyle = OL; x.lineWidth = 2; x.strokeRect(0, gT - 4, DEPTH, 8);
  x.fillStyle = '#8f978f'; x.fillRect(0, h - 11, DEPTH, 11);
  x.strokeRect(0, h - 11, DEPTH, 11);
  // windows: one upstairs, one down
  windowPanes(x, DEPTH * 0.62, 12, 22, 20, timber.c, wins, false);
  windowPanes(x, DEPTH * 0.18, gT + 12, 20, 22, timber.c, wins, false);
  x.lineWidth = 3; x.strokeStyle = OL; x.strokeRect(1.5, 1.5, DEPTH - 3, h - 3);
  return { c, wins };
}

// One roof slope as a flat texture: u from the front gable to the back, v from
// the ridge down to the eave (with room below for icicles).
function paintRoof(roofIdx, wide, extra) {
  const { ap, eR } = geometry(wide);
  const slope = Math.hypot(eR[0] - ap[0], eR[1] - ap[1]);
  const W = DEPTH + 14, H = Math.round(slope + 16);
  const { c, x } = canvas(W, H);
  const r = mulberry32(roofIdx * 41 + extra * 9 + (wide ? 2 : 0));
  const [tile, tileDark, tileLight] = TILES[roofIdx];
  const wins = [];
  x.save(); x.beginPath(); x.rect(0, 0, W, slope); x.clip();
  x.fillStyle = tileDark; x.fillRect(0, 0, W, slope);
  const rowsN = Math.round(slope / 10);
  for (let j = 0; j <= rowsN; j++) {
    const py = (j / rowsN) * slope;
    for (let i = -1; i <= W / 15 + 1; i++) {
      const px = i * 15 + (j % 2) * 7.5;
      x.beginPath(); x.arc(px, py, 7.5, 0, Math.PI); x.lineTo(px - 7.5, py - 8); x.lineTo(px + 7.5, py - 8); x.closePath();
      x.fillStyle = j % 3 === 1 ? tileLight : tile; x.fill();
      x.beginPath(); x.arc(px, py, 7.5, 0.1, Math.PI - 0.1); x.lineWidth = 1.5; x.strokeStyle = tileDark; x.stroke();
    }
  }
  const g = x.createLinearGradient(0, slope * 0.4, 0, slope);
  g.addColorStop(0, 'rgba(30,10,30,0)'); g.addColorStop(1, 'rgba(30,10,30,0.25)');
  x.fillStyle = g; x.fillRect(0, 0, W, slope);
  if (extra === 1) {
    x.beginPath(); x.roundRect(W * 0.5, slope * 0.3, 26, 22, 2); x.fillStyle = '#3a4a96'; x.fill();
    x.lineWidth = 3; x.strokeStyle = '#6b3f2a'; x.stroke(); x.lineWidth = 1.5; x.strokeStyle = OL; x.stroke();
    wins.push({ x: W * 0.5, y: slope * 0.3, w: 26, h: 22 });
  }
  // ridge cap along the top
  x.fillStyle = tileDark; x.fillRect(0, 0, W, 5);
  x.restore();
  x.lineWidth = 3; x.strokeStyle = OL; x.strokeRect(1.5, 1.5, W - 3, slope - 3);
  if (season.snow > 0.05) {
    x.globalAlpha = Math.min(1, season.snow * 1.2);
    const blanket = () => {
      x.beginPath(); x.moveTo(0, 0); x.lineTo(W, 0); x.lineTo(W, slope * (0.72 + r() * 0.1));
      const steps = 7;
      for (let i = steps - 1; i >= 0; i--) {
        const u = (i / steps) * W, mu = ((i + 0.5) / steps) * W;
        x.quadraticCurveTo(mu, slope * (0.84 + r() * 0.1), u, slope * (0.66 + r() * 0.16));
      }
      x.closePath();
    };
    blanket(); x.fillStyle = '#fbfdff'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
    x.strokeStyle = '#dbe8f6'; x.lineWidth = 5;
    x.beginPath(); for (let i = 0; i <= 8; i++) { const px = (i / 8) * W, py = slope * (0.58 + r() * 0.06); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
    x.fillStyle = '#d6f0ff'; x.lineWidth = 1; x.strokeStyle = OL;
    for (let px = 8; px < W - 4; px += 13 + r() * 6) {
      const len = 5 + r() * 9;
      poly(x, [[px - 2.5, slope - 1], [px, slope - 1 + len], [px + 2.5, slope - 1]]); x.fill(); x.stroke();
    }
    x.globalAlpha = 1;
  }
  return { c, wins, slope };
}

function paintChimney() {
  const { c, x } = canvas(30, 44);
  const r = mulberry32(99);
  const pts = [[6, 44], [6, 12], [24, 12], [24, 44]];
  material(x, 'stone', () => poly(x, pts), r);
  poly(x, pts); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.roundRect(3, 6, 24, 7, 2); x.fillStyle = '#7d847c'; x.fill(); x.stroke();
  if (season.snow > 0.05) {
    x.beginPath(); x.ellipse(15, 6, 13, 4.5, 0, 0, Math.PI * 2);
    x.fillStyle = '#fbfdff'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  }
  return { c };
}

function get(id, paint) {
  const k = `${Math.round(season.snow * 4)}`;
  if (k !== cacheKey) { cache.clear(); cacheKey = k; }
  let v = cache.get(id);
  if (!v) { v = paint(); cache.set(id, v); }
  return v;
}

// Map a flat texture onto a quad that recedes in perspective. near0/near1 are
// the two corners on the front edge (top, bottom); the far edge is found by
// moving them toward the vanishing point. It's drawn as thin affine strips,
// clipped to the quad, which is close enough to true perspective at this size.
function drawReceding(ctx, tex0, vp, f, nearTop, nearBot, texH0, strips, uMax = 1) {
  const g = (t) => 1 / (1 + t * (1 / f - 1));
  const at = (p, t) => [vp[0] + (p[0] - vp[0]) * g(t), vp[1] + (p[1] - vp[1]) * g(t)];
  const quad = [nearTop, at(nearTop, uMax), at(nearBot, uMax), nearBot];
  // a smaller copy of the texture when the quad is small on screen
  const span = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]) + Math.abs(nearBot[1] - nearTop[1]);
  const tex = mipFor(tex0, span);
  const texH = texH0 * (tex.height / tex0.height);
  const big = span > 90; // clipping is costly; only big quads need perfectly straight edges
  ctx.save();
  if (big) { ctx.beginPath(); quad.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.clip(); }
  const texW = tex.width;
  const base = ctx.getTransform();
  for (let i = 0; i < strips; i++) {
    const t0 = (i / strips) * uMax, t1 = ((i + 1) / strips) * uMax;
    const o = at(nearTop, t0), e = at(nearTop, t1), b = at(nearBot, t0);
    const k = tex.height / texH;
    drawAffine(ctx, base, tex, (t0 / uMax) * texW, 0, (texW / strips) * 1.06, tex.height,
      (e[0] - o[0]) * 1.06, (e[1] - o[1]) * 1.06, (b[0] - o[0]) * k, (b[1] - o[1]) * k, o[0], o[1]);
  }
  ctx.setTransform(base);
  ctx.restore();
  return at;
}

// Draw a house whose front faces the viewer, standing at (x, y) with a front
// w pixels wide. The side wall and roof recede toward the vanishing point
// persp.vp, with persp.f = how much the back is scaled relative to the front.
export function drawHouseSprite(ctx, x, y, w, c, seed, persp, lights) {
  const groundIdx = Math.floor(hash(seed, 31) * GROUND.length);
  const wide = hash(seed, 32) < 0.35;
  const extra = Math.floor(hash(seed, 33) * 3);
  const roofIdx = c % TILES.length;
  const front = get(`f${roofIdx}.${groundIdx}.${wide | 0}.${extra}`, () => paintFront(roofIdx, groundIdx, wide, extra));
  const side = get(`s${roofIdx}.${groundIdx}.${wide | 0}`, () => paintSide(roofIdx, groundIdx, wide));
  const roof = get(`r${roofIdx}.${wide | 0}.${extra}`, () => paintRoof(roofIdx, wide, extra));
  const chim = get('chim', paintChimney);
  const G = geometry(wide);
  const frontW = G.fx1 - G.fx0;
  const sc = w / frontW;
  const left = x - (FX0 + frontW / 2) * sc, top = y - GY * sc;
  const S = (sx, sy) => [left + sx * sc, top + sy * sc];
  const vp = persp ? persp.vp : [x, -1e6];
  const f = persp ? persp.f : 0.85;
  const strips = w > 90 ? 6 : w > 40 ? 3 : 2;

  const xl = S(G.ux0, 0)[0], xr = S(G.ux1, 0)[0];
  const sideDir = xr < vp[0] - 1 ? 1 : xl > vp[0] + 1 ? -1 : 0; // which side faces the vanishing point
  if (sideDir) {
    const ex = sideDir > 0 ? G.ux1 : G.ux0;
    const nearTop = S(ex, G.wallTop), nearBot = S(ex, GY + 2);
    drawReceding(ctx, side.c, vp, f, nearTop, nearBot, side.c.height, strips);
    const eave = sideDir > 0 ? G.eR : G.eL;
    const rTop = S(G.ap[0], G.ap[1]), rEave = S(eave[0], eave[1]);
    const at = drawReceding(ctx, roof.c, vp, f, rTop, rEave, roof.slope, strips, 1.1);
    // chimney standing on the roof, near the ridge
    const t = 0.45, ridge = at(rTop, t), ev = at(rEave, t);
    const base = [ridge[0] + (ev[0] - ridge[0]) * 0.28, ridge[1] + (ev[1] - ridge[1]) * 0.28];
    const cs = sc * (1 / (1 + t * (1 / f - 1)));
    ctx.drawImage(chim.c, base[0] - 15 * cs, base[1] - 40 * cs, 30 * cs, 44 * cs);
  } else {
    // seen straight on: just the chimney peeking over the ridge
    const base = S(G.ap[0] + (G.eR[0] - G.ap[0]) * 0.35, G.ap[1] + 14);
    ctx.drawImage(chim.c, base[0] - 15 * sc * 0.9, base[1] - 40 * sc * 0.9, 30 * sc * 0.9, 44 * sc * 0.9);
  }
  ctx.drawImage(mipFor(front.c, SW * sc), left, top, SW * sc, SH * sc);
  if (lights) {
    for (const wnd of front.wins) {
      const [wx, wy] = S(wnd.x, wnd.y);
      if (wnd.lamp) lights.push({ kind: 'lamp', x: wx + (wnd.w * sc) / 2, y: wy + (wnd.h * sc) / 2, r: Math.max(6, 18 * sc) });
      else lights.push({ kind: 'win', x: wx, y: wy, w: wnd.w * sc, h: wnd.h * sc });
    }
  }
}
