// Market stalls and fountains for the station squares. Painted once into
// sprites (repainted when snow comes or goes) and reused.
import { mulberry32 } from './rng.js';
import { OL, shade, season, person, mipFor } from './toon.js';

const AWNINGS = ['#e0594a', '#4a7ad8', '#4fae4a', '#f0a060'];
const cache = new Map();
let cacheKey = '';
function key() { return `${Math.round(season.snow * 4)}`; }
function getSprite(id, paint) {
  if (key() !== cacheKey) { cache.clear(); cacheKey = key(); }
  let s = cache.get(id);
  if (!s) { s = paint(); cache.set(id, s); }
  return s;
}
function poly(x, pts) { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); }

// ---------- market stall ----------
const STW = 130, STH = 124, STG = 118;

function paintStall(ci) {
  const c = document.createElement('canvas');
  c.width = STW; c.height = STH;
  const x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineCap = 'round';
  const r = mulberry32(ci * 37 + 5);
  const col = AWNINGS[ci % AWNINGS.length];
  // shadow
  x.fillStyle = 'rgba(25,20,60,0.25)'; x.beginPath(); x.ellipse(STW / 2, STG + 1, 58, 6, 0, 0, Math.PI * 2); x.fill();
  // back posts
  for (const px of [16, STW - 22]) { x.beginPath(); x.roundRect(px, 30, 6, STG - 30, 2); x.fillStyle = '#6d4a2f'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke(); }
  // the stallholder behind the counter
  person(x, STW / 2 + (r() - 0.5) * 30, 72, 2.2, ci * 13 + 3, 0);
  // counter with a coloured front panel and plank top
  x.beginPath(); x.roundRect(8, 78, STW - 16, STG - 78, 3); x.fillStyle = '#a8713f'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.roundRect(14, 86, STW - 28, STG - 92, 2); x.fillStyle = shade(col, -0.1); x.fill(); x.lineWidth = 1.8; x.stroke();
  x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 2;
  for (let px = 26; px < STW - 20; px += 14) { x.beginPath(); x.moveTo(px, 88); x.lineTo(px, STG - 8); x.stroke(); }
  x.beginPath(); x.roundRect(4, 74, STW - 8, 7, 2); x.fillStyle = '#c48a52'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  // goods on the counter: crates of apples, bread, cabbages
  const goods = [['#e8384a', '#b8242f'], ['#d9a35b', '#a8713f'], ['#6cbf4a', '#3f8a35'], ['#f5c542', '#d09a2a']];
  for (let g = 0; g < 4; g++) {
    const gx = 14 + g * 27, [a, b] = goods[(g + ci) % goods.length];
    x.beginPath(); x.roundRect(gx, 64, 24, 11, 2); x.fillStyle = '#8a5a35'; x.fill(); x.lineWidth = 1.6; x.strokeStyle = OL; x.stroke();
    for (let k = 0; k < 4; k++) {
      x.beginPath(); x.arc(gx + 4 + k * 5.5, 63 - (k % 2) * 2, 3.6, 0, Math.PI * 2);
      x.fillStyle = k % 2 ? b : a; x.fill(); x.lineWidth = 1.2; x.stroke();
    }
  }
  // front posts
  for (const px of [6, STW - 12]) { x.beginPath(); x.roundRect(px, 34, 6, 46, 2); x.fillStyle = '#8a5a35'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke(); }
  // striped awning with a scalloped edge
  const top = 14, bot = 42, inset = 10;
  const shape = () => {
    x.beginPath(); x.moveTo(inset, top); x.lineTo(STW - inset, top); x.lineTo(STW - 2, bot);
    const n = 8, sw = (STW - 4) / n;
    for (let i = n; i > 0; i--) x.arc(2 + (i - 0.5) * sw, bot, sw / 2, 0, Math.PI, false);
    x.closePath();
  };
  shape(); x.fillStyle = '#fbf6ea'; x.fill();
  x.save(); shape(); x.clip();
  const n = 8, sw = (STW - 4) / n;
  for (let i = 0; i < n; i += 2) {
    poly(x, [[inset + ((STW - 2 * inset) * i) / n, top], [inset + ((STW - 2 * inset) * (i + 1)) / n, top], [2 + (i + 1) * sw, bot + 8], [2 + i * sw, bot + 8]]);
    x.fillStyle = col; x.fill();
  }
  x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(0, top, STW, 5);
  x.restore();
  shape(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.roundRect(inset - 3, top - 4, STW - 2 * inset + 6, 6, 3); x.fillStyle = '#6d4a2f'; x.fill(); x.lineWidth = 2; x.stroke();
  if (season.snow > 0.05) {
    x.globalAlpha = Math.min(1, season.snow * 1.2);
    x.beginPath(); x.moveTo(inset - 2, top + 1);
    for (let px = inset; px <= STW - inset; px += 10) x.quadraticCurveTo(px + 5, top - 9 - r() * 4, px + 10, top - 2);
    x.lineTo(STW - inset + 2, top + 3); x.closePath();
    x.fillStyle = '#fbfdff'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
    x.globalAlpha = 1;
  }
  return c;
}

export function drawStall(ctx, x, y, w, ci) {
  const spr = getSprite(`s${ci % AWNINGS.length}`, () => paintStall(ci % AWNINGS.length));
  const sc = w / STW;
  ctx.drawImage(mipFor(spr, w), x - w / 2, y - STG * sc, w, STH * sc);
}

// ---------- fountain ----------
const FW = 150, FH = 150, FG = 144;

function paintFountain() {
  const c = document.createElement('canvas');
  c.width = FW; c.height = FH;
  const x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineCap = 'round';
  const frozen = season.snow > 0.5;
  const water = frozen ? '#d4ecf8' : '#4aa3e0', waterHi = frozen ? '#ffffff' : '#8fd3ff';
  const stone = '#b3bab2', stoneDark = '#8f9690';
  x.fillStyle = 'rgba(25,20,60,0.25)'; x.beginPath(); x.ellipse(FW / 2, FG + 1, 70, 7, 0, 0, Math.PI * 2); x.fill();
  // basin: water surface, then the carved front
  x.beginPath(); x.ellipse(FW / 2, 104, 64, 13, 0, 0, Math.PI * 2); x.fillStyle = stoneDark; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.ellipse(FW / 2, 105, 57, 10, 0, 0, Math.PI * 2); x.fillStyle = water; x.fill();
  x.strokeStyle = waterHi; x.lineWidth = 1.6;
  for (const [wx, wy] of [[48, 104], [96, 108], [70, 101]]) { x.beginPath(); x.arc(wx, wy, 5, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); }
  // central pillar with bulges
  const pillar = () => { x.beginPath(); x.roundRect(FW / 2 - 7, 46, 14, 60, 4); };
  pillar(); x.fillStyle = stone; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  for (const by of [62, 84]) { x.beginPath(); x.ellipse(FW / 2, by, 11, 6, 0, 0, Math.PI * 2); x.fillStyle = stone; x.fill(); x.stroke(); }
  // upper bowl and finial
  x.beginPath(); x.ellipse(FW / 2, 46, 30, 7, 0, 0, Math.PI * 2); x.fillStyle = stone; x.fill(); x.stroke();
  x.beginPath(); x.moveTo(FW / 2 - 30, 46); x.quadraticCurveTo(FW / 2, 62, FW / 2 + 30, 46); x.fillStyle = stoneDark; x.fill(); x.stroke();
  x.beginPath(); x.ellipse(FW / 2, 45, 24, 4.5, 0, 0, Math.PI * 2); x.fillStyle = water; x.fill();
  x.beginPath(); x.roundRect(FW / 2 - 4, 22, 8, 22, 3); x.fillStyle = stone; x.fill(); x.lineWidth = 2; x.stroke();
  x.beginPath(); x.arc(FW / 2, 20, 6, 0, Math.PI * 2); x.fillStyle = stone; x.fill(); x.stroke();
  // falling water from the upper bowl (or icicles when frozen)
  if (!frozen) {
    x.strokeStyle = 'rgba(120,200,255,0.9)'; x.lineWidth = 3.5;
    for (const side of [-1, 1]) {
      x.beginPath(); x.moveTo(FW / 2 + side * 28, 47); x.quadraticCurveTo(FW / 2 + side * 38, 62, FW / 2 + side * 40, 100); x.stroke();
    }
    x.strokeStyle = 'rgba(200,235,255,0.9)'; x.lineWidth = 1.4;
    for (const side of [-1, 1]) {
      x.beginPath(); x.moveTo(FW / 2 + side * 27, 48); x.quadraticCurveTo(FW / 2 + side * 36, 62, FW / 2 + side * 38, 100); x.stroke();
    }
    x.strokeStyle = 'rgba(120,200,255,0.9)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(FW / 2, 14); x.quadraticCurveTo(FW / 2 + 1, 4, FW / 2, 2); x.stroke();
  } else {
    x.fillStyle = '#d6f0ff'; x.strokeStyle = OL; x.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      const ix = FW / 2 + i * 8, len = 6 + ((i * 7 + 21) % 5) * 2;
      poly(x, [[ix - 2.5, 50], [ix, 50 + len], [ix + 2.5, 50]]); x.fill(); x.stroke();
    }
  }
  // the basin's carved front wall with a lighter rim
  const front = () => { x.beginPath(); x.moveTo(FW / 2 - 64, 104); x.lineTo(FW / 2 - 60, FG - 2); x.quadraticCurveTo(FW / 2, FG + 8, FW / 2 + 60, FG - 2); x.lineTo(FW / 2 + 64, 104); x.quadraticCurveTo(FW / 2, 122, FW / 2 - 64, 104); x.closePath(); };
  front(); x.fillStyle = stone; x.fill();
  x.save(); front(); x.clip();
  x.strokeStyle = stoneDark; x.lineWidth = 2;
  for (let i = 0; i < 6; i++) { // wave carvings
    const wx = FW / 2 - 50 + i * 20;
    x.beginPath(); x.arc(wx, 128, 7, Math.PI, Math.PI * 2); x.stroke();
    x.beginPath(); x.arc(wx + 3, 128, 3, Math.PI, Math.PI * 2); x.stroke();
  }
  x.restore();
  front(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.moveTo(FW / 2 - 64, 104); x.quadraticCurveTo(FW / 2, 122, FW / 2 + 64, 104);
  x.lineWidth = 5; x.strokeStyle = '#d0d6cf'; x.stroke();
  if (season.snow > 0.05) {
    x.globalAlpha = Math.min(1, season.snow * 1.2);
    x.fillStyle = '#fbfdff'; x.strokeStyle = OL; x.lineWidth = 1.6;
    x.beginPath(); x.ellipse(FW / 2, 41, 26, 5, 0, Math.PI, 0); x.fill(); x.stroke();
    x.beginPath(); x.ellipse(FW / 2, 15, 6.5, 3.5, 0, Math.PI, 0); x.fill(); x.stroke();
    x.globalAlpha = 1;
  }
  return c;
}

export function drawFountain(ctx, x, y, w, clock) {
  const spr = getSprite('f', paintFountain);
  const sc = w / FW;
  ctx.drawImage(mipFor(spr, w), x - w / 2, y - FG * sc, w, FH * sc);
  if (season.snow > 0.5 || w < 14) return;
  // a few droplets tumbling down the streams
  ctx.fillStyle = 'rgba(220,245,255,0.95)';
  for (let i = 0; i < 6; i++) {
    const t = (clock * 0.9 + i / 6) % 1, side = i % 2 ? 1 : -1;
    const u = t, px = (FW / 2 + side * (28 + 12 * u)) * sc, py = (47 + 53 * u * u) * sc;
    ctx.beginPath(); ctx.arc(x - w / 2 + px, y - FG * sc + py, Math.max(0.8, 2.2 * sc), 0, Math.PI * 2); ctx.fill();
  }
}
