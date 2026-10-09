// A small WebGL2 stand-in for CanvasRenderingContext2D.
//
// The Focus views are drawn with ordinary canvas calls (paths, fills, strokes,
// images, text). On many phones the 2D canvas is rasterised on the CPU, which
// makes a busy scene crawl. This class accepts the same calls but turns them
// into triangles for the GPU:
//   - images become textured quads (uploaded once, then reused);
//   - convex or opaque shapes are drawn directly; anything that could overlap
//     itself with transparency uses the stencil buffer so each pixel is
//     painted exactly once, just like the real canvas;
//   - clip() uses the stencil buffer as well;
//   - text is rendered once per string into a small canvas and reused.
// Only the subset of the canvas API this game uses is implemented.

// ---------- a Path2D that remembers its commands ----------
// Real Path2D objects can't be read back, so code that builds paths for the
// main view uses this subclass; it still works with a normal 2D context.
export class Path extends Path2D {
  constructor() { super(); this.cmds = []; }
  // with the GPU renderer only the recorded commands are used, so the
  // browser's own path isn't built at all (Path.native = false)
  moveTo(x, y) { if (Path.native) super.moveTo(x, y); this.cmds.push(['moveTo', x, y]); }
  lineTo(x, y) { if (Path.native) super.lineTo(x, y); this.cmds.push(['lineTo', x, y]); }
  closePath() { if (Path.native) super.closePath(); this.cmds.push(['closePath']); }
  quadraticCurveTo(a, b, c, d) { if (Path.native) super.quadraticCurveTo(a, b, c, d); this.cmds.push(['quadraticCurveTo', a, b, c, d]); }
  bezierCurveTo(a, b, c, d, e, f) { if (Path.native) super.bezierCurveTo(a, b, c, d, e, f); this.cmds.push(['bezierCurveTo', a, b, c, d, e, f]); }
  arc(x, y, r, s, e, ccw = false) { if (Path.native) super.arc(x, y, r, s, e, ccw); this.cmds.push(['arc', x, y, r, s, e, ccw]); }
  ellipse(x, y, rx, ry, rot, s, e, ccw = false) { if (Path.native) super.ellipse(x, y, rx, ry, rot, s, e, ccw); this.cmds.push(['ellipse', x, y, rx, ry, rot, s, e, ccw]); }
  rect(x, y, w, h) { if (Path.native) super.rect(x, y, w, h); this.cmds.push(['rect', x, y, w, h]); }
  roundRect(x, y, w, h, r) {
    if (Path.native) { if (Path2D.prototype.roundRect) super.roundRect(x, y, w, h, r); else super.rect(x, y, w, h); }
    this.cmds.push(['roundRect', x, y, w, h, r]);
  }
  // an added path keeps its own sub-paths: it never joins on to the last one
  addPath(p) { if (Path.native) super.addPath(p); if (p.cmds) { this.cmds.push(['break']); for (const c of p.cmds) this.cmds.push(c); } }
}
Path.native = true;

// ---------- colours ----------
const colorCache = new Map();
let probe = null;
function parseColor(s) {
  let c = colorCache.get(s);
  if (c) return c;
  let str = s;
  if (!/^#|^rgb/.test(str)) {
    if (!probe) probe = document.createElement('canvas').getContext('2d');
    probe.fillStyle = '#000'; probe.fillStyle = str; str = probe.fillStyle;
  }
  if (str[0] === '#') {
    let h = str.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('');
    const n = parseInt(h.slice(0, 6), 16);
    c = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  } else {
    const v = str.slice(str.indexOf('(') + 1, str.indexOf(')')).split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    c = [v[0] / 255, v[1] / 255, v[2] / 255, v.length > 3 ? v[3] : 1];
  }
  if (colorCache.size > 4000) colorCache.clear();
  colorCache.set(s, c);
  return c;
}

class Gradient {
  constructor(type, a) { this.type = type; this.a = a; this.stops = []; this.tex = null; }
  addColorStop(o, c) { this.stops.push([o, parseColor(c)]); this.tex = null; }
}

// ---------- path flattening into device-space polylines ----------
class Flat {
  constructor() { this.subs = []; this.cur = null; this.m = null; this.tol = 1; }
  reset(m) { this.subs.length = 0; this.cur = null; this.m = m; this.sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; }
  X(x, y) { const m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  start(x, y) { this.cur = { p: [x, y], closed: false, ux: x, uy: y }; this.subs.push(this.cur); }
  moveTo(x, y) {
    const m = this.m;
    this.start(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    this.cur.ux = x; this.cur.uy = y; this.lx = x; this.ly = y;
  }
  lineTo(x, y) {
    if (!this.cur) { this.moveTo(x, y); return; }
    const m = this.m;
    this.cur.p.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]); this.lx = x; this.ly = y;
  }
  closePath() {
    if (!this.cur) return;
    this.cur.closed = true;
    const ux = this.cur.ux, uy = this.cur.uy;
    this.cur = null; this.moveTo(ux, uy); this.cur.fresh = true;
  }
  segs(len) { return Math.max(2, Math.min(40, Math.ceil(len * this.sc / 5))); }
  quadraticCurveTo(cx, cy, x, y) {
    if (!this.cur) this.moveTo(cx, cy);
    const x0 = this.lx, y0 = this.ly;
    const n = this.segs(Math.hypot(cx - x0, cy - y0) + Math.hypot(x - cx, y - cy));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      this.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
    }
  }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    if (!this.cur) this.moveTo(c1x, c1y);
    const x0 = this.lx, y0 = this.ly;
    const n = this.segs(Math.hypot(c1x - x0, c1y - y0) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(x - c2x, y - c2y));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      this.lineTo(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y);
    }
  }
  ellipse(x, y, rx, ry, rot, s, e, ccw = false) {
    const TAU = Math.PI * 2;
    let sweep = e - s;
    if (!ccw) sweep = sweep >= TAU ? TAU : ((sweep % TAU) + TAU) % TAU;
    else sweep = -sweep >= TAU ? -TAU : -((((s - e) % TAU) + TAU) % TAU);
    const r = Math.max(rx, ry) * this.sc;
    const step = r < 0.6 ? 1.6 : 2 * Math.acos(Math.max(-1, 1 - 0.3 / r));
    const n = Math.max(2, Math.min(96, Math.ceil(Math.abs(sweep) / step)));
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const a = s + (sweep * i) / n, px = Math.cos(a) * rx, py = Math.sin(a) * ry;
      const ux = x + px * cr - py * sr, uy = y + px * sr + py * cr;
      if (i === 0 && (!this.cur || this.cur.fresh)) this.moveTo(ux, uy);
      else this.lineTo(ux, uy);
      if (this.cur) this.cur.fresh = false;
    }
  }
  arc(x, y, r, s, e, ccw = false) { this.ellipse(x, y, r, r, 0, s, e, ccw); }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  roundRect(x, y, w, h, radii = 0) {
    let r = Array.isArray(radii) ? radii.map((v) => (typeof v === 'number' ? v : v.x || 0)) : [radii];
    if (r.length === 1) r = [r[0], r[0], r[0], r[0]];
    else if (r.length === 2) r = [r[0], r[1], r[0], r[1]];
    else if (r.length === 3) r = [r[0], r[1], r[2], r[1]];
    if (w < 0) { x += w; w = -w; r = [r[1], r[0], r[3], r[2]]; }
    if (h < 0) { y += h; h = -h; r = [r[3], r[2], r[1], r[0]]; }
    const k = Math.min(1, w / Math.max(1e-6, r[0] + r[1]), w / Math.max(1e-6, r[2] + r[3]), h / Math.max(1e-6, r[0] + r[3]), h / Math.max(1e-6, r[1] + r[2]));
    const [tl, tr, br, bl] = r.map((v) => Math.max(0, v * k));
    const H = Math.PI / 2;
    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y);
    if (tr) this.ellipse(x + w - tr, y + tr, tr, tr, 0, -H, 0);
    this.lineTo(x + w, y + h - br);
    if (br) this.ellipse(x + w - br, y + h - br, br, br, 0, 0, H);
    this.lineTo(x + bl, y + h);
    if (bl) this.ellipse(x + bl, y + h - bl, bl, bl, 0, H, Math.PI);
    this.lineTo(x, y + tl);
    if (tl) this.ellipse(x + tl, y + tl, tl, tl, 0, Math.PI, Math.PI * 1.5);
    this.closePath();
  }
  // a polyline's points with repeats removed
  clean(sub) {
    const p = sub.p, out = [p[0], p[1]];
    for (let i = 2; i < p.length; i += 2) {
      const ox = out[out.length - 2], oy = out[out.length - 1];
      if (Math.abs(p[i] - ox) > 0.01 || Math.abs(p[i + 1] - oy) > 0.01) out.push(p[i], p[i + 1]);
    }
    return out;
  }
}

function replay(flat, path) {
  for (const c of path.cmds) {
    switch (c[0]) {
      case 'break': flat.cur = null; break;
      case 'moveTo': flat.moveTo(c[1], c[2]); break;
      case 'lineTo': flat.lineTo(c[1], c[2]); break;
      case 'closePath': flat.closePath(); break;
      case 'quadraticCurveTo': flat.quadraticCurveTo(c[1], c[2], c[3], c[4]); break;
      case 'bezierCurveTo': flat.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]); break;
      case 'arc': flat.arc(c[1], c[2], c[3], c[4], c[5], c[6]); break;
      case 'ellipse': flat.ellipse(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8]); break;
      case 'rect': flat.rect(c[1], c[2], c[3], c[4]); break;
      case 'roundRect': flat.roundRect(c[1], c[2], c[3], c[4], c[5]); break;
    }
  }
}

// Split a simple polygon (flat x,y list) into triangles by ear clipping.
// Returns null if it can't (e.g. the outline crosses itself).
function earClip(p, out) {
  let n = p.length / 2;
  if (n < 3) return true;
  if (n > 400) return null;
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
  const sgn = area > 0 ? 1 : -1;
  const X = (i) => p[i * 2], Y = (i) => p[i * 2 + 1];
  const cross = (a, b, c) => (X(b) - X(a)) * (Y(c) - Y(b)) - (Y(b) - Y(a)) * (X(c) - X(b));
  const inside = (a, b, c, q) => {
    const d1 = (X(b) - X(a)) * (Y(q) - Y(a)) - (Y(b) - Y(a)) * (X(q) - X(a));
    const d2 = (X(c) - X(b)) * (Y(q) - Y(b)) - (Y(c) - Y(b)) * (X(q) - X(b));
    const d3 = (X(a) - X(c)) * (Y(q) - Y(c)) - (Y(a) - Y(c)) * (X(q) - X(c));
    return sgn > 0 ? d1 >= 0 && d2 >= 0 && d3 >= 0 : d1 <= 0 && d2 <= 0 && d3 <= 0;
  };
  let guard = 0;
  let i = 0;
  while (idx.length > 3) {
    if (++guard > n * n + 10) return null;
    const m = idx.length;
    const a = idx[(i + m - 1) % m], b = idx[i % m], c = idx[(i + 1) % m];
    const cr = cross(a, b, c) * sgn;
    let ear = cr > 1e-9;
    if (ear) {
      for (let k = 0; k < m; k++) {
        const q = idx[k];
        if (q === a || q === b || q === c) continue;
        if ((X(q) === X(a) && Y(q) === Y(a)) || (X(q) === X(b) && Y(q) === Y(b)) || (X(q) === X(c) && Y(q) === Y(c))) continue;
        if (inside(a, b, c, q)) { ear = false; break; }
      }
    } else if (Math.abs(cr) <= 1e-9) {
      // a straight or doubled-back point adds nothing
      idx.splice(i % m, 1); continue;
    }
    if (ear) { out.push(X(a), Y(a), X(b), Y(b), X(c), Y(c)); idx.splice(i % m, 1); i = Math.max(0, (i % m) - 1); guard = 0; }
    else i = (i + 1) % idx.length;
    if (guard > idx.length * 2 + 5) return null;
  }
  out.push(X(idx[0]), Y(idx[0]), X(idx[1]), Y(idx[1]), X(idx[2]), Y(idx[2]));
  return true;
}

function isConvex(p) {
  const n = p.length / 2;
  if (n < 3) return true;
  let sign = 0, turn = 0;
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1];
    const bx = p[((i + 1) % n) * 2], by = p[((i + 1) % n) * 2 + 1];
    const cx = p[((i + 2) % n) * 2], cy = p[((i + 2) % n) * 2 + 1];
    const cr = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cr) > 1e-6) {
      const s = cr > 0 ? 1 : -1;
      if (sign && s !== sign) return false;
      sign = s;
    }
    turn += Math.atan2(cr, (bx - ax) * (cx - bx) + (by - ay) * (cy - by));
  }
  return Math.abs(turn) < Math.PI * 2 + 0.1;
}

// ---------- shaders ----------
const VS = `#version 300 es
in vec2 aPos; in vec2 aUV; in vec4 aCol; in float aTex;
uniform vec2 uRes;
out vec2 vUV; out vec4 vCol; out vec2 vPos; flat out int vTex;
void main() {
  vec2 c = aPos / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  vUV = aUV; vCol = aCol; vPos = aPos; vTex = int(aTex + 0.5) - 1;
}`;
// up to 8 textures per batch; texture -1 means a plain colour
const FS_MAIN = `#version 300 es
precision mediump float;
uniform sampler2D uTex[8];
in vec2 vUV; in vec4 vCol; flat in int vTex;
out vec4 o;
void main() {
  vec4 s = vec4(1.0);
  if (vTex == 0) s = texture(uTex[0], vUV);
  else if (vTex == 1) s = texture(uTex[1], vUV);
  else if (vTex == 2) s = texture(uTex[2], vUV);
  else if (vTex == 3) s = texture(uTex[3], vUV);
  else if (vTex == 4) s = texture(uTex[4], vUV);
  else if (vTex == 5) s = texture(uTex[5], vUV);
  else if (vTex == 6) s = texture(uTex[6], vUV);
  else if (vTex == 7) s = texture(uTex[7], vUV);
  o = s * vCol;
}`;
const FS_GRAD = `#version 300 es
precision highp float;
uniform sampler2D uRamp; uniform int uType; uniform vec2 uP0; uniform vec2 uP1; uniform float uR0; uniform float uR1; uniform float uAlpha;
in vec2 vPos;
out vec4 o;
void main() {
  float t;
  if (uType == 0) { vec2 d = uP1 - uP0; t = dot(vPos - uP0, d) / max(dot(d, d), 1e-6); }
  else { t = (distance(vPos, uP0) - uR0) / max(uR1 - uR0, 1e-6); }
  o = texture(uRamp, vec2(clamp(t, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)) * uAlpha;
}`;
// "Mode 7" ground: each pixel works out where it lands on the flat ground
// plane (aUV carries the untransformed view coordinates).
const FS_FLOOR = `#version 300 es
precision highp float;
uniform sampler2D uGrass; uniform sampler2D uGravel; uniform sampler2D uCx;
uniform float uHy; uniform float uCamF; uniform float uF; uniform float uTile; uniform float uAhead; uniform vec2 uBallast; uniform float uRows;
in vec2 vUV;
out vec4 o;
void main() {
  float dy = max(vUV.y - uHy, 0.5);
  float z = uCamF / dy;
  float r = clamp(dy - 0.5, 0.0, uRows - 1.0);
  float r0 = floor(r);
  float cx = mix(texelFetch(uCx, ivec2(int(r0), 0), 0).r, texelFetch(uCx, ivec2(int(min(r0 + 1.0, uRows - 1.0)), 0), 0).r, r - r0);
  float lat = (vUV.x - cx) * z / uF;
  vec2 uv = vec2(lat, -(uAhead + z)) / uTile;
  vec4 g = texture(uGrass, uv);
  vec4 b = texture(uGravel, uv);
  o = mix(g, b, step(uBallast.x, lat) * step(lat, uBallast.y));
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUV'); gl.bindAttribLocation(p, 2, 'aCol'); gl.bindAttribLocation(p, 3, 'aTex');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace('[0]', ''); u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

// stencil modes
const NORMAL = 0, MARK_NZ = 1, MARK_ANY = 2, COVER = 3, CLIP_SET = 4, CLIP_POP = 5, MARK_EO = 6;

export class GL2D {
  static create(canvas) {
    try {
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, stencil: true, depth: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) return null;
      const g = new GL2D(canvas, gl);
      Path.native = false;
      return g;
    } catch (e) {
      console.warn('WebGL renderer unavailable', e);
      return null;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas; this.gl = gl; this.isGL = true;
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.lineCap = 'butt'; this.lineJoin = 'miter';
    this.miterLimit = 10; this.globalAlpha = 1; this.font = '10px sans-serif'; this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this.imageSmoothingEnabled = true; this.imageSmoothingQuality = 'low';
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.clipLevel = 0;
    this.path = new Flat();
    this.tmp = new Flat();
    this.path.reset(this.m);
    this.frame = 0;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.init(); this.lost = false; });
    this.init();
  }

  init() {
    const gl = this.gl;
    this.texs = new Map();   // image -> { t, w, h, used }
    this.texts = new Map();  // text sprite cache
    this.ramps = [];         // gradient colour ramps (many gradients only live one frame)
    this.main = compile(gl, VS, FS_MAIN);
    this.grad = compile(gl, VS, FS_GRAD);
    this.floorP = compile(gl, VS, FS_FLOOR);
    this.vbo = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 24, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 24, 20);
    this.buf = new Float32Array(6 * 6 * 4096);
    this.u32 = new Uint32Array(this.buf.buffer);
    this.n = 0; // vertices in the batch
    this.slots = []; this.slot = 0; this.bMode = NORMAL;
    gl.useProgram(this.main.p);
    gl.uniform1iv(this.main.u.uTex, [0, 1, 2, 3, 4, 5, 6, 7]);
    this.white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.cxTex = gl.createTexture();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    this.curMode = -1; this.curProg = null;
  }

  // ---------- frame ----------
  beginFrame() {
    const gl = this.gl;
    this.frame++;
    this.stack.length = 0; this.clipLevel = 0;
    this.W = this.canvas.width; this.H = this.canvas.height;
    gl.viewport(0, 0, this.W, this.H);
    gl.stencilMask(0xff); gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    this.curMode = -1; this.curProg = null;
    for (const p of [this.main, this.grad, this.floorP]) { gl.useProgram(p.p); gl.uniform2f(p.u.uRes, this.W, this.H); }
    this.curProg = this.floorP;
    if (this.frame % 30 === 0) {
      this.ramps = this.ramps.filter((g) => {
        if (this.frame - g.used <= 2) return true;
        gl.deleteTexture(g.tex); g.tex = null; return false;
      });
    }
    // forget textures nobody has drawn for a while
    if (this.frame % 300 === 0) {
      for (const [img, e] of this.texs) if (this.frame - e.used > 600) { gl.deleteTexture(e.t); this.texs.delete(img); }
      for (const [k, e] of this.texts) if (this.frame - e.used > 600) this.texts.delete(k);
    }
  }

  // ---------- state ----------
  save() {
    this.stack.push([this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin, this.miterLimit, this.globalAlpha,
      this.font, this.textAlign, this.textBaseline, this.m.slice(), this.clipLevel]);
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    [this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin, this.miterLimit, this.globalAlpha,
      this.font, this.textAlign, this.textBaseline] = s;
    this.m = s[10];
    while (this.clipLevel > s[11]) this.popClip();
  }
  setTransform(a, b, c, d, e, f) {
    if (typeof a === 'object') this.m = [a.a, a.b, a.c, a.d, a.e, a.f];
    else this.m = [a, b, c, d, e, f];
  }
  resetTransform() { this.m = [1, 0, 0, 1, 0, 0]; }
  getTransform() { const m = this.m; return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }; }
  transform(a, b, c, d, e, f) {
    const m = this.m;
    this.m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
  }
  translate(x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
  scale(x, y) { const m = this.m; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; }
  rotate(r) { const c = Math.cos(r), s = Math.sin(r); this.transform(c, s, -s, c, 0, 0); }

  // ---------- path building (transformed as it's built, like a real canvas) ----------
  beginPath() { this.path.reset(this.m.slice()); }
  moveTo(x, y) { this.syncPath(); this.path.moveTo(x, y); }
  lineTo(x, y) { this.syncPath(); this.path.lineTo(x, y); }
  closePath() { this.path.closePath(); }
  quadraticCurveTo(a, b, c, d) { this.syncPath(); this.path.quadraticCurveTo(a, b, c, d); }
  bezierCurveTo(a, b, c, d, e, f) { this.syncPath(); this.path.bezierCurveTo(a, b, c, d, e, f); }
  arc(x, y, r, s, e, ccw) { this.syncPath(); this.path.arc(x, y, r, s, e, ccw); }
  ellipse(x, y, rx, ry, rot, s, e, ccw) { this.syncPath(); this.path.ellipse(x, y, rx, ry, rot, s, e, ccw); }
  rect(x, y, w, h) { this.syncPath(); this.path.rect(x, y, w, h); }
  roundRect(x, y, w, h, r) { this.syncPath(); this.path.roundRect(x, y, w, h, r); }
  // the transform may change between path commands; later commands use the new one
  syncPath() {
    const a = this.path.m, b = this.m;
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3] || a[4] !== b[4] || a[5] !== b[5]) {
      const p = this.path; p.m = b.slice(); p.sc = Math.sqrt(Math.abs(b[0] * b[3] - b[1] * b[2])) || 1;
      // the pen position is kept in device space already; only new points change
      if (p.cur) { const inv = invert(b); const lx = p.cur.p[p.cur.p.length - 2], ly = p.cur.p[p.cur.p.length - 1]; p.lx = inv[0] * lx + inv[2] * ly + inv[4]; p.ly = inv[1] * lx + inv[3] * ly + inv[5]; }
    }
  }
  flatOf(path) {
    if (!path || typeof path === 'string') return this.path;
    const f = this.tmp; f.reset(this.m.slice());
    if (path.cmds) replay(f, path);
    return f;
  }

  // ---------- drawing ----------
  fill(a, b) {
    const flat = this.flatOf(a);
    this.fillFlat(flat, this.fillStyle, this.globalAlpha, (typeof a === 'string' ? a : b) === 'evenodd');
  }
  stroke(a) {
    const flat = this.flatOf(a);
    this.strokeFlat(flat, this.strokeStyle, this.globalAlpha);
  }
  fillRect(x, y, w, h) {
    const f = this.tmp; f.reset(this.m.slice()); f.rect(x, y, w, h);
    this.fillFlat(f, this.fillStyle, this.globalAlpha);
  }
  strokeRect(x, y, w, h) {
    const f = this.tmp; f.reset(this.m.slice()); f.rect(x, y, w, h);
    this.strokeFlat(f, this.strokeStyle, this.globalAlpha);
  }
  clearRect() { /* the frame is cleared in beginFrame; nothing in the views needs more */ }
  clip(a, b) {
    const flat = this.flatOf(a);
    if (this.clipLevel >= 15) return;
    const tris = this.fanTris(flat);
    if (!tris.length) { this.pushClipEmpty(); return; }
    this.drawRaw(tris, (typeof a === 'string' ? a : b) === 'evenodd' ? MARK_EO : MARK_NZ);
    this.drawRaw(this.bboxTris(tris), CLIP_SET);
    this.clipLevel++;
  }
  pushClipEmpty() { this.clipLevel++; } // an empty clip: nothing passes (no pixel holds the new level)
  popClip() {
    this.clipLevel--;
    const W = this.W, H = this.H;
    this.drawRaw([0, 0, W, 0, W, H, 0, 0, W, H, 0, H], CLIP_POP);
  }

  createLinearGradient(x0, y0, x1, y1) { return new Gradient(0, [x0, y0, x1, y1]); }
  createRadialGradient(x0, y0, r0, x1, y1, r1) { return new Gradient(1, [x1, y1, r0, r1]); }
  createPattern() { return '#7a9a5a'; }
  measureText(t) { if (!probe) probe = document.createElement('canvas').getContext('2d'); probe.font = this.font; return probe.measureText(t); }

  // a triangle fan per sub-path (correct for any shape when used with the stencil)
  fanTris(flat) {
    const out = [];
    for (const s of flat.subs) {
      const p = s.p;
      if (p.length < 6) continue;
      const x0 = p[0], y0 = p[1];
      for (let i = 2; i < p.length - 2; i += 2) out.push(x0, y0, p[i], p[i + 1], p[i + 2], p[i + 3]);
    }
    return out;
  }
  bboxTris(t) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < t.length; i += 2) { const x = t[i], y = t[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    x0 = Math.floor(x0) - 1; y0 = Math.floor(y0) - 1; x1 = Math.ceil(x1) + 1; y1 = Math.ceil(y1) + 1;
    return [x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1];
  }

  paintOf(style, alpha) {
    if (style instanceof Gradient) return { grad: style, alpha };
    if (typeof style !== 'string') style = '#7a9a5a';
    const c = parseColor(style), a = c[3] * alpha;
    return { col: [c[0] * a, c[1] * a, c[2] * a, a], opaque: a >= 0.999 };
  }

  fillFlat(flat, style, alpha, evenodd = false) {
    const paint = this.paintOf(style, alpha);
    if (paint.col && paint.col[3] <= 0) return;
    const subs = flat.subs.filter((s) => s.p.length >= 6);
    if (!subs.length) return;
    // convex pieces can go straight to the screen when nothing can overlap
    // shapes that can't overlap themselves (one outline, or opaque ones) go
    // straight to the screen; concave outlines are cut into triangles first
    const direct = paint.col && (subs.length === 1 || (paint.opaque && !evenodd));
    if (direct) {
      const out = [];
      let ok = true;
      for (const sp of subs) {
        if (isConvex(sp.p)) { const p = sp.p; for (let i = 2; i < p.length - 2; i += 2) out.push(p[0], p[1], p[i], p[i + 1], p[i + 2], p[i + 3]); }
        else if (!earClip(sp.p, out)) { ok = false; break; }
      }
      if (ok) { this.emitSolid(out, paint.col); return; }
    }
    const tris = this.fanTris(flat);
    this.drawRaw(tris, evenodd ? MARK_EO : MARK_NZ);
    this.coverWith(this.bboxTris(tris), paint);
  }

  coverWith(tris, paint) {
    if (paint.grad) this.drawGrad(tris, paint.grad, paint.alpha, COVER);
    else { this.setBatch(null, COVER); this.pushTris(tris, paint.col); }
  }

  strokeFlat(flat, style, alpha) {
    const paint = this.paintOf(style, alpha);
    let w = this.lineWidth * flat.sc;
    let a = 1;
    if (w < 1) { a = Math.max(0.15, w); w = 1; } // hairlines: thinner looks fainter, like the real canvas
    if (paint.col) { if (a < 1) { paint.col = paint.col.map((v) => v * a); paint.opaque = false; } if (paint.col[3] <= 0) return; }
    const tris = [];
    const hw = w / 2, cap = this.lineCap, join = this.lineJoin;
    for (const s of flat.subs) {
      const p = flat.clean(s);
      const closed = s.closed && p.length >= 6;
      if (closed && Math.abs(p[0] - p[p.length - 2]) < 0.01 && Math.abs(p[1] - p[p.length - 1]) < 0.01) p.length -= 2;
      const n = p.length / 2;
      if (n < 2) {
        if (n === 1 && cap === 'round' && !s.fresh) this.circleTris(tris, p[0], p[1], hw);
        continue;
      }
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        let ax = p[i * 2], ay = p[i * 2 + 1], bx = p[((i + 1) % n) * 2], by = p[((i + 1) % n) * 2 + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const dx = (bx - ax) / len, dy = (by - ay) / len;
        if (!closed && cap === 'square') { if (i === 0) { ax -= dx * hw; ay -= dy * hw; } if (i === segs - 1) { bx += dx * hw; by += dy * hw; } }
        const nx = -dy * hw, ny = dx * hw;
        tris.push(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny);
      }
      // joins
      const j0 = closed ? 0 : 1, j1 = closed ? n : n - 1;
      for (let i = j0; i < j1; i++) {
        const px = p[((i - 1 + n) % n) * 2], py = p[((i - 1 + n) % n) * 2 + 1];
        const cx = p[i * 2], cy = p[i * 2 + 1];
        const qx = p[((i + 1) % n) * 2], qy = p[((i + 1) % n) * 2 + 1];
        const l1 = Math.hypot(cx - px, cy - py) || 1, l2 = Math.hypot(qx - cx, qy - cy) || 1;
        const d1x = (cx - px) / l1, d1y = (cy - py) / l1, d2x = (qx - cx) / l2, d2y = (qy - cy) / l2;
        const cr = d1x * d2y - d1y * d2x, dot = d1x * d2x + d1y * d2y;
        if (dot > 0 && hw * Math.abs(cr) < 0.35) continue; // the gap at a gentle bend is too small to see
        const side = cr > 0 ? -1 : 1; // outer side of the turn
        const o1x = cx - d1y * hw * side, o1y = cy + d1x * hw * side;
        const o2x = cx - d2y * hw * side, o2y = cy + d2x * hw * side;
        if (join === 'round' && hw >= 1.5 && Math.acos(Math.max(-1, Math.min(1, dot))) > 0.35) {
          // just the rounded wedge on the outside of the bend
          const a1 = Math.atan2(o1y - cy, o1x - cx);
          let a2 = Math.atan2(o2y - cy, o2x - cx), da = a2 - a1;
          if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
          this.arcTris(tris, cx, cy, hw, a1, da);
          continue;
        }
        tris.push(cx, cy, o1x, o1y, o2x, o2y);
        if (join === 'miter') {
          const half = Math.acos(Math.max(-1, Math.min(1, dot))) / 2;
          const ml = 1 / Math.max(1e-3, Math.cos(half));
          if (ml <= this.miterLimit) {
            const bxv = (o1x + o2x) / 2 - cx, byv = (o1y + o2y) / 2 - cy, bl = Math.hypot(bxv, byv) || 1;
            const mx = cx + (bxv / bl) * hw * ml, my = cy + (byv / bl) * hw * ml;
            tris.push(o1x, o1y, mx, my, o2x, o2y);
          }
        }
      }
      if (!closed && cap === 'round' && hw >= 1) {
        // half-discs on the two open ends
        const e0 = Math.atan2(p[1] - p[3], p[0] - p[2]), e1 = Math.atan2(p[(n - 1) * 2 + 1] - p[(n - 2) * 2 + 1], p[(n - 1) * 2] - p[(n - 2) * 2]);
        this.arcTris(tris, p[0], p[1], hw, e0 - Math.PI / 2, Math.PI);
        this.arcTris(tris, p[(n - 1) * 2], p[(n - 1) * 2 + 1], hw, e1 - Math.PI / 2, Math.PI);
      }
    }
    if (!tris.length) return;
    if (paint.col && paint.opaque) { this.emitSolid(tris, paint.col); return; }
    this.drawRaw(tris, MARK_ANY);
    this.coverWith(this.bboxTris(tris), paint);
  }

  // a pie slice from angle a0 sweeping da, as few triangles as look round
  arcTris(out, x, y, r, a0, da) {
    const step = r < 1 ? 1.5 : 2 * Math.acos(Math.max(-1, 1 - 0.35 / r));
    const n = Math.max(1, Math.min(16, Math.ceil(Math.abs(da) / step)));
    let px = x + Math.cos(a0) * r, py = y + Math.sin(a0) * r;
    for (let i = 1; i <= n; i++) {
      const a = a0 + (da * i) / n, qx = x + Math.cos(a) * r, qy = y + Math.sin(a) * r;
      out.push(x, y, px, py, qx, qy); px = qx; py = qy;
    }
  }

  circleTris(out, x, y, r) {
    const step = r < 1 ? 1.5 : 2 * Math.acos(Math.max(-1, 1 - 0.35 / r));
    const n = Math.max(6, Math.min(32, Math.ceil((Math.PI * 2) / step)));
    let px = x + r, py = y;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, qx = x + Math.cos(a) * r, qy = y + Math.sin(a) * r;
      out.push(x, y, px, py, qx, qy); px = qx; py = qy;
    }
  }

  drawImage(img, a, b, c, d, e, f, g, h) {
    if (!img || this.lost) return;
    const iw = img.width, ih = img.height;
    if (!iw || !ih) return;
    let sx = 0, sy = 0, sw = iw, sh = ih, dx, dy, dw, dh;
    if (e === undefined) { dx = a; dy = b; dw = c === undefined ? iw : c; dh = d === undefined ? ih : d; }
    else { sx = a; sy = b; sw = c; sh = d; dx = e; dy = f; dw = g; dh = h; }
    const al = this.globalAlpha;
    if (al <= 0) return;
    const t = this.texFor(img);
    const m = this.m;
    const u0 = sx / iw, v0 = sy / ih, u1 = (sx + sw) / iw, v1 = (sy + sh) / ih;
    const ti = this.setBatch(t, NORMAL);
    // the four corners, transformed
    const ax = m[0] * dw, ay = m[1] * dw, bx = m[2] * dh, by = m[3] * dh;
    const x0 = m[0] * dx + m[2] * dy + m[4], y0 = m[1] * dx + m[3] * dy + m[5];
    const x1 = x0 + ax, y1 = y0 + ay, x2 = x1 + bx, y2 = y1 + by, x3 = x0 + bx, y3 = y0 + by;
    this.vert(x0, y0, u0, v0, al, al, al, al, ti); this.vert(x1, y1, u1, v0, al, al, al, al, ti); this.vert(x2, y2, u1, v1, al, al, al, al, ti);
    this.vert(x0, y0, u0, v0, al, al, al, al, ti); this.vert(x2, y2, u1, v1, al, al, al, al, ti); this.vert(x3, y3, u0, v1, al, al, al, al, ti);
  }

  fillText(text, x, y, maxWidth) {
    text = String(text);
    if (!text) return;
    const sc = Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2])) || 1;
    const q = Math.max(0.5, Math.round(sc * 4) / 4);
    const style = typeof this.fillStyle === 'string' ? this.fillStyle : '#000';
    const key = `${this.font}|${style}|${q}|${text}`;
    let e = this.texts.get(key);
    if (!e) {
      if (!probe) probe = document.createElement('canvas').getContext('2d');
      probe.font = this.font;
      const mt = probe.measureText(text);
      const asc = mt.fontBoundingBoxAscent ?? mt.actualBoundingBoxAscent ?? 10, desc = mt.fontBoundingBoxDescent ?? mt.actualBoundingBoxDescent ?? 3;
      const pad = 2, w = mt.width;
      const c = document.createElement('canvas');
      c.width = Math.ceil((w + pad * 2) * q); c.height = Math.ceil((asc + desc + pad * 2) * q);
      const x2 = c.getContext('2d');
      x2.scale(q, q); x2.font = this.font; x2.fillStyle = style; x2.textBaseline = 'alphabetic';
      x2.fillText(text, pad, pad + asc);
      e = { c, w, asc, desc, pad, cw: c.width / q, ch: c.height / q };
      if (this.texts.size > 400) { for (const [k] of this.texts) { this.texts.delete(k); if (this.texts.size < 300) break; } }
      this.texts.set(key, e);
    }
    e.used = this.frame;
    let w = e.w, sx = 1;
    if (maxWidth !== undefined && w > maxWidth) { sx = maxWidth / w; w = maxWidth; }
    const al = this.textAlign;
    let left = x;
    if (al === 'center') left = x - w / 2;
    else if (al === 'right' || al === 'end') left = x - w;
    const bl = this.textBaseline;
    let top = y - e.asc;
    if (bl === 'top' || bl === 'hanging') top = y;
    else if (bl === 'middle') top = y - (e.asc + e.desc) / 2;
    else if (bl === 'bottom' || bl === 'ideographic') top = y - e.asc - e.desc;
    this.drawImage(e.c, left - e.pad * sx, top - e.pad, e.cw * sx, e.ch);
  }

  // ---------- textures ----------
  texFor(img, repeat = false) {
    let e = this.texs.get(img);
    if (e && (e.w !== img.width || e.h !== img.height)) { this.gl.deleteTexture(e.t); e = null; }
    if (!e) {
      const gl = this.gl;
      this.flush();
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      if (repeat) {
        const an = gl.getExtension('EXT_texture_filter_anisotropic');
        if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      }
      e = { t, w: img.width, h: img.height };
      this.texs.set(img, e);
      this.curTex = null;
    }
    e.used = this.frame;
    return e.t;
  }

  // ---------- batching ----------
  // Pick the batch for the next vertices: tex null = plain colour. Returns
  // the value to store per vertex (texture slot + 1, 0 for plain colour).
  setBatch(tex, mode) {
    if (this.n && this.bMode !== mode) this.flush();
    this.bMode = mode;
    if (!tex) return 0;
    let i = this.slots.indexOf(tex);
    if (i < 0) {
      if (this.slots.length >= 8) this.flush();
      i = this.slots.length; this.slots.push(tex);
    }
    return i + 1;
  }
  vert(x, y, u, v, r, g, b, a, t) {
    if ((this.n + 1) * 6 > this.buf.length) {
      if (this.n % 3 === 0) { const slots = this.slots.slice(); this.flush(); this.slots = slots; }
      else { const nb = new Float32Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; this.u32 = new Uint32Array(nb.buffer); }
    }
    const o = this.n * 6, B = this.buf;
    B[o] = x; B[o + 1] = y; B[o + 2] = u; B[o + 3] = v;
    this.u32[o + 4] = ((a * 255 + 0.5) << 24 | (b * 255 + 0.5) << 16 | (g * 255 + 0.5) << 8 | (r * 255 + 0.5)) >>> 0;
    B[o + 5] = t;
    this.n++;
  }
  pushTris(tris, col) {
    const r = col ? col[0] : 1, g = col ? col[1] : 1, b = col ? col[2] : 1, a = col ? col[3] : 1;
    for (let i = 0; i < tris.length; i += 2) this.vert(tris[i], tris[i + 1], 0, 0, r, g, b, a, 0);
  }
  emitSolid(tris, col) { this.setBatch(null, NORMAL); this.pushTris(tris, col); }
  drawRaw(tris, mode) { this.setBatch(null, mode); this.pushTris(tris, null); this.flush(); }

  useMode(mode) {
    if (this.curMode === mode && this.curClip === this.clipLevel) return;
    const gl = this.gl, L = this.clipLevel << 4;
    this.curMode = mode; this.curClip = this.clipLevel;
    gl.colorMask(true, true, true, true);
    if (mode === NORMAL) {
      if (!this.clipLevel) { gl.disable(gl.STENCIL_TEST); return; }
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.EQUAL, L, 0xf0); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP); gl.stencilMask(0);
      return;
    }
    gl.enable(gl.STENCIL_TEST);
    if (mode === MARK_NZ || mode === MARK_ANY || mode === MARK_EO) {
      gl.colorMask(false, false, false, false);
      if (mode === MARK_EO) {
        if (this.clipLevel) gl.stencilFunc(gl.EQUAL, L, 0xf0); else gl.stencilFunc(gl.ALWAYS, 0, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        gl.stencilMask(0x01);
        return;
      }
      if (mode === MARK_NZ) {
        if (this.clipLevel) gl.stencilFunc(gl.EQUAL, L, 0xf0); else gl.stencilFunc(gl.ALWAYS, 0, 0xff);
        gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
        gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
      } else {
        if (this.clipLevel) gl.stencilFunc(gl.EQUAL, L | 1, 0xf0); else gl.stencilFunc(gl.ALWAYS, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      }
      gl.stencilMask(0x0f);
    } else if (mode === COVER) {
      gl.stencilFunc(gl.NOTEQUAL, 0, 0x0f); gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO); gl.stencilMask(0x0f);
    } else if (mode === CLIP_SET) {
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.NOTEQUAL, (this.clipLevel + 1) << 4, 0x0f); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); gl.stencilMask(0xff);
    } else if (mode === CLIP_POP) {
      // here clipLevel has already been lowered to the level we return to
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.LESS, this.clipLevel << 4, 0xf0); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); gl.stencilMask(0xf0);
    }
  }

  flush() {
    if (!this.n || this.lost) { this.n = 0; this.slots.length = 0; return; }
    const gl = this.gl;
    if (this.curProg !== this.main) { gl.useProgram(this.main.p); this.curProg = this.main; }
    this.useMode(this.bMode);
    for (let i = 0; i < 8; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.slots[i] || this.white); }
    gl.activeTexture(gl.TEXTURE0);
    this.upload();
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
    this.n = 0; this.slots.length = 0;
    if (this.bMode === MARK_NZ || this.bMode === MARK_ANY || this.bMode === MARK_EO || this.bMode === CLIP_SET || this.bMode === CLIP_POP || this.bMode === COVER) this.curMode = -1;
  }

  upload() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.buf.subarray(0, this.n * 6), gl.STREAM_DRAW);
  }

  drawGrad(tris, g, alpha, mode) {
    this.flush();
    const gl = this.gl;
    if (!g.tex) {
      const px = new Uint8Array(256 * 4), st = g.stops.slice().sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < 256; i++) {
        const t = i / 255;
        let c = st.length ? st[0][1] : [0, 0, 0, 0];
        for (let j = 0; j < st.length - 1; j++) {
          if (t >= st[j][0] && t <= st[j + 1][0]) {
            const k = (t - st[j][0]) / Math.max(1e-6, st[j + 1][0] - st[j][0]), A = st[j][1], B = st[j + 1][1];
            c = [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k, A[3] + (B[3] - A[3]) * k];
            break;
          }
          if (t > st[j + 1][0]) c = st[j + 1][1];
        }
        px[i * 4] = c[0] * c[3] * 255; px[i * 4 + 1] = c[1] * c[3] * 255; px[i * 4 + 2] = c[2] * c[3] * 255; px[i * 4 + 3] = c[3] * 255;
      }
      g.tex = gl.createTexture();
      this.ramps.push(g);
      gl.bindTexture(gl.TEXTURE_2D, g.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      g.gl = gl;
    }
    g.used = this.frame;
    const P = this.grad;
    gl.useProgram(P.p); this.curProg = P;
    this.useMode(mode);
    const m = this.m, a = g.a;
    const X = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    gl.uniform1i(P.u.uType, g.type);
    if (g.type === 0) { const p0 = X(a[0], a[1]), p1 = X(a[2], a[3]); gl.uniform2f(P.u.uP0, p0[0], p0[1]); gl.uniform2f(P.u.uP1, p1[0], p1[1]); }
    else { const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1, c = X(a[0], a[1]); gl.uniform2f(P.u.uP0, c[0], c[1]); gl.uniform1f(P.u.uR0, a[2] * sc); gl.uniform1f(P.u.uR1, a[3] * sc); }
    gl.uniform1f(P.u.uAlpha, alpha);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex); gl.uniform1i(P.u.uRamp, 0);
    this.bMode = mode;
    for (let i = 0; i < tris.length; i += 2) this.vert(tris[i], tris[i + 1], 0, 0, 1, 1, 1, 1, 0);
    this.upload();
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
    this.n = 0;
    this.curMode = -1;
  }

  // A gradient fill that doesn't need the stencil (fillRect and convex paths).
  // Called from fillFlat through coverWith only when needed; fillRect with a
  // gradient is common (sky, haze), so it gets a direct route.

  // ---------- the "Mode 7" ground ----------
  // Fills from the horizon hy down to yEnd (view units, current transform).
  // cx(row) gives the screen x of the track centre for each row below hy.
  drawMode7({ W, hy, yEnd, F, camH, cxRows, ahead, tile, ballast, grass, gravel }) {
    this.flush();
    const gl = this.gl, P = this.floorP;
    const rows = cxRows.length;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.cxTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, rows, 1, 0, gl.RED, gl.FLOAT, cxRows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const tg = this.texFor(grass, true), tb = this.texFor(gravel, true);
    gl.useProgram(P.p); this.curProg = P;
    this.useMode(NORMAL);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tg); gl.uniform1i(P.u.uGrass, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tb); gl.uniform1i(P.u.uGravel, 1);
    gl.uniform1i(P.u.uCx, 2);
    gl.uniform1f(P.u.uHy, hy); gl.uniform1f(P.u.uCamF, camH * F); gl.uniform1f(P.u.uF, F); gl.uniform1f(P.u.uTile, tile);
    gl.uniform1f(P.u.uAhead, ((ahead % tile) + tile) % tile); gl.uniform2f(P.u.uBallast, ballast[0], ballast[1]); gl.uniform1f(P.u.uRows, rows);
    gl.activeTexture(gl.TEXTURE0);
    const m = this.m;
    const X = (x, y) => m[0] * x + m[2] * y + m[4], Y = (x, y) => m[1] * x + m[3] * y + m[5];
    const q = [[-20, hy], [W + 20, hy], [W + 20, yEnd], [-20, yEnd]];
    for (const i of [0, 1, 2, 0, 2, 3]) { const [x, y] = q[i]; this.vert(X(x, y), Y(x, y), x, y, 1, 1, 1, 1, 0); }
    this.upload();
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
    this.n = 0;
    this.curTex = null;
  }
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

