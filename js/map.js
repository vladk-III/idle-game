// Top-down map: terrain, tracks, stations, trains. Handles pan / pinch / tap.
import { NODE_TYPES, MODELS } from './data.js';
import { WORLD_W, WORLD_H, pointAt } from './world.js';
import { mulberry32, clamp } from './rng.js';
import { OL, shade, glossy, outlined } from './toon.js';

const TERRAIN_SCALE = 1.5;
const ROOFS = ['#e0594a', '#8d6e63', '#f08a24', '#5d7fb8'];
const WALLS = ['#fff1d6', '#f3dfbd', '#ffe8c2', '#f6f1e7'];
const TREE_COLORS = ['#2f9e55', '#4cbf56', '#63c94a'];
const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';

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
    x.lineCap = 'round'; x.lineJoin = 'round';
    const r = mulberry32(w.seed ^ 0x5eed);
    const circle = (cx, cy, rad) => { x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); };

    x.fillStyle = '#7ccc5a';
    x.fillRect(0, 0, WORLD_W, WORLD_H);
    const greens = ['#86d463', '#74c252', '#8fd86c', '#6fbb4e'];
    for (let i = 0; i < 260; i++) {
      x.globalAlpha = 0.45;
      x.fillStyle = greens[i % greens.length];
      circle(r() * WORLD_W, r() * WORLD_H, 30 + r() * 90); x.fill();
    }
    x.globalAlpha = 1;
    // grass tufts and wildflowers
    x.strokeStyle = 'rgba(52,128,48,0.55)'; x.lineWidth = 0.9;
    for (let i = 0; i < 1600; i++) {
      const gx = r() * WORLD_W, gy = r() * WORLD_H;
      x.beginPath(); x.moveTo(gx - 1.6, gy - 1.6); x.lineTo(gx, gy); x.lineTo(gx + 1.6, gy - 2); x.stroke();
    }
    const flowers = ['#fff6d8', '#ffd84a', '#ff8fa3', '#c38dd6'];
    for (let i = 0; i < 700; i++) { x.fillStyle = flowers[i % 4]; circle(r() * WORLD_W, r() * WORLD_H, 0.9); x.fill(); }

    // striped fields around farms and towns
    for (const n of w.nodes) {
      if (n.type !== 'farm' && n.type !== 'town') continue;
      const k = n.type === 'farm' ? 8 : 4;
      for (let i = 0; i < k; i++) {
        const fw = 30 + r() * 22, fh = 20 + r() * 12;
        x.save();
        x.translate(n.x + (r() - 0.5) * 120, n.y + (r() - 0.5) * 120);
        x.rotate(r() * Math.PI);
        const col = ['#f2c94c', '#e9b949', '#c6dd6a', '#f0d878'][i % 4];
        x.beginPath(); x.roundRect(-fw / 2, -fh / 2, fw, fh, 4);
        x.fillStyle = col; x.fill();
        x.strokeStyle = 'rgba(43,33,64,0.55)'; x.lineWidth = 1; x.stroke();
        x.strokeStyle = shade(col, -0.18); x.lineWidth = 1.2;
        for (let sx = -fw / 2 + 4; sx < fw / 2 - 2; sx += 4) { x.beginPath(); x.moveTo(sx, -fh / 2 + 2.5); x.lineTo(sx, fh / 2 - 2.5); x.stroke(); }
        x.restore();
      }
    }

    // river: outline, sandy bank, water, sparkle
    const riverPath = () => {
      const p = w.river;
      x.beginPath();
      x.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length - 1; i++) x.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    };
    for (const [wd, col] of [[19, OL], [16.5, '#ecd9a0'], [11, '#4aa3e0']]) { riverPath(); x.strokeStyle = col; x.lineWidth = wd; x.stroke(); }
    riverPath(); x.strokeStyle = 'rgba(160,220,250,0.8)'; x.lineWidth = 2; x.setLineDash([6, 10]); x.stroke(); x.setLineDash([]);

    // lakes: one clean outline round each blob, sand, water, ripples
    for (const blobs of w.lakes) {
      x.strokeStyle = OL; x.lineWidth = 3;
      for (const b of blobs) { circle(b.x, b.y, b.r + 5); x.stroke(); }
      x.fillStyle = '#ecd9a0';
      for (const b of blobs) { circle(b.x, b.y, b.r + 5); x.fill(); }
      x.fillStyle = '#4aa3e0';
      for (const b of blobs) { circle(b.x, b.y, b.r); x.fill(); }
      x.fillStyle = '#62b6ea';
      for (const b of blobs) { circle(b.x - b.r * 0.15, b.y - b.r * 0.15, b.r * 0.6); x.fill(); }
      x.strokeStyle = 'rgba(255,255,255,0.75)'; x.lineWidth = 1.4;
      for (const b of blobs) {
        for (let k = 0; k < 2; k++) {
          const wx = b.x + (r() - 0.5) * b.r, wy = b.y + (r() - 0.5) * b.r;
          x.beginPath(); x.arc(wx, wy, 3, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
          x.beginPath(); x.arc(wx + 6, wy, 3, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
        }
      }
    }

    // trees, back to front, each with a shadow, outline and highlight
    const trees = w.trees.slice().sort((a, b) => a.y - b.y);
    x.fillStyle = 'rgba(30,70,30,0.28)';
    for (const t of trees) { x.beginPath(); x.ellipse(t.x + 1.5, t.y + 2, t.s, t.s * 0.75, 0, 0, Math.PI * 2); x.fill(); }
    for (const t of trees) {
      circle(t.x, t.y, t.s + 0.8); x.fillStyle = OL; x.fill();
      circle(t.x, t.y, t.s); x.fillStyle = TREE_COLORS[t.c]; x.fill();
      circle(t.x + t.s * 0.25, t.y + t.s * 0.3, t.s * 0.55); x.fillStyle = shade(TREE_COLORS[t.c], -0.18); x.fill();
      circle(t.x - t.s * 0.35, t.y - t.s * 0.35, t.s * 0.38); x.fillStyle = 'rgba(255,255,255,0.32)'; x.fill();
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
    ctx.fillStyle = '#7ccc5a';
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
      const sel = l.id === this.selectedLine;
      path(geo.pts);
      if (sel) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 15 * zoomF; ctx.stroke(); }
      ctx.strokeStyle = OL; ctx.lineWidth = 9 * zoomF; ctx.stroke();
      ctx.strokeStyle = l.color; ctx.lineWidth = 6 * zoomF; ctx.stroke();
      // sleepers and a bit of shine
      ctx.setLineDash([1.6 * zoomF, 4.2 * zoomF]);
      ctx.strokeStyle = 'rgba(43,33,64,0.35)'; ctx.lineWidth = 6 * zoomF; ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.3 * zoomF; ctx.stroke();
    }

    // connect-mode preview hints
    if (this.connectFrom != null && !opts.calm) {
      const a = g.node(this.connectFrom), pa = P(a.x, a.y);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -this.time * 12;
      for (const n of g.world.nodes) {
        if (n.id === a.id) continue;
        const ok = (g.flow(a.id, n.id).length || g.flow(n.id, a.id).length) && !g.lineBetween(a.id, n.id);
        if (!ok) continue;
        const p = P(n.x, n.y);
        ctx.strokeStyle = OL; ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 19 * zoomF + pulse * 3, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2.5; ctx.stroke();
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.strokeStyle = OL; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(pa.x, pa.y, 22 * zoomF + pulse * 4, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.5; ctx.stroke();
    }

    // nodes
    for (const n of g.world.nodes) {
      const p = P(n.x, n.y);
      if (p.x < -60 || p.y < -60 || p.x > W + 60 || p.y > H + 60) continue;
      if (n.id === this.selected && !opts.calm) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
        ctx.fillStyle = `rgba(255,255,255,${0.25 + pulse * 0.15})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 25 * zoomF, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = OL; ctx.lineWidth = 5; ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      }
      if (n.type === 'town') this.drawTown(ctx, n, p, zoomF);
      else this.drawIndustry(ctx, n, p, zoomF);
    }

    // trains: a loco and a few wagons, outlined
    for (const { l, geo } of linesWithGeom) {
      for (const t of l.trains) {
        const d = t.p * geo.len;
        const back = -t.dir; // wagons trail behind the direction of travel
        const step = 8.5 * zoomF / s;
        const cars = Math.min(4, 1 + Math.ceil(MODELS[t.m].cap / 80));
        for (let i = cars; i >= 0; i--) {
          const q = pointAt(geo, d + back * step * i);
          const sp = P(q.x, q.y);
          const w = 8 * zoomF, h = 5.5 * zoomF;
          ctx.save();
          ctx.translate(sp.x, sp.y);
          ctx.rotate(q.a);
          ctx.fillStyle = 'rgba(30,20,40,0.25)';
          ctx.beginPath(); ctx.roundRect(-w / 2 + 1.2, -h / 2 + 1.8, w, h, 2); ctx.fill();
          glossy(ctx, () => ctx.roundRect(-w / 2, -h / 2, w, h, 2 * zoomF), { x: -w / 2, y: -h / 2, w, h }, i === 0 ? '#3a3340' : shade(l.color, 0.15), { lw: 1.3, belly: 0.2, gloss: false });
          if (i === 0) {
            ctx.fillStyle = '#ffe28a';
            ctx.beginPath(); ctx.arc(t.dir > 0 ? w * 0.28 : -w * 0.28, 0, 1.3 * zoomF, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }
      }
    }

    // labels in a chunky game font
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const showInd = s > this.fitScale(W, H) * 1.35;
    for (const n of g.world.nodes) {
      const isTown = n.type === 'town';
      if (!isTown && !showInd) continue;
      const p = P(n.x, n.y);
      const r = isTown ? this.townRadius(n) * zoomF : 13 * zoomF;
      const size = Math.round((isTown ? 12 : 10) * Math.min(zoomF, 1.3));
      ctx.font = `800 ${size}px ${FONT}`;
      const label = isTown ? n.name : n.name.replace(/^\S+\s/, '');
      ctx.lineWidth = isTown ? 4 : 3; ctx.strokeStyle = OL;
      ctx.strokeText(label, p.x, p.y + r + 3);
      ctx.fillStyle = isTown ? '#fff' : '#fff3c4';
      ctx.fillText(label, p.x, p.y + r + 3);
    }

    // floating income
    const dt = opts.dt || 0;
    ctx.font = `900 14px ${FONT}`;
    ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      if (!opts.calm) f.t += dt;
      const p = P(f.x, f.y);
      const a = Math.max(0, 1 - f.t / 2);
      ctx.globalAlpha = a;
      const fy = p.y - 24 - f.t * 18 - (f.oy || 0);
      const pop = 1 + Math.max(0, 0.25 - f.t) * 1.2; // a little pop as it appears
      ctx.save(); ctx.translate(p.x, fy); ctx.scale(pop, pop);
      ctx.lineWidth = 4; ctx.strokeStyle = OL; ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = '#ffd84a'; ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (!opts.calm) this.floats = this.floats.filter((f) => f.t < 2);
  }

  townRadius(n) { return 11 + Math.sqrt(this.g.pop(n.id)) * 0.26; }

  // A little village: a cobbled square, cartoon houses and a station.
  drawTown(ctx, n, p, z) {
    const R = this.townRadius(n) * z;
    ctx.fillStyle = 'rgba(30,20,40,0.15)';
    ctx.beginPath(); ctx.ellipse(p.x + 1.5, p.y + 2.5, R, R * 0.9, 0, 0, Math.PI * 2); ctx.fill();
    outlined(ctx, () => ctx.ellipse(p.x, p.y, R, R * 0.9, 0, 0, Math.PI * 2), '#f4e6c4', 1.5);
    const count = Math.min(n.houses.length, 6 + Math.floor(this.g.pop(n.id) / 55));
    const hs = n.houses.slice(0, count).sort((a, b) => a.dy - b.dy);
    for (const h of hs) {
      const hx = p.x + h.dx * R * 0.9, hy = p.y + h.dy * R * 0.8 + R * 0.08;
      const w = Math.max(4.5, h.s * R * 1.45), lw = clamp(w * 0.12, 0.8, 1.6);
      const wh = w * 0.55;
      outlined(ctx, () => ctx.rect(hx - w / 2, hy - wh, w, wh), WALLS[h.c], lw);
      outlined(ctx, () => { ctx.moveTo(hx - w * 0.62, hy - wh); ctx.lineTo(hx, hy - wh - w * 0.5); ctx.lineTo(hx + w * 0.62, hy - wh); ctx.closePath(); }, ROOFS[h.c], lw);
    }
    // station at the centre of town
    const sw = 11 * z, sh = 7 * z;
    glossy(ctx, () => ctx.roundRect(p.x - sw / 2, p.y - sh / 2, sw, sh, 2 * z), { x: p.x - sw / 2, y: p.y - sh / 2, w: sw, h: sh }, '#ffffff', { lw: 1.6, belly: 0.12, gloss: false });
    ctx.fillStyle = '#2d6cdf';
    ctx.fillRect(p.x - sw / 2 + 1.5, p.y - 1 * z, sw - 3, 2 * z);
  }

  // Glossy badge, like an app icon, with stars for its level.
  drawIndustry(ctx, n, p, z) {
    const def = NODE_TYPES[n.type];
    const r = 13 * z;
    ctx.fillStyle = 'rgba(30,20,40,0.25)';
    ctx.beginPath(); ctx.ellipse(p.x + 1.5, p.y + 3, r, r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    outlined(ctx, () => ctx.arc(p.x, p.y, r, 0, Math.PI * 2), shade(def.color, -0.25), 2.2);
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(p.x, p.y - 1.2 * z, r - 2.2 * z, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y - r * 0.5, r * 0.62, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${Math.round(14 * z)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000'; // emoji pick up the fill's transparency
    ctx.fillText(def.icon, p.x, p.y);
    const lvl = this.g.level(n.id);
    if (lvl > 1) {
      ctx.font = `900 ${Math.round(10 * z)}px ${FONT}`;
      const stars = '★'.repeat(lvl - 1);
      ctx.lineWidth = 3; ctx.strokeStyle = OL; ctx.lineJoin = 'round';
      ctx.strokeText(stars, p.x, p.y - r - 6);
      ctx.fillStyle = '#ffd84a'; ctx.fillText(stars, p.x, p.y - r - 6);
    }
  }

}
