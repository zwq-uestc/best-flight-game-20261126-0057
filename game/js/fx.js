// fx.js — Emberwing Post's juice layer: a pooled particle system with
// pre-rendered soft sprites, shockwave rings, floating score popups,
// trauma-based screen shake, speed wind streaks, and the cinematic post
// pass (per-mission color grade, vignette, film grain, sun lens flare,
// cloud fly-through whiteout). Canvas 2D throughout; the pools are
// preallocated so the hot paths never allocate.

EW.FX = (function () {
  var PUFF = 0;
  var SPARK = 1;
  var DEBRIS = 2;
  var DROP = 3;

  // ------------------------------------------------------------ sprites

  var spriteCache = {};

  // Soft radial sprite for one color; `hard` (0..1) tightens the falloff.
  function spriteFor(color, hard) {
    var key = color + '|' + hard;
    var hit = spriteCache[key];
    if (hit) return hit;
    var c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
    var inner = 0.25 + hard * 0.55;
    grad.addColorStop(0, color);
    grad.addColorStop(inner, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    // Fade the rim by drawing the gradient through a second pass with
    // destination-out so the sprite edge is truly soft.
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.globalCompositeOperation = 'destination-out';
    var fade = g.createRadialGradient(32, 32, 20, 32, 32, 32);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 64, 64);
    spriteCache[key] = c;
    return c;
  }

  // ------------------------------------------------------------ particles

  var MAXP = 700;
  var pool = [];
  var active = 0;
  for (var pi = 0; pi < MAXP; pi++) {
    pool.push({
      kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1, size: 1, grow: 0, drag: 0, grav: 0,
      alpha: 1, sprite: null, rot: 0, vrot: 0, color: '#ffffff',
    });
  }

  function spawn(kind, x, y, z, vx, vy, vz, life, size, grow, sprite, alpha, drag, grav, color) {
    if (active >= MAXP) return null;
    var p = pool[active++];
    p.kind = kind;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.maxLife = life;
    p.size = size; p.grow = grow;
    p.sprite = sprite; p.alpha = alpha;
    p.drag = drag || 0; p.grav = grav || 0;
    p.color = color || '#ffffff';
    p.rot = Math.random() * EW.TAU;
    p.vrot = (Math.random() - 0.5) * 9;
    return p;
  }

  function killParticle(i) {
    active--;
    var t = pool[i];
    pool[i] = pool[active];
    pool[active] = t;
  }

  function stepParticles(dt, world) {
    for (var i = 0; i < active; i++) {
      var p = pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        killParticle(i);
        i--;
        continue;
      }
      var dragF = 1 - p.drag * dt;
      if (dragF < 0) dragF = 0;
      p.vx *= dragF;
      p.vy *= dragF;
      p.vz = p.vz * dragF + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      if (p.size < 0.05) p.size = 0.05;
      p.rot += p.vrot * dt;
      if (p.kind === DEBRIS && world) {
        var gz = Math.max(world.heightAt(p.x, p.y), 0) + 0.3;
        if (p.z < gz && p.vz < 0) {
          p.z = gz;
          p.vz = -p.vz * 0.35;
          p.vx *= 0.6;
          p.vy *= 0.6;
          p.vrot *= 0.5;
        }
      }
    }
  }

  function drawParticleSet(ctx, cam, viewW, viewH, additive) {
    for (var i = 0; i < active; i++) {
      var p = pool[i];
      var isSpark = p.kind === SPARK;
      if (isSpark !== additive) continue;
      var s = EW.project(cam, viewW, viewH, p.x, p.y, p.z);
      if (!s) continue;
      var px = EW.clamp((p.size * cam.focal) / s.d, 1, 110);
      var age = p.maxLife - p.life;
      var a = p.alpha * Math.min(age / 0.08, 1) * Math.min(p.life / (p.maxLife * 0.55), 1);
      if (a <= 0.004) continue;
      ctx.globalAlpha = a;
      if (p.kind === DEBRIS) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-px * 0.5, -px * 0.32, px, px * 0.64);
        ctx.restore();
      } else if (p.sprite) {
        ctx.drawImage(p.sprite, s.x - px, s.y - px, px * 2, px * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ waves

  var MAXW = 20;
  var waves = [];
  var waveCount = 0;
  for (var wi = 0; wi < MAXW; wi++) {
    waves.push({ x: 0, y: 0, z: 0, r: 0, maxR: 1, life: 0, maxLife: 1, color: '#ffffff', flat: true, nx: 0, ny: 1 });
  }

  function spawnWave(x, y, z, maxR, life, color, flat, nx, ny) {
    if (waveCount >= MAXW) return;
    var w = waves[waveCount++];
    w.x = x; w.y = y; w.z = z;
    w.r = maxR * 0.12; w.maxR = maxR;
    w.life = life; w.maxLife = life;
    w.color = color; w.flat = flat;
    w.nx = nx || 0; w.ny = ny || 1;
  }

  function stepWaves(dt) {
    for (var i = 0; i < waveCount; i++) {
      var w = waves[i];
      w.life -= dt;
      if (w.life <= 0) {
        waveCount--;
        var t = waves[i];
        waves[i] = waves[waveCount];
        waves[waveCount] = t;
        i--;
        continue;
      }
      var k = 1 - w.life / w.maxLife;
      w.r = w.maxR * (1 - Math.pow(1 - k, 2.4));
    }
  }

  function drawWaves(ctx, cam, viewW, viewH) {
    var segs = 28;
    for (var i = 0; i < waveCount; i++) {
      var w = waves[i];
      var center = EW.project(cam, viewW, viewH, w.x, w.y, w.z);
      if (!center) continue;
      var t = 1 - w.life / w.maxLife;
      ctx.beginPath();
      var started = false;
      var ok = true;
      for (var sIdx = 0; sIdx <= segs; sIdx++) {
        var a = (sIdx / segs) * EW.TAU;
        var px, py, pz;
        if (w.flat) {
          px = w.x + Math.cos(a) * w.r;
          py = w.y + Math.sin(a) * w.r;
          pz = w.z;
        } else {
          var ux = -w.ny;
          var uy = w.nx;
          px = w.x + ux * Math.cos(a) * w.r;
          py = w.y + uy * Math.cos(a) * w.r;
          pz = w.z + Math.sin(a) * w.r;
        }
        var p = EW.project(cam, viewW, viewH, px, py, pz);
        if (!p) { ok = false; break; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      if (!ok || !started) continue;
      ctx.closePath();
      ctx.strokeStyle = w.color;
      ctx.globalAlpha = (1 - t) * 0.75;
      ctx.lineWidth = EW.clamp(150 / center.d, 1, 5) * (1.2 - t * 0.7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ popups

  var MAXPOP = 24;
  var popups = [];
  var popCount = 0;
  for (var qi = 0; qi < MAXPOP; qi++) {
    popups.push({ x: 0, y: 0, z: 0, text: '', color: '#ffffff', life: 0, maxLife: 1, big: false });
  }

  function popup(x, y, z, text, color, big) {
    if (popCount >= MAXPOP) return;
    var p = popups[popCount++];
    p.x = x; p.y = y; p.z = z;
    p.text = text;
    p.color = color || '#ffd23e';
    p.life = 1.25; p.maxLife = 1.25;
    p.big = !!big;
  }

  function easeOutBack(t) {
    t = EW.clamp(t, 0, 1);
    var c = 1.70158;
    var u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }

  function stepPopups(dt) {
    for (var i = 0; i < popCount; i++) {
      var p = popups[i];
      p.life -= dt;
      p.z += dt * 2.4;
      if (p.life <= 0) {
        popCount--;
        var t = popups[i];
        popups[i] = popups[popCount];
        popups[popCount] = t;
        i--;
      }
    }
  }

  function drawPopups(ctx, cam, viewW, viewH) {
    ctx.textAlign = 'center';
    for (var i = 0; i < popCount; i++) {
      var p = popups[i];
      var s = EW.project(cam, viewW, viewH, p.x, p.y, p.z);
      if (!s) continue;
      var age = p.maxLife - p.life;
      var scale = easeOutBack(age / 0.22);
      var size = (p.big ? 30 : 21) * scale;
      if (size < 6) continue;
      var a = EW.clamp(p.life / 0.45, 0, 1);
      var y = s.y - age * 34;
      ctx.globalAlpha = a;
      ctx.font = 'bold ' + Math.round(size) + 'px Arial';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8,12,20,0.85)';
      ctx.strokeText(p.text, s.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, s.x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ streaks

  var MAXS = 48;
  var streaks = [];
  var streakCount = 0;
  for (var si2 = 0; si2 < MAXS; si2++) streaks.push({ ang: 0, r: 0, spd: 1 });
  var streakAcc = 0;

  function stepStreaks(dt, speedNorm, cloudFactor) {
    var want = speedNorm > 0.52 || cloudFactor > 0.25;
    if (want) {
      var rate = Math.max(0, speedNorm - 0.5) * 55 + cloudFactor * 26;
      streakAcc += rate * dt;
      while (streakAcc >= 1 && streakCount < MAXS) {
        streakAcc -= 1;
        var st = streaks[streakCount++];
        st.ang = Math.random() * EW.TAU;
        st.r = 30 + Math.random() * 110;
        st.spd = 0.7 + Math.random() * 0.7;
      }
      if (streakAcc > 4) streakAcc = 4;
    } else {
      streakAcc = 0;
    }
    for (var i = 0; i < streakCount; i++) {
      var s = streaks[i];
      s.r += (240 + speedNorm * 1150) * s.spd * dt * (0.45 + s.r / 520);
      if (s.r > 950) {
        streakCount--;
        var t = streaks[i];
        streaks[i] = streaks[streakCount];
        streaks[streakCount] = t;
        i--;
      }
    }
  }

  function drawStreaks(ctx, viewW, viewH, speedNorm, cloudFactor) {
    if (streakCount === 0) return;
    var cx = viewW / 2;
    var cy = viewH / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.4;
    for (var i = 0; i < streakCount; i++) {
      var s = streaks[i];
      var fade = 1 - s.r / 950;
      var a = (0.05 + speedNorm * 0.15 + cloudFactor * 0.12) * fade;
      if (a <= 0.005) continue;
      var len = 14 + speedNorm * 66 * (s.r / 520);
      var ca = Math.cos(s.ang);
      var sa = Math.sin(s.ang) * 0.62;
      ctx.strokeStyle = 'rgba(225,238,255,' + a + ')';
      ctx.beginPath();
      ctx.moveTo(cx + ca * s.r, cy + sa * s.r);
      ctx.lineTo(cx + ca * (s.r + len), cy + sa * (s.r + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ state

  var trauma = 0;
  var flash = 0;
  var hurt = 0;
  var lightning = 0; // current storm flash intensity 0..1
  var lightningT = -1; // seconds since the strike began, -1 when idle
  var nextStrike = 4 + Math.random() * 6;
  var enabled = true;
  var exAcc = 0;
  var washAcc = 0;
  var smokeAcc = 0;
  var volcAcc = 0;
  var prevBank = 0;
  var prevPitch = 0;

  // Wingtip vapor ribbons: two preallocated ring-buffer trails drawn as
  // fading line strips, so hard maneuvering leaves continuous white
  // streamers instead of detached puffs. No per-frame allocation.
  var VAPOR_POINTS = 40;
  var VAPOR_MAX_AGE = 0.85;

  function makeTrail() {
    var pts = [];
    for (var i = 0; i < VAPOR_POINTS; i++) {
      pts.push({ x: 0, y: 0, z: 0, age: 99, str: 0 });
    }
    return { pts: pts, head: 0, count: 0 };
  }

  var vaporL = makeTrail();
  var vaporR = makeTrail();

  function pushTrail(trail, x, y, z, str) {
    var p = trail.pts[trail.head];
    p.x = x;
    p.y = y;
    p.z = z;
    p.age = 0;
    p.str = str;
    trail.head = (trail.head + 1) % VAPOR_POINTS;
    if (trail.count < VAPOR_POINTS) trail.count++;
  }

  function ageTrail(trail, dt) {
    for (var i = 0; i < trail.count; i++) trail.pts[i].age += dt;
  }

  function clearTrail(trail) {
    trail.count = 0;
    trail.head = 0;
  }

  function lastTrailPoint(trail) {
    if (trail.count === 0) return null;
    return trail.pts[(trail.head - 1 + VAPOR_POINTS) % VAPOR_POINTS];
  }

  function drawVaporTrail(ctx, cam, viewW, viewH, trail) {
    if (trail.count < 2) return;
    var oldest = (trail.head - trail.count + VAPOR_POINTS) % VAPOR_POINTS;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var prev = null;
    for (var k = 0; k < trail.count; k++) {
      var p = trail.pts[(oldest + k) % VAPOR_POINTS];
      if (p.age > VAPOR_MAX_AGE) {
        prev = null;
        continue;
      }
      var s = EW.project(cam, viewW, viewH, p.x, p.y, p.z);
      if (!s) {
        prev = null;
        continue;
      }
      if (prev) {
        var t = 1 - p.age / VAPOR_MAX_AGE; // 1 at the fresh head
        var w = EW.clamp(((0.5 + 1.7 * (1 - t)) * cam.focal) / s.d, 0.6, 9);
        ctx.strokeStyle = 'rgba(246,250,255,' + (0.34 * p.str * t).toFixed(3) + ')';
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      prev = s;
    }
  }

  function addTrauma(x) {
    trauma = Math.min(1, trauma + x);
  }

  function reset() {
    active = 0;
    waveCount = 0;
    popCount = 0;
    streakCount = 0;
    trauma = 0;
    flash = 0;
    hurt = 0;
    lightning = 0;
    lightningT = -1;
    nextStrike = 4 + Math.random() * 6;
    exAcc = 0; washAcc = 0; smokeAcc = 0; volcAcc = 0; streakAcc = 0;
    clearTrail(vaporL);
    clearTrail(vaporR);
  }

  // ------------------------------------------------------------ emitters

  var EXHAUST_LOCAL = [0.38, 2.45, -0.48];
  var TIP_L = [-5.35, 0.59, 0.51];
  var TIP_R = [5.35, 0.59, 0.51];
  var NOSE_LOCAL = [0, 3.58, 0.1];
  var GEAR_LOCAL = [0, 0.9, -1.3];

  function jitter(amt) {
    return (Math.random() - 0.5) * 2 * amt;
  }

  function stepEmitters(dt, game) {
    var plane = game.plane;
    var world = game.world;
    if (!plane || !world) return;
    var pv = EW.planeVelocity(plane);
    var fwdX = Math.sin(plane.heading) * Math.cos(plane.pitch);
    var fwdY = Math.cos(plane.heading) * Math.cos(plane.pitch);
    var fwdZ = Math.sin(plane.pitch);
    var engineOn = !plane.dead && plane.fuel > 0;

    // Exhaust puffs, rate and size following the throttle.
    if (engineOn && (plane.airborne || plane.rolling || plane.speed > 2)) {
      exAcc += (5 + plane.throttle * 26) * dt;
      var exSprite = spriteFor('rgb(198,205,216)', 0.2);
      while (exAcc >= 1) {
        exAcc -= 1;
        var ep = EW.planeLocalToWorld(plane, EXHAUST_LOCAL[0], EXHAUST_LOCAL[1], EXHAUST_LOCAL[2]);
        spawn(PUFF,
          ep[0] + jitter(0.15), ep[1] + jitter(0.15), ep[2] + jitter(0.1),
          pv[0] * 0.8 - fwdX * 2.5 + jitter(0.7),
          pv[1] * 0.8 - fwdY * 2.5 + jitter(0.7),
          pv[2] * 0.8 - fwdZ * 2.5 + 0.4,
          0.55 + Math.random() * 0.4, 0.32 + plane.throttle * 0.22, 2.6,
          exSprite, 0.24 + plane.throttle * 0.08, 0.6, 0.5);
      }
    } else {
      exAcc = 0;
    }

    // Wingtip vapor under load: hard bank or fast attitude change.
    // Recorded into the ribbon trails every step while she pulls.
    var bankRate = dt > 0 ? (plane.bank - prevBank) / dt : 0;
    var pitchRate = dt > 0 ? (plane.pitch - prevPitch) / dt : 0;
    prevBank = plane.bank;
    prevPitch = plane.pitch;
    ageTrail(vaporL, dt);
    ageTrail(vaporR, dt);
    var load = Math.abs(plane.bank) * 1.15 + Math.abs(bankRate) * 0.3 + Math.abs(pitchRate) * 0.45;
    if (!plane.dead && plane.airborne && plane.speed > 20 && load > 0.55) {
      var str = EW.clamp((load - 0.55) / 0.9, 0.15, 1);
      var tpL = EW.planeLocalToWorld(plane, TIP_L[0], TIP_L[1], TIP_L[2]);
      var tpR = EW.planeLocalToWorld(plane, TIP_R[0], TIP_R[1], TIP_R[2]);
      // Teleport guard: a staged jump would smear the ribbon across
      // the map, so start fresh when the tip leaps.
      var lastL = lastTrailPoint(vaporL);
      if (lastL && EW.dist2(tpL[0], tpL[1], lastL.x, lastL.y) > 80) {
        clearTrail(vaporL);
        clearTrail(vaporR);
      }
      pushTrail(vaporL, tpL[0], tpL[1], tpL[2], str);
      pushTrail(vaporR, tpR[0], tpR[1], tpR[2], str);
    }

    // Prop wash: faint fast streaks streaming back off the disc.
    if (engineOn && plane.airborne && plane.throttle > 0.5) {
      washAcc += (plane.throttle - 0.5) * 40 * dt;
      var washSprite = spriteFor('rgb(222,230,242)', 0.15);
      while (washAcc >= 1) {
        washAcc -= 1;
        var ang = Math.random() * EW.TAU;
        var rr = 0.5 + Math.random() * 0.9;
        var wp = EW.planeLocalToWorld(plane, Math.cos(ang) * rr, 3.4, 0.1 + Math.sin(ang) * rr);
        spawn(PUFF, wp[0], wp[1], wp[2],
          pv[0] * 0.45 - fwdX * 7 + jitter(0.8),
          pv[1] * 0.45 - fwdY * 7 + jitter(0.8),
          pv[2] * 0.45 - fwdZ * 7 + jitter(0.8),
          0.38, 0.5, 3.2, washSprite, 0.1, 0.3, 0);
      }
    } else {
      washAcc = 0;
    }

    // Damage smoke, then flame flicker when the hull is nearly gone.
    if (!plane.dead && plane.hull < 55) {
      smokeAcc += (55 - plane.hull) * 0.85 * dt;
      var smokeSprite = spriteFor('rgb(66,68,78)', 0.2);
      var flameSprite = spriteFor('rgb(255,140,60)', 0.45);
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        spawn(PUFF, plane.x + jitter(0.4), plane.y + jitter(0.4), plane.z + 0.4,
          pv[0] * 0.6, pv[1] * 0.6, pv[2] * 0.6 + 1.6,
          1.2 + Math.random() * 0.5, 0.8, 2.4, smokeSprite, 0.42, 0.3, 1.2);
        if (plane.hull < 28 && Math.random() < 0.6) {
          spawn(SPARK, plane.x + jitter(0.3), plane.y + jitter(0.3), plane.z + 0.3,
            pv[0] * 0.5, pv[1] * 0.5, pv[2] * 0.5 + 1,
            0.3, 1.1, -1.2, flameSprite, 0.8, 0.4, 1.5);
        }
      }
    } else {
      smokeAcc = 0;
    }

    // Volcano plume drifting on the wind.
    volcAcc -= dt;
    if (volcAcc <= 0) {
      volcAcc = 0.35;
      var v = world.volcano;
      spawn(PUFF,
        v.x + jitter(15), v.y + jitter(15), v.h * 0.82,
        Math.sin(world.windDir) * world.windSpeed * 0.6,
        Math.cos(world.windDir) * world.windSpeed * 0.6, 7,
        5, 7, 3, spriteFor('rgb(138,143,152)', 0.15), 0.3, 0.05, 1.1);
    }

    // Parcel trails while they fall.
    var parcels = game.parcels || [];
    for (var i = 0; i < parcels.length; i++) {
      var parcel = parcels[i];
      if (parcel.landed) continue;
      parcel._fxT = (parcel._fxT || 0) + dt;
      if (parcel._fxT >= 0.06) {
        parcel._fxT = 0;
        spawn(PUFF, parcel.x, parcel.y, parcel.z + 0.4,
          parcel.vx * 0.3, parcel.vy * 0.3, parcel.vz * 0.2,
          0.45, 0.4, 1.6, spriteFor('rgb(232,220,200)', 0.25), 0.3, 0.5, 0);
      }
    }
  }

  // ------------------------------------------------------------ effects

  function puffBurst(x, y, z, count, color, speed, size, life, grav, alpha) {
    var sprite = spriteFor(color, 0.3);
    for (var i = 0; i < count; i++) {
      var a = Math.random() * EW.TAU;
      var b = Math.random() * Math.PI - Math.PI / 2;
      var s = speed * (0.35 + Math.random() * 0.85);
      spawn(PUFF, x, y, z,
        Math.cos(a) * Math.cos(b) * s, Math.sin(a) * Math.cos(b) * s, Math.sin(b) * s,
        life * (0.6 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), 1.4,
        sprite, alpha === undefined ? 0.85 : alpha, 0.4, grav || 0);
    }
  }

  function ringBurst(ring) {
    var gold = spriteFor('rgb(255,210,62)', 0.5);
    var white = spriteFor('rgb(255,246,210)', 0.55);
    var ux = -ring.ny;
    var uy = ring.nx;
    for (var i = 0; i < 26; i++) {
      var a = Math.random() * EW.TAU;
      var sp = 6 + Math.random() * 7;
      spawn(SPARK, ring.x, ring.y, ring.z,
        ux * Math.cos(a) * sp + ring.nx * jitter(2),
        uy * Math.cos(a) * sp + ring.ny * jitter(2),
        Math.sin(a) * sp,
        0.5 + Math.random() * 0.4, 0.55, -0.2, gold, 0.95, 1.2, -1);
    }
    for (var j = 0; j < 10; j++) {
      var a2 = Math.random() * EW.TAU;
      var sp2 = 3 + Math.random() * 4;
      spawn(SPARK, ring.x, ring.y, ring.z,
        ux * Math.cos(a2) * sp2, uy * Math.cos(a2) * sp2, Math.sin(a2) * sp2,
        0.7, 0.7, -0.2, white, 0.8, 1.0, 0);
    }
    spawnWave(ring.x, ring.y, ring.z, ring.r * 1.8, 0.55, '#ffd23e', false, ring.nx, ring.ny);
  }

  function explosion(x, y, z) {
    var fireA = spriteFor('rgb(255,120,40)', 0.4);
    var fireB = spriteFor('rgb(255,190,80)', 0.45);
    var spark = spriteFor('rgb(255,170,60)', 0.55);
    var smoke = spriteFor('rgb(70,72,80)', 0.18);
    for (var i = 0; i < 16; i++) {
      spawn(SPARK, x + jitter(1.2), y + jitter(1.2), z + jitter(1),
        jitter(5), jitter(5), jitter(4) + 2,
        0.5 + Math.random() * 0.35, 2.0 + Math.random() * 1.2, 5,
        i % 2 ? fireA : fireB, 0.9, 0.8, 1.5);
    }
    for (var j = 0; j < 36; j++) {
      var a = Math.random() * EW.TAU;
      var b = Math.random() * Math.PI - Math.PI / 2;
      var sp = 8 + Math.random() * 12;
      spawn(SPARK, x, y, z,
        Math.cos(a) * Math.cos(b) * sp, Math.sin(a) * Math.cos(b) * sp, Math.sin(b) * sp + 3,
        0.6 + Math.random() * 0.5, 0.5, -0.1, spark, 0.95, 0.6, -6);
    }
    for (var k = 0; k < 14; k++) {
      var a2 = Math.random() * EW.TAU;
      var sp2 = 5 + Math.random() * 9;
      spawn(DEBRIS, x, y, z,
        Math.cos(a2) * sp2, Math.sin(a2) * sp2, 4 + Math.random() * 7,
        1.4 + Math.random() * 0.8, 0.5 + Math.random() * 0.5, 0,
        null, 0.95, 0.15, -14, k % 3 === 0 ? '#8c3a2e' : '#3c3a36');
    }
    for (var m = 0; m < 14; m++) {
      spawn(PUFF, x + jitter(1.5), y + jitter(1.5), z + jitter(1),
        jitter(2.5), jitter(2.5), 3 + Math.random() * 3,
        2 + Math.random() * 1.5, 2, 3, smoke, 0.5, 0.25, 0.8);
    }
    spawnWave(x, y, z, 26, 0.4, '#ffb060', false, 0, 1);
    flash = Math.max(flash, 0.9);
  }

  function splash(x, y, z) {
    var drop = spriteFor('rgb(214,238,255)', 0.5);
    var mist = spriteFor('rgb(240,250,255)', 0.2);
    for (var i = 0; i < 30; i++) {
      var a = Math.random() * EW.TAU;
      var sp = 2 + Math.random() * 4.5;
      spawn(DROP, x + jitter(1), y + jitter(1), z + 0.3,
        Math.cos(a) * sp, Math.sin(a) * sp, 7 + Math.random() * 8,
        0.6 + Math.random() * 0.4, 0.35, 0, drop, 0.9, 0.1, -16);
    }
    for (var j = 0; j < 8; j++) {
      spawn(PUFF, x + jitter(2), y + jitter(2), z + 0.6,
        jitter(2), jitter(2), 1.5 + Math.random(),
        0.9, 1.2, 2.6, mist, 0.4, 0.4, 0.4);
    }
    spawnWave(x, y, z + 0.25, 30, 0.9, '#ebf8fc', true, 0, 1);
  }

  function landingDust(plane, strength) {
    var gp = EW.planeLocalToWorld(plane, GEAR_LOCAL[0], GEAR_LOCAL[1], GEAR_LOCAL[2]);
    var pv = EW.planeVelocity(plane);
    var dust = spriteFor('rgb(201,184,150)', 0.2);
    var count = Math.round(12 + 12 * strength);
    for (var i = 0; i < count; i++) {
      spawn(PUFF, gp[0] + jitter(1.2), gp[1] + jitter(1.2), gp[2] + 0.2,
        pv[0] * 0.3 + jitter(3.5), pv[1] * 0.3 + jitter(3.5), 0.6 + Math.random() * 1.2,
        0.8 + Math.random() * 0.4, 0.8, 3.2, dust, 0.42, 0.5, 0.3);
    }
    spawnWave(gp[0], gp[1], gp[2] + 0.15, 14 + 8 * strength, 0.6, '#c9b896', true, 0, 1);
  }

  function sparkle(x, y, z, color) {
    var sprite = spriteFor(color, 0.55);
    for (var i = 0; i < 12; i++) {
      var a = Math.random() * EW.TAU;
      var sp = 1 + Math.random() * 2.5;
      spawn(SPARK, x + jitter(0.8), y + jitter(0.8), z + jitter(0.8),
        Math.cos(a) * sp, Math.sin(a) * sp, 2 + Math.random() * 3,
        0.6 + Math.random() * 0.4, 0.42, -0.1, sprite, 0.95, 1.4, 0);
    }
  }

  function damageSparks(plane) {
    var sprite = spriteFor('rgb(255,176,58)', 0.55);
    for (var i = 0; i < 10; i++) {
      var a = Math.random() * EW.TAU;
      var sp = 4 + Math.random() * 5;
      spawn(SPARK, plane.x, plane.y, plane.z,
        Math.cos(a) * sp, Math.sin(a) * sp, jitter(3),
        0.45, 0.45, -0.1, sprite, 0.95, 0.5, -4);
    }
    hurt = Math.max(hurt, 0.55);
  }

  // ------------------------------------------------------------ cloud factor

  function computeCloudTarget(game) {
    var plane = game.plane;
    var world = game.world;
    if (!plane || !world) return 0;
    var best = 0;
    for (var i = 0; i < world.clouds.length; i++) {
      var c = world.clouds[i];
      var dh = EW.dist2(plane.x, plane.y, c.x, c.y);
      var dv = Math.abs(plane.z - c.z);
      var rh = c.s * 1.05;
      var rv = c.s * 0.55;
      if (dh < rh && dv < rv) {
        var f = (1 - dh / rh) * (1 - dv / rv);
        if (f > best) best = f;
      }
    }
    return EW.clamp(best * 1.6, 0, 1);
  }

  // ------------------------------------------------------------ step

  function step(dt, game) {
    stepEmitters(dt, game);
    stepParticles(dt, game.world);
    stepWaves(dt);
    stepPopups(dt);
    var speedNorm = game.plane ? EW.clamp(game.plane.speed / 62, 0, 1) : 0;
    var target = computeCloudTarget(game);
    var cur = game.cloudFactor || 0;
    var rate = target > cur ? 3.5 : 1.4;
    game.cloudFactor = EW.clamp(cur + (target - cur) * Math.min(1, dt * rate), 0, 1);
    stepStreaks(dt, speedNorm, game.cloudFactor);
    trauma = Math.max(0, trauma - dt * 1.5);
    flash = Math.max(0, flash - dt * 3.5);
    hurt = Math.max(0, hurt - dt * 1.8);
    // Distant lightning in the storm (round 4): an occasional
    // double-pulse ambient flash every 5–14 seconds. Visual only;
    // thunder can join in the sound round.
    if (game.world && game.world.palette.rain) {
      if (lightningT < 0) {
        nextStrike -= dt;
        if (nextStrike <= 0) {
          lightningT = 0;
          nextStrike = 5 + Math.random() * 9;
        }
      } else {
        lightningT += dt;
        var lt = lightningT;
        lightning = lt < 0.08 ? lt / 0.08
          : lt < 0.14 ? 1 - (lt - 0.08) / 0.06 * 0.7
          : lt < 0.2 ? 0.3 + (lt - 0.14) / 0.06 * 0.55
          : Math.max(0, 0.85 - (lt - 0.2) * 2.6);
        if (lt > 0.55) {
          lightningT = -1;
          lightning = 0;
        }
      }
    } else {
      lightning = 0;
      lightningT = -1;
    }
  }

  // ------------------------------------------------------------ shake

  function applyShake(ctx, viewW, viewH, time) {
    if (trauma <= 0.005) return;
    var sh = trauma * trauma;
    var ox = sh * 17 * (Math.sin(time * 47.3) + Math.sin(time * 31.7) * 0.6) / 1.6;
    var oy = sh * 15 * (Math.sin(time * 39.1 + 2.0) + Math.sin(time * 53.9) * 0.6) / 1.6;
    var rot = sh * 0.021 * Math.sin(time * 43.7 + 0.7);
    ctx.translate(viewW / 2 + ox, viewH / 2 + oy);
    ctx.rotate(rot);
    ctx.translate(-viewW / 2, -viewH / 2);
  }

  // ------------------------------------------------------------ post

  var GRADES = {
    dawn: { overlay: '#ffa658', overlayA: 0.13, soft: '#465aa0', softA: 0.10, sat: 0, vig: 0.30, grain: 0.42, whiteout: [242, 222, 200] },
    day: { overlay: '#fff6e0', overlayA: 0.05, soft: null, softA: 0, sat: 0, vig: 0.24, grain: 0.34, whiteout: [246, 250, 255] },
    dusk: { overlay: '#ff7a3c', overlayA: 0.15, soft: '#5a2850', softA: 0.10, sat: 0, vig: 0.34, grain: 0.46, whiteout: [246, 216, 196] },
    storm: { overlay: '#7d8ea3', overlayA: 0.12, soft: null, softA: 0, sat: 0.38, vig: 0.42, grain: 0.68, whiteout: [216, 223, 231] },
    night: { overlay: '#3250aa', overlayA: 0.13, soft: '#0a1028', softA: 0.12, sat: 0, vig: 0.38, grain: 0.56, whiteout: [122, 142, 182] },
  };

  var vignetteCanvas = null;
  var hurtCanvas = null;
  var grainTiles = [];
  var grainPatterns = [];
  var grainFrame = 0;

  function makeVignette(viewW, viewH, inner, outer) {
    var c = document.createElement('canvas');
    c.width = viewW;
    c.height = viewH;
    var g = c.getContext('2d');
    var r = Math.sqrt(viewW * viewW + viewH * viewH) / 2;
    var grad = g.createRadialGradient(viewW / 2, viewH / 2, r * 0.42, viewW / 2, viewH / 2, r);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.62, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, viewW, viewH);
    return c;
  }

  function makeGrainTile() {
    var c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    var g = c.getContext('2d');
    var img = g.createImageData(256, 256);
    var data = img.data;
    for (var i = 0; i < data.length; i += 4) {
      var v = Math.random() < 0.5 ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 6 + Math.random() * 13;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function ensurePostAssets(ctx, viewW, viewH) {
    if (!vignetteCanvas) {
      vignetteCanvas = makeVignette(viewW, viewH, 'rgba(5,8,14,0)', 'rgba(5,8,14,0.88)');
      hurtCanvas = makeVignette(viewW, viewH, 'rgba(180,30,20,0)', 'rgba(180,30,20,0.8)');
    }
    if (grainTiles.length === 0) {
      for (var i = 0; i < 4; i++) {
        var tile = makeGrainTile();
        grainTiles.push(tile);
        grainPatterns.push(ctx.createPattern(tile, 'repeat'));
      }
    }
  }

  function drawFlare(ctx, game, viewW, viewH) {
    var pal = game.world.palette;
    if (pal.stars || pal.rain) return;
    var cam = game.cam;
    var sunDir = {
      x: Math.sin(pal.sunAz) * Math.cos(pal.sunEl),
      y: Math.cos(pal.sunAz) * Math.cos(pal.sunEl),
      z: Math.sin(pal.sunEl),
    };
    var sp = EW.project(cam, viewW, viewH,
      cam.x + sunDir.x * 900, cam.y + sunDir.y * 900, cam.z + sunDir.z * 900);
    if (!sp) return;
    if (sp.x < -160 || sp.x > viewW + 160 || sp.y < -160 || sp.y > viewH + 160) return;
    var cx = viewW / 2;
    var cy = viewH / 2;
    var distC = Math.sqrt((sp.x - cx) * (sp.x - cx) + (sp.y - cy) * (sp.y - cy));
    var maxD = Math.sqrt(cx * cx + cy * cy) + 160;
    var intensity = EW.clamp(1 - distC / maxD, 0, 1);
    intensity *= pal.sunEl < 0.35 ? 1 : 0.7;
    if (intensity <= 0.03) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Anamorphic horizontal streak through the sun.
    var streakW = viewW * 0.85;
    var streak = ctx.createLinearGradient(sp.x - streakW / 2, 0, sp.x + streakW / 2, 0);
    streak.addColorStop(0, EW.cssColor(pal.sun, 0));
    streak.addColorStop(0.5, EW.cssColor(pal.sun, 0.22 * intensity));
    streak.addColorStop(1, EW.cssColor(pal.sun, 0));
    ctx.fillStyle = streak;
    ctx.fillRect(sp.x - streakW / 2, sp.y - 3, streakW, 6);
    // Core glow.
    var core = ctx.createRadialGradient(sp.x, sp.y, 2, sp.x, sp.y, 130);
    core.addColorStop(0, EW.cssColor(pal.sun, 0.3 * intensity));
    core.addColorStop(1, EW.cssColor(pal.sun, 0));
    ctx.fillStyle = core;
    ctx.fillRect(sp.x - 130, sp.y - 130, 260, 260);
    // Ghost orbs along the sun-to-center axis.
    var ghosts = [
      { t: 0.55, r: 16, a: 0.10 },
      { t: 1.05, r: 30, a: 0.07 },
      { t: 1.5, r: 11, a: 0.12 },
    ];
    for (var i = 0; i < ghosts.length; i++) {
      var gh = ghosts[i];
      var gx = cx + (cx - sp.x) * gh.t;
      var gy = cy + (cy - sp.y) * gh.t;
      var gg = ctx.createRadialGradient(gx, gy, 1, gx, gy, gh.r);
      gg.addColorStop(0, EW.cssColor(pal.sun, gh.a * intensity));
      gg.addColorStop(0.8, EW.cssColor(pal.sun, gh.a * 0.4 * intensity));
      gg.addColorStop(1, EW.cssColor(pal.sun, 0));
      ctx.fillStyle = gg;
      ctx.fillRect(gx - gh.r, gy - gh.r, gh.r * 2, gh.r * 2);
    }
    ctx.restore();
  }

  function drawPost(ctx, game, viewW, viewH) {
    ensurePostAssets(ctx, viewW, viewH);
    var speedNorm = game.plane ? EW.clamp(game.plane.speed / 62, 0, 1) : 0;
    if (enabled) {
      var grade = GRADES[game.world.course.palette] || GRADES.day;
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = grade.overlayA;
      ctx.fillStyle = grade.overlay;
      ctx.fillRect(0, 0, viewW, viewH);
      if (grade.sat > 0) {
        ctx.globalCompositeOperation = 'saturation';
        ctx.globalAlpha = grade.sat;
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, viewW, viewH);
      }
      if (grade.soft) {
        ctx.globalCompositeOperation = 'soft-light';
        ctx.globalAlpha = grade.softA;
        ctx.fillStyle = grade.soft;
        ctx.fillRect(0, 0, viewW, viewH);
      }
      ctx.restore();

      drawFlare(ctx, game, viewW, viewH);
      drawStreaks(ctx, viewW, viewH, speedNorm, game.cloudFactor || 0);

      // Cloud fly-through whiteout, tinted per mission.
      var cf = game.cloudFactor || 0;
      if (cf > 0.01) {
        ctx.fillStyle = EW.cssColor(grade.whiteout, cf * 0.92);
        ctx.fillRect(0, 0, viewW, viewH);
      }

      // Vignette, deepening with speed for the motion feel.
      ctx.globalAlpha = grade.vig + speedNorm * 0.17;
      ctx.drawImage(vignetteCanvas, 0, 0);
      ctx.globalAlpha = 1;

      // Film grain: cycled noise tiles at a random offset.
      grainFrame++;
      var pattern = grainPatterns[grainFrame % grainPatterns.length];
      if (pattern) {
        ctx.save();
        ctx.globalAlpha = grade.grain;
        ctx.translate(-(Math.random() * 256 | 0), -(Math.random() * 256 | 0));
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, viewW + 256, viewH + 256);
        ctx.restore();
      }
    }
    // Lightning brightens the whole sky for a beat (round 4).
    if (lightning > 0.01) {
      ctx.fillStyle = 'rgba(215,228,255,' + (lightning * 0.38).toFixed(3) + ')';
      ctx.fillRect(0, 0, viewW, viewH);
    }
    // Explosion flash and damage vignette are gameplay feedback: always on.
    if (flash > 0.01) {
      ctx.fillStyle = 'rgba(255,222,180,' + flash * 0.5 + ')';
      ctx.fillRect(0, 0, viewW, viewH);
    }
    var hurtA = hurt * 0.55;
    if (game.plane && !game.plane.dead && game.plane.hull < 25 && game.state === 'flying') {
      hurtA += 0.16 + 0.1 * Math.sin(game.time * 6);
    }
    if (hurtA > 0.01) {
      ctx.globalAlpha = EW.clamp(hurtA, 0, 0.8);
      ctx.drawImage(hurtCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ draw world fx

  function drawWorldFx(ctx, game, viewW, viewH) {
    drawWaves(ctx, game.cam, viewW, viewH);
    drawVaporTrail(ctx, game.cam, viewW, viewH, vaporL);
    drawVaporTrail(ctx, game.cam, viewW, viewH, vaporR);
    drawParticleSet(ctx, game.cam, viewW, viewH, false);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawParticleSet(ctx, game.cam, viewW, viewH, true);
    ctx.restore();
  }

  // ------------------------------------------------------------ public API

  return {
    reset: reset,
    step: step,
    drawWorldFx: drawWorldFx,
    drawPost: drawPost,
    drawPopups: function (ctx, game, viewW, viewH) {
      drawPopups(ctx, game.cam, viewW, viewH);
    },
    applyShake: applyShake,
    addTrauma: addTrauma,
    popup: popup,
    puffBurst: puffBurst,
    ringBurst: ringBurst,
    explosion: explosion,
    splash: splash,
    landingDust: landingDust,
    sparkle: sparkle,
    damageSparks: damageSparks,
    setEnabled: function (b) { enabled = !!b; },
    isEnabled: function () { return enabled; },
    lightningLevel: function () { return lightning; },
    strikeNow: function () { lightningT = 0; },
    activeParticles: function () { return active; },
    vaporPoints: function () { return vaporL.count + vaporR.count; },
  };
})();
