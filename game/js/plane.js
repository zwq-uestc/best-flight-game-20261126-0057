// plane.js — the Emberwing mail plane: its flight model (throttle, pitch,
// bank, stall, wind, fuel, ground handling, landings and crashes) and its
// little polygon airframe, drawn from the chase camera.

EW.FLIGHT = {
  stallSpeed: 17,
  maxSpeed: 62,
  maxAccel: 9.5,
  gearHeight: 1.6,
  gravity: 9.8,
};

EW.newPlane = function (world) {
  return {
    x: world.start.x,
    y: world.start.y,
    z: world.start.z,
    heading: world.start.heading,
    pitch: 0,
    bank: 0,
    speed: 34,
    throttle: 0.62,
    fuel: world.course.startFuel,
    hull: 100,
    airborne: true,
    stalled: false,
    rolling: false,
    stopped: false,
    dead: false,
    vspeed: 0,
    hitCooldown: 0,
    propAngle: 0,
    events: [],
  };
};

function pushEvent(plane, type, amount) {
  plane.events.push({ type: type, amount: amount || 0 });
}

// Advance the flight model one fixed step. input: {pitch, bank, throttleUp,
// throttleDown, brake} with pitch/bank in [-1, 1]. upgrades: {engine, tank,
// plating, wings} levels 0..3.
EW.stepFlight = function (plane, input, world, dt, upgrades, time) {
  if (plane.dead) return;
  var F = EW.FLIGHT;
  var engineF = 1 + upgrades.engine * 0.09;
  var tankF = 1 + upgrades.tank * 0.25;
  var wingF = 1 + upgrades.wings * 0.13;
  plane.hitCooldown = Math.max(0, plane.hitCooldown - dt);

  // --- throttle ---
  if (input.throttleUp) plane.throttle += 0.55 * dt;
  if (input.throttleDown) plane.throttle -= 0.65 * dt;
  plane.throttle = EW.clamp(plane.throttle, 0, 1);
  var engineOn = plane.fuel > 0;
  var power = engineOn ? plane.throttle : 0;

  // --- attitude ---
  var controlAuthority = plane.stalled ? 0.35 : 1;
  plane.pitch += input.pitch * 1.15 * dt * controlAuthority;
  if (plane.stalled) {
    plane.pitch = EW.lerp(plane.pitch, -0.42, Math.min(1, dt * 2.2));
  }
  plane.pitch = EW.clamp(plane.pitch, -0.62, 0.58);
  if (input.bank !== 0) {
    plane.bank += input.bank * 2.4 * dt * controlAuthority;
  } else {
    plane.bank = EW.lerp(plane.bank, 0, Math.min(1, dt * 2.6));
  }
  plane.bank = EW.clamp(plane.bank, -1.08, 1.08);
  if (plane.rolling) {
    plane.bank = EW.lerp(plane.bank, 0, Math.min(1, dt * 6));
    plane.pitch = EW.lerp(plane.pitch, 0, Math.min(1, dt * 6));
  }

  // --- speed: engine, drag, gravity along the flight path, brake ---
  var accel = power * F.maxAccel * engineF;
  accel -= plane.speed * 0.052 + plane.speed * plane.speed * 0.00155;
  accel -= F.gravity * Math.sin(plane.pitch) * 0.85;
  if (input.brake) accel -= 4.2;
  if (plane.rolling) accel -= plane.speed * 0.22 + 0.6;
  plane.speed = EW.clamp(plane.speed + accel * dt, 0, 96);
  plane.propAngle += dt * (4 + power * 46 + plane.speed * 0.22);

  // --- stall ---
  var wasStalled = plane.stalled;
  plane.stalled = plane.airborne && plane.speed < F.stallSpeed;
  if (plane.stalled && !wasStalled) pushEvent(plane, 'stall');

  // --- turn: banked flight turns the heading ---
  if (plane.airborne && plane.speed > 4) {
    var turnRate = (F.gravity * Math.tan(plane.bank) / Math.max(plane.speed, 13)) * wingF;
    plane.heading += EW.clamp(turnRate, -0.95, 0.95) * dt;
  } else if (plane.rolling && plane.speed > 2) {
    plane.heading += input.bank * 0.35 * dt * Math.min(1, plane.speed / 14);
  }

  // --- velocity, with wind and gusts ---
  var gustWave = 1 + world.gust * 0.55 * Math.sin(time * 0.9 + plane.x * 0.002) * Math.sin(time * 0.37 + 1.7);
  var windNow = world.windSpeed * gustWave;
  var windX = Math.sin(world.windDir) * windNow;
  var windY = Math.cos(world.windDir) * windNow;
  var horiz = plane.speed * Math.cos(plane.pitch);
  var vx = Math.sin(plane.heading) * horiz + windX;
  var vy = Math.cos(plane.heading) * horiz + windY;
  var vz = plane.speed * Math.sin(plane.pitch);
  plane.vspeed = vz;
  plane.x += vx * dt;
  plane.y += vy * dt;
  plane.z += vz * dt;

  // --- fuel burn ---
  if (engineOn && (plane.airborne || plane.rolling)) {
    plane.fuel -= ((0.1 + plane.throttle * 0.32) / tankF) * dt;
    if (plane.fuel <= 0) {
      plane.fuel = 0;
      pushEvent(plane, 'fuelEmpty');
    }
  }

  // --- ground contact ---
  var groundZ = world.heightAt(plane.x, plane.y);
  var floorZ = Math.max(groundZ, 0) + F.gearHeight;
  if (plane.z <= floorZ) {
    plane.z = floorZ;
    if (plane.airborne) {
      touchDown(plane, world, groundZ);
    } else if (plane.rolling) {
      if (plane.speed < 1.4 && !plane.stopped) {
        plane.stopped = true;
        plane.speed = 0;
        pushEvent(plane, 'stopped');
      }
      // takeoff roll: enough speed and a pull on the stick lifts her off
      if (plane.speed > 25 && input.pitch > 0.25 && plane.fuel > 0) {
        plane.airborne = true;
        plane.rolling = false;
        plane.stopped = false;
        plane.pitch = 0.16;
        pushEvent(plane, 'takeoff');
      }
    }
  } else if (plane.rolling && plane.z > floorZ + 0.4) {
    plane.rolling = false;
    plane.airborne = true;
  }

  // --- building collisions ---
  if (plane.airborne && plane.hitCooldown <= 0) {
    for (var i = 0; i < world.buildings.length; i++) {
      var b = world.buildings[i];
      if (plane.z < b.z + b.h + 2 && EW.dist2(plane.x, plane.y, b.x, b.y) < b.radius + 2) {
        damagePlane(plane, 26, upgrades);
        plane.hitCooldown = 1.2;
        plane.speed *= 0.62;
        plane.heading += 0.7;
        pushEvent(plane, 'buildingHit');
        break;
      }
    }
  }
};

function damagePlane(plane, amount, upgrades) {
  var scaled = amount / (1 + upgrades.plating * 0.25);
  plane.hull -= scaled;
  pushEvent(plane, 'damage', scaled);
  if (plane.hull <= 0) {
    plane.hull = 0;
    plane.dead = true;
    pushEvent(plane, 'destroyed');
  }
}
EW.damagePlane = damagePlane;

function touchDown(plane, world, groundZ) {
  var local = EW.runwayLocal(world, plane.x, plane.y);
  var rw = world.runway;
  var onRunway = Math.abs(local.along) <= rw.len / 2 + 8 && Math.abs(local.across) <= rw.width / 2 + 4;
  var aligned = Math.abs(EW.angleDelta(plane.heading, rw.heading)) < 0.45 ||
    Math.abs(EW.angleDelta(plane.heading, rw.heading + Math.PI)) < 0.45;
  var sink = -plane.vspeed;

  if (groundZ < 0.2) {
    // ditched in the sea
    plane.dead = true;
    pushEvent(plane, 'ditched');
    return;
  }
  if (onRunway && aligned && sink < 4.6 && plane.speed < 48 && plane.pitch > -0.2) {
    plane.airborne = false;
    plane.rolling = true;
    plane.stopped = false;
    var quality = sink < 1.6 ? 'smooth' : sink < 3 ? 'firm' : 'rough';
    if (quality === 'rough') {
      plane.hull -= 7;
      pushEvent(plane, 'damage', 7);
    }
    pushEvent(plane, 'touchdown', quality === 'smooth' ? 3 : quality === 'firm' ? 2 : 1);
    return;
  }
  if (sink < 2.3 && plane.speed < 30 && plane.pitch > -0.16) {
    // a rough field landing: survivable, costly, and she can leave again
    plane.airborne = false;
    plane.rolling = true;
    plane.stopped = false;
    plane.hull -= 16;
    pushEvent(plane, 'damage', 16);
    pushEvent(plane, 'fieldLanding');
    if (plane.hull <= 0) {
      plane.dead = true;
      pushEvent(plane, 'destroyed');
    }
    return;
  }
  plane.dead = true;
  pushEvent(plane, 'crashed');
}

// --------------------------------------------------------------- the airframe

// Local model: x right, y forward, z up, meters. Each part is a list of
// quads (4 local points) with a base color.
function planeParts() {
  var cream = [238, 228, 200];
  var red = [196, 52, 44];
  var dark = [40, 44, 54];
  var glass = [70, 120, 150];
  var parts = [];
  function quad(a, b, c, d, color) {
    parts.push({ pts: [a, b, c, d], color: color });
  }
  // fuselage: three cross-sections nose -> cabin -> tail
  var sec = [
    { y: 3.5, w: 0.42, h: 0.46, z: 0.1 },
    { y: 1.6, w: 0.55, h: 0.62, z: 0.12 },
    { y: -0.6, w: 0.5, h: 0.55, z: 0.16 },
    { y: -3.4, w: 0.16, h: 0.3, z: 0.3 },
  ];
  for (var s = 0; s < sec.length - 1; s++) {
    var A = sec[s];
    var B = sec[s + 1];
    var col = s === 0 ? red : cream;
    // top, right, bottom, left
    quad([-A.w, A.y, A.z + A.h], [A.w, A.y, A.z + A.h], [B.w, B.y, B.z + B.h], [-B.w, B.y, B.z + B.h], col);
    quad([A.w, A.y, A.z + A.h], [A.w, A.y, A.z - A.h], [B.w, B.y, B.z - B.h], [B.w, B.y, B.z + B.h], col);
    quad([A.w, A.y, A.z - A.h], [-A.w, A.y, A.z - A.h], [-B.w, B.y, B.z - B.h], [B.w, B.y, B.z - B.h], col);
    quad([-A.w, A.y, A.z - A.h], [-A.w, A.y, A.z + A.h], [-B.w, B.y, B.z + B.h], [-B.w, B.y, B.z - B.h], col);
  }
  // nose cap
  quad([-0.42, 3.5, 0.56], [0.42, 3.5, 0.56], [0.42, 3.5, -0.36], [-0.42, 3.5, -0.36], red);
  // canopy
  quad([-0.34, 1.7, 0.74], [0.34, 1.7, 0.74], [0.3, 0.4, 0.78], [-0.3, 0.4, 0.78], glass);
  quad([0.34, 1.7, 0.74], [0.34, 1.7, 0.35], [0.3, 0.4, 0.35], [0.3, 0.4, 0.78], glass);
  quad([-0.34, 1.7, 0.35], [-0.34, 1.7, 0.74], [-0.3, 0.4, 0.78], [-0.3, 0.4, 0.35], glass);
  // main wing with slight dihedral
  quad([-5.3, 1.15, 0.42], [0, 1.25, 0.2], [0, 0.1, 0.2], [-5.3, 0.0, 0.42], red);
  quad([0, 1.25, 0.2], [5.3, 1.15, 0.42], [5.3, 0.0, 0.42], [0, 0.1, 0.2], red);
  quad([-5.3, 0.0, 0.42], [0, 0.1, 0.2], [0, 0.1, 0.02], [-5.3, 0.0, 0.24], red);
  quad([0, 0.1, 0.2], [5.3, 0.0, 0.42], [5.3, 0.0, 0.24], [0, 0.1, 0.02], red);
  // tailplane + fin
  quad([-2.0, -3.1, 0.42], [2.0, -3.1, 0.42], [2.0, -3.85, 0.42], [-2.0, -3.85, 0.42], red);
  quad([0, -2.5, 0.45], [0, -3.9, 0.45], [0, -3.9, 1.55], [0, -3.1, 1.5], red);
  // gear legs + wheels
  quad([-1.1, 0.9, -0.4], [-0.9, 0.9, -0.4], [-0.9, 0.9, -1.15], [-1.1, 0.9, -1.15], dark);
  quad([0.9, 0.9, -0.4], [1.1, 0.9, -0.4], [1.1, 0.9, -1.15], [0.9, 0.9, -1.15], dark);
  quad([-1.25, 1.05, -1.15], [-0.75, 1.05, -1.15], [-0.75, 0.75, -1.55], [-1.25, 0.75, -1.55], dark);
  quad([0.75, 1.05, -1.15], [1.25, 1.05, -1.15], [1.25, 0.75, -1.55], [0.75, 0.75, -1.55], dark);
  return parts;
}

var cachedParts = null;

// Draw the plane (and its ground shadow) from the chase camera.
EW.drawPlane = function (ctx, cam, viewW, viewH, plane, world) {
  var pal = world.palette;
  // shadow on the ground below
  var groundZ = Math.max(world.heightAt(plane.x, plane.y), 0);
  var alt = plane.z - groundZ;
  if (alt < 260) {
    var sh = EW.project(cam, viewW, viewH, plane.x, plane.y, groundZ + 0.3);
    if (sh) {
      var sw = EW.clamp((11 * cam.focal) / sh.d, 2, 90);
      ctx.fillStyle = 'rgba(10,14,20,' + EW.clamp(0.34 - alt * 0.0011, 0.05, 0.34) + ')';
      ctx.beginPath();
      ctx.ellipse(sh.x, sh.y, sw, sw * 0.32, 0, 0, EW.TAU);
      ctx.fill();
    }
  }
  if (!cachedParts) cachedParts = planeParts();
  var ch = Math.cos(plane.heading);
  var sh2 = Math.sin(plane.heading);
  var cp = Math.cos(plane.pitch);
  var sp = Math.sin(plane.pitch);
  var cb = Math.cos(plane.bank);
  var sb = Math.sin(plane.bank);
  function toWorld(p) {
    // local (x right, y fwd, z up): roll about y, pitch about x, yaw about z
    var x1 = p[0] * cb + p[2] * sb;
    var z1 = -p[0] * sb + p[2] * cb;
    var y1 = p[1];
    var y2 = y1 * cp - z1 * sp;
    var z2 = y1 * sp + z1 * cp;
    var x2 = x1;
    var wx = plane.x + x2 * ch + y2 * sh2;
    var wy = plane.y - x2 * sh2 + y2 * ch;
    var wz = plane.z + z2;
    return [wx, wy, wz];
  }
  var sunX = Math.sin(pal.sunAz) * Math.cos(pal.sunEl);
  var sunY = Math.cos(pal.sunAz) * Math.cos(pal.sunEl);
  var sunZ = Math.sin(pal.sunEl);
  var faces = [];
  cachedParts.forEach(function (part) {
    var worldPts = part.pts.map(toWorld);
    var proj = worldPts.map(function (w) {
      return EW.project(cam, viewW, viewH, w[0], w[1], w[2]);
    });
    if (proj.some(function (p) { return !p; })) return;
    // face normal from the first three world points
    var ax = worldPts[1][0] - worldPts[0][0];
    var ay = worldPts[1][1] - worldPts[0][1];
    var az = worldPts[1][2] - worldPts[0][2];
    var bx = worldPts[2][0] - worldPts[0][0];
    var by = worldPts[2][1] - worldPts[0][1];
    var bz = worldPts[2][2] - worldPts[0][2];
    var nx = ay * bz - az * by;
    var ny = az * bx - ax * bz;
    var nz = ax * by - ay * bx;
    var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    var light = 0.62 + 0.5 * Math.abs((nx * sunX + ny * sunY + nz * sunZ) / nl);
    var depth = 0;
    proj.forEach(function (p) { depth += p.d; });
    faces.push({ proj: proj, color: EW.shadeColor(part.color, light * pal.ambient + 0.18), depth: depth / proj.length });
  });
  faces.sort(function (a, b) { return b.depth - a.depth; });
  faces.forEach(function (f) {
    ctx.beginPath();
    f.proj.forEach(function (p, k) {
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = EW.cssColor(f.color);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,12,0.25)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  });
  // propeller: translucent disc + two blades
  var nose = toWorld([0, 3.62, 0.1]);
  var noseP = EW.project(cam, viewW, viewH, nose[0], nose[1], nose[2]);
  if (noseP) {
    var pr = EW.clamp((1.35 * cam.focal) / noseP.d, 2, 60);
    ctx.fillStyle = 'rgba(200,205,215,0.16)';
    ctx.beginPath();
    ctx.ellipse(noseP.x, noseP.y, pr, pr * 0.96, 0, 0, EW.TAU);
    ctx.fill();
    var bx = Math.cos(plane.propAngle) * pr;
    var by = Math.sin(plane.propAngle) * pr;
    ctx.strokeStyle = 'rgba(35,30,28,0.85)';
    ctx.lineWidth = Math.max(1.4, pr * 0.14);
    ctx.beginPath();
    ctx.moveTo(noseP.x - bx, noseP.y - by);
    ctx.lineTo(noseP.x + bx, noseP.y + by);
    ctx.stroke();
    ctx.fillStyle = '#8c241a';
    ctx.beginPath();
    ctx.arc(noseP.x, noseP.y, Math.max(1.6, pr * 0.16), 0, EW.TAU);
    ctx.fill();
  }
};
