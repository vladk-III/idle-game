// "Mode 7" ground for the cab view: a tiling cartoon grass texture drawn one
// scanline at a time onto a flat plane in front of the driver, so the ground
// streams towards you as the train moves and bends with the track.
import { mulberry32 } from './rng.js';
import { OL, mixHex, season } from './toon.js';

const TILE = 150;       // texture repeat, in view units (the cab's z / lat units)
const SIZE = 512;       // texture pixels across one tile at full detail

function paintTile(ctx) {
  const snow = season.snow, autumn = season.autumn;
  const g = (c) => mixHex(mixHex(c, '#b8b05a', autumn * 0.55), '#eef4fb', snow * 0.92);
  const base = g('#6cbf4a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const r = mulberry32(4242);
  // draw a shape at every wrapped position so the tile repeats seamlessly
  const wrap = (fn) => { for (const ox of [-SIZE, 0, SIZE]) for (const oy of [-SIZE, 0, SIZE]) fn(ox, oy); };
  // soft patches of lighter and darker grass
  const patches = [g('#8fdc66'), g('#4f9e38'), g('#9ae070'), g('#58a840')];
  for (let i = 0; i < 30; i++) {
    const x = r() * SIZE, y = r() * SIZE, rx = 30 + r() * 70, ry = 20 + r() * 50;
    ctx.fillStyle = patches[i % patches.length];
    ctx.globalAlpha = 0.85;
    wrap((ox, oy) => { ctx.beginPath(); ctx.ellipse(x + ox, y + oy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); });
  }
  ctx.globalAlpha = 1;
  // fine speckle so the ground visibly streams past, like an old racing game
  for (let i = 0; i < 900; i++) {
    const x = r() * SIZE, y = r() * SIZE;
    ctx.fillStyle = i % 3 ? g('#3f8a35') : g('#b5ea8a');
    ctx.fillRect(x, y, 3, 2);
  }
  // a few bare earth patches (not under snow)
  if (snow < 0.6) {
    for (let i = 0; i < 4; i++) {
      const x = r() * SIZE, y = r() * SIZE, rx = 14 + r() * 16, ry = 9 + r() * 8;
      wrap((ox, oy) => {
        ctx.beginPath(); ctx.ellipse(x + ox, y + oy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = mixHex('#b08a5a', '#eef4fb', snow); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(43,33,64,0.25)'; ctx.stroke();
      });
    }
  }
  // grass tufts: little outlined spikes, darker for depth
  const tuft = g('#3f9a3a'), tuftHi = g('#8fd86c');
  for (let i = 0; i < 260; i++) {
    const x = r() * SIZE, y = r() * SIZE, s = 5 + r() * 5;
    wrap((ox, oy) => {
      const px = x + ox, py = y + oy;
      if (px < -20 || py < -20 || px > SIZE + 20 || py > SIZE + 20) return;
      ctx.beginPath();
      ctx.moveTo(px - s, py); ctx.lineTo(px - s * 0.5, py - s * 1.4); ctx.lineTo(px - s * 0.1, py - s * 0.2);
      ctx.lineTo(px + s * 0.3, py - s * 1.7); ctx.lineTo(px + s * 0.5, py - s * 0.2); ctx.lineTo(px + s, py - s * 1.2); ctx.lineTo(px + s * 1.1, py);
      ctx.closePath();
      ctx.fillStyle = tuft; ctx.fill();
      ctx.strokeStyle = tuftHi; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px - s * 0.45, py - s * 1.1); ctx.lineTo(px - s * 0.3, py - s * 0.3); ctx.stroke();
    });
  }
  // flowers in summer, fallen leaves in autumn
  if (snow < 0.4) {
    const cols = autumn > 0.4 ? ['#e2603a', '#f0a23a', '#c98f3a'] : ['#fff6d8', '#ffd84a', '#ff8fa3', '#c38dd6'];
    for (let i = 0; i < 60; i++) {
      const x = r() * SIZE, y = r() * SIZE;
      const col = cols[i % cols.length];
      wrap((ox, oy) => {
        ctx.beginPath(); ctx.arc(x + ox, y + oy, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = OL; ctx.stroke();
      });
    }
  } else {
    // snow drifts: soft bright mounds with a blue shadow
    for (let i = 0; i < 18; i++) {
      const x = r() * SIZE, y = r() * SIZE, rx = 18 + r() * 22;
      wrap((ox, oy) => {
        ctx.beginPath(); ctx.ellipse(x + ox, y + oy + 3, rx, rx * 0.35, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(150,175,215,0.35)'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + ox, y + oy, rx, rx * 0.32, 0, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
      });
    }
  }
}

function paintGravel(ctx) {
  const snow = season.snow;
  const g = (c) => mixHex(c, '#eef4fb', snow * 0.75);
  ctx.fillStyle = g('#c2ad88');
  ctx.fillRect(0, 0, SIZE, SIZE);
  const r = mulberry32(777);
  const wrap = (fn) => { for (const ox of [-SIZE, 0, SIZE]) for (const oy of [-SIZE, 0, SIZE]) fn(ox, oy); };
  const stones = [g('#d9c9a6'), g('#a8977c'), g('#bfb2a0'), g('#8f8270'), g('#e3d6bc')];
  for (let i = 0; i < 1300; i++) {
    const x = r() * SIZE, y = r() * SIZE, rx = 3 + r() * 5, ry = 2.2 + r() * 3.5, rot = r() * Math.PI;
    const col = stones[i % stones.length];
    wrap((ox, oy) => {
      const px = x + ox, py = y + oy;
      if (px < -10 || py < -10 || px > SIZE + 10 || py > SIZE + 10) return;
      ctx.beginPath(); ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(43,33,64,0.45)'; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(px - rx * 0.3, py - ry * 0.35, rx * 0.35, ry * 0.3, rot, 0, Math.PI * 2); ctx.fill();
    });
  }
  // the odd weed poking through
  if (snow < 0.5) {
    for (let i = 0; i < 24; i++) {
      const x = r() * SIZE, y = r() * SIZE;
      wrap((ox, oy) => {
        ctx.beginPath(); ctx.moveTo(x + ox - 4, y + oy); ctx.lineTo(x + ox - 1, y + oy - 7); ctx.lineTo(x + ox + 1, y + oy - 1); ctx.lineTo(x + ox + 4, y + oy - 6); ctx.lineTo(x + ox + 5, y + oy);
        ctx.closePath(); ctx.fillStyle = '#4f9a3a'; ctx.fill();
      });
    }
  }
}

// Build the texture and two smaller copies (used further away, where full
// detail would only shimmer).
const caches = {};
function levels(ctx, kind = 'grass') {
  const key = `${Math.round(season.snow * 4)}:${Math.round(season.autumn * 4)}`;
  const cache = caches[kind];
  if (cache && cache.key === key) return cache.levels;
  const full = document.createElement('canvas');
  full.width = full.height = SIZE;
  (kind === 'gravel' ? paintGravel : paintTile)(full.getContext('2d'));
  const out = [{ img: full, pxPerUnit: SIZE / TILE }];
  for (const div of [2, 4]) {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE / div;
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(full, 0, 0, SIZE / div, SIZE / div);
    out.push({ img: c, pxPerUnit: SIZE / div / TILE });
  }
  for (const l of out) l.pattern = ctx.createPattern(l.img, 'repeat');
  caches[kind] = { key, levels: out };
  return out;
}

// Draw the ground from the horizon (hy) down to yEnd.
//   F       focal length (as in the cab's projection)
//   camH    camera height in view units
//   latAt   (z) => lateral offset of the track centre at depth z
//   ahead   distance travelled so far in view units (scrolls the texture)
let buf = null;
const M = new DOMMatrix(); // reused every row so no garbage is made per frame
let hazeCache = null;
export function drawFloor(ctx, W, hy, yEnd, F, camH, latAt, ahead, hazeColor, ballast = 0) {
  const RES = 0.4; // a low-res buffer is plenty for grass, and far less work
  const bw = Math.ceil((W + 40) * RES), bh = Math.max(1, Math.ceil((yEnd - hy) * RES));
  if (!buf) buf = document.createElement('canvas');
  if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; }
  const b = buf.getContext('2d');
  const lv = levels(b);
  const gv = ballast ? levels(b, 'gravel') : null;
  // rows near the horizon change fast with depth; lower down, perspective
  // changes slowly, so those are filled in taller bands (fewer draw calls)
  for (let row = 0, rowH = 1; row < bh; row += rowH) {
    rowH = row < 24 ? 1 : row < 60 ? 2 : 3;
    const y = hy + (row + rowH * 0.5) / RES;
    const z = (camH * F) / Math.max(0.5, y - hy);
    const scale = (F / z) * RES;
    const l = scale >= lv[0].pxPerUnit ? lv[0] : scale >= lv[1].pxPerUnit ? lv[1] : lv[2];
    const e = (20 + W / 2 + latAt(z) * (F / z)) * RES;
    const tilePx = TILE * l.pxPerUnit;
    const v = (((ahead + z) * l.pxPerUnit) % tilePx + tilePx) % tilePx;
    M.a = scale / l.pxPerUnit; M.b = 0; M.c = 0; M.d = 1; M.e = e; M.f = row - (tilePx - v);
    l.pattern.setTransform(M);
    b.fillStyle = l.pattern;
    b.fillRect(0, row, bw, rowH);
    if (gv) {
      // the gravel bed under the track, textured and scrolling exactly like the grass
      const gl = scale >= gv[0].pxPerUnit ? gv[0] : scale >= gv[1].pxPerUnit ? gv[1] : gv[2];
      const gTile = TILE * gl.pxPerUnit;
      const gvOff = (((ahead + z) * gl.pxPerUnit) % gTile + gTile) % gTile;
      M.a = scale / gl.pxPerUnit; M.f = row - (gTile - gvOff);
      gl.pattern.setTransform(M);
      b.fillStyle = gl.pattern;
      const hw = ballast * scale;
      b.fillRect(e - hw, row, hw * 2, rowH);
    }
  }
  ctx.drawImage(buf, -20, hy, bw / RES, bh / RES);
  // haze where the ground meets the sky hides the far rows' shimmer
  if (!hazeCache || hazeCache.color !== hazeColor || hazeCache.hy !== hy) {
    const hz = ctx.createLinearGradient(0, hy, 0, hy + 34);
    hz.addColorStop(0, hazeColor); hz.addColorStop(1, 'rgba(255,255,255,0)');
    hazeCache = { color: hazeColor, hy, g: hz };
  }
  ctx.fillStyle = hazeCache.g; ctx.fillRect(-20, hy, W + 40, 34);
}
