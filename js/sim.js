// Game state and simulation. No DOM in here.
import {
  CARGO, NODE_TYPES, MODELS, LINE_COLORS, MONTHS, PERKS,
  SECONDS_PER_MONTH, FOCUS_TOKEN_SECONDS, outputsOf,
} from './data.js';
import { generateWorld, trackGeom } from './world.js';
import { noise1, clamp } from './rng.js';

const SAVE_KEY = 'branchline-save-v1';
const START_MONEY = 60000;
const TRACK_COST_PER_UNIT = 50;
const DWELL = 3;
const DWELL_MID = 2.2; // a shorter stop at stations along the way
const EMA_WINDOW = 120; // seconds

export class Game {
  constructor() {
    this.listeners = [];
    this.geoms = new Map();
    this.focusActive = false;
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  // ---------- lifecycle ----------

  newGame(seed = (Math.random() * 2 ** 31) | 0) {
    this.world = generateWorld(seed);
    this.geoms.clear();
    this.state = {
      v: 1, seed, money: START_MONEY, months: 0,
      ns: this.world.nodes.map(() => ({ stock: {}, growth: 0, shipped: 0 })),
      lines: [], nextLineId: 1,
      tokens: 0, focusSec: 0, focusProg: 0,
      perks: Object.fromEntries(PERKS.map((p) => [p.id, 0])),
      stats: { earned: 0, delivered: 0 },
      settings: { haptics: true, dim: 0.25 },
      tut: 0, ema: 0, lastSeen: Date.now(),
    };
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      return this.import(raw);
    } catch { return false; }
  }

  import(raw) {
    const s = JSON.parse(raw);
    if (!s || s.v !== 1 || typeof s.seed !== 'number') return false;
    this.newGame(s.seed);
    this.state = { ...this.state, ...s, settings: { ...this.state.settings, ...s.settings }, perks: { ...this.state.perks, ...s.perks } };
    // the world grew: older saves need state for the new towns and industries
    while (this.state.ns.length < this.world.nodes.length) this.state.ns.push({ stock: {}, growth: 0, shipped: 0 });
    return true;
  }

  export() {
    this.state.lastSeen = Date.now();
    return JSON.stringify(this.state);
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, this.export()); } catch { /* storage full or blocked */ }
  }

  reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    this.newGame();
  }

  // ---------- queries ----------

  node(id) { return this.world.nodes[id]; }
  nodeState(id) { return this.state.ns[id]; }
  line(id) { return this.state.lines.find((l) => l.id === id); }

  year() { return 1850 + Math.floor(this.state.months / 12); }
  dateLabel() {
    const m = Math.floor(this.state.months);
    return `${MONTHS[m % 12]} ${1850 + Math.floor(m / 12)}`;
  }

  // Weather follows the game calendar: snow in winter, showers in spring and
  // autumn, mostly fair summers. Spells drift in and out over a few game months.
  weather() {
    const m = this.state.months, mo = m % 12;
    const temp = 0.5 - 0.5 * Math.cos((2 * Math.PI * (mo - 0.5)) / 12); // 0 mid-Jan .. 1 mid-Jul
    const wet = noise1(m / 3.5, this.state.seed % 9973) * 0.75 + noise1(m / 1.3, 77) * 0.25;
    const thr = temp < 0.25 ? 0.36 : temp > 0.8 ? 0.58 : 0.42;
    const precip = clamp((wet - thr) / 0.16, 0, 1);
    const snowy = temp < 0.2;
    const cover = clamp((0.3 - temp) / 0.12, 0, 1);
    const autumn = clamp(1 - Math.abs(mo - 9.6) / 1.9, 0, 1);
    const rain = snowy ? 0 : precip, snow = snowy ? precip : 0;
    const icon = snow > 0.15 ? '🌨️' : rain > 0.6 ? '🌧️' : rain > 0.15 ? '🌦️' : precip > 0 || wet > thr - 0.08 ? '⛅' : cover > 0.5 ? '❄️' : autumn > 0.5 ? '🍂' : '☀️';
    return { rain, snow, cover, autumn, temp, icon };
  }

  availableModels() {
    const y = this.year();
    return MODELS.map((m, i) => ({ ...m, i })).filter((m) => m.year <= y);
  }
  newestModel() { const a = this.availableModels(); return a[a.length - 1]; }

  // A line runs through a list of stops (old two-station lines: [a, b]).
  stops(line) { return line.stops || [line.a, line.b]; }

  // Track for the whole line, leg by leg. stopS: distance along the track of
  // each stop; stopD: the straight-line distance covered so far (for pay).
  geom(line) {
    const stops = this.stops(line), key = stops.join('-');
    let g = this.geoms.get(line.id);
    if (!g || g.key !== key) {
      const pts = [], cum = [0], stopS = [0], stopD = [0];
      let straight = 0;
      for (let i = 0; i < stops.length - 1; i++) {
        const leg = trackGeom(this.node(stops[i]), this.node(stops[i + 1]));
        const base = cum[cum.length - 1];
        leg.pts.forEach((p, j) => {
          if (i > 0 && j === 0) return; // shared with the previous leg's end
          pts.push(p);
          if (pts.length > 1) cum.push(base + leg.cum[j]);
        });
        straight += leg.straight;
        stopS.push(cum[cum.length - 1]);
        stopD.push(straight);
      }
      g = { pts, cum, len: cum[cum.length - 1], straight, stopS, stopD, key };
      this.geoms.set(line.id, g);
    }
    return g;
  }

  // every kind of cargo the line can carry between any two of its stops
  lineCargo(line) {
    const st = this.stops(line), out = new Set();
    for (let i = 0; i < st.length; i++) for (let j = 0; j < st.length; j++) if (i !== j) for (const c of this.flow(st[i], st[j])) out.add(c);
    return [...out];
  }
  lineName(line, sep = ' ↔ ') {
    const st = this.stops(line);
    return st.length > 2 ? st.map((id) => this.node(id).name).join(' – ') : this.node(st[0]).name + sep + this.node(st[1]).name;
  }

  pop(id) {
    const n = this.node(id);
    return n.type === 'town' ? Math.round(n.basePop * (1 + this.state.ns[id].growth / 1500)) : 0;
  }

  level(id) {
    const n = this.node(id);
    if (n.type === 'town' || !NODE_TYPES[n.type].produces.length) return 0;
    return Math.min(6, 1 + Math.floor(Math.log2(1 + this.state.ns[id].shipped / 400)));
  }

  // units per minute
  productionRate(id) {
    const n = this.node(id);
    if (n.type === 'town') return this.pop(id) / 25;
    if (!NODE_TYPES[n.type].produces.length) return 0;
    return 12 * Math.pow(1.5, this.level(id) - 1);
  }

  stockCap(id) { return Math.max(60, this.productionRate(id) * 6); }

  // cargo that would flow from node a to node b
  flow(a, b) {
    const ta = this.node(a).type, tb = this.node(b).type;
    const acc = NODE_TYPES[tb].accepts;
    return outputsOf(ta).filter((c) => acc.includes(c));
  }

  trackCost(a, b) {
    const na = this.node(a), nb = this.node(b);
    return Math.round(Math.hypot(na.x - nb.x, na.y - nb.y) * 1.03 * TRACK_COST_PER_UNIT / 100) * 100;
  }

  maxTrains(line) { return Math.min(8, 1 + Math.floor(this.geom(line).len / 90)); }

  linesAt(id) { return this.state.lines.filter((l) => this.stops(l).includes(id)); }
  // a line that already runs directly between a and b
  lineBetween(a, b) {
    return this.state.lines.find((l) => {
      const st = this.stops(l);
      for (let i = 0; i < st.length - 1; i++) if ((st[i] === a && st[i + 1] === b) || (st[i] === b && st[i + 1] === a)) return true;
      return false;
    });
  }

  incomePerMin() { return this.state.ema / (EMA_WINDOW / 60); }
  lineIncomePerMin(line) { return line.ema / (EMA_WINDOW / 60); }

  revenueMult() { return 1 + 0.1 * this.state.perks.revenue; }
  growthMult() { return 1 + 0.2 * this.state.perks.growth; }
  speedMult() { return 1 + 0.06 * this.state.perks.speed; }

  upgradeCost(line) {
    const nm = this.newestModel();
    return line.trains.reduce((s, t) => s + (t.m < nm.i ? nm.cost - Math.round(MODELS[t.m].cost * 0.5) : 0), 0);
  }

  // ---------- actions ----------

  buildLine(a, b) {
    if (a === b || this.lineBetween(a, b)) return null;
    const model = this.newestModel();
    const cost = this.trackCost(a, b) + model.cost;
    if (this.state.money < cost) return null;
    this.state.money -= cost;
    const line = {
      id: this.state.nextLineId++, a, b, stops: [a, b], express: false,
      color: LINE_COLORS[(this.state.nextLineId - 2) % LINE_COLORS.length],
      trains: [], ema: 0, earned: 0, built: cost,
    };
    this.state.lines.push(line);
    line.trains.push(this.makeTrain(model.i));
    this.emit('built', line);
    return line;
  }

  makeTrain(m) { return { m, p: 0, dir: 1, wait: 1.5, v: 0, load: {}, boost: 0 }; }

  addTrain(line) {
    const model = this.newestModel();
    if (line.trains.length >= this.maxTrains(line) || this.state.money < model.cost) return false;
    this.state.money -= model.cost;
    // alternate starting ends so trains spread out
    const t = this.makeTrain(model.i);
    if (line.trains.length % 2 === 1) { t.p = 1; t.dir = -1; }
    t.wait = 1.5 + line.trains.length * 4;
    line.trains.push(t);
    return true;
  }

  sellTrain(line) {
    if (!line.trains.length) return false;
    const t = line.trains.pop();
    this.state.money += Math.round(MODELS[t.m].cost * 0.5);
    return true;
  }

  upgradeLine(line) {
    const cost = this.upgradeCost(line);
    if (!cost || this.state.money < cost) return false;
    this.state.money -= cost;
    const nm = this.newestModel();
    for (const t of line.trains) t.m = nm.i;
    return true;
  }

  // Carry the line on from one of its ends to another station. Trains keep
  // their place on the track.
  extendCost(line, end, id) { return this.trackCost(end === 'a' ? line.a : line.b, id); }
  extendLine(line, end, id) {
    const stops = this.stops(line);
    if (stops.includes(id)) return false;
    const cost = this.extendCost(line, end, id);
    if (this.state.money < cost) return false;
    this.state.money -= cost;
    const L0 = this.geom(line).len;
    line.stops = end === 'a' ? [id, ...stops] : [...stops, id];
    line.a = line.stops[0]; line.b = line.stops[line.stops.length - 1];
    line.built = (line.built || 0) + cost;
    const L1 = this.geom(line).len, shift = end === 'a' ? L1 - L0 : 0;
    for (const t of line.trains) {
      t.p = (t.p * L0 + shift) / L1;
      if (end === 'a') {
        if (t.at != null) t.at++;
        for (const c of t.cargo || []) { c.to++; c.from++; }
      }
      // a train waiting at the old end will now carry on past it
      if (t.at != null) { const last = line.stops.length - 1; if (end === 'b' && t.at === last - 1 && t.dir < 0 && t.wait > 0) t.dir = 1; if (end === 'a' && t.at === 1 && t.dir > 0 && t.wait > 0) t.dir = -1; }
    }
    this.emit('built', line);
    return true;
  }

  toggleExpress(line) { line.express = !line.express; return line.express; }

  closeLine(line) {
    const st = this.stops(line);
    let track = 0;
    for (let i = 0; i < st.length - 1; i++) track += this.trackCost(st[i], st[i + 1]);
    const refund = Math.round(track * 0.25) +
      line.trains.reduce((s, t) => s + Math.round(MODELS[t.m].cost * 0.5), 0);
    this.state.money += refund;
    this.state.lines = this.state.lines.filter((l) => l !== line);
    this.geoms.delete(line.id);
    return refund;
  }

  buyPerk(id) {
    const lvl = this.state.perks[id];
    const cost = lvl + 1;
    if (lvl >= 10 || this.state.tokens < cost) return false;
    this.state.tokens -= cost;
    this.state.perks[id]++;
    return true;
  }

  // ---------- simulation ----------

  tick(dt) {
    const s = this.state;
    const prevYear = this.year();
    s.months += dt / SECONDS_PER_MONTH;
    if (this.year() !== prevYear) {
      for (const m of MODELS) if (m.year > prevYear && m.year <= this.year()) this.emit('model', m);
    }

    // production
    for (const n of this.world.nodes) {
      const prod = NODE_TYPES[n.type].produces;
      if (!prod.length) continue;
      const st = s.ns[n.id].stock, rate = this.productionRate(n.id) / 60, cap = this.stockCap(n.id);
      for (const c of prod) st[c] = Math.min(cap, (st[c] || 0) + rate * dt);
    }

    const decay = Math.exp(-dt / EMA_WINDOW);
    s.ema *= decay;
    for (const line of s.lines) {
      line.ema *= decay;
      for (const t of line.trains) this.stepTrain(line, t, dt);
    }

    if (this.focusActive) {
      s.focusSec += dt;
      s.focusProg += dt;
      if (s.focusProg >= FOCUS_TOKEN_SECONDS) {
        s.focusProg -= FOCUS_TOKEN_SECONDS;
        s.tokens++;
        this.emit('token', s.tokens);
      }
    }
  }

  // The stop a train is at or heading for. Express trains only stop at the ends.
  nextStop(line, g, s, dir) {
    const S = g.stopS, n = S.length, eps = 1e-6;
    if (line.express) return dir > 0 ? n - 1 : 0;
    if (dir > 0) { for (let i = 0; i < n; i++) if (S[i] > s + eps) return i; return n - 1; }
    for (let i = n - 1; i >= 0; i--) if (S[i] < s - eps) return i; return 0;
  }
  // the stop a train standing at s is at
  stopAt(g, s) {
    let best = 0, bd = Infinity;
    g.stopS.forEach((x, i) => { const d = Math.abs(x - s); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  stepTrain(line, t, dt) {
    t.boost = Math.max(0, (t.boost || 0) - dt * 0.06);
    if (t.wait > 0) {
      t.wait -= dt;
      if (t.wait <= 0) this.loadTrain(line, t);
      return;
    }
    const g = this.geom(line), L = g.len;
    const model = MODELS[t.m];
    const vmax = model.speed * this.speedMult() * (1 + t.boost);
    const acc = model.speed / 3;
    const s = t.p * L;
    const next = this.nextStop(line, g, s, t.dir);
    const remaining = Math.abs(g.stopS[next] - s);
    let v = Math.min((t.v || 0) + acc * dt, vmax, Math.sqrt(2 * acc * remaining));
    v = Math.max(v, 2);
    t.v = v;
    const d = v * dt;
    if (d >= remaining) {
      t.p = g.stopS[next] / L;
      t.v = 0;
      t.at = next;
      this.unloadTrain(line, t, next);
      const end = next === 0 || next === g.stopS.length - 1;
      if (end) t.dir = next === 0 ? 1 : -1;
      t.wait = end ? DWELL : DWELL_MID;
    } else {
      t.p += (t.dir * d) / L;
    }
  }

  // Pick up at the stop the train is standing at: each cargo goes to the
  // stops further along that want it (split between them; towns by size).
  loadTrain(line, t) {
    const g = this.geom(line), stops = this.stops(line);
    const i = t.at != null ? t.at : this.stopAt(g, t.p * g.len);
    t.at = i;
    if (!t.cargo) t.cargo = [];
    const from = stops[i];
    const ahead = [];
    if (line.express) { const e = t.dir > 0 ? stops.length - 1 : 0; if (e !== i) ahead.push(e); }
    else if (t.dir > 0) for (let j = i + 1; j < stops.length; j++) ahead.push(j);
    else for (let j = i - 1; j >= 0; j--) ahead.push(j);
    const st = this.state.ns[from].stock;
    let room = MODELS[t.m].cap - t.cargo.reduce((a, c) => a + c.amt, 0);
    const cargos = outputsOf(this.node(from).type).sort((x, y) => CARGO[y].rate - CARGO[x].rate);
    for (const c of cargos) {
      const dests = ahead.filter((j) => NODE_TYPES[this.node(stops[j]).type].accepts.includes(c));
      if (!dests.length || room <= 0) continue;
      const amt = Math.floor(Math.min(room, st[c] || 0));
      if (amt <= 0) continue;
      st[c] -= amt;
      room -= amt;
      const w = dests.map((j) => (this.node(stops[j]).type === 'town' ? Math.max(1, this.pop(stops[j])) : 1));
      const tot = w.reduce((a, b) => a + b, 0);
      let left = amt;
      dests.forEach((j, k) => {
        const part = k === dests.length - 1 ? left : Math.round((amt * w[k]) / tot);
        left -= part;
        if (part > 0) t.cargo.push({ c, amt: part, to: j, from: i });
      });
      if (NODE_TYPES[this.node(from).type].produces.includes(c) && this.node(from).type !== 'town') {
        this.state.ns[from].shipped += amt * this.growthMult();
      }
    }
    this.sumLoad(t);
  }

  sumLoad(t) {
    t.load = {};
    for (const c of t.cargo || []) t.load[c.c] = (t.load[c.c] || 0) + c.amt;
  }

  // Drop off at stop i whatever was bound for it, and get paid by how far it came.
  unloadTrain(line, t, i) {
    const g = this.geom(line), stops = this.stops(line);
    const at = stops[i];
    // trains from older saves carry a plain load bound for the far end
    if (!t.cargo) {
      t.cargo = [];
      for (const [c, amt] of Object.entries(t.load || {})) if (amt > 0) t.cargo.push({ c, amt, to: i, from: i === 0 ? stops.length - 1 : 0 });
    }
    const node = this.node(at);
    const def = NODE_TYPES[node.type];
    const ns = this.state.ns[at];
    const end = i === 0 || i === stops.length - 1;
    let pay = 0, total = 0;
    const keep = [];
    for (const item of t.cargo) {
      if (item.to !== i) { if (!end) keep.push(item); continue; }
      const { c, amt } = item;
      if (!amt || !def.accepts.includes(c)) continue;
      pay += amt * Math.abs(g.stopD[i] - g.stopD[item.from]) * CARGO[c].rate * this.revenueMult();
      total += amt;
      if (def.converts && def.converts[c]) {
        const out = def.converts[c];
        ns.stock[out] = Math.min(this.stockCap(at) * 2 + 200, (ns.stock[out] || 0) + amt);
      }
      if (node.type === 'town') ns.growth += amt * (c === 'pax' ? 0.3 : 1) * this.growthMult();
    }
    t.cargo = keep;
    this.sumLoad(t);
    if (!total) return;
    pay = Math.round(pay);
    this.state.money += pay;
    this.state.ema += pay;
    this.state.stats.earned += pay;
    this.state.stats.delivered += total;
    line.ema += pay;
    line.earned += pay;
    this.emit('deliver', { line, train: t, node, pay, total });
  }

  // Award progress for time spent closed/backgrounded.
  offline(seconds) {
    if (seconds < 30) return null;
    const s = this.state;
    const capSec = (8 + s.perks.offline) * 3600;
    const eff = Math.min(1, 0.5 + 0.1 * s.perks.offline);
    const secs = Math.min(seconds, capSec);
    const earn = Math.round((s.ema / EMA_WINDOW) * secs * eff);
    const prevYear = this.year();
    s.money += earn;
    s.stats.earned += earn;
    // the calendar moves slowly while away so new eras mostly arrive during play
    s.months += (secs / SECONDS_PER_MONTH) * 0.25;
    for (const m of MODELS) if (m.year > prevYear && m.year <= this.year()) this.emit('model', m);
    for (const n of this.world.nodes) {
      for (const c of NODE_TYPES[n.type].produces) s.ns[n.id].stock[c] = this.stockCap(n.id);
    }
    return { seconds, credited: secs, earn };
  }
}
