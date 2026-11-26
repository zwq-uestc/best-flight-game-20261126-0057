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
EW.updateCamera = function (cam, plane, dt, viewH) {
  var fx = Math.sin(plane.heading);
  var fy = Math.cos(plane.heading);
  var wantX = plane.x - fx * 14;
  var wantY = plane.y - fy * 14;
  var wantZ = plane.z + 3.6 - plane.pitch * 5;
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
  var lookX = plane.x + fx * 26;
  var lookY = plane.y + fy * 26;
  var lookZ = plane.z + 0.9 + plane.pitch * 10;
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
  cam.focal = viewH / 2 / Math.tan((68 * EW.DEG) / 2);
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
  var t = EW.smoothstep(320, palette.fogFar, dist);
  return EW.mixColor(color, palette.fog, t);
}

// --------------------------------------------------------------- sky

EW.drawSky = function (ctx, viewW, viewH, world, cam, plane, time) {
  var pal = world.palette;
  var horizonY = viewH * 0.52 - cam.fz * viewH * 0.9;
  var bands = 26;
  for (var i = 0; i < bands; i++) {
    var t0 = i / bands;
    var y0 = t0 * horizonY;
    var y1 = ((i + 1) / bands) * horizonY + 1;
    var c = t0 < 0.55
      ? EW.mixColor(pal.skyTop, pal.skyMid, t0 / 0.55)
      : EW.mixColor(pal.skyMid, pal.skyHorizon, (t0 - 0.55) / 0.45);
    ctx.fillStyle = EW.cssColor(c);
    ctx.fillRect(0, y0, viewW, y1 - y0);
  }
  ctx.fillStyle = EW.cssColor(pal.fog);
  ctx.fillRect(0, horizonY, viewW, viewH - horizonY);

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

  // Sun (or moon at night): a disc placed by azimuth/elevation.
  var sunDir = {
    x: Math.sin(pal.sunAz) * Math.cos(pal.sunEl),
    y: Math.cos(pal.sunAz) * Math.cos(pal.sunEl),
    z: Math.sin(pal.sunEl),
  };
  var sp = EW.project(cam, viewW, viewH, cam.x + sunDir.x * 900, cam.y + sunDir.y * 900, cam.z + sunDir.z * 900);
  if (sp) {
    var glow = ctx.createRadialGradient(sp.x, sp.y, 4, sp.x, sp.y, 130);
    glow.addColorStop(0, EW.cssColor(pal.sun, pal.stars ? 0.35 : 0.55));
    glow.addColorStop(1, EW.cssColor(pal.sun, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(sp.x - 130, sp.y - 130, 260, 260);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, pal.stars ? 17 : 26, 0, EW.TAU);
    ctx.fillStyle = EW.cssColor(pal.sun);
    ctx.fill();
    if (pal.stars) {
      ctx.beginPath();
      ctx.arc(sp.x + 7, sp.y - 4, 14, 0, EW.TAU);
      ctx.fillStyle = EW.cssColor(pal.skyMid);
      ctx.fill();
    }
  }
};

EW.drawRain = function (ctx, viewW, viewH, time, windSpeed) {
  ctx.strokeStyle = 'rgba(190,205,225,0.28)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  var slant = 4 + windSpeed * 0.9;
  for (var i = 0; i < 110; i++) {
    var seed = i * 137.5;
    var x = ((seed * 7.3 + time * 60 * slant) % (viewW + 60)) - 30;
    var y = ((seed * 3.1 + time * 620) % (viewH + 40)) - 20;
    ctx.moveTo(x, y);
    ctx.lineTo(x - slant, y + 13);
  }
  ctx.stroke();
};

// --------------------------------------------------------------- ground

var gridHeights = new Float32Array(64 * 64);

EW.drawGround = function (ctx, world, cam, plane, viewW, viewH, time) {
  var pal = world.palette;
  var cell = 66;
  var half = 20; // 41 x 41 cells
  var n = half * 2 + 1;
  var originX = Math.round(plane.x / cell) * cell - half * cell;
  var originY = Math.round(plane.y / cell) * cell - half * cell;
  var i, j;
  for (j = 0; j < n; j++) {
    for (i = 0; i < n; i++) {
      gridHeights[j * n + i] = world.heightAt(originX + i * cell, originY + j * cell);
    }
  }
  var sunX = Math.sin(pal.sunAz);
  var sunY = Math.cos(pal.sunAz);
  var quads = [];
  for (j = 0; j < n - 1; j++) {
    for (i = 0; i < n - 1; i++) {
      var x0 = originX + i * cell;
      var y0 = originY + j * cell;
      var h00 = gridHeights[j * n + i];
      var h10 = gridHeights[j * n + i + 1];
      var h01 = gridHeights[(j + 1) * n + i];
      var h11 = gridHeights[(j + 1) * n + i + 1];
      var cx = x0 + cell / 2;
      var cy = y0 + cell / 2;
      var distC = EW.dist2(cx, cy, cam.x, cam.y);
      if (distC > pal.fogFar + 500) continue;
      var avg = (h00 + h10 + h01 + h11) / 4;
      var isWater = avg < 0.1;
      var z00 = isWater ? 0 : h00;
      var z10 = isWater ? 0 : h10;
      var z01 = isWater ? 0 : h01;
      var z11 = isWater ? 0 : h11;
      var p00 = EW.project(cam, viewW, viewH, x0, y0, z00);
      var p10 = EW.project(cam, viewW, viewH, x0 + cell, y0, z10);
      var p01 = EW.project(cam, viewW, viewH, x0, y0 + cell, z01);
      var p11 = EW.project(cam, viewW, viewH, x0 + cell, y0 + cell, z11);
      if (!p00 && !p10 && !p01 && !p11) continue;
      var depth = 0;
      var cnt = 0;
      var pts = [p00, p10, p11, p01];
      for (var q = 0; q < 4; q++) {
        if (pts[q]) {
          depth += pts[q].d;
          cnt++;
        }
      }
      if (cnt === 0) continue;
      depth /= cnt;
      var color;
      if (isWater) {
        var shimmer = 0.94 + 0.1 * Math.sin(time * 1.6 + (i * 3 + j * 7) * 0.7);
        color = EW.shadeColor(pal.water, shimmer * pal.ambient + 0.12);
      } else {
        if (avg < 1.6) color = pal.sand;
        else if (avg < 42) color = EW.mixColor(pal.grassLow, pal.grassHigh, EW.smoothstep(2, 42, avg));
        else if (avg < 85) color = EW.mixColor(pal.grassHigh, pal.rock, EW.smoothstep(42, 85, avg));
        else color = EW.mixColor(pal.rock, pal.snow, EW.smoothstep(95, 145, avg));
        var slope = Math.max(Math.abs(h10 - h00), Math.abs(h01 - h00), Math.abs(h11 - h00));
        if (slope > 13 && avg >= 1.6) color = EW.mixColor(color, pal.rock, EW.clamp((slope - 13) / 30, 0, 0.8));
        var gradX = (h10 - h00) / cell;
        var gradY = (h01 - h00) / cell;
        var light = 0.82 + 0.35 * EW.clamp(-(gradX * sunX + gradY * sunY), -1, 1);
        var jitter = 0.96 + 0.08 * ((((i * 73856093) ^ (j * 19349663)) >>> 0) % 100) / 100;
        color = EW.shadeColor(color, (light * pal.ambient + 0.08) * jitter);
      }
      quads.push({ pts: pts, depth: depth, color: fogMix(pal, color, distC) });
    }
  }
  quads.sort(function (a, b) { return b.depth - a.depth; });
  for (var k = 0; k < quads.length; k++) {
    var quad = quads[k];
    ctx.beginPath();
    var started = false;
    for (var m = 0; m < 4; m++) {
      var p = quad.pts[m];
      if (!p) continue;
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    if (!started) continue;
    ctx.closePath();
    ctx.fillStyle = EW.cssColor(quad.color);
    ctx.fill();
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
  // edge lights (glow at night and dusk)
  var night = pal.stars || world.course.palette === 'dusk';
  for (var e = -hl; e <= hl; e += 20) {
    [-hw - 1.2, hw + 1.2].forEach(function (side) {
      var p = P(e, side, 0.6);
      if (!p) return;
      if (night) {
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 9);
        g.addColorStop(0, 'rgba(255,220,150,0.9)');
        g.addColorStop(1, 'rgba(255,220,150,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - 9, p.y - 9, 18, 18);
      }
      ctx.fillStyle = night ? '#ffe2a0' : '#d8d8d0';
      ctx.fillRect(p.x - 1.4, p.y - 1.4, 2.8, 2.8);
    });
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
}

function drawTree(ctx, cam, viewW, viewH, tree, palette, dist) {
  var base = EW.project(cam, viewW, viewH, tree.x, tree.y, tree.z);
  var top = EW.project(cam, viewW, viewH, tree.x, tree.y, tree.z + 10 * tree.s);
  if (!base || !top) return;
  var w = (3.4 * tree.s * cam.focal) / base.d;
  if (w < 0.7) return;
  var green = EW.mixColor([34, 84, 44], [58, 116, 58], tree.tone);
  green = fogMix(palette, EW.shadeColor(green, palette.ambient + 0.1), dist);
  ctx.fillStyle = EW.cssColor(fogMix(palette, [92, 66, 44], dist));
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
  var pts = [];
  var segs = 28;
  for (var i = 0; i < segs; i++) {
    var a = (i / segs) * EW.TAU;
    var x = ring.x + ux * Math.cos(a) * ring.r;
    var y = ring.y + uy * Math.cos(a) * ring.r;
    var z = ring.z + Math.sin(a) * ring.r;
    pts.push(EW.project(cam, viewW, viewH, x, y, z));
  }
  if (pts.some(function (p) { return !p; })) return;
  var center = EW.project(cam, viewW, viewH, ring.x, ring.y, ring.z);
  if (!center) return;
  var width = EW.clamp(190 / center.d, 2, 10);
  var color;
  var alpha;
  if (state === 'passed') {
    color = '#57e389';
    alpha = 0.5;
  } else if (state === 'next') {
    color = '#ffd23e';
    alpha = 0.85 + 0.15 * Math.sin(time * 4);
  } else {
    color = '#e8f2ff';
    alpha = 0.5;
  }
  ctx.beginPath();
  pts.forEach(function (p, k) {
    if (k === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha * 0.09;
  ctx.fill();
  ctx.globalAlpha = alpha;
  if (palette.stars && state === 'next') {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * 2.6;
    ctx.globalAlpha = 0.22;
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
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

function drawCloud(ctx, cam, viewW, viewH, cloud, palette) {
  var p = EW.project(cam, viewW, viewH, cloud.x, cloud.y, cloud.z);
  if (!p) return;
  var base = (cloud.s * cam.focal) / p.d;
  if (base < 4) return;
  var rng = EW.makeRng(Math.floor(cloud.seed * 1000) + 5);
  var col = palette.stars ? [46, 58, 88] : palette.rain ? [150, 158, 168] : [246, 248, 252];
  ctx.fillStyle = EW.cssColor(col, 0.72);
  for (var i = 0; i < cloud.puffs; i++) {
    var ox = (rng() - 0.5) * base * 1.7;
    var oy = (rng() - 0.5) * base * 0.34;
    var r = base * (0.42 + rng() * 0.3);
    ctx.beginPath();
    ctx.ellipse(p.x + ox, p.y + oy, r, r * 0.55, 0, 0, EW.TAU);
    ctx.fill();
  }
}

EW.drawParticles = function (ctx, cam, viewW, viewH, particles) {
  for (var i = 0; i < particles.length; i++) {
    var pt = particles[i];
    var p = EW.project(cam, viewW, viewH, pt.x, pt.y, pt.z);
    if (!p) continue;
    var s = EW.clamp((pt.size * cam.focal) / p.d, 1, 60);
    var lifeT = EW.clamp(pt.life / pt.maxLife, 0, 1);
    ctx.globalAlpha = lifeT * (pt.alpha || 0.8);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s, 0, EW.TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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

// Draw the whole world (sky already drawn by the caller order below).
EW.drawWorld = function (ctx, game, viewW, viewH) {
  var world = game.world;
  var cam = game.cam;
  var pal = world.palette;
  EW.drawSky(ctx, viewW, viewH, world, cam, game.plane, game.time);
  EW.drawGround(ctx, world, cam, game.plane, viewW, viewH, game.time);
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
  items.sort(function (a, b) { return b.d - a.d; });
  items.forEach(function (item) {
    if (item.kind === 'building') drawBox(ctx, cam, viewW, viewH, item.obj, pal, item.d);
    else if (item.kind === 'tree') drawTree(ctx, cam, viewW, viewH, item.obj, pal, item.d);
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
    drawCloud(ctx, cam, viewW, viewH, entry.c, pal);
  });
  EW.drawParticles(ctx, cam, viewW, viewH, game.particles);
  if (pal.rain) EW.drawRain(ctx, viewW, viewH, game.time, world.windSpeed);
};
