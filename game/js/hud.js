// hud.js — Emberwing Post's cockpit instruments and flight HUD: round
// airspeed and altimeter gauges with needles, a compass tape, throttle /
// fuel / hull bars, score, timer, objective arrow, warnings and a minimap.

function gaugeFace(ctx, x, y, r, label) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, EW.TAU);
  ctx.fillStyle = '#141a26';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3d4a63';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r - 4, 0, EW.TAU);
  ctx.strokeStyle = 'rgba(255,230,170,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#e8ddc0';
  ctx.font = 'bold ' + Math.round(r * 0.24) + 'px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y + r * 0.52);
  // glass highlight
  ctx.beginPath();
  ctx.ellipse(x - r * 0.32, y - r * 0.38, r * 0.4, r * 0.2, -0.6, 0, EW.TAU);
  ctx.fillStyle = 'rgba(200,225,255,0.10)';
  ctx.fill();
}

function gaugeNeedle(ctx, x, y, r, t, color) {
  var a = Math.PI * 0.75 + EW.clamp(t, 0, 1) * Math.PI * 1.5;
  var nx = x + Math.cos(a) * r * 0.78;
  var ny = y + Math.sin(a) * r * 0.78;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, r * 0.06);
  ctx.beginPath();
  ctx.moveTo(x - Math.cos(a) * r * 0.16, y - Math.sin(a) * r * 0.16);
  ctx.lineTo(nx, ny);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.1, 0, EW.TAU);
  ctx.fillStyle = '#d8d2c2';
  ctx.fill();
}

function gaugeTicks(ctx, x, y, r, count, redFrom) {
  ctx.font = Math.round(r * 0.2) + 'px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (var i = 0; i <= count; i++) {
    var t = i / count;
    var a = Math.PI * 0.75 + t * Math.PI * 1.5;
    var x1 = x + Math.cos(a) * r * 0.86;
    var y1 = y + Math.sin(a) * r * 0.86;
    var x2 = x + Math.cos(a) * r * 0.7;
    var y2 = y + Math.sin(a) * r * 0.7;
    ctx.strokeStyle = redFrom !== undefined && t >= redFrom ? '#ff5a4e' : '#cfd6c8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.textBaseline = 'alphabetic';
}

EW.drawGauge = function (ctx, x, y, r, value, max, label, redFrom) {
  gaugeFace(ctx, x, y, r, label);
  gaugeTicks(ctx, x, y, r, 8, redFrom);
  gaugeNeedle(ctx, x, y, r, value / max, '#ffb03a');
  ctx.fillStyle = '#ffe9b0';
  ctx.font = 'bold ' + Math.round(r * 0.3) + 'px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(value)), x, y + r * 0.34);
};

function hudBar(ctx, x, y, w, h, t, color, label, warn) {
  ctx.fillStyle = 'rgba(10,14,22,0.72)';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = '#232c3e';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = warn ? '#ff5a4e' : color;
  ctx.fillRect(x, y, w * EW.clamp(t, 0, 1), h);
  ctx.strokeStyle = 'rgba(220,230,250,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#e8eef8';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y - 6);
}

EW.drawCompassTape = function (ctx, viewW, plane) {
  var w = 340;
  var x = viewW / 2 - w / 2;
  var y = 14;
  ctx.fillStyle = 'rgba(10,14,22,0.72)';
  ctx.fillRect(x, y, w, 34);
  ctx.strokeStyle = 'rgba(220,230,250,0.45)';
  ctx.strokeRect(x, y, w, 34);
  var hdg = EW.headingDeg(plane.heading);
  var pxPerDeg = w / 90;
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  for (var d = -45; d <= 45; d += 5) {
    var deg = ((Math.round(hdg / 5) * 5 + d) % 360 + 360) % 360;
    var sx = viewW / 2 + (EW.angleDelta(deg * EW.DEG, plane.heading) / EW.DEG) * pxPerDeg;
    if (sx < x + 4 || sx > x + w - 4) continue;
    var major = deg % 30 === 0;
    ctx.strokeStyle = '#cfd6c8';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(sx, y + 26);
    ctx.lineTo(sx, y + (major ? 16 : 21));
    ctx.stroke();
    if (major) {
      var label = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(deg / 10);
      ctx.fillStyle = deg === 0 ? '#ffb03a' : '#e8eef8';
      ctx.fillText(label, sx, y + 13);
    }
  }
  ctx.fillStyle = '#ffb03a';
  ctx.beginPath();
  ctx.moveTo(viewW / 2 - 6, y + 34);
  ctx.lineTo(viewW / 2 + 6, y + 34);
  ctx.lineTo(viewW / 2, y + 42);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 15px Arial';
  ctx.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', viewW / 2, y + 58);
};

EW.drawMinimap = function (ctx, game, x, y, size) {
  var world = game.world;
  var plane = game.plane;
  var range = 2800;
  function mx(wx) { return x + size / 2 + (wx / range) * (size / 2); }
  function my(wy) { return y + size / 2 - (wy / range) * (size / 2); }
  ctx.fillStyle = 'rgba(8,18,34,0.78)';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = 'rgba(220,230,250,0.45)';
  ctx.strokeRect(x, y, size, size);
  // islands as soft blobs
  world.bumps.forEach(function (b) {
    var r = (b.r / range) * (size / 2);
    ctx.beginPath();
    ctx.arc(mx(b.x), my(b.y), r, 0, EW.TAU);
    ctx.fillStyle = 'rgba(70,130,80,0.5)';
    ctx.fill();
  });
  // runway
  var rw = world.runway;
  var a = EW.runwayPoint(world, -rw.len / 2, 0, 0);
  var b2 = EW.runwayPoint(world, rw.len / 2, 0, 0);
  ctx.strokeStyle = '#f2f2ee';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(mx(a.x), my(a.y));
  ctx.lineTo(mx(b2.x), my(b2.y));
  ctx.stroke();
  // rings
  world.rings.forEach(function (ring, idx) {
    ctx.beginPath();
    ctx.arc(mx(ring.x), my(ring.y), idx === game.nextRing ? 4.5 : 3, 0, EW.TAU);
    ctx.fillStyle = ring.passed ? '#57e389' : idx === game.nextRing ? '#ffd23e' : 'rgba(232,242,255,0.75)';
    ctx.fill();
  });
  // zones
  world.zones.forEach(function (zone) {
    ctx.fillStyle = zone.delivered ? '#57e389' : '#ff8c3c';
    ctx.fillRect(mx(zone.x) - 3.5, my(zone.y) - 3.5, 7, 7);
  });
  // plane arrow
  var px = mx(plane.x);
  var py = my(plane.y);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(plane.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(4.5, 5);
  ctx.lineTo(0, 2.5);
  ctx.lineTo(-4.5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#e8eef8';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('N', x + size / 2, y + 11);
};

EW.drawHUD = function (ctx, game, viewW, viewH) {
  var plane = game.plane;
  var world = game.world;
  var knots = plane.speed * 1.944;
  var altFt = plane.z * 3.281;

  // gauges: airspeed left, altimeter right
  EW.drawGauge(ctx, 86, viewH - 86, 64, knots, 200, 'KNOTS', 0.82);
  EW.drawGauge(ctx, viewH * 0 + viewW - 86, viewH - 86, 64, altFt, 2000, 'ALT FT');
  // vertical speed readout under the altimeter
  ctx.fillStyle = '#ffe9b0';
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'center';
  var vsFpm = Math.round(plane.vspeed * 196.85);
  ctx.fillText((vsFpm >= 0 ? '+' : '') + vsFpm + ' fpm', viewW - 86, viewH - 8);

  EW.drawCompassTape(ctx, viewW, plane);

  // mission + objective, top left
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(10,14,22,0.66)';
  ctx.fillRect(12, 12, 330, 66);
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 16px Arial';
  ctx.fillText(world.course.name.toUpperCase(), 22, 34);
  ctx.fillStyle = '#e8eef8';
  ctx.font = '13px Arial';
  ctx.fillText(game.objectiveText, 22, 54);
  var timeLeft = game.timeLeft;
  ctx.fillStyle = timeLeft < 30 ? '#ff5a4e' : '#e8eef8';
  ctx.font = 'bold 15px Arial';
  ctx.fillText('TIME ' + EW.formatClock(timeLeft), 22, 72);

  // score + coins, top right
  ctx.fillStyle = 'rgba(10,14,22,0.66)';
  ctx.fillRect(viewW - 212, 12, 200, 52);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial';
  ctx.fillText(String(game.score), viewW - 24, 38);
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 13px Arial';
  ctx.fillText('SCORE   ' + game.coins + ' COINS', viewW - 24, 56);

  EW.drawMinimap(ctx, game, viewW - 166, 74, 154);

  // bars bottom center
  var bw = 190;
  var bx = viewW / 2 - bw / 2;
  hudBar(ctx, bx, viewH - 96, bw, 11, plane.throttle, '#57b6e3', 'THROTTLE');
  hudBar(ctx, bx, viewH - 66, bw, 11, plane.fuel / 100, '#ffd23e', 'FUEL', plane.fuel < 22);
  hudBar(ctx, bx, viewH - 36, bw, 11, plane.hull / 100, '#57e389', 'HULL', plane.hull < 30);

  // wind readout
  ctx.fillStyle = '#e8eef8';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(
    'WIND ' + String(Math.round(EW.headingDeg(world.windDir))).padStart(3, '0') + '° ' + Math.round(world.windSpeed * 1.944) + 'kt',
    viewW / 2, viewH - 126
  );

  // next-objective arrow + distance, center bottom above bars
  if (game.target) {
    var dx = game.target.x - plane.x;
    var dy = game.target.y - plane.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var bearing = Math.atan2(dx, dy);
    var rel = EW.angleDelta(bearing, plane.heading);
    var ax = viewW / 2;
    var ay = viewH - 176;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(rel);
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(8, 8);
    ctx.lineTo(0, 3);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px Arial';
    ctx.fillText(game.targetLabel + ' ' + Math.round(dist) + 'm', ax, ay + 26);
  }

  // pitch ladder (small, center)
  ctx.strokeStyle = 'rgba(255,233,176,0.55)';
  ctx.lineWidth = 1.4;
  var cx = viewW / 2;
  var cy = viewH / 2;
  var pitchOff = plane.pitch * 130;
  ctx.beginPath();
  ctx.moveTo(cx - 46, cy - pitchOff);
  ctx.lineTo(cx - 16, cy - pitchOff);
  ctx.moveTo(cx + 16, cy - pitchOff);
  ctx.lineTo(cx + 46, cy - pitchOff);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx - 3, cy);
  ctx.lineTo(cx, cy + 4);
  ctx.lineTo(cx + 3, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.stroke();

  // warnings
  var blink = Math.floor(game.time * 3) % 2 === 0;
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  if (plane.stalled && blink) {
    ctx.fillStyle = '#ff5a4e';
    ctx.fillText('STALL', cx, cy - 74);
  } else if (plane.fuel <= 0 && blink) {
    ctx.fillStyle = '#ff5a4e';
    ctx.fillText('ENGINE OUT — GLIDE!', cx, cy - 74);
  } else if (plane.fuel < 18 && blink) {
    ctx.fillStyle = '#ffb03a';
    ctx.fillText('LOW FUEL', cx, cy - 74);
  }

  // transient message banner, with a scale-in pop when it appears
  if (game.message && game.message.t > 0) {
    var alpha = EW.clamp(game.message.t, 0, 1);
    var age = 2.4 - game.message.t;
    var popT = EW.clamp(age / 0.22, 0, 1);
    var u = popT - 1;
    var pop = 1 + 2.70158 * u * u * u + 1.70158 * u * u; // easeOutBack
    var fontSize = Math.round(26 * pop);
    ctx.globalAlpha = alpha;
    ctx.font = 'bold ' + fontSize + 'px Arial';
    var mw = ctx.measureText(game.message.text).width;
    ctx.fillStyle = 'rgba(10,14,22,0.7)';
    ctx.fillRect(cx - mw / 2 - 18, cy - 150, mw + 36, 42);
    ctx.fillStyle = game.message.color || '#ffd23e';
    ctx.fillText(game.message.text, cx, cy - 120);
    ctx.globalAlpha = 1;
  }
};
