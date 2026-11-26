// courses.js — the six Emberwing Post missions and the seeded archipelago
// each one flies over: island heightfield, volcano, runway, rings, parcel
// drop zones, fuel cans, buildings, trees and clouds. One seed builds the
// same world on every machine.

EW.PALETTES = {
  dawn: {
    skyTop: [58, 74, 128], skyMid: [214, 140, 110], skyHorizon: [250, 196, 140],
    sun: [255, 214, 150], sunAz: 0.9, sunEl: 0.16, fog: [232, 180, 150], fogFar: 2800,
    water: [52, 96, 140], sand: [222, 196, 150], grassLow: [96, 140, 80], grassHigh: [70, 110, 66],
    rock: [120, 105, 95], snow: [240, 240, 245], ambient: 0.95, stars: false, rain: false,
  },
  day: {
    skyTop: [64, 130, 210], skyMid: [120, 180, 235], skyHorizon: [205, 232, 250],
    sun: [255, 246, 220], sunAz: 2.2, sunEl: 0.85, fog: [190, 220, 245], fogFar: 3200,
    water: [38, 110, 170], sand: [230, 210, 160], grassLow: [88, 160, 84], grassHigh: [58, 120, 60],
    rock: [128, 118, 108], snow: [245, 248, 252], ambient: 1.05, stars: false, rain: false,
  },
  dusk: {
    skyTop: [44, 44, 92], skyMid: [150, 80, 110], skyHorizon: [245, 150, 90],
    sun: [255, 180, 110], sunAz: 4.4, sunEl: 0.1, fog: [210, 140, 130], fogFar: 2600,
    water: [44, 70, 120], sand: [210, 175, 140], grassLow: [80, 120, 70], grassHigh: [55, 95, 55],
    rock: [105, 90, 85], snow: [235, 230, 240], ambient: 0.85, stars: false, rain: false,
  },
  night: {
    skyTop: [8, 13, 34], skyMid: [20, 32, 64], skyHorizon: [52, 74, 116],
    sun: [220, 230, 255], sunAz: 1.2, sunEl: 0.6, fog: [30, 42, 70], fogFar: 2400,
    water: [16, 36, 66], sand: [104, 98, 86], grassLow: [40, 70, 48], grassHigh: [30, 54, 38],
    rock: [68, 64, 68], snow: [170, 180, 200], ambient: 0.72, stars: true, rain: false,
  },
  storm: {
    skyTop: [52, 60, 78], skyMid: [90, 100, 118], skyHorizon: [150, 158, 168],
    sun: [205, 205, 200], sunAz: 2.8, sunEl: 0.5, fog: [140, 148, 158], fogFar: 2000,
    water: [40, 66, 88], sand: [180, 168, 140], grassLow: [70, 110, 66], grassHigh: [48, 86, 48],
    rock: [100, 95, 90], snow: [220, 225, 230], ambient: 0.8, stars: false, rain: true,
  },
};

EW.COURSES = [
  {
    name: 'First Light Run',
    blurb: 'Dawn over the home island. Thread five rings, then bring her back to the strip. Gentle air, full tank.',
    palette: 'dawn', seed: 101, rings: 5, parcels: 0, fuelCans: 0,
    startFuel: 100, timeLimit: 240, par: 900, windDir: 40, windSpeed: 2, gust: 0.15, ridges: 0,
  },
  {
    name: 'Canyon Thread',
    blurb: 'Midday in the red canyon. Seven rings between the ridges — mind the crosswind off the walls.',
    palette: 'day', seed: 202, rings: 7, parcels: 0, fuelCans: 1,
    startFuel: 90, timeLimit: 260, par: 1100, windDir: 120, windSpeed: 5, gust: 0.35, ridges: 3,
  },
  {
    name: 'Parcel Day',
    blurb: 'Three villages are waiting on the mail. Drop each parcel inside its beacon ring, then land.',
    palette: 'day', seed: 303, rings: 3, parcels: 3, fuelCans: 1,
    startFuel: 100, timeLimit: 300, par: 1200, windDir: 200, windSpeed: 4, gust: 0.25, ridges: 1,
  },
  {
    name: 'Ember Ridge',
    blurb: 'Dusk by the volcano, and the tank starts low. Grab the floating fuel cans or glide home dry.',
    palette: 'dusk', seed: 404, rings: 6, parcels: 1, fuelCans: 3,
    startFuel: 62, timeLimit: 280, par: 1300, windDir: 300, windSpeed: 7, gust: 0.45, ridges: 2,
  },
  {
    name: 'Storm Post',
    blurb: 'A front is coming through. Gusts, rain, and two urgent parcels. The mail does not wait for weather.',
    palette: 'storm', seed: 505, rings: 5, parcels: 2, fuelCans: 2,
    startFuel: 85, timeLimit: 300, par: 1400, windDir: 160, windSpeed: 12, gust: 0.8, ridges: 2,
  },
  {
    name: 'Night Mail',
    blurb: 'After dark the rings are lit and so is the strip. Eight gates over black water — trust your instruments.',
    palette: 'night', seed: 606, rings: 8, parcels: 0, fuelCans: 2,
    startFuel: 95, timeLimit: 300, par: 1500, windDir: 80, windSpeed: 6, gust: 0.3, ridges: 1,
  },
];

// Build the world for one course. Returns terrain, objectives and scenery.
EW.buildWorld = function (courseIndex, seedOverride) {
  var course = EW.COURSES[courseIndex];
  var rng = EW.makeRng(seedOverride !== undefined ? seedOverride : course.seed);
  var palette = EW.PALETTES[course.palette];

  // --- islands: gaussian bumps over a sea floor ---
  var bumps = [];
  function addBump(x, y, amp, r) {
    bumps.push({ x: x, y: y, amp: amp, r: r });
  }
  addBump(0, 0, 16, 780); // home island under the runway
  addBump(300, -500, 22, 520);
  addBump(-650, 350, 30, 620);
  addBump(900, 900, 38, 700);
  addBump(-1100, -900, 26, 560);
  addBump(1500, -300, 44, 760);
  addBump(-1600, 1200, 34, 640);
  addBump(500, 1900, 40, 720);
  addBump(-400, -1900, 28, 600);
  for (var i = 0; i < 7; i++) {
    addBump(EW.randRange(rng, -2400, 2400), EW.randRange(rng, -2400, 2400), EW.randRange(rng, 12, 42), EW.randRange(rng, 380, 780));
  }

  // --- ridges: elongated hills (the canyon walls) ---
  var ridges = [];
  for (var rIdx = 0; rIdx < course.ridges; rIdx++) {
    ridges.push({
      x: EW.randRange(rng, -900, 900),
      y: 700 + rIdx * 650 + EW.randRange(rng, -150, 150),
      angle: EW.randRange(rng, -0.5, 0.5),
      len: EW.randRange(rng, 1200, 1900),
      amp: EW.randRange(rng, 42, 72),
      width: EW.randRange(rng, 130, 200),
    });
  }

  // --- the volcano, the archipelago's landmark ---
  var volcano = { x: -1500, y: 1500, r: 620, h: 210 };

  var runway = { x: 0, y: 0, heading: 0, len: 240, width: 26, z: 0 };
  var zones = [];

  function rawHeight(x, y) {
    var h = -10;
    for (var i = 0; i < bumps.length; i++) {
      var b = bumps[i];
      var dx = x - b.x;
      var dy = y - b.y;
      h += b.amp * Math.exp(-(dx * dx + dy * dy) / (b.r * b.r));
    }
    for (var j = 0; j < ridges.length; j++) {
      var rg = ridges[j];
      var ca = Math.cos(rg.angle);
      var sa = Math.sin(rg.angle);
      var lx = (x - rg.x) * ca + (y - rg.y) * sa;
      var ly = -(x - rg.x) * sa + (y - rg.y) * ca;
      var along = EW.clamp(1 - Math.abs(lx) / (rg.len / 2), 0, 1);
      h += rg.amp * Math.exp(-(ly * ly) / (rg.width * rg.width)) * (0.25 + 0.75 * along);
    }
    var vd = EW.dist2(x, y, volcano.x, volcano.y);
    if (vd < volcano.r) {
      var cone = volcano.h * (1 - vd / volcano.r);
      if (vd < volcano.r * 0.16) cone -= volcano.h * 0.3 * (1 - vd / (volcano.r * 0.16));
      if (cone > h) h = cone;
    }
    return h;
  }

  runway.z = Math.max(2, rawHeight(runway.x, runway.y));

  // Flatten a rectangle (runway) or disc (drop pad) into the heightfield.
  function flattenRect(x, y, cx, cy, heading, halfLen, halfWid, z, blend) {
    var ca = Math.cos(heading);
    var sa = Math.sin(heading);
    var lx = (x - cx) * sa + (y - cy) * ca;
    var ly = (x - cx) * ca - (y - cy) * sa;
    var dx = Math.max(0, Math.abs(lx) - halfLen);
    var dy = Math.max(0, Math.abs(ly) - halfWid);
    var d = Math.sqrt(dx * dx + dy * dy);
    return EW.smoothstep(blend, 0, d);
  }

  function heightAt(x, y) {
    var h = rawHeight(x, y);
    var t = flattenRect(x, y, runway.x, runway.y, runway.heading, runway.len / 2, runway.width / 2, runway.z, 130);
    if (t > 0) h = EW.lerp(h, runway.z, t);
    for (var i = 0; i < zones.length; i++) {
      var zn = zones[i];
      var d = EW.dist2(x, y, zn.x, zn.y);
      var zt = EW.smoothstep(zn.r + 55, zn.r * 0.6, d);
      if (zt > 0) h = EW.lerp(h, zn.z, zt);
    }
    return h;
  }

  // --- the ring course: a wandering path out from the strip ---
  var start = { x: runway.x, y: runway.y - 520, z: runway.z + 135, heading: 0 };
  var rings = [];
  var px = start.x;
  var py = start.y;
  var heading = 0;
  for (var k = 0; k < course.rings; k++) {
    var step = EW.randRange(rng, 520, 760);
    heading += EW.randRange(rng, -0.55, 0.55);
    px += Math.sin(heading) * step;
    py += Math.cos(heading) * step;
    var ground = Math.max(0, rawHeight(px, py));
    var alt = ground + EW.randRange(rng, 85, 190);
    rings.push({
      x: px, y: py, z: alt, r: 19,
      nx: Math.sin(heading), ny: Math.cos(heading),
      passed: false, missed: false,
    });
  }

  // --- parcel drop zones on solid ground near the course ---
  var tries = 0;
  while (zones.length < course.parcels && tries < 300) {
    tries++;
    var anchor = rings[Math.floor(rng() * rings.length)] || start;
    var zx = anchor.x + EW.randRange(rng, -420, 420);
    var zy = anchor.y + EW.randRange(rng, -420, 420);
    var zh = rawHeight(zx, zy);
    if (zh < 3 || zh > 70) continue;
    var ok = true;
    for (var zi = 0; zi < zones.length; zi++) {
      if (EW.dist2(zx, zy, zones[zi].x, zones[zi].y) < 500) ok = false;
    }
    if (!ok) continue;
    zones.push({ x: zx, y: zy, z: zh, r: 34, delivered: false, score: 0 });
  }

  // --- floating fuel cans near some rings ---
  var fuelCans = [];
  for (var f = 0; f < course.fuelCans; f++) {
    var ring = rings[Math.floor(rng() * rings.length)];
    if (!ring) break;
    fuelCans.push({
      x: ring.x + EW.randRange(rng, -90, 90),
      y: ring.y + EW.randRange(rng, -90, 90),
      z: ring.z + EW.randRange(rng, -15, 25),
      taken: false,
      phase: rng() * EW.TAU,
    });
  }

  // --- buildings around the strip ---
  var buildings = [
    { x: 46, y: -60, w: 26, d: 16, h: 8, rot: 0, kind: 'hangar' },
    { x: -44, y: 30, w: 8, d: 8, h: 20, rot: 0, kind: 'tower' },
    { x: 60, y: 70, w: 12, d: 10, h: 6, rot: 0.3, kind: 'house' },
    { x: -58, y: -90, w: 11, d: 9, h: 5.5, rot: -0.2, kind: 'house' },
    { x: 72, y: -140, w: 10, d: 9, h: 5, rot: 0.1, kind: 'house' },
  ];
  for (var bi = 0; bi < buildings.length; bi++) {
    buildings[bi].z = heightAt(buildings[bi].x, buildings[bi].y);
    buildings[bi].radius = Math.max(buildings[bi].w, buildings[bi].d) * 0.72;
  }

  // --- pine trees on gentle land ---
  var trees = [];
  var treeTries = 0;
  while (trees.length < 240 && treeTries < 4000) {
    treeTries++;
    var tx = EW.randRange(rng, -2600, 2600);
    var ty = EW.randRange(rng, -2600, 2600);
    var th = heightAt(tx, ty);
    if (th < 1.5 || th > 60) continue;
    if (EW.dist2(tx, ty, runway.x, runway.y) < 190) continue;
    var nearZone = false;
    for (var tz = 0; tz < zones.length; tz++) {
      if (EW.dist2(tx, ty, zones[tz].x, zones[tz].y) < 70) nearZone = true;
    }
    if (nearZone) continue;
    trees.push({ x: tx, y: ty, z: th, s: EW.randRange(rng, 0.8, 1.5), tone: rng() });
  }

  // --- clouds ---
  var clouds = [];
  for (var ci = 0; ci < 26; ci++) {
    clouds.push({
      x: EW.randRange(rng, -3000, 3000),
      y: EW.randRange(rng, -3000, 3000),
      z: EW.randRange(rng, 250, 430),
      s: EW.randRange(rng, 70, 170),
      puffs: 3 + Math.floor(rng() * 3),
      seed: rng() * 100,
    });
  }

  return {
    course: course,
    palette: palette,
    bumps: bumps,
    ridges: ridges,
    volcano: volcano,
    runway: runway,
    rings: rings,
    zones: zones,
    fuelCans: fuelCans,
    buildings: buildings,
    trees: trees,
    clouds: clouds,
    start: start,
    heightAt: heightAt,
    windDir: course.windDir * EW.DEG,
    windSpeed: course.windSpeed,
    gust: course.gust,
  };
};
