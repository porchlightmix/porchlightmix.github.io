/* Porchlight Mix: shared audio file reading for the free tools (header parsing + in-browser decode).
 * Same code as the free Release Check (checker.js), so both tools decode files identically.
 * Nothing is uploaded: the file is read and decoded on this device. */
(function (root) {
  'use strict';
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

  root.PorchlightAudioIO = { parseHeader: parseHeader, decode: decode };
})(window);
