// world.js — the chase camera, perspective projection, and every 3D thing
// Emberwing Post draws: sky, sea, island terrain, runway, buildings, pines,
// rings, drop zones, fuel cans, clouds, parcels and particles. Canvas 2D
// with a painter's-algorithm sort; no WebGL, so it runs anywhere.

EW.makeCamera = function () {
  return {
    x: 0, y: 0, z: 0,
    fx: 0, fy: 1, fz: 0,
    rx: 1, ry: 0, rz: 0,
    ux: 0, uy: 0, uz: 1,
    focal: 600,
    init: false,
  };
};

// Position the camera behind and above the plane, looking past it.
// Chase feel: the anchor heading lags the plane's so turns swing the
// view, the camera rolls part-way with the bank, the FOV widens a touch
// with speed, and a gentle bob keeps her alive at low speed. Inside a
// cloud the airframe buffets (game.cloudFactor, set by the FX system).
EW.updateCamera = function (cam, plane, dt, viewH, game, time) {
  if (cam.lagHeading === undefined) cam.lagHeading = plane.heading;
  var lagK = 1 - Math.exp(-dt * 2.1);
  cam.lagHeading += EW.angleDelta(plane.heading, cam.lagHeading) * lagK;
  var fx = Math.sin(cam.lagHeading);
  var fy = Math.cos(cam.lagHeading);
  var speedNorm = EW.clamp(plane.speed / 62, 0, 1);
  var bobAmp = (1 - speedNorm) * 0.22 + (plane.rolling ? 0.1 : 0);
  var t = time || 0;
  var wantX = plane.x - fx * 12;
  var wantY = plane.y - fy * 12;
  var wantZ = plane.z + 3.3 - plane.pitch * 5 + Math.sin(t * 1.7) * bobAmp;
  var cf = game && game.cloudFactor ? game.cloudFactor : 0;
  if (cf > 0.02) {
    wantX += Math.sin(t * 13.7) * 0.55 * cf;
    wantY += Math.cos(t * 11.3) * 0.55 * cf;
    wantZ += Math.sin(t * 17.9) * 0.45 * cf;
  }
  if (!cam.init) {
    cam.x = wantX;
    cam.y = wantY;
    cam.z = wantZ;
    cam.init = true;
  } else {
    var k = 1 - Math.exp(-dt * 5);
    cam.x = EW.lerp(cam.x, wantX, k);
    cam.y = EW.lerp(cam.y, wantY, k);
    cam.z = EW.lerp(cam.z, wantZ, k);
  }
  var tfx = Math.sin(plane.heading);
  var tfy = Math.cos(plane.heading);
  var lookX = plane.x + tfx * 26;
  var lookY = plane.y + tfy * 26;
  var lookZ = plane.z + 0.9 + plane.pitch * 10 + Math.sin(t * 1.3 + 1.1) * bobAmp * 0.7;
  var dx = lookX - cam.x;
  var dy = lookY - cam.y;
  var dz = lookZ - cam.z;
  var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  cam.fx = dx / len;
  cam.fy = dy / len;
  cam.fz = dz / len;
  // right = forward x world-up
  var rx = cam.fy * 1 - cam.fz * 0;
  var ry = cam.fz * 0 - cam.fx * 1;
  var rz = cam.fx * 0 - cam.fy * 0;
  var rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
  cam.rx = rx / rl;
  cam.ry = ry / rl;
  cam.rz = rz / rl;
  // up = right x forward
  cam.ux = cam.ry * cam.fz - cam.rz * cam.fy;
  cam.uy = cam.rz * cam.fx - cam.rx * cam.fz;
  cam.uz = cam.rx * cam.fy - cam.ry * cam.fx;
  // Roll part-way with the bank so the horizon tilts into the turn.
  var targetRoll = plane.bank * 0.38;
  cam.roll = EW.lerp(cam.roll || 0, targetRoll, 1 - Math.exp(-dt * 4));
  if (Math.abs(cam.roll) > 0.0004) {
    var cr = Math.cos(cam.roll);
    var sr = Math.sin(cam.roll);
    var nrx = cam.rx * cr + cam.ux * sr;
    var nry = cam.ry * cr + cam.uy * sr;
    var nrz = cam.rz * cr + cam.uz * sr;
    var nux = cam.ux * cr - cam.rx * sr;
    var nuy = cam.uy * cr - cam.ry * sr;
    var nuz = cam.uz * cr - cam.rz * sr;
    cam.rx = nrx; cam.ry = nry; cam.rz = nrz;
    cam.ux = nux; cam.uy = nuy; cam.uz = nuz;
  }
  // Speed FOV kick: the view widens slightly as she accelerates.
  var targetFov = 68 + speedNorm * 9;
  cam.fov = EW.lerp(cam.fov || 68, targetFov, 1 - Math.exp(-dt * 2.4));
  cam.focal = viewH / 2 / Math.tan((cam.fov * EW.DEG) / 2);
};

// Project a world point. Returns {x, y, d} screen coords + depth, or null
// when the point is behind the camera.
EW.project = function (cam, viewW, viewH, x, y, z) {
  var dx = x - cam.x;
  var dy = y - cam.y;
  var dz = z - cam.z;
  var cz = dx * cam.fx + dy * cam.fy + dz * cam.fz;
  if (cz < 0.6) return null;
  var cx = dx * cam.rx + dy * cam.ry + dz * cam.rz;
  var cy = dx * cam.ux + dy * cam.uy + dz * cam.uz;
  return {
    x: viewW / 2 + (cx / cz) * cam.focal,
    y: viewH / 2 - (cy / cz) * cam.focal,
    d: cz,
  };
};

function fogMix(palette, color, dist) {
  var near = palette.fogNear === undefined ? 320 : palette.fogNear;
  var t = EW.smoothstep(near, palette.fogFar, dist);
  return EW.mixColor(color, palette.fog, t);
}

// --------------------------------------------------------------- sky

// Distant island silhouettes: three hazed ridgelines wrapped around the
// full compass, generated once per world from circular noise so the
// profile joins seamlessly. They parallax gently with camera position.
function buildSilhouettes(world) {
  if (world._silhouettes) return world._silhouettes;
  var layers = [];
  var defs = [
    { samples: 192, base: 0.30, amp: 0.85, freq: 2.6, seed: 31.7 },
    { samples: 192, base: 0.22, amp: 1.0, freq: 3.4, seed: 57.1 },
    { samples: 192, base: 0.12, amp: 1.15, freq: 4.3, seed: 83.9 },
  ];
  for (var L = 0; L < defs.length; L++) {
    var d = defs[L];
    var prof = new Float32Array(d.samples);
    for (var i = 0; i < d.samples; i++) {
      var az = (i / d.samples) * EW.TAU;
      var nx = Math.cos(az) * d.freq + d.seed;
      var ny = Math.sin(az) * d.freq + d.seed * 0.37;
      var n = EW.fbm(nx, ny, 3);
      // Sparse islands: only the upper part of the noise breaks the sea.
      var h = Math.max(0, n - 0.52) / 0.48;
      prof[i] = d.base * h + d.amp * h * h;
    }
    layers.push(prof);
  }
  world._silhouettes = layers;
  return layers;
}

function silhouetteAt(prof, az) {
  var n = prof.length;
  var t = ((az % EW.TAU) + EW.TAU) % EW.TAU / EW.TAU * n;
  var i0 = Math.floor(t) % n;
  var i1 = (i0 + 1) % n;
  return EW.lerp(prof[i0], prof[i1], t - Math.floor(t));
}

EW.drawSky = function (ctx, viewW, viewH, world, cam, plane, time) {
  var pal = world.palette;
  var horizonY = viewH * 0.52 - cam.fz * viewH * 0.9;

  // Smooth vertical gradient with a warm settle near the horizon.
  var grad = ctx.createLinearGradient(0, 0, 0, Math.max(horizonY, 1));
  grad.addColorStop(0, EW.cssColor(pal.skyTop));
  grad.addColorStop(0.42, EW.cssColor(pal.skyMid));
  grad.addColorStop(0.78, EW.cssColor(EW.mixColor(pal.skyMid, pal.skyHorizon, 0.62)));
  grad.addColorStop(1, EW.cssColor(pal.skyHorizon));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewW, Math.max(horizonY, 0) + 1);
  ctx.fillStyle = EW.cssColor(pal.fog);
  ctx.fillRect(0, horizonY, viewW, viewH - horizonY);

  // Sun direction, projected once for glow + disc.
  var sunDir = {
    x: Math.sin(pal.sunAz) * Math.cos(pal.sunEl),
    y: Math.cos(pal.sunAz) * Math.cos(pal.sunEl),
    z: Math.sin(pal.sunEl),
  };
  var sp = EW.project(cam, viewW, viewH, cam.x + sunDir.x * 900, cam.y + sunDir.y * 900, cam.z + sunDir.z * 900);

  // Broad warm wash around the sun's azimuth (sunset/sunrise bloom).
  if (sp && !pal.stars) {
    var washR = viewH * (pal.sunEl < 0.35 ? 1.25 : 0.8);
    var wash = ctx.createRadialGradient(sp.x, sp.y, 10, sp.x, sp.y, washR);
    wash.addColorStop(0, EW.cssColor(pal.sun, pal.sunEl < 0.35 ? 0.30 : 0.16));
    wash.addColorStop(0.55, EW.cssColor(pal.sun, 0.08));
    wash.addColorStop(1, EW.cssColor(pal.sun, 0));
    ctx.fillStyle = wash;
    ctx.fillRect(sp.x - washR, sp.y - washR, washR * 2, washR * 2);
  }

  if (pal.stars) {
    ctx.fillStyle = 'rgba(220,232,255,0.85)';
    var rng = EW.makeRng(777);
    var shift = (-plane.heading * 180) % viewW;
    for (var s = 0; s < 130; s++) {
      var sx = (rng() * viewW + shift + viewW) % viewW;
      var sy = rng() * horizonY * 0.85;
      var tw = 0.5 + 0.5 * Math.sin(time * 2 + s * 1.7);
      ctx.globalAlpha = 0.35 + 0.55 * tw;
      ctx.fillRect(sx, sy, s % 5 === 0 ? 2 : 1.4, s % 5 === 0 ? 2 : 1.4);
    }
    ctx.globalAlpha = 1;
  }

  // Distant island silhouettes, far layer first, hazed toward the fog.
  var layers = buildSilhouettes(world);
  var fwdAz = Math.atan2(cam.fx, cam.fy);
  var layerTint = [
    EW.mixColor(pal.fog, [96, 118, 138], 0.20),
    EW.mixColor(pal.fog, [72, 98, 112], 0.38),
    EW.mixColor(pal.fog, [48, 74, 84], 0.55),
  ];
  var layerPx = [viewH * 0.075, viewH * 0.11, viewH * 0.16];
  for (var L = 0; L < layers.length; L++) {
    var prof = layers[L];
    var drift = (cam.x * 0.6 + cam.y * 0.4) * 0.000006 * (3 - L);
    ctx.beginPath();
    ctx.moveTo(-4, horizonY + 2);
    var steps = 56;
    for (var k = 0; k <= steps; k++) {
      var px = (k / steps) * (viewW + 8) - 4;
      var az = fwdAz + Math.atan((px - viewW / 2) / cam.focal) + drift;
      var h = silhouetteAt(prof, az);
      ctx.lineTo(px, horizonY - h * layerPx[L]);
    }
    ctx.lineTo(viewW + 4, horizonY + 2);
    ctx.closePath();
    ctx.fillStyle = EW.cssColor(layerTint[L]);
    ctx.fill();
  }

  // Far cloud banks: wide, flat, barely-there streaks above the horizon.
  if (!pal.rain) {
    var bankCol = pal.stars ? [52, 66, 98] : EW.mixColor([250, 252, 255], pal.skyHorizon, 0.35);
    for (var b = 0; b < 6; b++) {
      var bx = ((b * 263.7 + time * (2.5 + b * 0.4) - plane.heading * 140) % (viewW + 520) + viewW + 520) % (viewW + 520) - 260;
      var by = horizonY * (0.52 + (b % 3) * 0.13) + Math.sin(b * 2.1) * 6;
      var bw = 190 + (b % 4) * 70;
      var bg = ctx.createRadialGradient(bx, by, 4, bx, by, bw);
      bg.addColorStop(0, EW.cssColor(bankCol, pal.stars ? 0.16 : 0.20));
      bg.addColorStop(1, EW.cssColor(bankCol, 0));
      ctx.fillStyle = bg;
      ctx.save();
      ctx.translate(bx, by);
      ctx.scale(1, 0.16);
      ctx.translate(-bx, -by);
      ctx.fillRect(bx - bw, by - bw, bw * 2, bw * 2);
      ctx.restore();
    }
  }

  // Sun (or moon at night): halo, core glow and disc.
  if (sp) {
    var haloR = pal.stars ? 90 : 170;
    var halo = ctx.createRadialGradient(sp.x, sp.y, 4, sp.x, sp.y, haloR);
    halo.addColorStop(0, EW.cssColor(pal.sun, pal.stars ? 0.30 : 0.42));
    halo.addColorStop(0.35, EW.cssColor(pal.sun, pal.stars ? 0.12 : 0.18));
    halo.addColorStop(1, EW.cssColor(pal.sun, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(sp.x - haloR, sp.y - haloR, haloR * 2, haloR * 2);
    var discR = pal.stars ? 16 : 24;
    var disc = ctx.createRadialGradient(sp.x - discR * 0.3, sp.y - discR * 0.3, 1, sp.x, sp.y, discR);
    disc.addColorStop(0, EW.cssColor(EW.shadeColor(pal.sun, 1.08)));
    disc.addColorStop(0.8, EW.cssColor(pal.sun));
    disc.addColorStop(1, EW.cssColor(EW.shadeColor(pal.sun, 0.94)));
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, discR, 0, EW.TAU);
    ctx.fillStyle = disc;
    ctx.fill();
    if (pal.stars) {
      ctx.beginPath();
      ctx.arc(sp.x + 7, sp.y - 4, 13, 0, EW.TAU);
      ctx.fillStyle = EW.cssColor(pal.skyMid);
      ctx.fill();
    }
  }
};

// Rain (round 4): streaks follow the wind. The world-space rain
// velocity (wind + fall) is projected through the camera so the slant
// on screen is correct whatever heading she flies, in two depth
// layers — a dim far sheet and longer near streaks.
EW.drawRain = function (ctx, viewW, viewH, world, cam, time) {
  var wx = Math.sin(world.windDir) * world.windSpeed;
  var wy = Math.cos(world.windDir) * world.windSpeed;
  var o = EW.project(cam, viewW, viewH, cam.x + cam.fx * 100, cam.y + cam.fy * 100, cam.z + cam.fz * 100);
  var e = EW.project(cam, viewW, viewH,
    cam.x + cam.fx * 100 + wx * 4, cam.y + cam.fy * 100 + wy * 4, cam.z + cam.fz * 100 - 34);
  var sx = 0.25;
  var sy = 1;
  if (o && e) {
    sx = e.x - o.x;
    sy = e.y - o.y;
    var sl = Math.sqrt(sx * sx + sy * sy) || 1;
    sx /= sl;
    sy /= sl;
    if (sy < 0.3) sy = 0.3; // rain never falls upward on screen
  }
  var layers = [
    { count: 130, len: 11, alpha: 0.16, width: 1, speed: 520 },
    { count: 70, len: 19, alpha: 0.30, width: 1.4, speed: 760 },
  ];
  layers.forEach(function (layer, li) {
    ctx.strokeStyle = 'rgba(190,205,225,' + layer.alpha + ')';
    ctx.lineWidth = layer.width;
    ctx.beginPath();
    for (var i = 0; i < layer.count; i++) {
      var seed = (i + li * 211) * 137.5;
      var fall = layer.speed * (0.8 + (i % 5) * 0.1);
      var x = ((seed * 7.3 + time * fall * sx * 0.55) % (viewW + 80) + viewW + 80) % (viewW + 80) - 40;
      var y = ((seed * 3.1 + time * fall * sy) % (viewH + 60) + viewH + 60) % (viewH + 60) - 30;
      ctx.moveTo(x, y);
      ctx.lineTo(x - sx * layer.len, y - sy * layer.len);
    }
    ctx.stroke();
  });
};

// --------------------------------------------------------------- ground

var gridHeights = new Float32Array(64 * 64);
var gridColors = new Float32Array(64 * 64 * 3);
// Terrain cache (round 4 perf): heights and land base colours are
// pure functions of world position, so while the snapped grid origin
// and world stay put they are computed once and reused. Only water
// (animated), the near-camera fine grain and fog vary per frame.
var gridBase = new Float32Array(64 * 64 * 3);
var cacheWorld = null;
var cacheOX = 0;
var cacheOY = 0;

// Terrain with per-vertex colors (round 4). Colors are computed at grid
// vertices — height band, noise texture, field plots, smooth-normal
// diffuse with a warm-sun / cool-fill split, water depth + sun glint —
// then each cell is drawn as a four-triangle fan around its center so
// shading rolls continuously across cell borders instead of stepping
// like a checkerboard. Fog is applied per vertex with a sun-scatter
// tint: haze glows warm when you look toward the sun (MSFS aerial
// perspective), and stays cool looking away.
EW.drawGround = function (ctx, world, cam, plane, viewW, viewH, time) {
  var pal = world.palette;
  var cell = 50;
  var half = 26; // 53 x 53 cells
  var n = half * 2 + 1;
  var originX = Math.round(plane.x / cell) * cell - half * cell;
  var originY = Math.round(plane.y / cell) * cell - half * cell;
  var i, j;
  var cacheHit = cacheWorld === world && cacheOX === originX && cacheOY === originY;
  if (!cacheHit) {
    for (j = 0; j < n; j++) {
      for (i = 0; i < n; i++) {
        gridHeights[j * n + i] = world.heightAt(originX + i * cell, originY + j * cell);
      }
    }
    cacheWorld = world;
    cacheOX = originX;
    cacheOY = originY;
  }
  // Full 3D sun direction for normal-based diffuse shading.
  var sunX = Math.sin(pal.sunAz) * Math.cos(pal.sunEl);
  var sunY = Math.cos(pal.sunAz) * Math.cos(pal.sunEl);
  var sunZ = Math.sin(pal.sunEl);
  var sunHLen = Math.sqrt(sunX * sunX + sunY * sunY) || 1;
  var sunHx = sunX / sunHLen;
  var sunHy = sunY / sunHLen;
  // Golden hour rakes warm highlights against cool shadow fill; the
  // split fades as the sun climbs.
  var warmAmt = EW.clamp(1.25 - pal.sunEl, 0.25, 1.1);
  var sunStrength = pal.sunStrength === undefined ? 1 : pal.sunStrength;
  var fillCol = pal.fillCol || pal.fog;
  var fogNear = pal.fogNear === undefined ? 320 : pal.fogNear;
  var fogSunTint = EW.mixColor(pal.fog, pal.sun, 0.45);
  // Derived palette tones for texture variation.
  var dryGrass = EW.mixColor(pal.grassLow, [178, 166, 98], 0.55);
  var moss = EW.mixColor(pal.grassHigh, [34, 66, 40], 0.5);
  var shallow = EW.mixColor(pal.water, [126, 202, 206], 0.45);
  var deep = EW.shadeColor(pal.water, 0.7);
  var foamCol = [238, 247, 250];
  var fieldTones = [
    [104, 158, 78], [122, 170, 86], [150, 176, 92], [172, 168, 96],
    [140, 158, 74], [96, 148, 82], [186, 172, 104], [112, 142, 70],
  ];

  // ---- per-vertex color pass ----
  // Scalar channel math throughout: 2809 vertices a frame cannot
  // afford an [r,g,b] allocation per colour mix, so mixes write into
  // a shared scratch triple and the vertex keeps three locals.
  var _m = new Float32Array(3);
  function mixInto(ar, ag, ab, br, bg, bb, t) {
    _m[0] = ar + (br - ar) * t;
    _m[1] = ag + (bg - ag) * t;
    _m[2] = ab + (bb - ab) * t;
  }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  for (j = 0; j < n; j++) {
    for (i = 0; i < n; i++) {
      var vx = originX + i * cell;
      var vy = originY + j * cell;
      var h = gridHeights[j * n + i];
      var dxC = vx - cam.x;
      var dyC = vy - cam.y;
      var distV = Math.sqrt(dxC * dxC + dyC * dyC);
      var cr, cg, cb;
      if (h < 0.1) {
        // Depth tint: turquoise shallows at the shore, deep blue offshore.
        var depthT = EW.smoothstep(0.5, 13, -h);
        mixInto(shallow[0], shallow[1], shallow[2], deep[0], deep[1], deep[2], depthT);
        cr = _m[0]; cg = _m[1]; cb = _m[2];
        // Slow travelling wave shading.
        var wave = Math.sin(vx * 0.045 + time * 1.05) * Math.sin(vy * 0.038 - time * 0.8);
        var wsh = (0.97 + 0.06 * wave) * pal.ambient + 0.08;
        cr = clamp255(cr * wsh); cg = clamp255(cg * wsh); cb = clamp255(cb * wsh);
        // Sun glint: reflect the view ray off an animated ripple normal.
        // Sampled per vertex the glint becomes the broad shimmering path
        // MSFS paints under a low sun.
        var vvx = dxC;
        var vvy = dyC;
        var vvz = -cam.z;
        var vl = Math.sqrt(vvx * vvx + vvy * vvy + vvz * vvz) || 1;
        vvx /= vl; vvy /= vl; vvz /= vl;
        var rnx = 0.16 * Math.sin(vx * 0.11 + time * 1.7) + 0.11 * Math.sin(vy * 0.07 - time * 1.15);
        var rny = 0.16 * Math.cos(vy * 0.09 + time * 1.35) + 0.11 * Math.cos(vx * 0.06 + time * 0.85);
        var rnl = Math.sqrt(rnx * rnx + rny * rny + 1);
        rnx /= rnl; rny /= rnl;
        var rnz = 1 / rnl;
        var idn = vvx * rnx + vvy * rny + vvz * rnz;
        var rx = vvx - 2 * idn * rnx;
        var ry = vvy - 2 * idn * rny;
        var rz = vvz - 2 * idn * rnz;
        var specBase = rx * sunX + ry * sunY + rz * sunZ;
        var spec = specBase > 0.86 && distV < 1400 ? Math.pow(specBase, 70) : 0;
        // Drifting sparkle flecks on top of the glint path.
        var sparkle = distV < 1400 ? EW.valueNoise(vx * 0.21 + time * 1.25, vy * 0.21 - time * 0.9) : 0;
        var spark = Math.max(0, sparkle - 0.84) * 2.6 * (0.35 + spec);
        var glint = Math.min(1, spec * (pal.stars ? 0.55 : 0.95) * sunStrength + spark);
        if (glint > 0.02) {
          mixInto(cr, cg, cb, pal.sun[0], pal.sun[1], pal.sun[2], glint * 0.85);
          cr = _m[0]; cg = _m[1]; cb = _m[2];
        }
        // Whitecaps when the storm sea is up.
        if (pal.rain) {
          var cap = EW.valueNoise(vx * 0.085 + time * 0.9, vy * 0.085 - time * 0.6);
          if (cap > 0.74) {
            mixInto(cr, cg, cb, foamCol[0], foamCol[1], foamCol[2], EW.clamp((cap - 0.74) * 2.4, 0, 0.5));
            cr = _m[0]; cg = _m[1]; cb = _m[2];
          }
        }
        // Pulsing foam where the sea meets the sand.
        if (h > -1.7) {
          var foamT = EW.smoothstep(-1.7, -0.05, h) * (0.55 + 0.45 * Math.sin(time * 1.55 + (vx + vy) * 0.018));
          mixInto(cr, cg, cb, foamCol[0], foamCol[1], foamCol[2], EW.clamp(foamT, 0, 1) * 0.75);
          cr = _m[0]; cg = _m[1]; cb = _m[2];
        }
      } else if (cacheHit) {
        // Cached land base colour; only the near-camera fine grain
        // octave is applied per frame.
        var bi3 = (j * n + i) * 3;
        cr = gridBase[bi3]; cg = gridBase[bi3 + 1]; cb = gridBase[bi3 + 2];
        if (distV < 420) {
          var fineC = EW.fbm(vx * 0.055 + 31.7, vy * 0.055 + 8.3, 2);
          var ffC = EW.lerp(1, 0.9 + 0.2 * fineC, EW.smoothstep(420, 130, distV));
          cr = clamp255(cr * ffC); cg = clamp255(cg * ffC); cb = clamp255(cb * ffC);
        }
      } else {
        // World-space noise: big meadow patches + grain, sampled at
        // the vertex so the fan interpolation carries them smoothly
        // across the cell.
        var patch = EW.fbm(vx * 0.0034, vy * 0.0034, 2);
        var grain = EW.fbm(vx * 0.010, vy * 0.010, 2);
        var bandN = EW.fbm(vx * 0.0075 + 40.2, vy * 0.0075 + 17.9, 2);
        var effH = h + (bandN - 0.5) * 15;
        if (effH < 1.6) {
          cr = pal.sand[0]; cg = pal.sand[1]; cb = pal.sand[2];
          // Wet band darkening right at the waterline.
          var wet = EW.smoothstep(1.3, 0.05, h);
          var wsh2 = 1 - 0.3 * wet;
          cr = clamp255(cr * wsh2); cg = clamp255(cg * wsh2); cb = clamp255(cb * wsh2);
          if (h < 0.55) {
            var lap = 0.5 + 0.5 * Math.sin(time * 1.55 + (vx + vy) * 0.018);
            mixInto(cr, cg, cb, foamCol[0], foamCol[1], foamCol[2], lap * 0.18);
            cr = _m[0]; cg = _m[1]; cb = _m[2];
          }
        } else if (effH < 42) {
          mixInto(pal.grassLow[0], pal.grassLow[1], pal.grassLow[2],
            pal.grassHigh[0], pal.grassHigh[1], pal.grassHigh[2], EW.smoothstep(2, 42, effH));
          cr = _m[0]; cg = _m[1]; cb = _m[2];
          // Dry meadow patches and mossy hollows.
          mixInto(cr, cg, cb, dryGrass[0], dryGrass[1], dryGrass[2], EW.smoothstep(0.56, 0.8, patch) * 0.55);
          cr = _m[0]; cg = _m[1]; cb = _m[2];
          mixInto(cr, cg, cb, moss[0], moss[1], moss[2], EW.smoothstep(0.44, 0.18, patch) * 0.45);
          cr = _m[0]; cg = _m[1]; cb = _m[2];
          // Patchwork fields on gentle lowland (the MSFS look): large
          // hashed plots in varied greens and golds, dark hedgerows
          // along the borders, a pale farm road on some of them. The
          // noise texture stays underneath so plots never look flat.
          if (effH < 38) {
            var plotSize = 240;
            var pix = Math.floor(vx / plotSize);
            var piy = Math.floor(vy / plotSize);
            var ph = EW.hash2(pix * 3 + 11, piy * 7 + 5);
            var fieldCol = fieldTones[Math.floor(ph * fieldTones.length) % fieldTones.length];
            var fBlend = 0.72 * EW.smoothstep(38, 26, effH);
            mixInto(cr, cg, cb, fieldCol[0], fieldCol[1], fieldCol[2], fBlend);
            cr = _m[0]; cg = _m[1]; cb = _m[2];
            var ffx = vx / plotSize - pix;
            var ffy = vy / plotSize - piy;
            var edgeM = Math.min(ffx, 1 - ffx, ffy, 1 - ffy) * plotSize;
            if (edgeM < 20) {
              mixInto(cr, cg, cb, 44, 78, 46, (1 - edgeM / 20) * 0.5);
              cr = _m[0]; cg = _m[1]; cb = _m[2];
            }
            if (ph > 0.62 && edgeM < 6) {
              mixInto(cr, cg, cb, 205, 198, 172, 0.5);
              cr = _m[0]; cg = _m[1]; cb = _m[2];
            }
          }
        } else if (effH < 85) {
          mixInto(pal.grassHigh[0], pal.grassHigh[1], pal.grassHigh[2],
            pal.rock[0], pal.rock[1], pal.rock[2], EW.smoothstep(42, 85, effH));
          cr = _m[0]; cg = _m[1]; cb = _m[2];
        } else {
          mixInto(pal.rock[0], pal.rock[1], pal.rock[2],
            pal.snow[0], pal.snow[1], pal.snow[2], EW.smoothstep(95, 145, effH));
          cr = _m[0]; cg = _m[1]; cb = _m[2];
        }
        // Vertex normal from central differences on the height grid:
        // shading is continuous across cells by construction.
        var iL = Math.max(i - 1, 0);
        var iR = Math.min(i + 1, n - 1);
        var jD = Math.max(j - 1, 0);
        var jU = Math.min(j + 1, n - 1);
        var gx = (gridHeights[j * n + iR] - gridHeights[j * n + iL]) / ((iR - iL) * cell);
        var gy = (gridHeights[jU * n + i] - gridHeights[jD * n + i]) / ((jU - jD) * cell);
        var gradMag = Math.sqrt(gx * gx + gy * gy);
        // Steep faces weather into bare rock.
        if (gradMag > 0.28 && h >= 1.6) {
          mixInto(cr, cg, cb, pal.rock[0], pal.rock[1], pal.rock[2], EW.clamp((gradMag - 0.28) / 0.75, 0, 0.8));
          cr = _m[0]; cg = _m[1]; cb = _m[2];
        }
        // Rock strata: faint sedimentary banding on high ground.
        if (effH > 55) {
          var strata = 0.95 + 0.09 * Math.sin(h * 0.32 + bandN * 4.0);
          cr = clamp255(cr * strata); cg = clamp255(cg * strata); cb = clamp255(cb * strata);
        }
        // Snow sparkle flecks.
        if (effH > 100 && grain > 0.8) {
          cr = clamp255(cr * 1.06); cg = clamp255(cg * 1.06); cb = clamp255(cb * 1.06);
        }
        var nl2 = Math.sqrt(gx * gx + gy * gy + 1);
        var diffuse = Math.max(0, (-gx * sunX - gy * sunY + sunZ) / nl2);
        var lit = EW.clamp(diffuse * sunStrength, 0, 1.3);
        var light = (0.52 + 0.7 * lit) * pal.ambient + 0.1;
        var tex = 0.93 + 0.14 * grain;
        var lsh = light * tex;
        cr = clamp255(cr * lsh); cg = clamp255(cg * lsh); cb = clamp255(cb * lsh);
        // Warm/cool split: sunlit faces take the sun's colour, faces in
        // shade fall toward the cool sky fill — the golden-hour look.
        mixInto(cr, cg, cb, pal.sun[0], pal.sun[1], pal.sun[2], EW.clamp(lit, 0, 1) * 0.09 * warmAmt);
        cr = _m[0]; cg = _m[1]; cb = _m[2];
        mixInto(cr, cg, cb, fillCol[0], fillCol[1], fillCol[2], (1 - EW.clamp(lit, 0, 1)) * 0.13 * warmAmt);
        cr = _m[0]; cg = _m[1]; cb = _m[2];
        // Cache the base colour, then apply the near-camera fine
        // grain octave so low passes read as textured earth.
        var bi3b = (j * n + i) * 3;
        gridBase[bi3b] = cr; gridBase[bi3b + 1] = cg; gridBase[bi3b + 2] = cb;
        if (distV < 420) {
          var fine = EW.fbm(vx * 0.055 + 31.7, vy * 0.055 + 8.3, 2);
          var ff = EW.lerp(1, 0.9 + 0.2 * fine, EW.smoothstep(420, 130, distV));
          cr = clamp255(cr * ff); cg = clamp255(cg * ff); cb = clamp255(cb * ff);
        }
      }
      // Aerial perspective with forward-scattered sun haze.
      var fogT = EW.smoothstep(fogNear, pal.fogFar, distV);
      if (fogT > 0.02) {
        var align = distV > 1 ? (dxC * sunHx + dyC * sunHy) / distV : 0;
        var scatter = align > 0 ? align * align * align * 0.55 * warmAmt : 0;
        var fgr = pal.fog[0];
        var fgg = pal.fog[1];
        var fgb = pal.fog[2];
        if (scatter > 0.01) {
          mixInto(fgr, fgg, fgb, fogSunTint[0], fogSunTint[1], fogSunTint[2], scatter);
          fgr = _m[0]; fgg = _m[1]; fgb = _m[2];
        }
        mixInto(cr, cg, cb, fgr, fgg, fgb, fogT);
        cr = _m[0]; cg = _m[1]; cb = _m[2];
      }
      var ci3 = (j * n + i) * 3;
      gridColors[ci3] = cr;
      gridColors[ci3 + 1] = cg;
      gridColors[ci3 + 2] = cb;
    }
  }

  // ---- cell draw pass ----
  // Projection is inlined into a scratch triple: EW.project allocates
  // an object per call, and 13k of those a frame is real GC pressure.
  var _p = new Float32Array(3);
  function projTo(x, y, z) {
    var dx = x - cam.x;
    var dy = y - cam.y;
    var dz = z - cam.z;
    var cz = dx * cam.fx + dy * cam.fy + dz * cam.fz;
    if (cz < 0.6) return false;
    var cxv = dx * cam.rx + dy * cam.ry + dz * cam.rz;
    var cyv = dx * cam.ux + dy * cam.uy + dz * cam.uz;
    _p[0] = viewW / 2 + (cxv / cz) * cam.focal;
    _p[1] = viewH / 2 - (cyv / cz) * cam.focal;
    _p[2] = cz;
    return true;
  }
  var cells = [];
  for (j = 0; j < n - 1; j++) {
    for (i = 0; i < n - 1; i++) {
      var x0 = originX + i * cell;
      var y0 = originY + j * cell;
      var distC = EW.dist2(x0 + cell / 2, y0 + cell / 2, cam.x, cam.y);
      if (distC > pal.fogFar + 500) continue;
      var h00 = gridHeights[j * n + i];
      var h10 = gridHeights[j * n + i + 1];
      var h01 = gridHeights[(j + 1) * n + i];
      var h11 = gridHeights[(j + 1) * n + i + 1];
      var z00 = h00 < 0.1 ? 0 : h00;
      var z10 = h10 < 0.1 ? 0 : h10;
      var z01 = h01 < 0.1 ? 0 : h01;
      var z11 = h11 < 0.1 ? 0 : h11;
      var ok0 = projTo(x0, y0, z00);
      var sx0 = _p[0], sy0 = _p[1], sd0 = _p[2];
      var ok1 = projTo(x0 + cell, y0, z10);
      var sx1 = _p[0], sy1 = _p[1], sd1 = _p[2];
      var ok2 = projTo(x0 + cell, y0 + cell, z11);
      var sx2 = _p[0], sy2 = _p[1], sd2 = _p[2];
      var ok3 = projTo(x0, y0 + cell, z01);
      var sx3 = _p[0], sy3 = _p[1], sd3 = _p[2];
      if (!ok0 && !ok1 && !ok2 && !ok3) continue;
      var depth = 0;
      var cnt = 0;
      if (ok0) { depth += sd0; cnt++; }
      if (ok1) { depth += sd1; cnt++; }
      if (ok2) { depth += sd2; cnt++; }
      if (ok3) { depth += sd3; cnt++; }
      depth /= cnt;
      var c00 = (j * n + i) * 3;
      var c10 = (j * n + i + 1) * 3;
      var c01 = ((j + 1) * n + i) * 3;
      var c11 = ((j + 1) * n + i + 1) * 3;
      var cok = false;
      var scx = 0, scy = 0;
      if (distC < 800) {
        cok = projTo(x0 + cell / 2, y0 + cell / 2, (z00 + z10 + z01 + z11) / 4);
        scx = _p[0]; scy = _p[1];
      }
      cells.push({
        depth: depth,
        distC: distC,
        x0: sx0, y0: sy0, ok0: ok0,
        x1: sx1, y1: sy1, ok1: ok1,
        x2: sx2, y2: sy2, ok2: ok2,
        x3: sx3, y3: sy3, ok3: ok3,
        cx: scx, cy: scy, cok: cok,
        r0: gridColors[c00], g0: gridColors[c00 + 1], b0: gridColors[c00 + 2],
        r1: gridColors[c10], g1: gridColors[c10 + 1], b1: gridColors[c10 + 2],
        r2: gridColors[c11], g2: gridColors[c11 + 1], b2: gridColors[c11 + 2],
        r3: gridColors[c01], g3: gridColors[c01 + 1], b3: gridColors[c01 + 2],
      });
    }
  }
  cells.sort(function (a, b) { return b.depth - a.depth; });

  function fillTriN(xa, ya, xb, yb, xc, yc, r, g, b) {
    ctx.beginPath();
    ctx.moveTo(xa, ya);
    ctx.lineTo(xb, yb);
    ctx.lineTo(xc, yc);
    ctx.closePath();
    ctx.fillStyle = 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
    ctx.fill();
  }

  for (var k = 0; k < cells.length; k++) {
    var cellRec = cells[k];
    // Off-screen cull: skip cells whose projected corners all sit
    // outside the viewport (with a margin for the fan center).
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    if (cellRec.ok0) { minX = Math.min(minX, cellRec.x0); maxX = Math.max(maxX, cellRec.x0); minY = Math.min(minY, cellRec.y0); maxY = Math.max(maxY, cellRec.y0); }
    if (cellRec.ok1) { minX = Math.min(minX, cellRec.x1); maxX = Math.max(maxX, cellRec.x1); minY = Math.min(minY, cellRec.y1); maxY = Math.max(maxY, cellRec.y1); }
    if (cellRec.ok2) { minX = Math.min(minX, cellRec.x2); maxX = Math.max(maxX, cellRec.x2); minY = Math.min(minY, cellRec.y2); maxY = Math.max(maxY, cellRec.y2); }
    if (cellRec.ok3) { minX = Math.min(minX, cellRec.x3); maxX = Math.max(maxX, cellRec.x3); minY = Math.min(minY, cellRec.y3); maxY = Math.max(maxY, cellRec.y3); }
    if (maxX < -60 || minX > viewW + 60 || maxY < -60 || minY > viewH + 60) continue;
    var ar = (cellRec.r0 + cellRec.r1 + cellRec.r2 + cellRec.r3) / 4;
    var ag = (cellRec.g0 + cellRec.g1 + cellRec.g2 + cellRec.g3) / 4;
    var ab = (cellRec.b0 + cellRec.b1 + cellRec.b2 + cellRec.b3) / 4;
    var fan = cellRec.distC < 800 && cellRec.cok;
    // Underlay quad in the cell's average colour: covers hairline
    // seams between fan triangles up close, and serves as the whole
    // cell at distance, where fog has flattened the detail.
    if (!fan || cellRec.distC < 550) {
      ctx.beginPath();
      var started = false;
      if (cellRec.ok0) { ctx.moveTo(cellRec.x0, cellRec.y0); started = true; }
      if (cellRec.ok1) { if (started) ctx.lineTo(cellRec.x1, cellRec.y1); else { ctx.moveTo(cellRec.x1, cellRec.y1); started = true; } }
      if (cellRec.ok2) { if (started) ctx.lineTo(cellRec.x2, cellRec.y2); else { ctx.moveTo(cellRec.x2, cellRec.y2); started = true; } }
      if (cellRec.ok3) { if (started) ctx.lineTo(cellRec.x3, cellRec.y3); else { ctx.moveTo(cellRec.x3, cellRec.y3); started = true; } }
      if (!started) continue;
      ctx.closePath();
      ctx.fillStyle = 'rgb(' + Math.round(ar) + ',' + Math.round(ag) + ',' + Math.round(ab) + ')';
      ctx.fill();
    }
    // Near field: four fan triangles carry the vertex colours across
    // the cell so no hard edge survives at grazing angles.
    if (fan) {
      if (cellRec.ok0 && cellRec.ok1) fillTriN(cellRec.x0, cellRec.y0, cellRec.x1, cellRec.y1, cellRec.cx, cellRec.cy,
        (cellRec.r0 + cellRec.r1 + ar) / 3, (cellRec.g0 + cellRec.g1 + ag) / 3, (cellRec.b0 + cellRec.b1 + ab) / 3);
      if (cellRec.ok1 && cellRec.ok2) fillTriN(cellRec.x1, cellRec.y1, cellRec.x2, cellRec.y2, cellRec.cx, cellRec.cy,
        (cellRec.r1 + cellRec.r2 + ar) / 3, (cellRec.g1 + cellRec.g2 + ag) / 3, (cellRec.b1 + cellRec.b2 + ab) / 3);
      if (cellRec.ok2 && cellRec.ok3) fillTriN(cellRec.x2, cellRec.y2, cellRec.x3, cellRec.y3, cellRec.cx, cellRec.cy,
        (cellRec.r2 + cellRec.r3 + ar) / 3, (cellRec.g2 + cellRec.g3 + ag) / 3, (cellRec.b2 + cellRec.b3 + ab) / 3);
      if (cellRec.ok3 && cellRec.ok0) fillTriN(cellRec.x3, cellRec.y3, cellRec.x0, cellRec.y0, cellRec.cx, cellRec.cy,
        (cellRec.r3 + cellRec.r0 + ar) / 3, (cellRec.g3 + cellRec.g0 + ag) / 3, (cellRec.b3 + cellRec.b0 + ab) / 3);
    }
  }
};

// --------------------------------------------------------------- runway

function runwayLocal(world, x, y) {
  var rw = world.runway;
  var ca = Math.cos(rw.heading);
  var sa = Math.sin(rw.heading);
  return {
    along: (x - rw.x) * sa + (y - rw.y) * ca,
    across: (x - rw.x) * ca - (y - rw.y) * sa,
  };
}
EW.runwayLocal = runwayLocal;

function runwayPoint(world, along, across, lift) {
  var rw = world.runway;
  var ca = Math.cos(rw.heading);
  var sa = Math.sin(rw.heading);
  return {
    x: rw.x + along * sa + across * ca,
    y: rw.y + along * ca - across * sa,
    z: rw.z + (lift || 0),
  };
}
EW.runwayPoint = runwayPoint;

EW.drawRunway = function (ctx, world, cam, viewW, viewH, time) {
  var pal = world.palette;
  var rw = world.runway;
  var hl = rw.len / 2;
  var hw = rw.width / 2;
  function P(along, across, lift) {
    var w = runwayPoint(world, along, across, lift);
    return EW.project(cam, viewW, viewH, w.x, w.y, w.z);
  }
  function poly(points, fill) {
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < points.length; i++) {
      if (!points[i]) continue;
      if (!started) {
        ctx.moveTo(points[i].x, points[i].y);
        started = true;
      } else ctx.lineTo(points[i].x, points[i].y);
    }
    if (!started) return;
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  var c1 = P(-hl, -hw, 0.25);
  var c2 = P(hl, -hw, 0.25);
  var c3 = P(hl, hw, 0.25);
  var c4 = P(-hl, hw, 0.25);
  var dist = EW.dist2(rw.x, rw.y, cam.x, cam.y);
  poly([c1, c2, c3, c4], EW.cssColor(fogMix(pal, [52, 54, 60], dist)));
  // edge lines
  poly([P(-hl, -hw + 0.8, 0.3), P(hl, -hw + 0.8, 0.3), P(hl, -hw + 1.7, 0.3), P(-hl, -hw + 1.7, 0.3)], 'rgba(240,240,235,0.85)');
  poly([P(-hl, hw - 1.7, 0.3), P(hl, hw - 1.7, 0.3), P(hl, hw - 0.8, 0.3), P(-hl, hw - 0.8, 0.3)], 'rgba(240,240,235,0.85)');
  // centerline dashes
  for (var a = -hl + 8; a < hl - 8; a += 16) {
    poly([P(a, -0.55, 0.3), P(a + 8, -0.55, 0.3), P(a + 8, 0.55, 0.3), P(a, 0.55, 0.3)], 'rgba(245,245,240,0.9)');
  }
  // threshold bars at both ends
  [-hl + 3, hl - 11].forEach(function (base) {
    for (var b = -3; b <= 3; b++) {
      poly([P(base, b * 3 - 0.7, 0.3), P(base + 8, b * 3 - 0.7, 0.3), P(base + 8, b * 3 + 0.7, 0.3), P(base, b * 3 + 0.7, 0.3)], 'rgba(245,245,240,0.9)');
    }
  });
  // Edge lights, threshold lights and approach bars (round 4). Glow
  // strength follows the palette's nightLights factor, so dawn and
  // storm get a soft lamp presence and full night gets the complete
  // airfield lighting picture: white edge lamps, green thresholds,
  // red runway ends, and a short approach light bar off each end.
  var nl = pal.nightLights || 0;
  var night = nl > 0.15;
  function lamp(along, across, lift, coreCol, glowCol, glowR) {
    var p = P(along, across, lift);
    if (!p) return;
    if (night) {
      var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      g.addColorStop(0, glowCol);
      g.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.globalAlpha = 0.35 + 0.65 * nl;
      ctx.fillStyle = g;
      ctx.fillRect(p.x - glowR, p.y - glowR, glowR * 2, glowR * 2);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = coreCol;
    ctx.fillRect(p.x - 1.4, p.y - 1.4, 2.8, 2.8);
  }
  for (var e = -hl; e <= hl; e += 20) {
    lamp(e, -hw - 1.2, 0.6, night ? '#ffe2a0' : '#d8d8d0', 'rgba(255,220,150,0.9)', 9);
    lamp(e, hw + 1.2, 0.6, night ? '#ffe2a0' : '#d8d8d0', 'rgba(255,220,150,0.9)', 9);
  }
  if (night) {
    // Thresholds: green across the landing end, red at the far end.
    for (var tb = -3; tb <= 3; tb++) {
      lamp(-hl + 1.5, tb * 3.4, 0.55, '#5dff8a', 'rgba(93,255,138,0.85)', 10);
      lamp(hl - 1.5, tb * 3.4, 0.55, '#ff5a4e', 'rgba(255,90,78,0.85)', 10);
    }
    // Approach light bars stepping out from both thresholds.
    for (var ap = 1; ap <= 4; ap++) {
      var spread = 4 + ap * 1.6;
      lamp(-hl - ap * 14, -spread, 0.7, '#fff6d8', 'rgba(255,246,216,0.8)', 8);
      lamp(-hl - ap * 14, spread, 0.7, '#fff6d8', 'rgba(255,246,216,0.8)', 8);
      lamp(hl + ap * 14, -spread, 0.7, '#fff6d8', 'rgba(255,246,216,0.8)', 8);
      lamp(hl + ap * 14, spread, 0.7, '#fff6d8', 'rgba(255,246,216,0.8)', 8);
    }
  }
  // windsock beside the threshold
  var sockBase = P(-hl + 6, hw + 9, 0);
  var sockTopW = runwayPoint(world, -hl + 6, hw + 9, 7);
  var sockTop = EW.project(cam, viewW, viewH, sockTopW.x, sockTopW.y, sockTopW.z);
  if (sockBase && sockTop) {
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sockBase.x, sockBase.y);
    ctx.lineTo(sockTop.x, sockTop.y);
    ctx.stroke();
    var wx = Math.sin(world.windDir);
    var wy = Math.cos(world.windDir);
    var tipW = { x: sockTopW.x + wx * 4.4, y: sockTopW.y + wy * 4.4, z: sockTopW.z - 0.6 + Math.sin(time * 3) * 0.3 };
    var tip = EW.project(cam, viewW, viewH, tipW.x, tipW.y, tipW.z);
    if (tip) {
      ctx.strokeStyle = '#ff7a30';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sockTop.x, sockTop.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
  }
};

// --------------------------------------------------------------- objects

function drawBox(ctx, cam, viewW, viewH, b, palette, dist) {
  var ca = Math.cos(b.rot || 0);
  var sa = Math.sin(b.rot || 0);
  function corner(dx, dy, dz) {
    var x = b.x + dx * ca - dy * sa;
    var y = b.y + dx * sa + dy * ca;
    return EW.project(cam, viewW, viewH, x, y, b.z + dz);
  }
  var hw = b.w / 2;
  var hd = b.d / 2;
  var c = [
    corner(-hw, -hd, 0), corner(hw, -hd, 0), corner(hw, hd, 0), corner(-hw, hd, 0),
    corner(-hw, -hd, b.h), corner(hw, -hd, b.h), corner(hw, hd, b.h), corner(-hw, hd, b.h),
  ];
  if (c.some(function (p) { return !p; })) return;
  var wall = b.kind === 'hangar' ? [150, 140, 128] : b.kind === 'tower' ? [170, 168, 160] : [196, 178, 150];
  var faces = [
    { idx: [4, 5, 6, 7], shade: 1.12 },
    { idx: [0, 1, 5, 4], shade: 0.82 },
    { idx: [1, 2, 6, 5], shade: 0.95 },
    { idx: [2, 3, 7, 6], shade: 0.7 },
    { idx: [3, 0, 4, 7], shade: 0.88 },
  ];
  faces.sort(function (f1, f2) {
    var d1 = 0, d2 = 0;
    f1.idx.forEach(function (i) { d1 += c[i].d; });
    f2.idx.forEach(function (i) { d2 += c[i].d; });
    return d2 - d1;
  });
  faces.forEach(function (f) {
    ctx.beginPath();
    f.idx.forEach(function (i, k) {
      if (k === 0) ctx.moveTo(c[i].x, c[i].y);
      else ctx.lineTo(c[i].x, c[i].y);
    });
    ctx.closePath();
    ctx.fillStyle = EW.cssColor(fogMix(palette, EW.shadeColor(wall, f.shade * palette.ambient + 0.1), dist));
    ctx.fill();
  });
  // roofs
  if (b.kind === 'house' || b.kind === 'hangar') {
    var ridge = b.h + (b.kind === 'hangar' ? 3.2 : 2.4);
    var r1 = corner(-hw, 0, ridge);
    var r2 = corner(hw, 0, ridge);
    if (r1 && r2) {
      var roofCol = b.kind === 'hangar' ? [110, 105, 100] : [150, 70, 55];
      [[c[4], c[5], r2, r1, 1.0], [c[6], c[7], r1, r2, 0.78]].forEach(function (quad) {
        ctx.beginPath();
        quad.slice(0, 4).forEach(function (p, k) {
          if (k === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle = EW.cssColor(fogMix(palette, EW.shadeColor(roofCol, quad[4] * palette.ambient + 0.1), dist));
        ctx.fill();
      });
    }
  }
  if (b.kind === 'tower') {
    var cab = { x: b.x, y: b.y, z: b.z + b.h, w: b.w + 2.4, d: b.d + 2.4, h: 3, rot: b.rot || 0, kind: 'cab' };
    drawBox(ctx, cam, viewW, viewH, cab, palette, dist);
  }
  // Lit windows after dark (round 4): warm panes on whichever walls
  // face the camera, a deterministic few left dark so the village
  // feels lived-in rather than uniformly switched on.
  var nl = palette.nightLights || 0;
  if (nl > 0.15 && (b.kind === 'house' || b.kind === 'hangar' || b.kind === 'tower' || b.kind === 'cab')) {
    var winSeed = Math.floor(Math.abs(b.x * 3 + b.y * 7)) + 17;
    var wallDefs = [
      { nx: 1, ny: 0 }, { nx: -1, ny: 0 }, { nx: 0, ny: 1 }, { nx: 0, ny: -1 },
    ];
    wallDefs.forEach(function (wallDef, wi) {
      var wnx = wallDef.nx * ca - wallDef.ny * sa;
      var wny = wallDef.nx * sa + wallDef.ny * ca;
      var wcx = b.x + wnx * (wallDef.nx !== 0 ? hw : hd);
      var wcy = b.y + wny * (wallDef.nx !== 0 ? hw : hd);
      var facing = (cam.x - wcx) * wnx + (cam.y - wcy) * wny;
      if (facing <= 0) return;
      var span = wallDef.nx !== 0 ? hd : hw;
      var cols = Math.max(1, Math.floor(span * 2 / 3.2));
      var rows = Math.max(1, Math.floor(b.h / 3.4));
      for (var r2 = 0; r2 < rows; r2++) {
        for (var c2 = 0; c2 < cols; c2++) {
          var litWin = EW.hash2(winSeed + wi * 31 + c2 * 7, r2 * 13 + wi) > 0.35;
          if (!litWin) continue;
          var along = -span + (c2 + 0.5) * (span * 2 / cols);
          var wz0 = 1.1 + r2 * 3.0;
          var wz1 = Math.min(b.h - 0.5, wz0 + 1.5);
          if (wz1 <= wz0) continue;
          var halfWin = 0.55;
          var ptsW;
          if (wallDef.nx !== 0) {
            var dxw = wallDef.nx * (hw + 0.07);
            ptsW = [
              corner(dxw, along - halfWin, wz0), corner(dxw, along + halfWin, wz0),
              corner(dxw, along + halfWin, wz1), corner(dxw, along - halfWin, wz1),
            ];
          } else {
            var dyw = wallDef.ny * (hd + 0.07);
            ptsW = [
              corner(along - halfWin, dyw, wz0), corner(along + halfWin, dyw, wz0),
              corner(along + halfWin, dyw, wz1), corner(along - halfWin, dyw, wz1),
            ];
          }
          if (ptsW.some(function (p) { return !p; })) continue;
          ctx.beginPath();
          ptsW.forEach(function (p, k) {
            if (k === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
          ctx.fillStyle = 'rgba(255,196,110,' + (0.55 + 0.4 * nl).toFixed(2) + ')';
          ctx.fill();
        }
      }
    });
  }
}

function drawTree(ctx, cam, viewW, viewH, tree, palette, dist) {
  var base = EW.project(cam, viewW, viewH, tree.x, tree.y, tree.z);
  var top = EW.project(cam, viewW, viewH, tree.x, tree.y, tree.z + 10 * tree.s);
  if (!base || !top) return;
  var w = (3.4 * tree.s * cam.focal) / base.d;
  if (w < 0.7) return;
  var green = EW.mixColor([34, 84, 44], [58, 116, 58], tree.tone);
  green = fogMix(palette, EW.shadeColor(green, palette.ambient + 0.1), dist);
  var trunkCol = EW.cssColor(fogMix(palette, [92, 66, 44], dist));
  var treeH = base.y - top.y;
  if (tree.round) {
    // Round-canopy tree: a short trunk under three overlapping leaf
    // blobs — a shaded belly, the main crown, and a sun-lit cap.
    ctx.fillStyle = trunkCol;
    ctx.fillRect(base.x - w * 0.07, base.y - treeH * 0.34, Math.max(1, w * 0.14), treeH * 0.34);
    var cw = w * 1.25;
    var cyC = base.y - treeH * 0.62;
    var darkG = EW.cssColor(EW.shadeColor(green, 0.72));
    var liteG = EW.cssColor(EW.shadeColor(green, 1.22));
    function blob(ox, oy, rf, col) {
      ctx.beginPath();
      ctx.ellipse(base.x + ox * cw, cyC + oy * cw, cw * 0.5 * rf, cw * 0.4 * rf, 0, 0, EW.TAU);
      ctx.fillStyle = col;
      ctx.fill();
    }
    blob(-0.16, 0.14, 0.9, darkG);
    blob(0.14, 0.1, 0.84, darkG);
    blob(0, -0.06, 1.0, EW.cssColor(green));
    blob(0.1, -0.26, 0.62, liteG);
    return;
  }
  ctx.fillStyle = trunkCol;
  ctx.fillRect(base.x - w * 0.06, base.y - (base.y - top.y) * 0.22, Math.max(1, w * 0.12), (base.y - top.y) * 0.22);
  ctx.fillStyle = EW.cssColor(green);
  for (var tier = 0; tier < 3; tier++) {
    var ty = EW.lerp(base.y - (base.y - top.y) * 0.18, top.y, tier / 3);
    var tw = w * (1 - tier * 0.26);
    var th = (base.y - top.y) * 0.34;
    ctx.beginPath();
    ctx.moveTo(base.x - tw / 2, ty);
    ctx.lineTo(base.x + tw / 2, ty);
    ctx.lineTo(base.x, ty - th);
    ctx.closePath();
    ctx.fill();
  }
}

function drawRing(ctx, cam, viewW, viewH, ring, state, time, palette) {
  var ux = -ring.ny;
  var uy = ring.nx;
  var center = EW.project(cam, viewW, viewH, ring.x, ring.y, ring.z);
  if (!center) return;
  // The next ring breathes gently so the eye locks onto it.
  var breathe = state === 'next' ? 1 + 0.025 * Math.sin(time * 4) : 1;
  var pts = [];
  var segs = 36;
  for (var i = 0; i < segs; i++) {
    var a = (i / segs) * EW.TAU;
    var x = ring.x + ux * Math.cos(a) * ring.r * breathe;
    var y = ring.y + uy * Math.cos(a) * ring.r * breathe;
    var z = ring.z + Math.sin(a) * ring.r * breathe;
    pts.push(EW.project(cam, viewW, viewH, x, y, z));
  }
  if (pts.some(function (p) { return !p; })) return;
  var width = EW.clamp(190 / center.d, 2, 10);
  var color;
  var alpha;
  if (state === 'passed') {
    color = '#57e389';
    alpha = 0.45;
  } else if (state === 'next') {
    color = '#ffd23e';
    alpha = 0.88 + 0.12 * Math.sin(time * 4);
  } else {
    color = '#e8f2ff';
    alpha = 0.55;
  }
  function tracePath() {
    ctx.beginPath();
    pts.forEach(function (p, k) {
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
  }
  // Inner sheen: clear at the middle, tinted toward the rim.
  var ringPx = Math.max(6, (ring.r * cam.focal) / center.d);
  var sheen = ctx.createRadialGradient(center.x, center.y, ringPx * 0.2, center.x, center.y, ringPx);
  sheen.addColorStop(0, color);
  sheen.addColorStop(1, color);
  tracePath();
  ctx.fillStyle = sheen;
  ctx.globalAlpha = alpha * 0.07;
  ctx.fill();
  // Layered glow: wide halo, mid bloom, bright core. After dark the
  // rings are lit gates (round 4): an extra wide bloom pass and
  // stronger halos so they burn through the night like the strip lamps.
  var nlBoost = palette ? (palette.nightLights || 0) : 0;
  ctx.strokeStyle = color;
  if (nlBoost > 0.15 && state !== 'passed') {
    tracePath();
    ctx.lineWidth = width * (4.6 + 2.2 * nlBoost);
    ctx.globalAlpha = 0.10 + 0.10 * nlBoost;
    ctx.stroke();
  }
  if (state === 'next') {
    tracePath();
    ctx.lineWidth = width * 3.4;
    ctx.globalAlpha = 0.16 + 0.07 * Math.sin(time * 4) + 0.10 * nlBoost;
    ctx.stroke();
    tracePath();
    ctx.lineWidth = width * 1.9;
    ctx.globalAlpha = 0.38 + 0.12 * nlBoost;
    ctx.stroke();
  } else if (state === 'later') {
    tracePath();
    ctx.lineWidth = width * 2.2;
    ctx.globalAlpha = 0.14 + 0.10 * nlBoost;
    ctx.stroke();
  }
  tracePath();
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.stroke();
  // Rotating dash sweep on the target ring, plus a hot inner edge.
  if (state === 'next') {
    tracePath();
    ctx.lineWidth = width * 0.55;
    ctx.strokeStyle = '#fff3c4';
    ctx.globalAlpha = 0.95;
    ctx.stroke();
    tracePath();
    ctx.setLineDash([ringPx * 0.5, ringPx * 0.34]);
    ctx.lineDashOffset = -time * ringPx * 1.4;
    ctx.lineWidth = width * 1.25;
    ctx.strokeStyle = '#ffe98a';
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  // Cardinal pips so distant rings still read as gates, not specks.
  if (state !== 'passed') {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (var q = 0; q < 4; q++) {
      var pip = pts[Math.floor((q / 4) * segs)];
      var ps = EW.clamp(width * 0.85, 1.6, 5);
      ctx.beginPath();
      ctx.arc(pip.x, pip.y, ps, 0, EW.TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawZone(ctx, cam, viewW, viewH, zone, palette, time) {
  var pts = [];
  var segs = 26;
  for (var i = 0; i < segs; i++) {
    var a = (i / segs) * EW.TAU;
    pts.push(EW.project(cam, viewW, viewH, zone.x + Math.cos(a) * zone.r, zone.y + Math.sin(a) * zone.r, zone.z + 0.4));
  }
  if (!pts.some(function (p) { return !p; })) {
    ctx.beginPath();
    pts.forEach(function (p, k) {
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = zone.delivered ? 'rgba(87,227,137,0.25)' : 'rgba(255,140,60,0.22)';
    ctx.fill();
    ctx.strokeStyle = zone.delivered ? '#57e389' : '#ff8c3c';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // light beacon so the pad reads from altitude
  var base = EW.project(cam, viewW, viewH, zone.x, zone.y, zone.z);
  var top = EW.project(cam, viewW, viewH, zone.x, zone.y, zone.z + 130);
  if (base && top) {
    var w = EW.clamp(500 / base.d, 2, 16);
    var grad = ctx.createLinearGradient(base.x, base.y, top.x, top.y);
    var col = zone.delivered ? '87,227,137' : '255,150,70';
    grad.addColorStop(0, 'rgba(' + col + ',0.35)');
    grad.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(base.x - w, base.y);
    ctx.lineTo(base.x + w, base.y);
    ctx.lineTo(top.x + w * 0.4, top.y);
    ctx.lineTo(top.x - w * 0.4, top.y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawFuelCan(ctx, cam, viewW, viewH, can, time) {
  var bob = Math.sin(time * 2 + can.phase) * 2.2;
  var p = EW.project(cam, viewW, viewH, can.x, can.y, can.z + bob);
  if (!p) return;
  var s = EW.clamp(420 / p.d, 3, 26);
  var glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 1.6);
  glow.addColorStop(0, 'rgba(255,90,70,0.4)');
  glow.addColorStop(1, 'rgba(255,90,70,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(p.x - s * 1.6, p.y - s * 1.6, s * 3.2, s * 3.2);
  ctx.fillStyle = '#d63c2e';
  ctx.fillRect(p.x - s * 0.42, p.y - s * 0.55, s * 0.84, s * 1.1);
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(p.x - s * 0.42, p.y - s * 0.14, s * 0.84, s * 0.3);
  ctx.fillStyle = '#8c241a';
  ctx.fillRect(p.x - s * 0.2, p.y - s * 0.72, s * 0.4, s * 0.18);
}

function drawCloud(ctx, cam, viewW, viewH, cloud, palette, time) {
  var p = EW.project(cam, viewW, viewH, cloud.x, cloud.y, cloud.z);
  if (!p) return;
  var base = (cloud.s * cam.focal) / p.d;
  if (base < 4) return;
  var rng = EW.makeRng(Math.floor(cloud.seed * 1000) + 5);
  // Lit tops take the sun colour — a whisper at midday, a warm wash at
  // golden hour — while undersides sit in cool blue-grey shade. Storm
  // bases go properly dark. Far clouds melt into the haze like
  // everything else (aerial perspective).
  var warmAmt = EW.clamp(1.25 - palette.sunEl, 0.25, 1.1);
  var lit = palette.stars ? [70, 84, 118] : palette.rain ? [158, 166, 178] : EW.mixColor([252, 253, 255], palette.sun, 0.16 + 0.3 * warmAmt);
  var shade = palette.stars ? [30, 40, 64] : palette.rain ? [76, 84, 98] : EW.mixColor([168, 182, 205], palette.fillCol || [168, 182, 205], 0.35 * warmAmt);
  var fogNearC = palette.fogNear === undefined ? 320 : palette.fogNear;
  var fogT = EW.smoothstep(fogNearC, palette.fogFar, p.d);
  lit = EW.mixColor(lit, palette.fog, fogT * 0.85);
  shade = EW.mixColor(shade, palette.fog, fogT * 0.85);
  var fade = EW.clamp(1.15 - p.d / 3200, 0.35, 1);
  var drift = Math.sin(time * 0.05 + cloud.seed) * base * 0.05;
  // Shaded under-belly first, then the lit crowns above it.
  for (var pass = 0; pass < 2; pass++) {
    var rng2 = EW.makeRng(Math.floor(cloud.seed * 1000) + 5);
    for (var i = 0; i < cloud.puffs; i++) {
      var ox = (rng2() - 0.5) * base * 1.7 + drift;
      var oy = (rng2() - 0.5) * base * 0.34;
      var r = base * (0.42 + rng2() * 0.3);
      var cxp = p.x + ox;
      var cyp = p.y + oy + (pass === 0 ? r * 0.22 : -r * 0.1);
      var col = pass === 0 ? shade : lit;
      var g = ctx.createRadialGradient(cxp, cyp - r * 0.25, r * 0.1, cxp, cyp, r);
      g.addColorStop(0, EW.cssColor(col, (pass === 0 ? 0.5 : 0.78) * fade));
      g.addColorStop(0.62, EW.cssColor(col, (pass === 0 ? 0.34 : 0.5) * fade));
      g.addColorStop(1, EW.cssColor(col, 0));
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(cxp, cyp);
      ctx.scale(1, 0.55);
      ctx.translate(-cxp, -cyp);
      ctx.fillRect(cxp - r, cyp - r, r * 2, r * 2);
      ctx.restore();
    }
  }
}

// Soft shadows the clouds throw on the terrain and sea below them.
// The shadow lands displaced away from the sun by the cloud's height
// over tan(sun elevation), so dawn and dusk throw long shadows that
// agree with the plane's own ground shadow.
EW.drawCloudShadows = function (ctx, world, cam, viewW, viewH) {
  var pal = world.palette;
  if (pal.stars) return;
  var sunX = Math.sin(pal.sunAz) * Math.cos(pal.sunEl);
  var sunY = Math.cos(pal.sunAz) * Math.cos(pal.sunEl);
  var sunZ = Math.max(0.12, Math.sin(pal.sunEl));
  var strength = pal.sunStrength === undefined ? 1 : pal.sunStrength;
  var shadowAlpha = 0.16 * EW.clamp(strength, 0.3, 1.2);
  for (var i = 0; i < world.clouds.length; i++) {
    var cloud = world.clouds[i];
    var gz = Math.max(world.heightAt(cloud.x, cloud.y), 0);
    var drop = (cloud.z - gz) / sunZ;
    var sx = cloud.x - sunX * drop;
    var sy = cloud.y - sunY * drop;
    var p = EW.project(cam, viewW, viewH, sx, sy, gz + 0.5);
    if (!p) continue;
    var r = (cloud.s * 1.15 * cam.focal) / p.d;
    if (r < 6) continue;
    var g = ctx.createRadialGradient(p.x, p.y, r * 0.15, p.x, p.y, r);
    g.addColorStop(0, 'rgba(18,28,38,' + shadowAlpha.toFixed(3) + ')');
    g.addColorStop(0.7, 'rgba(18,28,38,' + (shadowAlpha * 0.56).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(18,28,38,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, 0.42);
    ctx.translate(-p.x, -p.y);
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    ctx.restore();
  }
};

EW.drawParcel = function (ctx, cam, viewW, viewH, parcel) {
  var p = EW.project(cam, viewW, viewH, parcel.x, parcel.y, parcel.z);
  if (!p) return;
  var s = EW.clamp(300 / p.d, 2, 18);
  ctx.fillStyle = '#b98a4e';
  ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  ctx.strokeStyle = '#7a5a30';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
  ctx.beginPath();
  ctx.moveTo(p.x - s / 2, p.y);
  ctx.lineTo(p.x + s / 2, p.y);
  ctx.moveTo(p.x, p.y - s / 2);
  ctx.lineTo(p.x, p.y + s / 2);
  ctx.stroke();
};

// The headland lighthouse: a banded tapered tower with a lamp room.
// Drawn in screen space from the projected base/top so it stays cheap.
function drawLighthouse(ctx, cam, viewW, viewH, lh, palette, dist) {
  var base = EW.project(cam, viewW, viewH, lh.x, lh.y, lh.z);
  var top = EW.project(cam, viewW, viewH, lh.x, lh.y, lh.z + lh.h);
  if (!base || !top) return;
  var w0 = (3.4 * cam.focal) / base.d;
  var w1 = (2.1 * cam.focal) / top.d;
  if (w0 < 1.2) return;
  var bands = [
    [0.0, 0.38, [232, 228, 218]],
    [0.38, 0.62, [196, 52, 44]],
    [0.62, 1.0, [232, 228, 218]],
  ];
  bands.forEach(function (band) {
    var yA = EW.lerp(base.y, top.y, band[0]);
    var yB = EW.lerp(base.y, top.y, band[1]);
    var wA = EW.lerp(w0, w1, band[0]);
    var wB = EW.lerp(w0, w1, band[1]);
    ctx.beginPath();
    ctx.moveTo(base.x - wA / 2, yA);
    ctx.lineTo(base.x + wA / 2, yA);
    ctx.lineTo(top.x + wB / 2, yB);
    ctx.lineTo(top.x - wB / 2, yB);
    ctx.closePath();
    ctx.fillStyle = EW.cssColor(fogMix(palette, EW.shadeColor(band[2], palette.ambient + 0.08), dist));
    ctx.fill();
  });
  // Lamp room: dark cap with a bright lamp window.
  var lampH = Math.max(2, (top.y - base.y) * -0.12);
  ctx.fillStyle = EW.cssColor(fogMix(palette, [36, 40, 50], dist));
  ctx.fillRect(top.x - w1 * 0.62, top.y - lampH, w1 * 1.24, lampH);
  ctx.fillStyle = palette.stars ? '#ffedb8' : '#d8d8c8';
  ctx.fillRect(top.x - w1 * 0.3, top.y - lampH * 0.78, w1 * 0.6, lampH * 0.5);
}

// The rotating beam, drawn in the translucent pass at dusk/night/storm.
function drawLighthouseBeam(ctx, cam, viewW, viewH, world, time) {
  var lh = world.lighthouse;
  var pal = world.palette;
  if (!lh) return;
  var dark = pal.stars || world.course.palette === 'dusk' || pal.rain;
  if (!dark) return;
  var lampZ = lh.z + lh.h + 1.5;
  var p = EW.project(cam, viewW, viewH, lh.x, lh.y, lampZ);
  if (!p) return;
  var ang = time * 0.55;
  var len = 520;
  var e = EW.project(cam, viewW, viewH,
    lh.x + Math.sin(ang) * len, lh.y + Math.cos(ang) * len, lampZ - 7);
  if (e) {
    var wEnd = EW.clamp((34 * cam.focal) / e.d, 4, 64);
    var dx = e.x - p.x;
    var dy = e.y - p.y;
    var dl = Math.sqrt(dx * dx + dy * dy) || 1;
    var px = (-dy / dl) * wEnd;
    var py = (dx / dl) * wEnd;
    var g = ctx.createLinearGradient(p.x, p.y, e.x, e.y);
    g.addColorStop(0, 'rgba(255,240,190,0.32)');
    g.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(e.x + px, e.y + py);
    ctx.lineTo(e.x - px, e.y - py);
    ctx.closePath();
    ctx.fill();
  }
  var rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 17);
  rg.addColorStop(0, 'rgba(255,244,200,0.95)');
  rg.addColorStop(1, 'rgba(255,244,200,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(p.x - 17, p.y - 17, 34, 34);
}

// Where a boat is at a given time: slow circles on open water.
function boatPos(boat, time) {
  var a = boat.phase + time * boat.speed;
  var sgn = boat.speed >= 0 ? 1 : -1;
  return {
    x: boat.cx + Math.cos(a) * boat.r,
    y: boat.cy + Math.sin(a) * boat.r,
    heading: Math.atan2(-Math.sin(a) * sgn, Math.cos(a) * sgn),
  };
}

function drawBoat(ctx, cam, viewW, viewH, boat, palette, dist, time) {
  var pos = boatPos(boat, time);
  var s = boat.s;
  var fx = Math.sin(pos.heading);
  var fy = Math.cos(pos.heading);
  var rx = fy;
  var ry = -fx;
  function P(along, across, z) {
    return EW.project(cam, viewW, viewH,
      pos.x + fx * along + rx * across, pos.y + fy * along + ry * across, z);
  }
  var bow = P(9 * s, 0, 1.1);
  var sternL = P(-7 * s, -3.1 * s, 1.1);
  var sternR = P(-7 * s, 3.1 * s, 1.1);
  var deckL = P(-6.4 * s, -2.5 * s, 2.4);
  var deckR = P(-6.4 * s, 2.5 * s, 2.4);
  var deckB = P(6.5 * s, 0, 2.4);
  if (!bow || !sternL || !sternR || !deckL || !deckR || !deckB) return;
  // Wake: a fading foam V astern.
  var wakeL = P(-46 * s, -9 * s, 0.3);
  var wakeR = P(-46 * s, 9 * s, 0.3);
  var wakeC = P(-52 * s, 0, 0.3);
  if (wakeL && wakeR && wakeC) {
    var wg = ctx.createLinearGradient(sternL.x, sternL.y, wakeC.x, wakeC.y);
    wg.addColorStop(0, 'rgba(240,248,252,0.4)');
    wg.addColorStop(1, 'rgba(240,248,252,0)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(sternL.x, sternL.y);
    ctx.lineTo(sternR.x, sternR.y);
    ctx.lineTo(wakeR.x, wakeR.y);
    ctx.lineTo(wakeC.x, wakeC.y);
    ctx.lineTo(wakeL.x, wakeL.y);
    ctx.closePath();
    ctx.fill();
  }
  var hullCol = EW.cssColor(fogMix(palette, EW.shadeColor([44, 58, 78], palette.ambient + 0.1), dist));
  var deckCol = EW.cssColor(fogMix(palette, EW.shadeColor([222, 216, 200], palette.ambient + 0.1), dist));
  ctx.fillStyle = hullCol;
  ctx.beginPath();
  ctx.moveTo(bow.x, bow.y);
  ctx.lineTo(sternR.x, sternR.y);
  ctx.lineTo(sternL.x, sternL.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = deckCol;
  ctx.beginPath();
  ctx.moveTo(deckB.x, deckB.y);
  ctx.lineTo(deckR.x, deckR.y);
  ctx.lineTo(deckL.x, deckL.y);
  ctx.closePath();
  ctx.fill();
  // Cabin block amidships.
  var cab = P(-1 * s, 0, 4.6);
  var cabBase = P(-1 * s, 0, 2.4);
  if (cab && cabBase) {
    var cw = EW.clamp((4.6 * s * cam.focal) / cab.d, 1.5, 40);
    ctx.fillStyle = EW.cssColor(fogMix(palette, EW.shadeColor([238, 234, 224], palette.ambient + 0.1), dist));
    ctx.fillRect(cab.x - cw / 2, cab.y, cw, cabBase.y - cab.y);
    ctx.fillStyle = EW.cssColor(fogMix(palette, EW.shadeColor([150, 70, 55], palette.ambient + 0.1), dist));
    ctx.fillRect(cab.x - cw * 0.62, cab.y - Math.max(1, cw * 0.14), cw * 1.24, Math.max(1, cw * 0.16));
  }
}

// A flock riding a thermal: dark silhouettes with flapping wings.
function drawBirds(ctx, cam, viewW, viewH, birds, palette, time) {
  if (!birds) return;
  ctx.strokeStyle = EW.cssColor(fogMix(palette, [26, 30, 38], 400), 0.85);
  ctx.lineCap = 'round';
  for (var i = 0; i < birds.count; i++) {
    var a = birds.phase + time * 0.12 + i * 0.38;
    var r = birds.r * (0.72 + 0.28 * Math.sin(i * 2.3));
    var x = birds.x + Math.cos(a) * r;
    var y = birds.y + Math.sin(a) * r;
    var z = birds.z + Math.sin(time * 0.5 + i * 1.3) * 9;
    var p = EW.project(cam, viewW, viewH, x, y, z);
    if (!p) continue;
    var size = EW.clamp((2.4 * cam.focal) / p.d, 1.4, 13);
    var flap = Math.sin(time * 7 + i * 1.7) * size * 0.55;
    ctx.lineWidth = Math.max(1, size * 0.22);
    ctx.beginPath();
    ctx.moveTo(p.x - size, p.y - flap);
    ctx.lineTo(p.x, p.y);
    ctx.lineTo(p.x + size, p.y - flap);
    ctx.stroke();
  }
}

// Draw the whole world (sky already drawn by the caller order below).
EW.drawWorld = function (ctx, game, viewW, viewH) {
  var world = game.world;
  var cam = game.cam;
  var pal = world.palette;
  EW.drawSky(ctx, viewW, viewH, world, cam, game.plane, game.time);
  EW.drawGround(ctx, world, cam, game.plane, viewW, viewH, game.time);
  EW.drawCloudShadows(ctx, world, cam, viewW, viewH);
  EW.drawRunway(ctx, world, cam, viewW, viewH, game.time);

  // Opaque scenery sorted far to near.
  var items = [];
  var i;
  for (i = 0; i < world.buildings.length; i++) {
    var b = world.buildings[i];
    items.push({ d: EW.dist2(b.x, b.y, cam.x, cam.y), kind: 'building', obj: b });
  }
  for (i = 0; i < world.trees.length; i++) {
    var t = world.trees[i];
    var td = EW.dist2(t.x, t.y, cam.x, cam.y);
    if (td < 1700) items.push({ d: td, kind: 'tree', obj: t });
  }
  for (i = 0; i < world.zones.length; i++) {
    var zn = world.zones[i];
    items.push({ d: EW.dist2(zn.x, zn.y, cam.x, cam.y), kind: 'zone', obj: zn });
  }
  if (world.lighthouse) {
    items.push({
      d: EW.dist2(world.lighthouse.x, world.lighthouse.y, cam.x, cam.y),
      kind: 'lighthouse', obj: world.lighthouse,
    });
  }
  for (i = 0; i < world.boats.length; i++) {
    var bp = boatPos(world.boats[i], game.time);
    items.push({ d: EW.dist2(bp.x, bp.y, cam.x, cam.y), kind: 'boat', obj: world.boats[i] });
  }
  if (world.birds) {
    items.push({
      d: EW.dist2(world.birds.x, world.birds.y, cam.x, cam.y),
      kind: 'birds', obj: world.birds,
    });
  }
  items.sort(function (a, b) { return b.d - a.d; });
  items.forEach(function (item) {
    if (item.kind === 'building') drawBox(ctx, cam, viewW, viewH, item.obj, pal, item.d);
    else if (item.kind === 'tree') drawTree(ctx, cam, viewW, viewH, item.obj, pal, item.d);
    else if (item.kind === 'lighthouse') drawLighthouse(ctx, cam, viewW, viewH, item.obj, pal, item.d);
    else if (item.kind === 'boat') drawBoat(ctx, cam, viewW, viewH, item.obj, pal, item.d, game.time);
    else if (item.kind === 'birds') drawBirds(ctx, cam, viewW, viewH, item.obj, pal, game.time);
    else drawZone(ctx, cam, viewW, viewH, item.obj, pal, game.time);
  });

  // Translucent things: rings, fuel cans, parcels, clouds, particles.
  world.rings.forEach(function (ring, idx) {
    var state = ring.passed ? 'passed' : idx === game.nextRing ? 'next' : 'later';
    drawRing(ctx, cam, viewW, viewH, ring, state, game.time, pal);
  });
  world.fuelCans.forEach(function (can) {
    if (!can.taken) drawFuelCan(ctx, cam, viewW, viewH, can, game.time);
  });
  game.parcels.forEach(function (parcel) {
    EW.drawParcel(ctx, cam, viewW, viewH, parcel);
  });
  var clouds = world.clouds
    .map(function (c) { return { c: c, d: EW.dist2(c.x, c.y, cam.x, cam.y) }; })
    .sort(function (a, b) { return b.d - a.d; });
  clouds.forEach(function (entry) {
    drawCloud(ctx, cam, viewW, viewH, entry.c, pal, game.time);
  });
  drawLighthouseBeam(ctx, cam, viewW, viewH, world, game.time);
  // Particles and shockwaves are drawn by EW.FX after the plane.
  if (pal.rain) EW.drawRain(ctx, viewW, viewH, world, cam, game.time);
};
