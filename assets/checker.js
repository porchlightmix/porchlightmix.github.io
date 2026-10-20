/* Porchlight Mix free release check: UI. Everything runs locally; no network requests are made with your audio. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var fileInput = $('file'), drop = $('drop'), statusEl = $('status'), bar = $('bar');

  function setStatus(msg, err) { statusEl.textContent = msg; statusEl.className = 'status' + (err ? ' err' : ''); }
  function busy(on) { bar.style.display = on ? 'block' : 'none'; }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('-', '−'); }
  function abs1(v) { return (Math.round(Math.abs(v) * 10) / 10).toFixed(1); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- read container headers (sample rate / bit depth / format) ----
  function parseHeader(buf, name) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), info = { container: 'unknown', lossless: null };
    function str(o, n) { var s = ''; for (var i = 0; i < n && o + i < u8.length; i++) s += String.fromCharCode(u8[o + i]); return s; }
    try {
      if (str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE') {
        info.container = 'WAV'; info.lossless = true;
        var o = 12;
        while (o + 8 <= u8.length) {
          var id = str(o, 4), sz = dv.getUint32(o + 4, true);
          if (id === 'fmt ') {
            var tag = dv.getUint16(o + 8, true);
            info.channels = dv.getUint16(o + 10, true); info.sampleRate = dv.getUint32(o + 12, true);
            info.bitDepth = dv.getUint16(o + 22, true);
            if (tag === 0xFFFE && sz >= 40) tag = dv.getUint16(o + 32, true);
            info.float = tag === 3; info.compressed = !(tag === 1 || tag === 3);
            break;
          }
          o += 8 + sz + (sz & 1);
        }
      } else if (str(0, 4) === 'fLaC') {
        info.container = 'FLAC'; info.lossless = true;
        var b = 8; // STREAMINFO body starts after 4-byte marker + 4-byte block header
        info.sampleRate = (u8[b + 10] << 12) | (u8[b + 11] << 4) | (u8[b + 12] >> 4);
        info.channels = ((u8[b + 12] >> 1) & 7) + 1;
        info.bitDepth = (((u8[b + 12] & 1) << 4) | (u8[b + 13] >> 4)) + 1;
      } else if (str(0, 4) === 'FORM' && (str(8, 4) === 'AIFF' || str(8, 4) === 'AIFC')) {
        info.container = 'AIFF'; info.lossless = true;
        var p = 12;
        while (p + 8 <= u8.length) {
          var cid = str(p, 4), csz = dv.getUint32(p + 4, false);
          if (cid === 'COMM') {
            info.channels = dv.getUint16(p + 8, false); info.bitDepth = dv.getUint16(p + 14, false);
            var e = dv.getUint16(p + 16, false) & 0x7FFF, m = dv.getUint32(p + 18, false);
            info.sampleRate = Math.round(m * Math.pow(2, e - 16383 - 31));
            break;
          }
          p += 8 + csz + (csz & 1);
        }
      } else {
        var q = 0;
        if (str(0, 3) === 'ID3') q = 10 + ((u8[6] & 127) << 21 | (u8[7] & 127) << 14 | (u8[8] & 127) << 7 | (u8[9] & 127));
        for (var i = q; i < Math.min(u8.length - 4, q + 65536); i++) {
          if (u8[i] === 0xFF && (u8[i + 1] & 0xE0) === 0xE0) {
            var ver = (u8[i + 1] >> 3) & 3, layer = (u8[i + 1] >> 1) & 3, sri = (u8[i + 2] >> 2) & 3;
            if (layer === 1 && sri !== 3 && ver !== 1) {
              var base = [44100, 48000, 32000][sri];
              info.container = 'MP3'; info.lossless = false;
              info.sampleRate = ver === 3 ? base : ver === 2 ? base / 2 : base / 4;
              info.channels = ((u8[i + 3] >> 6) === 3) ? 1 : 2;
              break;
            }
          }
        }
        if (info.container === 'unknown' && str(4, 4) === 'ftyp') { info.container = 'M4A/AAC'; info.lossless = false; }
      }
    } catch (e) { /* fall through with what we have */ }
    if (info.container === 'unknown' && /\.mp3$/i.test(name)) { info.container = 'MP3'; info.lossless = false; }
    return info;
  }

  function decode(buf, sr) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var rate = sr && sr >= 8000 && sr <= 384000 ? sr : 48000;
    var ctx;
    try { ctx = new OAC(2, 1, rate); } catch (e) { ctx = new OAC(2, 1, 48000); }
    return new Promise(function (resolve, reject) {
      var p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  function runAnalysis(audio) {
    var chans = [], n = audio.numberOfChannels, sr = audio.sampleRate;
    for (var c = 0; c < n; c++) chans.push(audio.getChannelData(c).slice());
    return new Promise(function (resolve, reject) {
      var w;
      try { w = new Worker('assets/checker-core.js'); } catch (e) { w = null; }
      var fallback = function () { setTimeout(function () { try { resolve(PorchlightCore.analyze(chans, sr)); } catch (e) { reject(e); } }, 30); };
      if (!w) return fallback();
      w.onmessage = function (ev) { w.terminate(); ev.data.ok ? resolve(ev.data.result) : reject(new Error(ev.data.error)); };
      w.onerror = function (ev) { ev.preventDefault && ev.preventDefault(); w.terminate(); fallback(); };
      var copies = chans.map(function (a) { return a.slice().buffer; });
      w.postMessage({ channels: copies, sampleRate: sr }, copies);
    });
  }

  // ---- interpretation ----
  function pill(cls, txt) { return '<span class="pill ' + cls + '">' + esc(txt) + '</span>'; }
  function row(name, sub, html, pills) {
    return '<div class="row"><div class="name">' + esc(name) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div><div class="what">' + html + '</div><div class="pills">' + pills.join('') + '</div></div>';
  }

  // How a service will adjust playback, given target, whether it raises quiet songs, and its raise ceiling.
  function loudnessText(svc, I, TP, target, raises, ceiling) {
    var d = I - target;
    if (!isFinite(I)) return { html: 'No measurable loudness (the file may be silent).', pill: pill('warn', 'CHECK') };
    if (d > 0.5) return { html: svc + ' will turn it down by about <b>' + abs1(d) + ' dB</b> to match its ' + f1(target) + ' LUFS reference. That isn\'t a problem. It just means the extra loudness won\'t reach listeners.', pill: pill('info', 'TURNED DOWN ' + abs1(d) + ' dB') };
    if (d >= -0.5) return { html: 'Within half a dB of ' + svc + '\'s ' + f1(target) + ' LUFS reference, so it plays at about the level you mastered it.', pill: pill('pass', 'ON TARGET') };
    var need = -d;
    if (!raises) return { html: svc + ' is reported to turn loud songs down but not turn quiet ones up, so this will play about <b>' + abs1(need) + ' dB</b> quieter than songs at ' + f1(target) + ' LUFS. That\'s fine if the song is meant to be gentle.', pill: pill('info', 'PLAYS ' + abs1(need) + ' dB QUIETER') };
    var room = ceiling - TP, gain = Math.max(0, Math.min(need, room));
    if (gain >= need - 0.05) return { html: svc + ' will turn it up by about <b>' + abs1(need) + ' dB</b>. Your peaks leave enough headroom for that.', pill: pill('info', 'TURNED UP ' + abs1(need) + ' dB') };
    var left = need - gain;
    if (gain < 0.1) return { html: 'Your peaks are already near ' + svc + '\'s ' + f1(ceiling) + ' dBTP headroom limit, so it can\'t turn this up. It will play about <b>' + abs1(left) + ' dB</b> quieter than songs at ' + f1(target) + ' LUFS.', pill: pill('info', 'PLAYS ' + abs1(left) + ' dB QUIETER') };
    return { html: svc + ' will turn it up by only about <b>' + abs1(gain) + ' dB</b>, because your peaks limit how far it can go, so it plays about <b>' + abs1(left) + ' dB</b> quieter than songs at ' + f1(target) + ' LUFS.', pill: pill('info', 'PLAYS ' + abs1(left) + ' dB QUIETER') };
  }
  function peakCheck(TP, limit, note) {
    if (TP <= limit) return { ok: true, pill: pill('pass', 'PEAKS OK'), html: 'True peak ' + f1(TP) + ' dBTP is at or below ' + f1(limit) + ' dBTP' + (note || '') + '.' };
    return { ok: false, pill: pill(note ? 'warn' : 'fail', 'PEAKS ' + (note ? 'CHECK' : 'FIX')), html: 'True peak ' + f1(TP) + ' dBTP is above ' + f1(limit) + ' dBTP' + (note || '') + '. Set your limiter\'s true-peak ceiling to ' + f1(limit) + ' dB or lower.' };
  }

  function render(r, info, file) {
    var I = r.integratedLufs, TP = r.truePeakDb;
    $('r-name').textContent = file.name;
    var fmt = info.container + (info.bitDepth && info.lossless ? ' · ' + info.bitDepth + '-bit' + (info.float ? ' float' : '') : '') + (info.lossless === false ? ' · lossy' : '');
    $('r-fmt').textContent = fmt;
    $('m-lufs').innerHTML = isFinite(I) ? f1(I) + ' <small>LUFS</small>' : '–';
    $('m-tp').innerHTML = f1(TP) + ' <small>dBTP</small>';
    $('m-sp').innerHTML = f1(r.samplePeakDb) + ' <small>dBFS</small>';
    $('m-lra').innerHTML = r.loudnessRange == null ? '<small>too short</small>' : f1(r.loudnessRange) + ' <small>LU</small>';
    var mm = Math.floor(r.duration / 60), ss = Math.round(r.duration - mm * 60); if (ss === 60) { mm++; ss = 0; }
    $('m-dur').innerHTML = mm + ':' + (ss < 10 ? '0' : '') + ss;
    var srcRate = info.sampleRate || r.sampleRate;
    $('m-sr').innerHTML = (srcRate / 1000).toFixed(srcRate % 1000 ? 1 : 0) + ' <small>kHz</small>';
    $('m-ch').innerHTML = r.channels === 1 ? 'Mono' : r.channels === 2 ? 'Stereo' : r.channels;
    $('m-clip').innerHTML = String(r.clipEvents);

    // platforms
    var spLimit = I > -14 ? -2 : -1;
    var sp = loudnessText('Spotify', I, TP, -14, true, -1), spk = peakCheck(TP, spLimit, '');
    var am = loudnessText('Apple Music', I, TP, -16, true, -1), apk = peakCheck(TP, -1, '');
    var yt = loudnessText('YouTube', I, TP, -14, false), ypk = peakCheck(TP, -1, ' (general good practice; YouTube publishes no limit)');
    var az = loudnessText('Amazon Music', I, TP, -14, false), azk = peakCheck(TP, -2, ' (conservative working ceiling)');
    $('platforms').innerHTML =
      row('Spotify', '−14 LUFS · ' + f1(spLimit) + ' dBTP' + (I > -14 ? ' (louder masters)' : ''), sp.html + ' ' + spk.html + (I > -14 && TP > -2 && TP <= -1 ? ' Spotify asks for −2 dBTP on masters louder than −14 LUFS, because loud tracks are more likely to distort when encoded.' : ''), [sp.pill, spk.pill]) +
      row('Apple Music', '≈ −16 LUFS · −1 dBTP', am.html + ' ' + apk.html, [am.pill, apk.pill]) +
      row('YouTube', '≈ −14 LUFS', yt.html + ' ' + ypk.html, [yt.pill, ypk.pill]) +
      row('Amazon Music', '≈ −14 LUFS · −2 dBTP', az.html + ' ' + azk.html, [az.pill, azk.pill]);

    // distributor checks
    var d = [], fixes = [];
    if (srcRate >= 44100) d.push(row('Sample rate', '44.1 kHz or higher', (srcRate / 1000) + ' kHz.', [pill('pass', 'PASS')]));
    else { d.push(row('Sample rate', '44.1 kHz or higher', (srcRate / 1000) + ' kHz is below the 44.1 kHz most distributors expect. Export again at 44.1 or 48 kHz from your original session. Upsampling this file won\'t add quality back.', [pill('fail', 'FIX')])); fixes.push([1, 'Re-export at 44.1 kHz or higher', 'Your file is ' + (srcRate / 1000) + ' kHz. Most distributors expect at least 44.1 kHz.']); }
    if (info.lossless === false) { d.push(row('File format', 'WAV or FLAC preferred', info.container + ' is a lossy format. Stores will encode your file again, and encoding an MP3 or AAC a second time loses more detail. Upload a 16- or 24-bit WAV or FLAC if you have one.', [pill('warn', 'CHECK')])); fixes.push([3, 'Upload a WAV or FLAC instead of ' + info.container, 'Lossy files get encoded a second time by the stores. A lossless export sounds better on every service.']); }
    else if (info.lossless) {
      var bd = info.bitDepth || 0;
      if (info.float) d.push(row('File format', 'WAV or FLAC, 16-bit or higher', info.container + ', ' + bd + '-bit float. Many distributors accept this, but if yours asks for 16- or 24-bit, export integer PCM with dither.', [pill('pass', 'OK')]));
      else if (bd >= 16) d.push(row('File format', 'WAV or FLAC, 16-bit or higher', info.container + ', ' + bd + '-bit. Good to go.', [pill('pass', 'PASS')]));
      else if (bd) { d.push(row('File format', 'WAV or FLAC, 16-bit or higher', bd + '-bit is below the 16-bit minimum. Export at 16 or 24-bit.', [pill('fail', 'FIX')])); fixes.push([1, 'Export at 16-bit or 24-bit', 'Your file is ' + bd + '-bit.']); }
      else d.push(row('File format', 'WAV or FLAC, 16-bit or higher', info.container + '. We couldn\'t read the bit depth.', [pill('warn', 'CHECK')]));
    } else d.push(row('File format', 'WAV or FLAC preferred', 'We couldn\'t identify the file type. WAV or FLAC is the safest choice for distributors.', [pill('warn', 'CHECK')]));

    if (r.clipEvents === 0) d.push(row('Clipping', 'no full-scale runs', 'No spots where three or more samples in a row sit at full scale.' + (TP > 0 ? ' Your true peak is above 0 dBTP, though, so there are inter-sample overs (see the peak notes above).' : ''), [pill(TP > 0 ? 'warn' : 'pass', TP > 0 ? 'CHECK' : 'PASS')]));
    else { d.push(row('Clipping', 'no full-scale runs', '<b>' + r.clipEvents + '</b> spot' + (r.clipEvents === 1 ? '' : 's') + ' where three or more samples in a row sit at full scale. That usually means clipping you can hear, especially on vocals and strummed guitar peaks. Back off the limiter or master input gain.', [pill('fail', 'FIX')])); fixes.push([0, 'Fix the clipping', 'We found ' + r.clipEvents + ' clipped spot' + (r.clipEvents === 1 ? '' : 's') + '. Lower the input to your limiter, or set its ceiling to −1 dBTP with true-peak mode on.']); }

    if (r.allSilent) d.push(row('Silence', 'start and end', 'The file appears to be silent (below −60 dBFS throughout).', [pill('fail', 'FIX')]));
    else {
      var lead = r.leadingSilence, tail = r.trailingSilence;
      var leadOk = lead <= 2, tailOk = tail <= 8;
      var txt = 'About ' + lead.toFixed(1) + ' s of silence before the music starts and ' + tail.toFixed(1) + ' s after it ends (below −60 dBFS).';
      if (!leadOk) txt += ' Long silence at the start makes listeners think the track is broken. Trim it to under a second unless it\'s intentional.';
      if (!tailOk) txt += ' A long silent tail is easy to trim, unless it\'s a deliberate gap on an album.';
      if (info.lossless === false && lead < 0.1) txt += ' (MP3s often carry a few milliseconds of encoder padding. That\'s normal.)';
      d.push(row('Silence', 'start ≤ 2 s · end ≤ 8 s', txt, [pill(leadOk && tailOk ? 'pass' : 'warn', leadOk && tailOk ? 'PASS' : 'CHECK')]));
      if (!leadOk || !tailOk) fixes.push([4, 'Trim the silence', (leadOk ? '' : lead.toFixed(1) + ' s at the start. ') + (tailOk ? '' : tail.toFixed(1) + ' s at the end.')]);
    }
    if (r.channels === 1) { d.push(row('Channels', 'stereo expected', 'This is a mono file. Most distributors expect stereo, so export it as stereo (the same signal on both sides). Note: BS.1770 measures mono as one channel, so the same audio exported as dual-mono stereo will read about 3 LU louder.', [pill('warn', 'CHECK')])); fixes.push([5, 'Export as stereo', 'Distributors generally expect a stereo file, even if the mix is mono.']); }
    else if (r.channels === 2) d.push(row('Channels', 'stereo expected', 'Stereo.', [pill('pass', 'PASS')]));
    else d.push(row('Channels', 'stereo expected', r.channels + ' channels. Music distributors expect a stereo master. Immersive or Atmos mixes are delivered separately.', [pill('warn', 'CHECK')]));
    $('distro').innerHTML = d.join('');

    // peaks as fixes
    if (!spk.ok) fixes.push([2, 'Bring your peaks down to ' + f1(spLimit) + ' dBTP', 'Your true peak is ' + f1(TP) + ' dBTP. ' + (I > -14 ? 'Because this master is louder than −14 LUFS, Spotify recommends −2 dBTP so it doesn\'t distort when it\'s encoded.' : 'Spotify and Apple both recommend at least 1 dB of headroom so the song doesn\'t distort after encoding.') + ' Turn on true-peak mode in your limiter and set the ceiling to ' + f1(spLimit) + ' dB.']);
    if (isFinite(I) && I > -9 && !fixes.length) fixes.push([6, 'Consider a less squashed master', 'At ' + f1(I) + ' LUFS, Spotify will turn this down by about ' + abs1(I + 14) + ' dB, so heavy limiting buys no extra loudness for most listeners. For acoustic and vocal music, easing off can bring back punch and breath.']);
    fixes.sort(function (a, b) { return a[0] - b[0]; });
    $('fix').innerHTML = fixes.length
      ? '<b>Your #1 fix: ' + esc(fixes[0][1]) + '</b>' + esc(fixes[0][2]) + (fixes.length > 1 ? ' <span class="fine">(+' + (fixes.length - 1) + ' more item' + (fixes.length > 2 ? 's' : '') + ' below)</span>' : '')
      : '<b>Technically release-ready</b>Your file meets the streaming and distributor specs we check. Next question: does the mix itself work? That\'s what the full report covers.';

    $('results').style.display = 'block';
  }

  function handle(file) {
    if (!file) return;
    $('results').style.display = 'none';
    setStatus('Reading ' + file.name + '…'); busy(true);
    var t0 = performance.now(), info;
    file.arrayBuffer().then(function (buf) {
      info = parseHeader(buf, file.name);
      setStatus('Decoding audio on your device…');
      return decode(buf, info.sampleRate);
    }).then(function (audio) {
      setStatus('Measuring loudness and peaks…');
      return runAnalysis(audio);
    }).then(function (r) {
      busy(false);
      setStatus('Done in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s. Nothing was uploaded.');
      render(r, info, file);
      window.__porchlightResult = r;
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) {
      busy(false);
      setStatus('Sorry, this browser couldn\'t decode that file. Try exporting a WAV, FLAC or MP3. (' + (e && e.message ? e.message : e) + ')', true);
    });
  }

  fileInput.addEventListener('change', function () { handle(fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
})();
