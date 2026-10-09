// City buildings by era, painted once into cached images and stamped
// wherever a city needs them: on the map, beside the line and in the
// skyline seen from the bus.
//   classic (before 1880): brick apartment blocks
//   deco    (1880-1979):   stepped Art Deco skyscrapers with spires, brick
//                          and limestone blocks, theatres, columned halls
//   modern  (1980 on):     glass skyscrapers, balconied residential towers,
//                          low glass malls and a TV tower landmark
// Art direction after the pixel-art city sets the player shared, redrawn
// in the game's outlined cartoon style.
import { OL, shade, mipFor, season } from './toon.js';

export function eraOf(year) { return year >= 1980 ? 'modern' : year >= 1880 ? 'deco' : 'classic'; }

const BW = 120; // sprites are painted 120 px wide; the height depends on the kind
const cache = new Map();
let cacheSnow = -1;

function hashv(a, b) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }

// window grid helper
function windows(c, x0, y0, x1, y1, cw, ch, gx, gy, col, lit = 0) {
  for (let y = y0; y + ch <= y1; y += ch + gy) for (let x = x0; x + cw <= x1; x += cw + gx) {
    c.fillStyle = lit && hashv(x, y) < lit ? '#ffe9a8' : col;
    c.fillRect(x, y, cw, ch);
  }
}
function outline(c, path, fill, lw = 4) { c.beginPath(); path(); c.fillStyle = fill; c.fill(); c.lineWidth = lw; c.strokeStyle = OL; c.lineJoin = 'round'; c.stroke(); }
function snowTop(c, x, y, w) { if (season.snow < 0.3) return; c.fillStyle = '#f4f7fb'; c.fillRect(x, y - 3, w, 5); }

const PAINT = {
  // ---------- 1880-1979: Art Deco ----------
  decoTower(c, v) {
    const H = 380, col = ['#d9c49a', '#a9adb8', '#b5603f', '#c9b48a'][v % 4], dark = shade(col, -0.25);
    // three setbacks and a crown
    const tiers = [[14, 160, 106], [26, 90, 94], [38, 40, 82]];
    outline(c, () => c.rect(14, 160, 92, H - 160), col);
    outline(c, () => c.rect(26, 90, 68, 72), col);
    outline(c, () => c.rect(38, 44, 44, 48), col);
    // vertical piers and window strips
    for (const [x0, y0, x1] of tiers) {
      for (let x = x0 + 8; x < x1 - 6; x += 12) { c.fillStyle = '#5d7fb8'; c.fillRect(x, y0 + 8, 6, (y0 === 160 ? H - 20 : y0 === 90 ? 160 : 90) - y0 - 12); }
      c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(x0 + 2, y0 + 2, 6, 40);
    }
    c.fillStyle = dark; c.fillRect(14, 156, 92, 6); c.fillRect(26, 86, 68, 6);
    // the crown: a stepped spire, or a sunburst of arches
    if (v % 2) {
      outline(c, () => { c.moveTo(40, 46); c.lineTo(60, 2); c.lineTo(80, 46); c.closePath(); }, '#c9ced6', 3);
      for (let k = 0; k < 3; k++) { c.strokeStyle = OL; c.lineWidth = 2; c.beginPath(); c.arc(60, 46 - k * 8, 18 - k * 5, Math.PI, 0); c.stroke(); }
      c.fillStyle = '#5d7fb8'; for (let k = 0; k < 3; k++) c.fillRect(55, 18 + k * 9, 10, 4);
    } else {
      outline(c, () => c.rect(48, 22, 24, 24), col, 3);
      outline(c, () => { c.moveTo(56, 22); c.lineTo(60, 0); c.lineTo(64, 22); c.closePath(); }, '#7fa8a0', 2.5);
    }
    // an entrance with a canopy
    c.fillStyle = '#3a3340'; c.fillRect(48, H - 26, 24, 24);
    c.fillStyle = '#e0b84a'; c.fillRect(40, H - 32, 40, 6);
    snowTop(c, 14, 160, 92);
    return H;
  },
  decoBlock(c, v) {
    const H = 210, col = ['#b5603f', '#d9c49a', '#c9785a', '#a9adb8'][v % 4];
    outline(c, () => c.rect(10, 22, 100, H - 24), col);
    c.fillStyle = shade(col, -0.3); c.fillRect(6, 14, 108, 12);
    c.strokeStyle = OL; c.lineWidth = 3; c.strokeRect(6, 14, 108, 12);
    for (let x = 22; x < 104; x += 18) { c.fillStyle = shade(col, 0.12); c.fillRect(x - 4, 26, 3, H - 30); }
    windows(c, 20, 36, 102, H - 40, 12, 18, 6, 10, '#9ac8e8');
    c.fillStyle = '#e0b84a'; c.fillRect(10, H - 40, 100, 5);
    c.fillStyle = '#3a3340'; c.fillRect(50, H - 32, 20, 30);
    snowTop(c, 6, 14, 108);
    return H;
  },
  theater(c, v) {
    const H = 170, col = ['#c9785a', '#d9c49a', '#7fa8a0'][v % 3];
    outline(c, () => c.rect(8, 50, 104, H - 52), col);
    // the sign tower with neon letters
    outline(c, () => c.roundRect(44, 6, 32, 90, 6), '#2b2140', 3);
    c.fillStyle = ['#ff5fa2', '#5fe0ff', '#ffd84a'][v % 3]; c.font = '900 11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    ['THEATER', 'JAZZ', 'METRO'][v % 3].split('').forEach((ch, i, a) => c.fillText(ch, 60, 51 - (a.length - 1) * 5.5 + i * 11));
    // the marquee with bulbs
    outline(c, () => c.rect(14, 100, 92, 22), '#fbf6ea', 3);
    c.fillStyle = '#e0594a'; c.font = '900 13px system-ui'; c.fillText('TONIGHT', 60, 111);
    c.fillStyle = '#ffe28a'; for (let x = 18; x < 104; x += 8) { c.fillRect(x, 97, 3, 3); c.fillRect(x, 123, 3, 3); }
    c.fillStyle = '#3a3340'; c.fillRect(30, H - 40, 60, 38);
    c.fillStyle = '#e0b84a'; c.fillRect(30, H - 40, 60, 4);
    return H;
  },
  civic(c) {
    const H = 150;
    outline(c, () => { c.moveTo(4, 50); c.lineTo(60, 14); c.lineTo(116, 50); c.closePath(); }, '#e6dcc4');
    outline(c, () => c.rect(8, 50, 104, 12), '#d9cdb0', 3);
    for (let x = 16; x < 108; x += 18) outline(c, () => c.rect(x, 62, 10, H - 82), '#efe6cf', 2.5);
    outline(c, () => c.rect(4, H - 20, 112, 18), '#cfc3a6', 3);
    c.fillStyle = '#3a3340'; c.fillRect(52, H - 70, 16, 50);
    // a clock in the pediment
    outline(c, () => c.arc(60, 36, 8, 0, Math.PI * 2), '#fbf6ea', 2);
    c.strokeStyle = OL; c.lineWidth = 1.5; c.beginPath(); c.moveTo(60, 36); c.lineTo(60, 31); c.moveTo(60, 36); c.lineTo(64, 37); c.stroke();
    return H;
  },

  // ---------- 1980 on: modern ----------
  glass(c, v) {
    const H = [420, 380, 440, 400][v % 4];
    const col = ['#6fa8d6', '#4f8fc0', '#5fb8a8', '#8fc4e8'][v % 4];
    const shape = v % 4;
    const body = () => {
      if (shape === 1) { c.moveTo(18, H - 2); c.lineTo(30, 20); c.lineTo(90, 20); c.lineTo(102, H - 2); c.closePath(); } // tapered
      else if (shape === 2) { c.moveTo(14, H - 2); c.lineTo(14, 40); c.lineTo(34, 18); c.lineTo(86, 18); c.lineTo(106, 40); c.lineTo(106, H - 2); c.closePath(); } // bevelled corners
      else c.rect(16, 20, 88, H - 22);
    };
    outline(c, body, col);
    c.save(); c.beginPath(); body(); c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.5;
    c.beginPath();
    for (let y = 30; y < H; y += 12) { c.moveTo(0, y); c.lineTo(BW, y); }
    for (let x = 24; x < 100; x += 14) { c.moveTo(x, 0); c.lineTo(x, H); }
    c.stroke();
    // a sweep of sky reflected in the glass
    c.fillStyle = 'rgba(255,255,255,0.28)';
    c.beginPath(); c.moveTo(20, H * 0.15); c.lineTo(60, H * 0.05); c.lineTo(28, H * 0.75); c.lineTo(16, H * 0.8); c.closePath(); c.fill();
    c.fillStyle = shade(col, -0.2); c.fillRect(78, 0, 30, H);
    c.restore();
    // a rooftop crown and a mast
    outline(c, () => c.rect(36, 6, 48, 16), '#9aa1aa', 3);
    if (v % 2 === 0) { c.fillStyle = OL; c.fillRect(58, -10, 3, 18); }
    c.fillStyle = '#3a3340'; c.fillRect(46, H - 24, 28, 22);
    return H;
  },
  resi(c, v) {
    const H = 300, col = ['#e6dfd2', '#d9c9b0', '#c9ced6', '#e2c9a0'][v % 4];
    outline(c, () => c.rect(10, 20, 100, H - 22), col);
    c.fillStyle = '#9aa1aa'; c.fillRect(6, 12, 108, 10);
    c.strokeStyle = OL; c.lineWidth = 3; c.strokeRect(6, 12, 108, 10);
    // rows of balconies with windows and the odd air-conditioner
    for (let y = 30; y < H - 40; y += 24) {
      for (let x = 18; x < 104; x += 30) {
        c.fillStyle = '#7fb6dc'; c.fillRect(x, y, 22, 14);
        c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(x + 2, y + 2, 5, 10);
        c.fillStyle = '#5a5f6a'; c.fillRect(x - 2, y + 14, 26, 3);
        if (hashv(x, y + v) < 0.3) { c.fillStyle = '#f4f6f8'; c.fillRect(x + 22, y + 4, 6, 6); }
      }
    }
    c.fillStyle = shade(col, -0.15); c.fillRect(56, 20, 8, H - 22);
    c.fillStyle = '#3a3340'; c.fillRect(48, H - 30, 24, 28);
    c.fillStyle = '#5d7fb8'; c.fillRect(42, H - 36, 36, 6);
    snowTop(c, 6, 12, 108);
    return H;
  },
  mall(c, v) {
    const H = 130;
    outline(c, () => c.rect(4, 40, 112, H - 42), ['#d9c9b0', '#c9ced6'][v % 2]);
    outline(c, () => c.rect(8, 60, 104, 40), '#8fc4e8', 3);
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5;
    c.beginPath(); for (let x = 20; x < 112; x += 14) { c.moveTo(x, 60); c.lineTo(x, 100); } c.stroke();
    // a roof garden
    outline(c, () => c.rect(10, 28, 100, 14), season.snow > 0.4 ? '#f4f7fb' : '#7cc95a', 3);
    c.fillStyle = '#3f8a4a'; for (let x = 20; x < 104; x += 16) { c.beginPath(); c.arc(x, 26, 6, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#e0594a'; c.fillRect(40, 44, 40, 10);
    c.fillStyle = '#fff'; c.font = '900 9px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('MALL', 60, 49);
    return H;
  },
  tvTower(c) {
    const H = 520;
    c.strokeStyle = OL; c.lineWidth = 4;
    // legs, shaft, two pods and a needle
    outline(c, () => { c.moveTo(30, H - 2); c.lineTo(56, 300); c.lineTo(64, 300); c.lineTo(90, H - 2); c.lineTo(78, H - 2); c.lineTo(60, 330); c.lineTo(42, H - 2); c.closePath(); }, '#c9ced6', 3);
    outline(c, () => c.rect(55, 80, 10, 330), '#d9dde2', 3);
    outline(c, () => c.arc(60, 360, 30, 0, Math.PI * 2), '#d0567a', 3.5);
    outline(c, () => c.arc(60, 170, 22, 0, Math.PI * 2), '#d0567a', 3.5);
    outline(c, () => c.arc(60, 96, 10, 0, Math.PI * 2), '#d0567a', 3);
    c.fillStyle = 'rgba(255,255,255,0.4)';
    for (const [y, r] of [[360, 30], [170, 22], [96, 10]]) { c.beginPath(); c.arc(60 - r * 0.35, y - r * 0.35, r * 0.3, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = OL; c.fillRect(58, 10, 4, 76);
    return H;
  },
  // ---------- before 1880 ----------
  brick(c, v) {
    const H = 170, col = ['#c9785a', '#d9b48a', '#b9a58f', '#e2c9a0'][v % 4];
    outline(c, () => c.rect(12, 24, 96, H - 26), col);
    c.fillStyle = '#5a4a3f'; c.fillRect(8, 14, 104, 12);
    c.strokeStyle = OL; c.lineWidth = 3; c.strokeRect(8, 14, 104, 12);
    windows(c, 24, 36, 100, H - 40, 16, 22, 10, 14, '#a9def5');
    c.fillStyle = '#8a5a35'; c.fillRect(50, H - 34, 20, 32);
    snowTop(c, 8, 14, 104);
    return H;
  },
};

// The cached image for one building.
export function buildingSprite(kind, v = 0) {
  const sk = Math.round(season.snow * 2);
  if (sk !== cacheSnow) { cache.clear(); cacheSnow = sk; }
  const key = `${kind}|${v}`;
  let spr = cache.get(key);
  if (!spr) {
    const probe = document.createElement('canvas');
    probe.width = BW; probe.height = 600;
    const x = probe.getContext('2d');
    x.translate(0, 14); // room above for masts
    const H = PAINT[kind](x, v) + 14;
    const c = document.createElement('canvas');
    c.width = BW; c.height = Math.ceil(H + 2);
    c.getContext('2d').drawImage(probe, 0, 0);
    spr = { c, h: c.height };
    cache.set(key, spr);
  }
  return spr;
}

// Draw a building standing on (x, y), w wide. Returns its height on screen.
export function drawBuilding(ctx, kind, v, x, y, w) {
  const spr = buildingSprite(kind, v);
  const h = (spr.h * w) / BW;
  ctx.drawImage(mipFor(spr.c, w), x - w / 2, y - h, w, h);
  return h;
}

// Which building goes in slot i of a city's centre, by era.
export function cityPick(era, tier, i, c) {
  if (era === 'modern') {
    if (tier >= 3 && i === 0) return ['tvTower', 0];
    if (i < (tier >= 3 ? 7 : 3)) return ['glass', (i + c) % 4];
    if (i % 5 === 4) return ['mall', c % 2];
    return ['resi', (i + c) % 4];
  }
  if (era === 'deco') {
    if (i < (tier >= 3 ? 6 : 2)) return ['decoTower', (i + c) % 4];
    if (i === 7) return ['theater', c % 3];
    if (i === 11) return ['civic', 0];
    return ['decoBlock', (i + c) % 4];
  }
  return ['brick', (i + c) % 4];
}

// ---------- street traffic ----------
// Side-on cars, buses and trams for the streets seen from the train, painted
// once per kind, colour and facing. Each sprite stands on its wheels.
const VCOL = ['#e4572e', '#2d6cdf', '#f3c623', '#3fa34d', '#f4f1ea', '#5a5f6a', '#8e6bd9'];
export const CAR_COLOURS = VCOL.length;
const vcache = new Map();
export function vehicleSprite(kind, colour, flip) {
  const key = `${kind}|${colour}|${flip ? 1 : 0}`;
  let spr = vcache.get(key);
  if (spr) return spr;
  const W0 = kind === 'car' ? 64 : 140, H0 = kind === 'car' ? 32 : 46;
  const c = document.createElement('canvas'); c.width = W0; c.height = H0;
  const x = c.getContext('2d');
  if (flip) { x.translate(W0, 0); x.scale(-1, 1); }
  x.lineJoin = 'round';
  const col = typeof colour === 'number' ? VCOL[colour % VCOL.length] : colour;
  if (kind === 'car') {
    outline(x, () => { x.moveTo(14, 12); x.lineTo(22, 4); x.lineTo(42, 4); x.lineTo(50, 12); x.closePath(); }, '#bfe3f7', 3);
    outline(x, () => x.roundRect(3, 12, 58, 12, 5), col, 3);
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(8, 14, 46, 2.5);
    x.fillStyle = '#ffe28a'; x.fillRect(56, 15, 4, 3); // head lamp at the front (right)
    x.fillStyle = '#e0303a'; x.fillRect(3, 15, 3, 3);
    for (const wx of [15, 49]) outline(x, () => x.arc(wx, 24, 5.5, 0, Math.PI * 2), '#2b2b33', 2);
  } else {
    // a bus, or an articulated tram with its pantograph
    const tram = kind === 'tram';
    outline(x, () => x.roundRect(4, tram ? 12 : 6, 132, tram ? 26 : 32, 8), col, 3.5);
    x.fillStyle = '#f4f6f8'; x.fillRect(8, tram ? 32 : 32, 124, 3);
    x.fillStyle = '#bfe3f7';
    for (let wx = 14; wx < 126; wx += 16) x.fillRect(wx, tram ? 16 : 11, 12, 10);
    x.fillStyle = '#bfe3f7'; x.fillRect(124, tram ? 16 : 11, 10, 14); // windscreen
    x.fillStyle = '#ffe28a'; x.fillRect(131, 30, 4, 3);
    if (tram) {
      x.strokeStyle = OL; x.lineWidth = 2; x.beginPath(); x.moveTo(70, 12); x.lineTo(60, 2); x.lineTo(80, 2); x.stroke();
      x.fillStyle = OL; x.fillRect(68, 12, 3, 26); // the articulation
      for (const wx of [22, 50, 92, 120]) outline(x, () => x.arc(wx, 40, 4.5, 0, Math.PI * 2), '#2b2b33', 2);
    } else for (const wx of [26, 112]) outline(x, () => x.arc(wx, 38, 6.5, 0, Math.PI * 2), '#2b2b33', 2);
  }
  spr = { c, w: W0, h: H0 };
  vcache.set(key, spr);
  return spr;
}
