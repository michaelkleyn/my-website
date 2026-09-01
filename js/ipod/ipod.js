/**
 * iPod 3G — a working recreation of the 2003 dock-connector iPod, living under
 * the "ipod" scene node on the index page.
 *
 * Menu tree follows Apple's "iPod (with Dock Connector) User's Guide" (2004,
 * software 2.x): main menu Playlists/Browse/Extras/Settings/Backlight, with
 * Now Playing appearing only while a song is playing or paused. Photo Import
 * and Voice Memos only ever appeared with their accessories connected, so they
 * are available as Main Menu toggles (Settings > Main Menu) rather than shown
 * by default.
 *
 * The rig div copies the ipod image node's generated placement CSS out of
 * #scene-style, so it follows the layout editor live and rides the book camera
 * for free. It sits at z 10 (image is z 11): the LCD shows through the artwork's
 * transparent screen hole, and the invisible hit zones still get clicks because
 * scene nodes are pointer-events:none.
 */
(function () {
  'use strict';

  // ---- geometry (fractions of the 934x1566 artwork) ----------------------
  var ASPECT = 934 / 1566; // width / height
  var GEO = {
    wheel: { cx: 0.5, cy: 0.746, r: 0.323 },   // r = fraction of width
    hub: { r: 0.122 },
    buttons: [
      { act: 'prev', cx: 0.172, cy: 0.48, r: 0.095 },
      { act: 'menu', cx: 0.392, cy: 0.48, r: 0.095 },
      { act: 'play', cx: 0.6125, cy: 0.48, r: 0.095 },
      { act: 'next', cx: 0.833, cy: 0.48, r: 0.095 }
    ]
  };

  // ---- state --------------------------------------------------------------
  var LS_KEY = 'ipod3g';
  var DEFAULTS = {
    shuffle: 'Off', repeat: 'Off', soundCheck: 'Off', clicker: 'On',
    eq: 'Flat', backlightTimer: '10 Seconds', contrast: 50, volume: 0.6,
    mainMenu: { Songs: 'Off', Artists: 'Off', Albums: 'Off', Genres: 'Off', Composers: 'Off', Clock: 'Off', Contacts: 'Off', Calendar: 'Off', Notes: 'Off', Games: 'Off', 'Photo Import': 'Off', 'Voice Memos': 'Off', Sleep: 'Off' }
  };
  var cfg = load();
  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      var out = JSON.parse(JSON.stringify(DEFAULTS));
      for (var k in raw) { if (k === 'mainMenu') Object.assign(out.mainMenu, raw.mainMenu); else out[k] = raw[k]; }
      return out;
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* private mode */ } }

  var LIB = { songs: [], playlists: [] };
  var queue = [];   // indices into LIB.songs
  var qi = -1;
  var audio = new Audio();
  audio.volume = cfg.volume;

  // ---- DOM ----------------------------------------------------------------
  var rig = document.createElement('div');
  rig.id = 'ipod-rig';
  rig.setAttribute('aria-hidden', 'true');

  var screen = document.createElement('div');
  screen.className = 'ipod-screen';
  screen.innerHTML = '<div class="ipod-title"><span class="t"></span><span class="ipod-batt"></span></div><div class="ipod-body"></div>';
  rig.appendChild(screen);
  var titleEl = screen.querySelector('.t');
  var bodyEl = screen.querySelector('.ipod-body');

  function pct(n) { return (n * 100).toFixed(2) + '%'; }
  function circle(cx, cy, r, cls) {
    var d = document.createElement('div');
    d.className = 'ipod-hit ' + (cls || '');
    // r is a fraction of rig WIDTH; convert the vertical size via the aspect
    d.style.left = pct(cx - r);
    d.style.width = pct(2 * r);
    d.style.top = pct(cy - r * ASPECT);
    d.style.height = pct(2 * r * ASPECT);
    rig.appendChild(d);
    return d;
  }
  var shadowEl = document.createElement('div');
  shadowEl.className = 'ipod-shadow';
  rig.appendChild(shadowEl);

  // pick the iPod up by its body — the screen/wheel/button zones sit on top
  // and keep their own behavior; position is session-only (see js/grab.js)
  var grabEl = document.createElement('div');
  grabEl.className = 'grab';
  grabEl.style.cssText = 'position:absolute;inset:0;pointer-events:auto;cursor:grab;touch-action:none;';
  rig.insertBefore(grabEl, screen);
  function wireGrab(el) {
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', function (e) {
      if (window.sceneGrab && window.sceneGrab.start('ipod', e)) {
        el.style.cursor = 'grabbing';
        rig.classList.add('lifted');
      }
    });
    function drop() { el.style.cursor = 'grab'; rig.classList.remove('lifted'); }
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
  }
  wireGrab(grabEl);
  wireGrab(screen); // dragging by the LCD works too; wheel-scroll over it still scrolls menus

  var wheelEl = circle(GEO.wheel.cx, GEO.wheel.cy, GEO.wheel.r, 'wheel');
  var hubEl = circle(GEO.wheel.cx, GEO.wheel.cy, GEO.hub.r, 'hub');
  GEO.buttons.forEach(function (b) {
    circle(b.cx, b.cy, b.r).addEventListener('click', function () { press(b.act); });
  });
  hubEl.addEventListener('click', function () { press('select'); });

  // ---- placement: mirror the scene node's generated CSS -------------------
  function syncStyle() {
    var st = document.getElementById('scene-style');
    var m = st && /\[data-node-id="ipod"\]\s*\{([^}]*)\}/.exec(st.textContent);
    if (!m) { rig.style.cssText = 'display:none;'; return; }
    rig.style.cssText = m[1] +
      ';position:absolute;pointer-events:none;z-index:10;height:auto;aspect-ratio:' +
      '934/1566;container-type:inline-size;';
    applyContrast();
  }

  function mount() {
    var host = document.getElementById('book-space');
    var layer = host && host.querySelector('.scene-layer--book');
    var st = document.getElementById('scene-style');
    if (!layer || !st) { setTimeout(mount, 250); return; }
    layer.appendChild(rig);
    syncStyle();
    new MutationObserver(function () {
      if (!rig.isConnected) layer.appendChild(rig); // render() wipes the layer
    }).observe(layer, { childList: true });
    new MutationObserver(syncStyle).observe(st, { childList: true, characterData: true, subtree: true });
  }

  // ---- clicker + backlight ------------------------------------------------
  var ac = null;
  function tick() {
    if (cfg.clicker !== 'On') return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = 1400;
      g.gain.setValueAtTime(0.03, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.02);
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.02);
    } catch (e) { /* no audio */ }
  }

  var backlightTimer = null;
  var BACKLIGHT_SECS = { 'Off': 0, '2 Seconds': 2, '5 Seconds': 5, '10 Seconds': 10, '20 Seconds': 20, 'Always On': -1 };
  // Dark mode leaves the backlight on, the way a lit LCD is the only thing you
  // see on a dark desk. That holds until the owner works the backlight controls
  // themselves; from then on it is theirs, and a reload starts from the theme again.
  var ownBacklight = false;
  function themeLit() { return !ownBacklight && document.documentElement.dataset.theme === 'dark'; }
  function syncBacklight() {
    if (ownBacklight) return;
    clearTimeout(backlightTimer);
    screen.classList.toggle('lit', themeLit());
  }
  window.addEventListener('themechange', syncBacklight);
  function backlightPoke(force) {
    var secs = BACKLIGHT_SECS[cfg.backlightTimer] || 0;
    if (!force && secs === 0) return;
    screen.classList.add('lit');
    clearTimeout(backlightTimer);
    if (secs !== -1) backlightTimer = setTimeout(function () { if (!themeLit()) screen.classList.remove('lit'); }, (secs || 5) * 1000);
  }
  // picking a new timer hands the backlight over and applies that choice now
  function takeBacklight() {
    ownBacklight = true;
    clearTimeout(backlightTimer);
    screen.classList.remove('lit');
    backlightPoke();
  }
  function backlightToggle() {
    ownBacklight = true;
    if (screen.classList.contains('lit')) { clearTimeout(backlightTimer); screen.classList.remove('lit'); }
    else backlightPoke(true);
  }

  function applyContrast() {
    screen.style.filter = 'contrast(' + (0.7 + (cfg.contrast / 100) * 0.6).toFixed(2) + ')';
  }

  // ---- navigation stack ---------------------------------------------------
  var stack = []; // { view, sel, top }  (top = first visible row)
  var ROWS = 6;
  function top() { return stack[stack.length - 1]; }
  function push(view) { stack.push({ view: view, sel: 0, top: 0 }); render(); }
  function pop() {
    if (stack.length > 1) {
      var f = stack.pop();
      if (f.view.onExit) f.view.onExit();
      render();
    }
  }

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function render() {
    var f = top();
    if (!f) return;
    var v = f.view;
    titleEl.textContent = typeof v.title === 'function' ? v.title() : v.title;
    if (v.kind === 'custom') { v.render(bodyEl, f); return; }
    var items = v.items();
    if (f.sel >= items.length) f.sel = Math.max(0, items.length - 1);
    if (f.sel < f.top) f.top = f.sel;
    if (f.sel >= f.top + ROWS) f.top = f.sel - ROWS + 1;
    var hasBar = items.length > ROWS;
    var html = '';
    for (var i = f.top; i < Math.min(items.length, f.top + ROWS); i++) {
      var it = items[i];
      html += '<div class="ipod-row' + (i === f.sel ? ' sel' : '') + (hasBar ? ' has-scroll' : '') + '">' +
        esc(it.label) +
        (it.right ? '<span class="r">' + esc(it.right) + '</span>' : (it.go ? '<span class="r">&gt;</span>' : '')) +
        '</div>';
    }
    if (hasBar) {
      var th = Math.max(10, (ROWS / items.length) * 100);
      var tt = (f.top / Math.max(1, items.length - ROWS)) * (100 - th);
      html += '<div class="ipod-scrollbar"><div class="thumb" style="top:' + tt + '%;height:' + th + '%"></div></div>';
    }
    bodyEl.innerHTML = html;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // ---- input --------------------------------------------------------------
  function scrollStep(dir) {
    backlightPoke();
    var f = top();
    if (!f) return;
    if (f.view.onScroll) { f.view.onScroll(dir, f); return; }
    var n = f.view.items().length;
    if (!n) return;
    var next = Math.min(n - 1, Math.max(0, f.sel + dir));
    if (next !== f.sel) { f.sel = next; tick(); render(); }
  }

  function press(act) {
    backlightPoke();
    var f = top();
    if (act === 'menu') {
      if (f.view.onMenu && f.view.onMenu(f)) return; // view consumed it (e.g. solitaire cancels a held card)
      pop(); return;
    }
    if (act === 'select') {
      if (f.view.onSelect) { f.view.onSelect(f); return; }
      var it = f.view.items()[f.sel];
      if (!it) return;
      if (it.act) { it.act(); render(); }
      if (it.go) push(it.go());
      return;
    }
    if (act === 'play') {
      if (qi >= 0) { audio.paused ? audio.play() : audio.pause(); render(); }
      else if (f.view.playFrom) f.view.playFrom(f);
      return;
    }
    if (act === 'prev') {
      if (qi < 0) return;
      if (audio.currentTime > 3) audio.currentTime = 0; else skip(-1);
      return;
    }
    if (act === 'next') { if (qi >= 0) skip(1); }
  }

  // wheel: circular drag
  var drag = null;
  wheelEl.style.borderRadius = '50%';
  wheelEl.addEventListener('pointerdown', function (e) {
    wheelEl.setPointerCapture(e.pointerId);
    drag = { last: angleOf(e), acc: 0, moved: false };
  });
  wheelEl.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var a = angleOf(e);
    var d = a - drag.last;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    drag.last = a;
    drag.acc += d;
    while (drag.acc > 20) { drag.acc -= 20; drag.moved = true; scrollStep(1); }
    while (drag.acc < -20) { drag.acc += 20; drag.moved = true; scrollStep(-1); }
  });
  wheelEl.addEventListener('pointerup', function () { drag = null; });
  function angleOf(e) {
    var r = wheelEl.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  }
  // mouse wheel anywhere on the rig scrolls too
  var wheelAcc = 0;
  [wheelEl, hubEl, screen].forEach(function (el) {
    el.style.pointerEvents = 'auto';
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      wheelAcc += e.deltaY;
      while (wheelAcc > 35) { wheelAcc -= 35; scrollStep(1); }
      while (wheelAcc < -35) { wheelAcc += 35; scrollStep(-1); }
    }, { passive: false });
  });

  // ---- playback -----------------------------------------------------------
  function playQueue(indices, at) {
    queue = indices.slice();
    if (cfg.shuffle === 'Songs') {
      var first = queue.splice(at, 1)[0];
      for (var i = queue.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = queue[i]; queue[i] = queue[j]; queue[j] = t; }
      queue.unshift(first);
      at = 0;
    }
    qi = at;
    startCurrent();
    push(nowPlayingView());
  }
  function startCurrent() {
    var song = LIB.songs[queue[qi]];
    if (!song) return;
    audio.src = song.src;
    audio.play().catch(function () { /* file missing — UI still runs */ });
  }
  function skip(dir) {
    if (cfg.repeat === 'One' && dir === 0) { audio.currentTime = 0; audio.play(); return; }
    var n = qi + dir;
    if (n >= queue.length) {
      if (cfg.repeat === 'All') n = 0;
      else { audio.pause(); audio.currentTime = 0; render(); return; }
    }
    if (n < 0) n = 0;
    qi = n;
    startCurrent();
    render();
  }
  audio.addEventListener('ended', function () { cfg.repeat === 'One' ? skip(0) : skip(1); });
  audio.addEventListener('timeupdate', function () {
    var f = top();
    if (f && f.view.np) render();
  });

  // ---- views --------------------------------------------------------------
  function songList(title, indices) {
    return {
      title: title,
      items: function () {
        return indices().map(function (si, pos) {
          return { label: LIB.songs[si].title, act: function () { playQueue(indices(), pos); } };
        });
      },
      playFrom: function (f) { playQueue(indices(), f.sel); }
    };
  }
  function allSongs() { return LIB.songs.map(function (_, i) { return i; }); }
  function byField(field) {
    var m = {};
    LIB.songs.forEach(function (s, i) { var k = s[field] || 'Unknown'; (m[k] = m[k] || []).push(i); });
    return m;
  }
  function browseField(title, field) {
    return {
      title: title,
      items: function () {
        var m = byField(field);
        return Object.keys(m).sort().map(function (k) {
          return { label: k, go: function () { return songList(k, function () { return byField(field)[k] || []; }); } };
        });
      }
    };
  }

  function nowPlayingView() {
    var volUntil = 0;
    return {
      title: 'Now Playing', np: true, kind: 'custom',
      render: function (el) {
        var song = LIB.songs[queue[qi]] || {};
        var dur = audio.duration || 0;
        var pos = audio.currentTime || 0;
        var showVol = Date.now() < volUntil;
        var frac = showVol ? audio.volume : (dur ? pos / dur : 0);
        el.innerHTML = '<div class="ipod-np">' +
          '<div class="idx">' + (qi + 1) + ' of ' + queue.length + (audio.paused ? ' &nbsp;&#10074;&#10074;' : '') + '</div>' +
          '<div class="t1">' + esc(song.title || '') + '</div>' +
          '<div class="t2">' + esc(song.artist || '') + '</div>' +
          '<div class="t3">' + esc(song.album || '') + '</div>' +
          '<div class="ipod-bar"><div class="fill" style="width:' + (frac * 100).toFixed(1) + '%"></div></div>' +
          (showVol
            ? '<div class="ipod-times"><span>volume</span></div>'
            : '<div class="ipod-times"><span>' + fmt(pos) + '</span><span>-' + fmt(dur - pos) + '</span></div>') +
          '</div>';
      },
      onScroll: function (dir) {
        audio.volume = Math.min(1, Math.max(0, audio.volume + dir * 0.05));
        cfg.volume = audio.volume; save();
        volUntil = Date.now() + 1200;
        tick(); render();
        setTimeout(render, 1300);
      },
      onSelect: function () { /* real 3G: scrub mode — ponytail: skipped */ }
    };
  }

  function textView(title, html, live) {
    return {
      title: title, kind: 'custom',
      render: function (el) {
        el.innerHTML = '<div class="ipod-text">' + (typeof html === 'function' ? html() : html) + '</div>';
        if (live && top().view.title === title) {
          clearTimeout(textView._t);
          textView._t = setTimeout(function () { var f = top(); if (f && f.view.title === title) render(); }, 1000);
        }
      }
    };
  }

  function cycle(label, key, values) {
    return {
      label: label,
      get right() { return cfg[key]; },
      act: function () { cfg[key] = values[(values.indexOf(cfg[key]) + 1) % values.length]; save(); tick(); }
    };
  }
  function pickList(title, key, values, after) {
    return {
      title: title,
      items: function () {
        return values.map(function (v) {
          return { label: v, right: cfg[key] === v ? '✓' : '', act: function () { cfg[key] = v; save(); if (after) after(); pop(); } };
        });
      }
    };
  }

  var sleepAt = null, sleepTimer = null;
  function setSleep(mins) {
    clearTimeout(sleepTimer);
    if (!mins) { sleepAt = null; return; }
    sleepAt = Date.now() + mins * 60000;
    sleepTimer = setTimeout(function () { audio.pause(); sleepAt = null; render(); }, mins * 60000);
  }

  var clockView = {
    title: 'Clock',
    items: function () {
      return [
        { label: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), right: '' },
        { label: 'Alarm Clock', go: function () { return textView('Alarm Clock', 'Alarm is Off<br>(set one in 2003)'); } },
        { label: 'Sleep Timer', go: function () { return pickList('Sleep', '_sleep', ['Off', '15 Minutes', '30 Minutes', '60 Minutes', '90 Minutes', '120 Minutes'], function () { setSleep(parseInt(cfg._sleep) || 0); }); } }
      ];
    }
  };

  var extrasView = {
    title: 'Extras',
    items: function () {
      return [
        { label: 'Clock', go: function () { return clockView; } },
        { label: 'Contacts', go: function () { return { title: 'Contacts', items: function () { return [{ label: 'Kleyn, Michael', go: function () { return textView('Michael Kleyn', 'Michael Kleyn<br>michaelkleyn.com<br><br>says hi from the pond'); } }]; } }; } },
        { label: 'Calendar', go: function () { return { title: 'Calendar', items: function () { return [{ label: 'To Do', go: function () { return textView('To Do', 'feed the fish<br>write in the journal'); } }, { label: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }), right: 'no events' }]; } }; } },
        { label: 'Notes', go: function () { return { title: 'Notes', items: function () { return [{ label: 'about this iPod', go: function () { return textView('about this iPod', 'a 2003 iPod, living<br>in a painted journal.<br>the music is real.'); } }]; } }; } },
        { label: 'Games', go: function () { return gamesView(); } }
      ];
    }
  };

  function gamesView() {
    var games = window.IpodGames && window.IpodGames.init({
      lib: function () { return LIB; },
      pauseMusic: function () { audio.pause(); },
      tick: tick,
      volume: function () { return cfg.volume; }
    });
    return {
      title: 'Games',
      items: function () {
        if (!games) return [{ label: 'No games found' }];
        return [
          { label: 'Brick', go: games.brick },
          { label: 'Music Quiz', go: games.musicQuiz },
          { label: 'Parachute', go: games.parachute },
          { label: 'Solitaire', go: games.solitaire }
        ];
      }
    };
  }

  var settingsView = {
    title: 'Settings',
    items: function () {
      return [
        { label: 'About', go: function () { return textView('About', function () { return 'mklyn iPod<br>Songs: ' + LIB.songs.length + '<br>Capacity: 15 GB<br>Version: 2.3'; }); } },
        { label: 'Main Menu', go: function () { return mainMenuSettings; } },
        cycle('Shuffle', 'shuffle', ['Off', 'Songs']),
        cycle('Repeat', 'repeat', ['Off', 'One', 'All']),
        cycle('Sound Check', 'soundCheck', ['Off', 'On']),
        { label: 'EQ', go: function () { return pickList('EQ', 'eq', ['Off', 'Acoustic', 'Bass Booster', 'Classical', 'Dance', 'Electronic', 'Flat', 'Hip Hop', 'Jazz', 'Pop', 'Rock']); } },
        { label: 'Backlight Timer', go: function () { return pickList('Backlight', 'backlightTimer', ['Off', '2 Seconds', '5 Seconds', '10 Seconds', '20 Seconds', 'Always On'], takeBacklight); } },
        { label: 'Contrast', go: function () { return contrastView; } },
        cycle('Clicker', 'clicker', ['On', 'Off']),
        { label: 'Date & Time', go: function () { return textView('Date & Time', function () { return new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + '<br><span class="big">' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</span>'; }, true); } },
        { label: 'Legal', go: function () { return textView('Legal', 'Copyright 2003<br>Apple Computer, Inc.<br>(recreated with love,<br>not affiliation)'); } },
        {
          label: 'Reset All Settings',
          act: function () { try { localStorage.removeItem(LS_KEY); } catch (e) {} cfg = load(); audio.volume = cfg.volume; applyContrast(); }
        }
      ];
    }
  };

  var mainMenuSettings = {
    title: 'Main Menu',
    items: function () {
      return Object.keys(cfg.mainMenu).map(function (k) {
        return { label: k, right: cfg.mainMenu[k], act: function () { cfg.mainMenu[k] = cfg.mainMenu[k] === 'On' ? 'Off' : 'On'; save(); tick(); } };
      });
    }
  };

  var contrastView = {
    title: 'Contrast', kind: 'custom',
    render: function (el) {
      el.innerHTML = '<div class="ipod-text"><br><div class="ipod-bar"><div class="fill" style="width:' + cfg.contrast + '%"></div></div></div>';
    },
    onScroll: function (dir) { cfg.contrast = Math.min(100, Math.max(0, cfg.contrast + dir * 5)); save(); applyContrast(); tick(); render(); },
    onSelect: function () { pop(); }
  };

  var playlistsView = {
    title: 'Playlists',
    items: function () {
      return LIB.playlists.map(function (p) {
        return { label: p.name, go: function () { return songList(p.name, function () { return p.songs; }); } };
      }).concat([{ label: 'On-The-Go', go: function () { return songList('On-The-Go', function () { return []; }); } }]);
    }
  };
  var browseView = {
    title: 'Browse',
    items: function () {
      return [
        { label: 'Artists', go: function () { return browseField('Artists', 'artist'); } },
        { label: 'Albums', go: function () { return browseField('Albums', 'album'); } },
        { label: 'Songs', go: function () { return songList('Songs', allSongs); } },
        { label: 'Genres', go: function () { return browseField('Genres', 'genre'); } },
        { label: 'Composers', go: function () { return browseField('Composers', 'composer'); } }
      ];
    }
  };

  // optional main-menu entries (Settings > Main Menu), in the 3G's fixed order
  var OPTIONAL = {
    Songs: function () { return { label: 'Songs', go: function () { return songList('Songs', allSongs); } }; },
    Artists: function () { return { label: 'Artists', go: function () { return browseField('Artists', 'artist'); } }; },
    Albums: function () { return { label: 'Albums', go: function () { return browseField('Albums', 'album'); } }; },
    Genres: function () { return { label: 'Genres', go: function () { return browseField('Genres', 'genre'); } }; },
    Composers: function () { return { label: 'Composers', go: function () { return browseField('Composers', 'composer'); } }; },
    Clock: function () { return { label: 'Clock', go: function () { return clockView; } }; },
    Contacts: function () { return extrasView.items()[1]; },
    Calendar: function () { return extrasView.items()[2]; },
    Notes: function () { return extrasView.items()[3]; },
    Games: function () { return extrasView.items()[4]; },
    'Photo Import': function () { return { label: 'Photo Import', go: function () { return textView('Photo Import', 'No photo card<br>reader attached.'); } }; },
    'Voice Memos': function () { return { label: 'Voice Memos', go: function () { return textView('Voice Memos', 'No microphone<br>attached.'); } }; },
    Sleep: function () { return { label: 'Sleep', act: function () { audio.pause(); screen.classList.remove('lit'); } }; }
  };

  var mainView = {
    title: 'Michael’s iPod',
    items: function () {
      var items = [
        { label: 'Playlists', go: function () { return playlistsView; } },
        { label: 'Browse', go: function () { return browseView; } },
        { label: 'Extras', go: function () { return extrasView; } },
        { label: 'Settings', go: function () { return settingsView; } }
      ];
      Object.keys(OPTIONAL).forEach(function (k) {
        if (cfg.mainMenu[k] === 'On') items.push(OPTIONAL[k]());
      });
      items.push({ label: 'Backlight', act: backlightToggle });
      if (qi >= 0) items.push({ label: 'Now Playing', go: nowPlayingView });
      return items;
    }
  };

  // ---- boot ---------------------------------------------------------------
  applyContrast();
  syncBacklight();
  push(mainView);
  fetch('/assets/ipod/library.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (lib) { if (lib) LIB = lib; render(); })
    .catch(function () { /* empty library — menus still work */ });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
