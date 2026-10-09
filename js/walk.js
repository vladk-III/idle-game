// Walking around a town in first person, Wolfenstein style.
//
// The town is laid out on a grid from the game's own data (its size, era,
// railway lines and transit). A ray is cast for every column of a small
// pixel buffer: walls are textured, floors are cast row by row, the sky is a
// painted panorama, then billboard sprites (trees, people, cars, stops) and
// the trains are drawn with a depth test. The buffer is scaled up with sharp
// pixels, so everything stays on one chunky pixel grid, head-bob and hands
// included.
//
// Walk up to a platform or a stop to ride a train, bus, tram or metro; the
// "Get off" button brings you back here (or to wherever you got off).
import { TRANSIT, TIERS, MODELS } from './data.js';
import { hash, clamp } from './rng.js';
import { eraOf } from './buildings.js';
import { season } from './toon.js';

const TS = 32;      // wall texture pixels per world unit
const FT = 16;      // floor texture size
const FOG = 7;      // haze levels
const MAXD = 40;    // how far you can see, in tiles
const EYE = 0.42;   // eye height (a tile is about 4 m)
const RAD = 0.22;   // your size, for bumping into walls
const TAN = Math.tan((66 * Math.PI) / 180 / 2);

// floors
const F = { grass: 0, road: 1, walk: 2, plat: 3, rail: 4, path: 5, square: 6, tram: 7, field: 8, gravel: 9 };
// walls
const W = { brick: 1, house: 2, decoLime: 3, decoBrick: 4, glass: 5, glassGreen: 6, resi: 7, station: 8, hedge: 9, theater: 10, mall: 11, civic: 12, shopBrick: 13 };

const pack = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Paint into a small canvas and read it back as packed pixels. Pixels whose
// alpha is 253 light up at night (windows, lamps); 254 are windows that stay dark.
function paint(w, h, fn, cpu = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  // small textures are painted on the CPU (lots of little reads); pictures made
  // from other canvases stay on the GPU and are read back once
  const x = c.getContext('2d', cpu ? { willReadFrequently: true } : undefined);
  x.imageSmoothingEnabled = false;
  fn(x, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const out = new Uint32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const a = d[i * 4 + 3];
    out[i] = a < 128 ? 0 : pack(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], a === 253 || a === 254 ? a : 255);
  }
  return { w, h, base: out };
}
// marks: draw a rect whose pixels are flagged (alpha 253 = lit at night, 254 = dark)
function win(x, X, Y, w, h, col, lit) {
  x.fillStyle = col; x.globalAlpha = 1; x.fillRect(X, Y, w, h);
  const id = x.getImageData(X, Y, w, h);
  for (let i = 3; i < id.data.length; i += 4) id.data[i] = lit ? 253 : 254;
  x.putImageData(id, X, Y);
}
function rect(x, X, Y, w, h, col) { x.fillStyle = col; x.fillRect(X, Y, w, h); }

// ---------- wall textures: 32 wide; rows 0-15 roof line, 16-47 a storey (repeats), 48-79 street level ----------
const WALL_PAINT = {
  [W.brick](x, v) {
    const col = ['#b5603f', '#c9785a', '#a8553a', '#b9a58f'][v % 4], dark = '#6b3a2a';
    rect(x, 0, 0, 32, 80, col);
    for (let y = 18; y < 80; y += 4) rect(x, 0, y, 32, 1, 'rgba(60,30,20,0.25)');
    rect(x, 0, 0, 32, 5, dark); rect(x, 0, 5, 32, 2, '#d9cdb0');
    for (const wx of [5, 19]) { rect(x, wx - 1, 21, 10, 22, '#e8dcc4'); win(x, wx, 22, 8, 19, '#5d7fb8', hash(wx, v) < 0.6); rect(x, wx, 31, 8, 1, '#e8dcc4'); rect(x, wx - 1, 42, 10, 2, '#e8dcc4'); }
    rect(x, 0, 48, 32, 3, '#e8dcc4');
    if (v % 2) { rect(x, 2, 54, 28, 20, '#3a3340'); win(x, 4, 56, 24, 12, '#9ac8e8', true); rect(x, 2, 52, 28, 3, ['#e0594a', '#2d6cdf', '#3fa34d'][v % 3]); }
    else { rect(x, 12, 56, 8, 24, '#6b4630'); win(x, 3, 57, 6, 10, '#5d7fb8', false); win(x, 23, 57, 6, 10, '#5d7fb8', true); }
  },
  [W.shopBrick](x, v) { WALL_PAINT[W.brick](x, v | 1); },
  [W.house](x, v) {
    const wall = ['#f3e3c2', '#f7d9c4', '#e8eef0', '#f2e8a8'][v % 4], roof = ['#c9573e', '#8a5a35', '#4f6d8f', '#b84a4a'][v % 4];
    rect(x, 0, 0, 32, 80, wall);
    // roof: tiles, with the eave at the bottom of the band
    rect(x, 0, 0, 32, 16, roof);
    for (let y = 2; y < 16; y += 4) for (let xx = (y % 8 ? 0 : 3); xx < 32; xx += 6) rect(x, xx, y, 4, 1, 'rgba(0,0,0,0.25)');
    rect(x, 0, 14, 32, 2, '#3a2a20');
    // timber framing and a window
    rect(x, 0, 48, 32, 2, '#6b4630'); rect(x, 0, 16, 2, 64, '#6b4630'); rect(x, 30, 16, 2, 64, '#6b4630');
    win(x, 6, 24, 10, 10, '#5d7fb8', hash(v, 3) < 0.6); rect(x, 10, 24, 1, 10, '#fff'); rect(x, 6, 28, 10, 1, '#fff');
    rect(x, 20, 58, 7, 22, '#8a5a35'); win(x, 5, 58, 9, 9, '#5d7fb8', hash(v, 5) < 0.5);
    rect(x, 4, 67, 11, 3, '#5aa83e');
  },
  [W.decoLime](x, v) {
    const col = ['#d9c49a', '#c9b48a', '#a9adb8', '#d0c8b8'][v % 4];
    rect(x, 0, 0, 32, 80, col);
    for (const px of [0, 15, 30]) rect(x, px, 0, 2, 80, 'rgba(70,60,40,0.35)');
    rect(x, 0, 0, 32, 4, '#e0b84a'); for (let k = 0; k < 32; k += 6) rect(x, k, 4, 3, 6, '#b9963a');
    rect(x, 0, 12, 32, 3, '#8a7a5a');
    for (const wx of [4, 19]) { win(x, wx, 18, 9, 27, '#5d7fb8', hash(wx, v + 1) < 0.55); rect(x, wx, 30, 9, 2, col); }
    rect(x, 0, 48, 32, 4, '#e0b84a');
    rect(x, 9, 56, 14, 24, '#3a3340'); win(x, 11, 58, 10, 10, '#ffd77a', true); rect(x, 6, 53, 20, 3, '#e0b84a');
  },
  [W.decoBrick](x, v) {
    const col = ['#a8553a', '#b5603f', '#8a4a3a', '#c9785a'][v % 4];
    rect(x, 0, 0, 32, 80, col);
    for (const px of [7, 23]) rect(x, px, 16, 3, 64, '#d9c49a');
    rect(x, 0, 0, 32, 3, '#d9c49a'); for (let k = 2; k < 32; k += 8) rect(x, k, 3, 4, 8, '#d9c49a');
    for (const wx of [1, 11, 26]) win(x, wx, 20, 5, 22, '#5d7fb8', hash(wx, v + 7) < 0.5);
    rect(x, 0, 48, 32, 3, '#d9c49a');
    rect(x, 11, 58, 10, 22, '#3a3340'); win(x, 2, 58, 7, 12, '#9ac8e8', true); win(x, 23, 58, 7, 12, '#9ac8e8', true);
  },
  [W.glass](x, v) {
    const g = ['#6fa8d6', '#4f8fc0', '#8fc4e8', '#5b9bd0'][v % 4];
    rect(x, 0, 0, 32, 80, g);
    for (let y = 16; y < 48; y += 8) rect(x, 0, y, 32, 1, 'rgba(255,255,255,0.45)');
    for (let k = 0; k < 32; k += 8) rect(x, k, 16, 1, 64, 'rgba(30,40,60,0.45)');
    for (let k = 0; k < 10; k++) rect(x, 3 + k, 44 - k * 2, 3, 2, 'rgba(255,255,255,0.35)'); // a glint
    for (let y = 18; y < 47; y += 8) for (let k = 1; k < 32; k += 8) if (hash(k * 7 + y, v) < 0.35) win(x, k, y, 6, 6, g, true);
    rect(x, 0, 0, 32, 10, '#9aa1aa'); rect(x, 0, 10, 32, 2, '#5a5f6a'); rect(x, 14, 0, 2, 4, '#2b2140');
    rect(x, 0, 48, 32, 2, '#5a5f6a'); rect(x, 0, 50, 32, 30, '#2f3a4a'); win(x, 2, 52, 28, 22, '#3f5a7a', true); rect(x, 12, 60, 8, 20, '#1d1a26');
  },
  [W.glassGreen](x, v) {
    const g = ['#5fb8a8', '#4fa898', '#7fc8b8', '#3f9888'][v % 4];
    rect(x, 0, 0, 32, 80, g);
    for (let y = 16; y < 48; y += 6) rect(x, 0, y, 32, 1, 'rgba(255,255,255,0.4)');
    for (let k = 0; k < 32; k += 6) rect(x, k, 16, 1, 64, 'rgba(20,50,50,0.4)');
    for (let y = 17; y < 47; y += 6) for (let k = 1; k < 32; k += 6) if (hash(k * 5 + y, v + 3) < 0.3) win(x, k, y, 5, 5, g, true);
    rect(x, 0, 0, 32, 12, '#c9ced6'); rect(x, 0, 12, 32, 2, '#5a5f6a');
    rect(x, 0, 48, 32, 32, '#2f3a4a'); win(x, 3, 52, 26, 20, '#3f6a6a', true); rect(x, 13, 62, 6, 18, '#1d1a26');
  },
  [W.resi](x, v) {
    const col = ['#e6dfd2', '#d9c9b0', '#c9ced6', '#e2c9a0'][v % 4];
    rect(x, 0, 0, 32, 80, col);
    rect(x, 0, 0, 32, 10, '#9aa1aa'); rect(x, 0, 10, 32, 2, '#5a5f6a');
    win(x, 4, 20, 18, 14, '#7fb6dc', hash(v, 11) < 0.6); rect(x, 12, 20, 1, 14, '#e6eef4');
    rect(x, 2, 34, 22, 2, '#5a5f6a'); for (let k = 3; k < 24; k += 3) rect(x, k, 36, 1, 6, '#5a5f6a'); rect(x, 2, 42, 22, 1, '#5a5f6a');
    if (v % 2 === 0) { rect(x, 25, 24, 6, 6, '#f4f6f8'); rect(x, 26, 26, 4, 1, '#9aa1aa'); }
    rect(x, 0, 48, 32, 32, shadeHex(col, -0.08));
    rect(x, 10, 58, 12, 22, '#3a3340'); win(x, 12, 60, 8, 10, '#ffd77a', true); rect(x, 6, 54, 20, 3, '#5d7fb8');
  },
  [W.station](x, v) {
    rect(x, 0, 0, 32, 80, '#c9785a');
    for (let y = 18; y < 80; y += 4) rect(x, 0, y, 32, 1, 'rgba(60,30,20,0.25)');
    rect(x, 0, 0, 32, 8, '#3a5a4a'); rect(x, 0, 8, 32, 3, '#e8dcc4');
    // a clock on the roof line, every other bay
    if (v % 2) { rect(x, 11, 1, 10, 10, '#fbf6ea'); rect(x, 15, 3, 1, 4, '#2b2140'); rect(x, 15, 6, 3, 1, '#2b2140'); }
    // tall arched windows
    for (const wx of [4, 19]) { win(x, wx, 20, 9, 26, '#9ac8e8', true); rect(x, wx, 20, 9, 2, '#e8dcc4'); }
    rect(x, 0, 48, 32, 3, '#e8dcc4');
    win(x, 6, 54, 20, 26, '#ffd77a', true); rect(x, 15, 54, 2, 26, '#6b4630'); rect(x, 4, 52, 24, 2, '#3a5a4a');
  },
  [W.hedge](x, v) {
    // the woods at the edge of town: the top is ragged, so the sky shows through
    rect(x, 0, 0, 32, 80, '#2f6a3a');
    for (let i = 0; i < 70; i++) {
      const bx = (hash(i, v) * 32) | 0, by = (hash(i, v + 9) * 80) | 0;
      rect(x, bx, by, 3, 2, i % 3 ? '#3f8a4a' : '#24502c');
    }
    x.clearRect(0, 0, 32, 6);
    for (let k = 0; k < 32; k += 4) { const hh = 4 + ((hash(k, v + 2) * 9) | 0); x.clearRect(k, 0, 4, hh); }
    for (let k = 2; k < 32; k += 9) rect(x, k, 64, 3, 16, '#5a3d2b');
  },
  [W.theater](x, v) {
    WALL_PAINT[W.decoLime](x, v + 1);
    rect(x, 0, 48, 32, 32, '#7a2430');
    rect(x, 0, 50, 32, 8, '#fbf6ea');
    for (let k = 1; k < 32; k += 3) win(x, k, 49, 1, 1, '#ffe28a', true);
    rect(x, 4, 52, 24, 3, ['#e0594a', '#2d6cdf', '#8e6bd9'][v % 3]);
    win(x, 4, 62, 10, 18, '#ffd77a', true); win(x, 18, 62, 10, 18, '#ffd77a', true);
  },
  [W.mall](x, v) {
    rect(x, 0, 0, 32, 80, ['#d9c9b0', '#c9ced6'][v % 2]);
    rect(x, 0, 0, 32, 10, '#7cc95a'); for (let k = 2; k < 32; k += 7) rect(x, k, 0, 5, 5, '#3f8a4a');
    rect(x, 0, 10, 32, 3, '#5a5f6a');
    win(x, 0, 20, 32, 22, '#8fc4e8', true); for (let k = 0; k < 32; k += 8) rect(x, k, 20, 1, 22, '#5a5f6a');
    rect(x, 0, 48, 32, 4, '#e0594a');
    win(x, 1, 54, 30, 26, '#bfe3f7', true); rect(x, 12, 58, 8, 22, '#3a3340');
  },
  [W.civic](x, v) {
    rect(x, 0, 0, 32, 80, '#e6dcc4');
    rect(x, 0, 0, 32, 4, '#cfc3a6'); for (let k = 0; k < 16; k++) rect(x, 16 - k, 4 + (k >> 1), k * 2, 1, '#d9cdb0');
    rect(x, 0, 12, 32, 4, '#cfc3a6');
    for (const cx of [3, 13, 23]) { rect(x, cx, 16, 6, 64, '#f4ecd8'); rect(x, cx + 4, 16, 2, 64, '#d9cdb0'); }
    for (const wx of [9, 19, 29]) win(x, wx, 22, 3, 18, '#3a3340', false);
    rect(x, 0, 74, 32, 6, '#cfc3a6');
  },
};
function shadeHex(h, a) {
  const [r, g, b] = hex(h), f = (c) => clamp(Math.round(a < 0 ? c * (1 + a) : c + (255 - c) * a), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// ---------- floors, 16x16 ----------
function paintFloor(type, snow) {
  return paint(FT, FT, (x) => {
    const sp = (cols, n, seed) => { for (let i = 0; i < n; i++) rect(x, (hash(i, seed) * 16) | 0, (hash(i, seed + 1) * 16) | 0, 1, 1, cols[i % cols.length]); };
    if (type === F.grass) { rect(x, 0, 0, 16, 16, snow ? '#eef3f8' : '#6cbf4a'); sp(snow ? ['#d8e4ee', '#ffffff'] : ['#5aa83e', '#7fd05a', '#4f9a3a'], 40, 3); if (!snow) sp(['#ffd84a', '#ff8fa3'], 2, 9); }
    else if (type === F.field) { rect(x, 0, 0, 16, 16, snow ? '#eef3f8' : '#c9a94a'); if (!snow) for (let y = 1; y < 16; y += 4) rect(x, 0, y, 16, 2, '#a8873a'); }
    else if (type === F.road) { rect(x, 0, 0, 16, 16, '#4a4652'); sp(['#55515e', '#403c48'], 30, 5); }
    else if (type === F.walk) { rect(x, 0, 0, 16, 16, snow ? '#e6eaee' : '#c9c3b8'); rect(x, 0, 0, 16, 1, '#a8a296'); rect(x, 0, 8, 16, 1, '#a8a296'); rect(x, 0, 0, 1, 16, '#a8a296'); rect(x, 8, 8, 1, 8, '#a8a296'); }
    else if (type === F.square) { rect(x, 0, 0, 16, 16, '#d9cdb0'); for (let i = 0; i < 16; i += 4) { rect(x, 0, i, 16, 1, '#bfb393'); rect(x, (i * 3) % 16, i, 1, 4, '#bfb393'); } }
    else if (type === F.plat) { rect(x, 0, 0, 16, 16, '#b3a898'); rect(x, 0, 0, 16, 1, '#9a8f80'); rect(x, 0, 8, 16, 1, '#9a8f80'); rect(x, 0, 14, 16, 2, '#f3c623'); }
    else if (type === F.rail) { rect(x, 0, 0, 16, 16, '#8d8478'); sp(['#a39a8c', '#6f675c'], 30, 7); for (let k = 1; k < 16; k += 4) rect(x, k, 1, 2, 14, '#7a5a3a'); rect(x, 0, 3, 16, 2, '#d3d7dc'); rect(x, 0, 11, 16, 2, '#d3d7dc'); }
    else if (type === F.tram) { rect(x, 0, 0, 16, 16, '#4a4652'); rect(x, 4, 0, 1, 16, '#9aa1aa'); rect(x, 11, 0, 1, 16, '#9aa1aa'); }
    else if (type === F.path) { rect(x, 0, 0, 16, 16, snow ? '#f0f2f4' : '#d9c79a'); sp(['#c9b78a', '#e8d8b0'], 20, 11); }
    else if (type === F.gravel) { rect(x, 0, 0, 16, 16, '#9a9184'); sp(['#b0a798', '#7a7266'], 40, 13); }
  });
}

// ---------- sprites (billboards) ----------
const SPRITES = {
  tree: [24, 36, 1.5, 2.2, (x, v) => { rect(x, 10, 22, 4, 14, '#6b4630'); const c = season.snow > 0.4 ? ['#e8eef6', '#c9d6e2'] : season.autumn > 0.5 ? ['#e08a3a', '#c9662a'] : ['#4f9a3a', '#3f8a4a']; for (let i = 0; i < 9; i++) { const r = 5 + (hash(i, v) * 4) | 0; x.fillStyle = c[i % 2]; x.beginPath(); x.arc(5 + hash(i, v + 1) * 14, 6 + hash(i, v + 2) * 14, r, 0, 7); x.fill(); } }],
  pine: [18, 36, 1.0, 2.4, (x) => { rect(x, 8, 28, 3, 8, '#6b4630'); for (let k = 0; k < 4; k++) { x.fillStyle = season.snow > 0.4 ? '#dfe8f0' : ['#2f6a3a', '#3f7a4a'][k % 2]; x.beginPath(); x.moveTo(9, k * 6); x.lineTo(1 + k * 0.5, 12 + k * 5); x.lineTo(17 - k * 0.5, 12 + k * 5); x.fill(); } }],
  lamp: [6, 32, 0.22, 1.3, (x) => { rect(x, 2, 6, 2, 26, '#2b2140'); rect(x, 0, 2, 6, 4, '#2b2140'); win(x, 1, 3, 4, 3, '#ffe28a', true); }],
  bench: [16, 8, 0.7, 0.32, (x) => { rect(x, 0, 2, 16, 2, '#8a5a35'); rect(x, 0, 5, 16, 1, '#8a5a35'); rect(x, 1, 6, 1, 2, '#2b2140'); rect(x, 14, 6, 1, 2, '#2b2140'); }],
  fountain: [32, 20, 1.4, 0.9, (x) => { rect(x, 2, 12, 28, 8, '#c9c3b8'); rect(x, 4, 12, 24, 3, '#7fc8e8'); rect(x, 14, 4, 4, 9, '#c9c3b8'); rect(x, 12, 2, 8, 3, '#7fc8e8'); rect(x, 9, 6, 2, 6, '#bfe3f7'); rect(x, 21, 6, 2, 6, '#bfe3f7'); }],
  sign: [16, 24, 0.6, 1.0, (x) => { rect(x, 7, 6, 2, 18, '#6b4630'); rect(x, 0, 2, 14, 5, '#e8d8b0'); rect(x, 13, 3, 3, 3, '#e8d8b0'); rect(x, 2, 4, 9, 1, '#6b4630'); }],
  car: [30, 12, 1.1, 0.44, (x, v) => { const c = ['#e4572e', '#2d6cdf', '#f3c623', '#3fa34d', '#f4f1ea', '#5a5f6a'][v % 6]; rect(x, 7, 0, 15, 5, '#bfe3f7'); rect(x, 1, 4, 28, 5, c); rect(x, 7, 1, 1, 4, c); rect(x, 21, 1, 1, 4, c); rect(x, 4, 8, 5, 4, '#2b2b33'); rect(x, 21, 8, 5, 4, '#2b2b33'); win(x, 27, 5, 2, 2, '#fff1b8', true); rect(x, 1, 5, 1, 2, '#e0303a'); }],
  carEnd: [16, 12, 0.55, 0.44, (x, v) => { const c = ['#e4572e', '#2d6cdf', '#f3c623', '#3fa34d', '#f4f1ea', '#5a5f6a'][v % 6]; rect(x, 3, 0, 10, 5, '#bfe3f7'); rect(x, 1, 4, 14, 6, c); rect(x, 1, 10, 3, 2, '#2b2b33'); rect(x, 12, 10, 3, 2, '#2b2b33'); win(x, 2, 6, 3, 2, v >= 6 ? '#e0303a' : '#fff1b8', v < 6); win(x, 11, 6, 3, 2, v >= 6 ? '#e0303a' : '#fff1b8', v < 6); }],
  bus: [64, 24, 2.6, 0.95, (x, v) => { const c = v; rect(x, 1, 1, 62, 19, c); for (let k = 4; k < 56; k += 8) win(x, k, 4, 6, 6, '#bfe3f7', true); win(x, 57, 4, 5, 8, '#bfe3f7', true); rect(x, 1, 14, 62, 2, '#f4f6f8'); rect(x, 8, 19, 7, 5, '#2b2b33'); rect(x, 48, 19, 7, 5, '#2b2b33'); }],
  busEnd: [22, 24, 0.85, 0.95, (x, v) => { rect(x, 1, 1, 20, 19, v); win(x, 3, 4, 16, 8, '#bfe3f7', true); rect(x, 5, 1, 12, 2, '#1d1a26'); win(x, 2, 15, 3, 2, '#fff1b8', true); win(x, 17, 15, 3, 2, '#fff1b8', true); rect(x, 2, 20, 4, 4, '#2b2b33'); rect(x, 16, 20, 4, 4, '#2b2b33'); }],
  shelter: [32, 26, 1.3, 1.05, (x, v) => { rect(x, 0, 0, 32, 4, v); rect(x, 1, 4, 1, 22, '#5a5f6a'); rect(x, 30, 4, 1, 22, '#5a5f6a'); win(x, 2, 6, 28, 12, '#bfe3f7', false); rect(x, 4, 19, 24, 2, '#8a5a35'); rect(x, 24, 0, 6, 26, '#2b2140'); win(x, 25, 1, 4, 4, v, true); }],
  metro: [24, 30, 1.0, 1.25, (x, v) => { rect(x, 0, 18, 24, 12, '#5a5f6a'); for (let k = 0; k < 4; k++) rect(x, 3, 20 + k * 2, 18, 1, '#3a3340'); rect(x, 0, 16, 24, 2, '#c9ced6'); rect(x, 20, 0, 3, 18, '#2b2140'); win(x, 15, 0, 9, 9, v, true); rect(x, 17, 2, 1, 5, '#fff'); rect(x, 21, 2, 1, 5, '#fff'); rect(x, 18, 3, 1, 1, '#fff'); rect(x, 20, 3, 1, 1, '#fff'); rect(x, 19, 4, 1, 1, '#fff'); }],
  person: [10, 18, 0.36, 0.55, (x, v) => {
    const shirt = ['#e4572e', '#2d6cdf', '#f3c623', '#3fa34d', '#8e6bd9', '#e08a3a'][v % 6], skin = ['#f2c9a0', '#d9a066', '#a8714a', '#6b4630'][(v >> 1) % 4], hair = ['#2b2140', '#6b4630', '#e0b84a', '#a8553a'][(v >> 2) % 4];
    const step = v & 64;
    rect(x, 3, 1, 4, 4, skin); rect(x, 3, 0, 4, 2, hair); rect(x, 2, 5, 6, 6, shirt);
    rect(x, 1, 6, 1, 4, skin); rect(x, 8, 6, 1, 4, skin);
    if (step) { rect(x, 2, 11, 2, 7, '#3a3340'); rect(x, 6, 11, 2, 5, '#3a3340'); } else { rect(x, 3, 11, 2, 7, '#3a3340'); rect(x, 5, 11, 2, 7, '#3a3340'); }
  }],
};

// ---------- train sides, 32 px per unit ----------
function paintCar(kind, style, color, len) {
  const w = Math.round(len * TS), h = 36;
  return paint(w, h, (x) => {
    const body = style === 'steam' ? '#2b2b33' : style === 'maglev' ? '#f2f5f8' : color;
    if (kind === 'end') {
      rect(x, 1, 6, w - 2, 24, style === 'steam' ? '#2b2b33' : color);
      win(x, 3, 9, w - 6, 8, '#bfe3f7', true);
      win(x, 3, 22, 4, 3, '#fff1b8', true); win(x, w - 7, 22, 4, 3, '#fff1b8', true);
      rect(x, 2, 30, w - 4, 3, '#2b2b33');
      return;
    }
    if (kind === 'loco' && style === 'steam') {
      rect(x, 2, 12, w - 26, 16, '#2b2b33'); rect(x, 2, 18, w - 26, 2, color);
      rect(x, 8, 2, 6, 10, '#2b2b33'); rect(x, 6, 0, 10, 3, '#2b2b33'); rect(x, w * 0.45, 7, 6, 5, '#e0b84a');
      rect(x, w - 24, 4, 22, 24, color); win(x, w - 20, 8, 7, 7, '#ffd77a', true);
      for (const wx of [10, 26, 42]) { x.fillStyle = '#c9573e'; x.beginPath(); x.arc(wx, 29, 5, 0, 7); x.fill(); rect(x, wx - 1, 28, 2, 2, '#2b2b33'); }
      rect(x, 0, 25, 4, 4, '#c9573e');
      return;
    }
    rect(x, 1, 5, w - 2, 23, body);
    rect(x, 1, 20, w - 2, 3, style === 'steam' ? color : '#f4f6f8');
    rect(x, 1, 5, w - 2, 2, 'rgba(255,255,255,0.4)');
    if (kind === 'loco') { win(x, w - 12, 8, 9, 8, '#bfe3f7', true); for (let k = 6; k < w - 18; k += 10) rect(x, k, 9, 6, 6, 'rgba(0,0,0,0.25)'); }
    else for (let k = 5; k < w - 6; k += 9) win(x, k, 9, 6, 8, '#ffd77a', true);
    rect(x, 1, 28, w - 2, 3, '#2b2b33');
    for (const wx of [6, 14, w - 16, w - 8]) rect(x, wx, 30, 6, 6, '#3a3340');
  });
}

export class Walk {
  constructor(g, ride) {
    this.g = g; this.ride = ride;
    this.town = null;
    this.x = 0; this.y = 0; this.yaw = -Math.PI / 2; this.pitch = 0;
    this.move = { f: 0, s: 0 }; this.keys = new Set();
    this.bobT = 0; this.speed = 0;
    this.fade = 0;
    this.prompts = []; this.promptKey = '';
    this.texCache = null; this.lightKey = '';
    this.buf = null;
    this.touches = new Map();
    this.installKeys();
  }

  // ---------- the town ----------
  enter(townId) {
    const n = this.g.node(townId);
    if (!n || n.type !== 'town') {
      const towns = this.g.world.nodes.filter((m) => m.type === 'town');
      townId = towns.reduce((a, b) => (this.g.pop(b.id) > this.g.pop(a.id) ? b : a)).id;
    }
    this.town = townId;
    this.build();
    // start on the platform, facing the station
    this.x = this.c + 0.5; this.y = this.c + 1.5; this.yaw = -Math.PI / 2; this.pitch = 0;
    this.fade = 1;
  }

  build() {
    const g = this.g, id = this.town, tier = g.tier(id), pop = g.pop(id), era = eraOf(g.year());
    const N = [40, 52, 68, 88][tier], c = N >> 1;
    this.N = N; this.c = c; this.tier = tier; this.era = era;
    this.builtKey = `${id}|${tier}|${era}|${g.linesAt(id).length}|${g.transit(id).length}`;
    const wall = new Uint8Array(N * N), wv = new Uint8Array(N * N), wh = new Float32Array(N * N), floor = new Uint8Array(N * N);
    this.wall = wall; this.wv = wv; this.wh = wh; this.floor = floor;
    const at = (x, y) => y * N + x, inside = (x, y) => x > 0 && y > 0 && x < N - 1 && y < N - 1;
    const setW = (x, y, k, v, h) => { if (!inside(x, y)) return; const i = at(x, y); wall[i] = k; wv[i] = v; wh[i] = h; };
    const setF = (x, y, f) => { if (x >= 0 && y >= 0 && x < N && y < N) floor[at(x, y)] = f; };
    const sprites = []; this.sprites = sprites;
    const R = (x, y, k) => hash(x * 131 + y * 17 + id * 7919, k);
    // the woods round the edge
    for (let i = 0; i < N; i++) for (const [x, y] of [[i, 0], [i, N - 1], [0, i], [N - 1, i]]) { const k = at(x, y); wall[k] = W.hedge; wv[k] = i % 4; wh[k] = 2.4; }
    // the railway: one track per line through town (at least one), each with a platform
    const lines = g.linesAt(id).slice(0, 3);
    this.lines = lines;
    const nT = Math.max(1, lines.length);
    this.trackRow = (li) => c + 2 + li * 2;
    for (let li = 0; li < nT; li++) {
      for (let x = 1; x < N - 1; x++) { setF(x, this.trackRow(li), F.rail); setF(x, this.trackRow(li) - 1, F.gravel); }
      for (let x = c - 9; x <= c + 9; x++) setF(x, this.trackRow(li) - 1, F.plat);
    }
    const railEnd = this.trackRow(nT - 1) + 1;
    for (let x = 1; x < N - 1; x++) setF(x, railEnd, F.gravel);
    // the station, with a hall you can walk through, and the square in front
    for (let x = c - 5; x <= c + 4; x++) for (const y of [c - 1, c]) setW(x, y, W.station, (x + 1) % 2, 1.7);
    for (const y of [c - 1, c]) { wall[at(c, y)] = 0; wall[at(c - 1, y)] = 0; setF(c, y, F.plat); setF(c - 1, y, F.plat); }
    for (let x = c - 8; x <= c + 7; x++) for (let y = c - 4; y <= c - 2; y++) setF(x, y, F.square);
    sprites.push({ k: 'fountain', v: 0, x: c - 3.5, y: c - 3 }, { k: 'bench', v: 0, x: c + 3, y: c - 3.6 }, { k: 'bench', v: 0, x: c - 6, y: c - 3.6 });
    for (let li = 0; li < nT; li++) for (const dx of [-8, -3, 3, 8]) sprites.push({ k: 'lamp', v: 0, x: c + dx + 0.5, y: this.trackRow(li) - 1.15 });

    // streets
    const north = [], south = [];
    const roadsX = [], roadsY = [];
    const big = tier >= 2;
    const B = 8;
    const R0 = big ? c - 2 : [12, 17][tier]; // town radius in tiles
    this.R0 = R0;
    if (big) {
      for (let x = c % B; x < N - 1; x += B) if (x > 0) roadsX.push(x);
      for (let y = c - 5; y > 0; y -= B) roadsY.push(y);
      for (let y = railEnd + 1; y < N - 1; y += B) roadsY.push(y);
    } else {
      roadsX.push(c - 8 >= 2 ? c - 8 : 2, c + 8);
      roadsY.push(c - 5, railEnd + 1);
      if (tier >= 1) roadsY.push(c - 13);
    }
    const inRail = (y) => y >= c - 4 && y <= railEnd;
    for (const x of roadsX) for (let y = 1; y < N - 1; y++) if (!inRail(y) || floor[at(x, y)] === F.grass || floor[at(x, y)] === F.gravel) { if (floor[at(x, y)] !== F.rail) setF(x, y, F.road); }
    // the main avenue runs north from the station square
    for (let y = 1; y < c - 4; y++) setF(c, y, F.road);
    roadsX.push(c);
    for (const y of roadsY) for (let x = 1; x < N - 1; x++) setF(x, y, F.road);
    // pavements beside every road
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      if (floor[at(x, y)] !== F.grass) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (floor[at(x + dx, y + dy)] === F.road) { near = true; break; }
      if (near) setF(x, y, F.walk);
    }
    this.roadsX = roadsX; this.roadsY = roadsY;
    // the transit lines: tram rails up the avenue, stops along it
    const tl = g.transit(id);
    const stops = []; this.stops = stops;
    if (tl.some((l) => l.mode === 'tram')) for (let y = 1; y < c - 4; y++) setF(c, y, F.tram);
    tl.forEach((l, i) => {
      const y = c - 7 - i * 6, side = i % 2 ? -1 : 1, x = c + side * 1.6 + 0.5;
      if (y < 3) return;
      const m = TRANSIT[l.mode];
      sprites.push({ k: l.mode === 'metro' ? 'metro' : 'shelter', v: m.color, x, y: y + 0.5 });
      stops.push({ x, y: y + 0.5, idx: i, mode: l.mode });
    });

    // buildings: fill each block (inside its pavements) with buildings by era and distance from the middle
    const lots = [];
    const isFree = (x, y) => inside(x, y) && floor[at(x, y)] === F.grass && !wall[at(x, y)];
    const visited = new Uint8Array(N * N);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      if (visited[at(x, y)] || !isFree(x, y)) continue;
      // grow a rectangle of free grass from here
      let w = 0; while (isFree(x + w, y) && !visited[at(x + w, y)] && w < 12) w++;
      let h = 0; outer: while (h < 12) { for (let k = 0; k < w; k++) if (!isFree(x + k, y + h) || visited[at(x + k, y + h)]) break outer; h++; }
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) visited[at(xx, yy)] = 1;
      lots.push({ x, y, w, h });
    }
    const height = (kind, dn, r) => {
      const t = tier >= 3 ? 1 : 0.6;
      if (kind === W.glass || kind === W.glassGreen) return Math.round((12 + r * 20) * t * (1.2 - dn));
      if (kind === W.decoLime || kind === W.decoBrick) return dn < 0.4 ? Math.round((8 + r * 14) * t) : 3 + Math.round(r * 3);
      if (kind === W.resi) return 4 + Math.round(r * 8 * t);
      if (kind === W.mall) return 2.5;
      if (kind === W.theater || kind === W.civic) return 3;
      if (kind === W.house) return 1.4;
      return 2.5 + Math.round(r * 2);
    };
    let civic = false, theater = 0;
    for (const lot of lots) {
      const mx = lot.x + lot.w / 2, my = lot.y + lot.h / 2;
      const dn = Math.hypot(mx - c, (my - c) * 1.1) / R0;
      const r = R(lot.x, lot.y, 1);
      if (dn > 1 || (!big && lot.w * lot.h > 30 && r < 0.5)) { this.countryside(lot, dn, r); continue; }
      if (big && r < 0.1 && dn > 0.25) { this.park(lot); continue; }
      // split the lot into a few buildings
      const parts = [];
      const split = (L, depth) => {
        if (depth > 2 || (L.w <= 3 && L.h <= 3) || R(L.x, L.y, depth + 5) < 0.25) { parts.push(L); return; }
        if (L.w >= L.h) { const k = 2 + ((R(L.x, L.y, 9) * (L.w - 3)) | 0); if (k >= L.w) { parts.push(L); return; } split({ x: L.x, y: L.y, w: k, h: L.h }, depth + 1); split({ x: L.x + k, y: L.y, w: L.w - k, h: L.h }, depth + 1); }
        else { const k = 2 + ((R(L.x, L.y, 10) * (L.h - 3)) | 0); if (k >= L.h) { parts.push(L); return; } split({ x: L.x, y: L.y, w: L.w, h: k }, depth + 1); split({ x: L.x, y: L.y + k, w: L.w, h: L.h - k }, depth + 1); }
      };
      if (big) split(lot, 0);
      else {
        // village houses: small, with gardens round them
        for (let yy = lot.y; yy + 2 <= lot.y + lot.h; yy += 4) for (let xx = lot.x; xx + 2 <= lot.x + lot.w; xx += 4) if (R(xx, yy, 2) < 0.75) parts.push({ x: xx + (R(xx, yy, 3) < 0.5 ? 0 : 1), y: yy, w: 2, h: 2, house: true });
        for (let k = 0; k < (lot.w * lot.h) / 12; k++) sprites.push({ k: R(lot.x, k, 4) < 0.7 ? 'tree' : 'pine', v: k, x: lot.x + R(lot.x + k, lot.y, 5) * lot.w, y: lot.y + R(lot.x, lot.y + k, 6) * lot.h, solid: false, garden: true });
      }
      for (const p of parts) {
        const rr = R(p.x, p.y, 7);
        let kind;
        if (p.house || (!big && tier === 0)) kind = W.house;
        else if (era === 'modern') kind = dn < 0.35 ? (rr < 0.6 ? W.glass : W.glassGreen) : dn < 0.75 ? (p.w * p.h >= 15 && rr < 0.2 ? W.mall : W.resi) : rr < 0.5 ? W.resi : W.brick;
        else if (era === 'deco') {
          if (!civic && dn < 0.3 && p.w * p.h >= 9) { kind = W.civic; civic = true; }
          else if (theater < 2 && dn < 0.5 && rr < 0.15) { kind = W.theater; theater++; }
          else kind = dn < 0.45 ? (rr < 0.5 ? W.decoLime : W.decoBrick) : rr < 0.6 ? W.decoBrick : W.shopBrick;
        } else kind = !big && tier === 1 && dn < 0.4 ? W.shopBrick : dn < 0.6 ? (rr < 0.5 ? W.brick : W.shopBrick) : W.house;
        const h = kind === W.house ? 1.4 : height(kind, dn, rr);
        const v = (R(p.x, p.y, 8) * 4) | 0;
        for (let yy = p.y; yy < p.y + p.h; yy++) for (let xx = p.x; xx < p.x + p.w; xx++) setW(xx, yy, kind, v, h);
      }
    }
    // a landmark: the TV tower in a modern metropolis
    if (era === 'modern' && tier >= 3) {
      const park = lots.find((l) => l.park);
      if (park) sprites.push({ k: 'tvTower', v: 0, x: park.x + park.w / 2, y: park.y + park.h / 2, big: true });
    }
    // street lamps along the roads
    for (const x of roadsX) for (let y = 3; y < N - 3; y += 6) if (floor[at(x + 1, y)] === F.walk) sprites.push({ k: 'lamp', v: 0, x: x + 1.75, y: y + 0.5 });
    for (const y of roadsY) for (let x = 3; x < N - 3; x += 6) if (floor[at(x, y - 1)] === F.walk) sprites.push({ k: 'lamp', v: 0, x: x + 0.5, y: y - 0.75 });
    // signposts to the nearest towns at the ends of the roads
    const here = g.node(id);
    const others = g.world.nodes.filter((m) => m.type === 'town' && m.id !== id).sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y)).slice(0, 4);
    const ends = [[c + 0.5, 2.5], [2.5, roadsY[0] + 0.5], [N - 2.5, roadsY[0] + 0.5], [2.5, railEnd + 1.5]];
    this.signs = [];
    others.forEach((m, i) => { const [x, y] = ends[i]; sprites.push({ k: 'sign', v: 0, x, y }); this.signs.push({ x, y, to: m.id }); });

    // people on the pavements and traffic on the roads
    const walkers = []; this.walkers = walkers;
    const nP = [6, 12, 22, 34][tier];
    const runs = [];
    // north and south of the railway separately, so nobody walks through the station
    const spans = [[2, c - 5], [railEnd + 2, N - 2]];
    for (const x of roadsX) for (const o of [-1, 1]) for (const [a, b] of spans) if (b - a > 3) runs.push({ ax: 'y', at: x + o + 0.5, a, b });
    for (const y of roadsY) for (const o of [-1, 1]) runs.push({ ax: 'x', at: y + o + 0.5, a: 2, b: N - 2 });
    for (let i = 0; i < nP; i++) {
      const r = runs[(hash(i, id) * runs.length) | 0];
      walkers.push({ r, t: r.a + hash(i, id + 1) * (r.b - r.a), v: (hash(i, id + 2) < 0.5 ? -1 : 1) * (0.5 + hash(i, id + 3) * 0.4), look: i });
    }
    const cars = []; this.cars = cars;
    const nC = [0, 4, 14, 26][tier];
    const lanes = [];
    for (const x of roadsX) if (x !== c || !tl.some((l) => l.mode === 'tram')) for (const [a, b] of [[1.5, c - 4.5], [railEnd + 1.5, N - 1.5]]) if (b - a > 4) lanes.push({ ax: 'y', at: x + 0.5, a, b });
    for (const y of roadsY) lanes.push({ ax: 'x', at: y + 0.5, a: 1.5, b: N - 1.5 });
    for (let i = 0; i < nC && lanes.length; i++) {
      const l = lanes[i % lanes.length], fwd = hash(i, id + 5) < 0.5 ? 1 : -1;
      cars.push({ l, t: l.a + hash(i, id + 4) * (l.b - l.a), v: fwd * (2.2 + hash(i, id + 6) * 1.2), off: fwd * 0.22, kind: 'car', col: i % 6 });
    }
    // the city's own buses and trams on the avenue
    for (const l of tl) if (l.mode === 'bus' || l.mode === 'tram') for (let k = 0; k < Math.min(3, l.v); k++) cars.push({ l: { ax: 'y', at: c + 0.5, a: 1.5, b: c - 4.5 }, t: 2 + k * 9, v: (k % 2 ? -1 : 1) * 1.8, off: (k % 2 ? -1 : 1) * 0.25, kind: 'bus', col: TRANSIT[l.mode].color });

    this.texCache = null; this.lightKey = '';
    this.mini = null;
  }

  countryside(lot, dn, r) {
    const id = this.town;
    const field = r < 0.3 && lot.w * lot.h > 16;
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) if (field) this.floor[y * this.N + x] = F.field;
    if (field) return;
    for (let k = 0; k < (lot.w * lot.h) / 7; k++) {
      const x = lot.x + hash(lot.x * 7 + k, id) * lot.w, y = lot.y + hash(lot.y * 13 + k, id + 1) * lot.h;
      this.sprites.push({ k: hash(k, lot.x + id) < 0.55 ? 'tree' : 'pine', v: k, x, y });
    }
  }

  park(lot) {
    lot.park = true;
    const N = this.N;
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) if ((x + y) % 7 === 0 || y === lot.y + (lot.h >> 1)) this.floor[y * N + x] = F.path;
    for (let k = 0; k < (lot.w * lot.h) / 6; k++) this.sprites.push({ k: 'tree', v: k, x: lot.x + 0.5 + hash(k, lot.x) * (lot.w - 1), y: lot.y + 0.5 + hash(k, lot.y) * (lot.h - 1) });
    this.sprites.push({ k: 'bench', v: 0, x: lot.x + lot.w / 2, y: lot.y + (lot.h >> 1) + 0.2 });
  }

  // ---------- textures, shaded for the time of day and the haze ----------
  textures(light, haze) {
    const night = light < 0.45;
    const key = `${Math.round(light * 10)}|${haze.join(',')}|${Math.round(season.snow * 2)}|${Math.round(season.autumn * 2)}|${this.lines.map((l) => l.color).join()}`;
    if (this.texCache && this.lightKey === key) return this.texCache;
    this.lightKey = key;
    const base = this.baseTex || (this.baseTex = { walls: {}, sprites: {} });
    if (base.snow !== Math.round(season.snow * 2) || base.autumn !== Math.round(season.autumn * 2)) {
      base.snow = Math.round(season.snow * 2); base.autumn = Math.round(season.autumn * 2);
      base.floors = Object.values(F).map((f) => paintFloor(f, season.snow > 0.4));
      base.sprites = {};
    }
    const shadeSet = (t) => {
      const lv = [];
      for (let l = 0; l < FOG; l++) {
        const f = l / FOG, out = new Uint32Array(t.base.length);
        const [hr, hg, hb] = haze;
        for (let i = 0; i < out.length; i++) {
          const p = t.base[i];
          if (!p) continue;
          const a = p >>> 24;
          let r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255, L = 0.3 + 0.7 * light; // moonlight at night
          if (a === 253 && night) { r = 255; g = 214; b = 120; L = 1; }
          const lr = r * L * (night ? 0.85 : 1), lg = g * L * (night ? 0.9 : 1), lb = b * L;
          out[i] = pack((lr + (hr - lr) * f) | 0, (lg + (hg - lg) * f) | 0, (lb + (hb - lb) * f) | 0);
        }
        lv.push(out);
      }
      return { w: t.w, h: t.h, lv };
    };
    const tc = { walls: {}, floors: [], sprites: {} };
    // only the walls this town actually has
    const used = new Set();
    for (let i = 0; i < this.wall.length; i++) if (this.wall[i]) used.add(this.wall[i] * 4 + this.wv[i]);
    for (const key2 of used) {
      const k = key2 >> 2, v = key2 & 3;
      const t = base.walls[key2] || (base.walls[key2] = paint(TS, 80, (x) => WALL_PAINT[k](x, v)));
      tc.walls[key2] = shadeSet(t);
    }
    tc.floors = base.floors.map(shadeSet);
    this.texCache = tc;
    this.spriteBase = base.sprites;
    this.shadeSet = shadeSet;
    tc.spriteLv = {};
    return tc;
  }

  sprite(k, v) {
    const key = `${k}|${v}`;
    let s = this.texCache.spriteLv[key];
    if (s) return s;
    let b = this.spriteBase[key];
    if (!b) {
      if (k === 'tvTower') {
        // the landmark, in pixels: legs, a shaft and pink spheres
        b = paint(20, 90, (x) => {
          rect(x, 2, 70, 3, 20, '#c9ced6'); rect(x, 15, 70, 3, 20, '#c9ced6'); rect(x, 5, 62, 10, 8, '#c9ced6');
          rect(x, 8, 6, 4, 64, '#d9dde2'); rect(x, 9, 0, 2, 8, '#2b2140');
          for (const [yy, rr] of [[60, 8], [28, 6], [12, 3]]) { x.fillStyle = '#d0567a'; x.beginPath(); x.arc(10, yy, rr, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,0.45)'; x.fillRect(10 - rr / 2, yy - rr / 2, 2, 2); }
          win(x, 6, 59, 8, 2, '#ffd77a', true);
        });
        b.size = [6, 27];
      } else if (k.startsWith('train:')) {
        const [, kind, style, color, len] = k.split(':');
        b = paintCar(kind, style, color, +len);
      } else {
        const [w, h, sw, sh, fn] = SPRITES[k];
        b = paint(w, h, (x) => fn(x, v));
        b.size = [sw, sh];
      }
      this.spriteBase[key] = b;
    }
    s = this.shadeSet(b);
    s.size = b.size;
    this.texCache.spriteLv[key] = s;
    return s;
  }

  // ---------- the sky: a panorama you turn inside ----------
  panorama(light, phase) {
    const key = `${this.town}|${this.era}|${this.tier}|${Math.round(light * 12)}|${Math.round(season.snow * 2)}`;
    if (this.pano && this.panoKey === key) return this.pano;
    this.panoKey = key;
    const PW = 512, PH = 128;
    const day = light, top = mix([18, 22, 60], [92, 160, 230], day), low = mix([60, 50, 100], [190, 225, 250], day);
    const p = paint(PW, PH, (x) => {
      const gr = x.createLinearGradient(0, 0, 0, PH);
      gr.addColorStop(0, `rgb(${top})`); gr.addColorStop(1, `rgb(${low})`);
      x.fillStyle = gr; x.fillRect(0, 0, PW, PH);
      // stars at night
      if (day < 0.4) for (let i = 0; i < 80; i++) rect(x, (hash(i, 5) * PW) | 0, (hash(i, 6) * PH * 0.6) | 0, 1, 1, `rgba(255,255,255,${0.9 - day * 2})`);
      // clouds
      for (let i = 0; i < 14; i++) {
        const cx = hash(i, 21) * PW, cy = 44 + hash(i, 22) * 36, s = 6 + hash(i, 23) * 8; // kept off the top row, which fills the sky overhead
        x.fillStyle = `rgba(${mix([90, 90, 130], [255, 255, 255], day)},0.9)`;
        for (const o of [-PW, 0, PW]) for (let k = 0; k < 4; k++) { x.beginPath(); x.arc(cx + o + (k - 1.5) * s * 0.8, cy - (k % 2) * s * 0.4, s * (0.6 + (k % 2) * 0.3), 0, 7); x.fill(); }
      }
      // mountains: sums of sines with whole numbers of waves, so they wrap round seamlessly
      const ridge = (amp, base, f1, f2, ph, col) => {
        x.fillStyle = col; x.beginPath(); x.moveTo(0, PH);
        for (let px = 0; px <= PW; px += 2) {
          const a = (px / PW) * Math.PI * 2;
          const yy = base - amp * (0.55 + 0.3 * Math.sin(a * f1 + ph) + 0.15 * Math.sin(a * f2 + ph * 2));
          x.lineTo(px, yy);
        }
        x.lineTo(PW, PH); x.fill();
      };
      ridge(46, PH - 4, 3, 11, 1.3, `rgb(${mix([50, 50, 90], [120, 140, 190], day)})`);
      if (season.snow > 0.4) ridge(30, PH - 18, 3, 11, 1.3, 'rgba(240,244,250,0.5)');
      ridge(26, PH, 5, 17, 4.1, `rgb(${mix([35, 60, 50], [110, 170, 110], day)})`);
      // the rest of the city on the skyline, in the era's shapes
      if (this.tier >= 2) {
        const era = this.era, n = day < 0.5;
        for (let i = 0, px = 2; px < PW - 6; i++) {
          const r = hash(i, 31), w = 6 + ((r * 10) | 0), hgt = (era === 'classic' ? 10 : 18) + ((hash(i, 33) * (era === 'modern' ? 56 : era === 'deco' ? 44 : 14)) | 0);
          const col = era === 'modern' ? (r < 0.5 ? [111, 168, 214] : [200, 196, 186]) : era === 'deco' ? (r < 0.5 ? [201, 180, 138] : [168, 85, 58]) : [181, 96, 63];
          const c = mix([30, 34, 70], col, day * 0.8 + 0.1);
          const y0 = PH - hgt;
          rect(x, px, y0, w, hgt, `rgb(${c})`);
          if (era === 'deco' && hgt > 30) { rect(x, px + 1, y0 - 4, w - 2, 4, `rgb(${c})`); rect(x, px + (w >> 1) - 1, y0 - 12, 2, 8, `rgb(${c})`); }
          if (era === 'modern' && r < 0.5) rect(x, px + 1, y0, 1, hgt, 'rgba(255,255,255,0.35)');
          for (let wy = y0 + 3; wy < PH - 2; wy += 4) for (let wx = px + 1; wx < px + w - 1; wx += 3) if (hash(wx * 7 + wy, i) < (n ? 0.35 : 0.5)) rect(x, wx, wy, 1, 2, n ? '#ffd77a' : 'rgba(255,255,255,0.35)');
          if (era === 'modern' && i % 13 === 6) { // a TV tower on the skyline
            rect(x, px + w + 4, PH - 90, 2, 90, `rgb(${c})`);
            for (const [yy, rr] of [[PH - 40, 5], [PH - 70, 4]]) { x.fillStyle = '#d0567a'; x.beginPath(); x.arc(px + w + 5, yy, rr, 0, 7); x.fill(); }
          }
          px += w + ((hash(i, 32) * 6) | 0);
        }
      }
    });
    this.pano = p; p.PW = PW; p.PH = PH;
    return p;
  }

  // ---------- input ----------
  installKeys() {
    const on = (e) => {
      if (this.ride.view !== 'walk' || document.getElementById('focus').hidden) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (e.type === 'keydown') {
        if ((k === 'e' || k === 'enter' || k === ' ') && !e.repeat && this.prompts.length && this.onAct) this.onAct(this.prompts[0]);
        this.keys.add(k);
      } else this.keys.delete(k);
    };
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    window.addEventListener('blur', () => this.keys.clear());
    // on a computer, double-click to steer with the mouse (Esc to let go)
    document.addEventListener('dblclick', () => {
      if (this.ride.view !== 'walk' || document.getElementById('focus').hidden) return;
      if (document.pointerLockElement) document.exitPointerLock(); else this.ride.c.requestPointerLock?.();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement && this.ride.view === 'walk') this.lookBy(e.movementX, e.movementY);
    });
  }
  lookBy(dx, dy) {
    this.yaw += dx * 0.006;
    this.pitch = clamp(this.pitch - dy * 0.004, -0.55, 0.55);
  }
  // touch: the left of the screen is a thumbstick, the right turns your head
  pointer(e, type) {
    const id = e.pointerId;
    if (type === 'down') {
      const mouse = e.pointerType === 'mouse';
      const stick = !mouse && e.clientX < this.ride.W * 0.45;
      this.touches.set(id, { stick, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now() });
    } else if (type === 'move') {
      const t = this.touches.get(id);
      if (!t) return;
      if (!t.stick) this.lookBy(e.clientX - t.x, e.clientY - t.y);
      t.x = e.clientX; t.y = e.clientY;
    } else {
      this.touches.delete(id);
    }
    // the stick's direction
    let f = 0, s = 0;
    for (const t of this.touches.values()) if (t.stick) {
      const dx = t.x - t.x0, dy = t.y - t.y0, len = Math.hypot(dx, dy), r = 50;
      const k = Math.min(1, len / r) / (len || 1);
      f = -dy * k; s = dx * k;
    }
    this.move.f = f; this.move.s = s;
  }

  // ---------- update ----------
  update(dt) {
    const k = this.keys;
    let f = this.move.f, s = this.move.s;
    if (k.has('w') || k.has('arrowup')) f += 1;
    if (k.has('s') || k.has('arrowdown')) f -= 1;
    if (k.has('d')) s += 1;
    if (k.has('a')) s -= 1;
    if (k.has('arrowleft') || k.has('q')) this.yaw -= dt * 2.2;
    if (k.has('arrowright')) this.yaw += dt * 2.2;
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const run = k.has('shift') ? 1.8 : 1;
    const sp = 2.6 * run; // tiles per second, a brisk walk
    const fx = Math.cos(this.yaw), fy = Math.sin(this.yaw), rx = -fy, ry = fx;
    const vx = (fx * f + rx * s) * sp, vy = (fy * f + ry * s) * sp;
    // move one axis at a time, so you slide along walls instead of sticking
    const solid = (x, y) => { const N = this.N, cx = Math.floor(x), cy = Math.floor(y); return cx < 0 || cy < 0 || cx >= N || cy >= N || this.wall[cy * N + cx] > 0; };
    const free = (x, y) => !solid(x - RAD, y - RAD) && !solid(x + RAD, y - RAD) && !solid(x - RAD, y + RAD) && !solid(x + RAD, y + RAD);
    const nx = this.x + vx * dt, ny = this.y + vy * dt;
    if (free(nx, this.y)) this.x = nx;
    if (free(this.x, ny)) this.y = ny;
    const moved = Math.hypot(vx, vy);
    this.speed += (moved - this.speed) * Math.min(1, dt * 10);
    this.bobT += dt * this.speed * 2.6;
    // people and traffic
    const t = this.ride.clock;
    for (const w of this.walkers) { w.t += w.v * dt; if (w.t < w.r.a || w.t > w.r.b) { w.v = -w.v; w.t = clamp(w.t, w.r.a, w.r.b); } }
    for (const cr of this.cars) { const L = cr.l.b - cr.l.a; cr.t = cr.l.a + ((((cr.t - cr.l.a + cr.v * dt) % L) + L) % L); }
    // what's in reach: a platform, a stop, a signpost
    this.findPrompts();
    this.t = t;
  }

  findPrompts() {
    const out = [], c = this.c, g = this.g;
    const onPlat = this.x > c - 10 && this.x < c + 10 && this.y > c - 1 && this.y < this.trackRow(Math.max(1, this.lines.length) - 1) + 0.2;
    if (onPlat) {
      for (const l of this.lines) {
        const st = g.stops(l), i = st.indexOf(this.town);
        const toward = st.filter((s) => s !== this.town).map((s) => g.node(s).name);
        out.push({ type: 'train', line: l.id, label: `🚆 Board · ${toward.join(' / ') || g.lineName(l)}`, color: l.color });
      }
      if (!this.lines.length) out.push({ type: 'none', label: 'No trains call here yet — build a line on the map' });
    }
    for (const st of this.stops) if (Math.hypot(st.x - this.x, st.y - this.y) < 1.6) {
      const m = TRANSIT[st.mode], l = g.transit(this.town)[st.idx];
      const ds = g.districts(this.town), names = l ? l.d.map((i) => (ds[i] ? ds[i].name : 'Central')) : [];
      out.push({ type: 'transit', node: this.town, idx: st.idx, label: `${m.icon} Ride the ${m.name.toLowerCase()} · ${names[0]} – ${names[names.length - 1]}`, color: m.color });
    }
    for (const s of this.signs) if (Math.hypot(s.x - this.x, s.y - this.y) < 1.6) out.push({ type: 'go', to: s.to, label: `🚶 Walk to ${g.node(s.to).name}` });
    const key = out.map((o) => o.label).join('|');
    if (key !== this.promptKey) { this.promptKey = key; this.prompts = out; if (this.onPrompts) this.onPrompts(out); }
  }

  // Trains of the lines that call here, where they are on the tracks through town.
  trainBoxes() {
    const boxes = [], g = this.g, c = this.c;
    this.lines.forEach((l, li) => {
      const st = g.stops(l), i = st.indexOf(this.town);
      if (i < 0) return;
      const gm = g.geom(l), sHere = gm.stopS[i], side = li % 2 ? -1 : 1;
      const model = MODELS[0];
      for (const tr of l.trains) {
        const m = MODELS[tr.m] || model;
        const rel = (tr.p * gm.len - sHere) * side * 0.9; // map units -> tiles
        const heading = tr.dir * side; // which way along x it's moving
        const cars = 1 + Math.min(4, Math.ceil((m.cap || 30) / 50));
        const lens = [2.6, ...Array(cars).fill(2.4)];
        const total = lens.reduce((a, b) => a + b, 0) + cars * 0.15;
        // the front of the train is at rel (it stops with its front past the middle of the platform)
        const front = c + 0.5 + rel + heading * 3;
        if (Math.abs(front - c) > this.N / 2 + total + 4) continue;
        let x = front;
        const row = this.trackRow(li) + 0.5;
        lens.forEach((len, k) => {
          const x1 = x, x0 = x - heading * len;
          boxes.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: row - 0.36, y1: row + 0.36, kind: k ? 'coach' : 'loco', style: m.style, color: l.color, len, flip: heading < 0, front: k === 0, back: k === lens.length - 1, heading });
          x = x0 - heading * 0.15;
        });
      }
    });
    return boxes;
  }

  // ---------- drawing ----------
  draw(ctx, CW, CH, dt, light, phase) {
    if (this.town == null || (this.builtKey && this.builtKey !== this.keyNow())) {
      const keep = this.town != null && this.town === this.lastTown ? { x: this.x, y: this.y, yaw: this.yaw } : null;
      this.enter(this.town);
      if (keep) Object.assign(this, keep);
    }
    this.lastTown = this.town;
    this.update(Math.min(dt, 0.1));
    // the pixel buffer: about 200 pixels across on a phone
    const low = this.g.state.settings.lowgfx;
    const RW = Math.round(clamp(CW / (low ? 2.6 : 2), 140, low ? 200 : 300)), RH = Math.round((RW * CH) / CW);
    if (!this.buf || this.buf.width !== RW || this.buf.height !== RH) {
      this.buf = document.createElement('canvas'); this.buf.width = RW; this.buf.height = RH;
      this.bctx = this.buf.getContext('2d');
      this.img = this.bctx.createImageData(RW, RH);
      this.px = new Uint32Array(this.img.data.buffer);
      this.hitD = new Float32Array(RW * 8); this.hitT = new Float32Array(RW * 8); this.hitB = new Float32Array(RW * 8); this.hitN = new Uint8Array(RW);
    }
    const haze = mix([40, 40, 80], [196, 220, 238], light).map((v) => v | 0);
    const tc = this.textures(light, haze);
    const pano = this.panorama(light, phase);
    this.render(RW, RH, tc, pano, haze, light);
    this.bctx.putImageData(this.img, 0, 0);
    if (ctx.isGL) ctx.refresh(this.buf); else ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buf, 0, 0, CW, CH);
    if (!ctx.isGL) ctx.imageSmoothingEnabled = true;
    this.overlay(ctx, CW, CH);
    if (this.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(0, 0, CW, CH); this.fade = Math.max(0, this.fade - dt * 2); }
    const g = this.g, n = g.node(this.town);
    this.ride.info = { label: `🚶 ${n.name} · ${TIERS[this.tier].name}`, sub: this.prompts.length ? 'Something to ride here — tap the button' : this.lines.length ? 'The station is where you started · signposts at the edge of town' : 'Explore the town', progress: 0, moving: false, model: { name: '' }, tr: { load: {} } };
  }
  keyNow() { const g = this.g, id = this.town; return `${id}|${g.tier(id)}|${eraOf(g.year())}|${g.linesAt(id).length}|${g.transit(id).length}`; }

  render(RW, RH, tc, pano, haze, light) {
    const px = this.px, N = this.N, wall = this.wall, wv = this.wv, wh = this.wh, floor = this.floor;
    const proj = RW / 2 / TAN;
    const dirX = Math.cos(this.yaw), dirY = Math.sin(this.yaw);
    const plX = -dirY * TAN, plY = dirX * TAN;
    // head-bob: whole pixels only, so it never smears the pixel grid
    const bob = Math.round(Math.sin(this.bobT * Math.PI) * Math.min(1, this.speed / 2) * 2);
    const hor = Math.round(RH / 2 + this.pitch * proj) + bob;
    const camZ = EYE;
    const hazeP = pack(haze[0], haze[1], haze[2]);
    const fogStep = MAXD / FOG;
    // sky
    const PW = pano.w, PH = pano.h, pb = pano.base;
    const colU = this.colU || (this.colU = new Int32Array(1024));
    for (let x = 0; x < RW; x++) {
      const cam = (2 * (x + 0.5)) / RW - 1;
      const a = this.yaw + Math.atan(cam * TAN);
      colU[x] = (((((a / (Math.PI * 2)) % 1) + 1) % 1) * PW) | 0;
    }
    const skyLight = 1;
    for (let y = 0; y < Math.min(hor, RH); y++) {
      const el = Math.atan((hor - y) / proj);
      const pr = clamp(PH - 1 - ((el / 0.75) * PH) | 0, 0, PH - 1) * PW;
      const row = y * RW;
      for (let x = 0; x < RW; x++) px[row + x] = pb[pr + colU[x]];
    }
    // floor, cast row by row
    const rd0X = dirX - plX, rd0Y = dirY - plY;
    const fl = tc.floors;
    for (let y = Math.max(0, hor); y < RH; y++) {
      const p = y + 0.5 - hor;
      const rowD = (camZ * proj) / p;
      const row = y * RW;
      if (rowD > MAXD) { for (let x = 0; x < RW; x++) px[row + x] = hazeP; continue; }
      const lvl = Math.min(FOG - 1, (rowD / fogStep) | 0);
      let fx = this.x + rowD * rd0X, fy = this.y + rowD * rd0Y;
      const sx = (rowD * 2 * plX) / RW, sy = (rowD * 2 * plY) / RW;
      for (let x = 0; x < RW; x++, fx += sx, fy += sy) {
        const cx = fx >= 0 ? fx | 0 : -1, cy = fy >= 0 ? fy | 0 : -1;
        const ft = cx >= 0 && cy >= 0 && cx < N && cy < N ? floor[cy * N + cx] : 0;
        const tex = fl[ft].lv[lvl];
        px[row + x] = tex[((((fy - cy) * FT) | 0) & 15) * FT + ((((fx - cx) * FT) | 0) & 15)];
      }
    }
    // walls: a ray per column, through the grid (DDA), keeping every wall
    // that peeks out above the ones in front of it, then the trains
    const boxes = this.trainBoxes();
    const hitD = this.hitD, hitT = this.hitT, hitB = this.hitB, hitN = this.hitN;
    const hits = this.hitList || (this.hitList = []);
    for (let x = 0; x < RW; x++) {
      const cam = (2 * (x + 0.5)) / RW - 1;
      const rX = dirX + plX * cam, rY = dirY + plY * cam;
      let mx = Math.floor(this.x), my = Math.floor(this.y);
      const dX = Math.abs(1 / rX), dY = Math.abs(1 / rY);
      let stX, stY, sdX, sdY;
      if (rX < 0) { stX = -1; sdX = (this.x - mx) * dX; } else { stX = 1; sdX = (mx + 1 - this.x) * dX; }
      if (rY < 0) { stY = -1; sdY = (this.y - my) * dY; } else { stY = 1; sdY = (my + 1 - this.y) * dY; }
      hits.length = 0;
      let minTop = RH, prevH = 0;
      for (let step = 0; step < 120; step++) {
        let side;
        if (sdX < sdY) { sdX += dX; mx += stX; side = 0; } else { sdY += dY; my += stY; side = 1; }
        if (mx < 0 || my < 0 || mx >= N || my >= N) break;
        const i = my * N + mx, k = wall[i];
        if (!k) { prevH = 0; continue; }
        const h = wh[i];
        if (h <= prevH) continue; // the inside of a building, or a lower part behind
        prevH = h;
        const d = side === 0 ? sdX - dX : sdY - dY;
        if (d > MAXD) break;
        const top = hor - ((h - camZ) * proj) / d;
        if (top >= minTop) continue;
        let u = side === 0 ? this.y + d * rY : this.x + d * rX;
        u -= Math.floor(u);
        if ((side === 0 && rX > 0) || (side === 1 && rY < 0)) u = 1 - u;
        hits.push({ d, k, v: wv[i], h, u, side, base: 0 });
        minTop = top;
        if (top <= 0) break;
      }
      // trains: boxes along the track, intersected as four thin walls each
      for (const b of boxes) {
        // long sides (y = const) and ends (x = const)
        for (const yy of [b.y0, b.y1]) {
          if (!rY) continue;
          const t = (yy - this.y) / rY;
          if (t <= 0.05 || t > MAXD) continue;
          const hx = this.x + t * rX;
          if (hx < b.x0 || hx > b.x1) continue;
          let u = (hx - b.x0) / (b.x1 - b.x0);
          if (b.flip) u = 1 - u; // the engine's front is at the right of its picture
          hits.push({ d: t, train: b, u, face: 'side', h: 1.12, base: 0.04 });
        }
        for (const xx of [b.x0, b.x1]) {
          if (!rX) continue;
          const t = (xx - this.x) / rX;
          if (t <= 0.05 || t > MAXD) continue;
          const hy = this.y + t * rY;
          if (hy < b.y0 || hy > b.y1) continue;
          hits.push({ d: t, train: b, u: (hy - b.y0) / (b.y1 - b.y0), face: 'end', h: 1.12, base: 0.04 });
        }
      }
      hits.sort((a, b) => b.d - a.d);
      let nH = 0;
      for (let hi = 0; hi < hits.length; hi++) {
        const hit = hits[hi];
        const d = hit.d, scale = proj / d;
        const lvl = Math.min(FOG - 1, (d / fogStep) | 0);
        const yTop = hor - (hit.h + hit.base - camZ) * scale, yBot = hor + (camZ - hit.base) * scale;
        const y0 = Math.max(0, Math.ceil(yTop)), y1 = Math.min(RH, Math.ceil(yBot));
        if (hit.train) {
          const b = hit.train;
          const T = hit.face === 'side' ? this.sprite(`train:${b.kind}:${b.style}:${b.color}:${b.len}`, 0) : this.sprite(`train:end:${b.style}:${b.color}:0.72`, 0);
          const tex = T.lv[lvl], tw = T.w, th = T.h;
          const tx = Math.min(tw - 1, (hit.u * tw) | 0);
          for (let y = y0; y < y1; y++) {
            const ty = Math.min(th - 1, (((y + 0.5 - yTop) / (yBot - yTop)) * th) | 0);
            const cc = tex[ty * tw + tx];
            if (cc) px[y * RW + x] = cc;
          }
        } else {
          const T = tc.walls[hit.k * 4 + hit.v], tex = T.lv[lvl];
          const tx = Math.min(TS - 1, (hit.u * TS) | 0);
          const h = hit.h, roof = h >= 1.4;
          const shade = hit.side ? 0 : 1;
          let z = camZ + (hor - (y0 + 0.5)) / scale;
          const dz = 1 / scale;
          for (let y = y0; y < y1; y++, z -= dz) {
            let row;
            if (roof && z > h - 0.5) row = ((h - z) * 2 * 16) | 0;
            else if (z < 1) row = 48 + (((1 - z) * 32) | 0);
            else row = 16 + (((1 - (z - Math.floor(z))) * 32) | 0);
            if (row > 79) row = 79; else if (row < 0) row = 0;
            const cc = tex[row * TS + tx];
            if (!cc) continue;
            // the walls facing across the grid are a touch darker, for shape
            px[y * RW + x] = shade ? cc : ((cc >>> 1) & 0x7f7f7f) + ((cc >>> 2) & 0x3f3f3f) + ((cc >>> 3) & 0x1f1f1f) | 0xff000000;
          }
        }
        if (nH < 8) { hitD[x * 8 + nH] = d; hitT[x * 8 + nH] = yTop; hitB[x * 8 + nH] = yBot; nH++; }
      }
      hitN[x] = nH;
    }
    // sprites, far to near, hidden behind any wall that's nearer
    const list = this.spriteList || (this.spriteList = []);
    list.length = 0;
    const rgtX = -dirY, rgtY = dirX;
    const addS = (k, v, sx, sy, extra) => {
      const dx = sx - this.x, dy = sy - this.y;
      const depth = dx * dirX + dy * dirY;
      if (depth < 0.15 || depth > MAXD) return;
      const lat = dx * rgtX + dy * rgtY;
      if (Math.abs(lat) > depth * TAN + 4) return;
      list.push({ k, v, depth, lat, extra });
    };
    for (const s of this.sprites) addS(s.k, s.v, s.x, s.y);
    for (const w of this.walkers) {
      const sx = w.r.ax === 'x' ? w.t : w.r.at, sy = w.r.ax === 'x' ? w.r.at : w.t;
      addS('person', (w.look % 24) | ((Math.floor(this.ride.clock * 4 + w.look) & 1) * 64), sx, sy);
    }
    for (const cr of this.cars) {
      const along = cr.t, sx = cr.l.ax === 'x' ? along : cr.l.at + cr.off, sy = cr.l.ax === 'x' ? cr.l.at + cr.off : along;
      // side-on or end-on, depending on how it's heading compared with where you're looking from
      const hx = cr.l.ax === 'x' ? Math.sign(cr.v) : 0, hy = cr.l.ax === 'y' ? Math.sign(cr.v) : 0;
      const vx = sx - this.x, vy = sy - this.y, vl = Math.hypot(vx, vy) || 1;
      const dot = (hx * vx + hy * vy) / vl;
      const big = cr.kind === 'bus';
      if (Math.abs(dot) > 0.7) addS(big ? 'busEnd' : 'carEnd', big ? cr.col : cr.col + (dot > 0 ? 6 : 0), sx, sy);
      else {
        // facing left or right on screen
        const crossR = hx * rgtX + hy * rgtY;
        addS(big ? 'bus' : 'car', cr.col, sx, sy, { flip: crossR < 0 });
      }
    }
    list.sort((a, b) => b.depth - a.depth);
    for (const s of list) {
      const T = this.sprite(s.k, s.v), tex = T.lv[Math.min(FOG - 1, (s.depth / fogStep) | 0)];
      const [sw, sh] = T.size;
      const scale = proj / s.depth;
      const cx = RW / 2 + s.lat * scale;
      const w = sw * scale, yBot = hor + camZ * scale, yTop = yBot - sh * scale;
      const x0 = Math.max(0, Math.ceil(cx - w / 2)), x1 = Math.min(RW, Math.ceil(cx + w / 2));
      const y0 = Math.max(0, Math.ceil(yTop)), y1 = Math.min(RH, Math.ceil(yBot));
      if (x1 <= x0 || y1 <= y0) continue;
      const flip = s.extra && s.extra.flip;
      for (let x = x0; x < x1; x++) {
        // the part of this column covered by nearer walls
        let oT = RH, oB = -1;
        for (let k = 0, n = hitN[x]; k < n; k++) if (hitD[x * 8 + k] < s.depth) { if (hitT[x * 8 + k] < oT) oT = hitT[x * 8 + k]; if (hitB[x * 8 + k] > oB) oB = hitB[x * 8 + k]; }
        let tx = (((x + 0.5 - (cx - w / 2)) / w) * T.w) | 0;
        if (tx < 0) tx = 0; else if (tx >= T.w) tx = T.w - 1;
        if (flip) tx = T.w - 1 - tx;
        for (let y = y0; y < y1; y++) {
          if (y >= oT && y <= oB) continue;
          const ty = Math.min(T.h - 1, (((y + 0.5 - yTop) / (yBot - yTop)) * T.h) | 0);
          const cc = tex[ty * T.w + tx];
          if (cc) px[y * RW + x] = cc;
        }
      }
    }
    // your hands, holding a ticket: drawn on the same pixel grid, swaying as you walk
    this.drawHands(RW, RH, light);
  }

  drawHands(RW, RH, light) {
    const px = this.px;
    const k = Math.min(1, this.speed / 2);
    // sway side to side and dip with each step, in whole pixels
    const sway = Math.round(Math.sin(this.bobT * Math.PI * 0.5) * 3 * k);
    const lift = Math.round(Math.abs(Math.cos(this.bobT * Math.PI * 0.5)) * 2 * k + Math.sin(this.ride.clock * 1.3) * 0.6);
    const s = Math.max(2, Math.round(RW / 70)); // whole-pixel scale steps only
    const L = Math.max(0.35, light);
    const line = this.lines[0] ? hex(this.lines[0].color) : [228, 87, 46];
    const C = {
      O: pack(43 * L, 33 * L, 64 * L), s: pack(242 * L, 201 * L, 160 * L), S: pack(214 * L, 160 * L, 118 * L),
      c: pack(45 * L, 108 * L, 223 * L), C: pack(30 * L, 80 * L, 170 * L), p: pack(251 * L, 246 * L, 234 * L),
      t: pack(line[0] * L, line[1] * L, line[2] * L), k: pack(110 * L, 110 * L, 120 * L),
    };
    const put = (art, ox, oy, flip) => {
      for (let y = 0; y < art.length; y++) {
        const row = art[y];
        for (let x = 0; x < row.length; x++) {
          const ch = row[flip ? row.length - 1 - x : x];
          if (ch === '.') continue;
          const c = C[ch];
          for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) {
            const X = (ox + x) * s + a, Y = (oy + y) * s + b;
            if (X >= 0 && Y >= 0 && X < RW && Y < RH) px[Y * RW + X] = c;
          }
        }
      }
    };
    const W0 = Math.floor(RW / s), H0 = Math.floor(RH / s);
    // the ticket, then the right hand holding it from below
    put(TICKET, W0 - 25 + sway, H0 - 24 + lift);
    put(HAND, W0 - 19 + sway, H0 - 15 + lift);
    // the left hand, lower and to the side
    put(FIST, 3 - sway, H0 - 11 + lift, true);
  }

  overlay(ctx, CW, CH) {
    // the thumbstick
    for (const t of this.touches.values()) if (t.stick) {
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(t.x0, t.y0, 50, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.6;
      const dx = t.x - t.x0, dy = t.y - t.y0, l = Math.hypot(dx, dy), k = l > 50 ? 50 / l : 1;
      ctx.beginPath(); ctx.arc(t.x0 + dx * k, t.y0 + dy * k, 22, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // a little map of the town, north up
    const N = this.N;
    if (!this.mini) {
      const c = document.createElement('canvas'); c.width = N; c.height = N;
      const x = c.getContext('2d'), id = x.createImageData(N, N), d = new Uint32Array(id.data.buffer);
      const fc = { [F.grass]: pack(108, 191, 74), [F.road]: pack(74, 70, 82), [F.walk]: pack(201, 195, 184), [F.plat]: pack(179, 168, 152), [F.rail]: pack(110, 100, 90), [F.path]: pack(217, 199, 154), [F.square]: pack(217, 205, 176), [F.tram]: pack(74, 70, 82), [F.field]: pack(201, 169, 74), [F.gravel]: pack(154, 145, 132) };
      for (let i = 0; i < N * N; i++) d[i] = this.wall[i] ? (this.wall[i] === W.hedge ? pack(47, 106, 58) : pack(120, 110, 130)) : fc[this.floor[i]];
      x.putImageData(id, 0, 0);
      this.mini = c;
    }
    const ms = Math.min(1.6, 110 / N), mx = 12, my = 66;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.mini, mx, my, N * ms, N * ms);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.strokeRect(mx, my, N * ms, N * ms);
    for (const s of this.stops) { ctx.fillStyle = TRANSIT[s.mode].color; ctx.fillRect(mx + s.x * ms - 2, my + s.y * ms - 2, 4, 4); }
    for (const s of this.signs) { ctx.fillStyle = '#ffd84a'; ctx.fillRect(mx + s.x * ms - 2, my + s.y * ms - 2, 4, 4); }
    const ax = mx + this.x * ms, ay = my + this.y * ms;
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(this.yaw) * 6, ay + Math.sin(this.yaw) * 6);
    ctx.lineTo(ax + Math.cos(this.yaw + 2.5) * 4, ay + Math.sin(this.yaw + 2.5) * 4);
    ctx.lineTo(ax + Math.cos(this.yaw - 2.5) * 4, ay + Math.sin(this.yaw - 2.5) * 4);
    ctx.closePath(); ctx.fill();
  }
}

// your hands, as pixel art (O outline, s/S skin and shadow, c/C sleeve, p paper, t the line's colour, k print)
const TICKET = [
  'OOOOOOOOOOOOOOOOOO',
  'OppppppppppppppppO',
  'OttttttttttttttttO',
  'OttttttttttttttttO',
  'OppppppppppppppppO',
  'OpkkkkkpppkkkkpppO',
  'OppppppppppppppppO',
  'OpkkkpkkkkkppkkppO',
  'OppppppppppppppppO',
  'OOOOOOOOOOOOOOOOOO',
];
const HAND = [
  '.OO.OO.OO.....',
  'OssOssOssOO...',
  'OssOssOssOsO..',
  'OssOssOssOsO..',
  'OsssssssssSO..',
  'OssssssssSSOO.',
  'OsssssssSSSsO.',
  '.OssssssSSssO.',
  '.OsssssSSsssO.',
  '..OsssSSsssO..',
  '..OOcccccccO..',
  '..OccccccCCO..',
  '..OccccccCCO..',
  '..OccccccCCO..',
  '..OccccccCCO..',
];
const FIST = [
  '..OOOOOOO...',
  '.OsssssssOO.',
  'OsssssssssO.',
  'OssOssOssSO.',
  'OssOssOssSO.',
  '.OsssssssSO.',
  '..OccccccCO.',
  '..OccccccCO.',
  '..OccccccCO.',
  '..OccccccCO.',
  '..OccccccCO.',
];

function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * clamp(t, 0, 1))); }
