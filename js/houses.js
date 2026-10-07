// Detailed cartoon cottages for the Focus views, after a classic village tile
// set: a stone foundation, a ground floor of cobbles, brick or plaster, a
// half-timbered upper floor that juts out a little, a fish-scale tiled roof
// with a stone chimney, arched plank doors, blue-glass windows with flower
// boxes, and the odd hedge, street lamp or balcony. Each design is painted
// once into a sprite (front gable plus side wall, slight 3/4 view) and reused;
// sprites repaint when snow comes or goes.
import { hash, mulberry32 } from './rng.js';
import { OL, shade, season } from './toon.js';

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

function paintHouse(roofIdx, groundIdx, wide, extra) {
  const c = document.createElement('canvas');
  c.width = SW; c.height = SH;
  const x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineCap = 'round';
  const r = mulberry32(roofIdx * 97 + groundIdx * 13 + (wide ? 5 : 1) + extra * 7);
  const ground = GROUND[groundIdx];
  const timber = TIMBER[(roofIdx + groundIdx) % TIMBER.length];
  const plaster = PLASTER[(roofIdx + groundIdx) % PLASTER.length];
  const [tile, tileDark, tileLight] = TILES[roofIdx];
  const wins = [];

  const fx0 = FX0, fx1 = wide ? FX0 + 140 : FX0 + 116;
  const groundTop = GY - 56, wallTop = GY - 104;
  const jet = 5; // the upper floor juts out over the ground floor
  const mid = (fx0 + fx1) / 2, apexY = wallTop - (fx1 - fx0) * 0.6;
  const dx = 60, dy = -22; // the side wall recedes up and to the right

  x.fillStyle = 'rgba(25,20,60,0.25)';
  x.beginPath(); x.ellipse((fx0 + fx1 + dx) / 2 + 6, GY + 2, (fx1 - fx0 + dx) * 0.6, 8, 0, 0, Math.PI * 2); x.fill();

  // ---- side wall: ground material below, timbered plaster above
  const sideLow = () => poly(x, [[fx1, GY], [fx1 + dx, GY + dy], [fx1 + dx, groundTop + dy], [fx1, groundTop]]);
  const sideHigh = () => poly(x, [[fx1 + jet, groundTop], [fx1 + dx + jet, groundTop + dy], [fx1 + dx + jet, wallTop + dy], [fx1 + jet, wallTop]]);
  material(x, ground, sideLow, r, 0.2);
  sideLow(); x.lineWidth = 3; x.strokeStyle = OL; x.stroke();
  sideHigh(); x.fillStyle = shade(plaster, -0.16); x.fill();
  x.strokeStyle = shade(timber.c, -0.15); x.lineWidth = 5; x.lineCap = 'butt';
  x.beginPath();
  x.moveTo(fx1 + jet + dx * 0.5, groundTop + dy * 0.5); x.lineTo(fx1 + jet + dx * 0.5, wallTop + dy * 0.5);
  x.moveTo(fx1 + jet + dx * 0.08, groundTop + dy * 0.08 - 2); x.lineTo(fx1 + jet + dx * 0.42, wallTop + dy * 0.42 + 2);
  x.stroke(); x.lineCap = 'round';
  sideHigh(); x.lineWidth = 3; x.strokeStyle = OL; x.stroke();
  const s0 = fx1 + jet + dx * 0.6, s1 = fx1 + jet + dx * 0.9, sy0 = wallTop + 14;
  poly(x, [[s0, sy0 + dy * 0.6], [s1, sy0 + dy * 0.9], [s1, sy0 + 24 + dy * 0.9], [s0, sy0 + 24 + dy * 0.6]]);
  x.fillStyle = '#3a4a96'; x.fill(); x.lineWidth = 3; x.strokeStyle = timber.c; x.stroke(); x.lineWidth = 1.5; x.strokeStyle = OL; x.stroke();
  wins.push({ x: s0, y: sy0 + dy * 0.9, w: s1 - s0, h: 24 });

  // ---- front: ground floor and stone foundation
  const frontLow = () => poly(x, [[fx0, GY], [fx0, groundTop], [fx1, groundTop], [fx1, GY]]);
  material(x, ground, frontLow, r);
  frontLow(); x.lineWidth = 3; x.strokeStyle = OL; x.stroke();
  const found = () => poly(x, [[fx0 - 2, GY + 2], [fx0 - 2, GY - 9], [fx1, GY - 9], [fx1 + dx, GY - 9 + dy], [fx1 + dx, GY + 2 + dy], [fx1, GY + 2]]);
  found(); x.fillStyle = '#9aa29a'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.strokeStyle = 'rgba(43,33,64,0.4)'; x.lineWidth = 1.2;
  for (let bx = fx0 + 12; bx < fx1; bx += 16) { x.beginPath(); x.moveTo(bx, GY - 9); x.lineTo(bx, GY + 1); x.stroke(); }

  // ---- front: half-timbered upper floor and gable
  const ux0 = fx0 - jet, ux1 = fx1 + jet;
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
  // X braces in the panels that don't hold a window
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
  // jetty beam and joist ends
  x.beginPath(); x.roundRect(ux0 - 2, groundTop - 4, ux1 - ux0 + 4, 8, 2);
  x.fillStyle = timber.c; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.moveTo(ux0, groundTop - 2); x.lineTo(ux1, groundTop - 2); x.strokeStyle = timber.hi; x.lineWidth = 1.5; x.stroke();
  for (let bx = ux0 + 8; bx < ux1 - 4; bx += 16) {
    x.beginPath(); x.roundRect(bx, groundTop + 4, 6, 5, 1); x.fillStyle = shade(timber.c, -0.2); x.fill(); x.lineWidth = 1.2; x.strokeStyle = OL; x.stroke();
  }

  // ---- arched plank door in a stone surround
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

  // ---- windows
  const bigX = wide ? fx0 + 66 : (dX < mid ? mid + 8 : fx0 + 12);
  windowPanes(x, bigX, GY - 46, wide ? 34 : 30, 28, timber.c, wins, false);
  if (wide) windowPanes(x, fx0 + 110, GY - 46, 22, 28, timber.c, wins, false);
  for (const pi of winPanels) {
    const px = ux0 + pi * pw + pw / 2 - 12;
    windowPanes(x, px, wallTop + 12, 24, 22, timber.c, wins, true);
  }
  const ry = wallTop - (wallTop - apexY) * 0.45;
  x.beginPath(); x.arc(mid, ry, 10, 0, Math.PI * 2); x.fillStyle = timber.c; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.arc(mid, ry, 6.5, 0, Math.PI * 2); x.fillStyle = '#4558a8'; x.fill();
  x.strokeStyle = timber.c; x.lineWidth = 1.8;
  x.beginPath(); x.moveTo(mid - 6.5, ry); x.lineTo(mid + 6.5, ry); x.moveTo(mid, ry - 6.5); x.lineTo(mid, ry + 6.5); x.stroke();
  wins.push({ x: mid - 5, y: ry - 5, w: 10, h: 10 });

  // ---- balcony on some wider houses
  if (wide && extra === 2) {
    const bx0 = ux0 + pw + 6, bx1 = ux0 + 2 * pw - 6, by = groundTop - 6;
    x.beginPath(); x.roundRect(bx0 - 4, by - 2, bx1 - bx0 + 8, 6, 2); x.fillStyle = timber.c; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
    x.strokeStyle = '#3a3340'; x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(bx0, by - 20); x.lineTo(bx1, by - 20);
    for (let px = bx0; px <= bx1; px += 5) { x.moveTo(px, by - 20); x.lineTo(px, by - 2); }
    x.stroke();
  }

  // ---- roof: side plane in fish-scale tiles
  const ov = 9;
  const eL = [ux0 - ov, wallTop + ov * 0.6], eR = [ux1 + ov, wallTop + ov * 0.6], ap = [mid, apexY - 7];
  const sideV = [dx + 4, dy];
  const at = (u, v) => [ap[0] + (eR[0] - ap[0]) * v + sideV[0] * u, ap[1] + (eR[1] - ap[1]) * v + sideV[1] * u];
  const roofSide = () => poly(x, [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]);
  roofSide(); x.fillStyle = tileDark; x.fill();
  x.save(); roofSide(); x.clip();
  const rowsN = 10, perRow = 7;
  for (let j = 0; j <= rowsN; j++) {
    const v = j / rowsN;
    for (let i = -1; i <= perRow; i++) {
      const [px, py] = at((i + (j % 2) * 0.5) / perRow, v);
      x.beginPath(); x.arc(px, py, 7.5, 0, Math.PI);
      x.lineTo(px - 7.5, py - 8); x.lineTo(px + 7.5, py - 8); x.closePath();
      x.fillStyle = j % 3 === 1 ? tileLight : tile; x.fill();
      x.beginPath(); x.arc(px, py, 7.5, 0.1, Math.PI - 0.1); x.lineWidth = 1.5; x.strokeStyle = tileDark; x.stroke();
    }
  }
  const shadeG = x.createLinearGradient(...at(0, 0.4), ...at(0, 1));
  shadeG.addColorStop(0, 'rgba(30,10,30,0)'); shadeG.addColorStop(1, 'rgba(30,10,30,0.25)');
  x.fillStyle = shadeG; roofSide(); x.fill();
  if (extra === 1) {
    const q = [at(0.55, 0.35), at(0.75, 0.35), at(0.75, 0.6), at(0.55, 0.6)];
    poly(x, q); x.fillStyle = '#3a4a96'; x.fill(); x.lineWidth = 3; x.strokeStyle = timber.c; x.stroke(); x.lineWidth = 1.5; x.strokeStyle = OL; x.stroke();
    wins.push({ x: q[0][0], y: q[1][1], w: q[1][0] - q[0][0], h: q[2][1] - q[1][1] });
  }
  x.restore();
  roofSide(); x.lineWidth = 3; x.strokeStyle = OL; x.stroke();
  x.lineWidth = 7; x.strokeStyle = OL;
  x.beginPath(); x.moveTo(...at(0, 0)); x.lineTo(...at(1, 0)); x.stroke();
  x.lineWidth = 4; x.strokeStyle = tileDark; x.stroke();

  // ---- stone chimney
  const [cxm, cym] = at(0.62, 0.3);
  const chimPts = [[cxm - 9, cym + 6], [cxm - 9, cym - 26], [cxm + 9, cym - 26], [cxm + 9, cym + 2]];
  material(x, 'stone', () => poly(x, chimPts), r);
  poly(x, chimPts); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.roundRect(cxm - 12, cym - 31, 24, 6, 2); x.fillStyle = '#7d847c'; x.fill(); x.stroke();

  // ---- bargeboards over the gable
  x.lineWidth = 12; x.strokeStyle = OL;
  x.beginPath(); x.moveTo(eL[0], eL[1]); x.lineTo(ap[0], ap[1]); x.lineTo(eR[0], eR[1]); x.stroke();
  x.lineWidth = 7; x.strokeStyle = timber.c; x.stroke();
  x.lineWidth = 2; x.strokeStyle = timber.hi;
  x.beginPath(); x.moveTo(eL[0] + 3, eL[1] - 3); x.lineTo(ap[0], ap[1] - 3); x.stroke();

  // ---- extras beside the house
  if (extra === 0) {
    const hx = fx0 - 36;
    const leaves = [];
    for (let i = 0; i < 9; i++) leaves.push([hx + 4 + (i % 5) * 7, GY - 8 - Math.floor(i / 5) * 9 - r() * 3, 7 + r() * 2]);
    x.beginPath(); for (const [px, py, pr] of leaves) { x.moveTo(px + pr + 2, py); x.arc(px, py, pr + 2, 0, Math.PI * 2); }
    x.fillStyle = OL; x.fill();
    x.beginPath(); for (const [px, py, pr] of leaves) { x.moveTo(px + pr, py); x.arc(px, py, pr, 0, Math.PI * 2); }
    x.fillStyle = '#3f8a35'; x.fill();
    x.fillStyle = '#6cbf4a';
    for (const [px, py, pr] of leaves) { x.beginPath(); x.arc(px - pr * 0.3, py - pr * 0.35, pr * 0.45, 0, Math.PI * 2); x.fill(); }
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
    // a blanket of snow over the roof with a lumpy lower edge
    const blanket = () => {
      x.beginPath();
      x.moveTo(...at(0, -0.04)); x.lineTo(...at(1, -0.04));
      x.lineTo(...at(1, 0.7 + r() * 0.12));
      const steps = 6;
      for (let i = steps - 1; i >= 0; i--) {
        const u = i / steps, next = at(u, 0.66 + r() * 0.2), midp = at(u + 0.5 / steps, 0.8 + r() * 0.12);
        x.quadraticCurveTo(midp[0], midp[1], next[0], next[1]);
      }
      x.closePath();
    };
    blanket(); x.fillStyle = '#fbfdff'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
    x.save(); blanket(); x.clip();
    x.strokeStyle = '#dbe8f6'; x.lineWidth = 5;
    x.beginPath(); for (let i = 0; i <= 8; i++) { const q = at(i / 8, 0.62 + r() * 0.08); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); } x.stroke();
    x.restore();
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
    // the chimney pokes up through the snow, with a flat cap
    const chim2 = [[cxm - 9, cym + 2], [cxm - 9, cym - 26], [cxm + 9, cym - 26], [cxm + 9, cym - 2]];
    material(x, 'stone', () => poly(x, chim2), r);
    poly(x, chim2); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
    x.beginPath(); x.roundRect(cxm - 12, cym - 31, 24, 6, 2); x.fillStyle = '#7d847c'; x.fill(); x.stroke();
    blobs(x, [[cxm - 6, cym + 1, 5], [cxm + 4, cym, 4.5]]);
    x.beginPath(); x.ellipse(cxm, cym - 32, 13, 4.5, 0, 0, Math.PI * 2);
    x.fillStyle = '#fbfdff'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
    // snow along the jetty beam, icicles on the eave
    x.fillStyle = '#fbfdff'; x.lineWidth = 1.5;
    x.beginPath(); x.roundRect(ux0 - 2, groundTop - 8, ux1 - ux0 + 4, 5, 2.5); x.fill(); x.stroke();
    x.fillStyle = '#d6f0ff'; x.lineWidth = 1;
    for (let t = 0.1; t < 1; t += 0.16) {
      const [ix, iy0] = at(t, 1), len = 5 + r() * 8;
      poly(x, [[ix - 2.5, iy0 + 1], [ix, iy0 + 1 + len], [ix + 2.5, iy0 + 1]]); x.fill(); x.stroke();
    }
    x.globalAlpha = 1;
  }
  return { c, wins, frontW: fx1 - fx0 };
}

// Draw a house standing at (x, y) whose front is w pixels wide. With faceLeft
// the side wall shows on the left instead (so it faces a track on that side).
export function drawHouseSprite(ctx, x, y, w, c, seed, faceLeft, lights) {
  const k = `${Math.round(season.snow * 4)}`;
  if (k !== cacheKey) { cache.clear(); cacheKey = k; }
  const groundIdx = Math.floor(hash(seed, 31) * GROUND.length);
  const wide = hash(seed, 32) < 0.35;
  const extra = Math.floor(hash(seed, 33) * 3);
  const id = `${c}.${groundIdx}.${wide ? 1 : 0}.${extra}`;
  let spr = cache.get(id);
  if (!spr) { spr = paintHouse(c % TILES.length, groundIdx, wide, extra); cache.set(id, spr); }
  const sc = w / spr.frontW;
  const dw = SW * sc, dh = SH * sc;
  const ax = (FX0 + spr.frontW / 2) * sc; // anchor: middle of the front on the ground
  const left = faceLeft ? x - (dw - ax) : x - ax, top = y - GY * sc;
  if (faceLeft) {
    ctx.save(); ctx.translate(left + dw, 0); ctx.scale(-1, 1);
    ctx.drawImage(spr.c, 0, top, dw, dh);
    ctx.restore();
  } else ctx.drawImage(spr.c, left, top, dw, dh);
  if (lights) {
    for (const wnd of spr.wins) {
      const wx = faceLeft ? left + dw - (wnd.x + wnd.w) * sc : left + wnd.x * sc;
      if (wnd.lamp) lights.push({ kind: 'lamp', x: wx + (wnd.w * sc) / 2, y: top + (wnd.y + wnd.h / 2) * sc, r: Math.max(6, 18 * sc) });
      else lights.push({ kind: 'win', x: wx, y: top + wnd.y * sc, w: wnd.w * sc, h: wnd.h * sc });
    }
  }
}
