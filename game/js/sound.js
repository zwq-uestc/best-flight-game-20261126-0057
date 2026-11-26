// sound.js — all of Emberwing Post's audio, synthesized with WebAudio.
// No audio files: the engine hum, chimes, whistles and thuds are oscillators
// and filtered noise. The context is created on the first user gesture
// (browser policy); every call is a safe no-op before that.

EW.Sound = (function () {
  var ctx = null;
  var master = null;
  var engineOscA = null;
  var engineOscB = null;
  var engineFilter = null;
  var engineGain = null;
  var washSource = null;
  var washGain = null;
  var muted = false;
  var stallTimer = 0;

  function noiseBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ctx.destination);

    // Engine: two detuned oscillators through a lowpass, pitch follows power.
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineFilter.Q.value = 2.2;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOscA = ctx.createOscillator();
    engineOscA.type = 'sawtooth';
    engineOscA.frequency.value = 62;
    engineOscB = ctx.createOscillator();
    engineOscB.type = 'square';
    engineOscB.frequency.value = 31;
    engineOscA.connect(engineFilter);
    engineOscB.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOscA.start();
    engineOscB.start();

    // Prop wash / wind: looped noise through a bandpass, gain follows speed.
    washSource = ctx.createBufferSource();
    washSource.buffer = noiseBuffer(2);
    washSource.loop = true;
    var washFilter = ctx.createBiquadFilter();
    washFilter.type = 'bandpass';
    washFilter.frequency.value = 700;
    washFilter.Q.value = 0.7;
    washGain = ctx.createGain();
    washGain.gain.value = 0;
    washSource.connect(washFilter);
    washFilter.connect(washGain);
    washGain.connect(master);
    washSource.start();
  }

  function tone(freq, dur, type, vol, when, glideTo) {
    if (!ctx) return;
    var t = ctx.currentTime + (when || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noiseBurst(dur, vol, freq, type, when) {
    if (!ctx) return;
    var t = ctx.currentTime + (when || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(Math.max(0.1, dur));
    var filter = ctx.createBiquadFilter();
    filter.type = type || 'lowpass';
    filter.frequency.value = freq || 800;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(vol || 0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  return {
    init: init,

    isMuted: function () {
      return muted;
    },

    setMuted: function (m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : 0.85;
    },

    // Continuous engine + wind wash. power 0..1, speedNorm 0..1, running bool.
    setEngine: function (power, speedNorm, running) {
      if (!ctx) return;
      var t = ctx.currentTime;
      var base = running ? 52 + power * 96 + speedNorm * 18 : 0;
      engineOscA.frequency.setTargetAtTime(Math.max(1, base), t, 0.08);
      engineOscB.frequency.setTargetAtTime(Math.max(1, base * 0.5), t, 0.08);
      engineFilter.frequency.setTargetAtTime(300 + power * 900, t, 0.1);
      engineGain.gain.setTargetAtTime(running ? 0.05 + power * 0.11 : 0, t, 0.12);
      washGain.gain.setTargetAtTime(running ? speedNorm * 0.14 : 0, t, 0.15);
    },

    ring: function (combo) {
      var base = 660 + Math.min(combo || 0, 8) * 40;
      tone(base, 0.16, 'sine', 0.22);
      tone(base * 1.5, 0.22, 'sine', 0.18, 0.07);
    },

    miss: function () {
      tone(220, 0.18, 'triangle', 0.14, 0, 160);
    },

    dropWhistle: function () {
      tone(1400, 0.7, 'sine', 0.1, 0, 380);
    },

    parcelHit: function (good) {
      noiseBurst(0.12, 0.25, 500, 'lowpass');
      if (good) {
        tone(880, 0.12, 'sine', 0.16, 0.05);
        tone(1320, 0.18, 'sine', 0.14, 0.12);
      }
    },

    fuelPickup: function () {
      tone(520, 0.1, 'square', 0.1);
      tone(780, 0.14, 'square', 0.1, 0.08);
    },

    damage: function () {
      noiseBurst(0.25, 0.4, 900, 'lowpass');
      tone(90, 0.25, 'sine', 0.3, 0, 45);
    },

    scrape: function () {
      noiseBurst(0.18, 0.18, 2400, 'highpass');
    },

    crash: function () {
      noiseBurst(0.9, 0.55, 600, 'lowpass');
      tone(70, 0.9, 'sine', 0.45, 0, 30);
      noiseBurst(0.4, 0.3, 3000, 'highpass', 0.05);
    },

    touchdown: function (hard) {
      noiseBurst(hard ? 0.3 : 0.16, hard ? 0.4 : 0.2, 420, 'lowpass');
      tone(75, 0.2, 'sine', 0.22, 0, 50);
    },

    click: function () {
      tone(1150, 0.05, 'square', 0.07);
    },

    buy: function () {
      tone(740, 0.09, 'triangle', 0.16);
      tone(1108, 0.14, 'triangle', 0.16, 0.07);
    },

    denied: function () {
      tone(180, 0.16, 'square', 0.12);
    },

    jingle: function () {
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++) tone(notes[i], 0.22, 'triangle', 0.18, i * 0.11);
    },

    failSting: function () {
      tone(392, 0.25, 'triangle', 0.16);
      tone(311, 0.25, 'triangle', 0.16, 0.18);
      tone(233, 0.4, 'triangle', 0.16, 0.36);
    },

    // Called every frame while stalled; beeps twice a second.
    stallWarning: function (dt, active) {
      if (!ctx) return;
      if (!active) {
        stallTimer = 0;
        return;
      }
      stallTimer -= dt;
      if (stallTimer <= 0) {
        stallTimer = 0.5;
        tone(980, 0.09, 'square', 0.08);
      }
    },
  };
})();
