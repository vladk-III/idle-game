// Focus mode "ride" scene: a side view that follows one of your real trains
// through a slowly shifting day/night landscape.
import { MODELS, CARGO } from './data.js';
import { hash, noise1, clamp, lerp } from './rng.js';

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
    const gy = Math.round(H * (H > W * 1.2 ? 0.6 : 0.7));
    const sc = this.scroll;

    this.drawSky(ctx, W, H, gy, light, phase);
    this.drawClouds(ctx, W, gy, sc, light);
    this.drawBirds(ctx, W, gy);
    this.drawRidge(ctx, W, gy, sc * 0.04, 0.003, Math.min(H * 0.25, 170), gy - Math.min(H * 0.1, 70), mix('#8a97b8', '#b4c0d2', light), 11);
    this.drawRidge(ctx, W, gy, sc * 0.09, 0.0045, Math.min(H * 0.16, 110), gy - Math.min(H * 0.06, 40), mix('#6d7f98', '#93a7b8', light), 17);
    this.drawRidge(ctx, W, gy, sc * 0.18, 0.007, Math.min(H * 0.09, 60), gy - 20, mix('#4f6f5a', '#6f9468', light * 0.9), 23);
    this.drawTrees(ctx, W, gy, sc * 0.4, light);

    // ground
    ctx.fillStyle = '#5e8c48';
    ctx.fillRect(0, gy - 8, W, H - gy + 8);
    ctx.fillStyle = '#4f7a3c';
    ctx.fillRect(0, gy + 22, W, H - gy);

    const frontX = Math.round(Math.min(W - 30, W * 0.5 + 170));

    // stations sit behind the train
    if (cur) {
      const depX = frontX - traveled * k;
      const arrX = frontX + remaining * k;
      if (depX > -60 && depX < W + 400) this.drawStation(ctx, depX, gy, fromName);
      if (arrX < W + 400 && legPx > 0) this.drawStation(ctx, arrX, gy, toName);
    }

    this.drawTrack(ctx, W, gy, sc, model.style);
    this.drawPoles(ctx, W, gy, sc, model.style);

    this.lights = [];
    this.drawTrain(ctx, frontX, gy, model, cur ? cur.tr : null, cur ? cur.line : null, sc);
    this.updateSmoke(ctx, dt, model.style);

    this.drawForeground(ctx, W, H, gy, sc * 1.35);

    // night overlay, then things that glow
    const night = 1 - light;
    if (night > 0.02) {
      ctx.fillStyle = `rgba(8,12,38,${night * 0.55})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = night;
      for (const l of this.lights) {
        if (l.kind === 'win') { ctx.fillStyle = '#ffd77a'; ctx.fillRect(l.x, l.y, l.w, l.h); }
        else if (l.kind === 'lamp') {
          const gr = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 26);
          gr.addColorStop(0, 'rgba(255,220,140,0.9)'); gr.addColorStop(1, 'rgba(255,220,140,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(l.x, l.y, 26, 0, Math.PI * 2); ctx.fill();
        } else if (l.kind === 'head') {
          const gr = ctx.createLinearGradient(l.x, 0, l.x + 260, 0);
          gr.addColorStop(0, 'rgba(255,240,190,0.55)'); gr.addColorStop(1, 'rgba(255,240,190,0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.moveTo(l.x, l.y - 3); ctx.lineTo(l.x + 260, l.y - 40); ctx.lineTo(l.x + 260, l.y + 40); ctx.lineTo(l.x, l.y + 3); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
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

  updateSmoke(ctx, dt, style) {
    const s = this.stack;
    if (s) {
      const rate = s.kind === 'steam' ? 4 + this.vis * 0.06 : s.kind === 'exhaust' ? 2 + this.vis * 0.02 : 0;
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
      p.x += (p.vx - this.vis * 0.85) * dt;
      p.y += p.vy * dt;
      p.vy *= 0.97;
      p.r += dt * (p.kind === 'spark' ? -4 : 10);
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
    this.parts = this.parts.filter((p) => p.life < p.max && p.x > -80);
    if (this.parts.length > 260) this.parts.splice(0, this.parts.length - 260);
  }

  drawForeground(ctx, W, H, gy, off) {
    ctx.fillStyle = '#3f6a31';
    const cell = 18;
    const i0 = Math.floor(off / cell) - 1, i1 = Math.floor((off + W) / cell) + 1;
    for (let i = i0; i <= i1; i++) {
      if (hash(i, 91) < 0.4) continue;
      const x = i * cell - off, y = gy + 34 + hash(i, 92) * (H - gy - 40);
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
      ctx.fillStyle = fc[Math.floor(hash(i, 98) * fc.length)];
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    // fence
    ctx.strokeStyle = '#6d5440'; ctx.lineWidth = 3;
    const sp = 70, o = off % sp, fy = gy + 30;
    for (let x = -o; x < W + sp; x += sp) { ctx.beginPath(); ctx.moveTo(x, fy + 22); ctx.lineTo(x, fy); ctx.stroke(); }
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, fy + 6); ctx.lineTo(W, fy + 6); ctx.moveTo(0, fy + 14); ctx.lineTo(W, fy + 14); ctx.stroke();
  }
}
