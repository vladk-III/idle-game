// Procedural map generation and track geometry.
import { mulberry32, hash } from './rng.js';
import { TOWN_NAMES, NODE_TYPES } from './data.js';

export const WORLD_W = 1000;
export const WORLD_H = 1700;

const INDUSTRIES = ['farm', 'farm', 'farm', 'foodplant', 'forest', 'forest', 'sawmill', 'mine', 'mine', 'power', 'farm', 'forest'];
const TOWN_COUNT = 11;

export function generateWorld(seed) {
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

  return { seed, nodes, lakes, river, trees };
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
