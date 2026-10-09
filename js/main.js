// UI glue: boots the game, runs the loop, drives sheets, focus mode and saving.
import { Game } from './sim.js';
import { MapView } from './map.js';
import { Ride } from './ride.js';
import { CARGO, NODE_TYPES, MODELS, PERKS, PERK_MAX, perkCost, FOCUS_TOKEN_SECONDS, outputsOf, TIERS, TRANSIT } from './data.js';
import { WORLD_W, WORLD_H } from './world.js';

const $ = (id) => document.getElementById(id);
const game = new Game();
// Running inside the Android app (Capacitor) rather than a browser?
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const focusMapCanvas = $('focusMap');
const focusMapCtx = focusMapCanvas.getContext('2d');

// ---------- formatting ----------
function money(n) {
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n < 1000) return `${sign}$${Math.round(n)}`;
  const units = [['T', 1e12], ['B', 1e9], ['M', 1e6], ['k', 1e3]];
  for (const [u, v] of units) if (n >= v) return `${sign}$${(n / v).toFixed(n / v < 10 ? 2 : n / v < 100 ? 1 : 0)}${u}`;
}
const km = (u) => `${Math.round(u / 10)} km`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hms = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);
const cargoIcons = (list) => (list.length ? list.map((c) => CARGO[c].icon).join(' ') : '—');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function haptic(ms = 8) {
  if (game.state.settings.haptics && navigator.vibrate) navigator.vibrate(ms);
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- boot ----------
if (!game.load()) game.newGame();

const map = new MapView($('map'), game, {
  onNode: (id) => {
    if (map.connectFrom != null) return pickConnectTarget(id);
    selectNode(id);
  },
  onLine: (id) => { if (map.connectFrom == null) showLine(id); },
  onEmpty: () => { if (map.connectFrom == null) closeSheet(); },
});
map.buildTerrain();
const ride = new Ride($('ride'), game);
ride.quality = game.state.settings.lowgfx ? 0.64 : 1; // see applyQuality()
ride.terrain = map.terrain;
window.branchline = { game, map, ride }; // handy for debugging from the console

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  map.resize(w, h);
  ride.resize(w, h);
  resizeFocusMap(w, h);
}
window.addEventListener('resize', resize);
resize();

game.on((type, data) => {
  if (type === 'deliver') {
    map.addFloat(data.node.x, data.node.y, '+' + money(data.pay));
    ride.onDeliver(data);
  } else if (type === 'model') {
    toast(`🚂 New locomotive: ${data.name}`);
  } else if (type === 'token') {
    toast('◉ Focus token earned!');
    haptic([20, 60, 20]);
  } else if (type === 'built') {
    if (game.state.tut < 2) setTut(2);
  } else if (type === 'contract') {
    const k = data.k, where = game.node(k.node).name, what = `${k.amount} ${CARGO[k.cargo].icon}`;
    if (data.done) { toast(`📜 Contract done: ${what} to ${where} · +${money(k.money)}${k.tokens ? ` +◉${k.tokens}` : ''}`); haptic([20, 60, 20]); }
    else if (data.expired) toast(`📜 Contract expired: ${what} to ${where}`);
    else if (data.offered) toast(`📜 New contract: bring ${what} to ${where}`);
  } else if (type === 'tier') {
    toast(`🏙️ ${data.node.name} is now a ${TIERS[data.tier].name}!`);
    haptic([20, 40, 20]);
  } else if (type === 'transit') {
    toast(`${TRANSIT[data.mode].icon} ${TRANSIT[data.mode].name} line opened`);
  }
});

// away earnings on cold start
showAway(game.offline((Date.now() - game.state.lastSeen) / 1000));

function showAway(res) {
  if (!res || res.seconds < 60) return;
  const capped = res.credited < res.seconds ? `<div class="note">Capped at ${hms(res.credited)} — upgrade Night Shift for more.</div>` : '';
  modal(`
    <h3>Welcome back</h3>
    <div class="note">Your trains kept running for ${hms(res.seconds)}.</div>
    <div class="big">+${money(res.earn)}</div>
    ${capped}
    <div class="btns"><button class="btn primary" data-act="modal-close">Nice</button></div>`);
}

function modal(html) {
  $('modalBody').innerHTML = html;
  $('modal').hidden = false;
}
$('modal').addEventListener('click', (e) => {
  if (e.target.closest('[data-act="modal-close"]') || e.target === $('modal')) $('modal').hidden = true;
});

// ---------- tutorial ----------
const TUT = [
  'Tap a town on the map to select it.',
  'Tap <b>Build line</b>, then pick another town to connect.',
  'Trains run themselves. When class needs your attention, tap <b>Focus</b> 🎧',
];
function setTut(i) { game.state.tut = i; renderTut(); }
function renderTut() {
  const i = game.state.tut;
  const b = $('banner');
  if (map.connectFrom != null) {
    b.hidden = false;
    b.innerHTML = map.extend
      ? `<span>Pick the next stop after <b>${esc(game.node(map.connectFrom).name)}</b></span><button data-act="cancel-connect">Cancel</button>`
      : `<span>Pick a destination for a line from <b>${esc(game.node(map.connectFrom).name)}</b></span><button data-act="cancel-connect">Cancel</button>`;
    return;
  }
  if (i >= TUT.length) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `<span>${TUT[i]}</span><button data-act="tut-skip">Got it</button>`;
}
$('banner').addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'cancel-connect') cancelConnect();
  if (a.dataset.act === 'tut-skip') setTut(game.state.tut + 1);
});
renderTut();

// ---------- sheet ----------
let sheet = null; // { build: () => html, update?: () => void }
let transitDraft = null; // { id, mode, stops } while planning a city transit line

function openSheet(build, update) {
  sheet = { build, update };
  $('sheetBody').innerHTML = build();
  $('sheet').classList.add('open');
  updateSheet();
  syncHistory();
}
function rerender() { if (sheet) { $('sheetBody').innerHTML = sheet.build(); updateSheet(); } }
function closeSheet() {
  sheet = null;
  transitDraft = null;
  $('sheet').classList.remove('open');
  map.selected = null;
  map.selectedLine = null;
  syncHistory();
}

// The phone's back button (or gesture) closes Focus mode, a panel or a half-built
// line instead of leaving the game. While anything is open we keep one extra
// history entry; going back pops it and closes the top thing.
let ignorePop = false;
function syncHistory() {
  const open = focusOn || !!sheet || map.connectFrom != null;
  if (open && !(history.state && history.state.ui)) history.pushState({ ui: 1 }, '');
  // (only one step back at a time: a second one before the first lands would leave the app)
  else if (!open && history.state && history.state.ui && !ignorePop) { ignorePop = true; history.back(); }
}
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; syncHistory(); return; }
  if (focusOn) exitFocus();
  else if (sheet) closeSheet();
  else if (map.connectFrom != null) cancelConnect();
  syncHistory();
});
function updateSheet() {
  if (!sheet) return;
  sheet.update?.();
  for (const b of $('sheetBody').querySelectorAll('[data-cost]')) {
    b.disabled = game.state.money < Number(b.dataset.cost) || b.dataset.block === '1';
  }
}
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

$('sheet').addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const id = Number(a.dataset.id);
  const act = a.dataset.act;
  const actions = {
    close: closeSheet,
    connect: () => startConnect(id),
    node: () => selectNode(id),
    line: () => showLine(id),
    build: () => {
      const line = game.buildLine(Number(a.dataset.a), Number(a.dataset.b));
      if (line) { haptic(15); toast('🛤️ Line opened!'); showLine(line.id); }
    },
    extend: () => startExtend(id, a.dataset.end),
    'do-extend': () => {
      const line = game.line(id);
      if (line && game.extendLine(line, a.dataset.end, Number(a.dataset.to))) { haptic(15); toast('🛤️ Line extended!'); showLine(id); }
    },
    'track-double': () => { if (game.upgradeTrack(game.line(id), 'double')) { haptic(15); toast('🛤️🛤️ Double track laid: room for twice the trains'); rerender(); } },
    'track-speed': () => { if (game.upgradeTrack(game.line(id), 'speed')) { haptic(15); toast('⚡ Faster track laid'); rerender(); } },
    'transit-new': () => { transitDraft = { id, mode: game.transitModes(id)[0], stops: [] }; rerender(); },
    'transit-mode': () => { if (transitDraft) { transitDraft.mode = a.dataset.mode; rerender(); } },
    'transit-stop': () => {
      if (!transitDraft) return;
      const d = Number(a.dataset.d), st = transitDraft.stops;
      if (st[st.length - 1] === d) st.pop(); else if (!st.includes(d)) st.push(d);
      rerender();
    },
    'transit-build': () => {
      if (transitDraft && game.buildTransit(transitDraft.id, transitDraft.mode, transitDraft.stops)) { haptic(15); transitDraft = null; rerender(); }
    },
    'transit-cancel': () => { transitDraft = null; rerender(); },
    'transit-ride': () => { closeSheet(); ride.rideTransit(id, Number(a.dataset.i)); enterFocus(); setScene('transit', true); },
    'transit-veh': () => { if (game.addTransitVehicle(id, Number(a.dataset.i))) { haptic(); rerender(); } },
    express: () => { const on = game.toggleExpress(game.line(id)); toast(on ? '⚡ Express: trains run end to end' : '🚉 Stopping at every station'); rerender(); },
    'add-train': () => { if (game.addTrain(game.line(id))) { haptic(); rerender(); } },
    'sell-train': () => { if (game.sellTrain(game.line(id))) rerender(); },
    upgrade: () => { if (game.upgradeLine(game.line(id))) { haptic(15); toast('✨ Trains upgraded'); rerender(); } },
    'close-line': () => {
      if (a.dataset.confirm !== '1') { a.dataset.confirm = '1'; a.textContent = 'Tap again to close this line'; return; }
      const refund = game.closeLine(game.line(id));
      toast(`Line closed (+${money(refund)})`);
      closeSheet();
    },
    watch: () => { closeSheet(); enterFocus(id); },
    perk: () => { if (game.buyPerk(a.dataset.perk)) { haptic(15); rerender(); } },
    haptics: () => { game.state.settings.haptics = a.checked; },
    smooth: () => { game.state.settings.smooth = a.checked; },
    gl: () => { game.state.settings.gl = a.checked; game.save(); location.reload(); },
    fps: () => { game.state.settings.fps = a.checked; fpsEl.hidden = !a.checked; },
    lowgfx: () => { game.state.settings.lowgfx = a.checked; qLevel = 0; qTimer = 0; applyQuality(); },
    export: () => {
      const ta = $('saveText');
      ta.value = btoa(unescape(encodeURIComponent(game.export())));
      ta.select();
      navigator.clipboard?.writeText(ta.value).then(() => toast('Save copied to clipboard'), () => {});
    },
    import: () => {
      try {
        const raw = decodeURIComponent(escape(atob($('saveText').value.trim())));
        if (!game.import(raw)) throw new Error('bad save');
        afterWorldChange();
        toast('Save loaded');
      } catch { toast('That save code did not work'); }
    },
    reset: () => {
      if (a.dataset.confirm !== '1') { a.dataset.confirm = '1'; a.textContent = 'Tap again to erase everything'; return; }
      game.reset();
      afterWorldChange();
      toast('New map generated');
    },
  };
  actions[act]?.();
});
$('sheet').addEventListener('input', (e) => {
  if (e.target.id === 'dimRange') {
    game.state.settings.dim = Number(e.target.value);
  }
});

function afterWorldChange() {
  closeSheet();
  map.fitted = false;
  map.buildTerrain();
  ride.terrain = map.terrain;
  ride.routes.clear();
  resize();
  renderTut();
  game.save();
}

// ---------- node sheet ----------
function selectNode(id) {
  const n = game.node(id);
  const def = NODE_TYPES[n.type];
  map.selected = id;
  map.selectedLine = null;
  if (game.state.tut === 0) setTut(1);
  const outs = outputsOf(n.type);
  openSheet(() => {
    const lines = game.linesAt(id);
    const isTown = n.type === 'town';
    const lvl = game.level(id);
    const statA = isTown
      ? `<div class="stat"><div class="k">${TIERS[game.tier(id)].name} · population</div><div class="v" id="lv-pop"></div></div>`
      : `<div class="stat"><div class="k">${def.produces.length ? 'Level' : 'Role'}</div><div class="v">${def.produces.length ? '★'.repeat(lvl) : def.converts ? 'Processor' : 'Consumer'}</div></div>`;
    const statB = outs.length
      ? `<div class="stat"><div class="k">${def.converts ? 'Output waiting' : 'Waiting'}</div><div class="v" id="lv-stock"></div></div>`
      : `<div class="stat"><div class="k">Accepts</div><div class="v">${cargoIcons(def.accepts)}</div></div>`;
    let explain = '';
    if (isTown) explain = 'Towns send passengers to other towns and grow when you deliver food 🥫 and goods 📦.';
    else if (n.type === 'farm') explain = 'Ship grain 🌾 to a Food Plant. Industries level up the more you ship.';
    else if (n.type === 'forest') explain = 'Ship logs 🪵 to a Sawmill. Industries level up the more you ship.';
    else if (n.type === 'mine') explain = 'Ship coal 🪨 to a Power Plant. Industries level up the more you ship.';
    else if (n.type === 'foodplant') explain = 'Turns grain 🌾 into food 🥫 — then send that food to towns.';
    else if (n.type === 'sawmill') explain = 'Turns logs 🪵 into goods 📦 — then send those goods to towns.';
    else if (n.type === 'power') explain = 'Buys all the coal 🪨 you can bring.';
    return `
      <h2>${def.icon} ${esc(n.name)}</h2>
      <div class="sub">${def.name}${outs.length ? ` · makes ${cargoIcons(outs)}` : ''}${def.accepts.length ? ` · accepts ${cargoIcons(def.accepts)}` : ''}</div>
      <div class="stats">${statA}${statB}</div>
      <div class="note">${explain}</div>
      ${lines.length ? `<div class="section">Lines</div><div class="tags">${lines.map((l) => {
        const names = game.stops(l).filter((s) => s !== id).map((s) => game.node(s).name).join(', ');
        return `<button class="tag" data-act="line" data-id="${l.id}"><span class="dot" style="background:${l.color}"></span> ${esc(names)}</button>`;
      }).join('')}</div>` : ''}
      ${nodeExtras(id)}
      <div class="btns"><button class="btn primary" data-act="connect" data-id="${id}">🛤️ Build line from here</button></div>`;
  }, () => {
    setText('lv-pop', game.pop(id).toLocaleString());
    const st = game.nodeState(id).stock;
    setText('lv-stock', outs.map((c) => `${CARGO[c].icon} ${Math.floor(st[c] || 0)}`).join('  ') || '—');
  });
}

// ---------- connecting ----------
function startConnect(id) {
  map.connectFrom = id;
  map.selected = id;
  closeSheetKeepSelection();
  renderTut();
  syncHistory();
}
function closeSheetKeepSelection() { sheet = null; $('sheet').classList.remove('open'); }
function cancelConnect() { map.connectFrom = null; map.extend = null; map.selected = null; renderTut(); syncHistory(); }

// Extending a line: pick the next station from one of its ends.
function startExtend(lineId, end) {
  const line = game.line(lineId);
  if (!line) return;
  map.extend = { line: lineId, end };
  startConnect(end === 'a' ? line.a : line.b);
}

function pickExtendTarget(id) {
  const { line: lineId, end } = map.extend;
  const line = game.line(lineId);
  map.connectFrom = null; map.extend = null;
  renderTut();
  if (!line) return;
  const stops = game.stops(line);
  if (stops.includes(id)) { toast('That station is already on this line'); return showLine(lineId); }
  const fromId = end === 'a' ? line.a : line.b;
  const a = game.node(fromId), b = game.node(id);
  const cost = game.extendCost(line, end, id);
  const before = new Set(game.lineCargo(line));
  const after = game.lineCargo({ ...line, stops: end === 'a' ? [id, ...stops] : [...stops, id] });
  const added = after.filter((c) => !before.has(c));
  map.selected = id;
  openSheet(() => `
      <h2>Extend line</h2>
      <div class="sub">${esc(a.name)} → ${esc(b.name)} · ${km(Math.hypot(a.x - b.x, a.y - b.y))}</div>
      <div class="note">Trains will run on through ${esc(a.name)} to ${esc(b.name)}, stopping at every station on the way (unless the line is express). Cargo can go between any two stops.</div>
      <div class="stats">
        <div class="stat"><div class="k">Line will carry</div><div class="v">${cargoIcons(after)}</div></div>
        <div class="stat"><div class="k">New</div><div class="v">${added.length ? cargoIcons(added) : '—'}</div></div>
      </div>
      <div class="btns">
        <button class="btn primary" data-act="do-extend" data-id="${lineId}" data-end="${end}" data-to="${id}" data-cost="${cost}">Extend for ${money(cost)}</button>
        <button class="btn" data-act="close">Cancel</button>
      </div>`);
}

function pickConnectTarget(id) {
  const from = map.connectFrom;
  if (id === from) return cancelConnect();
  if (map.extend) return pickExtendTarget(id);
  map.connectFrom = null;
  renderTut();
  const a = game.node(from), b = game.node(id);
  const ab = game.flow(from, id), ba = game.flow(id, from);
  const exists = game.lineBetween(from, id);
  const track = game.trackCost(from, id);
  const model = game.newestModel();
  const total = track + model.cost;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  map.selected = id;
  openSheet(() => {
    let warn = '';
    if (exists) warn = `<div class="warn">These two are already connected.</div>`;
    else if (!ab.length && !ba.length) warn = `<div class="warn">Nothing to carry between these two. Try town ↔ town for passengers, or a farm → food plant → town chain.</div>`;
    const blocked = exists || (!ab.length && !ba.length);
    return `
      <h2>New line</h2>
      <div class="sub">${esc(a.name)} ↔ ${esc(b.name)} · ${km(dist)}</div>
      <div class="stats">
        <div class="stat"><div class="k">${esc(a.name)} →</div><div class="v">${cargoIcons(ab)}</div></div>
        <div class="stat"><div class="k">← ${esc(b.name)}</div><div class="v">${cargoIcons(ba)}</div></div>
      </div>
      ${warn}
      <div class="note">Track ${money(track)} + ${esc(model.name)} ${money(model.cost)}</div>
      <div class="btns">
        <button class="btn primary" data-act="build" data-a="${from}" data-b="${id}" data-cost="${total}" data-block="${blocked ? 1 : 0}">Build for ${money(total)}</button>
        <button class="btn" data-act="close">Cancel</button>
      </div>`;
  });
}

// ---------- line sheet ----------
function showLine(id) {
  const line = game.line(id);
  if (!line) return closeSheet();
  map.selected = null;
  map.selectedLine = id;
  openSheet(() => {
    const g = game.geom(line);
    const stops = game.stops(line);
    const nm = game.newestModel();
    const max = game.maxTrains(line);
    const counts = {};
    for (const t of line.trains) counts[t.m] = (counts[t.m] || 0) + 1;
    const fleet = Object.entries(counts).map(([m, c]) => `${c}× ${MODELS[m].name}`).join(', ') || 'No trains';
    const upCost = game.upgradeCost(line);
    const cargo = game.lineCargo(line);
    const ends = [game.node(line.a).name, game.node(line.b).name];
    return `
      <h2><span class="dot" style="background:${line.color}"></span>${esc(game.lineName(line))}</h2>
      <div class="sub">${km(g.straight)} · ${stops.length} stops · carries ${cargoIcons(cargo)}${line.express ? ' · ⚡ express' : ''}</div>
      <div class="stats">
        <div class="stat"><div class="k">Income</div><div class="v" id="lv-inc"></div></div>
        <div class="stat"><div class="k">Earned total</div><div class="v" id="lv-earn"></div></div>
      </div>
      <div class="row"><div class="grow"><div class="t">Trains ${line.trains.length} / ${max}</div><div class="s">${fleet}</div></div></div>
      <div class="btns">
        <button class="btn primary" data-act="add-train" data-id="${id}" data-cost="${nm.cost}" data-block="${line.trains.length >= max ? 1 : 0}">+ Add ${esc(nm.name)}<small>${money(nm.cost)}${line.trains.length >= max ? ' · line is full' : ''}</small></button>
        ${upCost ? `<button class="btn good" data-act="upgrade" data-id="${id}" data-cost="${upCost}">Upgrade all to ${esc(nm.name)}<small>${money(upCost)} after trade-in</small></button>` : ''}
        <button class="btn" data-act="watch" data-id="${id}">🎧 Ride this line in Focus</button>
        <button class="btn" data-act="extend" data-id="${id}" data-end="a">🛤️ Extend from ${esc(ends[0])}</button>
        <button class="btn" data-act="extend" data-id="${id}" data-end="b">🛤️ Extend from ${esc(ends[1])}</button>
        ${trackButtons(line)}
        ${stops.length > 2 ? `<button class="btn" data-act="express" data-id="${id}">${line.express ? '🚉 Stop at every station' : '⚡ Make express (ends only, faster trips)'}</button>` : ''}
        ${line.trains.length ? `<button class="btn" data-act="sell-train" data-id="${id}">Sell a train<small>+${money(MODELS[line.trains[line.trains.length - 1].m].cost * 0.5)}</small></button>` : ''}
        <button class="btn danger" data-act="close-line" data-id="${id}">Close line</button>
      </div>`;
  }, () => {
    setText('lv-inc', money(game.lineIncomePerMin(line)) + '/min');
    setText('lv-earn', money(line.earned));
  });
}

// ---------- track, transit, contracts ----------
function trackButtons(line) {
  const t = game.track(line);
  const dc = game.doubleTrackCost(line), sc = game.speedTrackCost(line);
  return `<div class="section">Track</div>
    ${t.double ? `<div class="note">🛤️🛤️ Double track: up to ${game.maxTrains(line)} trains.</div>` : `<button class="btn" data-act="track-double" data-id="${line.id}" data-cost="${dc}">🛤️🛤️ Double track (room for twice the trains)<small>${money(dc)}</small></button>`}
    ${t.speed >= 3 ? `<div class="note">⚡ Fastest track (+${Math.round((game.trackSpeedMult(line) - 1) * 100)}% speed).</div>` : `<button class="btn" data-act="track-speed" data-id="${line.id}" data-cost="${sc}">⚡ Faster track, level ${t.speed + 1} of 3 (+15% speed)<small>${money(sc)}</small></button>`}`;
}


function nodeExtras(id) {
  const n = game.node(id);
  let html = '';
  const xf = game.xfer(id), waiting = Object.keys(xf).filter((c) => xf[c] >= 1);
  if (waiting.length) html += `<div class="note">🔁 Waiting to change lines: ${waiting.map((c) => `${CARGO[c].icon} ${Math.floor(xf[c])}`).join('  ')}</div>`;
  const ks = game.state.contracts.filter((k) => k.node === id);
  if (ks.length) html += `<div class="section">Contracts here</div>` + ks.map(contractRow).join('');
  if (n.type !== 'town') return html;
  const tier = game.tier(id), ds = game.districts(id), lines = game.transit(id);
  html += `<div class="section">City transit</div>`;
  if (tier < 2) {
    return html + `<div class="note">Grows into a City at ${TIERS[2].min.toLocaleString()} people (now ${game.pop(id).toLocaleString()}): then you can build buses, light rail and a metro here. Deliver food 🥫, goods 📦 and passengers to help it grow.</div>`;
  }
  const riders = game.transitRiders(id);
  html += lines.map((tl, i) => {
    const m = TRANSIT[tl.mode];
    return `<div class="row"><div style="font-size:22px">${m.icon}</div>
      <div class="grow"><div class="t">${m.name}: ${tl.d.map((d) => esc(ds[d] ? ds[d].name : '?')).join(' – ')}</div>
      <div class="s">${tl.v} vehicle${tl.v === 1 ? '' : 's'} · ${Math.round(riders[i])} riders/min · ${money(riders[i] * m.fare)}/min</div></div>
      <button class="btn" style="padding:8px 10px" data-act="transit-ride" data-id="${id}" data-i="${i}">🎧 Ride</button>
      <button class="btn" style="padding:8px 10px" data-act="transit-veh" data-id="${id}" data-i="${i}" data-cost="${m.veh}">+1<small>${money(m.veh)}</small></button></div>`;
  }).join('');
  if (!transitDraft || transitDraft.id !== id) {
    html += `<div class="note">Transit earns fares, helps the city grow and brings more passengers to your trains.</div>
      <div class="btns"><button class="btn good" data-act="transit-new" data-id="${id}">🚌 Plan a transit line</button></div>`;
    return html;
  }
  const modes = game.transitModes(id), d = transitDraft;
  const cost = d.stops.length >= 2 ? game.transitCost(d.mode, d.stops) : 0;
  html += `<div class="tags">${Object.entries(TRANSIT).map(([k, m]) => {
    const ok = modes.includes(k);
    const why = ok ? '' : game.year() < m.year ? ` (from ${m.year})` : ' (Metropolis)';
    return `<button class="tag" data-act="transit-mode" data-id="${id}" data-mode="${k}" ${ok ? '' : 'disabled'} style="${d.mode === k ? 'outline:3px solid #2b2140' : ''}">${m.icon} ${m.name}${why}</button>`;
  }).join('')}</div>
    <div class="note">Tap districts in order (tap the last again to undo):</div>
    <div class="tags">${ds.map((x, i) => `<button class="tag" data-act="transit-stop" data-id="${id}" data-d="${i}" style="${d.stops.includes(i) ? `background:${TRANSIT[d.mode].color};color:#fff` : ''}">${d.stops.includes(i) ? d.stops.indexOf(i) + 1 + '. ' : ''}${esc(x.name)}</button>`).join('')}</div>
    <div class="btns">
      <button class="btn primary" data-act="transit-build" data-id="${id}" data-cost="${cost}" data-block="${d.stops.length < 2 ? 1 : 0}">Build ${TRANSIT[d.mode].name}${cost ? ` · ${money(cost)}` : ' (pick 2+ districts)'}</button>
      <button class="btn" data-act="transit-cancel" data-id="${id}">Cancel</button>
    </div>`;
  return html;
}

function contractRow(k) {
  const left = Math.max(0, Math.ceil(k.due - game.state.months));
  const pct = Math.round((k.got / k.amount) * 100);
  return `<div class="row"><div style="font-size:22px">📜</div>
    <div class="grow"><div class="t">Bring ${k.amount} ${CARGO[k.cargo].icon} to ${esc(game.node(k.node).name)}</div>
    <div class="s">${k.got}/${k.amount} · ${left} month${left === 1 ? '' : 's'} left · reward ${money(k.money)}${k.tokens ? ` + ◉${k.tokens}` : ''}</div>
    <div style="height:6px;border-radius:3px;background:rgba(0,0,0,0.12);margin-top:4px"><div style="height:6px;border-radius:3px;width:${pct}%;background:#4fc999"></div></div></div></div>`;
}
function contractsHtml() {
  const ks = game.state.contracts;
  return `<div class="section">📜 Contracts</div>` + (ks.length ? ks.map(contractRow).join('') : `<div class="note">New contracts appear every few weeks for stations your lines serve.</div>`);
}

// ---------- lists ----------
function showLines() {
  map.selected = null; map.selectedLine = null;
  openSheet(() => {
    const ls = game.state.lines;
    if (!ls.length) return `<h2>Lines</h2><div class="note">No lines yet. Tap a town on the map, then <b>Build line from here</b>.</div>`;
    return `<h2>Lines</h2><div class="sub">${ls.length} lines · ${ls.reduce((s, l) => s + l.trains.length, 0)} trains</div>` + contractsHtml() +
      `<div class="section">Lines</div>` +
      ls.map((l) => `
        <div class="row click" data-act="line" data-id="${l.id}">
          <span class="dot" style="background:${l.color}"></span>
          <div class="grow"><div class="t">${esc(game.lineName(l))}${l.express ? ' ⚡' : ''}</div>
          <div class="s">${l.trains.length} train${l.trains.length === 1 ? '' : 's'} · ${cargoIcons(game.lineCargo(l))}</div></div>
          <div id="li-${l.id}" style="font-weight:900;color:#1f9e6e"></div>
        </div>`).join('');
  }, () => {
    for (const l of game.state.lines) setText(`li-${l.id}`, money(game.lineIncomePerMin(l)) + '/m');
  });
}

function showPerks() {
  map.selected = null; map.selectedLine = null;
  openSheet(() => `
    <h2>✨ Perks</h2>
    <div class="sub">You have <b id="lv-tok"></b> focus tokens. Earn one for every ${FOCUS_TOKEN_SECONDS / 60} minutes spent in Focus mode.</div>
    ${PERKS.map((p) => {
      const lvl = game.state.perks[p.id];
      const cost = perkCost(lvl);
      const maxed = lvl >= PERK_MAX;
      return `<div class="row"><div style="font-size:24px">${p.icon}</div>
        <div class="grow"><div class="t">${p.name} <span style="color:var(--muted);font-weight:500">Lv ${lvl}</span></div><div class="s">${p.desc}</div></div>
        <button class="btn primary" style="padding:8px 12px" data-act="perk" data-perk="${p.id}" data-tok="${cost}" ${maxed ? 'disabled' : ''}>${maxed ? 'Max' : `◉ ${cost}`}</button></div>`;
    }).join('')}
    <div class="note" style="margin-top:10px">Total focus time: <b id="lv-ftot"></b></div>`,
  () => {
    setText('lv-tok', game.state.tokens);
    setText('lv-ftot', hms(game.state.focusSec));
    for (const b of $('sheetBody').querySelectorAll('[data-tok]')) {
      const lvl = game.state.perks[b.dataset.perk];
      b.disabled = lvl >= PERK_MAX || game.state.tokens < Number(b.dataset.tok);
    }
  });
}

function showMenu() {
  map.selected = null; map.selectedLine = null;
  const st = game.state;
  openSheet(() => `
    <h2>⚙️ Menu</h2>
    <div class="sub">Branch Line · ${esc(game.dateLabel())}</div>
    <div class="stats">
      <div class="stat"><div class="k">Earned all-time</div><div class="v">${money(st.stats.earned)}</div></div>
      <div class="stat"><div class="k">Cargo delivered</div><div class="v">${Math.round(st.stats.delivered).toLocaleString()}</div></div>
    </div>
    <label class="toggle"><span>Vibration on tap</span><input type="checkbox" data-act="haptics" ${st.settings.haptics ? 'checked' : ''}></label>
    <label class="toggle"><span>Low graphics (faster on older phones)</span><input type="checkbox" data-act="lowgfx" ${st.settings.lowgfx ? 'checked' : ''}></label>
    <label class="toggle"><span>GPU graphics (much faster; turn off if Focus looks wrong)</span><input type="checkbox" data-act="gl" ${st.settings.gl !== false ? 'checked' : ''}></label>
    <label class="toggle"><span>Show frame rate in Focus mode</span><input type="checkbox" data-act="fps" ${st.settings.fps ? 'checked' : ''}></label>
    <label class="toggle"><span>Smooth animation (uses more battery)</span><input type="checkbox" data-act="smooth" ${st.settings.smooth ? 'checked' : ''}></label>
    <label class="toggle"><span>Focus mode dimming</span><input id="dimRange" type="range" min="0" max="0.7" step="0.05" value="${st.settings.dim}"></label>
    <div class="section">Install on your phone</div>
    <div class="note"><b>iPhone:</b> open in Safari → Share → <i>Add to Home Screen</i>.<br><b>Android:</b> Chrome menu ⋮ → <i>Install app</i>.<br>Once installed it works offline and opens full-screen.</div>
    <div class="section">Backup</div>
    <textarea id="saveText" placeholder="Paste a save code here to import"></textarea>
    <div class="btns">
      <button class="btn" data-act="export">Copy save code</button>
      <button class="btn" data-act="import">Load save code</button>
      <button class="btn danger" data-act="reset">New map (erase progress)</button>
    </div>
    <div class="section">Credits</div>
    <div class="note">Steam engines, wagons and rails adapted from <a href="https://kooky.itch.io/pixel-train" target="_blank" rel="noopener">Pixel Train</a> by <a href="https://kooky.itch.io/" target="_blank" rel="noopener">Kooky</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> (redrawn in the game's cartoon style). Landscapes inspired by <a href="https://craftpix.net" target="_blank" rel="noopener">CraftPix</a> pixel-art backgrounds (<a href="https://craftpix.net/file-licenses/" target="_blank" rel="noopener">licence</a>), painted in code.</div>`);
}

$('btnLines').onclick = showLines;
$('btnPerks').onclick = showPerks;
$('tokens').onclick = showPerks;
$('btnMenu').onclick = showMenu;
$('btnFocus').onclick = () => enterFocus();

// ---------- focus mode ----------
let focusOn = false;
const SCENES = {
  side: { icon: '🚂', name: 'Trackside view', hint: 'tap: steam · hold: whistle · swipe: other train' },
  passenger: { icon: '💺', name: 'Passenger view', hint: 'drag: look around · tap: nudge the table · flick: other train' },
  cab: { icon: '🕹️', name: 'Cab view', hint: 'drag: look around · tap: open the throttle · flick: other train' },
  map: { icon: '🗺️', name: 'Map view', hint: 'swipe: other train' },
  transit: { icon: '🚌', name: 'City transit', hint: 'tap: ring the bell · riding a city bus, tram or metro' },
};
const SCENE_ORDER = Object.keys(SCENES);
let focusScene = SCENES[game.state.settings.view] ? game.state.settings.view : 'side';
let wakeLock = null;
let hintTimer = null;

function resizeFocusMap(w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  focusMapCanvas.width = Math.round(w * dpr); focusMapCanvas.height = Math.round(h * dpr);
  focusMapCanvas.style.width = w + 'px'; focusMapCanvas.style.height = h + 'px';
}

async function lockScreen() {
  if (window.BranchLineNative) { window.BranchLineNative.keepAwake(true); return; }
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
function unlockScreen() {
  if (window.BranchLineNative) window.BranchLineNative.keepAwake(false);
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function enterFocus(lineId) {
  if (map.connectFrom != null) cancelConnect();
  closeSheet();
  if (game.state.tut === 2) setTut(3);
  focusOn = true;
  game.focusActive = true;
  if (lineId != null) ride.followLine(lineId);
  ride.prev = null;
  $('focus').hidden = false;
  setScene(focusScene);
  $('dim').style.opacity = game.state.settings.dim;
  $('fHint').style.opacity = 0.6;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { $('fHint').style.opacity = 0; }, 6000);
  lockScreen();
  syncHistory();
}

function exitFocus() {
  focusOn = false;
  game.focusActive = false;
  $('focus').hidden = true;
  unlockScreen();
  game.save();
  syncHistory();
}

function setScene(s, announce = false) {
  focusScene = s;
  game.state.settings.view = s;
  if (s !== 'map') ride.view = s;
  ride.parts = [];
  $('ride').hidden = s === 'map';
  focusMapCanvas.hidden = s !== 'map';
  $('fScene').textContent = SCENES[s].icon;
  $('focus').classList.toggle('cab', s === 'cab');
  $('fHint').textContent = SCENES[s].hint;
  if (announce) {
    toast(`${SCENES[s].icon} ${SCENES[s].name}`);
    $('fHint').style.opacity = 0.6;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { $('fHint').style.opacity = 0; }, 5000);
  }
}

$('fExit').onclick = exitFocus;
// the transit view only joins the cycle once a city has transit
$('fScene').onclick = () => {
  let i = SCENE_ORDER.indexOf(focusScene);
  do i = (i + 1) % SCENE_ORDER.length; while (SCENE_ORDER[i] === 'transit' && !ride.anyTransit());
  setScene(SCENE_ORDER[i], true);
};

// gestures: tap = steam, hold = whistle, swipe = switch train.
// In the passenger view a slow drag looks around; a quick flick still switches.
(() => {
  const el = $('focus');
  let down = null, holdT = null, holding = false;
  const looking = () => focusScene === 'passenger' || focusScene === 'cab';
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const lk = ride.look || { x: 0, y: 0 };
    down = { x: e.clientX, y: e.clientY, t: performance.now(), lx: e.clientX, ly: e.clientY, look0: { x: lk.x, y: lk.y } };
    holding = false;
    holdT = setTimeout(() => { holding = true; ride.whistleOn(); haptic(40); }, 420);
  });
  const up = (e) => {
    if (!down) return;
    clearTimeout(holdT);
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (holding) ride.whistleOff();
    else if (e.type === 'pointerup') {
      const quick = performance.now() - down.t < 260;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && (!looking() || quick)) {
        if (looking()) ride.lookSet(down.look0.x, down.look0.y); // a flick isn't a look
        const cur = ride.switch(dx < 0 ? 1 : -1);
        if (cur) { haptic(12); toast(game.lineName(cur.line)); }
      } else if (Math.hypot(dx, dy) < 15) {
        ride.tap(e.clientX, e.clientY);
        haptic(6);
      }
    }
    down = null; holding = false;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 15 && !holding) {
      clearTimeout(holdT);
      if (looking()) ride.lookBy(e.clientX - down.lx, e.clientY - down.ly);
    }
    down.lx = e.clientX; down.ly = e.clientY;
  });
})();

function drawFocusMap(dt) {
  const w = window.innerWidth, h = window.innerHeight;
  const s = Math.min(w / WORLD_W, h / WORLD_H) * 0.95;
  const cam = { x: WORLD_W / 2, y: WORLD_H / 2, s };
  const saved = map.connectFrom;
  map.connectFrom = null;
  map.dpr = Math.min(window.devicePixelRatio || 1, 2);
  map.time += dt;
  map.render(focusMapCtx, w, h, cam, { calm: true, dt });
  map.connectFrom = saved;
  map.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  focusMapCtx.fillStyle = 'rgba(10,16,30,0.35)';
  focusMapCtx.fillRect(0, 0, w, h);
}

function updateFocusHud() {
  const st = game.state;
  setText('fMoney', money(st.money));
  setText('fTime', mmss(sessionFocus));
  const frac = st.focusProg / FOCUS_TOKEN_SECONDS;
  $('fRing').style.strokeDashoffset = String(106.8 * (1 - frac));
  setText('fTok', `${game.weather().icon} ${game.dateLabel()} · ◉ in ${mmss(FOCUS_TOKEN_SECONDS - st.focusProg)}`);
  const info = ride.info;
  if (info) {
    setText('fRoute', info.moving ? `${info.fromName} → ${info.toName}` : `Boarding at ${info.fromName} → ${info.toName}`);
    $('fProg').style.width = `${Math.round(info.progress * 100)}%`;
    const load = Object.entries(info.tr.load).filter(([, v]) => v > 0).map(([c, v]) => `${CARGO[c].icon} ${v}`).join('  ');
    setText('fCargo', `${info.model.name}${load ? ' · ' + load : ''}`);
  } else {
    setText('fRoute', 'No trains running yet');
    $('fProg').style.width = '0%';
    setText('fCargo', 'Build a line on the map to start earning.');
  }
}

// ---------- frame-rate readout (Menu → Show frame rate) ----------
const fpsEl = document.createElement('div');
fpsEl.id = 'fps';
fpsEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;font:600 11px/1.3 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,0.55);padding:3px 6px;border-radius:6px;pointer-events:none;white-space:pre';
fpsEl.hidden = !game.state.settings.fps;
document.body.appendChild(fpsEl);
let fpsN = 0, fpsGap = 0, fpsJs = 0, fpsWorst = 0;
function showFps(gap, js) {
  fpsN++; fpsGap += gap; fpsJs += js; fpsWorst = Math.max(fpsWorst, gap);
  if (fpsGap < 1) return;
  fpsEl.textContent = `${Math.round(fpsN / fpsGap)} fps · draw ${(fpsJs / fpsN).toFixed(1)} ms\nworst ${Math.round(fpsWorst * 1000)} ms · res ${ride.quality}× · ${ride.view} · ${ride.ctx.isGL ? 'GPU' : '2D'}`;
  fpsN = 0; fpsGap = 0; fpsJs = 0; fpsWorst = 0;
}

// ---------- loop ----------
let last = performance.now();
let hudT = 0, saveT = 0, sessionFocus = 0, drawAcc = 0;

// Automatic quality: if Focus frames come too slowly, render at a lower
// resolution; if there's plenty of headroom again, step back up.
const QUALITY = [1, 0.8, 0.64, 0.5];
let qLevel = 0, frameEma = 1 / 30, qTimer = 0;
function applyQuality() {
  // "Low graphics" starts two steps down; auto-quality still adjusts from there
  const lvl = Math.min(QUALITY.length - 1, qLevel + (game.state.settings.lowgfx ? 2 : 0));
  ride.quality = QUALITY[lvl];
  ride.resize(window.innerWidth, window.innerHeight);
}
function adaptQuality(gap) {
  if (gap <= 0 || gap > 0.5) return; // ignore pauses (tab switches etc.)
  frameEma += (gap - frameEma) * 0.08;
  qTimer += gap;
  const target = game.state.settings.smooth ? 1 / 60 : 1 / 30;
  let next = qLevel;
  if (qTimer > 1 && frameEma > target * 1.45 && qLevel < QUALITY.length - 1) next = qLevel + 1;
  else if (qTimer > 8 && frameEma < target * 1.08 && qLevel > 0) next = qLevel - 1;
  if (next !== qLevel) {
    qLevel = next; qTimer = 0;
    applyQuality();
  }
}

// One bad frame must never stop the game: the loop carries on and the
// error is reported (once) so it can be fixed.
let frameErr = null;
function frame(now) {
  requestAnimationFrame(frame);
  try { step(now); } catch (err) {
    if (!frameErr) { frameErr = err; console.error(err); toast(`⚠️ Drawing error: ${err.message}`); }
  }
}
function step(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 5) {
    // the page was asleep; credit it as away time
    showAway(game.offline(dt));
    dt = 0;
  }
  dt = Math.min(dt, 0.25);
  // fixed sub-steps keep trains stable on slow frames
  let rem = dt;
  while (rem > 0) { const s = Math.min(rem, 0.05); game.tick(s); rem -= s; }

  if (focusOn) {
    sessionFocus += dt;
    // Focus mode draws at 30 fps by default to save battery during long classes
    drawAcc += dt;
    if (game.state.settings.smooth || drawAcc >= 1 / 31) {
      const t0 = performance.now();
      try { if (focusScene !== 'map') ride.draw(drawAcc); else { ride.draw(0); drawFocusMap(drawAcc); } } catch (err) {
        if (!frameErr) { frameErr = err; console.error(err); toast(`⚠️ Drawing error: ${err.message}`); }
      }
      if (game.state.settings.fps) showFps(drawAcc, performance.now() - t0);
      adaptQuality(drawAcc);
      drawAcc = 0;
    }
  } else {
    sessionFocus = 0;
    try { map.draw(dt); } catch (err) {
      if (!frameErr) { frameErr = err; console.error(err); toast(`⚠️ Drawing error: ${err.message}`); }
    }
  }

  hudT += dt;
  if (hudT > 0.2) {
    hudT = 0;
    setText('money', money(game.state.money));
    setText('income', `+${money(game.incomePerMin())}/min`);
    setText('date', `${game.weather().icon} ${game.dateLabel()}`);
    setText('tokens', `◉ ${game.state.tokens}`);
    updateSheet();
    if (focusOn) updateFocusHud();
  }
  saveT += dt;
  if (saveT > 10) { saveT = 0; game.save(); }
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') game.save();
  else if (focusOn) lockScreen();
});
window.addEventListener('pagehide', () => game.save());

// The Android app already bundles every file, so only the browser version needs the offline cache.
if (!NATIVE && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
