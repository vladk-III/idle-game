// Everything a train passes along one line, taken from the real map: the track
// shape, trees, water, bridges, towns and industries beside it.
// Positions are stored as s (distance along the track from end A) and lat
// (signed distance to the side; positive = right when travelling A -> B).
import { pointAt } from './world.js';

export const EXT = 90; // track modelled past each end so termini have room
const STEP = 3;
const RIVER_HALF = 5.5;

export function isWater(world, x, y) {
  for (const bs of world.lakes) for (const b of bs) if (Math.hypot(x - b.x, y - b.y) < b.r) return true;
  const r = world.river;
  for (let i = 0; i < r.length - 1; i++) {
    const a = r[i], b = r[i + 1];
    const vx = b.x - a.x, vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy)));
    if (Math.hypot(x - a.x - vx * t, y - a.y - vy * t) < RIVER_HALF) return true;
  }
  return false;
}

export class Route {
  constructor(game, line) {
    this.game = game;
    this.line = line;
    this.geo = game.geom(line);
    this.L = this.geo.len;
    const w = game.world;

    this.samples = [];
    for (let s = -EXT; s <= this.L + EXT; s += STEP) this.samples.push({ s, ...this.posAt(s) });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.samples) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const inBox = (x, y, pad) => x > x0 - pad && x < x1 + pad && y > y0 - pad && y < y1 + pad;

    this.trees = [];
    for (const t of w.trees) {
      if (!inBox(t.x, t.y, 180)) continue;
      const pr = this.project(t.x, t.y);
      if (Math.abs(pr.lat) < 180 && Math.abs(pr.lat) > 5) this.trees.push({ x: t.x, y: t.y, size: t.s, c: t.c, s: pr.s, lat: pr.lat });
    }

    this.nodes = [];
    for (const n of w.nodes) {
      if (!inBox(n.x, n.y, 240)) continue;
      const pr = this.project(n.x, n.y);
      if (Math.abs(pr.lat) > 240) continue;
      const entry = { n, s: pr.s, lat: pr.lat, houses: null };
      if (n.type === 'town') {
        const R = 22 + Math.sqrt(n.basePop) * 0.55;
        entry.houses = n.houses.map((h, i) => {
          const x = n.x + h.dx * R, y = n.y + h.dy * R;
          const hp = this.project(x, y);
          return { i, x, y, s: hp.s, lat: hp.lat, c: h.c, size: 3 + h.s * 12 };
        }).filter((h) => Math.abs(h.lat) > 10 || h.s > this.L + 30 || h.s < -30);
      }
      this.nodes.push(entry);
    }

    // water beside the line, sampled on a grid in (s, lat)
    this.water = [];
    for (let s = -EXT; s <= this.L + EXT; s += 5) {
      const p = this.posAt(s);
      const rx = -Math.sin(p.a), ry = Math.cos(p.a);
      for (let lat = -170; lat <= 170; lat += 8) {
        if (isWater(w, p.x + rx * lat, p.y + ry * lat)) this.water.push({ s, lat });
      }
    }

    // spans where the track itself crosses water
    this.bridges = [];
    let open = null;
    for (let s = -EXT; s <= this.L + EXT; s += 1.5) {
      const p = this.posAt(s);
      const wet = isWater(w, p.x, p.y);
      if (wet && open == null) open = s;
      if (!wet && open != null) { this.bridges.push({ s0: open - 4, s1: s + 4 }); open = null; }
    }
    if (open != null) this.bridges.push({ s0: open - 4, s1: this.L + EXT });
    // only where there is actually track (it stops at a buffer just past each end)
    this.bridges = this.bridges
      .map((b) => ({ s0: Math.max(b.s0, -15), s1: Math.min(b.s1, this.L + 15) }))
      .filter((b) => b.s1 - b.s0 > 2);
  }

  posAt(s) {
    const g = this.geo;
    if (s < 0) { const p = pointAt(g, 0.01); return { x: p.x + Math.cos(p.a) * s, y: p.y + Math.sin(p.a) * s, a: p.a }; }
    if (s > this.L) { const p = pointAt(g, this.L - 0.01); const e = s - this.L; return { x: p.x + Math.cos(p.a) * e, y: p.y + Math.sin(p.a) * e, a: p.a }; }
    return pointAt(g, s);
  }

  project(x, y) {
    let best = this.samples[0], bd = Infinity;
    for (const p of this.samples) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    const dx = x - best.x, dy = y - best.y;
    const c = Math.cos(best.a), sn = Math.sin(best.a);
    return { s: best.s + dx * c + dy * sn, lat: -dx * sn + dy * c };
  }

  onBridge(s) { return this.bridges.some((b) => s > b.s0 && s < b.s1); }
}
