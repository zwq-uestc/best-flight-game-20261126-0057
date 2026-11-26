// skyutil.js — shared math helpers for Emberwing Post.
// Everything hangs off the global EW namespace so the classic scripts can
// share code without modules. Angles are radians unless a name says Deg.

var EW = window.EW || (window.EW = {});

EW.TAU = Math.PI * 2;
EW.DEG = Math.PI / 180;

EW.clamp = function (v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
};

EW.lerp = function (a, b, t) {
  return a + (b - a) * t;
};

EW.smoothstep = function (a, b, x) {
  var t = EW.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Wrap an angle into [-PI, PI).
EW.wrapAngle = function (a) {
  a = (a + Math.PI) % EW.TAU;
  if (a < 0) a += EW.TAU;
  return a - Math.PI;
};

// Shortest signed difference from b to a, in [-PI, PI).
EW.angleDelta = function (a, b) {
  return EW.wrapAngle(a - b);
};

// Compass heading in degrees [0, 360) from a radian heading (0 = north).
EW.headingDeg = function (rad) {
  var d = (rad / EW.DEG) % 360;
  return d < 0 ? d + 360 : d;
};

// mulberry32: tiny deterministic PRNG so every course seed builds the
// same archipelago on every machine.
EW.makeRng = function (seed) {
  var s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

EW.randRange = function (rng, lo, hi) {
  return lo + rng() * (hi - lo);
};

EW.dist2 = function (ax, ay, bx, by) {
  var dx = ax - bx;
  var dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
};

EW.dist3 = function (a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  var dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Mix two [r,g,b] colors; t=0 gives a, t=1 gives b.
EW.mixColor = function (a, b, t) {
  return [
    Math.round(EW.lerp(a[0], b[0], t)),
    Math.round(EW.lerp(a[1], b[1], t)),
    Math.round(EW.lerp(a[2], b[2], t)),
  ];
};

EW.cssColor = function (c, alpha) {
  if (alpha === undefined) return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
};

// Scale a color's brightness (for simple sun shading).
EW.shadeColor = function (c, f) {
  return [
    EW.clamp(Math.round(c[0] * f), 0, 255),
    EW.clamp(Math.round(c[1] * f), 0, 255),
    EW.clamp(Math.round(c[2] * f), 0, 255),
  ];
};

// Format seconds as M:SS.
EW.formatClock = function (seconds) {
  var s = Math.max(0, Math.ceil(seconds));
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
};

// --------------------------------------------------------------- noise
// Deterministic value noise for procedural terrain/cloud texture. All
// sampling is in world coordinates so neighbouring cells correlate and
// the ground does not read as a checkerboard of independent cells.

// Integer lattice hash -> [0, 1). Stable across machines and frames.
EW.hash2 = function (ix, iy) {
  var h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// Smooth bilinear value noise at (x, y); lattice spacing 1.
EW.valueNoise = function (x, y) {
  var ix = Math.floor(x);
  var iy = Math.floor(y);
  var fx = x - ix;
  var fy = y - iy;
  var sx = fx * fx * (3 - 2 * fx);
  var sy = fy * fy * (3 - 2 * fy);
  var a = EW.hash2(ix, iy);
  var b = EW.hash2(ix + 1, iy);
  var c = EW.hash2(ix, iy + 1);
  var d = EW.hash2(ix + 1, iy + 1);
  return EW.lerp(EW.lerp(a, b, sx), EW.lerp(c, d, sx), sy);
};

// Fractal sum of value-noise octaves, normalised to roughly [0, 1].
EW.fbm = function (x, y, octaves) {
  var sum = 0;
  var amp = 0.5;
  var norm = 0;
  for (var o = 0; o < octaves; o++) {
    sum += EW.valueNoise(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 11.7;
    y = y * 2.03 + 5.3;
    amp *= 0.5;
  }
  return sum / norm;
};
