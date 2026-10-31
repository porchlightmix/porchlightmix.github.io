/* Porchlight Mix — free release check: measurement core.
 * Runs entirely on the listener's device. No audio leaves the browser.
 * Integrated loudness: ITU-R BS.1770 (K-weighting, 400 ms blocks, 75% overlap,
 * -70 LUFS absolute gate, -10 LU relative gate).
 * Loudness range: EBU Tech 3342 (3 s short-term, -70/-20 gates, 10th-95th percentile).
 * True peak: 4x oversampling (polyphase windowed-sinc interpolator), reported in dBTP.
 * Works as a browser global (PorchlightCore), a Web Worker, or a Node module. */
(function (root) {
  'use strict';

  function biquad(x, b0, b1, b2, a1, a2) {
    var y = new Float64Array(x.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var n = 0; n < x.length; n++) {
      var xn = x[n];
      var yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xn; y2 = y1; y1 = yn; y[n] = yn;
    }
    return y;
  }

  // K-weighting coefficients for any sample rate (same derivation as libebur128).
  function kCoeffs(fs) {
    var f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    var K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    var a0 = 1 + K / Q + K * K;
    var shelf = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0,
                 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    f0 = 38.13547087602444; Q = 0.5003270373238773;
    K = Math.tan(Math.PI * f0 / fs);
    var d = 1 + K / Q + K * K;
    var hp = [1, -2, 1, 2 * (K * K - 1) / d, (1 - K / Q + K * K) / d];
    return { shelf: shelf, hp: hp };
  }

  function kWeight(x, fs) {
    var c = kCoeffs(fs);
    var s = biquad(x, c.shelf[0], c.shelf[1], c.shelf[2], c.shelf[3], c.shelf[4]);
    return biquad(s, c.hp[0], c.hp[1], c.hp[2], c.hp[3], c.hp[4]);
  }

  function channelWeights(n) {
    if (n === 5) return [1, 1, 1, 1.41, 1.41];
    if (n === 6) return [1, 1, 1, 0, 1.41, 1.41]; // L R C LFE Ls Rs
    var w = []; for (var i = 0; i < n; i++) w.push(1); return w;
  }

  function lufs(ms) { return ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity; }

  // Weighted K-filtered energy per 100 ms hop.
  function hopEnergies(channels, fs) {
    var w = channelWeights(channels.length), len = channels[0].length;
    var nHops = Math.floor(len / (0.1 * fs));
    var e = new Float64Array(nHops), bounds = new Float64Array(nHops + 1);
    for (var h = 0; h <= nHops; h++) bounds[h] = Math.round(h * 0.1 * fs);
    for (var c = 0; c < channels.length; c++) {
      if (!w[c]) continue;
      var y = kWeight(channels[c], fs);
      for (h = 0; h < nHops; h++) {
        var s = 0, end = bounds[h + 1];
        for (var n = bounds[h]; n < end; n++) s += y[n] * y[n];
        e[h] += w[c] * s;
      }
    }
    return { e: e, bounds: bounds };
  }

  function windowed(hops, nHopsPerWin) {
    var e = hops.e, b = hops.bounds, out = [];
    for (var j = 0; j + nHopsPerWin <= e.length; j++) {
      var s = 0; for (var k = 0; k < nHopsPerWin; k++) s += e[j + k];
      out.push(s / (b[j + nHopsPerWin] - b[j]));
    }
    return out; // mean-square (weighted sum over channels) per window
  }

  function integrated(blocks) {
    var abs = blocks.filter(function (z) { return lufs(z) > -70; });
    if (!abs.length) return -Infinity;
    var m = abs.reduce(function (a, b) { return a + b; }, 0) / abs.length;
    var rel = lufs(m) - 10;
    var g = abs.filter(function (z) { return lufs(z) > rel; });
    if (!g.length) return -Infinity;
    return lufs(g.reduce(function (a, b) { return a + b; }, 0) / g.length);
  }

  function loudnessRange(st) {
    var abs = st.filter(function (z) { return lufs(z) > -70; });
    if (abs.length < 2) return null;
    var m = abs.reduce(function (a, b) { return a + b; }, 0) / abs.length;
    var rel = lufs(m) - 20;
    var v = abs.map(lufs).filter(function (l) { return l > rel; }).sort(function (a, b) { return a - b; });
    if (v.length < 2) return null;
    function pct(p) { return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))]; }
    return pct(0.95) - pct(0.10);
  }

  // 4x polyphase interpolator: Kaiser-windowed sinc, 24 taps per phase.
  var TAPS = 24, OS = 4, PHASES = null;
  function bessel0(x) { var s = 1, t = 1; for (var k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; }
  function makePhases() {
    var beta = 8.6, half = TAPS / 2, ph = [];
    for (var p = 1; p < OS; p++) {
      var f = new Float64Array(TAPS), frac = p / OS;
      for (var k = 0; k < TAPS; k++) {
        var t = (k - half + 1) - frac; // offset in input samples from output point
        var sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
        var r = t / half; var win = Math.abs(r) <= 1 ? bessel0(beta * Math.sqrt(1 - r * r)) / bessel0(beta) : 0;
        f[k] = sinc * win;
      }
      ph.push(f);
    }
    return ph;
  }
  function truePeakLinear(x, fs) {
    var peak = 0, n, len = x.length;
    for (n = 0; n < len; n++) { var a = Math.abs(x[n]); if (a > peak) peak = a; }
    if (fs >= 176400) return peak; // already oversampled enough
    if (!PHASES) PHASES = makePhases();
    var half = TAPS / 2;
    for (n = 0; n < len; n++) {
      for (var p = 0; p < PHASES.length; p++) {
        var f = PHASES[p], s = 0;
        // output point at n + (p+1)/4 uses inputs n-half+1 .. n+half
        for (var k = 0; k < TAPS; k++) {
          var idx = n - half + 1 + k;
          if (idx >= 0 && idx < len) s += f[k] * x[idx];
        }
        s = Math.abs(s); if (s > peak) peak = s;
      }
    }
    return peak;
  }

  function db(v) { return v > 0 ? 20 * Math.log10(v) : -Infinity; }

  function clipStats(channels) {
    var thr = 0.99997, fullScale = 0, events = 0;
    for (var c = 0; c < channels.length; c++) {
      var x = channels[c], run = 0;
      for (var n = 0; n < x.length; n++) {
        if (Math.abs(x[n]) >= thr) { fullScale++; run++; if (run === 3) events++; }
        else run = 0;
      }
    }
    return { fullScaleSamples: fullScale, clipEvents: events };
  }

  function silence(channels, fs) {
    var thr = Math.pow(10, -60 / 20), len = channels[0].length, first = len, last = -1;
    for (var c = 0; c < channels.length; c++) {
      var x = channels[c], n;
      for (n = 0; n < Math.min(first, len); n++) if (Math.abs(x[n]) > thr) { first = n; break; }
      for (n = len - 1; n > last; n--) if (Math.abs(x[n]) > thr) { last = n; break; }
    }
    if (last < 0) return { lead: len / fs, tail: len / fs, allSilent: true };
    return { lead: first / fs, tail: (len - 1 - last) / fs, allSilent: false };
  }

  function analyze(channels, fs, opts) {
    opts = opts || {};
    var hops = hopEnergies(channels, fs);
    var I = integrated(windowed(hops, 4));
    var lra = loudnessRange(windowed(hops, 30));
    var sp = 0, tp = 0;
    for (var c = 0; c < channels.length; c++) {
      var x = channels[c];
      for (var n = 0; n < x.length; n++) { var a = Math.abs(x[n]); if (a > sp) sp = a; }
      if (!opts.skipTruePeak) { var t = truePeakLinear(x, fs); if (t > tp) tp = t; }
    }
    var sil = silence(channels, fs), clip = clipStats(channels);
    return {
      integratedLufs: I, loudnessRange: lra,
      samplePeakDb: db(sp), truePeakDb: opts.skipTruePeak ? null : db(tp),
      duration: channels[0].length / fs, sampleRate: fs, channels: channels.length,
      leadingSilence: sil.lead, trailingSilence: sil.tail, allSilent: sil.allSilent,
      fullScaleSamples: clip.fullScaleSamples, clipEvents: clip.clipEvents
    };
  }

  var api = { analyze: analyze, kCoeffs: kCoeffs };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PorchlightCore = api;

  // Web Worker entry point
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = function (ev) {
      try {
        var chans = ev.data.channels.map(function (b) { return new Float32Array(b); });
        root.postMessage({ ok: true, result: analyze(chans, ev.data.sampleRate) });
      } catch (e) { root.postMessage({ ok: false, error: String(e && e.message || e) }); }
    };
  }
})(typeof self !== 'undefined' ? self : this);
