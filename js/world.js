// Procedural map generation and track geometry.
import { mulberry32, hash } from './rng.js';
import { TOWN_NAMES, NODE_TYPES } from './data.js';

// The world is the original 1000 x 1700 map (kept exactly as it was, so old
// saves line up) with new country added all round it.
const CORE_W = 1000, CORE_H = 1700;
const OX = 320, OY = 380; // where the original map sits in the bigger world
export const WORLD_W = CORE_W + OX * 2;
export const WORLD_H = CORE_H + OY * 2;

const INDUSTRIES = ['farm', 'farm', 'farm', 'foodplant', 'forest', 'forest', 'sawmill', 'mine', 'mine', 'power', 'farm', 'forest'];
const TOWN_COUNT = 11;
const NEW_INDUSTRIES = ['farm', 'forest', 'mine', 'farm', 'sawmill', 'foodplant', 'forest', 'mine', 'power', 'farm'];
const NEW_TOWNS = 7;

export function generateWorld(seed) {
  const w = generateCore(seed);
  extendWorld(w, seed);
  return w;
}

function generateCore(seed) {
  const WORLD_W = CORE_W, WORLD_H = CORE_H;
  const r = mulberry32(seed);

  const lakes = [];
  for (let i = 0; i < 3; i++) {
    const cx = 120 + r() * (WORLD_W - 240), cy = 150 + r() * (WORLD_H - 300);
    const blobs = [];
    const n = 4 + Math.floor(r() * 4);
    for (let j = 0; j < n; j++) {
      blobs.push({ x: cx + (r() - 0.5) * 90, y: cy + (r() - 0.5) * 70, r: 22 + r() * 38 });
    }
    lakes.push(blobs);
  }
  const inLake = (x, y, pad = 0) =>
    lakes.some((bs) => bs.some((b) => Math.hypot(x - b.x, y - b.y) < b.r + pad));

  const river = [];
  let rx = 200 + r() * 600;
  for (let y = -40; y <= WORLD_H + 40; y += 35) {
    river.push({ x: rx, y });
    rx += (r() - 0.5) * 70;
    rx = Math.max(60, Math.min(WORLD_W - 60, rx));
  }
  const nearRiver = (x, y, pad) => river.some((p) => Math.hypot(x - p.x, y - p.y) < pad);

  const nodes = [];
  const place = (type) => {
    let minD = 150;
    for (let attempt = 0; attempt < 2000; attempt++) {
      if (attempt % 300 === 299) minD *= 0.85;
      const x = 60 + r() * (WORLD_W - 120);
      const y = 70 + r() * (WORLD_H - 140);
      if (inLake(x, y, 30) || nearRiver(x, y, 30)) continue;
      if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < minD)) continue;
      const node = { id: nodes.length, type, x, y };
      nodes.push(node);
      return node;
    }
  };

  const names = [...TOWN_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  for (let i = 0; i < TOWN_COUNT; i++) {
    const t = place('town');
    t.name = names[i];
    t.basePop = Math.round(i === 0 ? 1100 : 220 + r() * 650);
    t.houses = [];
    for (let h = 0; h < 40; h++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.85;
      t.houses.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, s: 0.16 + r() * 0.1, c: Math.floor(r() * 4) });
    }
    // sort so the densest centre is drawn first and small towns stay compact
    t.houses.sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
  }
  const towns = nodes.slice();
  for (const type of INDUSTRIES) {
    const n = place(type);
    if (!n) continue;
    let best = towns[0], bd = Infinity;
    for (const t of towns) {
      const d = Math.hypot(t.x - n.x, t.y - n.y);
      if (d < bd) { bd = d; best = t; }
    }
    n.name = `${best.name} ${NODE_TYPES[type].name}`;
  }

  const trees = [];
  for (let i = 0; i < 850; i++) {
    const cx = r() * WORLD_W, cy = r() * WORLD_H;
    const k = 2 + Math.floor(r() * 6);
    for (let j = 0; j < k; j++) {
      const x = cx + (r() - 0.5) * 40, y = cy + (r() - 0.5) * 40;
      if (inLake(x, y, 4) || nearRiver(x, y, 12)) continue;
      if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 32)) continue;
      trees.push({ x, y, s: 3 + r() * 4, c: Math.floor(r() * 3) });
    }
  }

  return { seed, nodes, lakes, river, trees, names: names.slice(TOWN_COUNT), peaks: [] };
}

// Shift the original map into the middle and fill the new land around it:
// more towns and industries, lakes, forests, a mountain range, and the
// river running on to both edges.
function extendWorld(w, seed) {
  const r = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  for (const n of w.nodes) { n.x += OX; n.y += OY; }
  for (const bs of w.lakes) for (const b of bs) { b.x += OX; b.y += OY; }
  for (const t of w.trees) { t.x += OX; t.y += OY; }
  w.river = w.river.map((p) => ({ x: p.x + OX, y: p.y + OY }));
  // carry the river on up and down to the edges
  const first = w.river[0], last = w.river[w.river.length - 1];
  const up = [], down = [];
  let x = first.x;
  for (let y = first.y - 35; y >= -40; y -= 35) { x = Math.max(80, Math.min(WORLD_W - 80, x + (r() - 0.5) * 70)); up.unshift({ x, y }); }
  x = last.x;
  for (let y = last.y + 35; y <= WORLD_H + 40; y += 35) { x = Math.max(80, Math.min(WORLD_W - 80, x + (r() - 0.5) * 70)); down.push({ x, y }); }
  w.river = [...up, ...w.river, ...down];

  const inCore = (x, y, pad = 0) => x > OX - pad && x < OX + CORE_W + pad && y > OY - pad && y < OY + CORE_H + pad;
  const inLake = (x, y, pad = 0) => w.lakes.some((bs) => bs.some((b) => Math.hypot(x - b.x, y - b.y) < b.r + pad));
  const nearRiver = (x, y, pad) => w.river.some((p) => Math.hypot(x - p.x, y - p.y) < pad);
  const outer = () => {
    for (let i = 0; i < 400; i++) {
      const x = 50 + r() * (WORLD_W - 100), y = 50 + r() * (WORLD_H - 100);
      if (!inCore(x, y, 30)) return { x, y };
    }
    return { x: 60, y: 60 };
  };

  // a mountain range across the top, and a few peaks along one side
  const peaks = [];
  for (let px = 40; px < WORLD_W - 40; px += 46 + r() * 30) peaks.push({ x: px, y: 70 + r() * 150, r: 34 + r() * 30 });
  const side = r() < 0.5 ? 60 : WORLD_W - 60;
  for (let py = WORLD_H * 0.55; py < WORLD_H - 60; py += 60 + r() * 50) peaks.push({ x: side + (r() - 0.5) * 80, y: py, r: 30 + r() * 26 });
  const nearPeak = (x, y, pad) => peaks.some((p) => Math.hypot(x - p.x, y - p.y) < p.r + pad);
  w.peaks = peaks.filter((p) => !nearRiver(p.x, p.y, p.r + 10));

  // new lakes out in the country
  for (let i = 0; i < 3; i++) {
    let c = outer();
    for (let k = 0; k < 20 && (nearPeak(c.x, c.y, 60) || nearRiver(c.x, c.y, 90)); k++) c = outer();
    const blobs = [];
    const n = 3 + Math.floor(r() * 4);
    for (let j = 0; j < n; j++) blobs.push({ x: c.x + (r() - 0.5) * 80, y: c.y + (r() - 0.5) * 60, r: 20 + r() * 34 });
    w.lakes.push(blobs);
  }

  // no trees standing in the new lakes
  w.trees = w.trees.filter((t) => !inLake(t.x, t.y, 4));

  const nodes = w.nodes;
  const place = (type) => {
    let minD = 170;
    for (let attempt = 0; attempt < 2000; attempt++) {
      if (attempt % 300 === 299) minD *= 0.85;
      const { x, y } = outer();
      if (x < 70 || y < 260 || x > WORLD_W - 70 || y > WORLD_H - 70) continue;
      if (inLake(x, y, 30) || nearRiver(x, y, 30) || nearPeak(x, y, 30)) continue;
      if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < minD)) continue;
      const node = { id: nodes.length, type, x, y };
      nodes.push(node);
      return node;
    }
  };
  const newTowns = [];
  for (let i = 0; i < NEW_TOWNS && i < w.names.length; i++) {
    const t = place('town');
    if (!t) continue;
    t.name = w.names[i];
    t.basePop = Math.round(220 + r() * 600);
    t.houses = [];
    for (let h = 0; h < 40; h++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.85;
      t.houses.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, s: 0.16 + r() * 0.1, c: Math.floor(r() * 4) });
    }
    t.houses.sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
    newTowns.push(t);
  }
  const towns = nodes.filter((n) => n.type === 'town');
  for (const type of NEW_INDUSTRIES) {
    const n = place(type);
    if (!n) continue;
    let best = towns[0], bd = Infinity;
    for (const t of towns) { const d = Math.hypot(t.x - n.x, t.y - n.y); if (d < bd) { bd = d; best = t; } }
    n.name = `${best.name} ${NODE_TYPES[type].name}`;
  }

  // forests in the new land, thicker towards the mountains
  for (let i = 0; i < 1100; i++) {
    const { x: cx, y: cy } = outer();
    const k = 2 + Math.floor(r() * 6);
    for (let j = 0; j < k; j++) {
      const x = cx + (r() - 0.5) * 40, y = cy + (r() - 0.5) * 40;
      if (inCore(x, y) || inLake(x, y, 4) || nearRiver(x, y, 12) || nearPeak(x, y, -6)) continue;
      if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 32)) continue;
      w.trees.push({ x, y, s: 3 + r() * 4, c: Math.floor(r() * 3) });
    }
  }
  // room to grow: 80 more house plots round every town, further out
  for (const t of nodes) {
    if (t.type !== 'town') continue;
    for (let h = 0; h < 80; h++) {
      const a = r() * Math.PI * 2, d = 0.45 + Math.sqrt(r()) * 0.5;
      t.houses.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, s: 0.14 + r() * 0.1, c: Math.floor(r() * 4) });
    }
    const core = t.houses.slice(0, 40), more = t.houses.slice(40).sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
    t.houses = [...core, ...more];
  }
  delete w.names;
}

// Gently curved track between two nodes, with an arc-length table so
// trains move at an even pace along it.
export function trackGeom(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const straight = Math.hypot(dx, dy);
  const nx = -dy / straight, ny = dx / straight;
  const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
  const off = (hash(lo * 131 + hi, 7) - 0.5) * 0.28 * straight;
  const cx = (a.x + b.x) / 2 + nx * off, cy = (a.y + b.y) / 2 + ny * off;
  const N = 48;
  const pts = [], cum = [0];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y });
    if (i > 0) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, len: cum[N], straight };
}

export function pointAt(g, d) {
  const { pts, cum } = g;
  d = Math.max(0, Math.min(g.len, d));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (d - cum[lo]) / seg;
  const p = pts[lo], q = pts[hi];
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, a: Math.atan2(q.y - p.y, q.x - p.x) };
}
