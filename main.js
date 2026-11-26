// main.js — Emberwing Post's game loop and mission logic: state machine
// (title, briefing, flying, paused, complete, failed), keyboard and mouse
// input, ring/parcel/fuel objective tracking, scoring and grades, the
// upgrade shop's purchases, save data, an autopilot for the title-screen
// demo and screenshot staging, and particles.

(function () {
  var VIEW_W = 1152;
  var VIEW_H = 648;
  var SAVE_KEY = 'emberwing-post-v1';
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var params = new URLSearchParams(window.location.search);
  var shotMode = params.get('shot');
  var shotMission = EW.clamp(parseInt(params.get('mission') || '0', 10) || 0, 0, EW.COURSES.length - 1);
  var seedParam = params.get('seed');
  var seedOverride = seedParam === null ? undefined : parseInt(seedParam, 10);

  function defaultSave() {
    return {
      unlocked: 0,
      best: {},
      coins: 0,
      upgrades: { engine: 0, tank: 0, plating: 0, wings: 0 },
      muted: false,
      campaignBest: 0,
    };
  }

  function loadSave() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      var parsed = JSON.parse(raw);
      var base = defaultSave();
      for (var k in base) {
        if (parsed[k] !== undefined) base[k] = parsed[k];
      }
      return base;
    } catch (e) {
      return defaultSave();
    }
  }

  function storeSave() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(game.save));
    } catch (e) {
      /* storage unavailable: play on without saving */
    }
  }

  var game = {
    state: 'title',
    world: null,
    plane: null,
    cam: EW.makeCamera(),
    save: loadSave(),
    selectedMission: 0,
    score: 0,
    coins: 0,
    timeLeft: 0,
    time: 0,
    nextRing: 0,
    ringsDone: 0,
    parcelsDone: 0,
    parcelsCarried: 0,
    parcels: [],
    particles: [],
    combo: 0,
    ringScore: 0,
    parcelScore: 0,
    landingScore: 0,
    target: null,
    targetLabel: '',
    objectiveText: '',
    message: null,
    result: null,
    failReason: '',
    buttons: [],
    keys: {},
    mouse: { x: 0, y: 0, down: false, dragX: 0, dragY: 0 },
    shake: 0,
    endTimer: 0,
    shotClock: 0,
    smokeClock: 0,
    volcanoClock: 0,
    prevRingDot: 0,
  };
  EW.Sound.setMuted(game.save.muted);

  function showMessage(text, color) {
    game.message = { text: text, color: color || '#ffd23e', t: 2.4 };
  }

  // ------------------------------------------------------------ particles

  function spawnParticle(x, y, z, vx, vy, vz, life, size, color, alpha, gravity) {
    if (game.particles.length > 420) game.particles.shift();
    game.particles.push({
      x: x, y: y, z: z, vx: vx, vy: vy, vz: vz,
      life: life, maxLife: life, size: size, color: color,
      alpha: alpha === undefined ? 0.85 : alpha, gravity: gravity || 0,
    });
  }

  function burst(x, y, z, count, color, speed, size, life, gravity) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * EW.TAU;
      var b = Math.random() * Math.PI - Math.PI / 2;
      var s = speed * (0.35 + Math.random() * 0.85);
      spawnParticle(
        x, y, z,
        Math.cos(a) * Math.cos(b) * s, Math.sin(a) * Math.cos(b) * s, Math.sin(b) * s,
        life * (0.6 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), color, 0.9, gravity
      );
    }
  }

  function explosion(x, y, z) {
    burst(x, y, z, 46, '#ff8c3c', 16, 3.2, 1.1, -2);
    burst(x, y, z, 30, '#ffd23e', 10, 2.4, 0.8, -1);
    burst(x, y, z, 36, '#5a5f6a', 7, 4.2, 2.2, 1.5);
  }

  function stepParticles(dt) {
    for (var i = game.particles.length - 1; i >= 0; i--) {
      var p = game.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        game.particles.splice(i, 1);
        continue;
      }
      p.vz += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.color === '#5a5f6a' || p.color === '#8a8f98') p.size += dt * 2.4;
    }
  }

  // ------------------------------------------------------------ mission flow

  function startMission(index) {
    game.selectedMission = index;
    game.world = EW.buildWorld(index, seedOverride);
    game.plane = EW.newPlane(game.world);
    game.cam = EW.makeCamera();
    game.state = 'flying';
    game.score = 0;
    game.ringScore = 0;
    game.parcelScore = 0;
    game.landingScore = 0;
    game.combo = 0;
    game.nextRing = 0;
    game.ringsDone = 0;
    game.parcelsDone = 0;
    game.parcelsCarried = game.world.course.parcels;
    game.parcels = [];
    game.particles = [];
    game.timeLeft = game.world.course.timeLimit;
    game.endTimer = 0;
    game.prevRingDot = 0;
    showMessage(game.world.course.name.toUpperCase(), '#ffd23e');
    updateObjective();
  }

  function startDemo() {
    game.world = EW.buildWorld(0, seedOverride);
    game.plane = EW.newPlane(game.world);
    game.cam = EW.makeCamera();
    game.nextRing = 0;
    game.parcels = [];
    game.particles = [];
    updateObjective();
  }

  function objectivesDone() {
    return game.nextRing >= game.world.rings.length && game.parcelsDone >= game.world.zones.length;
  }

  function updateObjective() {
    var world = game.world;
    var plane = game.plane;
    if (!world || !plane) return;
    if (game.nextRing < world.rings.length) {
      var ring = world.rings[game.nextRing];
      game.target = ring;
      game.targetLabel = 'RING';
      game.objectiveText = 'Rings ' + game.ringsDone + '/' + world.rings.length + ' — thread the gold ring';
    } else if (game.parcelsDone < world.zones.length && game.parcelsCarried > 0) {
      var best = null;
      var bestD = Infinity;
      world.zones.forEach(function (zone) {
        if (zone.delivered) return;
        var d = EW.dist2(plane.x, plane.y, zone.x, zone.y);
        if (d < bestD) {
          bestD = d;
          best = zone;
        }
      });
      game.target = best;
      game.targetLabel = 'DROP';
      game.objectiveText = 'Parcels ' + game.parcelsDone + '/' + world.zones.length + ' — drop on the beacon (Space)';
    } else {
      game.target = { x: world.runway.x, y: world.runway.y, z: world.runway.z };
      game.targetLabel = 'LAND';
      game.objectiveText = objectivesDone()
        ? 'All delivered — land at the home strip'
        : 'Bring her home and land at the strip';
    }
  }

  function completeMission() {
    var course = game.world.course;
    var timeBonus = Math.round(Math.max(0, game.timeLeft)) * 5;
    var fuelBonus = Math.round(game.plane.fuel) * 2;
    var total = game.ringScore + game.parcelScore + game.landingScore + timeBonus + fuelBonus;
    var grade = total >= course.par ? 'S' : total >= course.par * 0.75 ? 'A' : total >= course.par * 0.5 ? 'B' : 'C';
    var coinsEarned = Math.round(total / 10);
    game.result = {
      ringScore: game.ringScore,
      parcelScore: game.parcelScore,
      landingScore: game.landingScore,
      timeBonus: timeBonus,
      fuelBonus: fuelBonus,
      total: total,
      grade: grade,
      coinsEarned: coinsEarned,
    };
    game.score = total;
    game.save.coins += coinsEarned;
    var prevBest = game.save.best[game.selectedMission];
    if (!prevBest || total > prevBest.score) {
      game.save.best[game.selectedMission] = { score: total, grade: grade };
    }
    if (game.selectedMission === game.save.unlocked && game.save.unlocked < EW.COURSES.length - 1) {
      game.save.unlocked++;
    }
    var campaignTotal = 0;
    for (var k in game.save.best) campaignTotal += game.save.best[k].score;
    if (campaignTotal > game.save.campaignBest) game.save.campaignBest = campaignTotal;
    storeSave();
    game.state = 'complete';
    EW.Sound.setEngine(0, 0, false);
    EW.Sound.jingle();
  }

  function failMission(reason) {
    game.failReason = reason;
    game.state = 'failed';
    EW.Sound.setEngine(0, 0, false);
    EW.Sound.failSting();
  }

  // ------------------------------------------------------------ events

  function drainEvents() {
    var plane = game.plane;
    var events = plane.events;
    plane.events = [];
    events.forEach(function (ev) {
      if (ev.type === 'touchdown') {
        var pts = ev.amount === 3 ? 200 : ev.amount === 2 ? 120 : 40;
        if (pts > game.landingScore) game.landingScore = pts;
        game.score = game.ringScore + game.parcelScore + game.landingScore;
        showMessage(ev.amount === 3 ? 'SMOOTH LANDING +' + pts : ev.amount === 2 ? 'FIRM LANDING +' + pts : 'ROUGH LANDING +' + pts, '#57e389');
        EW.Sound.touchdown(ev.amount === 1);
        burst(plane.x, plane.y, plane.z - 1, 14, '#c9b896', 5, 2.2, 0.8, 1);
      } else if (ev.type === 'fieldLanding') {
        showMessage('ROUGH FIELD LANDING — HULL DAMAGE', '#ffb03a');
        EW.Sound.touchdown(true);
        game.shake = Math.max(game.shake, 0.5);
      } else if (ev.type === 'stopped') {
        var local = EW.runwayLocal(game.world, plane.x, plane.y);
        var onStrip = Math.abs(local.along) <= game.world.runway.len / 2 + 8 && Math.abs(local.across) <= game.world.runway.width / 2 + 4;
        if (onStrip && objectivesDone()) {
          completeMission();
        } else if (onStrip) {
          plane.fuel = 100;
          plane.hull = Math.min(100, plane.hull + 45);
          showMessage('REFUELLED & PATCHED — THROTTLE UP TO FLY AGAIN', '#57e389');
          EW.Sound.fuelPickup();
        } else {
          showMessage('STOPPED — THROTTLE UP TO TAKE OFF AGAIN', '#e8eef8');
        }
      } else if (ev.type === 'takeoff') {
        showMessage('AIRBORNE', '#e8eef8');
      } else if (ev.type === 'damage') {
        game.shake = Math.max(game.shake, 0.35 + ev.amount * 0.012);
        EW.Sound.damage();
        burst(plane.x, plane.y, plane.z, 10, '#ffb03a', 6, 1.8, 0.6, -3);
      } else if (ev.type === 'buildingHit') {
        showMessage('CLIPPED A BUILDING!', '#ff5a4e');
      } else if (ev.type === 'stall') {
        showMessage('STALL — NOSE DOWN, GAIN SPEED', '#ff5a4e');
      } else if (ev.type === 'fuelEmpty') {
        showMessage('FUEL EXHAUSTED — GLIDE TO THE STRIP', '#ff5a4e');
      } else if (ev.type === 'crashed' || ev.type === 'ditched' || ev.type === 'destroyed') {
        explosion(plane.x, plane.y, plane.z);
        EW.Sound.crash();
        game.shake = 1.2;
        game.endTimer = 1.4;
        game.failReason = ev.type === 'ditched'
          ? 'Ditched in the sea. The mail is soggy, the Emberwing is a reef.'
          : ev.type === 'destroyed'
            ? 'The airframe gave up under the damage. She came apart over the islands.'
            : 'She went in hard. The mail is scattered across the hillside.';
      }
    });
  }

  // ------------------------------------------------------------ objectives

  function stepObjectives(dt) {
    var plane = game.plane;
    var world = game.world;

    // ring crossing
    if (game.nextRing < world.rings.length) {
      var ring = world.rings[game.nextRing];
      var dx = plane.x - ring.x;
      var dy = plane.y - ring.y;
      var dz = plane.z - ring.z;
      var dot = dx * ring.nx + dy * ring.ny;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      var radial = Math.sqrt(Math.max(0, dist * dist - dot * dot));
      var crossed = (game.prevRingDot < 0 && dot >= 0) || (game.prevRingDot > 0 && dot <= 0);
      if ((crossed && radial <= ring.r) || dist < ring.r * 0.55) {
        ring.passed = true;
        game.nextRing++;
        game.ringsDone++;
        var pts = 100 + game.combo * 10;
        game.combo++;
        game.ringScore += pts;
        game.score = game.ringScore + game.parcelScore + game.landingScore;
        showMessage('RING ' + game.ringsDone + '/' + world.rings.length + '  +' + pts, '#ffd23e');
        EW.Sound.ring(game.combo);
        burst(ring.x, ring.y, ring.z, 18, '#ffd23e', 7, 2, 0.7, 0);
        game.prevRingDot = 0;
      } else if (crossed && radial > ring.r && dist < ring.r * 3.2) {
        game.combo = 0;
        showMessage('MISSED THE RING — CIRCLE BACK', '#ffb03a');
        EW.Sound.miss();
        game.prevRingDot = dot;
      } else {
        game.prevRingDot = dot;
      }
    }

    // fuel cans
    world.fuelCans.forEach(function (can) {
      if (can.taken) return;
      if (EW.dist3(plane, can) < 14) {
        can.taken = true;
        plane.fuel = Math.min(100, plane.fuel + 25);
        showMessage('+25 FUEL', '#57e389');
        EW.Sound.fuelPickup();
        burst(can.x, can.y, can.z, 12, '#57e389', 5, 1.8, 0.6, 0);
      }
    });

    // parcels in flight
    game.parcels.forEach(function (parcel) {
      if (parcel.landed) return;
      parcel.vz -= 14 * dt;
      parcel.vx *= 1 - 0.1 * dt;
      parcel.vy *= 1 - 0.1 * dt;
      parcel.x += parcel.vx * dt;
      parcel.y += parcel.vy * dt;
      parcel.z += parcel.vz * dt;
      var gz = Math.max(world.heightAt(parcel.x, parcel.y), 0);
      if (parcel.z <= gz + 0.6) {
        parcel.z = gz + 0.6;
        parcel.landed = true;
        var bestZone = null;
        var bestD = Infinity;
        world.zones.forEach(function (zone) {
          if (zone.delivered) return;
          var d = EW.dist2(parcel.x, parcel.y, zone.x, zone.y);
          if (d < bestD) {
            bestD = d;
            bestZone = zone;
          }
        });
        if (bestZone && bestD <= bestZone.r) {
          bestZone.delivered = true;
          game.parcelsDone++;
          var pts = bestD <= 12 ? 150 : bestD <= 22 ? 100 : 50;
          bestZone.score = pts;
          game.parcelScore += pts;
          game.score = game.ringScore + game.parcelScore + game.landingScore;
          showMessage('PARCEL DELIVERED +' + pts, '#57e389');
          EW.Sound.parcelHit(true);
          burst(parcel.x, parcel.y, parcel.z + 1, 12, '#57e389', 5, 1.8, 0.6, -2);
        } else {
          showMessage('PARCEL MISSED THE BEACON', '#ffb03a');
          EW.Sound.parcelHit(false);
          burst(parcel.x, parcel.y, parcel.z + 1, 8, '#c9b896', 4, 1.8, 0.6, -2);
        }
      }
    });

    updateObjective();
  }

  function dropParcel() {
    var plane = game.plane;
    if (!plane.airborne || plane.dead || game.parcelsCarried <= 0) return;
    game.parcelsCarried--;
    var horiz = plane.speed * Math.cos(plane.pitch);
    game.parcels.push({
      x: plane.x,
      y: plane.y,
      z: plane.z - 1.5,
      vx: Math.sin(plane.heading) * horiz,
      vy: Math.cos(plane.heading) * horiz,
      vz: plane.speed * Math.sin(plane.pitch) - 1,
      landed: false,
    });
    EW.Sound.dropWhistle();
    showMessage('PARCEL AWAY — ' + game.parcelsCarried + ' LEFT', '#e8eef8');
  }

  // ------------------------------------------------------------ autopilot

  function autopilotInput() {
    var plane = game.plane;
    var world = game.world;
    var input = { pitch: 0, bank: 0, throttleUp: false, throttleDown: false, brake: false };
    var target = game.target || { x: plane.x, y: plane.y + 500, z: plane.z + 40 };
    var desired = Math.atan2(target.x - plane.x, target.y - plane.y);
    var dh = EW.angleDelta(desired, plane.heading);
    input.bank = EW.clamp(dh * 1.7, -1, 1);
    var dz = target.z - plane.z;
    input.pitch = EW.clamp(dz * 0.012, -0.45, 0.55);
    var aheadX = plane.x + Math.sin(plane.heading) * 200;
    var aheadY = plane.y + Math.cos(plane.heading) * 200;
    if (plane.z < world.heightAt(aheadX, aheadY) + 48) input.pitch = 0.6;
    if (plane.throttle < 0.66) input.throttleUp = true;
    if (plane.throttle > 0.74) input.throttleDown = true;
    return input;
  }

  function playerInput() {
    var input = { pitch: 0, bank: 0, throttleUp: false, throttleDown: false, brake: false };
    var k = game.keys;
    if (k.ArrowUp || k.KeyW) input.pitch += 1;
    if (k.ArrowDown || k.KeyS) input.pitch -= 1;
    if (k.ArrowLeft || k.KeyA) input.bank -= 1;
    if (k.ArrowRight || k.KeyD) input.bank += 1;
    if (k.ShiftLeft || k.ShiftRight) input.throttleUp = true;
    if (k.ControlLeft || k.ControlRight) input.throttleDown = true;
    if (k.KeyB) input.brake = true;
    if (game.mouse.down) {
      input.pitch += EW.clamp((game.mouse.dragY - game.mouse.y) / 110, -1, 1);
      input.bank += EW.clamp((game.mouse.x - game.mouse.dragX) / 110, -1, 1);
    }
    input.pitch = EW.clamp(input.pitch, -1, 1);
    input.bank = EW.clamp(input.bank, -1, 1);
    return input;
  }

  // ------------------------------------------------------------ simulation

  function stepSim(dt) {
    var plane = game.plane;
    var world = game.world;
    var flying = game.state === 'flying';
    var input = flying ? playerInput() : autopilotInput();
    EW.stepFlight(plane, input, world, dt, game.save.upgrades, game.time);
    drainEvents();

    if (flying) {
      stepObjectives(dt);
      game.timeLeft -= dt;
      if (game.timeLeft <= 0 && game.state === 'flying') {
        game.timeLeft = 0;
        failMission('Out of time — the mail run was called off and the villages are still waiting.');
      }
      if (game.endTimer > 0) {
        game.endTimer -= dt;
        if (game.endTimer <= 0 && game.state === 'flying') failMission(game.failReason);
      }
      EW.Sound.stallWarning(dt, plane.stalled);
    } else {
      // demo mode: loop the rings forever
      if (game.nextRing >= world.rings.length) {
        world.rings.forEach(function (r) { r.passed = false; });
        game.nextRing = 0;
      }
      if (plane.dead) {
        game.plane = EW.newPlane(world);
      }
      stepObjectives(dt);
    }

    // damage smoke and fire
    game.smokeClock -= dt;
    if (!plane.dead && plane.hull < 55 && game.smokeClock <= 0) {
      game.smokeClock = 0.06;
      spawnParticle(plane.x, plane.y, plane.z + 0.4, 0, 0, 1.5, 1.4, 1.6, '#5a5f6a', 0.5, 1.2);
      if (plane.hull < 28) {
        spawnParticle(plane.x, plane.y, plane.z + 0.4, 0, 0, 2, 0.5, 1.6, '#ff8c3c', 0.85, 2);
      }
    }
    // volcano smoke plume
    game.volcanoClock -= dt;
    if (game.volcanoClock <= 0) {
      game.volcanoClock = 0.4;
      var v = world.volcano;
      spawnParticle(
        v.x + (Math.random() - 0.5) * 30, v.y + (Math.random() - 0.5) * 30, v.h * 0.82,
        Math.sin(world.windDir) * world.windSpeed * 0.6, Math.cos(world.windDir) * world.windSpeed * 0.6, 7,
        5, 7, '#8a8f98', 0.32, 1.1
      );
    }
    // clouds drift with the wind
    world.clouds.forEach(function (cloud) {
      cloud.x += Math.sin(world.windDir) * world.windSpeed * 0.55 * dt;
      cloud.y += Math.cos(world.windDir) * world.windSpeed * 0.55 * dt;
      if (cloud.x > 3400) cloud.x = -3400;
      if (cloud.x < -3400) cloud.x = 3400;
      if (cloud.y > 3400) cloud.y = -3400;
      if (cloud.y < -3400) cloud.y = 3400;
    });
    stepParticles(dt);
    if (game.message) {
      game.message.t -= dt;
      if (game.message.t <= 0) game.message = null;
    }
    game.shake = Math.max(0, game.shake - dt * 1.6);
  }

  // ------------------------------------------------------------ rendering

  function render() {
    game.buttons = [];
    ctx.save();
    if (game.shake > 0.02) {
      ctx.translate((Math.random() - 0.5) * game.shake * 14, (Math.random() - 0.5) * game.shake * 14);
    }
    EW.drawWorld(ctx, game, VIEW_W, VIEW_H);
    if (!game.plane.dead) {
      EW.drawPlane(ctx, game.cam, VIEW_W, VIEW_H, game.plane, game.world);
    }
    ctx.restore();

    if (game.state === 'flying' || game.state === 'paused') {
      EW.drawHUD(ctx, game, VIEW_W, VIEW_H);
    }
    if (game.state === 'title') EW.drawTitle(ctx, game, VIEW_W, VIEW_H);
    else if (game.state === 'briefing') EW.drawBriefing(ctx, game, VIEW_W, VIEW_H);
    else if (game.state === 'howto') EW.drawHowTo(ctx, game, VIEW_W, VIEW_H);
    else if (game.state === 'paused') EW.drawPause(ctx, game, VIEW_W, VIEW_H);
    else if (game.state === 'complete') EW.drawComplete(ctx, game, VIEW_W, VIEW_H);
    else if (game.state === 'failed') EW.drawFailed(ctx, game, VIEW_W, VIEW_H);
  }

  // ------------------------------------------------------------ input

  function handleButton(id) {
    EW.Sound.init();
    EW.Sound.click();
    if (id.indexOf('mission:') === 0) {
      game.selectedMission = parseInt(id.slice(8), 10);
      return;
    }
    if (id.indexOf('buy:') === 0) {
      var key = id.slice(4);
      var row = EW.UPGRADE_ROWS.find(function (r) { return r.key === key; });
      var level = game.save.upgrades[key];
      if (row && level < 3 && game.save.coins >= row.costs[level]) {
        game.save.coins -= row.costs[level];
        game.save.upgrades[key]++;
        storeSave();
        EW.Sound.buy();
      } else {
        EW.Sound.denied();
      }
      return;
    }
    switch (id) {
      case 'fly':
        game.state = 'briefing';
        break;
      case 'howto':
        game.state = 'howto';
        break;
      case 'sound':
        game.save.muted = !game.save.muted;
        EW.Sound.setMuted(game.save.muted);
        storeSave();
        break;
      case 'launch':
        startMission(game.selectedMission);
        break;
      case 'back':
        game.state = 'title';
        break;
      case 'resume':
        game.state = 'flying';
        break;
      case 'restart':
        startMission(game.selectedMission);
        break;
      case 'replay':
        startMission(game.selectedMission);
        break;
      case 'next':
        game.selectedMission = Math.min(game.selectedMission + 1, EW.COURSES.length - 1);
        game.state = 'briefing';
        break;
      case 'quit':
        game.state = 'title';
        startDemo();
        break;
    }
  }

  function canvasPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * VIEW_W,
      y: ((ev.clientY - rect.top) / rect.height) * VIEW_H,
    };
  }

  canvas.addEventListener('mousemove', function (ev) {
    var p = canvasPos(ev);
    game.mouse.x = p.x;
    game.mouse.y = p.y;
  });
  canvas.addEventListener('mousedown', function (ev) {
    EW.Sound.init();
    var p = canvasPos(ev);
    game.mouse.x = p.x;
    game.mouse.y = p.y;
    game.mouse.down = true;
    game.mouse.dragX = p.x;
    game.mouse.dragY = p.y;
    for (var i = 0; i < game.buttons.length; i++) {
      var b = game.buttons[i];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        handleButton(b.id);
        break;
      }
    }
  });
  window.addEventListener('mouseup', function () {
    game.mouse.down = false;
  });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    if (game.state === 'flying') {
      game.plane.throttle = EW.clamp(game.plane.throttle - ev.deltaY * 0.0006, 0, 1);
    }
  }, { passive: false });

  window.addEventListener('keydown', function (ev) {
    EW.Sound.init();
    var code = ev.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(code) >= 0) ev.preventDefault();
    if (ev.repeat) {
      game.keys[code] = true;
      return;
    }
    game.keys[code] = true;
    if (code === 'KeyM') {
      game.save.muted = !game.save.muted;
      EW.Sound.setMuted(game.save.muted);
      storeSave();
    }
    if (code === 'Space' && game.state === 'flying') dropParcel();
    if ((code === 'KeyP' || code === 'Escape')) {
      if (game.state === 'flying') game.state = 'paused';
      else if (game.state === 'paused') game.state = 'flying';
    }
    if (code === 'Enter') {
      if (game.state === 'title') game.state = 'briefing';
      else if (game.state === 'briefing') startMission(game.selectedMission);
      else if (game.state === 'complete') handleButton('next');
      else if (game.state === 'failed') startMission(game.selectedMission);
    }
    if (code === 'KeyR' && (game.state === 'failed' || game.state === 'paused')) {
      startMission(game.selectedMission);
    }
  });
  window.addEventListener('keyup', function (ev) {
    game.keys[ev.code] = false;
  });

  // ------------------------------------------------------------ shot staging

  function stageShot() {
    if (!shotMode) return;
    if (shotMode === 'flight') {
      startMission(shotMission);
      var ring = game.world.rings[0];
      if (ring) {
        game.plane.x = ring.x - ring.nx * 300;
        game.plane.y = ring.y - ring.ny * 300;
        game.plane.z = ring.z + 4;
        game.plane.heading = Math.atan2(ring.nx, ring.ny);
        game.plane.speed = 40;
        game.plane.throttle = 0.68;
        game.plane.bank = 0.1;
      }
      game.autopilot = true;
    } else if (shotMode === 'briefing') {
      game.selectedMission = shotMission;
      game.state = 'briefing';
    } else if (shotMode === 'complete') {
      game.selectedMission = shotMission;
      game.world = EW.buildWorld(shotMission, seedOverride);
      game.plane = EW.newPlane(game.world);
      var course = game.world.course;
      var ringScore = course.rings * 115;
      var parcelScore = course.parcels * 125;
      var total = ringScore + parcelScore + 200 + 415 + 96;
      game.result = {
        ringScore: ringScore,
        parcelScore: parcelScore,
        landingScore: 200,
        timeBonus: 415,
        fuelBonus: 96,
        total: total,
        grade: total >= course.par ? 'S' : 'A',
        coinsEarned: Math.round(total / 10),
      };
      game.save.coins += game.result.coinsEarned; // staging only; not stored
      game.state = 'complete';
    } else if (shotMode === 'failed') {
      game.selectedMission = shotMission;
      game.world = EW.buildWorld(shotMission, seedOverride);
      game.plane = EW.newPlane(game.world);
      game.failReason = 'She went in hard. The mail is scattered across the hillside.';
      game.score = 640;
      game.ringsDone = 3;
      game.parcelsDone = 1;
      game.state = 'failed';
    }
    // 'title' needs nothing: the demo is already running.
  }

  // ------------------------------------------------------------ main loop

  startDemo();
  stageShot();

  var last = performance.now();
  var accumulator = 0;
  var STEP = 1 / 60;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    accumulator += dt;
    var steps = 0;
    var simStates = ['flying', 'title', 'briefing', 'howto'];
    while (accumulator >= STEP && steps < 5) {
      if (simStates.indexOf(game.state) >= 0) {
        if (game.autopilot && game.state === 'flying') {
          var saved = game.state;
          game.state = 'demo';
          stepSim(STEP);
          game.state = saved;
        } else {
          stepSim(STEP);
        }
        game.time += STEP;
      }
      accumulator -= STEP;
      steps++;
    }
    if (steps === 5) accumulator = 0;
    EW.updateCamera(game.cam, game.plane, Math.max(dt, 0.001), VIEW_H);
    if (game.state === 'flying') {
      EW.Sound.setEngine(game.plane.throttle, EW.clamp(game.plane.speed / 70, 0, 1), !game.plane.dead && game.plane.fuel > 0);
    } else {
      EW.Sound.setEngine(0, 0, false);
    }
    render();
    if (shotMode) {
      game.shotClock += dt;
      var readyAt = shotMode === 'flight' ? 3.0 : 0.6;
      if (game.shotClock >= readyAt) window.__shotReady = true;
    }
  }
  requestAnimationFrame(frame);
})();
