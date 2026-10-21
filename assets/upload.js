/* Porchlight Mix upload page: sends the song to our upload service in 8 MB chunks with a progress bar. */
(function () {
  "use strict";
  var meta = function (n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ""; };
  var API = meta("upload-api").replace(/\/$/, "");
  var SITEKEY = meta("turnstile-sitekey");
  var MAX = 200 * 1024 * 1024, MIN = 50 * 1024, EXTS = ["wav", "wave", "aif", "aiff", "flac", "mp3"];
  var $ = function (id) { return document.getElementById(id); };
  var form = $("upform"), fileIn = $("file"), drop = $("drop"), errEl = $("err"), sendBtn = $("send");
  var tsWidget = null, tsToken = "", busy = false;

  window.porchlightTurnstile = function () {
    tsWidget = window.turnstile.render("#turnstile", {
      sitekey: SITEKEY,
      theme: "dark",
      callback: function (t) { tsToken = t; },
      "expired-callback": function () { tsToken = ""; },
      "error-callback": function () { tsToken = ""; }
    });
  };

  function mb(n) { return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB"; }
  function showErr(msg) { errEl.textContent = msg || ""; }
  function fileProblem(f) {
    if (!f) return "Please choose your audio file.";
    var ext = (f.name.split(".").pop() || "").toLowerCase();
    if (f.name.indexOf(".") < 0 || EXTS.indexOf(ext) < 0) return "Please upload a WAV, AIFF, FLAC or MP3 file.";
    if (f.size > MAX) return "That file is " + mb(f.size) + ". The limit is 200 MB. A 24-bit WAV of a song is usually 30–80 MB.";
    if (f.size < MIN) return "That file looks empty or incomplete.";
    return "";
  }
  function showChosen() {
    var f = fileIn.files[0]; $("chosen").textContent = f ? f.name + " (" + mb(f.size) + ")" : "";
    showErr(f ? fileProblem(f) : "");
  }
  fileIn.addEventListener("change", showChosen);
  ["dragenter", "dragover"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (ev) { if (ev.dataTransfer.files.length) { fileIn.files = ev.dataTransfer.files; showChosen(); } });
  // v2: re-check option + optional release details (all re-checked by the server).
  var DISTS = ["distrokid", "cdbaby", "tunecore", "amuse", "unitedmasters", "other"];
  var REF_RE = /^[A-Za-z0-9#][A-Za-z0-9#_-]{2,39}$/;
  function syncExtras() {
    var on = $("recheck").checked;
    $("recheck-more").hidden = !on; $("recheck").setAttribute("aria-expanded", on ? "true" : "false");
    $("amuse-row").hidden = $("distributor").value !== "amuse";
    $("other-row").hidden = $("distributor").value !== "other";
    $("done-kind").textContent = on ? "Your re-check of" : "Your song";
  }
  $("recheck").addEventListener("change", syncExtras);
  $("distributor").addEventListener("change", syncExtras);
  syncExtras();
  ["original_ref", "release_date", "distributor"].forEach(function (id) { $(id).addEventListener("input", function () { if (!busy) showErr(""); }); });
  function dateProblem(v) {
    if (!v) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    var d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return "Please check the release date.";
    var days = (d.getTime() - Date.now()) / 864e5;
    if (days < -366 || days > 3 * 366) return "Please check the release date. It should be no more than a year ago and no more than 3 years ahead.";
    return "";
  }
  window.addEventListener("beforeunload", function (e) { if (busy) { e.preventDefault(); e.returnValue = ""; } });

  function progress(done, total, label) {
    var box = $("progress");
    if (box.style.display !== "block") { box.style.display = "block"; box.scrollIntoView({ block: "center", behavior: "smooth" }); }
    var pct = total ? Math.floor((done / total) * 100) : 0;
    $("barfill").style.width = pct + "%";
    $("ptxt").textContent = label || ("Uploading… " + pct + "% (" + mb(done) + " of " + mb(total) + "). Please keep this page open.");
  }

  function call(method, path, body, token) {
    var headers = {};
    if (token) headers["X-Upload-Token"] = token;
    if (body && !(body instanceof Blob)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    return fetch(API + path, { method: method, headers: headers, body: body }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || "Upload failed (" + r.status + ")."); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  // One chunk via XHR so we get byte-level progress; retried up to 4 times on network/server errors.
  function sendPart(blob, n, token, onBytes) {
    var attempt = 0;
    return new Promise(function (resolve, reject) {
      (function go() {
        attempt++;
        var x = new XMLHttpRequest(); var last = 0;
        x.open("PUT", API + "/api/part?n=" + n);
        x.setRequestHeader("X-Upload-Token", token);
        x.upload.onprogress = function (e) { onBytes(e.loaded - last); last = e.loaded; };
        x.onload = function () {
          var j = {}; try { j = JSON.parse(x.responseText); } catch (_) {}
          if (x.status === 200) { onBytes(blob.size - last); return resolve(j); }
          onBytes(-last);
          if (x.status >= 500 && attempt < 5) return setTimeout(go, 1500 * attempt);
          reject(new Error(j.error || "Upload failed (" + x.status + ")."));
        };
        x.onerror = function () { onBytes(-last); if (attempt < 5) return setTimeout(go, 2000 * attempt); reject(new Error("The connection dropped. Please check your internet and try again.")); };
        x.send(blob);
      })();
    });
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault(); if (busy) return; showErr("");
    var f = fileIn.files[0], v = function (id) { return $(id).value.trim(); };
    var inst = form.querySelector('input[name="instrumental"]:checked');
    var problem = !/^[^@\s,;<>]+@[^@\s,;<>]+\.[A-Za-z]{2,}$/.test(v("email")) ? "Please check your email address." :
      !v("name") ? "Please add your name." : !v("title") ? "Please add the song title." :
      !v("genre") ? "Please pick a genre." : !inst ? "Please say whether it's an instrumental." :
      fileProblem(f) ||
      ($("recheck").checked && v("original_ref") && !REF_RE.test(v("original_ref")) ? "That reference doesn't look right. Please copy it from your confirmation or report email, or leave it blank." : "") ||
      dateProblem(v("release_date")) ||
      (v("distributor") && DISTS.indexOf(v("distributor")) < 0 ? "Please pick a distributor from the list, or choose Other." : "") ||
      (!$("consent").checked ? "Please tick the consent box." : "") ||
      (!tsToken ? "Please wait a moment for the spam check below to finish, then try again." : "");
    if (problem) return showErr(problem);

    busy = true; sendBtn.disabled = true; sendBtn.textContent = "Sending…";
    var payload = { email: v("email"), name: v("name"), title: v("title"), artist: v("artist"), genre: v("genre"),
      instrumental: inst.value, notes: v("notes"), consent: true, updates: $("updates").checked, website: $("website").value,
      filename: f.name, size: f.size, turnstileToken: tsToken,
      recheck: $("recheck").checked, original_ref: $("recheck").checked ? v("original_ref") : "",
      release_date: v("release_date"), distributor: v("distributor"),
      distributor_other: v("distributor") === "other" ? v("distributor_other") : "",
      amuse_plan: v("distributor") === "amuse" ? v("amuse_plan") : "" };
    var sent = 0, token = null;
    progress(0, f.size, "Starting upload…");
    call("POST", "/api/start", payload).then(function (s) {
      token = s.token;
      var parts = [], idx = [];
      for (var i = 1; i <= s.parts; i++) idx.push(i);
      var bump = function (d) { sent += d; progress(sent, f.size); };
      var chunk = function (n) { return f.slice((n - 1) * s.partSize, Math.min(n * s.partSize, f.size)); };
      // first chunk alone (the server checks it's real audio), then 3 at a time
      return sendPart(chunk(1), 1, token, bump).then(function (r) {
        parts.push({ partNumber: 1, etag: r.etag }); idx.shift();
        var worker = function () {
          var n = idx.shift(); if (!n) return Promise.resolve();
          return sendPart(chunk(n), n, token, bump).then(function (r) { parts.push({ partNumber: n, etag: r.etag }); return worker(); });
        };
        return Promise.all([worker(), worker(), worker()]);
      }).then(function () {
        progress(f.size, f.size, "Finishing up…");
        return call("POST", "/api/complete", { parts: parts }, token);
      }).then(function (c) {
        busy = false; form.style.display = "none";
        $("done-title").textContent = "“" + payload.title + "”"; $("done-email").textContent = payload.email; $("done-id").textContent = c.id;
        $("done").style.display = "block"; $("done").focus(); window.scrollTo(0, 0);
      });
    }).catch(function (e) {
      if (token) call("POST", "/api/abort", {}, token).catch(function () {});
      busy = false; sendBtn.disabled = false; sendBtn.textContent = "Send my song";
      $("progress").style.display = "none"; showErr(e.message || "Upload failed. Please try again.");
      tsToken = ""; if (window.turnstile && tsWidget !== null) window.turnstile.reset(tsWidget);
    });
  });
})();
