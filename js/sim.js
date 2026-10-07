// Game state and simulation. No DOM in here.
import {
  CARGO, NODE_TYPES, MODELS, LINE_COLORS, MONTHS, PERKS,
  SECONDS_PER_MONTH, FOCUS_TOKEN_SECONDS, outputsOf,
} from './data.js';
import { generateWorld, trackGeom } from './world.js';

const SAVE_KEY = 'branchline-save-v1';
const START_MONEY = 60000;
const TRACK_COST_PER_UNIT = 50;
const DWELL = 3;
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

  availableModels() {
    const y = this.year();
    return MODELS.map((m, i) => ({ ...m, i })).filter((m) => m.year <= y);
  }
  newestModel() { const a = this.availableModels(); return a[a.length - 1]; }

  geom(line) {
    let g = this.geoms.get(line.id);
    if (!g) {
      g = trackGeom(this.node(line.a), this.node(line.b));
      this.geoms.set(line.id, g);
    }
    return g;
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

  maxTrains(line) { return Math.min(6, 1 + Math.floor(this.geom(line).len / 90)); }

  linesAt(id) { return this.state.lines.filter((l) => l.a === id || l.b === id); }
  lineBetween(a, b) { return this.state.lines.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a)); }

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
      id: this.state.nextLineId++, a, b,
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

  closeLine(line) {
    const refund = Math.round(this.trackCost(line.a, line.b) * 0.25) +
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
    const remaining = t.dir > 0 ? (1 - t.p) * L : t.p * L;
    let v = Math.min((t.v || 0) + acc * dt, vmax, Math.sqrt(2 * acc * remaining));
    v = Math.max(v, 2);
    t.v = v;
    const d = v * dt;
    if (d >= remaining) {
      t.p = t.dir > 0 ? 1 : 0;
      t.v = 0;
      this.unloadTrain(line, t, t.dir > 0 ? line.b : line.a);
      t.dir = -t.dir;
      t.wait = DWELL;
    } else {
      t.p += (t.dir * d) / L;
    }
  }

  loadTrain(line, t) {
    const from = t.dir > 0 ? line.a : line.b;
    const to = t.dir > 0 ? line.b : line.a;
    const st = this.state.ns[from].stock;
    const cargos = this.flow(from, to).sort((x, y) => CARGO[y].rate - CARGO[x].rate);
    let room = MODELS[t.m].cap;
    t.load = {};
    for (const c of cargos) {
      const amt = Math.floor(Math.min(room, st[c] || 0));
      if (amt <= 0) continue;
      st[c] -= amt;
      t.load[c] = amt;
      room -= amt;
      if (NODE_TYPES[this.node(from).type].produces.includes(c) && this.node(from).type !== 'town') {
        this.state.ns[from].shipped += amt * this.growthMult();
      }
    }
  }

  unloadTrain(line, t, at) {
    const g = this.geom(line);
    const node = this.node(at);
    const def = NODE_TYPES[node.type];
    const ns = this.state.ns[at];
    let pay = 0, total = 0;
    for (const [c, amt] of Object.entries(t.load)) {
      if (!amt || !def.accepts.includes(c)) continue;
      pay += amt * g.straight * CARGO[c].rate * this.revenueMult();
      total += amt;
      if (def.converts && def.converts[c]) {
        const out = def.converts[c];
        ns.stock[out] = Math.min(this.stockCap(at) * 2 + 200, (ns.stock[out] || 0) + amt);
      }
      if (node.type === 'town') ns.growth += amt * (c === 'pax' ? 0.3 : 1) * this.growthMult();
    }
    t.load = {};
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
