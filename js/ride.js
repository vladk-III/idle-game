// Focus mode "ride" scene: a side view that follows one of your real trains
// through a slowly shifting day/night landscape.
import { MODELS, CARGO, NODE_TYPES } from './data.js';
import { hash, noise1, clamp, lerp } from './rng.js';
import { Route, EXT } from './route.js';
import { drawTree } from './trees.js';
import { OL, shade, glossy, glossyRect, outlined, blob, person, toonTree, toonCloud, season, mixHex, snowCap } from './toon.js';
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
    this.charmV = (this.charmV || 0) + (Math.random() < 0.5 ? -2.5 : 2.5);
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
    this.wx = this.g.weather();
    season.snow = this.wx.cover; season.autumn = this.wx.autumn;
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
    this.drawRidge(ctx, W, gy, sc * 0.04, 0.003, Math.min(H * 0.25, 170), gy - Math.min(H * 0.1, 70), this.snowy(mixHex('#5a68b0', '#9fb8ea', light), 0.6), 11);
    this.drawRidge(ctx, W, gy, sc * 0.09, 0.0045, Math.min(H * 0.16, 110), hz + 6, this.snowy(mixHex('#4a7aa0', '#7fb6d6', light), 0.75), 17);
    this.drawRidge(ctx, W, gy, sc * 0.18, 0.007, Math.min(H * 0.07, 45), hz + 2, this.snowy(mixHex('#3f8a55', '#6fc463', light * 0.9), 0.85), 23);
    // meadow between the hills and the line; the map's scenery stands on it
    const mg = ctx.createLinearGradient(0, hz, 0, gy);
    mg.addColorStop(0, this.snowy('#a6d97f')); mg.addColorStop(1, this.snowy('#78bd56', 0.9));
    ctx.fillStyle = mg; ctx.fillRect(0, hz, W, gy - hz);
    if (v) this.drawBackdrop(ctx, W, gy, hz, v, light);
    else this.drawTrees(ctx, W, gy, sc * 0.4, light);
    ctx.fillStyle = this.snowy('#6cbf4a', 0.9);
    ctx.fillRect(0, gy - 8, W, H - gy + 8);
    ctx.fillStyle = this.snowy('#5aa83e', 0.85);
    ctx.fillRect(0, gy + 22, W, H - gy);
  }

  // Darken for night, then draw anything that glows.
  nightGlow(ctx, W, H, light) {
    const night = 1 - light;
    if (night <= 0.02) return;
    ctx.fillStyle = `rgba(14,18,70,${night * 0.5})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = night;
    for (const l of this.lights) {
      if (l.kind === 'win') { ctx.fillStyle = l.soft ? 'rgba(255,214,120,0.38)' : '#ffd77a'; ctx.fillRect(l.x, l.y, l.w, l.h); }
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
      const ids = cur.tr.dir > 0 ? [cur.line.a, cur.line.b] : [cur.line.b, cur.line.a];
      if (depX > -60 && depX < W + 400) this.drawStation(ctx, depX, gy, fromName, ids[0]);
      if (arrX < W + 400 && legPx > 0) this.drawStation(ctx, arrX, gy, toName, ids[1]);
    }
    this.drawTrack(ctx, W, gy, sc, model.style);
    this.drawPoles(ctx, W, gy, sc, model.style);
    this.drawTrain(ctx, frontX, gy, model, cur ? cur.tr : null, cur ? cur.line : null, sc);
    this.updateSmoke(ctx, dt, model.style);
    this.drawForeground(ctx, W, H, gy, sc * 1.35, spans);
    this.precipScreen(ctx, dt, W, 0, H, gy + 30);
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
    ctx.fillStyle = '#5aa83e'; ctx.fillRect(0, gy + 22, W, H);
    if (cur) {
      const depX = frontX - traveled * k;
      const arrX = frontX + remaining * k;
      const ids = cur.tr.dir > 0 ? [cur.line.a, cur.line.b] : [cur.line.b, cur.line.a];
      if (depX > -60 && depX < W + 400) this.drawStation(ctx, depX, gy, fromName, ids[0]);
      if (arrX < W + 400 && legPx > 0) this.drawStation(ctx, arrX, gy, toName, ids[1]);
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
    this.precipScreen(ctx, dt, W, top, bot + 20, null);
    this.nightGlow(ctx, W, H, light);
    this.glassDrops(ctx, dt, wins, sway, false);
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
    for (const w of wins) {
      ctx.strokeStyle = OL; ctx.lineWidth = 12; ctx.beginPath(); ctx.roundRect(w.x, w.y, w.w, w.h, 18); ctx.stroke();
      ctx.strokeStyle = theme.trim; ctx.lineWidth = 7; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(w.x - 2, w.y - 2, w.w + 4, w.h + 4, 20); ctx.stroke();
    }
    // curtains
    if (theme.curtain) {
      for (const w of wins) {
        for (const side of [0, 1]) {
          const cx = side ? w.x + w.w + 4 : w.x - 4, dir = side ? -1 : 1;
          glossy(ctx, () => {
            ctx.moveTo(cx, w.y - 10);
            ctx.lineTo(cx + dir * 34, w.y - 10);
            ctx.quadraticCurveTo(cx + dir * 10, w.y + w.h * 0.45, cx + dir * 26, w.y + w.h * 0.9);
            ctx.lineTo(cx, w.y + w.h * 0.9);
            ctx.closePath();
          }, { x: Math.min(cx, cx + dir * 34), y: w.y - 10, w: 34, h: w.h }, theme.curtain, { gloss: false, belly: 0 });
          outlined(ctx, () => ctx.roundRect(cx + dir * 4 - 5, w.y + w.h * 0.5, 10 + dir * 0, 6, 3), '#f5c542', 1.5);
        }
      }
    }
    // luggage rack with a suitcase
    const rackY = top - 34;
    if (rackY > 70) {
      glossyRect(ctx, W * 0.62, rackY - 16, 60, 26, 5, '#e0594a', { lw: 2 });
      outlined(ctx, () => ctx.roundRect(W * 0.62 + 22, rackY - 23, 16, 7, 3), '#8a5a35', 1.5);
      ctx.fillStyle = '#f5c542'; ctx.fillRect(W * 0.62 + 8, rackY - 16, 5, 26); ctx.fillRect(W * 0.62 + 47, rackY - 16, 5, 26);
      outlined(ctx, () => ctx.roundRect(10, rackY + 8, W - 20, 5, 2.5), theme.trim, 2);
    }
    // table and tea
    const tableY = bot + 18;
    glossyRect(ctx, W * 0.16, tableY, W * 0.68, 16, 6, theme.table, { lw: 2.5 });
    outlined(ctx, () => ctx.rect(W * 0.47, tableY + 16, W * 0.06, 70), shade(theme.table, -0.25), 2);
    this.drawCup(ctx, W * 0.66, tableY, dt, moving);
    // a folded newspaper
    ctx.save(); ctx.translate(W * 0.32, tableY + 2); ctx.rotate(-0.08);
    outlined(ctx, () => ctx.roundRect(-36, -9, 72, 10, 2), '#f6f1e7', 1.5);
    ctx.fillStyle = '#9a9488'; ctx.fillRect(-30, -6, 40, 2); ctx.fillRect(-30, -3, 52, 1.5);
    ctx.restore();
    // other passengers, their heads showing over the seats (as many as are on board)
    const seatTop = Math.max(tableY + 60, H * (portrait ? 0.74 : 0.8));
    const tr = cur ? cur.tr : null;
    const full = tr ? (tr.load.pax || 0) / model.cap : 0;
    const halves = [[-20, W * 0.46], [W * 0.54, W + 20]];
    halves.forEach(([x0, x1], i) => {
      if (full > (i ? 0.55 : 0.2)) person(ctx, (x0 + x1) / 2 + (i ? -14 : 12), seatTop + 6, 2.6, 900 + i * 17, this.clock, { back: true });
    });
    for (const [x0, x1] of halves) {
      glossyRect(ctx, x0, seatTop, x1 - x0, H - seatTop + 30, 28, theme.seat, { lw: 3 });
      ctx.fillStyle = theme.seatHi;
      ctx.fillRect(x0 + 2, seatTop + 22, x1 - x0 - 4, 6);
      if (theme.curtain) outlined(ctx, () => ctx.roundRect((x0 + x1) / 2 - 40, seatTop - 2, 80, 26, 6), '#fbf6ea', 2);
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
    outlined(ctx, () => ctx.ellipse(x, y, 26, 5, 0, 0, Math.PI * 2), '#f6f1e7', 1.8);
    ctx.strokeStyle = OL; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(x + 17, y - 17, 7, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.strokeStyle = '#f6f1e7'; ctx.lineWidth = 3; ctx.stroke();
    const cup = () => { ctx.moveTo(x - 15, y - 28); ctx.lineTo(x + 15, y - 28); ctx.lineTo(x + 12, y - 2); ctx.lineTo(x - 12, y - 2); ctx.closePath(); };
    outlined(ctx, cup, '#f6f1e7', 2);
    ctx.fillStyle = '#e0594a'; ctx.fillRect(x - 13.5, y - 14, 26.5, 4);
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
      ctx.fillStyle = '#4aa3e0';
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
      if (it.kind === 'tree') this.drawTreeAt(ctx, it.x, it.y, (30 + it.t.size * 9) * it.p * 1.1, it.t.c, (it.t.x * 73 + it.t.y * 19) | 0);
      else if (it.kind === 'house') this.drawHouse(ctx, it.x, it.y, (10 + it.h.size * 2.4) * it.p * 1.5, it.h.c);
      else this.drawIndustry(ctx, it.type, it.x, it.y, it.p * 1.25);
    }
  }

  // Water on the near side of the line, and bridges where the line crosses it.
  drawNearWater(ctx, W, H, gy, v) {
    const { route, k, frontX, d, dir, c } = v;
    ctx.fillStyle = '#4aa3e0';
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
      ctx.fillStyle = '#4aa3e0'; ctx.fillRect(x0, gy + 10, x1 - x0, H - gy);
      ctx.fillStyle = '#3a8bc8'; ctx.fillRect(x0, gy + 40, x1 - x0, H - gy);
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

  drawTreeAt(ctx, x, y, h, kind, seed) {
    drawTree(ctx, x, y, h, kind, seed);
  }

  drawHouse(ctx, x, y, w, c) {
    const roofs = ['#e0594a', '#8d6e63', '#f08a24', '#5d7fb8'].map((c) => this.snowy(c, 0.85));
    const walls = ['#fff1d6', '#f3dfbd', '#ffe8c2', '#f6f1e7'];
    const h = w * 0.62, lw = clamp(w * 0.07, 0.6, 2.2);
    outlined(ctx, () => ctx.rect(x - w / 2, y - h, w, h), walls[c], lw);
    outlined(ctx, () => { ctx.moveTo(x - w * 0.62, y - h); ctx.lineTo(x, y - h - w * 0.45); ctx.lineTo(x + w * 0.62, y - h); ctx.closePath(); }, roofs[c], lw);
    if (w > 9) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.moveTo(x - w * 0.45, y - h - w * 0.05); ctx.lineTo(x, y - h - w * 0.38); ctx.lineTo(x + w * 0.05, y - h - w * 0.33); ctx.lineTo(x - w * 0.36, y - h - w * 0.03); ctx.fill();
      const ww = w * 0.22;
      outlined(ctx, () => ctx.roundRect(x - w * 0.34, y - h * 0.78, ww, ww, ww * 0.2), '#8fd3ff', lw * 0.7);
      this.lights.push({ kind: 'win', x: x - w * 0.34, y: y - h * 0.78, w: ww, h: ww });
      outlined(ctx, () => ctx.roundRect(x + w * 0.08, y - h * 0.62, w * 0.2, h * 0.62, [w * 0.1, w * 0.1, 0, 0]), '#8a5a35', lw * 0.7);
    }
  }

  // Industry buildings, drawn on the ground at (x, y); u = pixels per unit.
  drawIndustry(ctx, type, x, y, u) {
    const lw = clamp(u * 1.4, 0.6, 2.4);
    const R = (dx, dy, w, h, col, r = 0) => outlined(ctx, () => ctx.roundRect(x + dx * u, y - (dy + h) * u, w * u, h * u, r * u), col, lw);
    const tri = (pts, col) => outlined(ctx, () => { pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * u, y - py * u) : ctx.moveTo(x + px * u, y - py * u))); ctx.closePath(); }, col, lw);
    const puff = (px, py) => {
      for (let i = 0; i < 3; i++) {
        const t = (this.clock * 0.4 + i / 3) % 1;
        ctx.globalAlpha = 0.85 * (1 - t);
        blob(ctx, [[x + (px + t * 10) * u, y - (py + t * 18) * u, (2.5 + t * 5) * u]], '#f4f4f4', lw * 0.6, '#b8bfcc');
      }
      ctx.globalAlpha = 1;
    };
    if (type === 'farm') {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i % 2 ? '#f2c94c' : '#e3b04b';
        ctx.beginPath(); ctx.ellipse(x + (i - 1) * 30 * u, y + i * u, 26 * u, 5 * u, 0, 0, Math.PI * 2); ctx.fill();
      }
      R(-22, 0, 26, 16, '#d9534f');
      tri([[-25, 16], [7, 16], [-9, 27]], '#8e3b2f');
      R(-13, 0, 8, 10, '#fff1d6');
      R(8, 0, 9, 30, '#d0d6de', 1);
      outlined(ctx, () => ctx.arc(x + 12.5 * u, y - 30 * u, 4.5 * u, Math.PI, 0), '#9aa1aa', lw);
    } else if (type === 'foodplant' || type === 'sawmill') {
      const food = type === 'foodplant';
      R(14, 0, 6, 40, '#b0624a');
      puff(17, 40);
      R(-26, 0, 50, 20, food ? '#f3dfbd' : '#c8873e');
      for (let i = 0; i < 4; i++) tri([[-26 + i * 12.5, 20], [-26 + i * 12.5, 29], [-13.5 + i * 12.5, 20]], food ? '#5d8fd6' : '#8a5a35');
      for (let i = 0; i < 4; i++) {
        R(-22 + i * 11, 6, 6, 6, '#8fd3ff', 1);
        this.lights.push({ kind: 'win', x: x + (-22 + i * 11) * u, y: y - 12 * u, w: 6 * u, h: 6 * u });
      }
      if (food) { R(26, 0, 8, 18, '#e6ebf0', 3); R(36, 0, 8, 14, '#e6ebf0', 3); }
      else for (let i = 0; i < 5; i++) outlined(ctx, () => ctx.arc(x + (30 + (i % 3) * 5) * u, y - (3 + Math.floor(i / 3) * 5) * u, 3 * u, 0, Math.PI * 2), '#e9c48f', lw * 0.7);
    } else if (type === 'forest') {
      for (const [px, h] of [[-26, 40], [-16, 32], [32, 36]]) toonTree(ctx, x + px * u, y, h * u, 0, 1, 0);
      for (let i = 0; i < 6; i++) outlined(ctx, () => ctx.arc(x + (-6 + (i % 3) * 6) * u, y - (3 + Math.floor(i / 3) * 5) * u, 3.2 * u, 0, Math.PI * 2), '#e9c48f', lw * 0.7);
      R(10, 0, 14, 10, '#a8713f');
      tri([[8, 10], [26, 10], [17, 17]], '#e0594a');
    } else if (type === 'mine') {
      R(-26, 0, 16, 12, '#9aa1aa');
      tri([[-24, 12], [-8, 12], [-16, 17]], '#5d7fb8');
      ctx.strokeStyle = OL; ctx.lineWidth = Math.max(1.2, 2.4 * u);
      ctx.beginPath(); ctx.moveTo(x - 8 * u, y); ctx.lineTo(x, y - 34 * u); ctx.lineTo(x + 8 * u, y); ctx.moveTo(x - 4 * u, y - 17 * u); ctx.lineTo(x + 4 * u, y - 17 * u); ctx.stroke();
      outlined(ctx, () => ctx.arc(x, y - 34 * u, 5 * u, 0, Math.PI * 2), '#f5c542', lw);
      tri([[10, 0], [36, 0], [24, 14]], '#3a3340');
    } else if (type === 'power') {
      for (const cx of [-18, 4]) {
        outlined(ctx, () => {
          ctx.moveTo(x + (cx - 9) * u, y); ctx.quadraticCurveTo(x + (cx - 3) * u, y - 18 * u, x + (cx - 6) * u, y - 30 * u);
          ctx.lineTo(x + (cx + 6) * u, y - 30 * u); ctx.quadraticCurveTo(x + (cx + 3) * u, y - 18 * u, x + (cx + 9) * u, y); ctx.closePath();
        }, '#d0d6de', lw);
        puff(cx - 4, 30);
      }
      R(20, 0, 4, 46, '#f6f1e7'); R(20, 38, 4, 3, '#e74c3c'); R(20, 30, 4, 3, '#e74c3c');
      R(-32, 0, 12, 10, '#6c63ff', 1);
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
    const roll = moving ? Math.sin(this.clock * 0.9) * 0.0015 : 0;
    const shake = moving ? Math.sin(this.clock * 5) * 0.2 : 0;
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
    const fog = (z) => clamp((ZMAX * 1.05 - z) / (ZMAX * 0.3), 0, 1);
    if (tr && this.lastTr === tr && this.lastDir !== dir) this.fade = 1; // changing ends at a terminus
    this.lastTr = tr; this.lastDir = dir;

    // the line stops at a buffer just past each terminus
    const endS = route ? (dir > 0 ? L : 0) + (dir * 140) / k : Infinity;
    const maxAhead = Math.min(ZMAX / k, route ? (endS - d) * dir : Infinity);

    const win = { x: 14, y: 60, w: W - 28, h: dashTop - 60 + 30, r: 30 };
    ctx.save();
    ctx.beginPath(); ctx.roundRect(win.x, win.y, win.w, win.h, win.r); ctx.clip();
    ctx.save();
    ctx.translate(W / 2, hy); ctx.rotate(roll); ctx.translate(-W / 2, -hy + shake);
    this.drawSky(ctx, W, H, hy, light, phase);
    this.drawClouds(ctx, W, hy, 0, light);
    this.drawBirds(ctx, W, hy);
    // distant hills turn with the train's heading
    const hd = Math.atan2(fy, fx) * 700;
    this.drawRidge(ctx, W, hy + 2, hd, 0.003, Math.min(H * 0.18, 130), hy - 6, this.snowy(mixHex('#5a68b0', '#9fb8ea', light), 0.6), 11);
    this.drawRidge(ctx, W, hy + 2, hd * 1.6, 0.006, Math.min(H * 0.06, 40), hy, this.snowy(mixHex('#3f8a55', '#6fc463', light * 0.9), 0.85), 23);
    const gg = ctx.createLinearGradient(0, hy, 0, H);
    gg.addColorStop(0, this.snowy('#a6d97f')); gg.addColorStop(0.25, this.snowy('#6cbf4a', 0.9)); gg.addColorStop(1, this.snowy('#5aa83e', 0.85));
    ctx.fillStyle = gg; ctx.fillRect(-20, hy, W + 40, H - hy + 20);
    ctx.strokeStyle = 'rgba(43,33,64,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-20, hy); ctx.lineTo(W + 20, hy); ctx.stroke();

    const poly = (pts, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.fill();
    };
    const ground = (q, lat = 0, up = 0) => P(q.lat + lat, Math.max(q.z, NEAR), up);

    // lakes and the river, from the map: outline, bank, water, like the map
    if (route) {
      const world = this.g.world;
      const view = (q, r) => q.z + r > NEAR && q.z - r < ZMAX * 1.2 && Math.abs(q.lat) - r < (Math.max(q.z, NEAR) + r) * (W / F) + 200;
      const banks = [], waters = [];
      for (const blobs of world.lakes) {
        for (const b of blobs) {
          const q = loc(b.x, b.y), r = b.r * k;
          if (!view(q, r + 6 * k)) continue;
          const ring = (rr) => {
            const pts = [];
            for (let i = 0; i < 28; i++) {
              const t = (i / 28) * Math.PI * 2;
              pts.push(P(q.lat + Math.cos(t) * rr, Math.max(NEAR, q.z + Math.sin(t) * rr)));
            }
            return pts;
          };
          banks.push({ pts: ring(r + 5 * k), z: q.z }); waters.push({ pts: ring(r), z: q.z });
        }
      }
      const rv = world.river;
      for (let i = 0; i < rv.length - 1; i++) {
        const a = rv[i], b = rv[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y), ux = -(b.y - a.y) / len, uy = (b.x - a.x) / len;
        const quad = (hw, ext) => {
          const ex = ((b.x - a.x) / len) * ext, ey = ((b.y - a.y) / len) * ext;
          return [loc(a.x + ux * hw - ex, a.y + uy * hw - ey), loc(b.x + ux * hw + ex, b.y + uy * hw + ey), loc(b.x - ux * hw + ex, b.y - uy * hw + ey), loc(a.x - ux * hw - ex, a.y - uy * hw - ey)];
        };
        const qb = quad(8.5, 2), qw = quad(5.5, 1);
        if (qb.every((q) => q.z < NEAR) || qb.every((q) => q.z > ZMAX * 1.2)) continue;
        const z = Math.max(NEAR, Math.min(...qb.map((q) => q.z)));
        banks.push({ pts: qb.map((q) => ground(q)), z }); waters.push({ pts: qw.map((q) => ground(q)), z });
      }
      const pathOf = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
      ctx.lineJoin = 'round';
      for (const bk of banks) { ctx.globalAlpha = fog(bk.z); pathOf(bk.pts); ctx.strokeStyle = OL; ctx.lineWidth = 3; ctx.stroke(); }
      for (const bk of banks) { ctx.globalAlpha = fog(bk.z); pathOf(bk.pts); ctx.fillStyle = this.snowy('#ecd9a0'); ctx.fill(); }
      const iced = this.wx.cover > 0.6;
      for (const wt of waters) { ctx.globalAlpha = fog(wt.z); pathOf(wt.pts); ctx.fillStyle = iced ? '#cfe6f6' : '#4aa3e0'; ctx.fill(); }
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
        strip(-6, 6, '#b9bec4');
        ctx.strokeStyle = '#7a8087'; ctx.lineWidth = 2;
        for (const off of [-4, 4]) { ctx.beginPath(); cl.forEach((q, i) => { const p = P(q.lat + off, q.z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
      } else {
        strip(-11, 11, this.snowy('#c9b48f', 0.7));
        ctx.strokeStyle = OL; ctx.lineWidth = 2;
        for (const off of [-11, 11]) { ctx.beginPath(); cl.forEach((q, i) => { const p = P(q.lat + off, q.z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
        // sleepers about half their length apart, like real track
        const ts = 6 / k, TIE_Z = 1300;
        const sA = d + (dir * NEAR) / k, sB = d + dir * Math.min(maxAhead, TIE_Z / k);
        const ties = [];
        for (let i = Math.ceil(Math.min(sA, sB) / ts); i * ts <= Math.max(sA, sB); i++) ties.push(i * ts);
        if (dir > 0) ties.reverse();
        // batch the sleepers: close ones as outlined blocks, far ones as lines grouped by width and fade
        const near = new Path2D();
        let nearLw = 1;
        const far = new Map();
        for (const ts0 of ties) {
          const p = posAt(ts0), q = loc(p.x, p.y);
          if (q.z <= NEAR || q.z > TIE_Z) continue;
          const fade = Math.round(fog(q.z) * clamp((TIE_Z - q.z) / 500, 0, 1) * 4) / 4;
          if (fade <= 0) continue;
          const a = P(q.lat - 8.5, q.z), b = P(q.lat + 8.5, q.z);
          if (a.s > 0.9) {
            const c = P(q.lat + 8.5, q.z + 2.4), e = P(q.lat - 8.5, q.z + 2.4);
            near.moveTo(a.x, a.y); near.lineTo(b.x, b.y); near.lineTo(c.x, c.y); near.lineTo(e.x, e.y); near.closePath();
            nearLw = Math.max(nearLw, clamp(a.s * 0.35, 0.8, 1.6));
          } else {
            const key = `${Math.max(0.5, Math.round(a.s * 2) / 2)}|${fade}`;
            let path = far.get(key);
            if (!path) far.set(key, (path = new Path2D()));
            path.moveTo(a.x, a.y); path.lineTo(b.x, b.y);
          }
        }
        ctx.strokeStyle = '#8a5a35';
        for (const [key, path] of far) {
          const [lw, fade] = key.split('|').map(Number);
          ctx.globalAlpha = fade; ctx.lineWidth = lw; ctx.stroke(path);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#9a6a42'; ctx.fill(near);
        ctx.strokeStyle = OL; ctx.lineWidth = nearLw; ctx.stroke(near);
        ctx.globalAlpha = 1;
        ctx.lineCap = 'round';
        // rails: outlined, thicker up close; segments grouped by width so they draw in a few strokes
        for (const [col, extra] of [[OL, 2.4], ['#e3e7ec', 0]]) {
          ctx.strokeStyle = col;
          const groups = new Map();
          for (const off of [-6, 6]) {
            for (let i = cl.length - 1; i > 0; i--) {
              const a = P(cl[i].lat + off, cl[i].z), b = P(cl[i - 1].lat + off, cl[i - 1].z);
              const lw = Math.round((Math.max(0.6, b.s * 0.55) + extra * Math.min(1, b.s)) * 3) / 3;
              let path = groups.get(lw);
              if (!path) groups.set(lw, (path = new Path2D()));
              path.moveTo(a.x, a.y); path.lineTo(b.x, b.y);
            }
          }
          for (const [lw, path] of groups) { ctx.lineWidth = lw; ctx.stroke(path); }
        }
        // a few tufts and flowers beside the line, fixed to the ground
        const tsp = 30 / k;
        for (let i = Math.floor(Math.max(sA, sB) / tsp); i * tsp >= Math.min(sA, sB); i--) {
          const j = dir > 0 ? i : Math.floor(Math.max(sA, sB) / tsp) + Math.floor(Math.min(sA, sB) / tsp) - i;
          if (hash(j, 41) < 0.55) continue;
          const p = posAt(j * tsp), q = loc(p.x, p.y);
          if (q.z <= NEAR || q.z > 900) continue;
          const side = hash(j, 42) < 0.5 ? -1 : 1, lat = q.lat + side * (15 + hash(j, 43) * 60);
          const g = P(lat, q.z), h = 6 * g.s;
          if (h < 2) continue;
          if (hash(j, 44) < 0.3 && this.wx.cover < 0.4) {
            outlined(ctx, () => ctx.arc(g.x, g.y - h * 0.4, h * 0.35, 0, Math.PI * 2), ['#ffd84a', '#ff8fa3', '#fff6d8'][j % 3], 1);
          } else {
            outlined(ctx, () => { ctx.moveTo(g.x - h * 0.5, g.y); ctx.lineTo(g.x - h * 0.2, g.y - h); ctx.lineTo(g.x, g.y - h * 0.35); ctx.lineTo(g.x + h * 0.25, g.y - h * 0.9); ctx.lineTo(g.x + h * 0.5, g.y); ctx.closePath(); }, this.snowy('#3f9a3a', 0.5), 1);
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
            const kerb = part.map((q) => P(q.lat + side * 12, q.z, 1.5));
            poly([...kerb, ...part.map((q) => P(q.lat + side * 12, q.z, -2)).reverse()], '#4d535b');
            ctx.strokeStyle = '#3a3f45';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); part.forEach((q, i) => { const p = P(q.lat + side * 12, q.z, 7); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
            for (const q of part) {
              const a = P(q.lat + side * 12, q.z, 1.5), b = P(q.lat + side * 12, q.z, 7);
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
        const inner = pts.map((q) => P(q.lat + sgn * 11, q.z, 5)), outer = pts.map((q) => P(q.lat + sgn * 34, q.z, 5)).reverse();
        ctx.globalAlpha = fog(pts[0].z);
        poly([...inner, ...outer], '#b3a898');
        poly([...pts.map((q) => P(q.lat + sgn * 11, q.z, 0)), ...inner.slice().reverse()], '#8a8072');
        ctx.strokeStyle = '#e2dccb'; ctx.lineWidth = 1.5;
        ctx.beginPath(); inner.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const at = (s, lat, up = 0) => { const p = posAt(s), q = loc(p.x, p.y); return { q, z: q.z, lat: q.lat + lat, up }; };
      items.push({ ...at(st.e - (st.toward * 210) / k, sgn * 44), kind: 'building', sgn, st });
      for (const s of [st.e + (st.toward * 100) / k, st.e - (st.toward * 300) / k]) items.push({ ...at(s, sgn * 20), kind: 'board', name: st.name });
      for (let j = 0; j < 4; j++) items.push({ ...at(s0 + ((s1 - s0) * (j + 0.5)) / 4, sgn * 30), kind: 'lamp' });
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
        items.push({ z: q.z, lat: q.lat + dir * 19, kind: 'pole', q, qn: hasNext ? qn : { z: -1 }, side: dir });
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
        this.drawTreeAt(ctx, b.x, b.y, (4.5 + it.t.size * 1.7) * k * b.s, it.t.c, (it.t.x * 73 + it.t.y * 19) | 0);
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
        ctx.lineCap = 'round';
        ctx.strokeStyle = OL; ctx.lineWidth = Math.max(1, b.s * 0.9) + 2;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        ctx.strokeStyle = '#a8713f'; ctx.lineWidth = Math.max(1, b.s * 0.9); ctx.stroke();
        if (it.qn.z > NEAR) {
          if (electric) {
            const arm = P(it.q.lat - it.side * 2, it.z, 48);
            ctx.lineWidth = Math.max(1, b.s * 0.4);
            ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(arm.x, arm.y); ctx.stroke();
            const w1 = P(it.q.lat, it.z, 46), w2 = P(it.qn.lat, it.qn.z, 46);
            ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(w1.x, w1.y); ctx.lineTo(w2.x, w2.y); ctx.stroke();
          } else {
            const nl = it.qn.lat + it.side * 19;
            const w1 = P(it.lat, it.z, 42), w2 = P(nl, it.qn.z, 42), m = P((it.lat + nl) / 2, (it.z + it.qn.z) / 2, 36);
            ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(w1.x, w1.y); ctx.quadraticCurveTo(m.x, m.y, w2.x, w2.y); ctx.stroke();
          }
        }
      } else if (it.kind === 'building') {
        const b = P(it.lat, it.z), s = b.s;
        const w = 80 * s, h = 26 * s;
        const lw = clamp(s * 0.6, 0.8, 2.5);
        outlined(ctx, () => ctx.rect(b.x - w / 2, b.y - h - 5 * s, w, h), '#f3dfbd', lw);
        outlined(ctx, () => { ctx.moveTo(b.x - w * 0.56, b.y - h - 5 * s); ctx.lineTo(b.x, b.y - h - 22 * s); ctx.lineTo(b.x + w * 0.56, b.y - h - 5 * s); ctx.closePath(); }, '#e0594a', lw);
        for (const wx of [-0.35, 0.2]) {
          outlined(ctx, () => ctx.rect(b.x + wx * w, b.y - h * 0.8, w * 0.14, h * 0.4), '#8fd3ff', lw * 0.7);
          this.lights.push({ kind: 'win', x: b.x + wx * w, y: b.y - h * 0.8, w: w * 0.14, h: h * 0.4 });
        }
        outlined(ctx, () => ctx.rect(b.x - w * 0.06, b.y - h * 0.6 - 5 * s, w * 0.12, h * 0.6), '#8a5a35', lw * 0.7);
      } else if (it.kind === 'board') {
        const nb = P(it.lat, it.z, 20), fs = nb.s * 4;
        if (fs < 5) continue;
        const b = P(it.lat, it.z, 5);
        ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(1, nb.s * 0.3);
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(nb.x, nb.y); ctx.stroke();
        ctx.font = `700 ${Math.min(28, fs)}px system-ui, sans-serif`;
        const tw = ctx.measureText(it.name).width + fs;
        glossyRect(ctx, nb.x - tw / 2, nb.y - fs * 0.8, tw, fs * 1.4, fs * 0.35, '#2d6cdf', { lw: clamp(fs * 0.12, 1, 2.5) });
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(it.name, nb.x, nb.y - fs * 0.1);
      } else if (it.kind === 'lamp') {
        const b = P(it.lat, it.z, 5), t = P(it.lat, it.z, 26);
        ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(1, b.s * 0.3);
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        this.lights.push({ kind: 'lamp', x: t.x, y: t.y, r: Math.max(6, t.s * 6) });
      } else if (it.kind === 'buffer') {
        const l = P(it.lat - 8.5, it.z, 4), r = P(it.lat + 8.5, it.z, 10);
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
      outlined(ctx, () => { ctx.moveTo(W / 2 - 7, by + 2); ctx.lineTo(W / 2 - 8, by - 18); ctx.lineTo(W / 2 - 12, by - 24); ctx.lineTo(W / 2 + 12, by - 24); ctx.lineTo(W / 2 + 8, by - 18); ctx.lineTo(W / 2 + 7, by + 2); ctx.closePath(); }, '#3a3340', 2.5);
      glossy(ctx, () => {
        ctx.moveTo(W / 2 - bw / 2, dashTop + 10); ctx.lineTo(W / 2 - tw / 2, by + 12);
        ctx.quadraticCurveTo(W / 2, by - 8, W / 2 + tw / 2, by + 12); ctx.lineTo(W / 2 + bw / 2, dashTop + 10); ctx.closePath();
      }, { x: W / 2 - bw / 2, y: by - 8, w: bw, h: dashTop + 18 - by }, cur ? cur.line.color : '#e4572e', { lw: 3 });
      ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(W / 2 - tw * 0.62, by + 40); ctx.quadraticCurveTo(W / 2, by + 26, W / 2 + tw * 0.62, by + 40); ctx.stroke();
      outlined(ctx, () => ctx.ellipse(W / 2, by + 20, 12, 8, 0, Math.PI, 0), '#f5c542', 2);
      this.stack = { x: W / 2, y: by - 24, kind: 'steam' };
    } else {
      const col = cur ? cur.line.color : '#e4572e';
      const bump = style === 'hs' || style === 'maglev' ? 40 : 18;
      glossy(ctx, () => { ctx.moveTo(W * 0.08, dashTop + 10); ctx.quadraticCurveTo(W / 2, dashTop - bump, W * 0.92, dashTop + 10); ctx.closePath(); },
        { x: W * 0.08, y: dashTop - bump / 2, w: W * 0.84, h: bump / 2 + 10 }, style === 'maglev' ? '#f2f5f8' : col, { lw: 3, belly: 0 });
    }
    this.updateSmoke(ctx, dt, style, true);
    this.precip3D(ctx, dt, P, ZMAX, NEAR);
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

    const screen = [{ x: win.x, y: win.y, w: win.w, h: dashTop - win.y }];
    this.glassDrops(ctx, dt, screen, 0, true);
    if (!steam) this.wiper(ctx, dt, W, dashTop);
    ctx.restore(); // windscreen clip
    this.drawCabFrame(ctx, W, H, dashTop, S, steam, win);
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

  drawCabFrame(ctx, W, H, dashTop, S, steam, win) {
    const { cur, model, remaining, light, dt } = S;
    const style = model.style;
    const theme = steam
      ? { wall: '#8a5636', plank: '#74462b', trim: '#e8b23f', dash: '#5a3a28', dashHi: '#7a4f36' }
      : style === 'diesel' || style === 'electric'
        ? { wall: '#d3d8e0', plank: '#c3c9d3', trim: '#5b6372', dash: '#3f4656', dashHi: '#566077' }
        : { wall: '#eef1f5', plank: '#e1e6ec', trim: '#4a5262', dash: '#2f3646', dashHi: '#46506a' };
    const hole = () => ctx.roundRect(win.x, win.y, win.w, win.h, win.r);

    // snow piling up in the windscreen corners
    const sn = this.wx ? this.wx.cover : 0;
    if (sn > 0.1) {
      const by = dashTop + 6, rr = 18 + sn * 22;
      blob(ctx, [[win.x + 10, by, rr], [win.x + rr * 1.3, by + 6, rr * 0.8]], '#fbfdff', 1.5);
      blob(ctx, [[win.x + win.w - 10, by, rr], [win.x + win.w - rr * 1.3, by + 6, rr * 0.8]], '#fbfdff', 1.5);
    }

    // cab wall with the window cut out
    ctx.beginPath(); ctx.rect(-10, -10, W + 20, H + 20); hole();
    ctx.fillStyle = theme.wall; ctx.fill('evenodd');
    ctx.save();
    ctx.beginPath(); ctx.rect(-10, -10, W + 20, H + 20); hole(); ctx.clip('evenodd');
    ctx.strokeStyle = theme.plank; ctx.lineWidth = 3;
    if (steam) { for (let y = 12; y < dashTop; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } }
    else { ctx.beginPath(); ctx.moveTo(0, win.y - 14); ctx.lineTo(W, win.y - 14); ctx.stroke(); }
    ctx.restore();
    // chunky window frame
    ctx.beginPath(); hole();
    ctx.strokeStyle = OL; ctx.lineWidth = 14; ctx.stroke();
    ctx.strokeStyle = theme.trim; ctx.lineWidth = 8; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(win.x + 2, win.y + 2, win.w - 4, win.h - 4, win.r - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.stroke();
    if (steam) {
      ctx.fillStyle = '#f5c542';
      for (let x = win.x + 26; x < win.x + win.w - 20; x += 46) {
        outlined(ctx, () => ctx.arc(x, win.y - 1, 2.6, 0, Math.PI * 2), '#f5c542', 1);
      }
    }

    this.drawCharm(ctx, W, win, dt, cur);

    // dashboard
    const curve = () => { ctx.moveTo(-4, dashTop + 14); ctx.quadraticCurveTo(W / 2, dashTop - 8, W + 4, dashTop + 14); ctx.lineTo(W + 4, H + 4); ctx.lineTo(-4, H + 4); ctx.closePath(); };
    const dg = ctx.createLinearGradient(0, dashTop, 0, H);
    dg.addColorStop(0, theme.dashHi); dg.addColorStop(0.25, theme.dash); dg.addColorStop(1, shade(theme.dash, -0.35));
    ctx.beginPath(); curve(); ctx.fillStyle = dg; ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, dashTop + 18); ctx.quadraticCurveTo(W / 2, dashTop - 2, W - 10, dashTop + 18); ctx.stroke();
    if (steam) { ctx.strokeStyle = theme.trim; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-4, dashTop + 24); ctx.quadraticCurveTo(W / 2, dashTop + 2, W + 4, dashTop + 24); ctx.stroke(); }

    const tr = cur ? cur.tr : null;
    const moving = tr && tr.wait <= 0;
    const kmh = moving ? tr.v * 4.5 : 0;
    const maxKmh = Math.ceil((model.speed * 1.4 * 4.5) / 20) * 20;
    const r = Math.min(44, W * 0.105, (H - dashTop) * 0.28);
    const gy = dashTop + r + 24;
    const gx1 = W - r - 22, gx2 = gx1 - r * 2 - 20;
    this.pressure = lerp(this.pressure ?? 0.6, 0.55 + (tr ? tr.boost : 0) * 0.7 + Math.sin(this.clock * 0.7) * 0.03, 0.05);
    this.gauge(ctx, gx1, gy, r, kmh / maxKmh, steam, `${Math.round(kmh)}`, 'km/h');
    if (steam) this.gauge(ctx, gx2, gy, r, this.pressure, true, '', 'PSI');
    else this.gauge(ctx, gx2, gy, r, moving ? clamp(0.25 + (tr.v / model.speed) * 0.5 + tr.boost, 0, 1) : 0.05, false, '', 'kW');

    const lw = Math.min(140, Math.max(90, gx2 - r - 44));
    const lx = Math.max(16, gx2 - r - 22 - lw);
    if (steam) {
      // regulator lever with a red knob, and the firebox glowing below
      const ang = -0.9 + (moving ? 0.6 + (tr.boost || 0) : 0);
      const px = lx + 34, py = gy + r * 0.55;
      ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
      outlined(ctx, () => ctx.roundRect(-4, -r * 1.35, 8, r * 1.35, 4), '#e8b23f', 2);
      outlined(ctx, () => ctx.arc(0, -r * 1.35, 8, 0, Math.PI * 2), '#e74c3c', 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(-2.5, -r * 1.35 - 2.5, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      outlined(ctx, () => ctx.arc(px, py, 10, 0, Math.PI * 2), '#e8b23f', 2);
      const fbx = lx + 60, fbw = Math.max(40, gx2 - r - fbx - 14), fby = gy - r * 0.35;
      const flick = 0.75 + 0.25 * Math.sin(this.clock * 9) * Math.sin(this.clock * 5.3);
      outlined(ctx, () => ctx.roundRect(fbx, fby, fbw, r * 1.05, 10), '#3a3340', 2.5);
      const fg = ctx.createRadialGradient(fbx + fbw / 2, fby + r * 0.7, 2, fbx + fbw / 2, fby + r * 0.6, fbw * 0.6);
      fg.addColorStop(0, `rgba(255,230,120,${flick})`); fg.addColorStop(0.5, `rgba(255,140,40,${flick * 0.9})`); fg.addColorStop(1, 'rgba(200,60,20,0.6)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.roundRect(fbx + 6, fby + 6, fbw - 12, r * 1.05 - 12, 6); ctx.fill();
      ctx.strokeStyle = OL; ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) { const bx = fbx + 6 + ((fbw - 12) * i) / 4; ctx.beginPath(); ctx.moveTo(bx, fby + 6); ctx.lineTo(bx, fby + r * 1.05 - 6); ctx.stroke(); }
      if (this.whistle) {
        outlined(ctx, () => ctx.arc(lx + 12, gy - r * 0.8, 6, 0, Math.PI * 2), '#ffd84a', 2);
      }
    } else {
      // route screen and a row of buttons
      const sh = r * 1.3, sy = gy - sh / 2 - 6;
      glossy(ctx, () => ctx.roundRect(lx, sy, lw, sh, 10), { x: lx, y: sy, w: lw, h: sh }, '#10251d', { lw: 2.5, belly: 0 });
      const info = this.info;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#5fe0a8'; ctx.font = '800 11px ui-rounded, system-ui, sans-serif';
      ctx.fillText('NEXT', lx + 10, sy + 8);
      ctx.fillStyle = '#e6fff4'; ctx.font = '800 14px ui-rounded, system-ui, sans-serif';
      const name = info ? info.toName : '—';
      ctx.fillText(name.length > 13 ? name.slice(0, 12) + '…' : name, lx + 10, sy + 23);
      ctx.fillStyle = '#5fe0a8'; ctx.font = '700 12px ui-rounded, system-ui, sans-serif';
      ctx.fillText(info ? `${(Math.max(0, remaining) / 10).toFixed(1)} km` : '', lx + 10, sy + 41);
      const cols = ['#e74c3c', '#ffd84a', '#4cd964', '#3fa9f0'];
      for (let i = 0; i < 4; i++) {
        const bx = lx + 12 + i * ((lw - 24) / 3), by = sy + sh + 14;
        const lit = this.whistle && i === 1 ? true : Math.floor(this.clock * 1.5 + i * 1.7) % 4 === i;
        outlined(ctx, () => ctx.arc(bx, by, 6.5, 0, Math.PI * 2), lit ? cols[i] : shade(cols[i], -0.5), 2);
        if (lit) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(bx - 2, by - 2, 2, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    const night = 1 - light;
    if (night > 0.3) {
      ctx.fillStyle = `rgba(255,190,110,${(night - 0.3) * 0.12})`;
      ctx.fillRect(0, dashTop, W, H - dashTop);
    }
  }

  // A little charm hanging in the windscreen, swinging with the train (tap to jiggle it).
  drawCharm(ctx, W, win, dt, cur) {
    this.charmA = this.charmA || 0; this.charmV = this.charmV || 0;
    const dv = this.vis - (this.lastVis ?? this.vis);
    this.lastVis = this.vis;
    const bump = this.vis > 5 ? (Math.random() - 0.5) * 2.2 : 0;
    this.charmV += (-9 * Math.sin(this.charmA) - 0.9 * this.charmV + dv * 0.04 + bump) * Math.min(dt, 0.05);
    this.charmA += this.charmV * Math.min(dt, 0.05);
    const ax = win.x + win.w * 0.74, ay = win.y + 4, len = 46;
    const ex = ax + Math.sin(this.charmA) * len, ey = ay + Math.cos(this.charmA) * len;
    ctx.strokeStyle = OL; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke();
    outlined(ctx, () => ctx.arc(ax, ay, 4, 0, Math.PI * 2), '#9aa1aa', 1.5);
    // a glossy star in the line colour
    const col = cur ? cur.line.color : '#ffd84a';
    ctx.save(); ctx.translate(ex, ey + 9); ctx.rotate(this.charmA * 0.8);
    outlined(ctx, () => {
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? 4.5 : 11, a = -Math.PI / 2 + (i * Math.PI) / 5;
        i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
    }, col, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(-3, -4, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  gauge(ctx, x, y, r, frac, brass, text, unit) {
    outlined(ctx, () => ctx.arc(x, y, r + 5, 0, Math.PI * 2), brass ? '#f5c542' : '#6d7480', 3);
    outlined(ctx, () => ctx.arc(x, y, r, 0, Math.PI * 2), brass ? '#fffbe8' : '#16202a', 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.25, y - r * 0.45, r * 0.55, r * 0.25, -0.3, 0, Math.PI * 2); ctx.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.strokeStyle = brass ? '#333' : '#9aa3ad'; ctx.lineWidth = 1.5;
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * (i / 10), r2 = i % 5 ? r * 0.84 : r * 0.76;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2); ctx.stroke();
    }
    const a = a0 + (a1 - a0) * clamp(frac, 0, 1);
    ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = brass ? '#333' : '#d9e0e6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (text) { ctx.font = `700 ${Math.round(r * 0.32)}px system-ui, sans-serif`; ctx.fillText(text, x, y + r * 0.38); }
    ctx.font = `600 ${Math.round(r * 0.2)}px system-ui, sans-serif`; ctx.fillText(unit, x, y + r * 0.66);
  }

  drawSky(ctx, W, H, gy, light, phase) {
    const top = mix('#101a52', '#3fa9f0', light);
    const bot = mix('#2b3a86', '#bfe8ff', light);
    const gr = ctx.createLinearGradient(0, 0, 0, gy);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, gy);
    const wet = this.overcast();
    if (wet > 0) { ctx.fillStyle = `rgba(${light > 0.5 ? '128,138,158' : '40,46,70'},${wet * 0.6})`; ctx.fillRect(0, 0, W, gy); }
    const dusk = Math.max(0, 1 - Math.abs(light - 0.45) * 3.2) * (1 - wet);
    if (dusk > 0) {
      const g2 = ctx.createLinearGradient(0, gy * 0.35, 0, gy);
      g2.addColorStop(0, 'rgba(255,130,110,0)');
      g2.addColorStop(1, `rgba(255,150,100,${dusk * 0.55})`);
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, gy);
    }
    if (light < 0.6) {
      // twinkling stars, a few of them sparkle
      for (let i = 0; i < 80; i++) {
        const x = hash(i, 3) * W, y = hash(i, 4) * gy * 0.8;
        const tw = 0.5 + 0.5 * Math.sin(this.clock * (0.6 + hash(i, 5)) + i);
        ctx.globalAlpha = (0.6 - light) * 1.6 * (0.4 + 0.6 * tw) * (1 - wet);
        ctx.fillStyle = '#fff';
        if (hash(i, 6) > 0.85) {
          const r = 2 + tw * 2.5;
          ctx.beginPath();
          ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.25, y - r * 0.25); ctx.lineTo(x + r, y); ctx.lineTo(x + r * 0.25, y + r * 0.25);
          ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.25, y + r * 0.25); ctx.lineTo(x - r, y); ctx.lineTo(x - r * 0.25, y - r * 0.25);
          ctx.fill();
        } else ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    const ang = phase * Math.PI * 2;
    const cx = W / 2, rx = W * 0.6, ry = gy * 0.85;
    const sx = cx - Math.sin(ang) * rx, sy = gy - Math.cos(ang) * ry;
    ctx.globalAlpha = 1 - wet * 0.85;
    if (sy < gy) {
      ctx.fillStyle = 'rgba(255,236,150,0.25)';
      ctx.beginPath(); ctx.arc(sx, sy, 36, 0, Math.PI * 2); ctx.fill();
      outlined(ctx, () => ctx.arc(sx, sy, 20, 0, Math.PI * 2), '#ffd84a', 2.5);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(sx - 6, sy - 6, 6, 0, Math.PI * 2); ctx.fill();
    }
    const mx = cx + Math.sin(ang) * rx, my = gy + Math.cos(ang) * ry;
    if (my < gy) {
      ctx.fillStyle = '#f4f1d0';
      ctx.beginPath(); ctx.arc(mx, my, 15, Math.PI * 0.35, Math.PI * 1.65); ctx.arc(mx + 7, my, 12, Math.PI * 1.55, Math.PI * 0.45, true); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Rain streaks or snowflakes in screen space (trackside and passenger views).
  precipScreen(ctx, dt, W, top, bottom, ground) {
    const w = this.wx, snow = w.snow > 0, amt = Math.max(w.rain, w.snow);
    const P = this.drops || (this.drops = []);
    if (this.dropsSnow !== snow) { P.length = 0; this.dropsSnow = snow; }
    const drift = -this.vis * (snow ? 0.55 : 0.3) - (snow ? 8 : 50);
    this.dropAcc = (this.dropAcc || 0) + amt * (snow ? 70 : 240) * (W / 400) * dt;
    while (this.dropAcc > 1 && P.length < 600) {
      this.dropAcc--;
      const vy = snow ? 40 + Math.random() * 45 : 620 + Math.random() * 260;
      // spawn upwind so the slant still fills the screen
      const reach = (-drift * ((bottom - top) / vy));
      P.push({ x: Math.random() * (W + reach + 40) - 20, y: top - 10, vy, r: 1.6 + Math.random() * 2.6, ph: Math.random() * 6 });
    }
    this.splashes = this.splashes || [];
    if (!snow) {
      const k = 0.024;
      ctx.strokeStyle = 'rgba(214,230,255,0.65)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const p of P) {
        p.y += p.vy * dt; p.x += drift * dt;
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - drift * k, p.y - p.vy * k);
        if (ground && p.y > ground && this.splashes.length < 60) this.splashes.push({ x: p.x, y: ground + Math.random() * 30, t: 0 });
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      for (const p of P) {
        p.y += p.vy * dt; p.x += (drift + Math.sin(this.clock * 1.6 + p.ph) * 22) * dt;
        ctx.moveTo(p.x + p.r, p.y); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      }
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = 'rgba(120,132,170,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    }
    const end = ground && !snow ? ground : bottom;
    for (let i = P.length - 1; i >= 0; i--) if (P[i].y > end + (snow ? 0 : 30) || P[i].x < -40) P.splice(i, 1);
    // little splash rings where the rain lands
    if (this.splashes.length) {
      ctx.strokeStyle = 'rgba(225,238,255,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const sp of this.splashes) {
        sp.t += dt; sp.x -= this.vis * dt; // splashes stay put on the passing ground
        const r = 2 + sp.t * 18;
        ctx.moveTo(sp.x + r, sp.y); ctx.ellipse(sp.x, sp.y, r, r * 0.35, 0, 0, Math.PI * 2);
      }
      ctx.stroke();
      this.splashes = this.splashes.filter((sp) => sp.t < 0.3);
    }
  }

  // Rain or snow flying at the driver, in the cab's perspective.
  precip3D(ctx, dt, P, zmax, near) {
    const w = this.wx, snow = w.snow > 0, amt = Math.max(w.rain, w.snow);
    const Q = this.drops3 || (this.drops3 = []);
    if (this.drops3Snow !== snow) { Q.length = 0; this.drops3Snow = snow; }
    const target = Math.round(amt * (snow ? 260 : 300));
    const spawn = (p, far) => {
      p.lat = (Math.random() - 0.5) * 700; p.up = far ? 20 + Math.random() * 90 : Math.random() * 110;
      p.z = near + 30 + Math.random() * zmax * (far ? 0.5 : 0.45); p.ph = Math.random() * 6;
      return p;
    };
    while (Q.length < target) Q.push(spawn({}, false));
    if (Q.length > target) Q.length = target;
    const speed = this.vis, fall = snow ? 26 : 260;
    if (!snow) {
      ctx.strokeStyle = 'rgba(214,230,255,0.6)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      ctx.beginPath();
    }
    const flakes = [];
    for (const p of Q) {
      p.z -= speed * dt; p.up -= fall * dt;
      if (snow) p.lat += Math.sin(this.clock * 1.4 + p.ph) * 14 * dt;
      if (p.z < near || p.up < 0) spawn(p, true);
      const a = P(p.lat, p.z, p.up);
      if (!snow) {
        const b = P(p.lat, p.z + speed * 0.035 + 4, p.up + fall * 0.035);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      } else flakes.push(a);
    }
    if (!snow) { ctx.stroke(); return; }
    ctx.beginPath();
    for (const a of flakes) { const r = clamp(a.s * 0.9, 1, 6); ctx.moveTo(a.x + r, a.y); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); }
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = 'rgba(120,132,170,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // Drops (or flakes) on the window glass. In the cab they are swept by the wiper.
  glassDrops(ctx, dt, wins, sway, cab) {
    const w = this.wx, snow = w.snow > 0, amt = Math.max(w.rain, w.snow);
    const G = cab ? (this.glassCab || (this.glassCab = [])) : (this.glass || (this.glass = []));
    const moving = this.vis > 5;
    this[cab ? 'gAccC' : 'gAcc'] = (this[cab ? 'gAccC' : 'gAcc'] || 0) + amt * (snow ? 5 : 12) * dt;
    while (this[cab ? 'gAccC' : 'gAcc'] > 1 && G.length < 90) {
      this[cab ? 'gAccC' : 'gAcc']--;
      const win = wins[Math.floor(Math.random() * wins.length)];
      G.push({ x: win.x + Math.random() * win.w, y: win.y + Math.random() * win.h * (cab ? 0.85 : 1), r: 1.6 + Math.random() * 2.6, t: 0, win, snow });
    }
    const inside = (d) => d.x > d.win.x + 4 && d.x < d.win.x + d.win.w - 4 && d.y > d.win.y + 4 && d.y < d.win.y + d.win.h - 4;
    for (let i = G.length - 1; i >= 0; i--) {
      const d = G[i];
      d.t += dt;
      if (!d.snow) {
        if (cab) { d.y -= (moving ? this.vis * 0.02 : -(d.r > 3 ? 14 : 2)) * dt; d.x += (d.x - d.win.w / 2) * (moving ? 0.15 : 0) * dt; }
        else if (moving) { d.x -= (this.vis * 0.07 + 8) * dt; d.y += 3 * dt; }
        else d.y += (d.r > 3 ? 18 : 2) * dt;
      }
      if (!inside(d) || d.t > (d.snow ? 5 : 9)) G.splice(i, 1);
    }
    ctx.save();
    ctx.translate(0, sway);
    for (const d of G) {
      if (d.snow) {
        ctx.globalAlpha = Math.max(0, 1 - d.t / 5);
        outlined(ctx, () => ctx.arc(d.x, d.y, d.r * 1.1, 0, Math.PI * 2), '#ffffff', 0.8);
        continue;
      }
      // a short trail, then the drop with a highlight
      // trail points back the way the drop has run
      const tx = !cab && moving ? 10 + this.vis * 0.04 : 0;
      const ty = cab ? (moving ? 6 : -6) : moving ? 0 : -8;
      ctx.strokeStyle = 'rgba(230,242,255,0.35)'; ctx.lineWidth = d.r * 0.9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + tx, d.y + ty); ctx.stroke();
      ctx.fillStyle = 'rgba(210,228,250,0.45)';
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(d.x - d.r * 0.35, d.y - d.r * 0.35, d.r * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // A windscreen wiper that sweeps while it's raining and clears the drops it passes.
  wiper(ctx, dt, W, dashTop) {
    const w = this.wx, on = w.rain > 0.12 || w.snow > 0.3;
    if (!on && !this.wipeRunning) return;
    const prev = this.wipePhase || 0;
    this.wipePhase = prev + dt * 2.4;
    const cyc = (t) => 0.5 - 0.5 * Math.cos(t);
    // stop neatly at rest once the weather clears
    this.wipeRunning = on || (this.wipePhase % (Math.PI * 2)) > 0.15;
    if (!this.wipeRunning) this.wipePhase = 0;
    const len = Math.min(W * 0.52, dashTop * 0.62);
    const px = W * 0.5, py = dashTop + 4;
    const a0 = Math.PI * (1.04 + cyc(prev) * 0.92), a1 = Math.PI * (1.04 + cyc(this.wipePhase) * 0.92);
    const lo = Math.min(a0, a1) - 0.03, hi = Math.max(a0, a1) + 0.03;
    if (this.glassCab) {
      this.glassCab = this.glassCab.filter((d) => {
        const ang = Math.atan2(d.y - py, d.x - px) + Math.PI * 2;
        const dist = Math.hypot(d.x - px, d.y - py);
        return !(dist < len + 6 && dist > len * 0.2 && ang >= lo && ang <= hi);
      });
    }
    const ex = px + Math.cos(a1) * len, ey = py + Math.sin(a1) * len;
    ctx.lineCap = 'round';
    ctx.strokeStyle = OL; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = '#4a4f5c'; ctx.lineWidth = 3.5; ctx.stroke();
    const bx = px + Math.cos(a1) * len * 0.35, by = py + Math.sin(a1) * len * 0.35;
    ctx.strokeStyle = OL; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = '#1f1a26'; ctx.lineWidth = 2.5; ctx.stroke();
    outlined(ctx, () => ctx.arc(px, py, 6, 0, Math.PI * 2), '#6d7480', 2);
  }

  // How grey the sky is (0..1), fading in ahead of the rain or snow itself.
  overcast() {
    const w = this.wx;
    return w ? Math.min(1, Math.max(w.rain, w.snow) * 1.3) : 0;
  }

  // Ground colours whiten as snow settles.
  snowy(hex, amt = 1) { return this.wx && this.wx.cover > 0 ? mixHex(hex, '#f2f6fc', this.wx.cover * amt) : hex; }

  drawClouds(ctx, W, gy, sc, light) {
    const span = W + 400;
    const wet = this.overcast();
    const fill = mixHex(mixHex('#4a5aa8', '#ffffff', light), mixHex('#3a4160', '#a3abba', light), wet);
    const rim = mixHex(mixHex('#2e3b80', '#9fcdf2', light), mixHex('#262b40', '#7a8496', light), wet);
    for (let i = 0; i < 7 + Math.round(wet * 7); i++) {
      const speed = 4 + hash(i, 12) * 6;
      const x = ((((hash(i, 11) * span - this.clock * speed - sc * 0.015 * (1 + hash(i, 14))) % span) + span) % span) - 200;
      const y = gy * (0.1 + hash(i, 13) * 0.42);
      toonCloud(ctx, x, y, 0.7 + hash(i, 15) * 0.8, fill, rim);
    }
  }

  drawBirds(ctx, W, gy) {
    const period = 70, t = this.clock % period, dur = 26;
    if (t > dur) return;
    const k = Math.floor(this.clock / period);
    const x0 = W + 60 - (t / dur) * (W + 200);
    const y0 = gy * (0.2 + hash(k, 21) * 0.3) + Math.sin(t * 0.6) * 10;
    ctx.strokeStyle = OL; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const bx = x0 + Math.abs(i - 2) * 16 + i * 4, by = y0 + Math.abs(i - 2) * 9;
      const f = Math.sin(this.clock * 8 + i) * 4;
      ctx.beginPath(); ctx.moveTo(bx - 7, by - f); ctx.quadraticCurveTo(bx - 3, by - 3, bx, by); ctx.quadraticCurveTo(bx + 3, by - 3, bx + 7, by - f); ctx.stroke();
    }
  }

  drawRidge(ctx, W, gy, off, freq, amp, base, color, seed) {
    ctx.beginPath();
    ctx.moveTo(-4, gy + 4);
    for (let x = -4; x <= W + 8; x += 6) {
      const wx = x + off;
      ctx.lineTo(x, base - noise1(wx * freq, seed) * amp - noise1(wx * freq * 3.1, seed + 1) * amp * 0.22);
    }
    ctx.lineTo(W + 8, gy + 4); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(43,33,64,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  }

  drawTrees(ctx, W, gy, off, light) {
    const cell = 34;
    const i0 = Math.floor(off / cell) - 1, i1 = Math.floor((off + W) / cell) + 1;
    for (let i = i0; i <= i1; i++) {
      if (hash(i, 77) < 0.35) continue;
      const x = i * cell - off + hash(i, 78) * 20;
      drawTree(ctx, x, gy - 6, 30 + hash(i, 79) * 40, hash(i, 80) < 0.5 ? 0 : 1, i);
    }
  }

  drawTrack(ctx, W, gy, sc, style) {
    if (style === 'maglev') {
      glossyRect(ctx, -10, gy - 2, W + 20, 16, 3, '#c9ced6', { gloss: false });
      const sp = 160, o = sc % sp;
      for (let x = -o; x < W + sp; x += sp) glossyRect(ctx, x, gy + 14, 18, 44, 2, '#9aa1aa', { gloss: false, lw: 2 });
      return;
    }
    ctx.fillStyle = this.snowy('#b3a48c', 0.7); ctx.fillRect(0, gy + 1, W, 14);
    ctx.fillStyle = '#9a8b74'; ctx.fillRect(0, gy + 11, W, 4);
    const sp = 13, o = sc % sp;
    for (let x = -o; x < W + sp; x += sp) outlined(ctx, () => ctx.roundRect(x, gy + 2, 7, 6, 1.5), '#7a5235', 1.1);
    ctx.fillStyle = '#d9dde2'; ctx.fillRect(0, gy - 2, W, 4);
    ctx.fillStyle = OL; ctx.fillRect(0, gy + 2, W, 1.5);
  }

  drawPoles(ctx, W, gy, sc, style) {
    const electric = style === 'electric' || style === 'hs';
    const sp = 260, o = sc % sp;
    const top = gy - (electric ? 118 : 96);
    const xs = [];
    for (let x = -o - sp; x < W + sp; x += sp) {
      xs.push(x);
      outlined(ctx, () => ctx.rect(x - 3, top, 6, gy + 2 - top), '#8a5a35', 1.8);
      outlined(ctx, () => ctx.roundRect(x - 12, top + 3, electric ? 64 : 24, 5, 2), '#6d4a2f', 1.5);
    }
    ctx.strokeStyle = 'rgba(43,33,64,0.65)'; ctx.lineWidth = 1.3;
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i], b = xs[i + 1];
      if (electric) { ctx.beginPath(); ctx.moveTo(a + 46, top + 10); ctx.lineTo(b + 46, top + 10); ctx.stroke(); }
      else for (const dy of [6, 13]) { ctx.beginPath(); ctx.moveTo(a - 8 + dy, top + 5); ctx.quadraticCurveTo((a + b) / 2, top + 5 + 16, b - 8 + dy, top + 5); ctx.stroke(); }
    }
  }

  // A station, with whoever (or whatever) is actually waiting there.
  drawStation(ctx, sx, gy, name, nodeId) {
    glossyRect(ctx, sx - 360, gy - 16, 400, 16, 3, '#cdbb9a', { gloss: false, lw: 2 });
    ctx.fillStyle = '#f5c542'; ctx.fillRect(sx - 358, gy - 15, 396, 3);
    const bx = sx - 290;
    glossyRect(ctx, bx, gy - 94, 150, 78, 4, '#f3dfbd', { gloss: false });
    outlined(ctx, () => { ctx.moveTo(bx - 16, gy - 92); ctx.lineTo(bx + 75, gy - 134); ctx.lineTo(bx + 166, gy - 92); ctx.closePath(); }, this.snowy('#e0594a', 0.85));
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(bx + 4, gy - 98); ctx.lineTo(bx + 75, gy - 128); ctx.lineTo(bx + 80, gy - 124); ctx.lineTo(bx + 14, gy - 96); ctx.fill();
    outlined(ctx, () => ctx.arc(bx + 75, gy - 108, 9, 0, Math.PI * 2), '#fffbe8', 2);
    ctx.strokeStyle = OL; ctx.lineWidth = 1.5;
    const ca = this.clock * 0.2;
    ctx.beginPath(); ctx.moveTo(bx + 75, gy - 108); ctx.lineTo(bx + 75 + Math.cos(ca) * 6, gy - 108 + Math.sin(ca) * 6); ctx.moveTo(bx + 75, gy - 108); ctx.lineTo(bx + 75, gy - 113); ctx.stroke();
    outlined(ctx, () => ctx.roundRect(bx + 60, gy - 56, 30, 40, [12, 12, 0, 0]), '#7a4a2e', 2);
    for (const wx of [bx + 16, bx + 106]) {
      outlined(ctx, () => ctx.roundRect(wx, gy - 76, 28, 28, 5), '#8fd3ff', 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(wx + 5, gy - 72, 5, 18);
      this.lights.push({ kind: 'win', x: wx + 2, y: gy - 74, w: 24, h: 24 });
    }
    ctx.font = '800 14px system-ui, sans-serif';
    const tw = ctx.measureText(name).width + 22;
    glossyRect(ctx, bx + 75 - tw / 2, gy - 162, tw, 24, 8, '#2d6cdf', { lw: 2 });
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, bx + 75, gy - 150);
    for (const lx of [sx - 330, sx - 100, sx + 20]) {
      outlined(ctx, () => ctx.rect(lx, gy - 66, 4, 50), '#3a3340', 1.2);
      outlined(ctx, () => ctx.roundRect(lx - 4, gy - 74, 12, 9, 3), '#ffe28a', 1.5);
      this.lights.push({ kind: 'lamp', x: lx + 2, y: gy - 70 });
    }
    // what's waiting on the platform comes from the game
    if (nodeId == null) return;
    const node = this.g.node(nodeId), st = this.g.nodeState(nodeId).stock;
    if (node.type === 'town') {
      const n = Math.min(11, Math.ceil((st.pax || 0) / 4));
      for (let i = 0; i < n; i++) {
        const px = sx - 320 + i * 30 + hash(i, nodeId) * 10;
        if (px > bx - 4 && px < bx + 154 && i % 2) continue; // a few stand in front of the doors
        person(ctx, px, gy - 30, 1.2, nodeId * 31 + i, this.clock, { standing: true });
      }
    } else {
      const total = Object.values(st).reduce((a, b) => a + b, 0);
      const n = Math.min(10, Math.ceil(total / 12));
      const col = { grain: '#e3b04b', food: '#e74c3c', logs: '#9b6a3c', goods: '#5d8fd6', coal: '#3a3340' }[Object.keys(st).find((c) => st[c] > 0)] || '#d9a35b';
      for (let i = 0; i < n; i++) {
        const cx = sx - 330 + (i % 5) * 22, cy = gy - 16 - Math.floor(i / 5) * 18;
        glossyRect(ctx, cx, cy - 18, 20, 18, 3, col, { lw: 1.8 });
      }
    }
  }

  // ---------- train ----------

  drawTrain(ctx, fx, gy, model, tr, line, sc) {
    const color = line ? line.color : '#e4572e';
    const style = model.style;
    const bob = 0;
    const hover = style === 'maglev' ? -8 + Math.sin(this.clock * 3) * 1.5 : 0;
    const y0 = gy + bob + hover;
    const wheelRot = sc / 12;
    // soft shadow under the train
    ctx.fillStyle = 'rgba(30,20,40,0.18)';
    ctx.beginPath(); ctx.ellipse(fx - 300, gy + 6, 340, 6, 0, 0, Math.PI * 2); ctx.fill();

    let x = fx;
    const locoLen = { steam: 140, stream: 146, diesel: 134, electric: 126, hs: 156, maglev: 164 }[style];
    this.drawLoco(ctx, x, y0, style, color, wheelRot);
    x -= locoLen + 6;
    if (style === 'steam') { this.drawTender(ctx, x, y0, wheelRot); x -= 60; }

    const cap = model.cap;
    const n = clamp(Math.round(cap / 50) + 1, 2, 6);
    let types = tr ? Object.keys(tr.load).filter((c) => tr.load[c] > 0) : [];
    if (!types.length && line) types = [...new Set([...this.g.flow(line.a, line.b), ...this.g.flow(line.b, line.a)])];
    if (!types.length) types = ['pax'];
    const total = tr ? Object.values(tr.load).reduce((s, v) => s + v, 0) : 0;
    const seed = line ? line.id * 97 + (line.trains.indexOf(tr) + 1) * 13 : 1;
    for (let i = 0; i < n; i++) {
      const c = types[i % types.length];
      const frac = tr ? (tr.load[c] || 0) / (cap * (types.filter((t) => t === c).length / types.length || 1)) : 0;
      this.drawWagon(ctx, x, y0, c, clamp(total ? frac : 0, 0, 1), color, wheelRot, style, seed + i * 7);
      x -= 98;
    }
  }

  wheel(ctx, x, y, r, rot, spokes = true) {
    outlined(ctx, () => ctx.arc(x, y, r, 0, Math.PI * 2), '#3a3340', 2);
    ctx.strokeStyle = '#a7adb6'; ctx.lineWidth = Math.max(1.5, r * 0.16);
    ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, Math.PI * 2); ctx.stroke();
    if (spokes && r > 8) {
      ctx.strokeStyle = '#6d6875'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = rot + (i * Math.PI) / 3;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * r * 0.66, y - Math.sin(a) * r * 0.66); ctx.lineTo(x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66); ctx.stroke();
      }
    }
    outlined(ctx, () => ctx.arc(x, y, Math.max(2, r * 0.28), 0, Math.PI * 2), '#e3e6ea', 1.5);
  }

  bogie(ctx, cx, y, rot) {
    outlined(ctx, () => ctx.roundRect(cx - 20, y - 14, 40, 8, 3), '#3a3340', 2);
    this.wheel(ctx, cx - 11, y - 7, 7, rot, false);
    this.wheel(ctx, cx + 11, y - 7, 7, rot, false);
  }

  // The driver, waving through the cab window.
  driver(ctx, x, y, s, clip) {
    ctx.save();
    ctx.beginPath(); clip(); ctx.clip();
    person(ctx, x, y, s, 4242, this.clock, { cap: '#2d3e75' });
    ctx.restore();
  }

  drawLoco(ctx, fx, y, style, color, rot) {
    const dark = '#3a3340';
    if (style === 'steam') {
      glossyRect(ctx, fx - 132, y - 30, 130, 12, 4, dark, { gloss: false });
      glossyRect(ctx, fx - 106, y - 70, 100, 42, 21, color);
      ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 3;
      for (const bx of [fx - 82, fx - 54]) { ctx.beginPath(); ctx.moveTo(bx, y - 68); ctx.lineTo(bx, y - 30); ctx.stroke(); }
      glossyRect(ctx, fx - 22, y - 68, 18, 40, 9, dark);
      outlined(ctx, () => { ctx.moveTo(fx - 34, y - 66); ctx.lineTo(fx - 32, y - 88); ctx.lineTo(fx - 39, y - 97); ctx.lineTo(fx - 11, y - 97); ctx.lineTo(fx - 18, y - 88); ctx.lineTo(fx - 16, y - 66); ctx.closePath(); }, dark);
      outlined(ctx, () => ctx.arc(fx - 64, y - 68, 10, Math.PI, 0), '#f5c542');
      glossyRect(ctx, fx - 140, y - 98, 40, 72, 8, shade(color, -0.12));
      glossyRect(ctx, fx - 148, y - 106, 56, 12, 6, dark, { gloss: false });
      const win = () => ctx.roundRect(fx - 132, y - 88, 24, 22, 5);
      outlined(ctx, win, '#fdf3dc', 2);
      this.driver(ctx, fx - 120, y - 70, 1.15, win);
      ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.beginPath(); win(); ctx.stroke();
      this.lights.push({ kind: 'win', soft: true, x: fx - 132, y: y - 88, w: 24, h: 22 });
      outlined(ctx, () => { ctx.moveTo(fx - 6, y - 26); ctx.lineTo(fx + 14, y - 4); ctx.lineTo(fx - 6, y - 4); ctx.closePath(); }, '#e74c3c');
      outlined(ctx, () => ctx.roundRect(fx - 14, y - 62, 10, 12, 3), '#ffe28a', 2);
      this.lights.push({ kind: 'head', x: fx - 4, y: y - 56 });
      const sn = this.wx ? this.wx.cover : 0;
      snowCap(ctx, fx - 98, y - 70, 52, sn, { icicles: false });
      snowCap(ctx, fx - 148, y - 106, 56, sn);
      this.wheel(ctx, fx - 94, y - 16, 16, rot);
      this.wheel(ctx, fx - 58, y - 16, 16, rot);
      this.wheel(ctx, fx - 22, y - 10, 10, rot);
      const rx = Math.cos(rot) * 7, ry = Math.sin(rot) * 7;
      outlined(ctx, () => ctx.roundRect(fx - 96 + rx, y - 19 + ry, 40, 5, 2.5), '#c9ccd1', 1.5);
      this.stack = { x: fx - 25, y: y - 100, kind: 'steam' };
      return;
    }
    if (style === 'stream') {
      glossyRect(ctx, fx - 140, y - 28, 134, 10, 4, dark, { gloss: false });
      const body = () => {
        ctx.moveTo(fx - 146, y - 22); ctx.lineTo(fx - 146, y - 76);
        ctx.quadraticCurveTo(fx - 146, y - 84, fx - 136, y - 84);
        ctx.lineTo(fx - 50, y - 84); ctx.quadraticCurveTo(fx + 10, y - 80, fx + 10, y - 34);
        ctx.lineTo(fx + 10, y - 22); ctx.closePath();
      };
      glossy(ctx, body, { x: fx - 146, y: y - 84, w: 156, h: 62 }, color);
      ctx.fillStyle = '#eef1f4'; ctx.fillRect(fx - 145, y - 50, 150, 6);
      ctx.strokeStyle = OL; ctx.lineWidth = 1.5; ctx.strokeRect(fx - 145, y - 50, 150, 6);
      const win = () => ctx.roundRect(fx - 136, y - 76, 24, 18, 5);
      outlined(ctx, win, '#fdf3dc', 2);
      this.driver(ctx, fx - 124, y - 58, 1.1, win);
      ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.beginPath(); win(); ctx.stroke();
      outlined(ctx, () => ctx.arc(fx + 2, y - 42, 5, 0, Math.PI * 2), '#ffe28a', 2);
      this.lights.push({ kind: 'head', x: fx + 6, y: y - 42 });
      snowCap(ctx, fx - 140, y - 84, 96, this.wx ? this.wx.cover : 0);
      for (const wx of [fx - 112, fx - 80, fx - 48]) this.wheel(ctx, wx, y - 14, 13, rot);
      glossyRect(ctx, fx - 128, y - 28, 104, 10, 3, shade(color, -0.2), { gloss: false });
      this.stack = { x: fx - 44, y: y - 86, kind: 'steam' };
      return;
    }
    if (style === 'maglev') {
      ctx.fillStyle = 'rgba(120,220,255,0.55)'; ctx.fillRect(fx - 160, y - 6, 160, 4);
      const body = () => {
        ctx.moveTo(fx - 164, y - 8); ctx.lineTo(fx - 164, y - 58); ctx.quadraticCurveTo(fx - 164, y - 66, fx - 154, y - 66);
        ctx.lineTo(fx - 80, y - 66); ctx.quadraticCurveTo(fx + 14, y - 60, fx + 18, y - 10); ctx.closePath();
      };
      glossy(ctx, body, { x: fx - 164, y: y - 66, w: 182, h: 58 }, '#f2f5f8');
      ctx.fillStyle = color; ctx.fillRect(fx - 163, y - 28, 172, 7);
      const win = () => { ctx.moveTo(fx - 66, y - 60); ctx.quadraticCurveTo(fx - 14, y - 56, fx - 4, y - 38); ctx.lineTo(fx - 66, y - 38); ctx.closePath(); };
      outlined(ctx, win, '#bfe3ff', 2);
      this.driver(ctx, fx - 42, y - 40, 1.1, win);
      ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.beginPath(); win(); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        outlined(ctx, () => ctx.roundRect(fx - 154 + i * 22, y - 56, 16, 13, 4), '#bfe3ff', 1.5);
        this.lights.push({ kind: 'win', soft: true, x: fx - 154 + i * 22, y: y - 56, w: 16, h: 13 });
      }
      this.lights.push({ kind: 'head', x: fx + 12, y: y - 18 });
      snowCap(ctx, fx - 160, y - 66, 84, this.wx ? this.wx.cover : 0);
      this.stack = { x: fx - 80, y: y - 68, kind: 'spark' };
      return;
    }
    // diesel / electric / high speed
    const len = style === 'hs' ? 156 : style === 'electric' ? 126 : 134;
    const top = y - 76;
    const body = style === 'hs'
      ? () => { ctx.moveTo(fx - len, y - 20); ctx.lineTo(fx - len, top + 8); ctx.quadraticCurveTo(fx - len, top, fx - len + 8, top); ctx.lineTo(fx - 64, top); ctx.quadraticCurveTo(fx + 8, top + 18, fx + 8, y - 28); ctx.lineTo(fx + 8, y - 20); ctx.closePath(); }
      : () => ctx.roundRect(fx - len, top, len, 56, [8, 22, 6, 6]);
    glossy(ctx, body, { x: fx - len, y: top, w: len + 8, h: 56 }, color);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(fx - len + 1, y - 40, len - 2, 5);
    const win = style === 'hs'
      ? () => { ctx.moveTo(fx - 62, top + 6); ctx.quadraticCurveTo(fx - 26, top + 12, fx - 12, top + 26); ctx.lineTo(fx - 62, top + 26); ctx.closePath(); }
      : () => ctx.roundRect(fx - 38, top + 8, 30, 22, [4, 14, 4, 4]);
    outlined(ctx, win, '#bfe3ff', 2);
    this.driver(ctx, fx - (style === 'hs' ? 40 : 22), top + 28, 1.1, win);
    ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.beginPath(); win(); ctx.stroke();
    // grilles / side windows
    for (let i = 0; i < 3; i++) {
      const wx = fx - len + 14 + i * 26;
      if (style === 'diesel') {
        outlined(ctx, () => ctx.roundRect(wx, top + 12, 18, 16, 3), shade(color, -0.3), 1.5);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
        for (let g = 0; g < 3; g++) { ctx.beginPath(); ctx.moveTo(wx + 3, top + 16 + g * 4); ctx.lineTo(wx + 15, top + 16 + g * 4); ctx.stroke(); }
      } else {
        outlined(ctx, () => ctx.roundRect(wx, top + 12, 18, 14, 4), '#bfe3ff', 1.5);
        this.lights.push({ kind: 'win', soft: true, x: wx, y: top + 12, w: 18, h: 14 });
      }
    }
    if (style === 'diesel') {
      outlined(ctx, () => ctx.roundRect(fx - 84, top - 7, 14, 8, 2), '#3a3340', 1.5);
      this.stack = { x: fx - 77, y: top - 9, kind: 'exhaust' };
    } else {
      const px = fx - len / 2 - 10;
      ctx.strokeStyle = OL; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(px - 12, top); ctx.lineTo(px + 4, top - 16); ctx.lineTo(px - 8, top - 32); ctx.stroke();
      outlined(ctx, () => ctx.roundRect(px - 24, top - 35, 34, 4, 2), '#c9ccd1', 1.5);
      this.stack = { x: px - 8, y: top - 36, kind: 'spark' };
    }
    outlined(ctx, () => ctx.roundRect(fx - 7, y - 32, 8, 7, 2), '#ffe28a', 1.5);
    this.lights.push({ kind: 'head', x: fx, y: y - 28 });
    snowCap(ctx, fx - len + 4, top, len - (style === 'hs' ? 70 : 34), this.wx ? this.wx.cover : 0);
    this.bogie(ctx, fx - len + 30, y, rot);
    this.bogie(ctx, fx - 30, y, rot);
  }

  drawTender(ctx, x, y, rot) {
    glossyRect(ctx, x - 54, y - 62, 54, 40, 6, '#3a3340');
    blob(ctx, [[x - 40, y - 62, 9], [x - 27, y - 66, 11], [x - 14, y - 62, 9]], '#1f1a26', 1.5);
    if (this.wx && this.wx.cover > 0.05) blob(ctx, [[x - 38, y - 66, 6 * this.wx.cover + 2], [x - 26, y - 72, 7 * this.wx.cover + 2], [x - 15, y - 66, 6 * this.wx.cover + 2]], '#fbfdff', 1.2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(x - 30, y - 70, 3, 0, Math.PI * 2); ctx.fill();
    this.wheel(ctx, x - 40, y - 11, 10, rot);
    this.wheel(ctx, x - 14, y - 11, 10, rot);
  }

  // Wagons are drawn cut away, so you can see who and what is on board.
  drawWagon(ctx, x, y, cargo, frac, color, rot, style, seed) {
    const w = 92, l = x - w;
    const heritage = style === 'steam' || style === 'stream';
    if (cargo === 'pax' || style === 'maglev') {
      const body = heritage ? shade(color, -0.25) : style === 'maglev' ? '#f2f5f8' : shade(color, 0.1);
      glossyRect(ctx, l, y - 74, w, 54, 10, body);
      glossyRect(ctx, l - 2, y - 80, w + 4, 10, 5, heritage ? '#3a3340' : shade(body, -0.25), { gloss: false });
      if (style === 'maglev') { ctx.fillStyle = color; ctx.fillRect(l + 1, y - 30, w - 2, 6); }
      else { ctx.fillStyle = heritage ? '#f5c542' : 'rgba(255,255,255,0.85)'; ctx.fillRect(l + 1, y - 34, w - 2, 4); }
      // interior with passengers, in proportion to the real load
      const band = () => ctx.roundRect(l + 7, y - 68, w - 14, 26, 6);
      ctx.save();
      ctx.beginPath(); band(); ctx.fillStyle = '#fff3d6'; ctx.fill(); ctx.clip();
      const seats = 5;
      const people = cargo === 'pax' ? clamp(Math.round(frac * seats + (hash(seed, 9) - 0.5) * frac * 2), 0, seats) : 0;
      for (let i = 0; i < seats; i++) {
        const px = l + 17 + i * 15.5;
        outlined(ctx, () => ctx.roundRect(px - 6, y - 58, 12, 18, 3), heritage ? '#3f7a60' : '#3e66a3', 1.2);
        if (hash(seed + i, 3) < people / seats + 0.001 && people > 0) person(ctx, px, y - 49, 0.95, seed * 7 + i, this.clock);
      }
      ctx.restore();
      ctx.strokeStyle = OL; ctx.lineWidth = 2;
      for (let i = 1; i < seats; i++) { const px = l + 9 + i * 15.5; ctx.fillStyle = body; ctx.fillRect(px - 1.5, y - 68, 3, 26); ctx.beginPath(); ctx.moveTo(px - 1.5, y - 68); ctx.lineTo(px - 1.5, y - 42); ctx.moveTo(px + 1.5, y - 68); ctx.lineTo(px + 1.5, y - 42); ctx.stroke(); }
      ctx.beginPath(); band(); ctx.stroke();
      this.lights.push({ kind: 'win', soft: true, x: l + 7, y: y - 68, w: w - 14, h: 26 });
    } else if (cargo === 'grain' || cargo === 'coal') {
      const hop = cargo === 'coal' ? '#4a4652' : '#c8873e';
      if (frac > 0.02) {
        const hh = 4 + frac * 18, heap = cargo === 'coal' ? '#26222c' : '#f2c94c';
        blob(ctx, [[l + w * 0.3, y - 64, hh * 0.8], [l + w * 0.5, y - 64 - hh * 0.3, hh], [l + w * 0.7, y - 64, hh * 0.8]], heap, 1.6);
        ctx.fillStyle = cargo === 'coal' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.5)';
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(l + w * (0.25 + hash(seed, i) * 0.5), y - 66 - hash(seed, i + 9) * hh, 1.4, 0, Math.PI * 2); ctx.fill(); }
      }
      glossy(ctx, () => { ctx.moveTo(l, y - 66); ctx.lineTo(x, y - 66); ctx.lineTo(x - 12, y - 22); ctx.lineTo(l + 12, y - 22); ctx.closePath(); }, { x: l, y: y - 66, w, h: 44 }, hop);
      ctx.strokeStyle = 'rgba(43,33,64,0.5)'; ctx.lineWidth = 1.5;
      for (const rx of [l + 30, l + 62]) { ctx.beginPath(); ctx.moveTo(rx, y - 62); ctx.lineTo(rx + (rx < l + 46 ? 4 : -4), y - 26); ctx.stroke(); }
    } else if (cargo === 'logs') {
      glossyRect(ctx, l, y - 32, w, 10, 3, '#6d4a2f', { gloss: false });
      for (const sx of [l + 4, x - 10]) outlined(ctx, () => ctx.rect(sx, y - 66, 6, 34), '#3a3340', 1.5);
      const rows = frac > 0.02 ? Math.max(1, Math.round(frac * 3)) : 0;
      for (let r = 0; r < rows; r++) {
        const ly = y - 43 - r * 11;
        glossyRect(ctx, l + 12, ly, w - 24, 11, 5.5, r % 2 ? '#a8713f' : '#bd8550', { lw: 1.6 });
        outlined(ctx, () => ctx.arc(x - 14, ly + 5.5, 5.5, 0, Math.PI * 2), '#e9c48f', 1.6);
        ctx.strokeStyle = '#b58350'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x - 14, ly + 5.5, 2.5, 0, Math.PI * 2); ctx.stroke();
      }
    } else {
      // box car cut away to show the crates or tins inside
      const food = cargo === 'food';
      const body = food ? '#d9534f' : '#5d8fd6';
      glossyRect(ctx, l, y - 74, w, 54, 6, body);
      const hold = () => ctx.roundRect(l + 8, y - 66, w - 16, 38, 4);
      ctx.save();
      ctx.beginPath(); hold(); ctx.fillStyle = '#5a4636'; ctx.fill(); ctx.clip();
      const slots = 8, n = Math.round(frac * slots);
      for (let i = 0; i < n; i++) {
        const cx = l + 11 + (i % 4) * 18, cy = y - 30 - Math.floor(i / 4) * 17;
        if (food) {
          outlined(ctx, () => ctx.roundRect(cx, cy - 15, 15, 15, 3), '#f5f0e6', 1.5);
          ctx.fillStyle = '#e74c3c'; ctx.fillRect(cx + 1, cy - 10, 13, 5);
        } else {
          glossyRect(ctx, cx, cy - 15, 16, 15, 2, '#d9a35b', { lw: 1.5, belly: 0.15 });
          ctx.strokeStyle = 'rgba(43,33,64,0.45)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(cx + 8, cy - 15); ctx.lineTo(cx + 8, cy); ctx.stroke();
        }
      }
      ctx.restore();
      ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.beginPath(); hold(); ctx.stroke();
      ctx.font = '800 9px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(food ? 'FOOD' : 'GOODS', l + w / 2, y - 24);
    }
    const sn = this.wx ? this.wx.cover : 0;
    if (sn > 0.05) {
      if (cargo === 'pax' || style === 'maglev') snowCap(ctx, l - 2, y - 80, w + 4, sn);
      else if (cargo === 'logs') snowCap(ctx, l + 12, frac > 0.02 ? y - 43 - (Math.max(1, Math.round(frac * 3)) - 1) * 11 : y - 32, w - 24, sn, { icicles: false });
      else if (cargo === 'grain' || cargo === 'coal') snowCap(ctx, l + 2, y - 66, w - 4, sn * 0.8, { icicles: false });
      else snowCap(ctx, l, y - 74, w, sn);
    }
    if (!heritage) { this.bogie(ctx, l + 20, y, rot); this.bogie(ctx, x - 20, y, rot); }
    else {
      outlined(ctx, () => ctx.roundRect(l + 4, y - 24, w - 8, 7, 3), '#3a3340', 1.8);
      this.wheel(ctx, l + 20, y - 10, 10, rot);
      this.wheel(ctx, x - 20, y - 10, 10, rot);
    }
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
    }
    for (const pass of [0, 1]) {
      for (const p of this.parts) {
        const a = Math.max(0, 1 - p.life / p.max);
        if (p.kind === 'spark') {
          if (!pass) continue;
          ctx.fillStyle = `rgba(150,230,255,${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.r * 0.4), 0, Math.PI * 2); ctx.fill();
          continue;
        }
        const exhaust = p.kind === 'exhaust';
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, p.r), 0, Math.PI * 2);
        if (!pass) {
          ctx.strokeStyle = exhaust ? `rgba(40,36,50,${a * 0.3})` : `rgba(120,132,170,${a * 0.75})`;
          ctx.lineWidth = 3; ctx.stroke();
        } else {
          ctx.fillStyle = exhaust ? `rgba(90,86,100,${a * 0.4})` : `rgba(255,255,255,${a * 0.92})`;
          ctx.fill();
        }
      }
    }
    this.parts = this.parts.filter((p) => p.life < p.max && p.x > -120);
    if (this.parts.length > 260) this.parts.splice(0, this.parts.length - 260);
  }

  drawForeground(ctx, W, H, gy, off, spans = []) {
    const wet = (x) => spans.some(([a, b]) => x > a - 6 && x < b + 6);
    ctx.fillStyle = this.snowy('#3f8f35', 0.6);
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
      if (hash(i, 95) < 0.55 || (this.wx && this.wx.cover > 0.4)) continue;
      const x = i * fcell - off + hash(i, 96) * 12, y = gy + 60 + hash(i, 97) * (H - gy - 70);
      if (wet(x)) continue;
      ctx.fillStyle = fc[Math.floor(hash(i, 98) * fc.length)];
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    // fence
    ctx.strokeStyle = '#8a5a35'; ctx.lineWidth = 4;
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
