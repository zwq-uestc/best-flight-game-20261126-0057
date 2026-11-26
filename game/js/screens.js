// screens.js — Emberwing Post's menus and end-of-mission screens: title
// with mission select, briefing card, pause, mission complete with the
// upgrade shop, mission failed, and the how-to-fly page. Buttons register
// themselves in game.buttons for the mouse handler in main.js.

function panel(ctx, x, y, w, h, alpha) {
  ctx.fillStyle = 'rgba(10,16,28,' + (alpha === undefined ? 0.9 : alpha) + ')';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,210,62,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

EW.uiButton = function (ctx, game, x, y, w, h, id, label, opts) {
  opts = opts || {};
  var hover = game.mouse.x >= x && game.mouse.x <= x + w && game.mouse.y >= y && game.mouse.y <= y + h;
  var disabled = !!opts.disabled;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 9);
  ctx.fillStyle = disabled ? 'rgba(40,48,66,0.9)' : hover ? '#c98f1d' : 'rgba(28,38,58,0.95)';
  ctx.fill();
  ctx.strokeStyle = disabled ? 'rgba(140,150,170,0.4)' : '#ffd23e';
  ctx.lineWidth = hover && !disabled ? 2.4 : 1.4;
  ctx.stroke();
  ctx.fillStyle = disabled ? '#7d8aa0' : hover ? '#14100a' : '#f2ead8';
  ctx.font = 'bold ' + (opts.fontSize || 17) + 'px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  if (!disabled) game.buttons.push({ x: x, y: y, w: w, h: h, id: id });
  return hover;
};

function dim(ctx, viewW, viewH, alpha) {
  ctx.fillStyle = 'rgba(4,8,16,' + alpha + ')';
  ctx.fillRect(0, 0, viewW, viewH);
}

EW.drawTitle = function (ctx, game, viewW, viewH) {
  dim(ctx, viewW, viewH, 0.38);
  var cx = viewW / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 64px Arial';
  ctx.fillText('EMBERWING POST', cx, 96);
  ctx.fillStyle = '#f2ead8';
  ctx.font = 'italic 19px Arial';
  ctx.fillText('Deliver the mail. Thread the rings. Bring her home.', cx, 126);

  // mission select cards
  var cardW = 268;
  var cardH = 104;
  var gap = 16;
  var startX = cx - (cardW * 3 + gap * 2) / 2;
  var startY = 156;
  EW.COURSES.forEach(function (course, i) {
    var x = startX + (i % 3) * (cardW + gap);
    var y = startY + Math.floor(i / 3) * (cardH + gap);
    var locked = i > game.save.unlocked;
    var selected = i === game.selectedMission;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 12);
    ctx.fillStyle = locked ? 'rgba(24,30,44,0.88)' : selected ? 'rgba(66,52,16,0.95)' : 'rgba(16,24,40,0.92)';
    ctx.fill();
    ctx.strokeStyle = selected ? '#ffd23e' : 'rgba(160,180,220,0.4)';
    ctx.lineWidth = selected ? 3 : 1.4;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = locked ? '#6d7a90' : '#ffd23e';
    ctx.font = 'bold 17px Arial';
    ctx.fillText((i + 1) + '. ' + course.name, x + 14, y + 28);
    ctx.fillStyle = locked ? '#5d6a80' : '#cfd8e6';
    ctx.font = '12.5px Arial';
    var bits = [];
    if (course.rings) bits.push(course.rings + ' rings');
    if (course.parcels) bits.push(course.parcels + ' parcels');
    bits.push(course.palette);
    ctx.fillText(bits.join(' · '), x + 14, y + 50);
    var best = game.save.best[i];
    ctx.font = '12.5px Arial';
    if (locked) {
      ctx.fillText('Locked — finish the previous run', x + 14, y + 74);
    } else if (best) {
      ctx.fillStyle = '#57e389';
      ctx.fillText('Best ' + best.score + '  ·  Grade ' + best.grade, x + 14, y + 74);
    } else {
      ctx.fillText('Not flown yet', x + 14, y + 74);
    }
    ctx.fillStyle = '#8fa0bd';
    ctx.fillText('Par ' + course.par + ' · ' + EW.formatClock(course.timeLimit), x + 14, y + 92);
    if (!locked) game.buttons.push({ x: x, y: y, w: cardW, h: cardH, id: 'mission:' + i });
  });

  var by = startY + 2 * (cardH + gap) + 18;
  EW.uiButton(ctx, game, cx - 330, by, 200, 52, 'fly', 'FLY  ▶');
  EW.uiButton(ctx, game, cx - 100, by, 200, 52, 'howto', 'HOW TO FLY');
  EW.uiButton(ctx, game, cx + 130, by, 200, 52, 'sound', game.save.muted ? 'SOUND: OFF' : 'SOUND: ON');

  ctx.fillStyle = '#aebad0';
  ctx.font = '13px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(
    'Arrows / WASD fly · Shift/Ctrl throttle · Space drops a parcel · B brake · P pause · M mute · mouse drag steers, wheel throttles',
    cx, by + 86
  );
  ctx.fillText('Coins: ' + game.save.coins + '   ·   Campaign best total: ' + game.save.campaignBest, cx, by + 108);
};

EW.drawBriefing = function (ctx, game, viewW, viewH) {
  dim(ctx, viewW, viewH, 0.45);
  var course = EW.COURSES[game.selectedMission];
  var cx = viewW / 2;
  var w = 560;
  var h = 380;
  var x = cx - w / 2;
  var y = viewH / 2 - h / 2 - 20;
  panel(ctx, x, y, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 30px Arial';
  ctx.fillText(course.name.toUpperCase(), cx, y + 48);
  ctx.fillStyle = '#f2ead8';
  ctx.font = 'italic 15px Arial';
  wrapText(ctx, course.blurb, cx, y + 78, w - 70, 20);
  ctx.textAlign = 'left';
  ctx.font = '16px Arial';
  var lines = [];
  if (course.rings) lines.push('• Thread ' + course.rings + ' rings in order');
  if (course.parcels) lines.push('• Drop ' + course.parcels + ' parcels into the beacon rings (Space)');
  lines.push('• Land back at the home strip');
  lines.push('• Wind ' + course.windDir + '° at ' + Math.round(course.windSpeed * 1.944) + ' kt' + (course.gust > 0.5 ? ', gusty' : ''));
  lines.push('• Fuel ' + course.startFuel + '%' + (course.fuelCans ? '  ·  ' + course.fuelCans + ' fuel cans floating out there' : ''));
  lines.push('• Beat ' + EW.formatClock(course.timeLimit) + '  ·  Par score ' + course.par);
  lines.forEach(function (line, i) {
    ctx.fillStyle = '#e8eef8';
    ctx.fillText(line, x + 44, y + 150 + i * 26);
  });
  var best = game.save.best[game.selectedMission];
  ctx.fillStyle = '#8fa0bd';
  ctx.font = '14px Arial';
  ctx.fillText(best ? 'Your best: ' + best.score + ' (Grade ' + best.grade + ')' : 'First flight on this run.', x + 44, y + 150 + lines.length * 26 + 8);
  EW.uiButton(ctx, game, cx - 230, y + h - 72, 200, 50, 'launch', 'LAUNCH');
  EW.uiButton(ctx, game, cx + 30, y + h - 72, 200, 50, 'back', 'BACK');
};

EW.drawPause = function (ctx, game, viewW, viewH) {
  dim(ctx, viewW, viewH, 0.55);
  var cx = viewW / 2;
  var cy = viewH / 2;
  panel(ctx, cx - 210, cy - 150, 420, 300);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 34px Arial';
  ctx.fillText('PAUSED', cx, cy - 92);
  EW.uiButton(ctx, game, cx - 140, cy - 56, 280, 48, 'resume', 'RESUME');
  EW.uiButton(ctx, game, cx - 140, cy + 4, 280, 48, 'restart', 'RESTART MISSION');
  EW.uiButton(ctx, game, cx - 140, cy + 64, 280, 48, 'quit', 'QUIT TO TITLE');
};

var UPGRADE_ROWS = [
  { key: 'engine', name: 'Engine', desc: '+9% power & speed', costs: [60, 120, 220] },
  { key: 'tank', name: 'Fuel Tank', desc: '+25% fuel capacity', costs: [50, 110, 200] },
  { key: 'plating', name: 'Plating', desc: '-20% damage taken', costs: [50, 110, 200] },
  { key: 'wings', name: 'Wings', desc: '+13% turn rate', costs: [55, 115, 210] },
];
EW.UPGRADE_ROWS = UPGRADE_ROWS;

EW.drawComplete = function (ctx, game, viewW, viewH) {
  dim(ctx, viewW, viewH, 0.5);
  var cx = viewW / 2;
  var w = 640;
  var h = 520;
  var x = cx - w / 2;
  var y = viewH / 2 - h / 2;
  panel(ctx, x, y, w, h);
  var r = game.result;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#57e389';
  ctx.font = 'bold 32px Arial';
  ctx.fillText('MISSION COMPLETE', cx, y + 46);
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 54px Arial';
  ctx.fillText(r.grade, cx + 238, y + 58);
  ctx.font = '12px Arial';
  ctx.fillText('GRADE', cx + 238, y + 76);

  ctx.textAlign = 'left';
  ctx.font = '16px Arial';
  var rows = [
    ['Rings', r.ringScore],
    ['Parcels', r.parcelScore],
    ['Landing', r.landingScore],
    ['Time bonus', r.timeBonus],
    ['Fuel bonus', r.fuelBonus],
  ];
  rows.forEach(function (row, i) {
    ctx.fillStyle = '#cfd8e6';
    ctx.fillText(row[0], x + 48, y + 96 + i * 24);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(row[1]), x + 330, y + 96 + i * 24);
    ctx.textAlign = 'left';
  });
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 19px Arial';
  ctx.fillText('TOTAL', x + 48, y + 96 + rows.length * 24 + 6);
  ctx.textAlign = 'right';
  ctx.fillText(String(r.total), x + 330, y + 96 + rows.length * 24 + 6);
  ctx.textAlign = 'left';
  ctx.font = '14px Arial';
  ctx.fillStyle = '#8fa0bd';
  ctx.fillText('+' + r.coinsEarned + ' coins earned · balance ' + game.save.coins, x + 48, y + 96 + rows.length * 24 + 30);

  // upgrade shop
  var shopY = y + 292;
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 17px Arial';
  ctx.fillText('WORKSHOP — spend coins on the Emberwing', x + 48, shopY);
  UPGRADE_ROWS.forEach(function (row, i) {
    var ry = shopY + 14 + i * 40;
    var level = game.save.upgrades[row.key];
    ctx.fillStyle = '#e8eef8';
    ctx.font = 'bold 15px Arial';
    ctx.fillText(row.name, x + 48, ry + 20);
    ctx.fillStyle = '#8fa0bd';
    ctx.font = '12px Arial';
    ctx.fillText(row.desc, x + 170, ry + 20);
    for (var p = 0; p < 3; p++) {
      ctx.beginPath();
      ctx.arc(x + 352 + p * 20, ry + 15, 6, 0, EW.TAU);
      ctx.fillStyle = p < level ? '#57e389' : '#33405c';
      ctx.fill();
    }
    if (level >= 3) {
      ctx.fillStyle = '#57e389';
      ctx.font = 'bold 13px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('MAX', x + 500, ry + 20);
      ctx.textAlign = 'left';
    } else {
      var cost = row.costs[level];
      EW.uiButton(ctx, game, x + 448, ry, 120, 30, 'buy:' + row.key, cost + ' coins', {
        fontSize: 13,
        disabled: game.save.coins < cost,
      });
    }
  });

  var by = y + h - 58;
  if (game.selectedMission < EW.COURSES.length - 1) {
    EW.uiButton(ctx, game, cx - 310, by, 190, 44, 'next', 'NEXT MISSION');
  }
  EW.uiButton(ctx, game, cx - 95, by, 190, 44, 'replay', 'FLY AGAIN');
  EW.uiButton(ctx, game, cx + 120, by, 190, 44, 'quit', 'TITLE');
};

EW.drawFailed = function (ctx, game, viewW, viewH) {
  dim(ctx, viewW, viewH, 0.55);
  var cx = viewW / 2;
  var cy = viewH / 2;
  panel(ctx, cx - 270, cy - 170, 540, 340);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff5a4e';
  ctx.font = 'bold 32px Arial';
  ctx.fillText('MISSION FAILED', cx, cy - 108);
  ctx.fillStyle = '#f2ead8';
  ctx.font = '17px Arial';
  wrapText(ctx, game.failReason || 'The run did not make it home.', cx, cy - 72, 460, 22);
  ctx.fillStyle = '#cfd8e6';
  ctx.font = '15px Arial';
  ctx.fillText('Score before the end: ' + game.score, cx, cy - 6);
  ctx.fillText(
    'Rings ' + game.ringsDone + '/' + game.world.rings.length +
    '   ·   Parcels ' + game.parcelsDone + '/' + game.world.zones.length,
    cx, cy + 20
  );
  EW.uiButton(ctx, game, cx - 220, cy + 58, 200, 50, 'restart', 'TRY AGAIN');
  EW.uiButton(ctx, game, cx + 20, cy + 58, 200, 50, 'quit', 'TITLE');
};

EW.drawHowTo = function (ctx, game, viewW, viewH) {
  dim(ctx, viewW, viewH, 0.6);
  var cx = viewW / 2;
  var w = 640;
  var h = 470;
  var x = cx - w / 2;
  var y = viewH / 2 - h / 2;
  panel(ctx, x, y, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 28px Arial';
  ctx.fillText('HOW TO FLY', cx, y + 46);
  ctx.textAlign = 'left';
  ctx.font = '15.5px Arial';
  var lines = [
    ['↑ / W', 'climb (nose up)'],
    ['↓ / S', 'dive (nose down)'],
    ['← → / A D', 'bank left / right — banking turns you'],
    ['Shift / Ctrl', 'throttle up / down (mouse wheel works too)'],
    ['Space', 'drop a parcel over a beacon ring'],
    ['B', 'air brake — handy on final approach'],
    ['Mouse drag', 'steer by dragging'],
    ['P / Esc', 'pause'],
    ['M', 'mute'],
    ['F', 'toggle cinematic FX (grade, grain, flare)'],
  ];
  lines.forEach(function (line, i) {
    ctx.fillStyle = '#ffd23e';
    ctx.font = 'bold 15.5px Arial';
    ctx.fillText(line[0], x + 48, y + 92 + i * 27);
    ctx.fillStyle = '#e8eef8';
    ctx.font = '15.5px Arial';
    ctx.fillText(line[1], x + 210, y + 92 + i * 27);
  });
  ctx.fillStyle = '#8fa0bd';
  ctx.font = '13.5px Arial';
  wrapText(
    ctx,
    'Fly slowly and she stalls — the nose drops until speed returns. Climbing trades speed for height; diving buys it back. Land gently on the strip: slow, level, lined up with the runway. Watch the fuel gauge, and mind the wind on the compass.',
    cx, y + 92 + lines.length * 27 + 16, w - 90, 19
  );
  EW.uiButton(ctx, game, cx - 100, y + h - 62, 200, 46, 'back', 'BACK');
};

function wrapText(ctx, text, cx, y, maxWidth, lineHeight) {
  var words = text.split(' ');
  var line = '';
  var yy = y;
  ctx.textAlign = 'center';
  words.forEach(function (word) {
    var test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, cx, yy);
      yy += lineHeight;
      line = word;
    } else {
      line = test;
    }
  });
  if (line) ctx.fillText(line, cx, yy);
  return yy;
}
