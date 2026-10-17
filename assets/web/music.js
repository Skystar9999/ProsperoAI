// Prospero Music Studio — logic for /music page. No inline JS (CSP script-src 'self').
(function () {
  'use strict';
  var KEY = 'prospero-key';
  var AUDIO_DIR = '/download0/ProsperoAI/work/audio/';
  var MUSIC_RE = /yue2|yue|ace[-_]?step|kokoro|chatterbox/i;
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
      if (r.status === 401) { $('key-bar').hidden = false; throw new Error('API key necesar (401)'); }
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
        o.textContent = (m.installed ? '' : '(neinstalat) ') + (m.name || m.id);
        if (MUSIC_RE.test(m.id) && /yue2/i.test(m.id) && m.installed) o.selected = true;
        sel.appendChild(o);
      });
      if (!sel.options.length) {
        var o2 = document.createElement('option');
        o2.value = 'yue2-3b-q8-0'; o2.textContent = 'yue2-3b-q8-0';
        sel.appendChild(o2);
      }
      $('status-dot').className = 'dot on';
    }).catch(function (e) { $('status-dot').className = 'dot'; setStatus('Nu pot încărca preseturile: ' + e.message, 'err'); });
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

  // ---- library ----
  function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }
  function fmtDate(t) { try { return new Date(t * 1000).toLocaleString('ro-RO'); } catch (e) { return ''; } }

  function loadLibrary() {
    return api('/api/music/files').then(function (j) {
      trackFiles(j);
      var box = $('tracks');
      box.innerHTML = '';
      var files = j.files || [];
      if (!files.length) { box.innerHTML = '<div class="empty">Niciun fișier încă.</div>'; }
      files.forEach(function (f) {
        var d = document.createElement('div'); d.className = 'track';
        var m = document.createElement('div'); m.className = 'meta';
        var n = document.createElement('span'); n.className = 'name'; n.textContent = f.name;
        var s = document.createElement('span');
        s.textContent = fmtSize(f.size) + ' · ' + fmtDate(f.mtime);
        m.appendChild(n); m.appendChild(s);
        d.appendChild(m);
        if (/\.(wav|mp3)$/i.test(f.name)) {
          var a = document.createElement('audio');
          a.controls = true; a.preload = 'none'; a.src = AUDIO_DIR + encodeURIComponent(f.name);
          d.appendChild(a);
        } else {
          var ext = document.createElement('div'); ext.className = 'path';
          ext.textContent = 'ABC — se încarcă în editor cu „Încarcă în editor”';
          d.appendChild(ext);
        }
        var del = document.createElement('button');
        del.type = 'button'; del.className = 'del'; del.textContent = '🗑';
        del.title = 'Șterge ' + f.name;
        del.addEventListener('click', function () {
          if (!window.confirm('Șterg ' + f.name + '?')) return;
          api('/api/music/file', { name: f.name }, 15000, 'DELETE')
            .then(function () { delete knownFiles[f.name]; loadLibrary(); loadAbcSelect(); })
            .catch(function (e) { setStatus('Ștergere eșuată: ' + e.message, 'err'); });
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
    setStatus('Salvez ABC...', 'busy');
    api('/api/music/abc', { name: name, content: $('abc').value })
      .then(function () { $('abc-name').value = name; setStatus('ABC salvat: ' + name); loadAbcSelect(); loadLibrary(); })
      .catch(function (e) { setStatus('Salvare ABC eșuată: ' + e.message, 'err'); });
  });

  $('abc-load').addEventListener('click', function () {
    var name = ($('abc-files').value || $('abc-name').value || '').trim();
    if (!name) { setStatus('Nume fișier ABC lipsă', 'err'); return; }
    fetch(AUDIO_DIR + encodeURIComponent(name)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) { $('abc').value = t; $('abc-name').value = name; setStatus('Încărcat: ' + name); })
      .catch(function (e) { setStatus('Încărcare eșuată: ' + e.message, 'err'); });
  });

  // ---- generate ----
  var knownFiles = {};
  function trackFiles(j) { (j.files || []).forEach(function (f) { knownFiles[f.name] = true; }); }

  $('generate').addEventListener('click', function () {
    var btn = $('generate');
    btn.disabled = true;
    var t0 = Date.now();
    var timer = setInterval(function () {
      setStatus('Rulează... ' + Math.round((Date.now() - t0) / 1000) +
        's (modelul încarcă/generează, poate dura 4-6 min)', 'busy');
    }, 1000);
    var abcName = $('abc-name').value.trim();
    if (abcName && !/\.abc$/i.test(abcName)) abcName += '.abc';
    var abcContent = $('abc').value.trim();
    var doGenerate = function (effectiveName) {
      setStatus('Trimit setările...', 'busy');
      var body = {
        audio_lyrics: $('lyrics').value,
        audio_duration_sec: parseInt($('duration').value, 10) || 240,
        audio_seed: parseInt($('seed').value, 10) || 42
      };
      var opts = buildOptions(effectiveName);
      if (opts) body.audio_options = opts;
      return api('/api/settings/runtime', body).then(function () {
        setStatus('Generez...', 'busy');
        return api('/api/generate', { model: $('model').value, prompt: $('style').value }, 1800000);
      });
    };
    // ABC: editor plin => salvăm automat și folosim fișierul; editor gol =>
    // doar nume care există deja pe PS5; altfel fără abc_file (deloc).
    var pre = Promise.resolve('');
    if (abcName && abcContent) {
      setStatus('Salvez ABC automat...', 'busy');
      pre = api('/api/music/abc', { name: abcName, content: $('abc').value })
        .then(function () { knownFiles[abcName] = true; return abcName; });
    } else if (abcName && knownFiles[abcName]) {
      pre = Promise.resolve(abcName);
    } else if (abcName) {
      setStatus('ABC „' + abcName + '” inexistent pe PS5 și editorul e gol — generez fără partitură', 'busy');
    }
    pre.then(doGenerate).then(function (j) {
      clearInterval(timer);
      var resp = String(j.response || j.error || JSON.stringify(j).slice(0, 300));
      var m = resp.match(/\/download0\/\S+?\.(?:wav|mp3)/);
      var res = $('result');
      res.innerHTML = '';
      if (m) {
        var url = m[0].replace(/[",).]+$/, '');
        var a = document.createElement('audio');
        a.controls = true; a.src = url;
        res.appendChild(a);
        var p = document.createElement('div'); p.className = 'path'; p.textContent = url;
        res.appendChild(p);
        setStatus('Gata în ' + Math.round((Date.now() - t0) / 1000) + 's 🎵');
        loadLibrary();
      } else {
        var p2 = document.createElement('div'); p2.className = 'path'; p2.textContent = resp;
        res.appendChild(p2);
        setStatus('Răspuns fără fișier audio', 'err');
      }
    }).catch(function (e) {
      clearInterval(timer);
      setStatus('Eșec: ' + e.message, 'err');
    }).then(function () { btn.disabled = false; });
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

  loadModels(); loadSettings(); loadLibrary(); loadAbcSelect();
})();
