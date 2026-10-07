// Top-down map: terrain, tracks, stations, trains. Handles pan / pinch / tap.
import { NODE_TYPES, MODELS } from './data.js';
import { WORLD_W, WORLD_H, pointAt } from './world.js';
import { mulberry32 } from './rng.js';

const TERRAIN_SCALE = 1.5;
const HOUSE_COLORS = ['#c8553d', '#8d6e63', '#b0743c', '#6d7f8c'];
const TREE_COLORS = ['#2f5d34', '#3b6e3a', '#285030'];

export class MapView {
  constructor(canvas, game, handlers) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.g = game;
    this.h = handlers;
    this.cam = { x: WORLD_W / 2, y: WORLD_H / 2, s: 0.4 };
    this.floats = [];
    this.selected = null;   // node id
    this.connectFrom = null; // node id
    this.selectedLine = null;
    this.pointers = new Map();
    this.time = 0;
    this.bindInput();
  }

  buildTerrain() {
    const w = this.g.world;
    const c = document.createElement('canvas');
    c.width = WORLD_W * TERRAIN_SCALE;
    c.height = WORLD_H * TERRAIN_SCALE;
    const x = c.getContext('2d');
    x.scale(TERRAIN_SCALE, TERRAIN_SCALE);
    const r = mulberry32(w.seed ^ 0x5eed);

    x.fillStyle = '#6b9a52';
    x.fillRect(0, 0, WORLD_W, WORLD_H);
    const greens = ['#76a65a', '#5f8c48', '#82ad5f', '#678f4c', '#8aa864'];
    for (let i = 0; i < 380; i++) {
      x.globalAlpha = 0.35;
      x.fillStyle = greens[i % greens.length];
      x.beginPath();
      x.arc(r() * WORLD_W, r() * WORLD_H, 30 + r() * 90, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;

    // fields around farms and towns
    for (const n of w.nodes) {
      if (n.type !== 'farm' && n.type !== 'town') continue;
      const k = n.type === 'farm' ? 9 : 5;
      for (let i = 0; i < k; i++) {
        x.save();
        x.translate(n.x + (r() - 0.5) * 120, n.y + (r() - 0.5) * 120);
        x.rotate(r() * Math.PI);
        x.fillStyle = ['#d8c26a', '#b9a84f', '#a5b55a', '#c9b45c'][i % 4];
        x.globalAlpha = 0.55;
        x.fillRect(-18, -12, 36 + r() * 20, 24 + r() * 10);
        x.restore();
      }
    }
    x.globalAlpha = 1;

    // river
    const drawRiver = (width, color) => {
      x.strokeStyle = color; x.lineWidth = width; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath();
      const p = w.river;
      x.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length - 1; i++) {
        x.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
      }
      x.stroke();
    };
    drawRiver(18, '#8fb9a8');
    drawRiver(11, '#4f8fbf');

    for (const blobs of w.lakes) {
      x.fillStyle = '#8fb9a8';
      for (const b of blobs) { x.beginPath(); x.arc(b.x, b.y, b.r + 5, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = '#4f8fbf';
      for (const b of blobs) { x.beginPath(); x.arc(b.x, b.y, b.r, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = '#6aa5cf';
      for (const b of blobs) { x.beginPath(); x.arc(b.x - b.r * 0.2, b.y - b.r * 0.2, b.r * 0.5, 0, Math.PI * 2); x.fill(); }
    }

    for (const t of w.trees) {
      x.fillStyle = 'rgba(0,0,0,0.18)';
      x.beginPath(); x.arc(t.x + 1.5, t.y + 1.5, t.s, 0, Math.PI * 2); x.fill();
      x.fillStyle = TREE_COLORS[t.c];
      x.beginPath(); x.arc(t.x, t.y, t.s, 0, Math.PI * 2); x.fill();
    }
    this.terrain = c;
  }

  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.W = w; this.H = h;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.c.style.width = w + 'px';
    this.c.style.height = h + 'px';
    const fit = this.fitScale(w, h);
    if (!this.fitted) { this.cam = { x: WORLD_W / 2, y: WORLD_H / 2, s: fit }; this.fitted = true; }
    this.clampCam();
  }

  fitScale(w = this.W, h = this.H) { return Math.min(w / WORLD_W, (h - 60) / WORLD_H); }

  clampCam() {
    const fit = this.fitScale();
    this.cam.s = Math.max(fit * 0.9, Math.min(fit * 5, this.cam.s));
    const hw = this.W / 2 / this.cam.s, hh = this.H / 2 / this.cam.s;
    const clampAxis = (v, half, max) => (half * 2 >= max ? max / 2 : Math.max(half - 40, Math.min(max - half + 40, v)));
    this.cam.x = clampAxis(this.cam.x, hw, WORLD_W);
    this.cam.y = clampAxis(this.cam.y, hh, WORLD_H);
  }

  toScreen(x, y, cam = this.cam, W = this.W, H = this.H) {
    return { x: (x - cam.x) * cam.s + W / 2, y: (y - cam.y) * cam.s + H / 2 };
  }
  toWorld(sx, sy) {
    return { x: (sx - this.W / 2) / this.cam.s + this.cam.x, y: (sy - this.H / 2) / this.cam.s + this.cam.y };
  }

  focusOn(x, y) { this.cam.x = x; this.cam.y = y; this.clampCam(); }

  // ---------- input ----------

  bindInput() {
    const c = this.c;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (this.pointers.size === 2) this.pinch = this.pinchState();
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 1) {
        this.cam.x -= dx / this.cam.s;
        this.cam.y -= dy / this.cam.s;
        this.clampCam();
      } else if (this.pointers.size === 2 && this.pinch) {
        const now = this.pinchState();
        const before = this.toWorld(this.pinch.cx, this.pinch.cy);
        this.cam.s *= now.d / this.pinch.d;
        this.clampCam();
        const after = this.toWorld(now.cx, now.cy);
        this.cam.x += before.x - after.x;
        this.cam.y += before.y - after.y;
        this.clampCam();
        this.pinch = now;
      }
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (e.type === 'pointerup' && moved < 10 && performance.now() - p.t < 500 && this.pointers.size === 0) {
        const rect = c.getBoundingClientRect();
        this.tap(e.clientX - rect.left, e.clientY - rect.top);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const before = this.toWorld(sx, sy);
      this.cam.s *= Math.exp(-e.deltaY * 0.0015);
      this.clampCam();
      const after = this.toWorld(sx, sy);
      this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
      this.clampCam();
    }, { passive: false });
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    const rect = this.c.getBoundingClientRect();
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2 - rect.left, cy: (a.y + b.y) / 2 - rect.top };
  }

  tap(sx, sy) {
    let best = null, bd = 30;
    for (const n of this.g.world.nodes) {
      const p = this.toScreen(n.x, n.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = n; }
    }
    if (best) return this.h.onNode(best.id);
    let bestLine = null, ld = 16;
    for (const line of this.g.state.lines) {
      for (const q of this.g.geom(line).pts) {
        const p = this.toScreen(q.x, q.y);
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d < ld) { ld = d; bestLine = line; }
      }
    }
    if (bestLine) return this.h.onLine(bestLine.id);
    this.h.onEmpty();
  }

  addFloat(x, y, text, color = '#ffe680') {
    const stack = this.floats.filter((f) => f.x === x && f.y === y && f.t < 0.8).length;
    this.floats.push({ x, y, text, color, t: 0, oy: stack * 15 });
    if (this.floats.length > 30) this.floats.shift();
  }

  // ---------- drawing ----------

  draw(dt) { this.time += dt; this.render(this.ctx, this.W, this.H, this.cam, { dt }); }

  // Also used by the calm "map" scene in focus mode with its own camera.
  render(ctx, W, H, cam, opts = {}) {
    const g = this.g, s = cam.s, dpr = this.dpr || 1;
    const P = (x, y) => this.toScreen(x, y, cam, W, H);
    const zoomF = Math.sqrt(Math.max(1, Math.min(2.5, s / this.fitScale(W, H))));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#5f8a49';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-cam.x, -cam.y);
    if (this.terrain) ctx.drawImage(this.terrain, 0, 0, WORLD_W, WORLD_H);
    ctx.restore();

    const linesWithGeom = g.state.lines.map((l) => ({ l, geo: g.geom(l) }));
    const path = (pts) => {
      ctx.beginPath();
      pts.forEach((q, i) => { const p = P(q.x, q.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const { l, geo } of linesWithGeom) {
      path(geo.pts);
      ctx.strokeStyle = 'rgba(30,22,16,0.85)';
      ctx.lineWidth = (l.id === this.selectedLine ? 9 : 6.5) * zoomF;
      ctx.stroke();
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 3.2 * zoomF;
      ctx.stroke();
      if (zoomF > 1.25) {
        ctx.setLineDash([1.2, 5]);
        ctx.strokeStyle = 'rgba(40,25,15,0.7)';
        ctx.lineWidth = 6.5 * zoomF;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // connect-mode preview hints
    if (this.connectFrom != null && !opts.calm) {
      const a = g.node(this.connectFrom), pa = P(a.x, a.y);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      for (const n of g.world.nodes) {
        if (n.id === a.id) continue;
        const ok = (g.flow(a.id, n.id).length || g.flow(n.id, a.id).length) && !g.lineBetween(a.id, n.id);
        if (!ok) continue;
        const p = P(n.x, n.y);
        ctx.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 17 * zoomF + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(pa.x, pa.y, 20 * zoomF + pulse * 4, 0, Math.PI * 2); ctx.stroke();
    }

    // nodes
    for (const n of g.world.nodes) {
      const p = P(n.x, n.y);
      if (p.x < -60 || p.y < -60 || p.x > W + 60 || p.y > H + 60) continue;
      if (n.type === 'town') this.drawTown(ctx, n, p, zoomF);
      else this.drawIndustry(ctx, n, p, zoomF);
      if (n.id === this.selected && !opts.calm) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 22 * zoomF, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // trains
    for (const { l, geo } of linesWithGeom) {
      for (const t of l.trains) {
        const d = t.p * geo.len;
        const back = -t.dir; // wagons trail behind the direction of travel
        const step = 7 / s;
        const cars = Math.min(4, 1 + Math.ceil(MODELS[t.m].cap / 80));
        for (let i = cars; i >= 0; i--) {
          const q = pointAt(geo, d + back * step * i);
          const sp = P(q.x, q.y);
          ctx.save();
          ctx.translate(sp.x, sp.y);
          ctx.rotate(q.a);
          ctx.fillStyle = i === 0 ? '#222' : l.color;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 1;
          const w = 6 * zoomF, h = 4 * zoomF;
          ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 1.2); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
      }
    }

    // labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const showInd = s > this.fitScale(W, H) * 1.35;
    for (const n of g.world.nodes) {
      const isTown = n.type === 'town';
      if (!isTown && !showInd) continue;
      const p = P(n.x, n.y);
      const r = isTown ? this.townRadius(n) * zoomF : 13 * zoomF;
      ctx.font = isTown ? `600 ${Math.round(11 * Math.min(zoomF, 1.3))}px system-ui, sans-serif` : `500 ${Math.round(9.5 * Math.min(zoomF, 1.3))}px system-ui, sans-serif`;
      const label = isTown ? n.name : n.name.replace(/^\S+\s/, '');
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,28,18,0.8)';
      ctx.strokeText(label, p.x, p.y + r + 2);
      ctx.fillStyle = isTown ? '#fff' : '#e8efe0';
      ctx.fillText(label, p.x, p.y + r + 2);
    }

    // floating income
    const dt = opts.dt || 0;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      if (!opts.calm) f.t += dt;
      const p = P(f.x, f.y);
      const a = Math.max(0, 1 - f.t / 2);
      ctx.globalAlpha = a;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const fy = p.y - 22 - f.t * 18 - (f.oy || 0);
      ctx.strokeText(f.text, p.x, fy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, fy);
    }
    ctx.globalAlpha = 1;
    if (!opts.calm) this.floats = this.floats.filter((f) => f.t < 2);
  }

  townRadius(n) { return 9 + Math.sqrt(this.g.pop(n.id)) * 0.22; }

  drawTown(ctx, n, p, z) {
    const R = this.townRadius(n) * z;
    ctx.fillStyle = 'rgba(225,215,190,0.55)';
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
    const count = Math.min(n.houses.length, 4 + Math.floor(this.g.pop(n.id) / 70));
    for (let i = 0; i < count; i++) {
      const h = n.houses[i];
      const hx = p.x + h.dx * R, hy = p.y + h.dy * R, hs = Math.max(2.5, h.s * R);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(hx - hs / 2 + 1, hy - hs / 2 + 1, hs, hs);
      ctx.fillStyle = HOUSE_COLORS[h.c];
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 * z, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  drawIndustry(ctx, n, p, z) {
    const def = NODE_TYPES[n.type];
    const r = 12 * z;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.arc(p.x + 1.5, p.y + 1.5, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = `${Math.round(13 * z)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, p.x, p.y + 1);
    const lvl = this.g.level(n.id);
    if (lvl > 1) {
      ctx.fillStyle = '#ffd54a';
      ctx.font = `700 ${Math.round(9 * z)}px system-ui, sans-serif`;
      ctx.fillText('★'.repeat(lvl - 1), p.x, p.y - r - 5);
    }
  }
}
