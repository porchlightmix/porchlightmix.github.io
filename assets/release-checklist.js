/* Porchlight Mix: free Release Checklist builder.
 * Everything happens in this browser tab. Choices are saved only in this browser (localStorage).
 * No accounts, no tracking, no network calls. Specs checked against official help pages on October 20, 2026. */
(function () {
  'use strict';
  var KEY = 'pm-checklist-v1';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Sources are numbered in the page's source list (#s-<key>).
  var D = {
    distrokid: { name: 'DistroKid', lead: 28, leadText: 'DistroKid suggests uploading about 4 weeks before release so the song goes live everywhere on the same day.',
      audio: 'WAV or FLAC recommended (MP3, M4A, AIFF and WMA also accepted). DistroKid says 16-bit, 44.1 kHz WAV is typical.',
      art: 'JPG, square, at least 1000 × 1000 (3000 × 3000 is ideal), RGB.',
      ids: 'DistroKid creates ISRC and UPC codes for free. Adding your own codes needs Musician Plus or Ultimate.',
      extra: ['Picking a future release date needs a Musician Plus or Ultimate plan.'],
      cover: 'DistroKid says cover songs need licensing, which can take up to 14 business days before DistroKid can deliver your release. This checklist moves your upload date to 5 weeks before release to allow for that.', presave: 'Set up a HyperFollow page in DistroKid (it can collect pre-saves).', src: 'dk' },
    cdbaby: { name: 'CD Baby', lead: 42, min: 21, leadText: 'CD Baby says to submit at least 3 weeks ahead; 4–6 weeks is ideal. This checklist uses 6 weeks to be safe. CD Baby reviews every release before sending it to stores: 1–2 business days with Fast Forward, or 7–14 business days without it. Your song only reaches Spotify for Artists after that review.',
      audio: 'WAV or FLAC, stereo, 44.1 kHz, 16-bit (MP3 accepted but not recommended).',
      art: 'Square, 1400 × 1400 to 3000 × 3000, JPG, PNG or GIF, RGB, under 25 MB.',
      ids: 'Check whether CD Baby creates ISRC and UPC codes for you or lets you enter your own.',
      extra: ['After review, CD Baby says stores take about 2 days to 2 weeks for Spotify and Apple Music, and 1–4 weeks for some others.'],
      cover: 'Cover songs need a mechanical license in the US. Check CD Baby\'s cover-song options before you submit.', src: 'cdb' },
    tunecore: { name: 'TuneCore', lead: 28, leadText: 'TuneCore suggests uploading 3–4 weeks ahead. Review takes about 2 business days.',
      audio: 'WAV, stereo. 24-bit, 192 kHz is recommended; 16-bit, 44.1 kHz is accepted.',
      art: 'Square, 1600 × 1600 to 3000 × 3000, JPG, PNG or GIF, RGB, at least 72 dpi, under 10 MB.',
      ids: 'Check whether TuneCore creates ISRC and UPC codes for you or lets you enter your own.',
      extra: ['For playlist consideration, TuneCore says the release must be approved and in stores at least 2 weeks before release day.'],
      tuneCorePlaylist: true,
      cover: 'Cover songs need a mechanical license in the US. Check TuneCore\'s cover-song options before you submit.', src: 'tc' },
    amuse: { name: 'Amuse', lead: null, leadText: 'Amuse needs a scheduled release date at least 14 days away on Artist, 10 days on Artist Plus, or 7 days on Artist Pro. Uploading earlier gives you time to pitch.',
      audio: 'WAV or FLAC, stereo, 16- or 24-bit, 44.1–192 kHz.',
      art: 'JPG or PNG, square, 1400 × 1400 to 6000 × 6000 (3000 × 3000 is ideal).',
      ids: 'Check whether Amuse creates ISRC and UPC codes for you or lets you enter your own.',
      extra: [],
      cover: 'Amuse says to set a cover song\'s release date at least 14 days ahead.', src: 'am' },
    unitedmasters: { name: 'UnitedMasters', lead: 21, leadText: 'UnitedMasters suggests submitting 3 weeks before release.',
      audio: 'We couldn\'t confirm UnitedMasters\' audio specs from a public page. Check UnitedMasters before you export.',
      art: 'Square JPG or PNG, 3000 × 3000 to 6000 × 6000, at least 72 dpi, under 150 MB.',
      ids: 'Check UnitedMasters for ISRC and UPC options.',
      extra: ['UnitedMasters says Spotify needs the release delivered at least 5 business days before release day.'],
      umSpotify: true,
      cover: 'Cover songs need a mechanical license in the US. Check UnitedMasters\' cover-song rules before you submit.', src: 'um' },
    other: { name: 'your distributor', lead: 28, leadText: 'Lead times vary. Four weeks is a safe plan with most distributors, but check your distributor.',
      audio: 'Check your distributor. A 16-bit or 24-bit stereo WAV at 44.1 kHz or higher is widely accepted.',
      art: 'Check your distributor. A 3000 × 3000 RGB JPG is widely accepted.',
      ids: 'Check whether your distributor assigns ISRC and UPC codes or lets you use your own.',
      extra: [], cover: 'Cover songs need a mechanical license in the US. Check your distributor\'s cover-song rules.', src: null }
  };
  var AMUSE = { artist: 14, plus: 10, pro: 7 };
  var PLATFORMS = [['spotify', 'Spotify'], ['apple', 'Apple Music'], ['youtube', 'YouTube Music'], ['amazon', 'Amazon Music'], ['tidal', 'TIDAL'], ['deezer', 'Deezer']];

  // ---- dates (local, date-only) ----
  function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function add(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function subBiz(d, n) { var x = new Date(d); while (n > 0) { x.setDate(x.getDate() - 1); var w = x.getDay(); if (w !== 0 && w !== 6) n--; } return x; }
  function fmt(d) { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // ---- saved choices ----
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  var st = load(); st.done = st.done || {};

  // Pre-fill from a link (used by the full report): ?date=YYYY-MM-DD&dist=distrokid&plan=artist&p=spotify,apple&opt=cover,alt
  // Values only fill the form in this browser. Nothing is sent anywhere. A new release date clears old ticks.
  (function fromLink() {
    var q; try { q = new URLSearchParams(window.location.search); } catch (e) { return; }
    if (!q || !q.toString()) return;
    var d = q.get('date'), di = q.get('dist'), pl = q.get('plan'), ps = q.get('p'), op = q.get('opt'), used = false;
    if (d && parse(d)) { if (st.date !== d) st.done = {}; st.date = d; used = true; }
    if (di && D[di]) { st.dist = di; used = true; }
    if (pl && AMUSE[pl]) { st.amusePlan = pl; used = true; }
    if (ps) { var keys = PLATFORMS.map(function (x) { return x[0]; }); var sel = ps.split(',').filter(function (k) { return keys.indexOf(k) >= 0; }); if (sel.length) { st.platforms = sel; used = true; } }
    if (op !== null) { var o = op.split(','); st.cover = o.indexOf('cover') >= 0; st.alt = o.indexOf('alt') >= 0; if (o.indexOf('nopresave') >= 0) st.presave = false; used = true; }
    if (used) { save(st); window.__checklistPrefilled = true; }
  })();

  function readForm() {
    st.date = $('date').value; st.dist = $('dist').value; st.amusePlan = $('amuse-plan').value;
    st.platforms = PLATFORMS.map(function (p) { return p[0]; }).filter(function (k) { return $('p-' + k).checked; });
    st.cover = $('o-cover').checked; st.alt = $('o-alt').checked; st.presave = $('o-presave').checked;
    save(st);
  }
  function writeForm() {
    var def = add(today(), 42);
    $('date').value = st.date || iso(def);
    $('dist').value = st.dist || 'distrokid';
    $('amuse-plan').value = st.amusePlan || 'artist';
    var ps = st.platforms || PLATFORMS.map(function (p) { return p[0]; });
    PLATFORMS.forEach(function (p) { $('p-' + p[0]).checked = ps.indexOf(p[0]) >= 0; });
    $('o-cover').checked = !!st.cover; $('o-alt').checked = !!st.alt; $('o-presave').checked = st.presave !== false;
  }

  function build() {
    var R = parse(st.date); if (!R) { $('out').innerHTML = '<p class="fine">Pick a release date to build your checklist.</p>'; return null; }
    var d = D[st.dist] || D.other, T = today();
    var lead = d.lead; if (st.dist === 'amuse') lead = AMUSE[st.amusePlan] || 14;
    if (st.cover && st.dist === 'amuse') lead = Math.max(lead, 14);
    if (st.cover && st.dist === 'distrokid') lead = Math.max(lead, 35);
    var U = add(R, -lead), P = add(U, -7);
    var sp = st.platforms.indexOf('spotify') >= 0;
    var plats = st.platforms.map(function (k) { return PLATFORMS.filter(function (p) { return p[0] === k; })[0][1]; });
    var srcLink = function (k) { return k ? ' <a class="src" href="#s-' + k + '">source</a>' : ''; };
    var items = [], tight = false;
    function it(id, date, title, body, opt) { items.push({ id: id, date: date, title: title, body: body, warn: opt && opt.warn }); }

    it('master', P, 'Finish the master and export the final file', esc(d.audio) + srcLink(d.src) + ' Send one high-quality stereo master. Don\'t add extra silence at the start or end.');
    it('loud', P, 'Check loudness and peaks', 'Run the <a href="checker.html">free Release Check</a> to see loudness, true peak and clipping. Use the <a href="loudness-preview.html">Loudness Preview</a> to hear how much each service will turn it up or down. Spotify suggests keeping true peaks below −1 dBTP (below −2 dBTP if the song is louder than −14 LUFS).' + srcLink('sp-loud') + ' Read: <a href="blog/how-loud-acoustic-song-spotify-lufs.html">How loud should an acoustic song be?</a>');
    it('art', P, 'Get the cover art ready', '<b>Safe choice: 3000 × 3000 pixels, square, JPG, RGB color.</b> ' + esc(d.name === 'your distributor' ? 'Every distributor we checked accepts that size and format.' : d.name + ': ' + d.art) + srcLink(d.src) + ' Apple\'s guide recommends 3000 × 3000 (1400 × 1400 minimum) and rejects blurry art, web addresses and advertising.' + srcLink('ap'));
    it('meta', P, 'Write down credits and metadata', 'Song title and artist name spelled exactly as you want them everywhere. Featured artists, songwriters, producer and performers. Genre, language, explicit or clean, and whether it\'s a cover. ' + esc(d.ids) + srcLink(d.src) + ' Each song needs its own ISRC; each release needs a UPC.' + srcLink('ap'));
    if (st.cover) it('cover', add(P, -7), 'Sort out the cover-song license', esc(d.cover) + srcLink(d.src) + ' Start early. Licensing can add days or weeks.');
    it('upload', U, 'Upload to ' + d.name + ' (latest safe date)', esc(d.leadText) + srcLink(d.src) + (d.extra.length ? ' ' + esc(d.extra.join(' ')) : '') + (plats.length ? ' Make sure delivery is turned on for: ' + esc(plats.join(', ')) + '.' : ''));
    if (st.presave) it('presave', add(U, 2), 'Share a pre-save link', st.dist === 'distrokid' ? esc(d.presave) + srcLink('dk') : 'Ask ' + esc(d.name) + ' whether it offers a pre-save or smart link for your release.');
    if (sp) {
      if (add(U, 3) > add(R, -8)) tight = true; else it('s4a', add(U, 3), 'Find the song in Spotify for Artists', 'Once it\'s delivered, your upcoming release shows in Spotify for Artists. Spotify asks for music to be delivered at least 7 days before release.' + srcLink('sp-pitch'));
      var pitchBody = 'Pitch one unreleased song to Spotify\'s editors at least 7 days before release. Then it can also go to your followers\' Release Radar. You can pitch one song at a time.' + srcLink('sp-pitch') +
        ' <span class="' + (st.alt ? 'caveat on' : 'caveat') + '">Spotify says it doesn\'t include some alternative versions, like acoustic or live versions, in Release Radar.' + srcLink('sp-rr') + '</span>';
      it('pitch', add(R, -7), 'Pitch to Spotify (last day)', pitchBody);
      if (d.tuneCorePlaylist) it('tc14', add(R, -14), 'Be live in stores for TuneCore playlist consideration', 'TuneCore says the release must be approved and processed in stores at least 2 weeks before release day.' + srcLink('tc'));
      if (d.umSpotify) it('um5', subBiz(R, 5), 'Delivered to Spotify (UnitedMasters)', 'UnitedMasters says Spotify needs the release at least 5 business days before release day.' + srcLink('um'));
    }
    it('release', R, 'Release day', 'Open the song on ' + (plats.length ? esc(plats.join(', ')) : 'each service') + '. Check the title, artist name, art and credits. Then share it.');

    items.sort(function (a, b) { return a.date - b.date; });
    var warns = [];
    if (R < T) warns.push('That release date is in the past.');
    else {
      if (U < T) warns.push('Your release date is sooner than ' + esc(d.name) + ' recommends. To be safe, move it to ' + fmt(add(T, lead)) + ' or later.');
      if (sp && add(R, -7) < T) warns.push('It\'s too late to pitch this release to Spotify\'s editors. Pitches need at least 7 days.');
      else if (tight) warns.push('With only ' + lead + ' days between upload and release, there may not be time to pitch to Spotify. The song has to be delivered before you can pitch, and pitches close 7 days before release. Upload earlier if you want to pitch.');
    }
    var html = '<div class="cl-head"><h2>Your checklist for ' + fmt(R) + '</h2><p class="fine">Distributor: ' + esc(d.name) + (st.dist === 'amuse' ? ' (' + { artist: 'Artist', plus: 'Artist Plus', pro: 'Artist Pro' }[st.amusePlan] + ')' : '') + ' · Platforms: ' + (plats.length ? esc(plats.join(', ')) : 'none picked') + '</p></div>';
    warns.forEach(function (w) { html += '<p class="cl-warn" role="alert">⚠ ' + w + '</p>'; });
    html += '<ol class="cl">';
    items.forEach(function (x) {
      var past = x.date < T, done = !!st.done[x.id];
      html += '<li class="' + (done ? 'done' : '') + '"><label><input type="checkbox" data-id="' + x.id + '"' + (done ? ' checked' : '') + '><span class="when' + (past && !done ? ' late' : '') + '">' + fmt(x.date) + '</span><b>' + x.title + '</b></label><p>' + x.body + '</p></li>';
    });
    html += '</ol>';
    $('out').innerHTML = html;
    Array.prototype.forEach.call($('out').querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.addEventListener('change', function () { st.done[cb.getAttribute('data-id')] = cb.checked; save(st); cb.closest('li').classList.toggle('done', cb.checked); });
    });
    $('actions').hidden = false;
    var text = 'Release Checklist for ' + fmt(R) + '\nDistributor: ' + d.name + ' · Platforms: ' + plats.join(', ') + '\n' + warns.map(function (w) { return '! ' + w.replace(/<[^>]+>/g, ''); }).join('\n') + (warns.length ? '\n' : '') + '\n' +
      items.map(function (x) {
        var body = x.body.replace(/<a class="src"[^>]*>source<\/a>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/&amp;/g, '&').trim();
        return '[' + (st.done[x.id] ? 'x' : ' ') + '] ' + fmt(x.date) + ': ' + x.title.replace(/<[^>]+>/g, '') + '\n    ' + body;
      }).join('\n') + '\n\nMade with the free Release Checklist at https://porchlightmix.github.io/release-checklist.html. Check your distributor for the latest rules.';
    window.__checklist = { release: iso(R), upload: iso(U), items: items.map(function (x) { return { id: x.id, date: iso(x.date) }; }), warnings: warns.length, text: text };
    return text;
  }

  function update() { readForm(); $('amuse-row').hidden = st.dist !== 'amuse'; build(); }
  writeForm(); $('amuse-row').hidden = (st.dist || 'distrokid') !== 'amuse';
  readForm(); build();
  if (window.__checklistPrefilled) { var pf = document.createElement('p'); pf.className = 'fine prefilled'; pf.setAttribute('role', 'status'); pf.textContent = 'Filled in from your link. Change anything below and the dates update.'; var fm = $('form'); fm.parentNode.insertBefore(pf, fm); }
  Array.prototype.forEach.call(document.querySelectorAll('#form input, #form select'), function (el) { el.addEventListener('change', update); el.addEventListener('input', update); });
  $('print').addEventListener('click', function () { window.print(); });
  $('copy').addEventListener('click', function () {
    var t = window.__checklist && window.__checklist.text; if (!t) return;
    var done = function () { $('copied').textContent = 'Copied. Paste it into your notes or an email to yourself.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { $('copied').textContent = 'Couldn\'t copy. Select the list and copy it by hand.'; } document.body.removeChild(ta); }
  });
  $('reset').addEventListener('click', function () { st.done = {}; save(st); build(); });
})();
