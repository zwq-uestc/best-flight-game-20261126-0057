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

// Local model: x right, y forward, z up, meters (pre-scale; the renderer
// applies PLANE_SCALE). Each part is a list of quads (4 local points)
// with a base color. Round 3 hero rebuild: rounder 12-sided fuselage
// sections with a raised top deck, a wing and tailplane with real
// thickness and dihedral, a fin with a readable silhouette from behind,
// and a specular glint on the canopy — so she reads as a proper little
// mail plane from the chase camera, banked or not.
var PLANE_SCALE = 1.15;

function planeParts() {
  var cream = [240, 230, 202];
  var red = [198, 52, 44];
  var redDark = [168, 44, 38];
  var dark = [40, 44, 54];
  var glass = [74, 126, 156];
  var glint = [238, 246, 252];
  var strutCol = [88, 84, 80];
  var parts = [];
  function quad(a, b, c, d, color) {
    parts.push({ pts: [a, b, c, d], color: color });
  }
  // Fuselage: seven cross-sections nose -> tail, each a 12-gon with a
  // raised spine along the top so the shading rolls over a rounded deck.
  var sec = [
    { y: 3.45, w: 0.40, h: 0.44, z: 0.10, deck: 0.02 },
    { y: 2.50, w: 0.54, h: 0.60, z: 0.12, deck: 0.06 },
    { y: 1.30, w: 0.58, h: 0.64, z: 0.15, deck: 0.10 },
    { y: 0.20, w: 0.57, h: 0.62, z: 0.17, deck: 0.10 },
    { y: -1.20, w: 0.48, h: 0.54, z: 0.20, deck: 0.08 },
    { y: -2.50, w: 0.32, h: 0.42, z: 0.27, deck: 0.05 },
    { y: -3.55, w: 0.15, h: 0.28, z: 0.34, deck: 0.02 },
  ];
  var ringAngles = [90, 60, 30, 0, -30, -60, -90, -120, -150, 180, 150, 120];
  function ringPoint(S, k) {
    var a = ringAngles[k] * EW.DEG;
    var sa = Math.sin(a);
    var deckBoost = sa > 0.85 ? S.deck : sa > 0.45 ? S.deck * 0.45 : 0;
    return [S.w * Math.cos(a), S.y, S.z + S.h * sa + deckBoost];
  }
  for (var s = 0; s < sec.length - 1; s++) {
    var A = sec[s];
    var B = sec[s + 1];
    var col = s === 0 ? red : cream;
    for (var k = 0; k < 12; k++) {
      var k2 = (k + 1) % 12;
      quad(ringPoint(A, k), ringPoint(A, k2), ringPoint(B, k2), ringPoint(B, k), col);
    }
  }
  // Nose cap: a fan of triangles meeting at the spinner backplate.
  for (var nk = 0; nk < 12; nk++) {
    var nk2 = (nk + 1) % 12;
    quad([0, 3.58, 0.1], ringPoint(sec[0], nk), ringPoint(sec[0], nk2), [0, 3.58, 0.1], red);
  }
  // Cheatline: a red band riding just proud of the fuselage sides.
  for (var cs = 1; cs <= 4; cs++) {
    var CA = sec[cs];
    var CB = sec[cs + 1];
    quad([CA.w * 1.03, CA.y, CA.z + 0.24], [CA.w * 1.03, CA.y, CA.z - 0.04],
         [CB.w * 1.03, CB.y, CB.z - 0.04], [CB.w * 1.03, CB.y, CB.z + 0.24], red);
    quad([-CA.w * 1.03, CA.y, CA.z - 0.04], [-CA.w * 1.03, CA.y, CA.z + 0.24],
         [-CB.w * 1.03, CB.y, CB.z + 0.24], [-CB.w * 1.03, CB.y, CB.z - 0.04], red);
  }
  // Canopy: dark frame, glass, and a bright specular streak across the
  // front pane so the sun catches her as she banks.
  quad([-0.38, 1.78, 0.80], [0.38, 1.78, 0.80], [0.34, 0.36, 0.85], [-0.34, 0.36, 0.85], dark);
  quad([-0.35, 1.75, 0.82], [0.35, 1.75, 0.82], [0.31, 0.38, 0.87], [-0.31, 0.38, 0.87], glass);
  quad([-0.20, 1.72, 0.845], [0.05, 1.72, 0.845], [-0.02, 0.55, 0.88], [-0.22, 0.55, 0.88], glint);
  quad([0.35, 1.75, 0.82], [0.35, 1.75, 0.38], [0.31, 0.38, 0.38], [0.31, 0.38, 0.87], glass);
  quad([-0.35, 1.75, 0.38], [-0.35, 1.75, 0.82], [-0.31, 0.38, 0.87], [-0.31, 0.38, 0.38], glass);
  quad([0.36, 1.62, 0.62], [0.36, 1.62, 0.46], [0.32, 0.6, 0.46], [0.32, 0.6, 0.62], glint);
  // Main wing with real thickness: top skin, bottom skin, leading and
  // trailing edges, tip caps. Three stations per side (root, tip-break,
  // tip) with honest dihedral so the wing reads in a bank.
  var wingSt = [
    { x: 0.0, le: 1.28, te: 0.08, top: 0.30, bot: 0.14 },
    { x: 4.1, le: 1.06, te: 0.16, top: 0.50, bot: 0.36 },
    { x: 5.35, le: 0.98, te: 0.20, top: 0.58, bot: 0.44 },
  ];
  [1, -1].forEach(function (side) {
    for (var ws = 0; ws < 2; ws++) {
      var S0 = wingSt[ws];
      var S1 = wingSt[ws + 1];
      var topCol = ws === 1 ? cream : red;
      var botCol = ws === 1 ? cream : redDark;
      var x0 = side * S0.x;
      var x1 = side * S1.x;
      // top skin
      quad([x0, S0.le, S0.top], [x1, S1.le, S1.top], [x1, S1.te, S1.top], [x0, S0.te, S0.top], topCol);
      // bottom skin
      quad([x0, S0.te, S0.bot], [x1, S1.te, S1.bot], [x1, S1.le, S1.bot], [x0, S0.le, S0.bot], botCol);
      // leading edge
      quad([x0, S0.le, S0.bot], [x1, S1.le, S1.bot], [x1, S1.le, S1.top], [x0, S0.le, S0.top], red);
      // trailing edge
      quad([x0, S0.te, S0.top], [x1, S1.te, S1.top], [x1, S1.te, S1.bot], [x0, S0.te, S0.bot], redDark);
    }
    var tip = wingSt[2];
    quad([side * tip.x, tip.le, tip.top], [side * tip.x, tip.te, tip.top],
         [side * tip.x, tip.te, tip.bot], [side * tip.x, tip.le, tip.bot], cream);
  });
  // Wing struts: two per side, fuselage belly to wing underside.
  [1, -1].forEach(function (side) {
    quad([side * 0.5, 1.05, -0.32], [side * 0.5, 0.92, -0.32], [side * 2.6, 0.74, 0.30], [side * 2.6, 0.87, 0.30], strutCol);
    quad([side * 0.5, 0.3, -0.32], [side * 0.5, 0.17, -0.32], [side * 2.6, 0.04, 0.30], [side * 2.6, 0.17, 0.30], strutCol);
  });
  // Tailplane with thickness: top, bottom, edges, tip caps.
  var tp = { x: 2.05, le: -3.02, te: -3.92, top: 0.50, bot: 0.38 };
  quad([-tp.x, tp.le, tp.top], [tp.x, tp.le, tp.top], [tp.x, tp.te, tp.top], [-tp.x, tp.te, tp.top], red);
  quad([-tp.x, tp.te, tp.bot], [tp.x, tp.te, tp.bot], [tp.x, tp.le, tp.bot], [-tp.x, tp.le, tp.bot], redDark);
  quad([-tp.x, tp.le, tp.bot], [tp.x, tp.le, tp.bot], [tp.x, tp.le, tp.top], [-tp.x, tp.le, tp.top], red);
  quad([-tp.x, tp.te, tp.top], [tp.x, tp.te, tp.top], [tp.x, tp.te, tp.bot], [-tp.x, tp.te, tp.bot], redDark);
  quad([-tp.x, tp.le, tp.top], [-tp.x, tp.te, tp.top], [-tp.x, tp.te, tp.bot], [-tp.x, tp.le, tp.bot], cream);
  quad([tp.x, tp.te, tp.top], [tp.x, tp.le, tp.top], [tp.x, tp.le, tp.bot], [tp.x, tp.te, tp.bot], cream);
  // Fin with real thickness and a silhouette that reads from behind:
  // swept leading edge, rounded top, cream tip cap, dark reg band.
  var finT = 0.055;
  var finProfile = [
    [-2.42, 0.44], [-3.95, 0.44], [-3.95, 1.48], [-3.30, 1.62], [-2.72, 1.05],
  ];
  function finQuad(pts, color) {
    quad(pts[0], pts[1], pts[2], pts[3], color);
  }
  [1, -1].forEach(function (side) {
    var fx = side * finT;
    var P = finProfile.map(function (p) { return [fx, p[0], p[1]]; });
    finQuad([P[0], P[1], P[2], P[3]], red);
    finQuad([P[3], P[2], P[1], P[0]], red);
    finQuad([P[0], P[3], P[4], P[4]], red);
    finQuad([P[4], P[3], P[0], P[0]], red);
  });
  // fin leading edge + top edge bridging the two sides
  quad([-finT, -2.72, 1.05], [finT, -2.72, 1.05], [finT, -3.30, 1.62], [-finT, -3.30, 1.62], red);
  quad([-finT, -3.30, 1.62], [finT, -3.30, 1.62], [finT, -3.95, 1.48], [-finT, -3.95, 1.48], cream);
  quad([-finT, -3.95, 1.48], [finT, -3.95, 1.48], [finT, -3.95, 0.44], [-finT, -3.95, 0.44], redDark);
  // cream tip cap + dark registration band, both faces
  [1, -1].forEach(function (side) {
    var fx = side * (finT + 0.012);
    quad([fx, -3.28, 1.60], [fx, -3.93, 1.46], [fx, -3.93, 1.24], [fx, -3.28, 1.34], cream);
    quad([fx, -3.28, 1.14], [fx, -3.88, 1.14], [fx, -3.88, 0.90], [fx, -3.28, 0.90], dark);
  });
  // Exhaust stub under the cowling's right cheek.
  quad([0.3, 2.7, -0.4], [0.46, 2.7, -0.44], [0.46, 2.25, -0.52], [0.3, 2.25, -0.48], dark);
  // Antenna mast (the wire to the fin is stroked in drawPlane).
  quad([-0.03, 0.95, 0.78], [0.03, 0.95, 0.78], [0.03, 0.95, 1.08], [-0.03, 0.95, 1.08], dark);
  // Gear legs, wheels and red spats. Wheel bottoms sit at z=-1.35 so
  // that after PLANE_SCALE they meet the flight model's gear height.
  quad([-1.08, 0.92, -0.35], [-0.88, 0.92, -0.35], [-0.88, 0.92, -1.02], [-1.08, 0.92, -1.02], dark);
  quad([0.88, 0.92, -0.35], [1.08, 0.92, -0.35], [1.08, 0.92, -1.02], [0.88, 0.92, -1.02], dark);
  quad([-1.22, 1.06, -1.0], [-0.74, 1.06, -1.0], [-0.74, 0.78, -1.35], [-1.22, 0.78, -1.35], dark);
  quad([0.74, 1.06, -1.0], [1.22, 1.06, -1.0], [1.22, 0.78, -1.35], [0.74, 0.78, -1.35], dark);
  quad([-1.28, 1.3, -0.9], [-0.68, 1.3, -0.9], [-0.68, 0.52, -0.9], [-1.28, 0.52, -0.9], red);
  quad([0.68, 1.3, -0.9], [1.28, 1.3, -0.9], [1.28, 0.52, -0.9], [0.68, 0.52, -0.9], red);
  quad([-1.28, 1.3, -0.9], [-1.28, 0.52, -0.9], [-1.28, 0.52, -1.32], [-1.28, 1.3, -1.32], red);
  quad([1.28, 0.52, -0.9], [1.28, 1.3, -0.9], [1.28, 1.3, -1.32], [1.28, 0.52, -1.32], red);
  return parts;
}

var cachedParts = null;

// Transform a point from plane-local space (x right, y forward, z up,
// meters, pre-scale) into world space using the plane's current
// attitude. Shared by the renderer and the FX emitters (exhaust,
// wingtips, prop wash) so they always agree on where the airframe is.
EW.planeLocalToWorld = function (plane, x, y, z) {
  x *= PLANE_SCALE;
  y *= PLANE_SCALE;
  z *= PLANE_SCALE;
  var ch = Math.cos(plane.heading);
  var sh = Math.sin(plane.heading);
  var cp = Math.cos(plane.pitch);
  var sp = Math.sin(plane.pitch);
  var cb = Math.cos(plane.bank);
  var sb = Math.sin(plane.bank);
  var x1 = x * cb + z * sb;
  var z1 = -x * sb + z * cb;
  var y2 = y * cp - z1 * sp;
  var z2 = y * sp + z1 * cp;
  return [
    plane.x + x1 * ch + y2 * sh,
    plane.y - x1 * sh + y2 * ch,
    plane.z + z2,
  ];
};

// The plane's world-space velocity vector (without wind), for FX emitters
// that inherit the slipstream.
EW.planeVelocity = function (plane) {
  var horiz = plane.speed * Math.cos(plane.pitch);
  return [
    Math.sin(plane.heading) * horiz,
    Math.cos(plane.heading) * horiz,
    plane.speed * Math.sin(plane.pitch),
  ];
};

// Draw the plane (and its ground shadow) from the chase camera.
EW.drawPlane = function (ctx, cam, viewW, viewH, plane, world) {
  var pal = world.palette;
  // Shadow: the airframe's own silhouette projected onto the ground,
  // softening and fading as she climbs. Round 4: the shadow falls
  // away from the sun — displaced by altitude over tan(elevation)
  // (damped and clamped so it stays readable) and stretched along
  // the shadow direction at dawn and dusk, faint under storm light.
  // Falls back to a blob if any outline point is behind the camera.
  var groundZ = Math.max(world.heightAt(plane.x, plane.y), 0);
  var alt = plane.z - groundZ;
  if (alt < 280) {
    var sunStrengthP = pal.sunStrength === undefined ? 1 : pal.sunStrength;
    var shA = EW.clamp(0.38 - alt * 0.00125, 0.04, 0.38) * EW.clamp(sunStrengthP, 0.25, 1.15);
    var shH = Math.cos(plane.heading);
    var shS = Math.sin(plane.heading);
    var shSunX = Math.sin(pal.sunAz) * Math.cos(pal.sunEl);
    var shSunY = Math.cos(pal.sunAz) * Math.cos(pal.sunEl);
    var shSunZ = Math.max(0.1, Math.sin(pal.sunEl));
    var shOff = EW.clamp(alt / shSunZ, 0, 240) * 0.55;
    var shDirLen = Math.sqrt(shSunX * shSunX + shSunY * shSunY) || 1;
    var shDx = -shSunX / shDirLen;
    var shDy = -shSunY / shDirLen;
    var shCx = plane.x + shDx * shOff;
    var shCy = plane.y + shDy * shOff;
    var shStretch = 1 + EW.clamp(shOff / 130, 0, 1) * 0.85;
    var outline = [
      [0, 4.25], [0.71, 1.6], [6.15, 0.63], [1.7, -0.7], [2.35, -4.0],
      [0, -4.55], [-2.35, -4.0], [-1.7, -0.7], [-6.15, 0.63], [-0.71, 1.6],
    ];
    var shPts = [];
    var shOk = true;
    for (var si = 0; si < outline.length; si++) {
      var ox = outline[si][0];
      var oy = outline[si][1];
      var relX = ox * shH + oy * shS;
      var relY = -ox * shS + oy * shH;
      var par = relX * shDx + relY * shDy;
      var perpX = relX - shDx * par;
      var perpY = relY - shDy * par;
      var wx = shCx + perpX + shDx * par * shStretch;
      var wy = shCy + perpY + shDy * par * shStretch;
      var sp2 = EW.project(cam, viewW, viewH, wx, wy, groundZ + 0.3);
      if (!sp2) { shOk = false; break; }
      shPts.push(sp2);
    }
    if (shOk) {
      // Soft outer copy first, then the firmer core silhouette.
      var cxp = 0;
      var cyp = 0;
      shPts.forEach(function (p) { cxp += p.x; cyp += p.y; });
      cxp /= shPts.length;
      cyp /= shPts.length;
      [1.35, 1.0].forEach(function (scale, idx) {
        ctx.beginPath();
        shPts.forEach(function (p, k) {
          var px = cxp + (p.x - cxp) * scale;
          var py = cyp + (p.y - cyp) * scale;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(10,14,20,' + (idx === 0 ? shA * 0.45 : shA) + ')';
        ctx.fill();
      });
    } else {
      var sh = EW.project(cam, viewW, viewH, shCx, shCy, groundZ + 0.3);
      if (sh) {
        var sw = EW.clamp((12.6 * cam.focal) / sh.d, 2, 90);
        ctx.fillStyle = 'rgba(10,14,20,' + shA + ')';
        ctx.beginPath();
        ctx.ellipse(sh.x, sh.y, sw, sw * 0.32, 0, 0, EW.TAU);
        ctx.fill();
      }
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
    // local (x right, y fwd, z up) scaled, then roll about y, pitch
    // about x, yaw about z
    var px = p[0] * PLANE_SCALE;
    var py = p[1] * PLANE_SCALE;
    var pz = p[2] * PLANE_SCALE;
    var x1 = px * cb + pz * sb;
    var z1 = -px * sb + pz * cb;
    var y1 = py;
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
  // Round 4 lighting split: sunlit faces warm toward the sun colour,
  // shaded faces fall toward the cool sky fill (strongest at golden
  // hour); diffuse contrast follows the mission's sunStrength.
  var warmAmtP = EW.clamp(1.25 - pal.sunEl, 0.25, 1.1);
  var fillColP = pal.fillCol || pal.fog;
  var sunStrengthF = pal.sunStrength === undefined ? 1 : pal.sunStrength;
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
    // Signed diffuse against the sun, with the normal oriented toward
    // the camera so winding never flips the shading. Faces turned away
    // from the sun fall into shade; grazing faces catch a warm rim of
    // sun colour along the silhouette (the MSFS chase-view look).
    var fcx = (worldPts[0][0] + worldPts[2][0]) / 2 - cam.x;
    var fcy = (worldPts[0][1] + worldPts[2][1]) / 2 - cam.y;
    var fcz = (worldPts[0][2] + worldPts[2][2]) / 2 - cam.z;
    var vl = Math.sqrt(fcx * fcx + fcy * fcy + fcz * fcz) || 1;
    var ndv = (nx * fcx + ny * fcy + nz * fcz) / (nl * vl);
    var ndl = (nx * sunX + ny * sunY + nz * sunZ) / nl;
    if (ndv < 0) {
      ndl = -ndl;
      ndv = -ndv;
    }
    var litF = EW.clamp(Math.max(0, ndl) * sunStrengthF, 0, 1.25);
    var light = (0.5 + 0.66 * litF) * pal.ambient + 0.14;
    var faceCol = EW.shadeColor(part.color, light);
    faceCol = EW.mixColor(faceCol, pal.sun, EW.clamp(litF, 0, 1) * 0.07 * warmAmtP);
    faceCol = EW.mixColor(faceCol, fillColP, (1 - EW.clamp(litF, 0, 1)) * 0.15 * warmAmtP);
    var rim = Math.pow(1 - Math.abs(ndv), 2.2) * EW.clamp(ndl + 0.35, 0, 1) * 0.55;
    if (rim > 0.02) faceCol = EW.mixColor(faceCol, pal.sun, rim * 0.4);
    var depth = 0;
    proj.forEach(function (p) { depth += p.d; });
    faces.push({ proj: proj, color: faceCol, depth: depth / proj.length });
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
    ctx.strokeStyle = 'rgba(20,16,12,0.16)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  });
  // Antenna wire from the cabin mast back to the fin.
  var mastTop = toWorld([0, 0.95, 1.08]);
  var finTop = toWorld([0, -3.6, 1.55]);
  var mastP = EW.project(cam, viewW, viewH, mastTop[0], mastTop[1], mastTop[2]);
  var finP = EW.project(cam, viewW, viewH, finTop[0], finTop[1], finTop[2]);
  if (mastP && finP) {
    ctx.strokeStyle = 'rgba(25,22,20,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mastP.x, mastP.y);
    ctx.lineTo(finP.x, finP.y);
    ctx.stroke();
  }
  // Propeller: a translucent blur disc (denser at the rim, where the
  // tips sweep) with the blades ghosting through it at low throttle.
  // The disc deepens with throttle so full power reads as a solid wash.
  var nose = toWorld([0, 3.58, 0.1]);
  var noseP = EW.project(cam, viewW, viewH, nose[0], nose[1], nose[2]);
  if (noseP) {
    var pr = EW.clamp((1.55 * cam.focal) / noseP.d, 2, 60);
    var wash = 0.55 + plane.throttle * 0.85;
    var discG = ctx.createRadialGradient(noseP.x, noseP.y, pr * 0.08, noseP.x, noseP.y, pr);
    discG.addColorStop(0, 'rgba(205,212,224,' + 0.05 * wash + ')');
    discG.addColorStop(0.7, 'rgba(205,212,224,' + 0.10 * wash + ')');
    discG.addColorStop(0.96, 'rgba(215,222,235,' + 0.24 * wash + ')');
    discG.addColorStop(1, 'rgba(215,222,235,' + 0.03 * wash + ')');
    ctx.fillStyle = discG;
    ctx.beginPath();
    ctx.ellipse(noseP.x, noseP.y, pr, pr * 0.96, 0, 0, EW.TAU);
    ctx.fill();
    var bladeA = EW.clamp(1.05 - plane.throttle * 0.75, 0.22, 0.9);
    var bx = Math.cos(plane.propAngle) * pr;
    var by = Math.sin(plane.propAngle) * pr;
    ctx.strokeStyle = 'rgba(35,30,28,' + bladeA + ')';
    ctx.lineWidth = Math.max(1.4, pr * 0.14);
    ctx.beginPath();
    ctx.moveTo(noseP.x - bx, noseP.y - by);
    ctx.lineTo(noseP.x + bx, noseP.y + by);
    ctx.stroke();
    if (plane.throttle > 0.45) {
      ctx.strokeStyle = 'rgba(35,30,28,' + bladeA * 0.45 + ')';
      ctx.beginPath();
      ctx.moveTo(noseP.x + by, noseP.y - bx);
      ctx.lineTo(noseP.x - by, noseP.y + bx);
      ctx.stroke();
    }
    ctx.fillStyle = '#8c241a';
    ctx.beginPath();
    ctx.arc(noseP.x, noseP.y, Math.max(1.6, pr * 0.16), 0, EW.TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,220,0.5)';
    ctx.beginPath();
    ctx.arc(noseP.x - pr * 0.05, noseP.y - pr * 0.05, Math.max(0.8, pr * 0.06), 0, EW.TAU);
    ctx.fill();
  }
  // Nav lights (round 4): red port, green starboard, white tail
  // strobe with a double-blink, red anti-collision beacon on the
  // spine. Only after dark; glow scales with the palette's
  // nightLights factor so dusk gets a whisper and night the full set.
  var nlP = pal.nightLights || 0;
  if (nlP > 0.15) {
    var tNow = performance.now() / 1000;
    function navLight(local, rgb, blink) {
      var wp = toWorld(local);
      var pp = EW.project(cam, viewW, viewH, wp[0], wp[1], wp[2]);
      if (!pp) return;
      var on = blink ? blink(tNow) : 1;
      if (on <= 0.02) return;
      var r = EW.clamp((2.6 * cam.focal) / pp.d, 2, 16);
      var g = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, r * 2.2);
      g.addColorStop(0, 'rgba(' + rgb + ',' + (0.85 * on * nlP).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(pp.x - r * 2.2, pp.y - r * 2.2, r * 4.4, r * 4.4);
      ctx.fillStyle = 'rgba(' + rgb + ',' + (0.95 * on).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, Math.max(1.2, r * 0.32), 0, EW.TAU);
      ctx.fill();
    }
    navLight([-5.35, 0.59, 0.51], '255,60,50', null);
    navLight([5.35, 0.59, 0.51], '60,255,120', null);
    navLight([0, -3.95, 0.5], '255,255,255', function (t) {
      var ph = t % 1.4;
      return (ph < 0.07 || (ph > 0.18 && ph < 0.25)) ? 1 : 0;
    });
    navLight([0, 0.2, 0.95], '255,50,40', function (t) {
      var ph = t % 1.1;
      return ph < 0.12 ? 1 : 0.06;
    });
  }
};
