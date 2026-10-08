// Heritage trains for the trackside and passenger views: four steam
// locomotives that grow with each upgrade (2-2-2, 2-4-2, 2-6-2, 2-8-2), their
// tenders, and wooden wagons. Adapted from Kooky's "Pixel Train" asset pack
// (https://kooky.itch.io/pixel-train, CC BY 4.0), redrawn in the game's
// smooth cartoon style.
//
// The parts that never change (bodies, cabs, roofs, planks) are painted once
// into cached images; only the wheels, rods, driver and loads are drawn each
// frame.
import { OL, shade, glossy, glossyRect, outlined, blob, person, snowCap } from './toon.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

const BOILER = '#3b2e4f', BOILER_HI = '#56456e', SMOKEBOX = '#2a2236', BRASS = '#f2c14e', DARK = '#3a3340', IRON = '#2e2838';

// ---------- the four steam engines ----------
// len: body length; n/R: driving wheels and their radius; tender: tender length
export const STEAM = [
  { arr: '2-2-2', len: 132, n: 1, R: 21, top: 80, stack: 'balloon', tender: 52, tWheels: 2, cabH: 112 },
  { arr: '2-4-2', len: 152, n: 2, R: 18, top: 82, stack: 'diamond', tender: 60, tWheels: 2, cabH: 114 },
  { arr: '2-6-2', len: 172, n: 3, R: 17, top: 84, stack: 'straight', tender: 68, tWheels: 3, cabH: 116 },
  { arr: '2-8-2', len: 194, n: 4, R: 16, top: 88, stack: 'straight', tender: 78, tWheels: 4, cabH: 120 },
];

// ---------- cached static images ----------
const cache = new Map();
function pxOf(ctx) { const t = ctx.getTransform(); return Math.round(Math.hypot(t.a, t.b) * 4) / 4 || 1; }
// Paint once (anchor at 0,0 inside the box x0..x1, y0..y1), then stamp.
function stamp(ctx, key, x0, y0, x1, y1, ax, ay, paint) {
  const px = pxOf(ctx);
  const k = key + '|' + px;
  let c = cache.get(k);
  if (!c) {
    if (cache.size > 160) cache.clear();
    c = document.createElement('canvas');
    c.width = Math.ceil((x1 - x0) * px); c.height = Math.ceil((y1 - y0) * px);
    const x = c.getContext('2d');
    x.scale(px, px); x.translate(-x0, -y0);
    x.lineJoin = 'round'; x.lineCap = 'round';
    paint(x);
    cache.set(k, c);
  }
  ctx.drawImage(c, ax + x0, ay + y0, x1 - x0, y1 - y0);
}

// A spoked wheel image, drawn turned by rot each frame.
function wheel(ctx, x, y, r, rot, hub, driver = false) {
  const key = `wheel|${r}|${hub}|${driver}`;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  stamp(ctx, key, -r - 2, -r - 2, r + 2, r + 2, 0, 0, (c) => {
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fillStyle = IRON; c.fill();
    c.lineWidth = 2; c.strokeStyle = OL; c.stroke();
    c.beginPath(); c.arc(0, 0, r * 0.8, 0, Math.PI * 2); c.fillStyle = hub; c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.stroke();
    // counterweight on the big driving wheels
    if (driver) { c.beginPath(); c.arc(0, 0, r * 0.74, Math.PI * 0.15, Math.PI * 0.85); c.closePath(); c.fillStyle = shade(hub, -0.35); c.fill(); }
    const spokes = r > 12 ? 10 : r > 8 ? 6 : 0;
    c.strokeStyle = shade(hub, -0.4); c.lineWidth = Math.max(1, r * 0.09);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      c.beginPath(); c.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25); c.lineTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78); c.stroke();
    }
    c.beginPath(); c.arc(0, 0, Math.max(2, r * 0.24), 0, Math.PI * 2); c.fillStyle = '#d7dbe0'; c.fill();
    c.lineWidth = 1.2; c.strokeStyle = OL; c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath(); c.arc(-r * 0.35, -r * 0.45, r * 0.18, 0, Math.PI * 2); c.fill();
  });
  ctx.restore();
}

// ---------- locomotive ----------
// Draws engine m (0-3) with its front at fx, rails at y. Returns where the
// chimney and lamp are so the caller can add smoke and night lights.
export function drawSteamLoco(ctx, fx, y, m, color, rot, snow, clock, driverFn) {
  const S = STEAM[m];
  const L = S.len, top = S.top;
  const red = color, redDark = shade(color, -0.25);
  const sn = Math.round(snow * 4) / 4;
  const cabX = -L, cabW = 44, bx0 = cabX + cabW - 4, bx1 = -6;
  const stackX = -24;

  stamp(ctx, `loco|${m}|${color}|${sn}`, -L - 10, -S.cabH - 30, 22, -14, fx, y, (c) => {
    // frame and running board
    glossyRect(c, cabX + 6, -40, L - 10, 10, 3, DARK, { gloss: false, lw: 2 });
    // cylinder by the front wheels
    glossyRect(c, -42, -44, 32, 18, 5, SMOKEBOX, { lw: 2 });
    c.fillStyle = BRASS; c.fillRect(-38, -37, 24, 3);
    // boiler and smokebox
    glossyRect(c, bx0, -top, bx1 - bx0, top - 44, (top - 44) / 2, BOILER, { lw: 2.5 });
    glossyRect(c, -34, -top - 3, 30, top - 39, 10, SMOKEBOX, { lw: 2.5 });
    // brass bands round the boiler
    c.strokeStyle = BRASS; c.lineWidth = 3;
    const bands = Math.max(2, Math.round((bx1 - bx0 - 30) / 34));
    for (let i = 1; i <= bands; i++) {
      const x = bx0 + ((-34 - bx0) * i) / (bands + 1);
      c.beginPath(); c.moveTo(x, -top + 2); c.lineTo(x, -46); c.stroke();
    }
    // a shine along the top of the boiler
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(bx0 + 12, -top + 7); c.lineTo(-40, -top + 7); c.stroke();
    // running board
    glossyRect(c, bx0 - 2, -48, bx1 - bx0 + 6, 5, 2, redDark, { gloss: false, lw: 1.8 });
    // chimney
    const st = -top - 2;
    if (S.stack === 'balloon') {
      outlined(c, () => { c.moveTo(stackX - 5, st); c.lineTo(stackX - 6, st - 18); c.lineTo(stackX - 16, st - 34); c.quadraticCurveTo(stackX, st - 44, stackX + 16, st - 34); c.lineTo(stackX + 6, st - 18); c.lineTo(stackX + 5, st); c.closePath(); }, SMOKEBOX, 2.2);
      c.fillStyle = BRASS; c.fillRect(stackX - 14, st - 36, 28, 3);
    } else if (S.stack === 'diamond') {
      outlined(c, () => { c.moveTo(stackX - 5, st); c.lineTo(stackX - 5, st - 16); c.lineTo(stackX - 13, st - 26); c.lineTo(stackX, st - 36); c.lineTo(stackX + 13, st - 26); c.lineTo(stackX + 5, st - 16); c.lineTo(stackX + 5, st); c.closePath(); }, SMOKEBOX, 2.2);
    } else {
      outlined(c, () => { c.moveTo(stackX - 6, st); c.lineTo(stackX - 6, st - 24); c.lineTo(stackX + 6, st - 24); c.lineTo(stackX + 6, st); c.closePath(); }, SMOKEBOX, 2.2);
      glossyRect(c, stackX - 9, st - 30, 18, 7, 2, SMOKEBOX, { gloss: false, lw: 2 });
      c.fillStyle = BRASS; c.fillRect(stackX - 8, st - 24, 16, 2);
    }
    // steam dome (brass) and sand dome
    const dome = (x, w, h, col) => outlined(c, () => { c.moveTo(x - w, -top + 3); c.quadraticCurveTo(x - w, -top - h, x, -top - h); c.quadraticCurveTo(x + w, -top - h, x + w, -top + 3); c.closePath(); }, col, 2);
    const mid = (bx0 + -34) / 2;
    dome(mid + 10, 10, 15, BRASS);
    if (m >= 1) dome(mid - 22, 8, 10, redDark);
    // bell
    if (m >= 2) { outlined(c, () => { c.moveTo(-50, -top - 1); c.lineTo(-52, -top - 9); c.quadraticCurveTo(-46, -top - 14, -40, -top - 9); c.lineTo(-42, -top - 1); c.closePath(); }, BRASS, 1.5); }
    // lamp on the smokebox
    glossyRect(c, -20, -top - 15, 14, 12, 3, DARK, { gloss: false, lw: 1.8 });
    outlined(c, () => c.roundRect(-9, -top - 13, 5, 8, 2), '#ffe28a', 1.2);
    // smokebox door rim and number plate
    c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-7, -top + 2); c.lineTo(-7, -46); c.stroke();
    outlined(c, () => c.roundRect(-30, -top + 12, 12, 7, 2), BRASS, 1.2);
    // cowcatcher
    outlined(c, () => { c.moveTo(-6, -36); c.lineTo(10, -36); c.lineTo(22, -14); c.lineTo(-6, -14); c.closePath(); }, red, 2);
    c.strokeStyle = BRASS; c.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) { const x = -2 + i * 6; c.beginPath(); c.moveTo(x, -34); c.lineTo(x + 8 + i * 1.5, -16); c.stroke(); }
    // cab
    const ct = -S.cabH;
    glossyRect(c, cabX, ct + 6, cabW, -40 - ct - 6, 4, red, { lw: 2.5 });
    c.strokeStyle = 'rgba(43,33,64,0.25)'; c.lineWidth = 1.2;
    for (let x = cabX + 7; x < cabX + cabW - 3; x += 7) { c.beginPath(); c.moveTo(x, ct + 40); c.lineTo(x, -42); c.stroke(); }
    c.fillStyle = BRASS; c.fillRect(cabX + 2, ct + 36, cabW - 4, 3);
    glossyRect(c, cabX - 5, ct, cabW + 10, 9, 4, DARK, { gloss: false, lw: 2 });
    outlined(c, () => c.roundRect(cabX + cabW - 18, ct + 14, 12, 18, 3), '#fdf3dc', 1.8);
    if (sn > 0) {
      snowCap(c, cabX - 5, ct, cabW + 10, sn);
      snowCap(c, bx0 + 6, -top, bx1 - bx0 - 50, sn * 0.8, { icicles: false });
    }
  });

  // wheels: leading, driving, trailing
  const lead = { x: fx - 22, r: 9 };
  const trail = { x: fx - L + 22, r: 9 };
  wheel(ctx, lead.x, y - lead.r, lead.r, rot * 1.8, redDark);
  wheel(ctx, trail.x, y - trail.r, trail.r, rot * 1.8, redDark);
  const R = S.R, gap = 2 * R + 5;
  const dEnd = fx - 44 - R;
  const drivers = [];
  for (let i = 0; i < S.n; i++) drivers.push(dEnd - i * gap);
  const dr = rot * (18 / R);
  for (const x of drivers) wheel(ctx, x, y - R, R, dr, red, true);
  // side rod linking the drivers, and the main rod back from the cylinder
  const cx = Math.cos(dr) * R * 0.5, cy = Math.sin(dr) * R * 0.5;
  const pins = drivers.map((x) => [x + cx, y - R + cy]);
  ctx.lineCap = 'round';
  if (pins.length > 1) {
    ctx.strokeStyle = OL; ctx.lineWidth = 5.5;
    ctx.beginPath(); ctx.moveTo(pins[0][0], pins[0][1]); ctx.lineTo(pins[pins.length - 1][0], pins[pins.length - 1][1]); ctx.stroke();
    ctx.strokeStyle = '#c9ced6'; ctx.lineWidth = 3;
    ctx.stroke();
  }
  const piston = [fx - 30 + Math.cos(dr) * 4, y - 35];
  ctx.strokeStyle = OL; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(piston[0], piston[1]); ctx.lineTo(pins[0][0], pins[0][1]); ctx.stroke();
  ctx.strokeStyle = '#e3e7ec'; ctx.lineWidth = 2.6; ctx.stroke();
  for (const [px, py] of pins) { ctx.fillStyle = '#d7dbe0'; ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill(); }

  // the driver in the cab window
  const winX = fx - L + 44 - 18, winY = y - S.cabH + 14;
  if (driverFn) driverFn(winX + 6, winY + 16, () => ctx.roundRect(winX, winY, 12, 18, 3));
  return {
    len: L,
    stack: { x: fx + stackX, y: y - top - 40 },
    lamp: { x: fx - 6, y: y - top - 9 },
    win: { x: winX, y: winY, w: 12, h: 18 },
  };
}

// Tender for engine m, its front coupled at x. Returns its length.
export function drawTender(ctx, x, y, m, color, rot, snow) {
  const S = STEAM[m], w = S.tender;
  const sn = Math.round(snow * 4) / 4;
  // the body sits down on the wheels (DROP), like the engine's
  stamp(ctx, `tender|${m}|${color}|${sn}`, -w - 6, -96, 6, -12, x, y + DROP, (c) => {
    glossyRect(c, -w + 2, -32, w - 4, 9, 3, DARK, { gloss: false, lw: 2 });
    glossyRect(c, -w, -72, w, 42, 6, color, { lw: 2.5 });
    c.strokeStyle = 'rgba(43,33,64,0.25)'; c.lineWidth = 1.2;
    for (let i = 1; i < 4; i++) { const yy = -72 + i * 10.5; c.beginPath(); c.moveTo(-w + 4, yy); c.lineTo(-4, yy); c.stroke(); }
    glossyRect(c, -w - 2, -76, w + 4, 7, 3, DARK, { gloss: false, lw: 2 });
    c.fillStyle = BRASS; c.fillRect(-w + 3, -40, w - 6, 3);
    // a heap of coal
    const heap = [];
    for (let i = 0; i < Math.round(w / 12); i++) heap.push([-w + 8 + i * 12, -77 - (i % 2) * 3, 7 + (i % 3)]);
    blob(c, heap, '#1f1a26', 1.5);
    c.fillStyle = 'rgba(255,255,255,0.28)';
    for (let i = 0; i < heap.length; i++) { c.beginPath(); c.arc(heap[i][0] - 2, heap[i][1] - 3, 1.6, 0, Math.PI * 2); c.fill(); }
    if (sn > 0) blob(c, heap.map(([hx, hy, r]) => [hx, hy - 3, r * 0.6 * sn + 1.5]), '#fbfdff', 1.2);
  });
  const n = S.tWheels, sp = (w - 24) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) wheel(ctx, x - 12 - i * sp, y - 8, 8, rot * 2.2, shade(color, -0.25));
  return w;
}

// ---------- wagons ----------
export const WAGON_W = 104;
// Wagon and tender bodies are drawn in coordinates where the frame sits at
// -32..-23; DROP lowers them so the frame rests on the wheel tops.
const DROP = 9;

// Draw a wagon whose front end is at x (rails at y). frac is how full it is
// (0..1). era: 'heritage' (wood, steam days) or 'modern' (steel, diesel and
// electric days). lights receives lit windows.
export function drawWagon(ctx, x, y0, cargo, frac, color, rot, snow, seed, clock, lights, era = 'heritage') {
  const w = WAGON_W, l = x - w, y = y0 + DROP;
  const sn = Math.round(snow * 4) / 4;
  const modern = era === 'modern';
  const kind = cargo === 'pax' ? 'coach' : cargo === 'goods' ? 'box' : cargo === 'food' ? 'tank' : cargo === 'logs' ? 'flat' : 'hopper';
  const frame = (c) => glossyRect(c, -w + 2, -32, w - 4, 9, 3, DARK, { gloss: false, lw: 2 });
  const bogies = () => { bogie(ctx, l + 20, y0, rot, modern); bogie(ctx, x - 20, y0, rot, modern); };

  if (kind === 'coach') {
    stamp(ctx, `coach|${era}|${color}|${sn}`, -w - 10, -104, 10, -14, x, y, (c) => {
      frame(c);
      if (!modern) {
        // end platforms with railings
        c.strokeStyle = OL; c.lineWidth = 1.6;
        for (const ex of [-w - 7, 1]) {
          c.strokeRect(ex, -62, 6, 26);
          c.beginPath(); c.moveTo(ex + 3, -62); c.lineTo(ex + 3, -36); c.stroke();
        }
        glossyRect(c, -w, -86, w, 56, 5, '#e6a245', { lw: 2.5 });
        c.strokeStyle = 'rgba(120,60,20,0.35)'; c.lineWidth = 1;
        for (let px = -w + 5; px < -2; px += 5) { c.beginPath(); c.moveTo(px, -54); c.lineTo(px, -33); c.stroke(); }
        c.fillStyle = color; c.fillRect(-w + 1, -56, w - 2, 4);
        for (let i = 0; i < 7; i++) outlined(c, () => c.roundRect(-w + 6 + i * 13.6, -80, 10, 18, 2), '#a9def5', 1.5);
        glossyRect(c, -w - 5, -94, w + 10, 9, 4, '#4a3b57', { gloss: false, lw: 2 });
        glossyRect(c, -w + 14, -100, w - 28, 7, 3, '#5a4a68', { gloss: false, lw: 1.8 });
        if (sn > 0) snowCap(c, -w - 5, -94, w + 10, sn);
      } else {
        // a fluted steel coach with wide windows and doors at each end
        glossyRect(c, -w, -90, w, 60, 9, '#d9dde3', { lw: 2.5 });
        c.strokeStyle = 'rgba(43,33,64,0.18)'; c.lineWidth = 1;
        for (let yy = -50; yy < -33; yy += 3) { c.beginPath(); c.moveTo(-w + 3, yy); c.lineTo(-3, yy); c.stroke(); }
        c.fillStyle = color; c.fillRect(-w + 1, -56, w - 2, 5);
        c.fillStyle = shade(color, -0.25); c.fillRect(-w + 1, -88, w - 2, 4);
        for (const dx of [-w + 4, -14]) outlined(c, () => c.roundRect(dx, -80, 10, 44, 2), '#b9c0c9', 1.5);
        for (let i = 0; i < 4; i++) outlined(c, () => c.roundRect(-w + 18 + i * 18.5, -80, 15, 18, 3), '#a9def5', 1.5);
        c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-w + 8, -86); c.lineTo(-8, -86); c.stroke();
        glossyRect(c, -w / 2 - 12, -95, 24, 6, 3, '#9aa1aa', { gloss: false, lw: 1.6 });
        if (sn > 0) snowCap(c, -w + 4, -90, w - 8, sn);
      }
    });
    // passengers at the windows, in proportion to the load
    const seats = modern ? 4 : 7;
    const people = clamp(Math.round(frac * seats + (hash(seed, 9) - 0.5) * frac * 2), 0, seats);
    for (let i = 0; i < seats; i++) {
      const wx = modern ? l + 18 + i * 18.5 : l + 6 + i * 13.6, ww = modern ? 15 : 10;
      if (people > 0 && hash(seed + i, 3) < people / seats + 0.001) person(ctx, wx + ww / 2, y - 66, 0.62, seed * 7 + i, clock);
      lights.push({ kind: 'win', soft: true, x: wx, y: y - 80, w: ww, h: 18 });
    }
    bogies();
    return;
  }

  if (kind === 'box') {
    stamp(ctx, `box|${era}|${color}|${sn}`, -w - 4, -100, 4, -14, x, y, (c) => {
      frame(c);
      if (!modern) {
        glossyRect(c, -w, -88, w, 58, 4, '#b5532f', { lw: 2.5 });
        c.strokeStyle = 'rgba(60,20,10,0.4)'; c.lineWidth = 1;
        for (let px = -w + 4; px < -2; px += 4) { c.beginPath(); c.moveTo(px, -85); c.lineTo(px, -33); c.stroke(); }
        c.fillStyle = '#8f3f22';
        for (let i = 1; i < 4; i++) c.fillRect(-w + (i * w) / 4 - 2, -88, 4, 58);
        glossyRect(c, -w - 3, -94, w + 6, 8, 3, '#6b2f1c', { gloss: false, lw: 2 });
      } else {
        // steel boxcar in the line's colour, with vertical ribs
        glossyRect(c, -w, -90, w, 60, 4, shade(color, -0.1), { lw: 2.5 });
        c.strokeStyle = 'rgba(43,33,64,0.3)'; c.lineWidth = 2;
        for (let px = -w + 8; px < -4; px += 9) { if (px > -w / 2 - 2 && px < -w / 4 + 2) continue; c.beginPath(); c.moveTo(px, -87); c.lineTo(px, -33); c.stroke(); }
        glossyRect(c, -w - 2, -94, w + 4, 6, 3, '#9aa1aa', { gloss: false, lw: 2 });
        c.font = '900 8px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
        c.fillText('GOODS', -w * 0.78, -60);
      }
      if (sn > 0) snowCap(c, -w - 3, -94, w + 6, sn);
    });
    // open door with crates inside, stacked to show the load
    const dx = l + w / 2 + 3, dw = w / 4 - 6;
    outlined(ctx, () => ctx.rect(dx, y - 84, dw, 50), '#4a2f22', 1.6);
    const crates = Math.round(frac * 4);
    for (let i = 0; i < crates; i++) {
      const cxp = dx + 2 + (i % 2) * (dw / 2 - 1), cyp = y - 36 - Math.floor(i / 2) * 11;
      outlined(ctx, () => ctx.rect(cxp, cyp - 10, dw / 2 - 3, 10), '#d9a35b', 1.2);
    }
    bogies();
    return;
  }

  if (kind === 'tank') {
    stamp(ctx, `tank|${era}|${sn}`, -w - 4, -100, 4, -14, x, y, (c) => {
      frame(c);
      const body = modern ? '#f4f6f8' : '#e9e2cf';
      glossyRect(c, -w + 2, -80, w - 4, 48, 24, body, { lw: 2.5, belly: 0.3 });
      c.strokeStyle = 'rgba(43,33,64,0.3)'; c.lineWidth = 1.5;
      for (const bx of [-w + 26, -26]) { c.beginPath(); c.moveTo(bx, -79); c.lineTo(bx, -33); c.stroke(); }
      if (modern) { c.fillStyle = '#3e66a3'; c.fillRect(-w + 3, -58, w - 6, 5); }
      glossyRect(c, -w / 2 - 9, -88, 18, 10, 4, '#6b6575', { gloss: false, lw: 2 });
      c.strokeStyle = OL; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(-w / 2 + 16, -86); c.lineTo(-w / 2 + 16, -32); c.moveTo(-w / 2 + 24, -86); c.lineTo(-w / 2 + 24, -32); c.stroke();
      for (let yy = -82; yy < -34; yy += 6) { c.beginPath(); c.moveTo(-w / 2 + 16, yy); c.lineTo(-w / 2 + 24, yy); c.stroke(); }
      c.font = '900 10px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#3e66a3'; c.fillText('MILK', -w + 38, modern ? -68 : -56);
      if (sn > 0) snowCap(c, -w + 14, -80, w - 28, sn, { icicles: false });
    });
    bogies();
    return;
  }

  if (kind === 'flat') {
    stamp(ctx, `flat|${era}`, -w - 4, -72, 4, -14, x, y, (c) => {
      frame(c);
      glossyRect(c, -w, -40, w, 9, 3, modern ? '#7d848e' : '#8a5a35', { gloss: false, lw: 2 });
      if (modern) for (const sx of [-w + 2, -10]) glossyRect(c, sx, -74, 8, 34, 2, shade(color, -0.1), { gloss: false, lw: 1.8 });
      else for (const sx of [-w + 4, -10]) outlined(c, () => c.rect(sx, -70, 6, 30), DARK, 1.5);
    });
    const rows = frac > 0.02 ? Math.max(1, Math.round(frac * 3)) : 0;
    for (let r = 0; r < rows; r++) {
      const ly = y - 51 - r * 11;
      glossyRect(ctx, l + 12, ly, w - 24, 11, 5.5, r % 2 ? '#a8713f' : '#bd8550', { lw: 1.6 });
      outlined(ctx, () => ctx.arc(x - 14, ly + 5.5, 5.5, 0, Math.PI * 2), '#e9c48f', 1.6);
    }
    if (rows && snow > 0.05) snowCap(ctx, l + 12, y - 51 - (rows - 1) * 11, w - 24, snow, { icicles: false });
    bogies();
    return;
  }

  // open hopper: grain or coal, heaped to show the load
  const coal = cargo === 'coal';
  if (frac > 0.02) {
    const hh = 4 + frac * 18, heapC = coal ? '#26222c' : '#f2c94c';
    blob(ctx, [[l + w * 0.3, y - 74, hh * 0.8], [l + w * 0.5, y - 74 - hh * 0.3, hh], [l + w * 0.7, y - 74, hh * 0.8]], heapC, 1.6);
  }
  stamp(ctx, `hopper|${era}|${coal}|${sn}`, -w - 4, -84, 4, -14, x, y, (c) => {
    frame(c);
    const col = modern ? (coal ? '#5b6270' : '#d0d4da') : coal ? '#4a4652' : '#c8873e';
    glossy(c, () => { c.moveTo(-w, -76); c.lineTo(0, -76); c.lineTo(-12, -30); c.lineTo(-w + 12, -30); c.closePath(); }, { x: -w, y: -76, w, h: 46 }, col);
    c.strokeStyle = 'rgba(43,33,64,0.45)'; c.lineWidth = 1.5;
    if (modern) { for (let px = -w + 12; px < -10; px += 12) { c.beginPath(); c.moveTo(px, -74); c.lineTo(px, -34); c.stroke(); } }
    else for (const rx of [-w + 34, -34]) { c.beginPath(); c.moveTo(rx, -72); c.lineTo(rx + (rx < -w / 2 ? 4 : -4), -34); c.stroke(); }
    if (sn > 0) snowCap(c, -w + 2, -76, w - 4, sn * 0.8, { icicles: false });
  });
  bogies();
}

function bogie(ctx, cx, y, rot, frame = false) {
  wheel(ctx, cx - 10, y - 8, 8, rot * 2.2, frame ? '#5b6270' : '#7a3a2a');
  wheel(ctx, cx + 10, y - 8, 8, rot * 2.2, frame ? '#5b6270' : '#7a3a2a');
  if (frame) sideframe(ctx, cx, y, 30);
}

// a bogie's side frame, in front of its wheels
function sideframe(ctx, cx, y, w) {
  stamp(ctx, `sideframe|${w}`, -w / 2 - 3, -17, w / 2 + 3, -3, cx, y, (c) => {
    glossyRect(c, -w / 2, -14, w, 7, 3, '#2e2838', { gloss: false, lw: 1.6 });
    for (const sx of [-w / 2 + 3, w / 2 - 9]) glossyRect(c, sx, -12, 6, 7, 1.5, '#4a4652', { gloss: false, lw: 1.2 });
  });
}

// ---------- diesel and electric engines ----------
export const MODERN = {
  diesel: { len: 152 },
  electric: { len: 138 },
};

// Draws a diesel (Co-Co, 1950s bulldog nose) or electric (Bo-Bo with a
// pantograph) engine with its front at fx, rails at y.
export function drawModernLoco(ctx, fx, y, style, color, rot, snow, driverFn) {
  const L = MODERN[style].len;
  const sn = Math.round(snow * 4) / 4;
  const cream = '#f3e3b5', dark = shade(color, -0.3);
  let win, stack, heads;
  if (style === 'diesel') {
    stamp(ctx, `diesel|${color}|${sn}`, -L - 6, -112, 10, -12, fx, y, (c) => {
      glossyRect(c, -L + 4, -32, L - 8, 9, 3, DARK, { gloss: false, lw: 2 });
      glossyRect(c, -L + 54, -30, L - 108, 16, 6, '#2e2838', { gloss: false, lw: 2 }); // fuel tank
      const body = () => {
        c.moveTo(-L, -30); c.lineTo(-L, -82); c.quadraticCurveTo(-L, -90, -L + 8, -90);
        c.lineTo(-48, -90); c.lineTo(-28, -66); c.quadraticCurveTo(4, -62, 4, -42); c.lineTo(4, -30); c.closePath();
      };
      glossy(c, body, { x: -L, y: -90, w: L + 4, h: 60 }, color);
      // cream stripe sweeping round the nose
      c.save(); c.beginPath(); body(); c.clip();
      c.fillStyle = cream; c.beginPath(); c.moveTo(-L, -52); c.lineTo(-40, -52); c.quadraticCurveTo(-8, -52, 6, -64); c.lineTo(6, -56); c.quadraticCurveTo(-8, -44, -40, -44); c.lineTo(-L, -44); c.closePath(); c.fill();
      c.restore();
      c.lineWidth = 2.5; c.strokeStyle = OL; c.beginPath(); body(); c.stroke();
      // windscreen and cab side window
      outlined(c, () => { c.moveTo(-46, -87); c.lineTo(-30, -68); c.lineTo(-44, -68); c.lineTo(-50, -76); c.closePath(); }, '#a9def5', 1.8);
      // portholes and louvres
      for (let i = 0; i < 3; i++) outlined(c, () => c.arc(-L + 70 + i * 22, -72, 5, 0, Math.PI * 2), '#a9def5', 1.5);
      outlined(c, () => c.roundRect(-L + 8, -82, 40, 18, 3), dark, 1.6);
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1;
      for (let yy = -79; yy < -65; yy += 3) { c.beginPath(); c.moveTo(-L + 11, yy); c.lineTo(-L + 45, yy); c.stroke(); }
      // roof fans, exhaust and horn
      for (const fx2 of [-L + 22, -L + 52]) glossyRect(c, fx2 - 9, -94, 18, 5, 2, '#4a4652', { gloss: false, lw: 1.6 });
      glossyRect(c, -L + 80, -96, 10, 7, 2, '#3a3340', { gloss: false, lw: 1.6 });
      outlined(c, () => { c.moveTo(-58, -91); c.lineTo(-52, -97); c.lineTo(-50, -95); c.lineTo(-54, -91); c.closePath(); }, '#c9ced6', 1.2);
      // nose light and number board
      outlined(c, () => c.arc(-6, -58, 4.5, 0, Math.PI * 2), '#ffe28a', 1.6);
      outlined(c, () => c.roundRect(-30, -86, 10, 6, 2), '#fdf3dc', 1.2);
      outlined(c, () => c.roundRect(2, -34, 8, 10, 2), '#3a3340', 1.4); // coupler
      if (sn > 0) snowCap(c, -L + 4, -90, L - 52, sn);
    });
    win = { x: fx - 66, y: y - 84, w: 14, h: 12 };
    stack = { x: fx - L + 85, y: y - 98, kind: 'exhaust' };
    heads = [{ x: fx - 6, y: y - 58 }];
    // two three-axle bogies
    for (const bc of [fx - 40, fx - L + 40]) {
      for (const dx of [-20, 0, 20]) wheel(ctx, bc + dx, y - 9, 9, rot * 2, '#5b6270');
      sideframe(ctx, bc, y, 54);
    }
  } else {
    const panX = -L / 2 - 6;
    stamp(ctx, `electric|${color}|${sn}`, -L - 6, -136, 10, -12, fx, y, (c) => {
      glossyRect(c, -L + 4, -32, L - 8, 9, 3, DARK, { gloss: false, lw: 2 });
      const body = () => {
        c.moveTo(-L - 2, -30); c.lineTo(-L - 2, -74); c.lineTo(-L + 8, -88); c.lineTo(-8, -88); c.lineTo(4, -74); c.lineTo(4, -30); c.closePath();
      };
      glossy(c, body, { x: -L, y: -88, w: L + 6, h: 58 }, color);
      c.fillStyle = '#f4f6f8'; c.fillRect(-L - 1, -52, L + 4, 6);
      c.strokeStyle = OL; c.lineWidth = 1.2; c.strokeRect(-L - 1, -52, L + 4, 6);
      // cab windows at both ends, louvres between
      for (const wx of [-22, -L + 8]) outlined(c, () => c.roundRect(wx, -80, 14, 16, 3), '#a9def5', 1.6);
      for (let i = 0; i < 4; i++) {
        const lx = -L + 32 + i * 20;
        outlined(c, () => c.roundRect(lx, -80, 14, 22, 2), dark, 1.4);
        c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 1;
        for (let yy = -77; yy < -60; yy += 3) { c.beginPath(); c.moveTo(lx + 2, yy); c.lineTo(lx + 12, yy); c.stroke(); }
      }
      // roof: insulators and the pantograph reaching up to the wire
      glossyRect(c, -L + 14, -92, L - 30, 5, 2, '#9aa1aa', { gloss: false, lw: 1.6 });
      for (const ix of [panX - 14, panX + 10]) outlined(c, () => c.roundRect(ix - 2, -98, 5, 7, 1.5), '#e9e2cf', 1.2);
      c.lineCap = 'round';
      c.strokeStyle = OL; c.lineWidth = 3.5;
      c.beginPath(); c.moveTo(panX - 12, -98); c.lineTo(panX + 6, -112); c.lineTo(panX - 8, -126); c.stroke();
      c.strokeStyle = '#c9ced6'; c.lineWidth = 2; c.stroke();
      glossyRect(c, panX - 24, -130, 32, 4, 2, '#c9ced6', { gloss: false, lw: 1.4 });
      // lights and coupler
      outlined(c, () => c.roundRect(-4, -44, 6, 6, 2), '#ffe28a', 1.4);
      outlined(c, () => c.roundRect(2, -34, 8, 10, 2), '#3a3340', 1.4);
      if (sn > 0) snowCap(c, -L + 10, -88, L - 20, sn);
    });
    win = { x: fx - 22, y: y - 80, w: 14, h: 16 };
    stack = { x: fx + panX - 8, y: y - 130, kind: 'spark' };
    heads = [{ x: fx, y: y - 41 }];
    // two two-axle bogies
    for (const bc of [fx - 32, fx - L + 32]) {
      for (const dx of [-12, 12]) wheel(ctx, bc + dx, y - 10, 10, rot * 1.8, '#5b6270');
      sideframe(ctx, bc, y, 40);
    }
  }
  if (driverFn) driverFn(win.x + win.w / 2, win.y + win.h, () => ctx.roundRect(win.x, win.y, win.w, win.h, 3));
  return { len: L, stack, heads, win };
}
