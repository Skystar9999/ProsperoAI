// Prospero Music Studio — logic for /music page. No inline JS (CSP script-src 'self').
(function () {
  'use strict';
  var KEY = 'prospero-key';
  var AUDIO_DIR = '/download0/ProsperoAI/work/audio/';
  var MUSIC_RE = /yue2|yue|ace[-_]?step|kokoro|chatterbox|sheetsage/i;
  var $ = function (id) { return document.getElementById(id); };

  function apiKey() { return localStorage.getItem(KEY) || ''; }

  function api(path, body, timeoutMs, method) {
    var opts = { headers: {} };
    var k = apiKey();
    if (k) opts.headers['Authorization'] = 'Bearer ' + k;
    if (body !== undefined) {
      opts.method = method || 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctl && timeoutMs) setTimeout(function () { ctl.abort(); }, timeoutMs);
    if (ctl) opts.signal = ctl.signal;
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) { $('key-bar').hidden = false; throw new Error('API key required (401)'); }
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 200)); });
      return r.json();
    });
  }

  function setStatus(msg, cls) {
    var el = $('gen-status');
    el.textContent = msg || '';
    el.className = cls || '';
  }

  // ---- models ----
  function loadModels() {
    return api('/api/models/presets').then(function (j) {
      var sel = $('model');
      sel.innerHTML = '';
      (j.data || []).forEach(function (m) {
        if (!MUSIC_RE.test(m.id || '') && !MUSIC_RE.test(m.name || '')) return;
        var o = document.createElement('option');
        o.value = m.id;
        o.textContent = (m.installed ? '' : '(not installed) ') + (m.name || m.id);
        if (MUSIC_RE.test(m.id) && /yue2/i.test(m.id) && m.installed) o.selected = true;
        sel.appendChild(o);
      });
      if (!sel.options.length) {
        var o2 = document.createElement('option');
        o2.value = 'yue2-3b-q8-0'; o2.textContent = 'yue2-3b-q8-0';
        sel.appendChild(o2);
      }
      $('status-dot').className = 'dot on';
    }).catch(function (e) { $('status-dot').className = 'dot'; setStatus('Cannot load presets: ' + e.message, 'err'); });
  }

  // ---- runtime settings ----
  function loadSettings() {
    return api('/api/settings/runtime').then(function (s) {
      if (typeof s.audio_lyrics === 'string') $('lyrics').value = s.audio_lyrics;
      if (s.audio_duration_sec) { $('duration').value = s.audio_duration_sec; }
      if (s.audio_seed) $('seed').value = s.audio_seed;
      $('dur-val').textContent = $('duration').value;
      var opts = String(s.audio_options || '');
      opts.split('\n').forEach(function (line) {
        var kv = line.split('=');
        if (kv.length < 2) return;
        var key = kv[0].trim(), val = kv.slice(1).join('=').trim();
        if (key === 'cot') $('cot').value = val;
        else if (key === 'abc_max_tokens') $('abc-max').value = val;
        else if (key === 'abc_file') {
          var name = val.replace(AUDIO_DIR, '');
          $('abc-name').value = name;
          fetch(AUDIO_DIR + name).then(function (r) { return r.ok ? r.text() : ''; })
            .then(function (t) { if (t) $('abc').value = t; }).catch(function () {});
        }
      });
    }).catch(function () {});
  }

  function buildOptions(abcName) {
    var lines = [];
    if (!abcName) return '';
    var cot = $('cot').value;
    if (cot) lines.push('cot=' + cot);
    lines.push('abc_file=' + AUDIO_DIR + abcName);
    if ($('abc-max').value) lines.push('abc_max_tokens=' + $('abc-max').value);
    return lines.join('\n');
  }

  // ---- custom audio player (big seekbar under play, ⋮ menu with WAV/MP3 download) ----
  var activePlayer = null;
  function fmtTime(s) {
    if (!isFinite(s)) return '--:--';
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function mp3FromUrl(url, name, done, fail) {
    if (!window.lamejs) { fail(new Error('MP3 encoder not loaded')); return; }
    setStatus('Converting to MP3 — keep this page open...', 'busy');
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('download failed: HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      // Fast path: parse PCM WAV ourselves inside a Web Worker (no tab freeze).
      try {
        var w = new Worker('/mp3-worker.js');
        w.onmessage = function (e) {
          var d = e.data || {};
          if (d.pct !== undefined) { setStatus('Encoding MP3... ' + d.pct + '%', 'busy'); return; }
          if (d.done) {
            w.terminate();
            var blob = new Blob([d.mp3], { type: 'audio/mpeg' });
            var a2 = document.createElement('a');
            a2.href = URL.createObjectURL(blob);
            a2.download = name.replace(/\.[a-z0-9]+$/i, '') + '.mp3';
            document.body.appendChild(a2); a2.click();
            setTimeout(function () { URL.revokeObjectURL(a2.href); a2.remove(); }, 5000);
            done(blob.size);
            return;
          }
          if (d.error) { w.terminate(); fail(new Error(d.error)); return; }
          if (d.fallback) { w.terminate(); mp3DecodeFallback(buf, name, done, fail); }
        };
        w.onerror = function () { w.terminate(); mp3DecodeFallback(buf, name, done, fail); };
        w.postMessage({ buf: buf }, [buf]);
        return;
      } catch (e) { /* Worker ctor unsupported (very old browser) */ }
      mp3DecodeFallback(buf, name, done, fail);
    }).catch(fail);
  }
  function mp3DecodeFallback(buf, name, done, fail) {
    setStatus('Converting to MP3 (compat mode, page may pause)...', 'busy');
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    new Promise(function (res, rej) {
      ctx.decodeAudioData(buf, res, function (e) { rej(new Error('decode failed: ' + e)); });
    }).then(function (dec) {
      var rate = dec.sampleRate, ch = Math.min(2, dec.numberOfChannels);
      var enc = new lamejs.Mp3Encoder(ch, rate, 320);
      var chans = []; for (var c = 0; c < ch; c++) {
        var f = dec.getChannelData(c), i16 = new Int16Array(f.length);
        for (var i = 0; i < f.length; i++) { var v = Math.max(-1, Math.min(1, f[i])); i16[i] = v < 0 ? v * 32768 : v * 32767; }
        chans.push(i16);
      }
      var BLOCK = 1152, out = [], total = chans[0].length;
      for (var off = 0; off < total; off += BLOCK) {
        var a = chans[0].subarray(off, off + BLOCK);
        var b = ch > 1 ? chans[1].subarray(off, off + BLOCK) : null;
        var chunk = b ? enc.encodeBuffer(a, b) : enc.encodeBuffer(a);
        if (chunk.length) out.push(new Uint8Array(chunk));
      }
      var end = enc.flush(); if (end.length) out.push(new Uint8Array(end));
      try { ctx.close(); } catch (e) {}
      var blob = new Blob(out, { type: 'audio/mpeg' });
      var a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = name.replace(/\.[a-z0-9]+$/i, '') + '.mp3';
      document.body.appendChild(a2); a2.click();
      setTimeout(function () { URL.revokeObjectURL(a2.href); a2.remove(); }, 5000);
      done(blob.size);
    }).catch(fail);
  }
  // ---- Stems: browser-side AI separation (ONNX Web, validated vs PyTorch) ----
  // Worker script must load with a JS MIME from a same-origin URL (served at
  // /stems-worker.js by the app's HTTP server). The blob: fallback only works
  // in secure contexts (localhost dev) — http://console-ip blocks blob workers.
  function stemsFromUrl(url, name, onStage, done, fail) {
    var settled = false, lastStage = '', lastPct = 0, triedBlob = false;
    function wire(w, isBlob) {
      var gotMsg = false;
      w.onmessage = function (e) {
        gotMsg = true;
        var d = e.data || {};
        if (d.stage !== undefined) { lastStage = d.stage; onStage(lastStage || 'Separating stems', lastPct || null); return; }
        if (d.pct !== undefined) { lastPct = d.pct; onStage(lastStage || 'Separating stems', lastPct); return; }
        if (d.done) { settled = true; w.terminate(); done(d.vocals, d.inst, d.secs); return; }
        if (d.error) { settled = true; w.terminate(); fail(new Error(d.error)); }
      };
      w.onerror = function () {
        if (settled) return;
        if (!gotMsg && !isBlob && !triedBlob) { triedBlob = true; w.terminate(); blobPath(); return; }
        settled = true; w.terminate(); fail(new Error('worker crashed'));
      };
      w.postMessage({ url: new URL(url, location.origin).href, baseUrl: location.origin });
    }
    function blobPath() {
      fetch('/download0/ProsperoAI/work/audio/stems-worker.js').then(function (r) {
        if (!r.ok) throw new Error('stems worker missing (HTTP ' + r.status + ')');
        return r.text();
      }).then(function (code) {
        wire(new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))), true);
      }).catch(function (e) { if (!settled) { settled = true; fail(e); } });
    }
    try {
      wire(new Worker('/stems-worker.js'), false);
    } catch (e) {
      blobPath();
    }
  }

  // ---- shared volume (persisted, applied to every player live) ----
  function getStoredVol() {
    var v = parseInt(localStorage.getItem('prospero-vol'), 10);
    return isNaN(v) ? 80 : Math.max(0, Math.min(100, v));
  }

  // ---- Cover: reload a track's saved generation settings into the form ----
  function applyCover(meta, filename) {
    if (meta.lyrics !== undefined) $('lyrics').value = meta.lyrics;
    if (meta.style !== undefined) $('style').value = meta.style;
    if (meta.seed !== undefined) $('seed').value = String(meta.seed);
    if (meta.duration !== undefined) {
      $('duration').value = String(meta.duration);
      $('dur-val').textContent = $('duration').value;
    }
    if (meta.cot !== undefined) $('cot').value = meta.cot;
    if (meta.abc_name !== undefined) $('abc-name').value = meta.abc_name;
    if (meta.abc_content) { $('abc').value = meta.abc_content; if (meta.abc_name) knownFiles[meta.abc_name] = true; }
    var base = String(filename || '').replace(/\.(wav|mp3)$/i, '').replace(/_seed\d+$/i, '');
    $('track-name').value = (base ? base + ' cover' : 'cover');
    try { formSaveNow(); } catch (e) {}
    $('lyrics').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('Cover settings loaded from ' + filename + ' — press GENERATE', 'ok');
  }

  // ---- Master: explicit-only mastering (peak normalize + limiter), browser-side ----
  function encodeWav16(buffer) {
    var ch = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
    var bytes = 44 + len * ch * 2;
    var ab = new ArrayBuffer(bytes), dv = new DataView(ab);
    function str(off, s) { for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true);
    dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, len * ch * 2, true);
    var chans = [], c;
    for (c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    var off = 44;
    for (var i = 0; i < len; i++) {
      for (c = 0; c < ch; c++) {
        var v = Math.max(-1, Math.min(1, chans[c][i]));
        dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7FFF, true); off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }
  function masterTrack(url, onProgress) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('fetch ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      var AC = window.AudioContext || window.webkitAudioContext;
      var ac = new AC();
      return ac.decodeAudioData(buf).then(function (decoded) {
        var peak = 0, c, d = decoded.getChannelData(0), i;
        for (c = 0; c < decoded.numberOfChannels; c++) {
          d = decoded.getChannelData(c);
          for (i = 0; i < d.length; i++) { var a = d[i] < 0 ? -d[i] : d[i]; if (a > peak) peak = a; }
        }
        if (peak < 0.001) throw new Error('audio is silent');
        var gain = Math.min(0.89 / peak, 12);
        var oc = new OfflineAudioContext(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
        var src = oc.createBufferSource(); src.buffer = decoded;
        var g = oc.createGain(); g.gain.value = gain;
        var lim = oc.createDynamicsCompressor();
        lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 16;
        lim.attack.value = 0.003; lim.release.value = 0.12;
        src.connect(g); g.connect(lim); lim.connect(oc.destination);
        src.start();
        onProgress('Mastering (normalize to -1 dBFS + limiter)...');
        return oc.startRendering();
      }).then(function (rendered) { ac.close(); return rendered; });
    });
  }

  function makePlayer(url, filename, isMp3Source, meta) {
    var wrap = document.createElement('div'); wrap.className = 'pl';
    var audio = new Audio(); audio.preload = 'metadata'; audio.src = url;
    var row = document.createElement('div'); row.className = 'pl-row';
    var play = document.createElement('button'); play.type = 'button'; play.className = 'pl-play'; play.textContent = '▶';
    var tm = document.createElement('span'); tm.className = 'pl-time'; tm.textContent = '0:00 / --:--';
    var vol = document.createElement('input'); vol.type = 'range'; vol.className = 'pl-vol';
    vol.min = '0'; vol.max = '100'; vol.step = '1'; vol.value = String(getStoredVol()); vol.title = 'Volume';
    audio.volume = getStoredVol() / 100;
    var menuBtn = document.createElement('button'); menuBtn.type = 'button'; menuBtn.className = 'pl-menu'; menuBtn.textContent = '⋮'; menuBtn.title = 'More actions';
    var menu = document.createElement('div'); menu.className = 'pl-menu-box'; menu.style.display = 'none';
    var dlWav = document.createElement('a'); dlWav.href = url; dlWav.download = filename; dlWav.textContent = '⬇ Download WAV'; dlWav.style.display = isMp3Source ? 'none' : '';
    var dlMp3 = document.createElement('button'); dlMp3.type = 'button'; dlMp3.textContent = isMp3Source ? '⬇ Download MP3' : '⬇ Download MP3 (320k, converts in browser)';
    var coverBtn = document.createElement('button'); coverBtn.type = 'button';
    var hasMeta = meta && Object.keys(meta).length > 0;
    if (hasMeta) {
      coverBtn.textContent = '🎤 Cover — load lyrics/style/seed';
      coverBtn.addEventListener('click', function (e) {
        e.stopPropagation(); menu.style.display = 'none';
        applyCover(meta, filename);
      });
    } else {
      coverBtn.textContent = '🎤 Cover (no saved settings — old track)';
      coverBtn.disabled = true; coverBtn.className = 'pl-menu-dim';
    }
    var masterBtn = document.createElement('button'); masterBtn.type = 'button';
    masterBtn.textContent = '🎚 Master (normalize + limiter)';
    var stemsBtn = document.createElement('button'); stemsBtn.type = 'button';
    stemsBtn.textContent = '✂ Stems — vocals + instrumental (browser AI)';
    if (isMp3Source) stemsBtn.style.display = 'none';
    menu.appendChild(dlWav); menu.appendChild(dlMp3); menu.appendChild(coverBtn); menu.appendChild(masterBtn); menu.appendChild(stemsBtn);
    row.appendChild(play); row.appendChild(tm); row.appendChild(vol); row.appendChild(menuBtn); row.appendChild(menu);
    vol.addEventListener('input', function () {
      try { localStorage.setItem('prospero-vol', vol.value); } catch (e) {}
      document.dispatchEvent(new CustomEvent('music-vol', { detail: parseInt(vol.value, 10) }));
    });
    document.addEventListener('music-vol', function (e) { audio.volume = e.detail / 100; });
    var seek = document.createElement('input'); seek.type = 'range'; seek.className = 'pl-seek'; seek.min = '0'; seek.max = '1000'; seek.value = '0';
    wrap.appendChild(row); wrap.appendChild(seek);
    var dragging = false;
    play.addEventListener('click', function () {
      if (audio.paused) {
        if (activePlayer && activePlayer !== api_) activePlayer.pause();
        activePlayer = api_;
        audio.play();
      } else audio.pause();
    });
    audio.addEventListener('play', function () { play.textContent = '❚❚'; });
    audio.addEventListener('pause', function () { play.textContent = '▶'; });
    audio.addEventListener('ended', function () { play.textContent = '▶'; seek.value = '0'; });
    audio.addEventListener('loadedmetadata', function () { tm.textContent = '0:00 / ' + fmtTime(audio.duration); });
    audio.addEventListener('timeupdate', function () {
      if (!dragging && audio.duration) {
        seek.value = String(Math.round(audio.currentTime / audio.duration * 1000));
        tm.textContent = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
      }
    });
    seek.addEventListener('input', function () {
      dragging = true;
      if (audio.duration) tm.textContent = fmtTime(seek.value / 1000 * audio.duration) + ' / ' + fmtTime(audio.duration);
    });
    seek.addEventListener('change', function () {
      if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration;
      dragging = false;
    });
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? '' : 'none';
    });
    document.addEventListener('click', function () { menu.style.display = 'none'; });
    dlMp3.addEventListener('click', function (e) {
      e.stopPropagation(); menu.style.display = 'none';
      if (isMp3Source) { dlWav.href = url; dlWav.download = filename; dlWav.click(); return; }
      mp3FromUrl(url, filename,
        function (bytes) { setStatus('MP3 ready: ' + fmtSize(bytes) + ' — check your Downloads', 'ok'); },
        function (err) { setStatus('MP3 conversion failed: ' + err.message, 'err'); });
    });
    masterBtn.addEventListener('click', function (e) {
      e.stopPropagation(); menu.style.display = 'none';
      var m0 = Date.now();
      setStatus('Mastering ' + filename + ' (decode + normalize + limiter)...', 'busy');
      masterTrack(url, function (msg) { setStatus(msg, 'busy'); }).then(function (rendered) {
        var blob = encodeWav16(rendered);
        var outName = filename.replace(/\.(wav|mp3)$/i, '') + '-mastered.wav';
        var a2 = document.createElement('a');
        a2.href = URL.createObjectURL(blob); a2.download = outName;
        document.body.appendChild(a2); a2.click();
        setTimeout(function () { URL.revokeObjectURL(a2.href); a2.remove(); }, 5000);
        setStatus('Mastered ' + outName + ' in ' + Math.round((Date.now() - m0) / 1000) +
          's (' + fmtSize(blob.size) + ') — check your Downloads', 'ok');
      }).catch(function (err) {
        setStatus('Master failed: ' + (err && err.message ? err.message : err), 'err');
      });
    });
    stemsBtn.addEventListener('click', function (e) {
      e.stopPropagation(); menu.style.display = 'none';
      var s0 = Date.now();
      setStatus('Stems: preparing...', 'busy');
      stemsFromUrl(url, filename,
        function (stg, p) { setStatus((stg || 'Separating stems') + (p ? ' — ' + p + '%' : '') + ' — keep this page open', 'busy'); },
        function (vocBuf, instBuf, secs) {
          var base = filename.replace(/\.(wav|mp3)$/i, '');
          [['-vocals.wav', vocBuf], ['-instrumental.wav', instBuf]].forEach(function (pair, idx) {
            var blob = new Blob([pair[1]], { type: 'audio/wav' });
            var a2 = document.createElement('a');
            a2.href = URL.createObjectURL(blob); a2.download = base + pair[0];
            document.body.appendChild(a2);
            setTimeout(function () { a2.click(); }, idx * 400); // Chrome multi-download gesture grace
            setTimeout(function () { URL.revokeObjectURL(a2.href); a2.remove(); }, 15000);
          });
          setStatus('Stems done in ' + secs + 's — downloaded ' + base + '-vocals.wav + -instrumental.wav (' +
            Math.round((Date.now() - s0) / 1000) + 's total incl. model)', 'ok');
        },
        function (err) { setStatus('Stems failed: ' + (err && err.message ? err.message : err), 'err'); });
    });
    var api_ = { pause: function () { audio.pause(); } };
    return wrap;
  }



  // ---- library ----
  function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }
  function fmtDate(t) { try { return new Date(t * 1000).toLocaleString('en-GB'); } catch (e) { return ''; } }

  function loadLibrary() {
    return api('/api/music/files').then(function (j) {
      trackFiles(j);
      var box = $('tracks');
      box.innerHTML = '';
      var files = j.files || [];
      if (!files.length) { box.innerHTML = '<div class="empty">No files yet.</div>'; }
      files.forEach(function (f) {
        var d = document.createElement('div'); d.className = 'track';
        var m = document.createElement('div'); m.className = 'meta';
        var n = document.createElement('span'); n.className = 'name'; n.textContent = f.name;
        var s = document.createElement('span');
        s.textContent = fmtSize(f.size) + ' · ' + fmtDate(f.mtime);
        m.appendChild(n); m.appendChild(s);
        d.appendChild(m);
        // settings card: how this track was made (v28 sidecar meta)
        if (f.meta && Object.keys(f.meta).length) {
          var det = document.createElement('details'); det.className = 'track-settings';
          var sum = document.createElement('summary');
          var bits = [];
          if (f.meta.style) bits.push(f.meta.style);
          if (f.meta.seed !== undefined) bits.push('seed ' + f.meta.seed);
          if (f.meta.duration !== undefined) bits.push(f.meta.duration + 's');
          if (f.meta.cot) bits.push('cot=' + f.meta.cot);
          if (f.meta.abc_name) bits.push('ABC: ' + f.meta.abc_name);
          sum.textContent = '\u2699 ' + (bits.join(' \u00b7 ') || 'saved settings');
          det.appendChild(sum);
          if (f.meta.lyrics) {
            var pre = document.createElement('pre'); pre.className = 'track-lyrics';
            pre.textContent = f.meta.lyrics;
            det.appendChild(pre);
          }
          d.appendChild(det);
        }
        if (/\.(wav|mp3)$/i.test(f.name)) {
          d.appendChild(makePlayer(AUDIO_DIR + encodeURIComponent(f.name), f.name, /\.mp3$/i.test(f.name), f.meta));
        } else {
          var ext = document.createElement('div'); ext.className = 'path';
          ext.textContent = 'ABC — use \u201cLoad into editor\u201d to edit it';
          d.appendChild(ext);
        }
        var del = document.createElement('button');
        del.type = 'button'; del.className = 'del'; del.textContent = '🗑';
        del.title = 'Delete ' + f.name;
        del.addEventListener('click', function () {
          if (!window.confirm('Delete ' + f.name + '?')) return;
          api('/api/music/file', { name: f.name }, 15000, 'DELETE')
            .then(function () { delete knownFiles[f.name]; loadLibrary(); loadAbcSelect(); })
            .catch(function (e) { setStatus('Delete failed: ' + e.message, 'err'); });
        });
        s.appendChild(document.createTextNode(' '));
        s.appendChild(del);
        box.appendChild(d);
      });
    }).catch(function (e) { $('tracks').innerHTML = '<div class="empty">' + e.message + '</div>'; });
  }

  // ---- ABC save/load ----
  function loadAbcSelect() {
    return api('/api/music/files').then(function (j) {
      var sel = $('abc-files');
      sel.innerHTML = '';
      (j.files || []).filter(function (f) { return /\.abc$/i.test(f.name); }).forEach(function (f) {
        var o = document.createElement('option'); o.value = f.name; o.textContent = f.name;
        sel.appendChild(o);
      });
    }).catch(function () {});
  }

  $('abc-save').addEventListener('click', function () {
    var name = $('abc-name').value.trim() || 'studio.abc';
    if (!/\.abc$/i.test(name)) name += '.abc';
    setStatus('Saving ABC...', 'busy');
    api('/api/music/abc', { name: name, content: $('abc').value })
      .then(function () { $('abc-name').value = name; setStatus('ABC saved: ' + name); loadAbcSelect(); loadLibrary(); })
      .catch(function (e) { setStatus('Saving ABC failed: ' + e.message, 'err'); });
  });

  $('abc-open').addEventListener('click', function () { $('abc-disk').click(); });
  $('abc-disk').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      $('abc').value = reader.result;
      var base = f.name.split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '_');
      if (!/\.abc$/i.test(base)) base += '.abc';
      $('abc-name').value = base;
      setStatus('File ' + f.name + ' loaded into editor — press GENERATE (auto-saves)', 'ok');
    };
    reader.readAsText(f);
    ev.target.value = '';
  });
  $('abc-clear').addEventListener('click', function () {
    $('abc').value = '';
    setStatus('Editor cleared — no score at GENERATE', 'ok');
  });

  $('abc-load').addEventListener('click', function () {
    var name = ($('abc-files').value || $('abc-name').value || '').trim();
    if (!name) { setStatus('Missing ABC file name', 'err'); return; }
    fetch(AUDIO_DIR + encodeURIComponent(name)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) { $('abc').value = t; $('abc-name').value = name; setStatus('Loaded: ' + name); })
      .catch(function (e) { setStatus('Load failed: ' + e.message, 'err'); });
  });

  // ---- generate ----
  var knownFiles = {};
  function trackFiles(j) { (j.files || []).forEach(function (f) { knownFiles[f.name] = true; }); }

  function runGeneration() {
    var btn = $('generate');
    if (btn.disabled) return;
    btn.disabled = true;
    var t0 = Date.now();
    var timer = setInterval(function () {
      setStatus('Running... ' + Math.round((Date.now() - t0) / 1000) +
        's (model load + generation can take 4-6 min)', 'busy');
    }, 1000);
    var abcName = $('abc-name').value.trim();
    if (abcName && !/\.abc$/i.test(abcName)) abcName += '.abc';
    var abcContent = $('abc').value.trim();
    var doGenerate = function (effectiveName) {
      setStatus('Sending settings...', 'busy');
      var body = {
        audio_lyrics: $('lyrics').value,
        audio_duration_sec: parseInt($('duration').value, 10) || 240,
        audio_seed: parseInt($('seed').value, 10) || 42,
        // always sent: empty = CLEAR inherited options (otherwise an abc_file
        // from an earlier session stays in runtime settings and the engine sees it)
        audio_options: buildOptions(effectiveName)
      };
      return api('/api/settings/runtime', body).then(function () {
        setStatus('Generating...', 'busy');
        return api('/api/generate', { model: $('model').value, prompt: $('style').value }, 1800000);
      });
    };
    // ABC: non-empty editor => auto-save and use the file; empty editor =>
    // only names that already exist on the PS5; otherwise no abc_file at all.
    var pre = Promise.resolve('');
    if (abcName && abcContent) {
      setStatus('Auto-saving ABC...', 'busy');
      pre = api('/api/music/abc', { name: abcName, content: $('abc').value })
        .then(function () { knownFiles[abcName] = true; return abcName; });
    } else if (abcName && knownFiles[abcName]) {
      pre = Promise.resolve(abcName);
    } else if (abcName) {
      setStatus('ABC "' + abcName + '" missing on PS5 and the editor is empty — generating without a score', 'busy');
    }
    pre.then(doGenerate).then(function (j) {
      clearInterval(timer);
      var resp = String(j.response || j.error || JSON.stringify(j).slice(0, 300));
      var m = resp.match(/\/download0\/\S+?\.(?:wav|mp3)/);
      var res = $('result');
      res.innerHTML = '';
      if (m) {
        var url = m[0].replace(/[",).]+$/, '');
        var finish = function (finalUrl) {
          var res = $('result');
          res.innerHTML = '';
          var fname = (finalUrl.match(/[^/]+(\?|$)/) || ['track.wav'])[0];
          // snapshot the exact settings so the library menu can offer Cover later
          var meta = {
            lyrics: $('lyrics').value,
            style: $('style').value,
            seed: parseInt($('seed').value, 10) || 42,
            duration: parseInt($('duration').value, 10) || 240,
            model: String($('model').value || ''),
            cot: $('cot').value,
            abc_name: $('abc-name').value.trim(),
            created: Math.floor(Date.now() / 1000)
          };
          var abcText = $('abc').value;
          if (abcText.trim() && abcText.length <= 60000) meta.abc_content = abcText;
          res.appendChild(makePlayer(finalUrl, fname, /\.mp3$/i.test(finalUrl), meta));
          var p = document.createElement('div'); p.className = 'path'; p.textContent = finalUrl;
          res.appendChild(p);
          setStatus('Done in ' + Math.round((Date.now() - t0) / 1000) + 's 🎵');
          api('/api/music/meta', { name: fname, meta: meta })
            .then(loadLibrary).catch(loadLibrary);
        };
        var nice = $('track-name').value.trim();
        if (nice) {
          var src = url.substring(url.lastIndexOf('/') + 1);
          var ext = src.substring(src.lastIndexOf('.'));
          var safe = nice.toLowerCase().replace(/[ăâîșțşţ]/g, function (c) {
            return { 'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ş': 's', 'ț': 't', 'ţ': 't' }[c];
          }).replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
          if (!safe) safe = 'piesa';
          var dst = safe + '_seed' + ($('seed').value || '42') + ext;
          api('/api/music/rename', { src: src, dst: dst }).then(function () {
            finish(url.replace(src, dst));
          }).catch(function () {
            finish(url);
            setStatus('Track is ready, but "' + dst + '" already exists — kept the original name', 'err');
          });
        } else {
          finish(url);
        }
      } else {
        var res2 = $('result');
        res2.innerHTML = '';
        var p2 = document.createElement('div'); p2.className = 'path'; p2.textContent = resp;
        res2.appendChild(p2);
        setStatus('Response without audio file', 'err');
      }
    }).catch(function (e) {
      clearInterval(timer);
      setStatus('Failed: ' + e.message, 'err');
    }).then(function () { btn.disabled = false; });
  }
  $('generate').addEventListener('click', runGeneration);

  // ---- cover (audio -> ABC via SheetSage2) ----
  // The browser decodes any browser-supported audio (MP3/WAV/OGG/M4A) to
  // 16 kHz mono PCM16 with Web Audio, uploads it in <=200 KiB base64 parts
  // (the console's request buffer is 256 KiB), then runs the sheetsage2
  // model through the standard /api/generate path. The score artifact is
  // loaded straight into the ABC editor.
  $('cover-go').addEventListener('click', function () {
    var file = $('cover-file').files && $('cover-file').files[0];
    var btn = $('cover-go');
    if (!file || btn.disabled) return;
    btn.disabled = true;
    var t0 = Date.now();
    var cstatus = function (m, c) {
      var el = $('cover-status');
      el.textContent = m || '';
      el.className = c || '';
    };
    var wav = null, name = '';
    cstatus('Decoding ' + file.name + '...', 'busy');
    file.arrayBuffer().then(function (buf) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !AudioContext.prototype.decodeAudioData)
        throw new Error('this browser has no Web Audio decoder');
      var ctx = new AC();
      var p = ctx.decodeAudioData(buf);
      return p.then(function (ab) { return ab; });
    }).then(function (ab) {
      var rate = 16000;
      var frames = Math.max(1, Math.ceil(ab.duration * rate));
      if (frames > 300 * rate) throw new Error('audio longer than 5 min — trim it first');
      var off = new OfflineAudioContext(1, frames, rate);
      var src = off.createBufferSource();
      src.buffer = ab;
      src.connect(off.destination);
      src.start();
      return off.startRendering();
    }).then(function (rendered) {
      var pcm = rendered.getChannelData(0);
      var view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
      var ws = function (o, s) { for (var i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true);
      ws(8, 'WAVE'); ws(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      ws(36, 'data'); view.setUint32(40, pcm.length * 2, true);
      for (var i = 0; i < pcm.length; i++) {
        var v = Math.max(-1, Math.min(1, pcm[i]));
        view.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true);
      }
      wav = new Uint8Array(view.buffer);
      var base = file.name.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      base = (base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'cover').toLowerCase();
      name = base + '-src.wav';
      var CHUNK = 140 * 1024;
      var parts = Math.max(1, Math.ceil(wav.length / CHUNK));
      var part = 0;
      var b64 = function (u8) {
        var s = '', CH = 0x8000;
        for (var i = 0; i < u8.length; i += CH)
          s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
        return btoa(s);
      };
      var next = function () {
        if (part >= parts) return Promise.resolve();
        cstatus('Uploading ' + name + ': part ' + (part + 1) + '/' + parts + ' (' +
          Math.round(100 * part / parts) + '%)', 'busy');
        var slice = wav.subarray(part * CHUNK, Math.min((part + 1) * CHUNK, wav.length));
        return api('/api/music/upload', { name: name, part: part, data: b64(slice) }, 120000)
          .then(function () { part++; return next(); });
      };
      return next();
    }).then(function () {
      cstatus('Transcribing with SheetSage2 (first run loads the 2.7 GB model — be patient)...',
        'busy');
      return api('/api/settings/runtime',
        { audio_options: 'input_audio=' + AUDIO_DIR + name }, 30000)
        .then(function () {
          return api('/api/generate',
            { model: 'sheetsage2-orig', prompt: 'transcribe ' + name }, 1800000);
        });
    }).then(function (j) {
      var resp = String(j.response || j.error || JSON.stringify(j).slice(0, 400));
      var m = resp.match(/\/download0\/\S+?\.abc/);
      if (!m) throw new Error('no ABC artifact in response: ' + resp.slice(0, 220));
      var path = m[0].replace(/["',).]+$/, '');
      var fname = path.substring(path.lastIndexOf('/') + 1);
      return fetch(AUDIO_DIR + encodeURIComponent(fname)).then(function (r) {
        if (!r.ok) throw new Error('fetch score HTTP ' + r.status);
        return r.text();
      }).then(function (t) {
        $('abc').value = t;
        $('abc-name').value = name.replace(/-src\.wav$/, '-cover.abc');
        cstatus('Cover done in ' + Math.round((Date.now() - t0) / 1000) +
          's — score loaded into the editor ✅', 'ok');
        setStatus('Score ' + fname + ' loaded — press GENERATE to make it a song', 'ok');
        loadLibrary(); loadAbcSelect();
      });
    }).catch(function (e) {
      cstatus('Cover failed: ' + (e && e.message ? e.message : e), 'err');
    }).then(function () {
      $('cover-file').value = '';
      btn.disabled = false;
    });
  });
  $('regen').addEventListener('click', function () {
    var s = $('seed');
    s.value = String(Math.min(4294967295, (parseInt(s.value, 10) || 42) + 1));
    runGeneration();
  });

  // ---- misc ----
  $('duration').addEventListener('input', function () { $('dur-val').textContent = $('duration').value; });
  $('dice').addEventListener('click', function () {
    $('seed').value = 1 + Math.floor(Math.random() * 4294967294);
  });
  $('refresh').addEventListener('click', function () { loadLibrary(); loadAbcSelect(); });
  $('key-save').addEventListener('click', function () {
    localStorage.setItem(KEY, $('key-input').value.trim());
    $('key-bar').hidden = true;
    loadModels(); loadSettings(); loadLibrary(); loadAbcSelect();
  });

  // ---- form persistence (survives refresh; lyrics/style/abc/opts all kept) ----
  var FORM_KEY = 'prospero-music-form-v1';
  var FORM_IDS = ['lyrics', 'style', 'abc', 'abc-name', 'cot', 'abc-max', 'duration', 'seed', 'track-name'];
  function restoreForm() {
    try {
      var saved = JSON.parse(localStorage.getItem(FORM_KEY) || '{}');
      FORM_IDS.forEach(function (id) {
        var el = $(id);
        if (el && saved[id] !== undefined && saved[id] !== null) el.value = saved[id];
      });
      $('dur-val').textContent = $('duration').value;
    } catch (e) {}
  }
  var formSaveT = 0;
  function formSaveNow() {
    var o = {};
    FORM_IDS.forEach(function (id) { var el = $(id); if (el) o[id] = el.value; });
    try { localStorage.setItem(FORM_KEY, JSON.stringify(o)); } catch (e) {}
  }
  FORM_IDS.forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('input', function () {
      clearTimeout(formSaveT); formSaveT = setTimeout(formSaveNow, 300);
    });
  });

  loadModels(); loadLibrary(); loadAbcSelect();
  // Restore AFTER server settings land so the user's last (possibly unsaved)
  // edits win over the server-persisted snapshot.
  loadSettings().then(restoreForm);
})();
