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
        if (/\.(wav|mp3)$/i.test(f.name)) {
          var a = document.createElement('audio');
          a.controls = true; a.preload = 'none'; a.src = AUDIO_DIR + encodeURIComponent(f.name);
          d.appendChild(a);
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
          var a = document.createElement('audio');
          a.controls = true; a.src = finalUrl;
          res.appendChild(a);
          var p = document.createElement('div'); p.className = 'path'; p.textContent = finalUrl;
          res.appendChild(p);
          setStatus('Done in ' + Math.round((Date.now() - t0) / 1000) + 's 🎵');
          loadLibrary();
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

  loadModels(); loadSettings(); loadLibrary(); loadAbcSelect();
})();
