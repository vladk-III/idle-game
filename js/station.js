// The station building as seen from the cab: a long brick building beside the
// platform, with a slate roof, a gable end with a clock, and a platform canopy
// on iron columns with a sawtooth valance. Its long sides run parallel to the
// track, so they are drawn as textured quads in perspective rather than as flat
// cards facing the driver.
import { mulberry32 } from './rng.js';
import { OL, shade, season, mipFor, drawAffine } from './toon.js';

const FW = 720, FH = 110; // facade texture
const cache = new Map();
let cacheKey = '';
function get(id, paint) {
  const k = `${Math.round(season.snow * 4)}`;
  if (k !== cacheKey) { cache.clear(); cacheKey = k; }
  let v = cache.get(id);
  if (!v) { v = paint(); cache.set(id, v); }
  return v;
}
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineCap = 'round';
  return { c, x };
}

function paintFacade(lit) {
  const { c, x } = canvas(FW, FH);
  const r = mulberry32(31);
  // brick wall
  x.fillStyle = '#e2c4a0'; x.fillRect(0, 0, FW, FH);
  for (let y = FH, row = 0; y > 0; y -= 8, row++) {
    for (let bx = (row % 2) * -9; bx < FW; bx += 18) {
      x.fillStyle = ['#c4553a', '#b84c34', '#cf6040'][Math.floor(r() * 3)];
      x.fillRect(bx + 1, y - 7, 16, 6);
    }
  }
  // stone quoins at the corners and between bays
  for (const qx of [0, FW / 2 - 70, FW / 2 + 58, FW - 12]) {
    for (let y = 14, i = 0; y < FH - 14; y += 12, i++) {
      x.beginPath(); x.roundRect(qx + (i % 2 ? 2 : 0), y, i % 2 ? 10 : 14, 11, 2);
      x.fillStyle = '#e8e2d2'; x.fill(); x.lineWidth = 1.2; x.strokeStyle = 'rgba(43,33,64,0.5)'; x.stroke();
    }
  }
  // cornice with dentils, and a stone plinth
  x.fillStyle = '#efe6d2'; x.fillRect(0, 0, FW, 12);
  x.fillStyle = '#cfc4ae';
  for (let dx = 4; dx < FW; dx += 10) x.fillRect(dx, 12, 6, 4);
  x.strokeStyle = OL; x.lineWidth = 2; x.beginPath(); x.moveTo(0, 12); x.lineTo(FW, 12); x.stroke();
  x.fillStyle = '#9aa29a'; x.fillRect(0, FH - 12, FW, 12);
  x.beginPath(); x.moveTo(0, FH - 12); x.lineTo(FW, FH - 12); x.stroke();
  x.strokeStyle = 'rgba(43,33,64,0.35)'; x.lineWidth = 1.2;
  for (let bx = 16; bx < FW; bx += 22) { x.beginPath(); x.moveTo(bx, FH - 12); x.lineTo(bx, FH); x.stroke(); }

  const glass = lit ? '#ffd77a' : '#4558a8', glass2 = lit ? '#ffe7a8' : '#5068c0';
  // arched windows with flower baskets, skipping the middle for the door
  for (let wx = 40; wx < FW - 30; wx += 72) {
    if (Math.abs(wx + 13 - FW / 2) < 60) continue;
    const ww = 26, wh = 50, wy = 30;
    const arch = () => { x.beginPath(); x.moveTo(wx, wy + wh); x.lineTo(wx, wy + ww / 2); x.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0); x.lineTo(wx + ww, wy + wh); x.closePath(); };
    x.save(); x.translate(0, 0);
    x.beginPath(); x.moveTo(wx - 5, wy + wh + 3); x.lineTo(wx - 5, wy + ww / 2); x.arc(wx + ww / 2, wy + ww / 2, ww / 2 + 5, Math.PI, 0); x.lineTo(wx + ww + 5, wy + wh + 3); x.closePath();
    x.fillStyle = '#efe6d2'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
    arch(); x.fillStyle = glass; x.fill();
    x.fillStyle = glass2; x.fillRect(wx + 2, wy + ww / 2 + 2, ww / 2 - 3, wh - ww / 2 - 4);
    x.strokeStyle = '#efe6d2'; x.lineWidth = 2.5;
    x.beginPath(); x.moveTo(wx + ww / 2, wy); x.lineTo(wx + ww / 2, wy + wh); x.moveTo(wx, wy + 26); x.lineTo(wx + ww, wy + 26); x.moveTo(wx, wy + 40); x.lineTo(wx + ww, wy + 40); x.stroke();
    if (!lit) { x.fillStyle = 'rgba(200,220,255,0.55)'; x.fillRect(wx + 3, wy + 16, 3, 20); }
    arch(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
    x.restore();
    // sill and a hanging basket
    x.beginPath(); x.roundRect(wx - 7, wy + wh + 2, ww + 14, 5, 2); x.fillStyle = '#d8cfba'; x.fill(); x.lineWidth = 1.5; x.strokeStyle = OL; x.stroke();
    x.strokeStyle = '#3a3340'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(wx + ww + 18, 16); x.lineTo(wx + ww + 18, 24); x.stroke();
    x.beginPath(); x.arc(wx + ww + 18, 28, 6, 0, Math.PI); x.fillStyle = '#8a5a35'; x.fill(); x.stroke();
    for (let k = -1; k <= 1; k++) {
      x.fillStyle = '#3f8a35'; x.beginPath(); x.arc(wx + ww + 18 + k * 4, 26, 3.2, 0, Math.PI * 2); x.fill();
      x.fillStyle = k ? '#e8384a' : '#ffd84a'; x.beginPath(); x.arc(wx + ww + 18 + k * 4, 24, 2, 0, Math.PI * 2); x.fill();
    }
  }
  // posters between some windows
  const posters = [['#f5c542', '#2d6cdf'], ['#e74c3c', '#fbf6ea'], ['#4fae4a', '#fbf6ea']];
  let pi = 0;
  for (let wx = 76; wx < FW - 60; wx += 144) {
    if (Math.abs(wx - FW / 2) < 80) continue;
    const [bg, fg] = posters[pi++ % posters.length];
    x.beginPath(); x.roundRect(wx, 46, 22, 30, 2); x.fillStyle = bg; x.fill(); x.lineWidth = 1.6; x.strokeStyle = OL; x.stroke();
    x.fillStyle = fg; x.fillRect(wx + 4, 52, 14, 3); x.fillRect(wx + 4, 58, 10, 3);
    x.beginPath(); x.arc(wx + 11, 68, 4, 0, Math.PI * 2); x.fill();
  }
  // double doors with a fanlight, under a sign
  const dx = FW / 2 - 22, dw = 44, dTop = 40;
  x.beginPath(); x.moveTo(dx - 6, FH - 12); x.lineTo(dx - 6, dTop + dw / 2); x.arc(dx + dw / 2, dTop + dw / 2, dw / 2 + 6, Math.PI, 0); x.lineTo(dx + dw + 6, FH - 12); x.closePath();
  x.fillStyle = '#efe6d2'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.arc(dx + dw / 2, dTop + dw / 2, dw / 2, Math.PI, 0); x.closePath(); x.fillStyle = glass; x.fill(); x.stroke();
  x.strokeStyle = '#efe6d2'; x.lineWidth = 2;
  for (let k = 1; k < 4; k++) { const a = Math.PI + (k * Math.PI) / 4; x.beginPath(); x.moveTo(dx + dw / 2, dTop + dw / 2); x.lineTo(dx + dw / 2 + Math.cos(a) * dw / 2, dTop + dw / 2 + Math.sin(a) * dw / 2); x.stroke(); }
  x.beginPath(); x.rect(dx, dTop + dw / 2, dw, FH - 12 - dTop - dw / 2); x.fillStyle = '#2f6b4a'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  x.beginPath(); x.moveTo(dx + dw / 2, dTop + dw / 2); x.lineTo(dx + dw / 2, FH - 12); x.stroke();
  for (const px of [dx + 5, dx + dw / 2 + 5]) { x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 1.4; x.strokeRect(px, dTop + dw / 2 + 6, dw / 2 - 10, 14); x.strokeRect(px, dTop + dw / 2 + 26, dw / 2 - 10, 14); }
  x.fillStyle = '#f5c542'; x.beginPath(); x.arc(dx + dw / 2 - 4, 82, 2, 0, Math.PI * 2); x.arc(dx + dw / 2 + 4, 82, 2, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.roundRect(FW / 2 - 52, 17, 104, 14, 4); x.fillStyle = '#2d6cdf'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  x.fillStyle = '#fff'; x.font = '800 10px ui-rounded, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('BOOKING OFFICE', FW / 2, 24.5);
  x.lineWidth = 3; x.strokeStyle = OL; x.strokeRect(1.5, 1.5, FW - 3, FH - 3);
  return c;
}

function paintRoof() {
  const W = FW, H = 70;
  const { c, x } = canvas(W, H + 14);
  const r = mulberry32(7);
  x.fillStyle = '#4c586c'; x.fillRect(0, 0, W, H);
  // staggered slate rows
  for (let y = 4, row = 0; y < H; y += 9, row++) {
    for (let sx = (row % 2) * -9; sx < W; sx += 18) {
      x.beginPath(); x.roundRect(sx + 1, y, 16, 10, [0, 0, 3, 3]);
      x.fillStyle = ['#64738a', '#5d6b80', '#6c7b92'][Math.floor(r() * 3)]; x.fill();
      x.lineWidth = 1; x.strokeStyle = 'rgba(30,30,50,0.6)'; x.stroke();
    }
  }
  x.fillStyle = '#3e4858'; x.fillRect(0, 0, W, 6);
  const g = x.createLinearGradient(0, H * 0.4, 0, H);
  g.addColorStop(0, 'rgba(20,10,30,0)'); g.addColorStop(1, 'rgba(20,10,30,0.25)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.lineWidth = 3; x.strokeStyle = OL; x.strokeRect(1.5, 1.5, W - 3, H - 3);
  if (season.snow > 0.05) {
    x.globalAlpha = Math.min(1, season.snow * 1.2);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(W, 0); x.lineTo(W, H * 0.7);
    for (let px = W; px > 0; px -= 30) x.quadraticCurveTo(px - 15, H * (0.86 + r() * 0.1), px - 30, H * (0.66 + r() * 0.14));
    x.closePath(); x.fillStyle = '#fbfdff'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = OL; x.stroke();
    x.fillStyle = '#d6f0ff'; x.lineWidth = 1;
    for (let px = 10; px < W; px += 16 + r() * 10) {
      const len = 5 + r() * 9;
      x.beginPath(); x.moveTo(px - 2.5, H - 1); x.lineTo(px, H - 1 + len); x.lineTo(px + 2.5, H - 1); x.closePath(); x.fill(); x.stroke();
    }
    x.globalAlpha = 1;
  }
  return { c, h: H };
}

function paintCanopy() {
  const W = FW, H = 40;
  const { c, x } = canvas(W, H);
  const snow = season.snow > 0.3;
  x.fillStyle = snow ? '#f4f8fd' : '#7da58a'; x.fillRect(0, 0, W, H);
  if (!snow) {
    for (let sx = 0; sx < W; sx += 8) { x.fillStyle = sx % 16 ? '#6a9478' : '#8fb89a'; x.fillRect(sx, 0, 4, H); }
  } else {
    x.strokeStyle = '#dbe8f6'; x.lineWidth = 3;
    for (let sx = 12; sx < W; sx += 40) { x.beginPath(); x.moveTo(sx, 4); x.quadraticCurveTo(sx + 10, H / 2, sx, H - 4); x.stroke(); }
  }
  x.lineWidth = 3; x.strokeStyle = OL; x.strokeRect(1.5, 1.5, W - 3, H - 3);
  return c;
}

function paintValance() {
  const W = FW, H = 22;
  const { c, x } = canvas(W, H);
  x.beginPath(); x.moveTo(0, 0); x.lineTo(W, 0); x.lineTo(W, 10);
  for (let px = W; px > 0; px -= 12) { x.lineTo(px - 6, H - 2); x.lineTo(px - 12, 10); }
  x.closePath();
  x.fillStyle = '#f6efe0'; x.fill(); x.lineWidth = 2; x.strokeStyle = OL; x.stroke();
  x.strokeStyle = 'rgba(43,33,64,0.3)'; x.lineWidth = 1;
  for (let px = 12; px < W; px += 12) { x.beginPath(); x.moveTo(px, 2); x.lineTo(px, 10); x.stroke(); }
  x.fillStyle = '#c0392b'; x.fillRect(0, 2, W, 3);
  return c;
}

// Map a texture onto a surface whose top and bottom texture rows run along the
// track. edge(t) returns {a, b} screen points for the texture's top and bottom
// at fraction t along it, or null where that part is behind the driver.
function mapSurface(ctx, tex0, edge, strips) {
  // find the visible stretch
  const ts = [];
  for (let i = 0; i <= strips; i++) { const t = i / strips, e = edge(t); if (e) ts.push([t, e]); }
  if (ts.length < 2) return;
  const first = ts[0][1], last = ts[ts.length - 1][1];
  const span = Math.hypot(last.a[0] - first.a[0], last.a[1] - first.a[1]) + Math.hypot(first.b[0] - first.a[0], first.b[1] - first.a[1]);
  if (span < 3) return;
  const tex = mipFor(tex0, span);
  const big = span > 120;
  ctx.save();
  if (big) {
    ctx.beginPath();
    ts.forEach(([, e], i) => (i ? ctx.lineTo(e.a[0], e.a[1]) : ctx.moveTo(e.a[0], e.a[1])));
    for (let i = ts.length - 1; i >= 0; i--) ctx.lineTo(ts[i][1].b[0], ts[i][1].b[1]);
    ctx.closePath(); ctx.clip();
  }
  const base = ctx.getTransform();
  for (let i = 0; i < ts.length - 1; i++) {
    const [t0, e0] = ts[i], [t1, e1] = ts[i + 1];
    drawAffine(ctx, base, tex, t0 * tex.width, 0, (t1 - t0) * tex.width * 1.05, tex.height,
      (e1.a[0] - e0.a[0]) * 1.05, (e1.a[1] - e0.a[1]) * 1.05, e0.b[0] - e0.a[0], e0.b[1] - e0.a[1], e0.a[0], e0.a[1]);
  }
  ctx.setTransform(base);
  ctx.restore();
}

// spot(t, lat, up): screen point for fraction t along the building, at lat
// (away from the track centre, toward the building) and height up; null if
// behind the driver. nearT: which end (0 or 1) is closer to the driver.
export function drawStationBuilding(ctx, spot, nearT, night, clock, showGable = true) {
  const facade = get(`facade${night ? 1 : 0}`, () => paintFacade(night));
  const roof = get('roof', paintRoof);
  const canopy = get('canopy', paintCanopy);
  const valance = get('valance', paintValance);
  const near = spot(nearT, 38, 0);
  if (!near) return;
  const s = Math.max(0.05, Math.abs((spot(nearT, 39, 0) || near).x - near.x)); // px per unit near the front
  const strips = s > 3 ? 12 : s > 1.2 ? 7 : 4;
  // roof slope facing the track: ridge at the top of the texture, eave at the bottom
  // (the texture runs a little past the eave so icicles can hang below it)
  const over = (roof.c.height - roof.h) / roof.h;
  mapSurface(ctx, roof.c, (t) => { const a = spot(t, 53, 40), b = spot(t, 35 - 18 * over, 26 - 14 * over); return a && b ? { a: [a.x, a.y], b: [b.x, b.y] } : null; }, strips);
  // the long facade along the platform
  mapSurface(ctx, facade, (t) => { const a = spot(t, 38, 26), b = spot(t, 38, 0); return a && b ? { a: [a.x, a.y], b: [b.x, b.y] } : null; }, strips);
  // chimneys on the ridge
  for (const t of [0.25, 0.7]) {
    const base = spot(t, 50, 39);
    if (!base) continue;
    const u = Math.abs((spot(t, 51, 39) || base).x - base.x) || base.s;
    const w = 5 * u, h = 9 * u;
    ctx.beginPath(); ctx.roundRect(base.x - w / 2, base.y - h, w, h, 1); ctx.fillStyle = '#9aa29a'; ctx.fill();
    ctx.lineWidth = Math.max(1, u * 0.5); ctx.strokeStyle = OL; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(base.x - w * 0.65, base.y - h - u * 1.2, w * 1.3, u * 1.4, 1); ctx.fillStyle = '#7d847c'; ctx.fill(); ctx.stroke();
    if (season.snow > 0.3) { ctx.beginPath(); ctx.ellipse(base.x, base.y - h - u * 1.3, w * 0.7, u * 0.6, 0, 0, Math.PI * 2); ctx.fillStyle = '#fbfdff'; ctx.fill(); ctx.stroke(); }
  }
  // gable end facing the driver, with the station clock
  const corners = [spot(nearT, 38, 0), spot(nearT, 68, 0), spot(nearT, 68, 26), spot(nearT, 53, 40), spot(nearT, 38, 26)];
  if (showGable && corners.every(Boolean)) {
    const lw = Math.max(1, s * 0.6);
    ctx.beginPath(); corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.fillStyle = '#c4553a'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = 'rgba(255,230,210,0.35)'; ctx.lineWidth = Math.max(0.6, s * 0.25);
    const top = Math.min(corners[3].y, corners[2].y), bot = corners[0].y, l = Math.min(corners[0].x, corners[1].x), rgt = Math.max(corners[0].x, corners[1].x);
    ctx.beginPath();
    for (let y = bot; y > top; y -= Math.max(2, 2 * s)) { ctx.moveTo(l, y); ctx.lineTo(rgt, y); }
    ctx.stroke();
    const p0 = spot(nearT, 38, 3);
    ctx.fillStyle = '#9aa29a'; ctx.fillRect(l, p0.y, rgt - l, bot - p0.y);
    ctx.restore();
    ctx.beginPath(); corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.lineWidth = lw * 1.4; ctx.strokeStyle = OL; ctx.stroke();
    // bargeboards
    ctx.lineWidth = Math.max(2, s * 1.8); ctx.strokeStyle = OL;
    ctx.beginPath(); ctx.moveTo(corners[4].x, corners[4].y); ctx.lineTo(corners[3].x, corners[3].y); ctx.lineTo(corners[2].x, corners[2].y); ctx.stroke();
    ctx.lineWidth = Math.max(1, s * 1.1); ctx.strokeStyle = '#efe6d2'; ctx.stroke();
    // the clock
    const ck = spot(nearT, 53, 28);
    if (ck) {
      const cr = Math.max(2, 5 * s);
      ctx.beginPath(); ctx.arc(ck.x, ck.y, cr + Math.max(1, s * 0.8), 0, Math.PI * 2); ctx.fillStyle = '#e8b23f'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = OL; ctx.stroke();
      ctx.beginPath(); ctx.arc(ck.x, ck.y, cr, 0, Math.PI * 2); ctx.fillStyle = night ? '#fff3c4' : '#fffbe8'; ctx.fill();
      const hA = clock * 0.02 - Math.PI / 2, mA = clock * 0.25 - Math.PI / 2;
      ctx.strokeStyle = OL; ctx.lineWidth = Math.max(1, s * 0.5);
      ctx.beginPath(); ctx.moveTo(ck.x, ck.y); ctx.lineTo(ck.x + Math.cos(hA) * cr * 0.5, ck.y + Math.sin(hA) * cr * 0.5); ctx.moveTo(ck.x, ck.y); ctx.lineTo(ck.x + Math.cos(mA) * cr * 0.8, ck.y + Math.sin(mA) * cr * 0.8); ctx.stroke();
    }
    // a door in the end wall
    const d0 = spot(nearT, 49, 0), d1 = spot(nearT, 57, 13);
    if (d0 && d1) { ctx.beginPath(); ctx.roundRect(Math.min(d0.x, d1.x), d1.y, Math.abs(d1.x - d0.x), d0.y - d1.y, [s * 2, s * 2, 0, 0]); ctx.fillStyle = '#2f6b4a'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = OL; ctx.stroke(); }
  }
  // benches under the canopy
  for (let t = 0.12; t < 1; t += 0.22) {
    const a = spot(t, 33, 5), b = spot(t, 33, 9);
    if (!a || !b) continue;
    const u = Math.abs((spot(t, 34, 5) || a).x - a.x) || a.s, w = 7 * u;
    ctx.beginPath(); ctx.roundRect(a.x - w / 2, b.y, w, (a.y - b.y) * 0.45, 1); ctx.fillStyle = '#a8713f'; ctx.fill(); ctx.lineWidth = Math.max(0.8, u * 0.4); ctx.strokeStyle = OL; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(a.x - w / 2, b.y + (a.y - b.y) * 0.5, w, (a.y - b.y) * 0.2, 1); ctx.fill(); ctx.stroke();
  }
  // iron columns holding up the canopy (grouped by thickness: two strokes per group)
  const cols = new Map();
  for (let t = 0; t <= 1.001; t += 0.125) {
    const a = spot(t, 15, 5), b = spot(t, 15, 17);
    if (!a || !b) continue;
    const u = Math.abs((spot(t, 16, 5) || a).x - a.x) || a.s;
    const lw = Math.round(Math.max(1, u * 1.2) * 2) / 2;
    let path = cols.get(lw);
    if (!path) cols.set(lw, (path = new Path2D()));
    path.moveTo(a.x, a.y); path.lineTo(b.x, b.y);
  }
  ctx.lineCap = 'round';
  for (const [lw, path] of cols) { ctx.strokeStyle = OL; ctx.lineWidth = Math.max(1.5, lw) + 2; ctx.stroke(path); }
  for (const [lw, path] of cols) { ctx.strokeStyle = '#2f6b4a'; ctx.lineWidth = lw; ctx.stroke(path); }
  // canopy roof over the platform, then its sawtooth valance
  mapSurface(ctx, canopy, (t) => { const a = spot(t, 38, 18), b = spot(t, 14, 17); return a && b ? { a: [a.x, a.y], b: [b.x, b.y] } : null; }, strips);
  mapSurface(ctx, valance, (t) => { const a = spot(t, 14, 17), b = spot(t, 14, 13.5); return a && b ? { a: [a.x, a.y], b: [b.x, b.y] } : null; }, strips);
}
