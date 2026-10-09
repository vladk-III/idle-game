// Game state and simulation. No DOM in here.
import {
  CARGO, NODE_TYPES, MODELS, LINE_COLORS, MONTHS, PERKS,
  SECONDS_PER_MONTH, FOCUS_TOKEN_SECONDS, outputsOf, TIERS, DISTRICT_NAMES, TRANSIT,
} from './data.js';
import { generateWorld, trackGeom } from './world.js';
import { noise1, clamp } from './rng.js';

const SAVE_KEY = 'branchline-save-v1';
const START_MONEY = 60000;
const TRACK_COST_PER_UNIT = 50;
const DWELL = 3;
const DWELL_MID = 2.2; // a shorter stop at stations along the way
const EMA_WINDOW = 120; // seconds
const XFER_CAP = 600; // most cargo a station will hold waiting to change lines

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
      contracts: [], nextContract: 1, contractCheck: 0,
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
    if (!this.state.contracts) { this.state.contracts = []; this.state.nextContract = 1; this.state.contractCheck = 0; }
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
    if (n.type === 'town') return (this.pop(id) / 25) * this.transitBoost(id);
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

  maxTrains(line) {
    const base = Math.min(8, 1 + Math.floor(this.geom(line).len / 90));
    return this.track(line).double ? Math.min(16, base * 2) : base;
  }

  // ---------- track upgrades ----------
  track(line) { return line.track || { double: false, speed: 0 }; }
  lineTrackCost(line) {
    const st = this.stops(line);
    let c = 0;
    for (let i = 0; i < st.length - 1; i++) c += this.trackCost(st[i], st[i + 1]);
    return c;
  }
  trackSpeedMult(line) { return 1 + 0.15 * this.track(line).speed; }
  // what the line's track upgrades add to the price of new track
  trackUpgradeFactor(line) {
    const t = this.track(line);
    let f = 1 + (t.double ? 0.7 : 0);
    for (let k = 0; k < t.speed; k++) f += 0.5 + 0.5 * k;
    return f;
  }
  doubleTrackCost(line) { return Math.round(this.lineTrackCost(line) * 0.7 / 100) * 100; }
  speedTrackCost(line) { const k = this.track(line).speed; return k >= 3 ? 0 : Math.round(this.lineTrackCost(line) * (0.5 + 0.5 * k) / 100) * 100; }
  upgradeTrack(line, kind) {
    const t = { ...this.track(line) };
    const cost = kind === 'double' ? (t.double ? 0 : this.doubleTrackCost(line)) : this.speedTrackCost(line);
    if (!cost || this.state.money < cost) return false;
    this.state.money -= cost;
    if (kind === 'double') t.double = true; else t.speed++;
    line.track = t;
    line.built = (line.built || 0) + cost;
    return true;
  }

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
  extendCost(line, end, id) { return Math.round(this.trackCost(end === 'a' ? line.a : line.b, id) * this.trackUpgradeFactor(line) / 100) * 100; }
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

    // city transit fares, and cities growing into new tiers
    for (const n of this.world.nodes) {
      if (n.type !== 'town') continue;
      const ns = s.ns[n.id];
      if (ns.transit && ns.transit.length) {
        const riders = this.transitRiders(n.id);
        let pay = 0;
        ns.transit.forEach((tl, i) => { const p = (riders[i] * TRANSIT[tl.mode].fare * this.revenueMult() / 60) * dt; tl.earned += p; pay += p; });
        s.money += pay; s.ema += pay; s.stats.earned += pay;
        ns.growth += (riders.reduce((a, b) => a + b, 0) / 60) * dt * 0.04 * this.growthMult();
      }
      const t = this.tier(n.id);
      if (ns.tier == null) ns.tier = t;
      else if (t > ns.tier) { ns.tier = t; this.emit('tier', { node: n, tier: t }); }
    }
    this.tickContracts();
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
    const tm = this.trackSpeedMult(line);
    const vmax = model.speed * this.speedMult() * tm * (1 + t.boost);
    const acc = (model.speed / 3) * tm;
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

  // ---------- transfers ----------
  // How far (straight km along the network of lines) each station is from the
  // nearest station that wants cargo c. Cargo only ever moves to a station
  // nearer a buyer, so it can't bounce back and forth. Cached until the lines change.
  netDist(c) {
    const key = this.state.lines.map((l) => this.stops(l).join('-')).join('|');
    if (this.netKey !== key) { this.netKey = key; this.net = {}; }
    if (this.net[c]) return this.net[c];
    const nodes = this.world.nodes, N = nodes.length;
    const d = new Array(N).fill(Infinity), done = new Array(N).fill(false);
    const adj = nodes.map(() => []);
    for (const l of this.state.lines) {
      const st = this.stops(l);
      for (let i = 0; i < st.length - 1; i++) {
        const a = this.node(st[i]), b = this.node(st[i + 1]), w = Math.hypot(a.x - b.x, a.y - b.y);
        adj[a.id].push([b.id, w]); adj[b.id].push([a.id, w]);
      }
    }
    for (const n of nodes) if (NODE_TYPES[n.type].accepts.includes(c)) d[n.id] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      for (const [v, w] of adj[u]) if (d[u] + w < d[v]) d[v] = d[u] + w;
    }
    this.net[c] = d;
    return d;
  }
  // cargo waiting at a station to change lines
  xfer(id) { const ns = this.state.ns[id]; return ns.xfer || (ns.xfer = {}); }

  // Pick up at the stop the train is standing at: each cargo goes to the
  // stops further along that want it (split between them; towns by size).
  // Cargo nobody on this line wants rides to the stop nearest a buyer on the
  // network, to change lines there.
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
    const st = this.state.ns[from].stock, xf = this.xfer(from);
    let room = MODELS[t.m].cap - t.cargo.reduce((a, c) => a + c.amt, 0);
    const outs = outputsOf(this.node(from).type);
    const cargos = [...new Set([...outs, ...Object.keys(xf).filter((c) => xf[c] >= 1)])].sort((x, y) => CARGO[y].rate - CARGO[x].rate);
    for (const c of cargos) {
      let dests = ahead.filter((j) => NODE_TYPES[this.node(stops[j]).type].accepts.includes(c));
      if (!dests.length) {
        const dist = this.netDist(c);
        let best = -1;
        for (const j of ahead) if (dist[stops[j]] < dist[from] - 1e-6 && (best < 0 || dist[stops[j]] < dist[stops[best]])) best = j;
        if (best >= 0) dests = [best];
      }
      if (!dests.length || room <= 0) continue;
      const fromX = Math.floor(Math.min(room, xf[c] || 0));
      const fromStock = outs.includes(c) ? Math.floor(Math.min(room - fromX, st[c] || 0)) : 0;
      const amt = fromX + fromStock;
      if (amt <= 0) continue;
      if (fromX) xf[c] -= fromX;
      if (fromStock) st[c] -= fromStock;
      room -= amt;
      const w = dests.map((j) => (this.node(stops[j]).type === 'town' ? Math.max(1, this.pop(stops[j])) : 1));
      const tot = w.reduce((a, b) => a + b, 0);
      let left = amt;
      dests.forEach((j, k) => {
        const part = k === dests.length - 1 ? left : Math.round((amt * w[k]) / tot);
        left -= part;
        if (part > 0) t.cargo.push({ c, amt: part, to: j, from: i });
      });
      if (fromStock && NODE_TYPES[this.node(from).type].produces.includes(c) && this.node(from).type !== 'town') {
        this.state.ns[from].shipped += fromStock * this.growthMult();
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
      if (!amt) continue;
      const legPay = amt * Math.abs(g.stopD[i] - g.stopD[item.from]) * CARGO[c].rate * this.revenueMult();
      if (!def.accepts.includes(c)) {
        // changing lines here: it waits on the platform for the next leg
        const xf = this.xfer(at);
        xf[c] = Math.min(XFER_CAP, (xf[c] || 0) + amt);
        pay += legPay;
        continue;
      }
      pay += legPay;
      total += amt;
      this.contractProgress(at, c, amt);
      if (def.converts && def.converts[c]) {
        const out = def.converts[c];
        ns.stock[out] = Math.min(this.stockCap(at) * 2 + 200, (ns.stock[out] || 0) + amt);
      }
      if (node.type === 'town') ns.growth += amt * (c === 'pax' ? 0.3 : 1) * this.growthMult();
    }
    t.cargo = keep;
    this.sumLoad(t);
    if (!pay) return;
    pay = Math.round(pay);
    this.state.money += pay;
    this.state.ema += pay;
    this.state.stats.earned += pay;
    this.state.stats.delivered += total;
    line.ema += pay;
    line.earned += pay;
    this.emit('deliver', { line, train: t, node, pay, total });
  }

  // ---------- contracts ----------
  // Up to three at a time, always for a station your lines already reach.
  contractProgress(at, c, amt) {
    for (const k of this.state.contracts) {
      if (k.node !== at || k.cargo !== c) continue;
      k.got = Math.min(k.amount, k.got + amt);
      if (k.got >= k.amount) {
        this.state.money += k.money;
        this.state.tokens += k.tokens;
        this.state.stats.earned += k.money;
        this.state.contracts = this.state.contracts.filter((x) => x !== k);
        this.emit('contract', { k, done: true });
      }
    }
  }
  makeContract() {
    const served = new Set();
    for (const l of this.state.lines) for (const id of this.stops(l)) served.add(id);
    const options = [];
    for (const id of served) {
      const n = this.node(id);
      for (const c of NODE_TYPES[n.type].accepts) {
        if (this.state.contracts.some((k) => k.node === id && k.cargo === c)) continue;
        const dist = this.netDist(c);
        // something on the network must be able to bring it
        const ok = this.world.nodes.some((m) => m.id !== id && outputsOf(m.type).includes(c) && served.has(m.id) && dist[m.id] < Infinity);
        if (ok) options.push({ id, c });
      }
    }
    if (!options.length) return null;
    const pick = options[Math.floor(Math.random() * options.length)];
    const growth = 1 + (this.year() - 1850) / 30;
    const amount = Math.round(((pick.c === 'pax' ? 240 : 160) * growth * (0.7 + Math.random() * 0.6)) / 10) * 10;
    const money = Math.round(Math.max(amount * CARGO[pick.c].rate * 500, this.incomePerMin() * 5) / 100) * 100;
    const k = {
      id: this.state.nextContract++, node: pick.id, cargo: pick.c, amount, got: 0,
      due: this.state.months + 12, money, tokens: this.state.nextContract % 3 === 0 ? 1 : 0,
    };
    this.state.contracts.push(k);
    this.emit('contract', { k, offered: true });
    return k;
  }
  tickContracts() {
    const s = this.state;
    if (s.months < s.contractCheck) return;
    s.contractCheck = s.months + 0.5;
    for (const k of s.contracts.slice()) {
      if (s.months > k.due) { s.contracts = s.contracts.filter((x) => x !== k); this.emit('contract', { k, expired: true }); }
    }
    if (s.contracts.length < 3 && s.lines.length) this.makeContract();
  }

  // ---------- cities ----------
  tier(id) {
    const p = this.pop(id);
    let t = 0;
    TIERS.forEach((x, i) => { if (p >= x.min) t = i; });
    return t;
  }
  // Districts of a city, as offsets in units of the town's radius (fixed per town).
  districts(id) {
    const t = this.tier(id);
    if (t < 2) return [];
    const k = t >= 3 ? 7 : 5;
    const out = [{ name: DISTRICT_NAMES[0], dx: 0, dy: 0 }];
    const rot = (id * 1.37) % (Math.PI * 2);
    for (let i = 1; i < k; i++) {
      const a = rot + ((i - 1) / (k - 1)) * Math.PI * 2;
      out.push({ name: DISTRICT_NAMES[i], dx: Math.cos(a) * 0.68, dy: Math.sin(a) * 0.6 });
    }
    return out;
  }
  transit(id) { const ns = this.state.ns[id]; return ns.transit || (ns.transit = []); }
  transitModes(id) {
    const t = this.tier(id), y = this.year();
    return Object.entries(TRANSIT).filter(([, m]) => y >= m.year && t >= m.tier).map(([k]) => k);
  }
  transitCost(mode, stops) { return TRANSIT[mode].cost * Math.max(1, stops.length - 1); }
  buildTransit(id, mode, stops) {
    if (stops.length < 2 || !this.transitModes(id).includes(mode)) return false;
    const cost = this.transitCost(mode, stops);
    if (this.state.money < cost) return false;
    this.state.money -= cost;
    this.transit(id).push({ mode, d: stops.slice(), v: 1, earned: 0 });
    this.emit('transit', { id, mode });
    return true;
  }
  addTransitVehicle(id, i) {
    const tl = this.transit(id)[i];
    if (!tl || this.state.money < TRANSIT[tl.mode].veh) return false;
    this.state.money -= TRANSIT[tl.mode].veh;
    tl.v++;
    return true;
  }
  // riders per minute on each transit line of a city: demand grows with the
  // city and the districts served; capacity with vehicles
  transitRiders(id) {
    const lines = this.transit(id);
    if (!lines.length) return [];
    const pop = this.pop(id);
    const want = lines.map((tl) => pop * 0.025 * (tl.d.length - 1));
    const total = want.reduce((a, b) => a + b, 0), limit = pop * 0.12;
    const k = total > limit ? limit / total : 1;
    return lines.map((tl, i) => Math.min(want[i] * k, tl.v * TRANSIT[tl.mode].cap));
  }
  transitIncome(id) {
    const r = this.transitRiders(id);
    return this.transit(id).reduce((a, tl, i) => a + r[i] * TRANSIT[tl.mode].fare * this.revenueMult(), 0);
  }
  // transit brings more people to the railway station
  transitBoost(id) { return 1 + 0.12 * Math.min(4, (this.state.ns[id].transit || []).length); }

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
