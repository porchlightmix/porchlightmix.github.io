/* Porchlight Mix: free Loudness Preview.
 * Measures integrated loudness (ITU-R BS.1770) and true peak with the same code as the free Release Check
 * (checker-core.js + audio-io.js), then estimates how each streaming service adjusts playback volume.
 * Runs entirely in this browser tab. The file is never uploaded. No tracking, no network calls. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var IO = window.PorchlightAudioIO;
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('-', '−'); }
  function sgn(v) { var r = Math.round(v * 10) / 10; return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r).toFixed(1); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // raise: 'peaks' = turns quiet songs up only while true peak stays at or below `ceil`;
  //        'limiter' = turns up regardless of peaks and uses a limiter; false = turns loud songs down only.
  // src: number of the source in the page's source list. official: the service publishes this number itself.
  var PLATFORMS = [
    { id: 'sp', name: 'Spotify', setting: 'Normal (default)', target: -14, raise: 'peaks', ceil: -1, official: true, src: 1 },
    { id: 'spl', name: 'Spotify', setting: 'Loud (Premium option)', target: -11, raise: 'limiter', official: true, src: 1 },
    { id: 'spq', name: 'Spotify', setting: 'Quiet (Premium option)', target: -19, raise: 'peaks', ceil: -1, official: true, src: 1 },
    { id: 'am', name: 'Apple Music', setting: 'Sound Check', target: -16, raise: 'peaks', ceil: -1, official: false, src: 2 },
    { id: 'yt', name: 'YouTube', setting: '', target: -14, raise: false, official: false, src: 2 },
    { id: 'az', name: 'Amazon Music', setting: '', target: -14, raise: false, official: false, src: 2 },
    { id: 'td', name: 'TIDAL', setting: '', target: -14, raise: false, official: false, src: 2 },
    { id: 'dz', name: 'Deezer', setting: '', target: -15, raise: false, official: false, src: 2 }
  ];

  function adjust(p, I, TP) {
    var need = p.target - I, gain, limited = false, why;
    if (need <= 0) { gain = need; why = 'down'; }
    else if (p.raise === 'limiter') { gain = need; why = 'up-limiter'; }
    else if (p.raise === 'peaks') { gain = Math.max(0, Math.min(need, p.ceil - TP)); limited = gain < need - 0.05; why = limited ? 'up-limited' : 'up'; }
    else { gain = 0; why = 'no-raise'; }
    return { gain: gain, playsAt: I + gain, vsOthers: I + gain - p.target, limited: limited, why: why };
  }
  window.PorchlightPreviewModel = { PLATFORMS: PLATFORMS, adjust: adjust };

  function explain(p, a) {
    var t = f1(p.target) + ' LUFS';
    // Only Spotify publishes its turn-up limit. For other services (Apple Music) it's an approximate, independently measured value.
    var ceilTxt = p.official ? f1(p.ceil) + ' dBTP' : 'about ' + f1(p.ceil) + ' dBTP (approximate; ' + p.name + ' doesn\'t publish its exact limit)';
    if (Math.abs(a.gain) < 0.5 && a.why !== 'no-raise' && !a.limited) return 'Plays at about the level you mastered it (within half a dB of ' + t + ').';
    switch (a.why) {
      case 'down': return 'Turned down about <b>' + f1(-a.gain).replace('−', '') + ' dB</b> to match ' + t + '. The extra loudness doesn\'t reach listeners.';
      case 'up': return 'Turned up about <b>' + f1(a.gain) + ' dB</b>. Your peaks leave room for that.';
      case 'up-limiter': return 'Turned up about <b>' + f1(a.gain) + ' dB</b>. On this setting Spotify ignores peaks and uses a limiter instead, which can squash loud moments a little.';
      case 'up-limited': return (a.gain < 0.1 ? 'Can\'t be turned up, because your true peak is already at or above ' : 'Turned up only <b>' + f1(a.gain) + ' dB</b>, because peaks must stay at or below ') + ceilTxt + '. It plays about <b>' + f1(-a.vsOthers).replace('−', '') + ' dB</b> quieter than songs at ' + t + '.';
      default: return (Math.abs(a.vsOthers) < 0.5 ? 'Plays at about the level you mastered it. ' : 'This service is reported to turn loud songs down but not turn quiet ones up, so it plays about <b>' + f1(-a.vsOthers).replace('−', '') + ' dB</b> quieter than songs at ' + t + '. ') + 'That\'s fine if the song is meant to be gentle.';
    }
  }

  var state = { buffer: null, r: null, rows: null, ctx: null, src: null, gainNode: null, startAt: 0, offset: 0, playing: false, mode: 'orig' };

  function render(file, r) {
    var I = r.integratedLufs, TP = r.truePeakDb;
    $('r-name').textContent = file.name;
    $('m-lufs').innerHTML = isFinite(I) ? f1(I) + ' <small>LUFS</small>' : '–';
    $('m-tp').innerHTML = isFinite(TP) ? f1(TP) + ' <small>dBTP</small>' : '–';
    var secs = Math.round(r.duration);
    $('m-dur').textContent = Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2);
    var rows = PLATFORMS.map(function (p) { return { p: p, a: adjust(p, I, TP) }; });
    state.rows = rows;
    var html = '';
    rows.forEach(function (x) {
      var p = x.p, a = x.a;
      var tag = p.official ? '<span class="pill pass" title="Published by the service">OFFICIAL</span>' : '<span class="pill warn" title="Not published by the service; from independent measurements">APPROX.</span>';
      html += '<tr><th scope="row">' + esc(p.name) + (p.setting ? '<small>' + esc(p.setting) + '</small>' : '') + '</th>' +
        '<td data-label="Reference">' + (p.official ? '' : '≈ ') + f1(p.target) + ' LUFS <sup><a href="#src' + p.src + '">' + p.src + '</a></sup><br>' + tag + '</td>' +
        '<td class="n" data-label="Change">' + sgn(a.gain) + ' dB</td>' +
        '<td class="n" data-label="Plays at">' + f1(a.playsAt) + ' LUFS</td>' +
        '<td class="why">' + explain(p, a) + '</td>' +
        '<td><button type="button" class="btn ghost small hear" data-id="' + p.id + '" aria-pressed="false">Hear it</button></td></tr>';
    });
    $('rows').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('button.hear'), function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-id')); }); });
    $('results').style.display = 'block';
    setMode('orig', true);
  }

  // ---- A/B playback with Web Audio gain ----
  function dbToGain(db) { return Math.pow(10, db / 20); }
  function modeGainDb(mode) {
    if (mode === 'orig') return 0;
    var row = state.rows.filter(function (x) { return x.p.id === mode; })[0];
    if (!row) return 0;
    var g = row.a.gain;
    // Never push the preview past 0 dBFS in the browser (Spotify Loud uses a limiter we don't imitate).
    var cap = -0.1 - state.r.truePeakDb;
    return Math.min(g, cap);
  }
  function setMode(mode, silent) {
    state.mode = mode;
    var db = modeGainDb(mode);
    if (state.gainNode) state.gainNode.gain.setTargetAtTime(dbToGain(db), state.ctx.currentTime, 0.015);
    Array.prototype.forEach.call(document.querySelectorAll('button.hear, #hear-orig'), function (b) {
      var on = (b.id === 'hear-orig' && mode === 'orig') || b.getAttribute('data-id') === mode;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var label = mode === 'orig' ? 'As mastered (no change)' : (function () { var x = state.rows.filter(function (y) { return y.p.id === mode; })[0]; return x.p.name + (x.p.setting ? ' ' + x.p.setting : '') + ': ' + sgn(db) + ' dB'; })();
    var capped = mode !== 'orig' && Math.abs(modeGainDb(mode) - state.rows.filter(function (y) { return y.p.id === mode; })[0].a.gain) > 0.05;
    $('now').textContent = 'Now hearing: ' + label + (capped ? ' (capped so your speakers don\'t clip; Spotify would use a limiter here)' : '');
    if (!silent && !state.playing) play();
  }
  function play() {
    if (!state.buffer) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!state.ctx) { state.ctx = new AC(); state.gainNode = state.ctx.createGain(); state.gainNode.connect(state.ctx.destination); }
    if (state.ctx.state === 'suspended') state.ctx.resume();
    state.gainNode.gain.value = dbToGain(modeGainDb(state.mode));
    var s = state.ctx.createBufferSource(); s.buffer = state.buffer; s.connect(state.gainNode);
    if (state.offset >= state.buffer.duration) state.offset = 0;
    s.start(0, state.offset); state.startAt = state.ctx.currentTime - state.offset;
    s.onended = function () { if (state.src === s && state.playing) { state.playing = false; state.offset = 0; $('play').textContent = '▶ Play'; } };
    state.src = s; state.playing = true; $('play').textContent = '❚❚ Pause';
  }
  function pause() {
    if (!state.playing) return;
    state.offset = state.ctx.currentTime - state.startAt; state.playing = false;
    var s = state.src; state.src = null; try { s.stop(); } catch (e) {}
    $('play').textContent = '▶ Play';
  }
  function stopAll() { if (state.playing) pause(); state.offset = 0; }

  function setStatus(msg, err) { var el = $('status'); el.textContent = msg; el.className = 'status' + (err ? ' err' : ''); }

  function analyze(audio) {
    var chans = [], n = audio.numberOfChannels, sr = audio.sampleRate;
    for (var c = 0; c < n; c++) chans.push(audio.getChannelData(c).slice());
    return new Promise(function (resolve, reject) {
      var w; try { w = new Worker('assets/checker-core.js'); } catch (e) { w = null; }
      var fallback = function () { setTimeout(function () { try { resolve(PorchlightCore.analyze(chans, sr)); } catch (e) { reject(e); } }, 30); };
      if (!w) return fallback();
      w.onmessage = function (ev) { w.terminate(); ev.data.ok ? resolve(ev.data.result) : reject(new Error(ev.data.error)); };
      w.onerror = function (ev) { ev.preventDefault && ev.preventDefault(); w.terminate(); fallback(); };
      var copies = chans.map(function (a) { return a.slice().buffer; });
      w.postMessage({ channels: copies, sampleRate: sr }, copies);
    });
  }

  function handle(file) {
    if (!file) return;
    stopAll(); $('results').style.display = 'none'; $('bar').style.display = 'block';
    setStatus('Reading ' + file.name + '…');
    var t0 = performance.now();
    file.arrayBuffer().then(function (buf) {
      var info = IO.parseHeader(buf, file.name);
      setStatus('Decoding audio on your device…');
      return IO.decode(buf, info.sampleRate);
    }).then(function (audio) {
      state.buffer = audio;
      setStatus('Measuring loudness and peaks…');
      return analyze(audio);
    }).then(function (r) {
      $('bar').style.display = 'none'; state.r = r;
      if (!Number.isFinite(r.integratedLufs) || !Number.isFinite(r.truePeakDb)) {
        state.buffer = null;
        setStatus('This file seems to be silent, or too quiet to measure, so there\'s nothing to preview. Try another file. Nothing was uploaded.', true);
        return;
      }
      setStatus('Done in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s. Nothing was uploaded.');
      render(file, r);
      window.__previewResult = { integrated: r.integratedLufs, truePeak: r.truePeakDb, rows: state.rows.map(function (x) { return { id: x.p.id, target: x.p.target, gain: x.a.gain }; }) };
    }).catch(function (e) {
      $('bar').style.display = 'none';
      setStatus('Sorry, this browser couldn\'t decode that file. Try exporting a WAV, FLAC or MP3. (' + (e && e.message ? e.message : e) + ')', true);
    });
  }

  var input = $('file'), drop = $('drop');
  input.addEventListener('change', function () { handle(input.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
  $('play').addEventListener('click', function () { state.playing ? pause() : play(); });
  $('hear-orig').addEventListener('click', function () { setMode('orig'); });
})();
