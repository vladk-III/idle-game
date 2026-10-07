// Focus mode "ride" scene: a side view that follows one of your real trains
// through a slowly shifting day/night landscape.
import { MODELS, CARGO, NODE_TYPES } from './data.js';
import { hash, noise1, clamp, lerp } from './rng.js';
import { Route, EXT } from './route.js';
import { WORLD_W, pointAt as pointAtGeo } from './world.js';

const NODE_COLORS = Object.fromEntries(Object.entries(NODE_TYPES).map(([k, v]) => [k, v.color]));

const DAY_SECONDS = 600;

function mix(c1, c2, t) {
  const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
  const r = Math.round(lerp(a >> 16, b >> 16, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return `rgb(${r},${g},${bl})`;
}

export class Ride {
  constructor(canvas, game) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.g = game;
    this.scroll = 0;
    this.vis = 0;          // visual px/s, for smoke
    this.parts = [];
    this.rings = [];
    this.floats = [];
    this.follow = 0;
    this.tIdx = 0;
    this.prev = null;
    this.whistle = 0;
    this.clock = 0;
    this.lights = [];
    this.view = 'side';
    this.routes = new Map();
    this.terrain = null; // the map's terrain image, for the mini-map
  }

  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr; this.W = w; this.H = h;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    this.c.style.width = w + 'px'; this.c.style.height = h + 'px';
  }

  activeLines() { return this.g.state.lines.filter((l) => l.trains.length); }

  current() {
    const lines = this.activeLines();
    if (!lines.length) return null;
    const i = ((this.follow % lines.length) + lines.length) % lines.length;
    const line = lines[i];
    const tr = line.trains[((this.tIdx % line.trains.length) + line.trains.length) % line.trains.length];
    return { line, tr };
  }

  followLine(id) {
    const i = this.activeLines().findIndex((l) => l.id === id);
    if (i >= 0) { this.follow = i; this.tIdx = 0; this.prev = null; }
  }

  switch(d) {
    const cur = this.current();
    if (!cur) return null;
    // step through every train of every line
    if (cur.line.trains.length > 1 && this.tIdx + d >= 0 && this.tIdx + d < cur.line.trains.length) this.tIdx += d;
    else { this.follow += d; const nxt = this.current(); this.tIdx = d > 0 ? 0 : nxt.line.trains.length - 1; }
    this.prev = null;
    return this.current();
  }

  tap(x, y) {
    this.rings.push({ x, y, t: 0 });
    const cur = this.current();
    if (cur) cur.tr.boost = Math.min(0.6, (cur.tr.boost || 0) + 0.06);
    this.puff(10, 1.4);
    this.sloshV = (this.sloshV || 0) + (Math.random() < 0.5 ? -3 : 3);
  }

  whistleOn() { this.whistle = 1; }
  whistleOff() { this.whistle = 0; }

  puff(n, big = 1) {
    const s = this.stack;
    if (!s) return;
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: s.x + (Math.random() - 0.5) * 6, y: s.y,
        vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 50 * big,
        r: (4 + Math.random() * 5) * big, life: 0, max: 2 + Math.random() * 1.5, kind: s.kind,
      });
    }
  }

  onDeliver(e) {
    const cur = this.current();
    if (cur && e.train === cur.tr) this.floats.push({ text: '+$' + e.pay.toLocaleString(), t: 0 });
  }

  // ---------- frame ----------

  draw(dt) {
    const ctx = this.ctx, W = this.W, H = this.H;
    this.clock += dt;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const cur = this.current();
    let model = MODELS[this.g.newestModel().i], traveled = 0, remaining = 1e9, legPx = 0, k = 10;
    let fromName = '', toName = '', moving = true;
    if (cur) {
      const { line, tr } = cur;
      model = MODELS[tr.m];
      const L = this.g.geom(line).len;
      k = (80 + model.speed * 5) / model.speed;
      moving = tr.wait <= 0;
      traveled = moving ? (tr.dir > 0 ? tr.p * L : (1 - tr.p) * L) : 0;
      remaining = L - traveled;
      legPx = L * k;
      const a = this.g.node(line.a).name, b = this.g.node(line.b).name;
      fromName = tr.dir > 0 ? a : b; toName = tr.dir > 0 ? b : a;
      const same = this.prev && this.prev.tr === tr;
      const dScroll = same && moving && traveled >= this.prev.traveled ? (traveled - this.prev.traveled) * k : 0;
      this.scroll += dScroll;
      this.vis = lerp(this.vis, dt > 0 ? dScroll / dt : 0, 0.2);
      this.prev = { tr, traveled };
    } else {
      this.scroll += 110 * dt;
      this.vis = 110;
    }
    this.info = cur ? { fromName, toName, progress: moving ? traveled / (traveled + remaining) : 0, moving, model, tr: cur.tr, line: cur.line } : null;

    const phase = (this.clock / DAY_SECONDS + 0.15) % 1;
    const light = clamp(0.5 + 0.5 * Math.cos(phase * Math.PI * 2) * 1.6, 0, 1);
    const S = { cur, model, traveled, remaining, legPx, k, fromName, toName, moving, light, phase, dt };
    this.lights = [];
    let floatAt;
    if (this.view === 'passenger') floatAt = this.drawPassenger(ctx, W, H, S);
    else if (this.view === 'cab') floatAt = this.drawCab(ctx, W, H, S);
    else floatAt = this.drawSide(ctx, W, H, S);
    const frontX = floatAt.x + 60, gy = floatAt.y + 120;
    this.drawMinimap(ctx, W, H, cur);
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(0, 0, W, H);
      this.fade = Math.max(0, this.fade - dt * 1.6);
    }

    // touch ripples
    for (const r of this.rings) {
      r.t += dt;
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, 0.5 - r.t)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, 10 + r.t * 90, 0, Math.PI * 2); ctx.stroke();
    }
    this.rings = this.rings.filter((r) => r.t < 0.6);

    // income floats above the train
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      f.t += dt;
      ctx.globalAlpha = Math.max(0, 1 - f.t / 2.5);
      ctx.fillStyle = '#ffe680';
      ctx.fillText(f.text, frontX - 60, gy - 120 - f.t * 22);
    }
    ctx.globalAlpha = 1;
    this.floats = this.floats.filter((f) => f.t < 2.5);
  }

  // ---------- views ----------

  drawScenery(ctx, W, H, gy, sc, light, phase, v = null) {
    // a deep meadow so the map's scenery shows above the train
    const hz = Math.round(gy - Math.min(H * 0.17, 140));
    this.drawSky(ctx, W, H, gy, light, phase);
    this.drawClouds(ctx, W, gy, sc, light);
    this.drawBirds(ctx, W, gy);
    this.drawRidge(ctx, W, gy, sc * 0.04, 0.003, Math.min(H * 0.25, 170), gy - Math.min(H * 0.1, 70), mix('#8a97b8', '#b4c0d2', light), 11);
    this.drawRidge(ctx, W, gy, sc * 0.09, 0.0045, Math.min(H * 0.16, 110), hz + 6, mix('#6d7f98', '#93a7b8', light), 17);
    this.drawRidge(ctx, W, gy, sc * 0.18, 0.007, Math.min(H * 0.07, 45), hz + 2, mix('#5a7d5f', '#7da176', light * 0.9), 23);
    // meadow between the hills and the line; the map's scenery stands on it
    const mg = ctx.createLinearGradient(0, hz, 0, gy);
    mg.addColorStop(0, '#87a96c'); mg.addColorStop(1, '#649650');
    ctx.fillStyle = mg; ctx.fillRect(0, hz, W, gy - hz);
    if (v) this.drawBackdrop(ctx, W, gy, hz, v, light);
    else this.drawTrees(ctx, W, gy, sc * 0.4, light);
    ctx.fillStyle = '#5e8c48';
    ctx.fillRect(0, gy - 8, W, H - gy + 8);
    ctx.fillStyle = '#4f7a3c';
    ctx.fillRect(0, gy + 22, W, H - gy);
  }

  // Darken for night, then draw anything that glows.
  nightGlow(ctx, W, H, light) {
    const night = 1 - light;
    if (night <= 0.02) return;
    ctx.fillStyle = `rgba(8,12,38,${night * 0.55})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = night;
    for (const l of this.lights) {
      if (l.kind === 'win') { ctx.fillStyle = '#ffd77a'; ctx.fillRect(l.x, l.y, l.w, l.h); }
      else if (l.kind === 'lamp') {
        const r = l.r || 26;
        const gr = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
        gr.addColorStop(0, 'rgba(255,220,140,0.9)'); gr.addColorStop(1, 'rgba(255,220,140,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(l.x, l.y, r, 0, Math.PI * 2); ctx.fill();
      } else if (l.kind === 'head') {
        const gr = ctx.createLinearGradient(l.x, 0, l.x + 260, 0);
        gr.addColorStop(0, 'rgba(255,240,190,0.55)'); gr.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(l.x, l.y - 3); ctx.lineTo(l.x + 260, l.y - 40); ctx.lineTo(l.x + 260, l.y + 40); ctx.lineTo(l.x, l.y + 3); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawSide(ctx, W, H, S) {
    const { cur, model, traveled, remaining, legPx, k, fromName, toName, light, phase, dt } = S;
    const gy = Math.round(H * (H > W * 1.2 ? 0.6 : 0.7));
    const sc = this.scroll;
    this.drift = 0.85;
    const frontX = Math.round(Math.min(W - 30, W * 0.5 + 170));
    const v = this.routeView(cur, k, frontX, W);
    this.drawScenery(ctx, W, H, gy, sc, light, phase, v);
    const spans = v ? this.drawNearWater(ctx, W, H, gy, v) : [];
    // stations sit behind the train
    if (cur) {
      const depX = frontX - traveled * k;
      const arrX = frontX + remaining * k;
      if (depX > -60 && depX < W + 400) this.drawStation(ctx, depX, gy, fromName);
      if (arrX < W + 400 && legPx > 0) this.drawStation(ctx, arrX, gy, toName);
    }
    this.drawTrack(ctx, W, gy, sc, model.style);
    this.drawPoles(ctx, W, gy, sc, model.style);
    this.drawTrain(ctx, frontX, gy, model, cur ? cur.tr : null, cur ? cur.line : null, sc);
    this.updateSmoke(ctx, dt, model.style);
    this.drawForeground(ctx, W, H, gy, sc * 1.35, spans);
    this.nightGlow(ctx, W, H, light);
    return { x: frontX - 60, y: gy - 120 };
  }

  // Looking out of a carriage window, with a cup of tea on the table.
  drawPassenger(ctx, W, H, S) {
    const { cur, model, traveled, remaining, legPx, k, fromName, toName, light, phase, dt } = S;
    const style = model.style;
    const portrait = H > W * 1.2;
    const moving = this.vis > 5;
    const sway = moving ? Math.sin(this.clock * 2.1) * 1.6 + Math.sin(this.clock * 5.3) * 0.5 : 0;
    const wins = [];
    if (portrait) wins.push({ x: 22, y: H * 0.16, w: W - 44, h: H * 0.38 });
    else {
      const ww = (W - 100) / 2;
      wins.push({ x: 35, y: H * 0.13, w: ww, h: H * 0.5 }, { x: 65 + ww, y: H * 0.13, w: ww, h: H * 0.5 });
    }
    const top = Math.min(...wins.map((w) => w.y)), bot = Math.max(...wins.map((w) => w.y + w.h));
    const gy = Math.round(bot - (bot - top) * 0.16);
    const sc = this.scroll;
    const theme = style === 'steam' || style === 'stream'
      ? { wall: '#6b4630', panel: '#5a3a27', trim: '#c9a24a', seat: '#2f5d4a', seatHi: '#3f7a60', table: '#4a2f1f', curtain: '#7a2430' }
      : style === 'diesel' || style === 'electric'
        ? { wall: '#bdb6a6', panel: '#aaa392', trim: '#8a8476', seat: '#2f4f7f', seatHi: '#3e66a3', table: '#7a6e5c', curtain: '#a08a5a' }
        : { wall: '#e3e6ea', panel: '#d3d7dc', trim: '#9aa3ad', seat: '#3a3f4a', seatHi: cur ? cur.line.color : '#e4572e', table: '#c7ccd2', curtain: null };
    const windowPath = () => { ctx.beginPath(); for (const w of wins) ctx.roundRect(w.x, w.y + sway, w.w, w.h, 18); };

    // the world outside
    ctx.save();
    windowPath();
    ctx.clip();
    const outH = gy + (bot - top) * 0.6;
    const frontX = W / 2 + 230; // our seat is a few carriages behind the loco
    this.drawScenery(ctx, W, outH, gy, sc, light, phase, this.routeView(cur, k, frontX, W));
    ctx.fillStyle = '#4f7a3c'; ctx.fillRect(0, gy + 22, W, H);
    if (cur) {
      const depX = frontX - traveled * k;
      const arrX = frontX + remaining * k;
      if (depX > -60 && depX < W + 400) this.drawStation(ctx, depX, gy, fromName);
      if (arrX < W + 400 && legPx > 0) this.drawStation(ctx, arrX, gy, toName);
    }
    this.drawPoles(ctx, W, gy, sc, style);
    // smoke from the engine drifts past the window
    this.stack = null;
    this.drift = 0.85;
    if ((style === 'steam' || style === 'stream') && moving) {
      this.wispAcc = (this.wispAcc || 0) + dt * (1.5 + this.vis * 0.02);
      while (this.wispAcc > 1) {
        this.wispAcc--;
        this.parts.push({ x: W + 40, y: top + Math.random() * (bot - top) * 0.35, vx: 0, vy: -6, r: 18 + Math.random() * 20, life: 0, max: 4, kind: 'steam' });
      }
    }
    this.updateSmoke(ctx, dt, style);
    this.nightGlow(ctx, W, H, light);
    // glass reflection
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (const w of wins) {
      ctx.beginPath();
      ctx.moveTo(w.x + w.w * 0.15, w.y + sway); ctx.lineTo(w.x + w.w * 0.35, w.y + sway);
      ctx.lineTo(w.x + w.w * 0.1, w.y + w.h + sway); ctx.lineTo(w.x - w.w * 0.1, w.y + w.h + sway);
      ctx.fill();
    }
    ctx.restore();

    // the carriage interior sways gently
    ctx.save();
    ctx.translate(0, sway);
    ctx.fillStyle = theme.wall;
    ctx.beginPath();
    ctx.rect(-10, -20, W + 20, H + 40);
    for (const w of wins) ctx.roundRect(w.x, w.y, w.w, w.h, 18);
    ctx.fill('evenodd');
    // panelling below the windows
    ctx.fillStyle = theme.panel;
    ctx.fillRect(0, bot + 12, W, H - bot);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 2;
    for (let x = 20; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, bot + 12); ctx.lineTo(x, H); ctx.stroke(); }
    // window frames
    ctx.strokeStyle = theme.trim; ctx.lineWidth = 7;
    for (const w of wins) { ctx.beginPath(); ctx.roundRect(w.x, w.y, w.w, w.h, 18); ctx.stroke(); }
    // curtains
    if (theme.curtain) {
      for (const w of wins) {
        for (const side of [0, 1]) {
          const cx = side ? w.x + w.w + 4 : w.x - 4, dir = side ? -1 : 1;
          ctx.fillStyle = theme.curtain;
          ctx.beginPath();
          ctx.moveTo(cx, w.y - 10);
          ctx.lineTo(cx + dir * 34, w.y - 10);
          ctx.quadraticCurveTo(cx + dir * 10, w.y + w.h * 0.45, cx + dir * 26, w.y + w.h * 0.9);
          ctx.lineTo(cx, w.y + w.h * 0.9);
          ctx.fill();
        }
      }
    }
    // luggage rack with a suitcase
    const rackY = top - 34;
    if (rackY > 70) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(10, rackY + 10, W - 20, 4);
      ctx.fillStyle = '#7a5a3a'; ctx.fillRect(W * 0.62, rackY - 16, 60, 26);
      ctx.fillStyle = '#5a3f28'; ctx.fillRect(W * 0.62 + 22, rackY - 22, 16, 6);
      ctx.strokeStyle = theme.trim; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(10, rackY + 10); ctx.lineTo(W - 10, rackY + 10); ctx.stroke();
    }
    // table and tea
    const tableY = bot + 18;
    ctx.fillStyle = theme.table;
    ctx.beginPath(); ctx.roundRect(W * 0.16, tableY, W * 0.68, 16, 6); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(W * 0.47, tableY + 16, W * 0.06, 70);
    this.drawCup(ctx, W * 0.66, tableY, dt, moving);
    // a folded newspaper
    ctx.save(); ctx.translate(W * 0.32, tableY + 2); ctx.rotate(-0.08);
    ctx.fillStyle = '#ece6d6'; ctx.fillRect(-36, -8, 72, 9);
    ctx.fillStyle = '#9a9488'; ctx.fillRect(-30, -6, 40, 2); ctx.fillRect(-30, -3, 52, 1.5);
    ctx.restore();
    // seat backs in the foreground
    const seatTop = Math.max(tableY + 60, H * (portrait ? 0.74 : 0.8));
    for (const [x0, x1] of [[-20, W * 0.46], [W * 0.54, W + 20]]) {
      ctx.fillStyle = theme.seat;
      ctx.beginPath(); ctx.roundRect(x0, seatTop, x1 - x0, H - seatTop + 30, 28); ctx.fill();
      ctx.fillStyle = theme.seatHi;
      ctx.fillRect(x0, seatTop + 22, x1 - x0, 6);
      if (theme.curtain) { // lace head cloth
        ctx.fillStyle = 'rgba(245,240,225,0.9)';
        ctx.beginPath(); ctx.roundRect((x0 + x1) / 2 - 40, seatTop - 2, 80, 26, 6); ctx.fill();
      }
    }
    // ceiling lamp
    const night = 1 - light;
    if (night > 0.02) {
      ctx.fillStyle = `rgba(20,10,0,${night * 0.25})`;
      ctx.beginPath(); ctx.rect(-10, -20, W + 20, H + 40);
      for (const w of wins) ctx.roundRect(w.x, w.y, w.w, w.h, 18);
      ctx.fill('evenodd');
      const lx = W / 2, ly = Math.max(70, top - 60);
      const gr = ctx.createRadialGradient(lx, ly, 0, lx, ly, 260);
      gr.addColorStop(0, `rgba(255,200,120,${0.35 * night})`); gr.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.rect(-10, -20, W + 20, H + 40);
      for (const w of wins) ctx.roundRect(w.x, w.y, w.w, w.h, 18);
      ctx.fill('evenodd');
    }
    ctx.restore();
    return { x: W / 2, y: top + 50 };
  }

  drawCup(ctx, x, y, dt, moving) {
    // springy slosh driven by the carriage motion (tap to nudge it)
    this.slosh = this.slosh || 0; this.sloshV = this.sloshV || 0;
    const jiggle = moving ? (Math.random() - 0.5) * 10 + Math.sin(this.clock * 2.1) * 2 : 0;
    this.sloshV += (-45 * this.slosh - 2.2 * this.sloshV + jiggle) * dt;
    this.slosh += this.sloshV * dt;
    const tilt = clamp(this.slosh, -0.6, 0.6);
    ctx.fillStyle = '#f2efe8';
    ctx.beginPath(); ctx.ellipse(x, y, 26, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 15, y - 28); ctx.lineTo(x + 15, y - 28); ctx.lineTo(x + 12, y - 2); ctx.lineTo(x - 12, y - 2); ctx.fill();
    ctx.strokeStyle = '#f2efe8'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x + 17, y - 17, 7, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.fillStyle = '#7a4a26';
    ctx.beginPath();
    ctx.moveTo(x - 13, y - 24 - tilt * 7); ctx.lineTo(x + 13, y - 24 + tilt * 7); ctx.lineTo(x + 13, y - 22); ctx.lineTo(x - 13, y - 22);
    ctx.fill();
    // steam curls
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      for (let j = 0; j <= 10; j++) {
        const yy = y - 32 - j * 3.5, xx = x - 5 + i * 10 + Math.sin(this.clock * 2 + j * 0.6 + i * 2) * 4;
        j ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.stroke();
    }
  }

  // ---------- the real map, seen from the train ----------

  route(line) {
    const key = `${this.g.state.seed}:${line.id}:${line.a}:${line.b}`;
    let r = this.routes.get(key);
    if (!r) {
      r = new Route(this.g, line);
      this.routes.set(key, r);
    }
    return r;
  }

  houseCount(id) { return Math.min(40, 10 + Math.floor(this.g.pop(id) / 35)); }

  // Where the followed train is along its route, for the side-on views.
  routeView(cur, k, frontX, W) {
    if (!cur) return null;
    const route = this.route(cur.line);
    const d = cur.tr.p * route.L, dir = cur.tr.dir;
    return { route, k, frontX, d, dir, c: d + (dir * (W / 2 - frontX)) / k };
  }

  // Map scenery on the far side of the line, with parallax by distance.
  drawBackdrop(ctx, W, gy, hz, v, light) {
    const { route, k, dir, c } = v;
    const D0 = 30;
    const place = (s, lat) => {
      const a = -lat * dir; // how far beyond the track
      if (a <= 4) return null;
      const p = D0 / (D0 + a);
      const x = W / 2 + (s - c) * dir * k * p;
      if (x < -160 || x > W + 160) return null;
      return { a, p, x, y: hz + (gy - 4 - hz) * p };
    };
    const water = [];
    for (const w of route.water) { const q = place(w.s, w.lat); if (q) water.push(q); }
    water.sort((a, b) => b.a - a.a);
    for (const q of water) {
      const p2 = D0 / (D0 + q.a + 8);
      const ry = Math.max(1.2, (gy - 4 - hz) * (q.p - p2) * 0.75);
      ctx.fillStyle = '#4f8fbf';
      ctx.beginPath(); ctx.ellipse(q.x, q.y, Math.max(3, 5 * k * q.p * 0.85), ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    const items = [];
    for (const t of route.trees) { const q = place(t.s, t.lat); if (q) items.push({ ...q, kind: 'tree', t }); }
    for (const e of route.nodes) {
      if (e.houses) {
        const count = this.houseCount(e.n.id);
        for (const h of e.houses) if (h.i < count) { const q = place(h.s, h.lat); if (q) items.push({ ...q, kind: 'house', h }); }
      } else {
        const q = place(e.s, e.lat);
        if (q) items.push({ ...q, kind: 'ind', type: e.n.type });
      }
    }
    items.sort((a, b) => b.a - a.a);
    for (const it of items) {
      if (it.kind === 'tree') this.drawTreeAt(ctx, it.x, it.y, (26 + it.t.size * 8) * it.p * 1.1, it.t.c, light);
      else if (it.kind === 'house') this.drawHouse(ctx, it.x, it.y, (10 + it.h.size * 2.4) * it.p * 1.5, it.h.c);
      else this.drawIndustry(ctx, it.type, it.x, it.y, it.p * 1.25);
    }
  }

  // Water on the near side of the line, and bridges where the line crosses it.
  drawNearWater(ctx, W, H, gy, v) {
    const { route, k, frontX, d, dir, c } = v;
    ctx.fillStyle = '#4f8fbf';
    for (const w of route.water) {
      const a = w.lat * dir;
      if (a <= 4 || a > 44) continue;
      const p = 1 + a / 16;
      const x = W / 2 + (w.s - c) * dir * k * p;
      if (x < -200 || x > W + 200) continue;
      ctx.beginPath(); ctx.ellipse(x, gy + 18 + (a - 4) * 2.4, 5 * k * p * 0.9, 9, 0, 0, Math.PI * 2); ctx.fill();
    }
    const spans = [];
    for (const b of route.bridges) {
      let x0 = frontX + (b.s0 - d) * dir * k, x1 = frontX + (b.s1 - d) * dir * k;
      if (x0 > x1) [x0, x1] = [x1, x0];
      if (x1 < -60 || x0 > W + 60) continue;
      spans.push([x0, x1]);
      ctx.fillStyle = '#4f8fbf'; ctx.fillRect(x0, gy + 10, x1 - x0, H - gy);
      ctx.fillStyle = '#3f7aa8'; ctx.fillRect(x0, gy + 40, x1 - x0, H - gy);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const yy = gy + 30 + i * 22, off = (this.clock * 12 + i * 37) % 60;
        ctx.beginPath();
        for (let xx = x0 + off - 60; xx < x1; xx += 60) { ctx.moveTo(Math.max(x0, xx), yy); ctx.lineTo(Math.min(x1, xx + 22), yy); }
        ctx.stroke();
      }
      // piers and a steel girder
      ctx.fillStyle = '#8d8478';
      for (let px = x0 + 40; px < x1 - 20; px += 110) ctx.fillRect(px, gy + 14, 18, 60);
      ctx.fillStyle = '#4d535b'; ctx.fillRect(x0 - 14, gy + 2, x1 - x0 + 28, 14);
      ctx.strokeStyle = '#2f343a'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let xx = x0 - 14; xx < x1 + 14; xx += 20) { ctx.moveTo(xx, gy + 16); ctx.lineTo(xx + 10, gy + 2); ctx.lineTo(xx + 20, gy + 16); }
      ctx.stroke();
    }
    return spans;
  }

  drawTreeAt(ctx, x, y, h, kind, light) {
    if (kind === 0) {
      ctx.fillStyle = mix('#1f3a26', '#2f5d34', light);
      ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x - h * 0.3, y); ctx.lineTo(x + h * 0.3, y); ctx.fill();
    } else {
      ctx.fillStyle = '#4a3527'; ctx.fillRect(x - h * 0.04, y - h * 0.4, h * 0.08, h * 0.4);
      ctx.fillStyle = kind === 1 ? mix('#284a2e', '#3f7a42', light) : mix('#2f4f2a', '#4c8a45', light);
      ctx.beginPath(); ctx.arc(x, y - h * 0.58, h * 0.32, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawHouse(ctx, x, y, w, c) {
    const roofs = ['#c8553d', '#8d6e63', '#b0743c', '#6d7f8c'];
    const walls = ['#efe4cf', '#e2d3b5', '#d8c9b0', '#f1ece2'];
    const h = w * 0.62;
    ctx.fillStyle = walls[c]; ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = roofs[c];
    ctx.beginPath(); ctx.moveTo(x - w * 0.6, y - h); ctx.lineTo(x, y - h - w * 0.42); ctx.lineTo(x + w * 0.6, y - h); ctx.fill();
    if (w > 9) {
      const ww = w * 0.2;
      ctx.fillStyle = '#2f3a4a'; ctx.fillRect(x - w * 0.32, y - h * 0.75, ww, ww);
      this.lights.push({ kind: 'win', x: x - w * 0.32, y: y - h * 0.75, w: ww, h: ww });
      ctx.fillStyle = '#5a3b2e'; ctx.fillRect(x + w * 0.1, y - h * 0.6, w * 0.18, h * 0.6);
    }
  }

  // Industry buildings, drawn on the ground at (x, y); u = pixels per unit.
  drawIndustry(ctx, type, x, y, u) {
    const R = (dx, dy, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x + dx * u, y - (dy + h) * u, w * u, h * u); };
    const tri = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * u, y - py * u) : ctx.moveTo(x + px * u, y - py * u))); ctx.fill(); };
    const puff = (px, py) => {
      ctx.fillStyle = 'rgba(235,235,235,0.7)';
      for (let i = 0; i < 3; i++) {
        const t = (this.clock * 0.4 + i / 3) % 1;
        ctx.beginPath(); ctx.arc(x + (px + t * 10) * u, y - (py + t * 18) * u, (2 + t * 5) * u, 0, Math.PI * 2); ctx.fill();
      }
    };
    if (type === 'farm') {
      ctx.fillStyle = '#d8c26a'; ctx.beginPath(); ctx.ellipse(x, y, 62 * u, 5 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c4ab4f'; ctx.beginPath(); ctx.ellipse(x + 20 * u, y + 1 * u, 30 * u, 3 * u, 0, 0, Math.PI * 2); ctx.fill();
      R(-22, 0, 26, 16, '#a8442f');
      tri([[-24, 16], [6, 16], [-9, 26]], '#5a2b20');
      R(-13, 0, 8, 10, '#5a2b20');
      R(8, 0, 9, 30, '#b9bec4');
      ctx.fillStyle = '#8f959c'; ctx.beginPath(); ctx.arc(x + 12.5 * u, y - 30 * u, 4.5 * u, Math.PI, 0); ctx.fill();
    } else if (type === 'foodplant' || type === 'sawmill') {
      const food = type === 'foodplant';
      R(-26, 0, 50, 20, food ? '#c9b49a' : '#8b5a2b');
      for (let i = 0; i < 4; i++) tri([[-26 + i * 12.5, 20], [-26 + i * 12.5, 28], [-13.5 + i * 12.5, 20]], '#6d6d6d');
      R(14, 0, 6, 40, '#7a5a48');
      puff(17, 40);
      for (let i = 0; i < 4; i++) {
        R(-22 + i * 11, 6, 6, 6, '#2f3a4a');
        this.lights.push({ kind: 'win', x: x + (-22 + i * 11) * u, y: y - 12 * u, w: 6 * u, h: 6 * u });
      }
      if (food) { R(26, 0, 8, 18, '#d9d4c8'); R(36, 0, 8, 14, '#d9d4c8'); }
      else for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#9b6a3c' : '#7d5230'; ctx.beginPath(); ctx.arc(x + (30 + (i % 3) * 5) * u, y - (3 + Math.floor(i / 3) * 5) * u, 3 * u, 0, Math.PI * 2); ctx.fill(); }
    } else if (type === 'forest') {
      for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#9b6a3c' : '#7d5230'; ctx.beginPath(); ctx.arc(x + (-6 + (i % 3) * 6) * u, y - (3 + Math.floor(i / 3) * 5) * u, 3.2 * u, 0, Math.PI * 2); ctx.fill(); }
      R(10, 0, 14, 10, '#6b4a2f');
      tri([[8, 10], [26, 10], [17, 16]], '#3d2a1c');
      for (const [px, h] of [[-26, 40], [-16, 32], [32, 36]]) tri([[px - h * 0.3, 0], [px + h * 0.3, 0], [px, h]], '#24472c');
    } else if (type === 'mine') {
      R(-26, 0, 16, 12, '#6b6b6b');
      ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(1, 2 * u);
      ctx.beginPath(); ctx.moveTo(x - 8 * u, y); ctx.lineTo(x, y - 34 * u); ctx.lineTo(x + 8 * u, y); ctx.moveTo(x - 4 * u, y - 17 * u); ctx.lineTo(x + 4 * u, y - 17 * u); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - 34 * u, 5 * u, 0, Math.PI * 2); ctx.stroke();
      tri([[10, 0], [36, 0], [24, 14]], '#2d2d2d');
    } else if (type === 'power') {
      for (const cx of [-18, 4]) {
        ctx.fillStyle = '#b9bec4';
        ctx.beginPath();
        ctx.moveTo(x + (cx - 9) * u, y); ctx.quadraticCurveTo(x + (cx - 3) * u, y - 18 * u, x + (cx - 6) * u, y - 30 * u);
        ctx.lineTo(x + (cx + 6) * u, y - 30 * u); ctx.quadraticCurveTo(x + (cx + 3) * u, y - 18 * u, x + (cx + 9) * u, y);
        ctx.fill();
        puff(cx - 4, 30);
      }
      R(20, 0, 4, 46, '#d9dde2'); R(20, 38, 4, 3, '#c0392b'); R(20, 30, 4, 3, '#c0392b');
      R(-30, 0, 12, 10, '#8f959c');
    }
  }

  // Driver's view: the real track ahead, projected in perspective from the map.
  drawCab(ctx, W, H, S) {
    const { cur, model, k, light, phase, dt } = S;
    const style = model.style;
    const steam = style === 'steam' || style === 'stream';
    const portrait = H > W * 1.2;
    const hy = Math.round(H * (portrait ? 0.4 : 0.42));
    const dashTop = Math.round(H * (portrait ? 0.64 : 0.7));
    const moving = this.vis > 5;
    const roll = moving ? Math.sin(this.clock * 1.7) * 0.006 : 0;
    const shake = moving ? Math.sin(this.clock * 13) * 0.7 : 0;
    // focal length: a natural field of view, with the near track just meeting the dashboard
    const F = Math.min(2 * (H - hy), W * 1.15);
    const ZMAX = 2200, NEAR = 24;

    const route = cur ? this.route(cur.line) : null;
    const tr = cur ? cur.tr : null;
    const L = route ? route.L : 0;
    const d = route ? tr.p * L : this.scroll / k;
    const dir = route ? tr.dir : 1;
    const posAt = route ? (s) => route.posAt(s) : (s) => ({ x: s, y: 0, a: 0 });
    const here = posAt(d);
    const fx = Math.cos(here.a) * dir, fy = Math.sin(here.a) * dir;
    const rx = -fy, ry = fx;
    // map -> driver's frame (z ahead, lat to the right), in view units
    const loc = (x, y) => {
      const dx = x - here.x, dy = y - here.y;
      return { z: (dx * fx + dy * fy) * k, lat: (dx * rx + dy * ry) * k };
    };
    const P = (lat, z, up = 0) => {
      const s = F / Math.max(z, 1);
      return { x: W / 2 + lat * s, y: hy + (20 - up) * s, s };
    };
    const fog = (z) => clamp(1.25 - z / ZMAX, 0, 1);
    if (tr && this.lastTr === tr && this.lastDir !== dir) this.fade = 1; // changing ends at a terminus
    this.lastTr = tr; this.lastDir = dir;

    // the line stops at a buffer just past each terminus
    const endS = route ? (dir > 0 ? L : 0) + (dir * 140) / k : Infinity;
    const maxAhead = Math.min(ZMAX / k, route ? (endS - d) * dir : Infinity);

    ctx.save();
    ctx.translate(W / 2, hy); ctx.rotate(roll); ctx.translate(-W / 2, -hy + shake);
    this.drawSky(ctx, W, H, hy, light, phase);
    this.drawClouds(ctx, W, hy, 0, light);
    this.drawBirds(ctx, W, hy);
    // distant hills turn with the train's heading
    const hd = Math.atan2(fy, fx) * 700;
    this.drawRidge(ctx, W, hy + 2, hd, 0.003, Math.min(H * 0.18, 130), hy - 6, mix('#8a97b8', '#b4c0d2', light), 11);
    this.drawRidge(ctx, W, hy + 2, hd * 1.6, 0.006, Math.min(H * 0.06, 40), hy, mix('#5d7a64', '#86a67c', light), 23);
    const gg = ctx.createLinearGradient(0, hy, 0, H);
    gg.addColorStop(0, '#86a56c'); gg.addColorStop(0.25, '#5e8c48'); gg.addColorStop(1, '#4a7638');
    ctx.fillStyle = gg; ctx.fillRect(-20, hy, W + 40, H - hy + 20);

    const poly = (pts, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.fill();
    };
    const ground = (q, lat = 0, up = 0) => P(q.lat + lat, Math.max(q.z, NEAR), up);

    // lakes and the river, from the map
    if (route) {
      const world = this.g.world;
      const view = (q, r) => q.z + r > NEAR && q.z - r < ZMAX * 1.2 && Math.abs(q.lat) - r < (Math.max(q.z, NEAR) + r) * (W / F) + 200;
      for (const blobs of world.lakes) {
        for (const b of blobs) {
          const q = loc(b.x, b.y), r = b.r * k;
          if (!view(q, r)) continue;
          const pts = [];
          for (let i = 0; i < 24; i++) {
            const t = (i / 24) * Math.PI * 2;
            pts.push(P(q.lat + Math.cos(t) * r, Math.max(NEAR, q.z + Math.sin(t) * r)));
          }
          ctx.globalAlpha = fog(q.z);
          poly(pts, '#4f8fbf');
        }
      }
      const rv = world.river;
      for (let i = 0; i < rv.length - 1; i++) {
        const a = rv[i], b = rv[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len * 5.5, ny = (b.x - a.x) / len * 5.5;
        const qs = [loc(a.x + nx, a.y + ny), loc(b.x + nx, b.y + ny), loc(b.x - nx, b.y - ny), loc(a.x - nx, a.y - ny)];
        if (qs.every((q) => q.z < NEAR) || qs.every((q) => q.z > ZMAX * 1.2)) continue;
        ctx.globalAlpha = fog(Math.max(NEAR, Math.min(...qs.map((q) => q.z))));
        poly(qs.map((q) => ground(q)), '#4f8fbf');
      }
      ctx.globalAlpha = 1;
    }

    // the track itself
    const cl = [];
    for (let u = NEAR / k; u < maxAhead; u += Math.max(0.5, u * 0.06)) {
      const p = posAt(d + dir * u), q = loc(p.x, p.y);
      if (q.z > NEAR) cl.push({ ...q, s: d + dir * u });
    }
    if (cl.length > 1) {
      const strip = (l0, l1, color) => {
        const pts = cl.map((q) => P(q.lat + l0, q.z));
        for (let i = cl.length - 1; i >= 0; i--) pts.push(P(cl[i].lat + l1, cl[i].z));
        poly(pts, color);
      };
      if (style === 'maglev') {
        strip(-9, 9, '#b9bec4');
        ctx.strokeStyle = '#7a8087'; ctx.lineWidth = 2;
        for (const off of [-6, 6]) { ctx.beginPath(); cl.forEach((q, i) => { const p = P(q.lat + off, q.z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
      } else {
        strip(-17, 17, '#8a7f72');
        const ts = 22 / k;
        const sA = d + (dir * NEAR) / k, sB = d + dir * maxAhead;
        const ties = [];
        for (let i = Math.ceil(Math.min(sA, sB) / ts); i * ts <= Math.max(sA, sB); i++) ties.push(i * ts);
        if (dir > 0) ties.reverse();
        ctx.strokeStyle = '#5b4636';
        for (const ts0 of ties) {
          const p = posAt(ts0), q = loc(p.x, p.y);
          if (q.z <= NEAR) continue;
          const a = P(q.lat - 13, q.z), b = P(q.lat + 13, q.z);
          ctx.globalAlpha = fog(q.z);
          ctx.lineWidth = Math.max(0.6, a.s * 1.6);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#d4d7dc';
        for (const off of [-10, 10]) {
          for (let i = cl.length - 1; i > 0; i--) {
            const a = P(cl[i].lat + off, cl[i].z), b = P(cl[i - 1].lat + off, cl[i - 1].z);
            ctx.lineWidth = Math.max(0.6, b.s * 0.45);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      // bridge parapets where the line crosses water
      if (route) {
        for (const br of route.bridges) {
          const part = cl.filter((q) => q.s > br.s0 && q.s < br.s1);
          if (part.length < 2) continue;
          for (const side of [-1, 1]) {
            // low girder edge, then a railing with posts
            const kerb = part.map((q) => P(q.lat + side * 18, q.z, 1.5));
            poly([...kerb, ...part.map((q) => P(q.lat + side * 18, q.z, -2)).reverse()], '#4d535b');
            ctx.strokeStyle = '#3a3f45';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); part.forEach((q, i) => { const p = P(q.lat + side * 18, q.z, 7); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
            for (const q of part) {
              const a = P(q.lat + side * 18, q.z, 1.5), b = P(q.lat + side * 18, q.z, 7);
              ctx.lineWidth = Math.max(0.8, a.s * 0.35);
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
          }
        }
      }
    }

    // station platforms at both termini
    const termini = route ? [
      { e: L, toward: 1, name: this.g.node(cur.line.b).name },
      { e: 0, toward: -1, name: this.g.node(cur.line.a).name },
    ] : [];
    const items = [];
    for (const st of termini) {
      const sgn = dir * st.toward; // platform is on the right when arriving
      const s0 = st.e - (st.toward * 320) / k, s1 = st.e + (st.toward * 120) / k;
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const p = posAt(s0 + ((s1 - s0) * i) / 16), q = loc(p.x, p.y);
        if (q.z > NEAR && q.z < ZMAX * 1.1) pts.push(q);
      }
      if (pts.length >= 2) {
        const inner = pts.map((q) => P(q.lat + sgn * 17, q.z, 5)), outer = pts.map((q) => P(q.lat + sgn * 42, q.z, 5)).reverse();
        ctx.globalAlpha = fog(pts[0].z);
        poly([...inner, ...outer], '#b3a898');
        poly([...pts.map((q) => P(q.lat + sgn * 17, q.z, 0)), ...inner.slice().reverse()], '#8a8072');
        ctx.strokeStyle = '#e2dccb'; ctx.lineWidth = 1.5;
        ctx.beginPath(); inner.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const at = (s, lat, up = 0) => { const p = posAt(s), q = loc(p.x, p.y); return { q, z: q.z, lat: q.lat + lat, up }; };
      items.push({ ...at(st.e - (st.toward * 210) / k, sgn * 52), kind: 'building', sgn, st });
      for (const s of [st.e + (st.toward * 100) / k, st.e - (st.toward * 300) / k]) items.push({ ...at(s, sgn * 26), kind: 'board', name: st.name });
      for (let j = 0; j < 4; j++) items.push({ ...at(s0 + ((s1 - s0) * (j + 0.5)) / 4, sgn * 38), kind: 'lamp' });
      items.push({ ...at(st.e + (st.toward * 140) / k, 0), kind: 'buffer' });
    }
    // trees, towns and industries from the map
    if (route) {
      for (const t of route.trees) { const q = loc(t.x, t.y); items.push({ z: q.z, lat: q.lat, kind: 'tree', t }); }
      for (const e of route.nodes) {
        if (e.houses) {
          const count = this.houseCount(e.n.id);
          for (const h of e.houses) if (h.i < count) { const q = loc(h.x, h.y); items.push({ z: q.z, lat: q.lat, kind: 'house', h }); }
        } else if (Math.abs(e.lat) > 14) {
          const q = loc(e.n.x, e.n.y);
          items.push({ z: q.z, lat: q.lat, kind: 'ind', type: e.n.type });
        }
      }
    }
    // line-side poles (and overhead wires on electric lines)
    const electric = style === 'electric' || style === 'hs';
    const psp = 260 / k;
    {
      const sA = d + (dir * NEAR) / k, sB = d + dir * maxAhead;
      for (let i = Math.ceil(Math.min(sA, sB) / psp); i * psp <= Math.max(sA, sB); i++) {
        const p = posAt(i * psp), q = loc(p.x, p.y);
        const sn = (i + dir) * psp;
        const pn = posAt(sn), qn = loc(pn.x, pn.y);
        const hasNext = route ? sn >= -EXT + 1 && sn <= L + EXT - 1 && (sn - endS) * dir < 0 : true;
        items.push({ z: q.z, lat: q.lat + dir * 26, kind: 'pole', q, qn: hasNext ? qn : { z: -1 }, side: dir });
      }
    }
    items.sort((a, b) => b.z - a.z);
    const offscreen = (it, pad) => {
      const p = P(it.lat, it.z);
      return p.x < -pad * p.s - 40 || p.x > W + pad * p.s + 40;
    };
    for (const it of items) {
      if (it.z <= NEAR || it.z > ZMAX * 1.15) continue;
      ctx.globalAlpha = fog(it.z);
      if (it.kind === 'tree') {
        if (offscreen(it, 120)) continue;
        const b = P(it.lat, it.z);
        this.drawTreeAt(ctx, b.x, b.y, (4 + it.t.size * 1.6) * k * b.s, it.t.c, light);
      } else if (it.kind === 'house') {
        if (offscreen(it, 80)) continue;
        const b = P(it.lat, it.z);
        this.drawHouse(ctx, b.x, b.y, (2.5 + it.h.size * 0.6) * k * b.s, it.h.c);
      } else if (it.kind === 'ind') {
        if (offscreen(it, 600)) continue;
        const b = P(it.lat, it.z);
        this.drawIndustry(ctx, it.type, b.x, b.y, 0.5 * k * b.s);
      } else if (it.kind === 'pole') {
        if (offscreen(it, 60)) continue;
        const b = P(it.lat, it.z), t = P(it.lat, it.z, electric ? 52 : 44);
        ctx.strokeStyle = '#3b3029'; ctx.lineWidth = Math.max(1, b.s * 0.7);
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        if (it.qn.z > NEAR) {
          if (electric) {
            const arm = P(it.q.lat - it.side * 2, it.z, 48);
            ctx.lineWidth = Math.max(1, b.s * 0.4);
            ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(arm.x, arm.y); ctx.stroke();
            const w1 = P(it.q.lat, it.z, 46), w2 = P(it.qn.lat, it.qn.z, 46);
            ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(w1.x, w1.y); ctx.lineTo(w2.x, w2.y); ctx.stroke();
          } else {
            const nl = it.qn.lat + it.side * 26;
            const w1 = P(it.lat, it.z, 42), w2 = P(nl, it.qn.z, 42), m = P((it.lat + nl) / 2, (it.z + it.qn.z) / 2, 36);
            ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(w1.x, w1.y); ctx.quadraticCurveTo(m.x, m.y, w2.x, w2.y); ctx.stroke();
          }
        }
      } else if (it.kind === 'building') {
        const b = P(it.lat, it.z), s = b.s;
        const w = 80 * s, h = 26 * s;
        ctx.fillStyle = '#a65d43'; ctx.fillRect(b.x - w / 2, b.y - h - 5 * s, w, h);
        ctx.fillStyle = '#5a3b2e';
        ctx.beginPath(); ctx.moveTo(b.x - w * 0.56, b.y - h - 5 * s); ctx.lineTo(b.x, b.y - h - 22 * s); ctx.lineTo(b.x + w * 0.56, b.y - h - 5 * s); ctx.fill();
        for (const wx of [-0.35, 0.2]) {
          ctx.fillStyle = '#2f3a4a'; ctx.fillRect(b.x + wx * w, b.y - h * 0.8, w * 0.14, h * 0.4);
          this.lights.push({ kind: 'win', x: b.x + wx * w, y: b.y - h * 0.8, w: w * 0.14, h: h * 0.4 });
        }
        ctx.fillStyle = '#3d2a20'; ctx.fillRect(b.x - w * 0.06, b.y - h * 0.6 - 5 * s, w * 0.12, h * 0.6);
      } else if (it.kind === 'board') {
        const nb = P(it.lat, it.z, 20), fs = nb.s * 4;
        if (fs < 5) continue;
        const b = P(it.lat, it.z, 5);
        ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(1, nb.s * 0.3);
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(nb.x, nb.y); ctx.stroke();
        ctx.font = `700 ${Math.min(28, fs)}px system-ui, sans-serif`;
        const tw = ctx.measureText(it.name).width + fs;
        ctx.fillStyle = '#1f3b63'; ctx.fillRect(nb.x - tw / 2, nb.y - fs * 0.8, tw, fs * 1.4);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(it.name, nb.x, nb.y - fs * 0.1);
      } else if (it.kind === 'lamp') {
        const b = P(it.lat, it.z, 5), t = P(it.lat, it.z, 26);
        ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(1, b.s * 0.3);
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        this.lights.push({ kind: 'lamp', x: t.x, y: t.y, r: Math.max(6, t.s * 6) });
      } else if (it.kind === 'buffer') {
        const l = P(it.lat - 13, it.z, 4), r = P(it.lat + 13, it.z, 10);
        ctx.fillStyle = '#c0392b'; ctx.fillRect(l.x, r.y, r.x - l.x, l.y - r.y);
        ctx.fillStyle = '#f2f2f2';
        const n = 5, bw = (r.x - l.x) / n;
        for (let i = 0; i < n; i += 2) ctx.fillRect(l.x + i * bw, r.y, bw, l.y - r.y);
        const lamp = P(it.lat, it.z, 14);
        ctx.fillStyle = '#ff4d3d'; ctx.beginPath(); ctx.arc(lamp.x, lamp.y, Math.max(1.5, lamp.s * 1.5), 0, Math.PI * 2); ctx.fill();
        this.lights.push({ kind: 'lamp', x: lamp.x, y: lamp.y, r: Math.max(6, lamp.s * 5) });
      }
    }
    ctx.globalAlpha = 1;

    // engine body ahead of the cab window
    this.stack = null;
    this.drift = 0;
    if (steam) {
      const bw = W * 0.34, tw = W * 0.2, by = hy + (dashTop - hy) * 0.5;
      ctx.fillStyle = style === 'stream' && cur ? cur.line.color : '#26262a';
      ctx.beginPath();
      ctx.moveTo(W / 2 - bw / 2, dashTop + 10); ctx.lineTo(W / 2 - tw / 2, by + 12);
      ctx.quadraticCurveTo(W / 2, by - 8, W / 2 + tw / 2, by + 12); ctx.lineTo(W / 2 + bw / 2, dashTop + 10);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.fillRect(W / 2 - 7, by - 20, 14, 18); ctx.fillRect(W / 2 - 10, by - 23, 20, 5);
      ctx.fillStyle = '#b08d3c';
      ctx.beginPath(); ctx.ellipse(W / 2, by + 22, 12, 7, 0, Math.PI, 0); ctx.fill();
      this.stack = { x: W / 2, y: by - 24, kind: 'steam' };
    } else {
      const col = cur ? cur.line.color : '#e4572e';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(W * 0.08, dashTop + 10); ctx.quadraticCurveTo(W / 2, dashTop - (style === 'hs' || style === 'maglev' ? 40 : 18), W * 0.92, dashTop + 10);
      ctx.fill();
    }
    this.updateSmoke(ctx, dt, style, true);
    this.nightGlow(ctx, W, H, light);
    if (light < 0.6) {
      const a = (0.6 - light) * (this.whistle ? 0.9 : 0.55);
      const gr = ctx.createLinearGradient(0, dashTop, 0, hy);
      gr.addColorStop(0, `rgba(255,240,190,${a})`); gr.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = gr;
      const far = cl.length ? P(cl[Math.floor(cl.length * 0.6)].lat, cl[Math.floor(cl.length * 0.6)].z) : P(0, 500);
      ctx.beginPath(); ctx.moveTo(W * 0.1, dashTop); ctx.lineTo(far.x - 20, far.y); ctx.lineTo(far.x + 20, far.y); ctx.lineTo(W * 0.9, dashTop); ctx.fill();
    }
    ctx.restore();

    this.drawCabFrame(ctx, W, H, dashTop, S, steam);
    return { x: W / 2, y: hy - 20 };
  }

  // Small map of the followed line with a dot for the train.
  drawMinimap(ctx, W, H, cur) {
    if (!cur || !this.terrain) return;
    const g = this.g, line = cur.line, geo = g.geom(line);
    const a = g.node(line.a), b = g.node(line.b);
    const span = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) + 140;
    const wx0 = (a.x + b.x) / 2 - span / 2, wy0 = (a.y + b.y) / 2 - span / 2;
    const size = Math.round(Math.min(118, W * 0.3, H * 0.3));
    const x0 = 14, y0 = 82;
    const sc = size / span;
    const M = (x, y) => ({ x: x0 + (x - wx0) * sc, y: y0 + (y - wy0) * sc });
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x0, y0, size, size, 12);
    ctx.fillStyle = '#5f8a49'; ctx.fill();
    ctx.clip();
    // terrain (clamped to the image so every browser draws it)
    const T = this.terrain.width / WORLD_W;
    const sx0 = Math.max(0, wx0), sy0 = Math.max(0, wy0);
    const sx1 = Math.min(this.terrain.width / T, wx0 + span), sy1 = Math.min(this.terrain.height / T, wy0 + span);
    if (sx1 > sx0 && sy1 > sy0) {
      const d0 = M(sx0, sy0), d1 = M(sx1, sy1);
      ctx.drawImage(this.terrain, sx0 * T, sy0 * T, (sx1 - sx0) * T, (sy1 - sy0) * T, d0.x, d0.y, d1.x - d0.x, d1.y - d0.y);
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const l of g.state.lines) {
      const pts = g.geom(l).pts;
      ctx.beginPath(); pts.forEach((q, i) => { const p = M(q.x, q.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.strokeStyle = l === line ? 'rgba(20,14,10,0.9)' : 'rgba(20,14,10,0.4)'; ctx.lineWidth = l === line ? 5 : 3; ctx.stroke();
      ctx.strokeStyle = l === line ? l.color : 'rgba(255,255,255,0.35)'; ctx.lineWidth = l === line ? 2.5 : 1.5; ctx.stroke();
    }
    for (const n of g.world.nodes) {
      const p = M(n.x, n.y);
      if (p.x < x0 - 5 || p.y < y0 - 5 || p.x > x0 + size + 5 || p.y > y0 + size + 5) continue;
      const end = n.id === line.a || n.id === line.b;
      ctx.fillStyle = n.type === 'town' ? '#fff' : NODE_COLORS[n.type];
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, end ? 4 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const t of line.trains) {
      const q = pointAtGeo(geo, t.p * geo.len), p = M(q.x, q.y);
      const mine = t === cur.tr;
      if (mine) {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4);
        ctx.strokeStyle = `rgba(255,255,255,${0.4 + pulse * 0.5})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = mine ? '#fff' : line.color;
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, mine ? 4 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(x0, y0, size, size, 12); ctx.stroke();
  }

  drawCabFrame(ctx, W, H, dashTop, S, steam) {
    const { cur, model, remaining, light } = S;
    const frame = steam ? '#2b2420' : '#24282e';
    ctx.fillStyle = frame;
    // pillars and roof
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.07, 0); ctx.lineTo(W * 0.045, dashTop); ctx.lineTo(0, dashTop); ctx.fill();
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W * 0.93, 0); ctx.lineTo(W * 0.955, dashTop); ctx.lineTo(W, dashTop); ctx.fill();
    ctx.fillRect(0, 0, W, Math.max(18, H * 0.035));
    // dashboard
    const dg = ctx.createLinearGradient(0, dashTop, 0, H);
    dg.addColorStop(0, steam ? '#3a302a' : '#33383f'); dg.addColorStop(1, steam ? '#1d1714' : '#1a1d22');
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.moveTo(0, dashTop + 14); ctx.quadraticCurveTo(W / 2, dashTop - 6, W, dashTop + 14); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();

    const tr = cur ? cur.tr : null;
    const kmh = tr && tr.wait <= 0 ? tr.v * 4.5 : 0;
    const maxKmh = Math.ceil((model.speed * 1.4 * 4.5) / 20) * 20;
    const r = Math.min(46, W * 0.11, (H - dashTop) * 0.3);
    const gy = dashTop + r + 22;
    const gx1 = W - r - 22, gx2 = gx1 - r * 2 - 22;
    this.pressure = lerp(this.pressure ?? 0.6, 0.55 + (tr ? tr.boost : 0) * 0.7 + Math.sin(this.clock * 0.7) * 0.03, 0.05);
    this.gauge(ctx, gx1, gy, r, kmh / maxKmh, steam, `${Math.round(kmh)}`, 'km/h');
    if (steam) this.gauge(ctx, gx2, gy, r, this.pressure, true, '', 'PSI');
    else this.gauge(ctx, gx2, gy, r, tr && tr.wait <= 0 ? clamp(0.25 + (tr.v / model.speed) * 0.5 + tr.boost, 0, 1) : 0.05, false, '', 'kW');

    // left side: regulator lever (steam) or a route screen (modern)
    // controls sit just left of the gauges so the route text below stays clear
    const lw = Math.min(140, Math.max(90, gx2 - r - 44));
    const lx = Math.max(16, gx2 - r - 22 - lw);
    if (steam) {
      const ang = -0.9 + (tr && tr.wait <= 0 ? 0.6 + (tr.boost || 0) : 0);
      ctx.save(); ctx.translate(lx + 30, gy + r * 0.6); ctx.rotate(ang);
      ctx.fillStyle = '#c9a24a'; ctx.fillRect(-3, -r * 1.3, 6, r * 1.3);
      ctx.beginPath(); ctx.arc(0, -r * 1.3, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.arc(lx + 30, gy + r * 0.6, 9, 0, Math.PI * 2); ctx.fill();
      // whistle cord light
      ctx.fillStyle = this.whistle ? '#ffd77a' : '#5a4a3a';
      ctx.beginPath(); ctx.arc(lx + 70, gy - r * 0.6, 6, 0, Math.PI * 2); ctx.fill();
    } else {
      const sh = r * 1.5;
      ctx.fillStyle = '#0d1a16'; ctx.beginPath(); ctx.roundRect(lx, gy - sh / 2, lw, sh, 8); ctx.fill();
      ctx.fillStyle = '#5fc9a0'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const info = this.info;
      ctx.fillText('NEXT', lx + 10, gy - sh / 2 + 8);
      ctx.fillStyle = '#d9f5ea'; ctx.font = '700 14px system-ui, sans-serif';
      const name = info ? info.toName : '—';
      ctx.fillText(name.length > 14 ? name.slice(0, 13) + '…' : name, lx + 10, gy - sh / 2 + 24);
      ctx.fillStyle = '#5fc9a0'; ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(info ? `${(Math.max(0, remaining) / 10).toFixed(1)} km` : '', lx + 10, gy - sh / 2 + 44);
      if (this.whistle) { ctx.fillStyle = '#ffd77a'; ctx.fillText('HORN', lx + lw - 44, gy - sh / 2 + 8); }
    }
    // cab lamp glow at night
    const night = 1 - light;
    if (night > 0.3) {
      ctx.fillStyle = `rgba(255,190,110,${(night - 0.3) * 0.12})`;
      ctx.fillRect(0, dashTop, W, H - dashTop);
    }
  }

  gauge(ctx, x, y, r, frac, brass, text, unit) {
    ctx.fillStyle = brass ? '#c9a24a' : '#555b63';
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = brass ? '#f3ecd8' : '#0f1418';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.strokeStyle = brass ? '#333' : '#9aa3ad'; ctx.lineWidth = 1.5;
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * (i / 10), r2 = i % 5 ? r * 0.84 : r * 0.76;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2); ctx.stroke();
    }
    const a = a0 + (a1 - a0) * clamp(frac, 0, 1);
    ctx.strokeStyle = '#e4572e'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = brass ? '#333' : '#d9e0e6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (text) { ctx.font = `700 ${Math.round(r * 0.32)}px system-ui, sans-serif`; ctx.fillText(text, x, y + r * 0.38); }
    ctx.font = `600 ${Math.round(r * 0.2)}px system-ui, sans-serif`; ctx.fillText(unit, x, y + r * 0.66);
  }

  drawSky(ctx, W, H, gy, light, phase) {
    const top = mix('#0b1430', '#5da4d8', light);
    const bot = mix('#2a3560', '#cfe6ee', light);
    const gr = ctx.createLinearGradient(0, 0, 0, gy);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, gy);
    // dusk / dawn glow
    const dusk = Math.max(0, 1 - Math.abs(light - 0.45) * 3.2);
    if (dusk > 0) {
      const g2 = ctx.createLinearGradient(0, gy * 0.35, 0, gy);
      g2.addColorStop(0, 'rgba(255,140,90,0)');
      g2.addColorStop(1, `rgba(255,140,90,${dusk * 0.5})`);
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, gy);
    }
    // stars
    if (light < 0.6) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 90; i++) {
        const x = hash(i, 3) * W, y = hash(i, 4) * gy * 0.75;
        ctx.globalAlpha = (0.6 - light) * (0.5 + 0.5 * Math.sin(this.clock * (0.5 + hash(i, 5)) + i));
        ctx.fillRect(x, y, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }
    // sun & moon on an arc
    const ang = phase * Math.PI * 2;
    const cx = W / 2, rx = W * 0.6, ry = gy * 0.85;
    const sx = cx - Math.sin(ang) * rx, sy = gy - Math.cos(ang) * ry;
    if (sy < gy) {
      ctx.fillStyle = 'rgba(255,236,170,0.25)';
      ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath(); ctx.arc(sx, sy, 20, 0, Math.PI * 2); ctx.fill();
    }
    const mx = cx + Math.sin(ang) * rx, my = gy + Math.cos(ang) * ry;
    if (my < gy) {
      ctx.fillStyle = '#eef0ff';
      ctx.beginPath(); ctx.arc(mx, my, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = mix('#0b1430', '#5da4d8', light);
      ctx.beginPath(); ctx.arc(mx + 6, my - 3, 12, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawClouds(ctx, W, gy, sc, light) {
    const span = W + 400;
    ctx.fillStyle = mix('#5a6688', '#ffffff', light);
    for (let i = 0; i < 7; i++) {
      const speed = 4 + hash(i, 12) * 6;
      const x = ((((hash(i, 11) * span - this.clock * speed - sc * 0.015 * (1 + hash(i, 14))) % span) + span) % span) - 200;
      const y = gy * (0.1 + hash(i, 13) * 0.45);
      const s = 0.6 + hash(i, 15) * 0.9;
      ctx.globalAlpha = 0.55 + 0.3 * light;
      ctx.beginPath();
      ctx.ellipse(x, y, 60 * s, 16 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 28 * s, y - 8 * s, 30 * s, 18 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 18 * s, y - 14 * s, 34 * s, 22 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawBirds(ctx, W, gy) {
    const period = 70, t = this.clock % period, dur = 26;
    if (t > dur) return;
    const k = Math.floor(this.clock / period);
    const x0 = W + 60 - (t / dur) * (W + 200);
    const y0 = gy * (0.2 + hash(k, 21) * 0.3) + Math.sin(t * 0.6) * 10;
    ctx.strokeStyle = 'rgba(30,30,40,0.7)'; ctx.lineWidth = 1.6;
    for (let i = 0; i < 5; i++) {
      const bx = x0 + Math.abs(i - 2) * 16 + i * 4, by = y0 + Math.abs(i - 2) * 9;
      const f = Math.sin(this.clock * 8 + i) * 4;
      ctx.beginPath(); ctx.moveTo(bx - 6, by - f); ctx.lineTo(bx, by); ctx.lineTo(bx + 6, by - f); ctx.stroke();
    }
  }

  drawRidge(ctx, W, gy, off, freq, amp, base, color, seed) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    for (let x = 0; x <= W + 8; x += 8) {
      const wx = x + off;
      const y = base - noise1(wx * freq, seed) * amp - noise1(wx * freq * 3.1, seed + 1) * amp * 0.25;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, gy); ctx.closePath(); ctx.fill();
  }

  drawTrees(ctx, W, gy, off, light) {
    const cell = 34;
    const i0 = Math.floor(off / cell) - 1, i1 = Math.floor((off + W) / cell) + 1;
    const dark = mix('#1f3a26', '#2f5d34', light), mid = mix('#284a2e', '#3f7a42', light);
    for (let i = i0; i <= i1; i++) {
      const h = hash(i, 77);
      if (h < 0.35) continue;
      const x = i * cell - off + hash(i, 78) * 20;
      const ht = 22 + hash(i, 79) * 34;
      const base = gy - 6;
      if (hash(i, 80) < 0.55) {
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(x, base - ht); ctx.lineTo(x - ht * 0.32, base); ctx.lineTo(x + ht * 0.32, base); ctx.fill();
      } else {
        ctx.fillStyle = '#4a3527'; ctx.fillRect(x - 2, base - ht * 0.4, 4, ht * 0.4);
        ctx.fillStyle = mid;
        ctx.beginPath(); ctx.arc(x, base - ht * 0.55, ht * 0.33, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawTrack(ctx, W, gy, sc, style) {
    if (style === 'maglev') {
      ctx.fillStyle = '#b9bec4'; ctx.fillRect(0, gy - 2, W, 14);
      ctx.fillStyle = '#8f959c'; ctx.fillRect(0, gy + 12, W, 4);
      ctx.fillStyle = '#7a8087';
      const sp = 160, o = sc % sp;
      for (let x = -o; x < W + sp; x += sp) ctx.fillRect(x, gy + 16, 16, 40);
      return;
    }
    ctx.fillStyle = '#8a7f72'; ctx.fillRect(0, gy + 1, W, 13);
    ctx.fillStyle = '#5b4636';
    const sp = 22, o = sc % sp;
    for (let x = -o; x < W + sp; x += sp) ctx.fillRect(x, gy + 2, 10, 6);
    ctx.fillStyle = '#c9ccd1'; ctx.fillRect(0, gy - 1, W, 3);
  }

  drawPoles(ctx, W, gy, sc, style) {
    const electric = style === 'electric' || style === 'hs';
    const sp = 260, o = sc % sp;
    const top = gy - (electric ? 118 : 96);
    ctx.strokeStyle = '#3b3029'; ctx.lineWidth = 4;
    const xs = [];
    for (let x = -o - sp; x < W + sp; x += sp) {
      xs.push(x);
      ctx.beginPath(); ctx.moveTo(x, gy + 2); ctx.lineTo(x, top); ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 10, top + 6); ctx.lineTo(x + (electric ? 50 : 10), top + 6); ctx.stroke();
      ctx.lineWidth = 4;
    }
    ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 1;
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i], b = xs[i + 1];
      if (electric) {
        ctx.beginPath(); ctx.moveTo(a + 40, top + 10); ctx.lineTo(b + 40, top + 10); ctx.stroke();
      } else {
        for (const dy of [6, 14]) {
          ctx.beginPath(); ctx.moveTo(a, top + dy); ctx.quadraticCurveTo((a + b) / 2, top + dy + 16, b, top + dy); ctx.stroke();
        }
      }
    }
  }

  drawStation(ctx, sx, gy, name) {
    // platform runs left of sx so the loco stops at its far end
    ctx.fillStyle = '#9a8f80'; ctx.fillRect(sx - 360, gy - 14, 400, 14);
    ctx.fillStyle = '#d8d0c0'; ctx.fillRect(sx - 360, gy - 16, 400, 3);
    // building
    const bx = sx - 290;
    ctx.fillStyle = '#a65d43'; ctx.fillRect(bx, gy - 92, 150, 78);
    ctx.fillStyle = '#5a3b2e';
    ctx.beginPath(); ctx.moveTo(bx - 14, gy - 92); ctx.lineTo(bx + 75, gy - 128); ctx.lineTo(bx + 164, gy - 92); ctx.fill();
    ctx.fillStyle = '#3d2a20'; ctx.fillRect(bx + 62, gy - 52, 26, 38);
    for (const wx of [bx + 18, bx + 108]) {
      ctx.fillStyle = '#2f3a4a'; ctx.fillRect(wx, gy - 72, 24, 26);
      this.lights.push({ kind: 'win', x: wx, y: gy - 72, w: 24, h: 26 });
    }
    // name board
    ctx.font = '700 14px system-ui, sans-serif';
    const tw = ctx.measureText(name).width + 20;
    ctx.fillStyle = '#1f3b63'; ctx.fillRect(bx + 75 - tw / 2, gy - 150, tw, 22);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, bx + 75, gy - 139);
    // lamps
    for (const lx of [sx - 330, sx - 100, sx + 20]) {
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(lx, gy - 64, 3, 50);
      ctx.fillStyle = '#ffe2a0'; ctx.fillRect(lx - 3, gy - 68, 9, 6);
      this.lights.push({ kind: 'lamp', x: lx + 1, y: gy - 65 });
    }
  }

  // ---------- train ----------

  drawTrain(ctx, fx, gy, model, tr, line, sc) {
    const color = line ? line.color : '#e4572e';
    const style = model.style;
    const bob = Math.sin(sc * 0.08) * (this.vis > 5 ? 0.8 : 0);
    const hover = style === 'maglev' ? -8 + Math.sin(this.clock * 3) * 1.5 : 0;
    const y0 = gy + bob + hover;
    const wheelRot = sc / 12;

    let x = fx;
    const locoLen = { steam: 128, stream: 140, diesel: 130, electric: 120, hs: 150, maglev: 160 }[style];
    this.drawLoco(ctx, x, y0, style, color, wheelRot);
    x -= locoLen + 6;
    if (style === 'steam') { this.drawTender(ctx, x, y0, wheelRot); x -= 56; }

    const cap = model.cap;
    const n = clamp(Math.round(cap / 50) + 1, 2, 6);
    let types = tr ? Object.keys(tr.load).filter((c) => tr.load[c] > 0) : [];
    if (!types.length && line) {
      types = [...new Set([...this.g.flow(line.a, line.b), ...this.g.flow(line.b, line.a)])];
    }
    if (!types.length) types = ['pax'];
    const loaded = tr ? Object.values(tr.load).reduce((s, v) => s + v, 0) / cap : 0;
    for (let i = 0; i < n; i++) {
      this.drawWagon(ctx, x, y0, types[i % types.length], loaded, color, wheelRot, style);
      x -= 96;
    }
  }

  wheel(ctx, x, y, r, rot, spokes = true) {
    ctx.fillStyle = '#1d1d1d';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6d6d6d';
    ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, Math.PI * 2); ctx.fill();
    if (spokes && r > 8) {
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const a = rot + (i * Math.PI) / 4;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * r * 0.85, y - Math.sin(a) * r * 0.85); ctx.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85); ctx.stroke();
      }
    }
  }

  bogie(ctx, cx, y, rot) {
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(cx - 18, y - 12, 36, 6);
    this.wheel(ctx, cx - 10, y - 6, 6, rot, false);
    this.wheel(ctx, cx + 10, y - 6, 6, rot, false);
  }

  drawLoco(ctx, fx, y, style, color, rot) {
    if (style === 'steam') {
      const body = '#2c2c2e';
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(fx - 124, y - 24, 120, 9);
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.roundRect(fx - 100, y - 58, 92, 34, 6); ctx.fill();
      ctx.fillStyle = color; ctx.fillRect(fx - 100, y - 44, 92, 4);
      ctx.fillStyle = '#1f1f1f'; ctx.fillRect(fx - 26, y - 60, 18, 36);
      // chimney + dome
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(fx - 26, y - 80, 12, 22); ctx.fillRect(fx - 29, y - 84, 18, 6);
      ctx.fillStyle = '#b08d3c'; ctx.beginPath(); ctx.arc(fx - 60, y - 58, 8, Math.PI, 0); ctx.fill();
      // cab
      ctx.fillStyle = color; ctx.fillRect(fx - 128, y - 82, 32, 58);
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(fx - 134, y - 88, 44, 7);
      ctx.fillStyle = '#2f3a4a'; ctx.fillRect(fx - 120, y - 74, 16, 16);
      this.lights.push({ kind: 'win', x: fx - 120, y: y - 74, w: 16, h: 16 });
      // cowcatcher
      ctx.fillStyle = '#7a1f1f';
      ctx.beginPath(); ctx.moveTo(fx - 8, y - 18); ctx.lineTo(fx + 10, y - 2); ctx.lineTo(fx - 8, y - 2); ctx.fill();
      // lamp
      ctx.fillStyle = '#ffe9a0'; ctx.fillRect(fx - 10, y - 54, 6, 8);
      this.lights.push({ kind: 'head', x: fx - 4, y: y - 50 });
      // wheels + rod
      this.wheel(ctx, fx - 92, y - 13, 13, rot);
      this.wheel(ctx, fx - 62, y - 13, 13, rot);
      this.wheel(ctx, fx - 22, y - 8, 8, rot);
      const rx = Math.cos(rot) * 6, ry = Math.sin(rot) * 6;
      ctx.strokeStyle = '#a8a8a8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(fx - 92 + rx, y - 13 + ry); ctx.lineTo(fx - 62 + rx, y - 13 + ry); ctx.stroke();
      this.stack = { x: fx - 20, y: y - 86, kind: 'steam' };
      return;
    }
    if (style === 'stream') {
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(fx - 136, y - 22, 132, 8);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(fx - 140, y - 20); ctx.lineTo(fx - 140, y - 78);
      ctx.lineTo(fx - 40, y - 78); ctx.quadraticCurveTo(fx + 8, y - 74, fx + 8, y - 30);
      ctx.lineTo(fx + 8, y - 20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d8dde2'; ctx.fillRect(fx - 140, y - 46, 140, 5);
      ctx.fillStyle = '#2f3a4a'; ctx.fillRect(fx - 130, y - 70, 18, 14);
      this.lights.push({ kind: 'win', x: fx - 130, y: y - 70, w: 18, h: 14 });
      ctx.fillStyle = '#ffe9a0'; ctx.beginPath(); ctx.arc(fx + 2, y - 40, 4, 0, Math.PI * 2); ctx.fill();
      this.lights.push({ kind: 'head', x: fx + 6, y: y - 40 });
      for (const wx of [fx - 110, fx - 80, fx - 50]) this.wheel(ctx, wx, y - 12, 12, rot);
      ctx.fillStyle = color; ctx.fillRect(fx - 125, y - 24, 100, 8);
      this.stack = { x: fx - 40, y: y - 80, kind: 'steam' };
      return;
    }
    if (style === 'maglev') {
      ctx.fillStyle = 'rgba(120,200,255,0.5)'; ctx.fillRect(fx - 160, y - 6, 160, 4);
      ctx.fillStyle = '#eef2f6';
      ctx.beginPath();
      ctx.moveTo(fx - 160, y - 8); ctx.lineTo(fx - 160, y - 62); ctx.lineTo(fx - 70, y - 62);
      ctx.quadraticCurveTo(fx + 10, y - 58, fx + 16, y - 10); ctx.lineTo(fx - 160, y - 8); ctx.fill();
      ctx.fillStyle = color; ctx.fillRect(fx - 160, y - 26, 168, 6);
      ctx.fillStyle = '#26303d';
      ctx.beginPath(); ctx.moveTo(fx - 60, y - 58); ctx.quadraticCurveTo(fx - 10, y - 55, fx - 2, y - 38); ctx.lineTo(fx - 60, y - 38); ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#2f3a4a'; ctx.fillRect(fx - 150 + i * 22, y - 52, 16, 12);
        this.lights.push({ kind: 'win', x: fx - 150 + i * 22, y: y - 52, w: 16, h: 12 });
      }
      this.lights.push({ kind: 'head', x: fx + 10, y: y - 18 });
      this.stack = { x: fx - 80, y: y - 64, kind: 'spark' };
      return;
    }
    // diesel / electric / high speed
    const len = style === 'hs' ? 150 : style === 'electric' ? 120 : 130;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (style === 'hs') {
      ctx.moveTo(fx - len, y - 18); ctx.lineTo(fx - len, y - 70); ctx.lineTo(fx - 60, y - 70);
      ctx.lineTo(fx + 6, y - 30); ctx.lineTo(fx + 6, y - 18);
    } else {
      ctx.moveTo(fx - len, y - 18); ctx.lineTo(fx - len, y - 72); ctx.lineTo(fx - 14, y - 72);
      ctx.lineTo(fx, y - 58); ctx.lineTo(fx, y - 18);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(fx - len, y - 34, len + (style === 'hs' ? 4 : 0), 4);
    ctx.fillStyle = '#26303d';
    if (style === 'hs') {
      ctx.beginPath(); ctx.moveTo(fx - 58, y - 66); ctx.lineTo(fx - 22, y - 44); ctx.lineTo(fx - 58, y - 44); ctx.fill();
    } else {
      ctx.fillRect(fx - 30, y - 66, 22, 16);
    }
    for (let i = 0; i < 3; i++) {
      const wx = fx - len + 14 + i * 26;
      ctx.fillStyle = '#2f3a4a'; ctx.fillRect(wx, y - 62, 16, 12);
      this.lights.push({ kind: 'win', x: wx, y: y - 62, w: 16, h: 12 });
    }
    if (style === 'diesel') {
      ctx.fillStyle = '#333'; ctx.fillRect(fx - 80, y - 78, 12, 6);
      this.stack = { x: fx - 74, y: y - 80, kind: 'exhaust' };
    } else {
      // pantograph
      ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
      const px = fx - len / 2 - 10, top = y - 72;
      ctx.beginPath(); ctx.moveTo(px - 12, top); ctx.lineTo(px + 4, top - 18); ctx.lineTo(px - 8, top - 36); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 22, top - 36); ctx.lineTo(px + 8, top - 36); ctx.stroke();
      this.stack = { x: px - 8, y: top - 38, kind: 'spark' };
    }
    ctx.fillStyle = '#ffe9a0'; ctx.fillRect(fx - 6, y - 28, 6, 6);
    this.lights.push({ kind: 'head', x: fx, y: y - 25 });
    this.bogie(ctx, fx - len + 28, y, rot);
    this.bogie(ctx, fx - 28, y, rot);
  }

  drawTender(ctx, x, y, rot) {
    ctx.fillStyle = '#2c2c2e'; ctx.fillRect(x - 50, y - 56, 50, 36);
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.moveTo(x - 46, y - 56); ctx.quadraticCurveTo(x - 25, y - 70, x - 4, y - 56); ctx.fill();
    this.wheel(ctx, x - 38, y - 9, 9, rot);
    this.wheel(ctx, x - 12, y - 9, 9, rot);
  }

  drawWagon(ctx, x, y, cargo, loaded, color, rot, style) {
    const w = 90, l = x - w;
    const modern = style !== 'steam';
    if (style === 'maglev') {
      ctx.fillStyle = '#eef2f6'; ctx.fillRect(l, y - 62, w, 54);
      ctx.fillStyle = color; ctx.fillRect(l, y - 26, w, 6);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#2f3a4a'; ctx.fillRect(l + 6 + i * 21, y - 52, 15, 12);
        this.lights.push({ kind: 'win', x: l + 6 + i * 21, y: y - 52, w: 15, h: 12 });
      }
      return;
    }
    if (cargo === 'pax') {
      ctx.fillStyle = modern ? color : '#7a3b2e';
      ctx.beginPath(); ctx.roundRect(l, y - 64, w, 46, modern ? 6 : 3); ctx.fill();
      ctx.fillStyle = modern ? 'rgba(255,255,255,0.75)' : '#c9a24a';
      ctx.fillRect(l, y - 30, w, 3);
      if (!modern) { ctx.fillStyle = '#3a2a22'; ctx.fillRect(l - 3, y - 68, w + 6, 6); }
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = '#2f3a4a'; ctx.fillRect(l + 6 + i * 17, y - 56, 11, 14);
        this.lights.push({ kind: 'win', x: l + 6 + i * 17, y: y - 56, w: 11, h: 14 });
      }
    } else if (cargo === 'grain' || cargo === 'coal') {
      ctx.fillStyle = cargo === 'coal' ? '#4a4a4a' : '#9c6b3a';
      ctx.beginPath(); ctx.moveTo(l, y - 60); ctx.lineTo(x, y - 60); ctx.lineTo(x - 10, y - 20); ctx.lineTo(l + 10, y - 20); ctx.fill();
      if (loaded > 0.02) {
        ctx.fillStyle = CARGO[cargo].color;
        const hh = 6 + loaded * 14;
        ctx.beginPath(); ctx.moveTo(l + 4, y - 60); ctx.quadraticCurveTo(l + w / 2, y - 60 - hh * 2, x - 4, y - 60); ctx.fill();
      }
    } else if (cargo === 'logs') {
      ctx.fillStyle = '#4a3a2c'; ctx.fillRect(l, y - 28, w, 8);
      ctx.fillStyle = '#333'; ctx.fillRect(l + 4, y - 58, 4, 30); ctx.fillRect(x - 8, y - 58, 4, 30);
      if (loaded > 0.02) {
        const rows = Math.max(1, Math.round(loaded * 3));
        for (let r = 0; r < rows; r++) {
          ctx.fillStyle = r % 2 ? '#8a5a32' : '#9b6a3c';
          ctx.beginPath(); ctx.roundRect(l + 8, y - 38 - r * 10, w - 16, 9, 4); ctx.fill();
        }
      }
    } else {
      ctx.fillStyle = cargo === 'food' ? '#c95f3c' : '#5f7fa8';
      ctx.fillRect(l, y - 64, w, 44);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
      ctx.strokeRect(l + 30, y - 58, 30, 34);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '600 10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(cargo === 'food' ? 'FOOD' : 'GOODS', l + 15, y - 40);
    }
    if (modern) { this.bogie(ctx, l + 18, y, rot); this.bogie(ctx, x - 18, y, rot); }
    else { ctx.fillStyle = '#2a2a2a'; ctx.fillRect(l + 4, y - 22, w - 8, 6); this.wheel(ctx, l + 18, y - 9, 9, rot); this.wheel(ctx, x - 18, y - 9, 9, rot); }
  }

  updateSmoke(ctx, dt, style, cab = false) {
    const s = this.stack;
    if (s) {
      let rate = s.kind === 'steam' ? 4 + this.vis * 0.06 : s.kind === 'exhaust' ? 2 + this.vis * 0.02 : 0;
      if (cab && this.vis < 5) rate *= 0.3; // idling: just a wisp
      this.emitAcc = (this.emitAcc || 0) + rate * dt;
      while (this.emitAcc > 1) { this.emitAcc--; this.puff(1, s.kind === 'steam' ? 1 : 0.5); }
      if (this.whistle) {
        this.whistleAcc = (this.whistleAcc || 0) + dt * 30;
        while (this.whistleAcc > 1) {
          this.whistleAcc--;
          this.parts.push({ x: s.x + 14, y: s.y + 10, vx: 20 + Math.random() * 30, vy: -90 - Math.random() * 40, r: 3 + Math.random() * 3, life: 0, max: 1.2, kind: 'white' });
        }
      }
    }
    for (const p of this.parts) {
      p.life += dt;
      p.x += (p.vx - this.vis * (this.drift ?? 0.85)) * dt;
      p.y += p.vy * dt;
      p.vy *= 0.97;
      p.r += dt * (p.kind === 'spark' ? -4 : cab ? 26 : 10);
      const a = Math.max(0, 1 - p.life / p.max);
      if (p.kind === 'spark') {
        ctx.fillStyle = `rgba(150,220,255,${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.r * 0.4), 0, Math.PI * 2); ctx.fill();
      } else {
        const c = p.kind === 'exhaust' ? '70,70,70' : p.kind === 'white' ? '255,255,255' : '225,225,225';
        ctx.fillStyle = `rgba(${c},${a * (p.kind === 'exhaust' ? 0.35 : 0.6)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, p.r), 0, Math.PI * 2); ctx.fill();
      }
    }
    this.parts = this.parts.filter((p) => p.life < p.max && p.x > -120);
    if (this.parts.length > 260) this.parts.splice(0, this.parts.length - 260);
  }

  drawForeground(ctx, W, H, gy, off, spans = []) {
    const wet = (x) => spans.some(([a, b]) => x > a - 6 && x < b + 6);
    ctx.fillStyle = '#3f6a31';
    const cell = 18;
    const i0 = Math.floor(off / cell) - 1, i1 = Math.floor((off + W) / cell) + 1;
    for (let i = i0; i <= i1; i++) {
      if (hash(i, 91) < 0.4) continue;
      const x = i * cell - off, y = gy + 34 + hash(i, 92) * (H - gy - 40);
      if (wet(x)) continue;
      const h = 6 + hash(i, 93) * 10;
      ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x, y - h); ctx.lineTo(x + 3, y); ctx.fill();
    }
    // wildflowers
    const fc = ['#f4d35e', '#ee964b', '#f2f2f2', '#c38dd6'];
    const fcell = 26;
    const j0 = Math.floor(off / fcell) - 1, j1 = Math.floor((off + W) / fcell) + 1;
    for (let i = j0; i <= j1; i++) {
      if (hash(i, 95) < 0.55) continue;
      const x = i * fcell - off + hash(i, 96) * 12, y = gy + 60 + hash(i, 97) * (H - gy - 70);
      if (wet(x)) continue;
      ctx.fillStyle = fc[Math.floor(hash(i, 98) * fc.length)];
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    // fence
    ctx.strokeStyle = '#6d5440'; ctx.lineWidth = 3;
    const sp = 70, o = off % sp, fy = gy + 30;
    for (let x = -o; x < W + sp; x += sp) { if (wet(x)) continue; ctx.beginPath(); ctx.moveTo(x, fy + 22); ctx.lineTo(x, fy); ctx.stroke(); }
    ctx.lineWidth = 2;
    // fence rails, with gaps where the line crosses water
    const cuts = spans.map(([a, b]) => [a - 6, b + 6]).sort((a, b) => a[0] - b[0]);
    let from = 0;
    ctx.beginPath();
    for (const [a, b] of [...cuts, [W, W]]) {
      if (a > from) { ctx.moveTo(from, fy + 6); ctx.lineTo(Math.min(a, W), fy + 6); ctx.moveTo(from, fy + 14); ctx.lineTo(Math.min(a, W), fy + 14); }
      from = Math.max(from, b);
    }
    ctx.stroke();
  }
}
