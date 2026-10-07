// Detailed cartoon cottages for the Focus views. Like the trees, each design is
// painted once into a sprite (a front gable and a side wall in a slight 3/4
// view) and reused; sprites repaint when snow comes or goes.
import { hash, mulberry32 } from './rng.js';
import { OL, mixHex, shade, season } from './toon.js';

const ROOFS = ['#e0594a', '#8d6e63', '#f08a24', '#5d7fb8'];
const WALLS = ['timber', 'brick', 'boards', 'stone'];
const BOARD_COLORS = ['#8fb3d9', '#e8d6a8', '#9fd0a8', '#f2c4a0'];
const SHUTTERS = ['#3f7a60', '#2d6cdf', '#c0392b', '#8e6bd9'];

const SW = 240, SH = 236, GY = 226; // sprite size and ground line
const cache = new Map();
let cacheKey = '';

function blob2(x, pts) {
  x.beginPath(); for (const [px, py, pr] of pts) { x.moveTo(px + pr + 1.5, py); x.arc(px, py, pr + 1.5, 0, Math.PI * 2); }
  x.fillStyle = OL; x.fill();
  x.beginPath(); for (const [px, py, pr] of pts) { x.moveTo(px + pr, py); x.arc(px, py, pr, 0, Math.PI * 2); }
  x.fillStyle = '#fbfdff'; x.fill();
}

function poly(x, pts) { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); }

function paintWall(x, kind, color, area, r) {
  // area: a path to clip to; fills it and adds the wall's texture
  x.save(); area(); x.clip();
  x.fillStyle = color; x.fillRect(0, 0, SW, SH);
  if (kind === 'brick') {
    x.strokeStyle = 'rgba(255,240,225,0.55)'; x.lineWidth = 1.4;
    for (let y = GY; y > 0; y -= 9) {
      x.beginPath(); x.moveTo(0, y); x.lineTo(SW, y); x.stroke();
      const off = ((GY - y) / 9) % 2 ? 9 : 0;
      for (let bx = off; bx < SW; bx += 18) { x.beginPath(); x.moveTo(bx, y); x.lineTo(bx, y - 9); x.stroke(); }
    }
  } else if (kind === 'boards') {
    x.strokeStyle = 'rgba(43,33,64,0.22)'; x.lineWidth = 1.6;
    for (let y = GY - 8; y > 0; y -= 8) { x.beginPath(); x.moveTo(0, y); x.lineTo(SW, y); x.stroke(); }
  } else if (kind === 'stone') {
    x.strokeStyle = 'rgba(43,33,64,0.3)'; x.lineWidth = 1.5;
    for (let y = GY; y > 0; y -= 14) {
      let sx = -r() * 20;
      while (sx < SW) { const w = 16 + r() * 14; x.beginPath(); x.roundRect(sx + 1, y - 13, w - 2, 12, 4); x.stroke(); sx += w; }
    }
  }
  x.restore();
}

function paintWindow(x, wx, wy, ww, wh, shutter, flowers, wins) {
  if (shutter) {
    for (const sx of [wx - ww * 0.42 - 2, wx + ww + 2]) {
      poly(x, [[sx, wy], [sx + ww * 0.42, wy], [sx + ww * 0.42, wy + wh], [sx, wy + wh]]);
      x.fillStyle = shutter; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
      x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1;
      for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(sx + 2, wy + (wh * k) / 4); x.lineTo(sx + ww * 0.42 - 2, wy + (wh * k) / 4); x.stroke(); }
    }
  }
  x.beginPath(); x.roundRect(wx - 3, wy - 3, ww + 6, wh + 6, 3); x.fillStyle = '#fbf6ea'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.rect(wx, wy, ww, wh); x.fillStyle = '#8fd3ff'; x.fill();
  x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.moveTo(wx + 3, wy + wh - 3); x.lineTo(wx + ww * 0.55, wy + 3); x.lineTo(wx + ww * 0.75, wy + 3); x.lineTo(wx + ww * 0.2, wy + wh - 3); x.fill();
  x.strokeStyle = '#fbf6ea'; x.lineWidth = 2.5;
  x.beginPath(); x.moveTo(wx + ww / 2, wy); x.lineTo(wx + ww / 2, wy + wh); x.moveTo(wx, wy + wh / 2); x.lineTo(wx + ww, wy + wh / 2); x.stroke();
  wins.push({ x: wx, y: wy, w: ww, h: wh });
  if (flowers) {
    x.beginPath(); x.roundRect(wx - 4, wy + wh + 2, ww + 8, 7, 2); x.fillStyle = '#8a5a35'; x.fill(); x.lineWidth = 1.6; x.strokeStyle = OL; x.stroke();
    const cols = ['#ff8fa3', '#ffd84a', '#fff6d8', '#c38dd6'];
    for (let i = 0; i < 5; i++) {
      x.fillStyle = i % 2 ? '#4f9a3a' : cols[(i + Math.round(wx)) % cols.length];
      x.beginPath(); x.arc(wx - 1 + (i * (ww + 2)) / 4, wy + wh + 1, i % 2 ? 2.4 : 3, 0, Math.PI * 2); x.fill();
    }
  }
}

function paintHouse(roofIdx, wallIdx, wide) {
  const c = document.createElement('canvas');
  c.width = SW; c.height = SH;
  const x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineCap = 'round';
  const r = mulberry32(roofIdx * 97 + wallIdx * 13 + (wide ? 5 : 1));
  const wall = WALLS[wallIdx];
  const wallColor = wall === 'brick' ? '#c4644a' : wall === 'stone' ? '#cfc6b4' : wall === 'boards' ? BOARD_COLORS[roofIdx] : '#fff1d6';
  const roof = mixHex(ROOFS[roofIdx], '#fbfdff', season.snow * 0.15);
  const shutter = SHUTTERS[(roofIdx + wallIdx) % SHUTTERS.length];
  const wins = [];

  // front face from fx0..fx1, walls up to wallTop, gable apex above the middle
  const fx0 = 26, fx1 = wide ? 156 : 138, wallTop = GY - 78;
  const mid = (fx0 + fx1) / 2, apexY = wallTop - (fx1 - fx0) * 0.62;
  const dx = 56, dy = -20; // the side wall recedes up and to the right

  // shadow on the ground
  x.fillStyle = 'rgba(25,20,60,0.25)';
  x.beginPath(); x.ellipse((fx0 + fx1 + dx) / 2 + 6, GY + 2, (fx1 - fx0 + dx) * 0.58, 7, 0, 0, Math.PI * 2); x.fill();

  // side wall (darker) with a window
  const side = () => poly(x, [[fx1, GY], [fx1 + dx, GY + dy], [fx1 + dx, wallTop + dy], [fx1, wallTop]]);
  paintWall(x, wall, shade(wallColor, -0.22), side, r);
  side(); x.lineWidth = 3; x.strokeStyle = OL; x.stroke();
  const sw0 = fx1 + dx * 0.3, sw1 = fx1 + dx * 0.7, swy = wallTop + 20;
  poly(x, [[sw0, swy + dy * 0.3], [sw1, swy + dy * 0.7], [sw1, swy + 26 + dy * 0.7], [sw0, swy + 26 + dy * 0.3]]);
  x.fillStyle = '#6fa8c8'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  wins.push({ x: sw0, y: swy + dy * 0.7, w: sw1 - sw0, h: 26 });

  // front wall and gable
  const front = () => poly(x, [[fx0, GY], [fx0, wallTop], [mid, apexY], [fx1, wallTop], [fx1, GY]]);
  paintWall(x, wall, wallColor, front, r);
  if (wall === 'timber') {
    // half-timbering: corner posts, a beam, braces and the gable frame
    x.strokeStyle = '#6b3f2a'; x.lineWidth = 6; x.lineCap = 'butt';
    x.beginPath();
    x.moveTo(fx0 + 3, GY); x.lineTo(fx0 + 3, wallTop); x.moveTo(fx1 - 3, GY); x.lineTo(fx1 - 3, wallTop);
    x.moveTo(fx0, wallTop + 2); x.lineTo(fx1, wallTop + 2);
    x.moveTo(fx0 + 6, GY - 40); x.lineTo(fx1 - 6, GY - 40);
    x.moveTo(fx0 + 6, wallTop + 4); x.lineTo(fx0 + 30, GY - 42);
    x.moveTo(fx1 - 6, wallTop + 4); x.lineTo(fx1 - 30, GY - 42);
    x.moveTo(mid, wallTop + 2); x.lineTo(mid, apexY + 8);
    x.stroke();
    x.lineCap = 'round';
  }
  front(); x.lineWidth = 3; x.strokeStyle = OL; x.stroke();

  // door with a step and a lamp
  const dw = 24, dh = 40, dX = wide ? fx0 + 20 : mid - dw / 2 + (r() < 0.5 ? -22 : 22);
  x.beginPath(); x.roundRect(dX - 4, GY - 4, dw + 8, 5, 2); x.fillStyle = '#b8b0a0'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.roundRect(dX, GY - 4 - dh, dw, dh, [10, 10, 0, 0]); x.fillStyle = shade(shutter, -0.1); x.fill(); x.lineWidth = 2.5; x.stroke();
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(dX + dw / 2, GY - dh); x.lineTo(dX + dw / 2, GY - 6); x.stroke();
  x.fillStyle = '#f5c542'; x.beginPath(); x.arc(dX + dw - 6, GY - 4 - dh / 2, 2.2, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.roundRect(dX + dw + 4, GY - dh - 6, 7, 9, 2); x.fillStyle = '#ffe28a'; x.fill(); x.lineWidth = 1.6; x.strokeStyle = OL; x.stroke();
  wins.push({ x: dX + dw + 4, y: GY - dh - 6, w: 7, h: 9, lamp: true });

  // windows on the front (avoiding the door) and a little round one in the gable
  const slots = wide ? [fx0 + 66, fx0 + 104] : [fx0 + 22, fx1 - 42];
  for (const wx of slots) {
    if (Math.abs(wx + 10 - (dX + dw / 2)) < 30) continue;
    paintWindow(x, wx, GY - 62, 20, 24, r() < 0.7 ? shutter : null, r() < 0.6, wins);
  }
  x.beginPath(); x.arc(mid, wallTop - (wallTop - apexY) * 0.42, 8, 0, Math.PI * 2);
  x.fillStyle = '#8fd3ff'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = '#fbf6ea'; x.stroke(); x.lineWidth = 1.5; x.strokeStyle = OL; x.stroke();
  wins.push({ x: mid - 6, y: wallTop - (wallTop - apexY) * 0.42 - 6, w: 12, h: 12 });

  // roof: the side plane with tile rows, then the front edge and bargeboards
  const ov = 8; // overhang
  const eL = [fx0 - ov, wallTop + ov * 0.6], eR = [fx1 + ov, wallTop + ov * 0.6], ap = [mid, apexY - 6];
  const roofSide = () => poly(x, [ap, [ap[0] + dx + 4, ap[1] + dy], [eR[0] + dx + 4, eR[1] + dy], eR]);
  roofSide(); x.fillStyle = roof; x.fill();
  x.save(); roofSide(); x.clip();
  x.strokeStyle = shade(roof, -0.25); x.lineWidth = 1.8;
  for (let t = 0.12; t < 1; t += 0.13) {
    // tile rows run parallel to the eave
    const sx = ap[0] + (eR[0] - ap[0]) * t, sy = ap[1] + (eR[1] - ap[1]) * t;
    x.beginPath();
    for (let k = 0; k <= 8; k++) {
      const px = sx + ((dx + 4) * k) / 8, py = sy + (dy * k) / 8;
      if (k === 0) x.moveTo(px, py); else x.quadraticCurveTo(px - (dx + 4) / 16, py + 4, px, py);
    }
    x.stroke();
  }
  x.fillStyle = 'rgba(255,255,255,0.18)';
  poly(x, [ap, [ap[0] + dx + 4, ap[1] + dy], [ap[0] + dx + 4 + (eR[0] - ap[0]) * 0.18, ap[1] + dy + (eR[1] - ap[1]) * 0.18], [ap[0] + (eR[0] - ap[0]) * 0.18, ap[1] + (eR[1] - ap[1]) * 0.18]]);
  x.fill();
  x.restore();
  roofSide(); x.lineWidth = 3; x.strokeStyle = OL; x.stroke();

  // chimney standing on the roof
  const cxm = ap[0] + (eR[0] - ap[0]) * 0.3 + dx * 0.55, cym = ap[1] + (eR[1] - ap[1]) * 0.3 + dy * 0.55;
  poly(x, [[cxm - 8, cym + 6], [cxm - 8, cym - 22], [cxm + 8, cym - 22], [cxm + 8, cym + 2]]);
  x.fillStyle = '#b0624a'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.roundRect(cxm - 11, cym - 27, 22, 6, 2); x.fillStyle = '#8a4a3a'; x.fill(); x.stroke();

  // front roof edge (bargeboards) over the gable
  x.lineWidth = 11; x.strokeStyle = OL;
  x.beginPath(); x.moveTo(eL[0], eL[1]); x.lineTo(ap[0], ap[1]); x.lineTo(eR[0], eR[1]); x.stroke();
  x.lineWidth = 6.5; x.strokeStyle = shade(roof, -0.12); x.stroke();
  x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,0.35)';
  x.beginPath(); x.moveTo(eL[0] + 3, eL[1] - 3); x.lineTo(ap[0], ap[1] - 3); x.stroke();

  if (season.snow > 0.05) {
    // a blanket of snow over the roof with a lumpy lower edge
    x.globalAlpha = Math.min(1, season.snow * 1.2);
    const sideV = [dx + 4, dy];
    const at = (u, v) => [ap[0] + (eR[0] - ap[0]) * v + sideV[0] * u, ap[1] + (eR[1] - ap[1]) * v + sideV[1] * u];
    const blanket = () => {
      x.beginPath();
      const start = at(0, -0.04); x.moveTo(start[0], start[1]);
      const end = at(1, -0.04); x.lineTo(end[0], end[1]);
      const steps = 6;
      let prev = at(1, 0.7 + r() * 0.12);
      x.lineTo(prev[0], prev[1]);
      for (let i = steps - 1; i >= 0; i--) {
        const u = i / steps, next = at(u, 0.66 + r() * 0.2);
        const midp = at(u + 0.5 / steps, 0.8 + r() * 0.12); // a drooping lump between points
        x.quadraticCurveTo(midp[0], midp[1], next[0], next[1]);
        prev = next;
      }
      x.closePath();
    };
    blanket(); x.fillStyle = '#fbfdff'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
    x.save(); blanket(); x.clip();
    x.strokeStyle = '#dbe8f6'; x.lineWidth = 5;
    x.beginPath(); for (let i = 0; i <= 8; i++) { const q = at(i / 8, 0.62 + r() * 0.08); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); } x.stroke();
    x.restore();
    // snow piled along the front roof edges: one uneven ridge, not a row of beads
    const edge = () => { x.beginPath(); x.moveTo(eL[0], eL[1] - 3); x.lineTo(ap[0], ap[1] - 4); x.lineTo(eR[0], eR[1] - 3); };
    edge(); x.lineWidth = 11; x.strokeStyle = OL; x.stroke();
    edge(); x.lineWidth = 7.5; x.strokeStyle = '#fbfdff'; x.stroke();
    const lumps = [];
    for (let i = 0; i < 6; i++) {
      const t = r(), leftSide = r() < 0.5, e0 = leftSide ? eL : eR;
      lumps.push([e0[0] + (ap[0] - e0[0]) * t, e0[1] + (ap[1] - e0[1]) * t - 5, 3.5 + r() * 3.5]);
    }
    x.beginPath(); for (const [px, py, pr] of lumps) { x.moveTo(px + pr + 1.6, py); x.arc(px, py, pr + 1.6, 0, Math.PI * 2); }
    x.fillStyle = OL; x.fill();
    x.beginPath(); for (const [px, py, pr] of lumps) { x.moveTo(px + pr, py); x.arc(px, py, pr, 0, Math.PI * 2); }
    x.fillStyle = '#fbfdff'; x.fill();
    edge(); x.lineWidth = 6; x.strokeStyle = '#fbfdff'; x.stroke();
    // the chimney pokes up through the snow, with a flat cap on top
    poly(x, [[cxm - 8, cym + 2], [cxm - 8, cym - 22], [cxm + 8, cym - 22], [cxm + 8, cym - 2]]);
    x.fillStyle = '#b0624a'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
    x.beginPath(); x.roundRect(cxm - 11, cym - 27, 22, 6, 2); x.fillStyle = '#8a4a3a'; x.fill(); x.stroke();
    blob2(x, [[cxm - 6, cym + 1, 5], [cxm + 3, cym, 4.5]]);
    x.beginPath(); x.ellipse(cxm, cym - 28, 12.5, 4.5, 0, 0, Math.PI * 2);
    x.fillStyle = '#fbfdff'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
    x.fillStyle = '#d6f0ff'; x.strokeStyle = OL; x.lineWidth = 1;
    for (let t = 0.1; t < 1; t += 0.18) {
      const ix = eR[0] + (dx + 4) * t, iy = eR[1] + dy * t + 2, len = 5 + r() * 7;
      poly(x, [[ix - 2.5, iy], [ix, iy + len], [ix + 2.5, iy]]); x.fill(); x.stroke();
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
  const wallIdx = Math.floor(hash(seed, 31) * WALLS.length);
  const wide = hash(seed, 32) < 0.35;
  const id = `${c}.${wallIdx}.${wide ? 1 : 0}`;
  let spr = cache.get(id);
  if (!spr) { spr = paintHouse(c, wallIdx, wide); cache.set(id, spr); }
  const sc = w / spr.frontW;
  const dw = SW * sc, dh = SH * sc;
  // anchor: middle of the front face on the ground
  const ax = (26 + spr.frontW / 2) * sc;
  const left = faceLeft ? x - (dw - ax) : x - ax, top = y - GY * sc;
  if (faceLeft) {
    ctx.save(); ctx.translate(left + dw, 0); ctx.scale(-1, 1);
    ctx.drawImage(spr.c, 0, top, dw, dh);
    ctx.restore();
  } else ctx.drawImage(spr.c, left, top, dw, dh);
  if (lights) {
    for (const wnd of spr.wins) {
      const wx = faceLeft ? left + dw - (wnd.x + wnd.w) * sc : left + wnd.x * sc;
      if (wnd.lamp) lights.push({ kind: 'lamp', x: wx + (wnd.w * sc) / 2, y: top + (wnd.y + wnd.h / 2) * sc, r: Math.max(6, 16 * sc) });
      else lights.push({ kind: 'win', x: wx, y: top + wnd.y * sc, w: wnd.w * sc, h: wnd.h * sc });
    }
  }
}
