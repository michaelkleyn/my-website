/**
 * Scene renderer — the runtime for the local-only Layout Compositor.
 *
 * Classic <script> (NOT a module). It MAY use dynamic import() for the editor.
 * Builds a `.scene-layer` container, renders every
 * node from assets/scene/_global.json + assets/scene/<page>.json into it, and
 * emits ONE <style id="scene-style"> block with three breakpoint tiers aligned
 * to 576 / 768. Content nodes are not drawn as art — instead the renderer emits
 * position/size overrides for an existing DOM element.
 *
 * Exposes window.sceneRenderer per the SHARED CONTRACT.
 *
 * Local-only safety: at the very end of the first render, if isEditEnvironment()
 * is true, dynamically import('./layout-editor.js'). In production that branch
 * never runs, so the editor file is never fetched.
 */
(function () {
  'use strict';

  // ---- constants ---------------------------------------------------------

  var SCENE_DIR = (document.documentElement && document.documentElement.dataset.sceneBase) || 'assets/scene/';
  var DEFAULT_BREAKPOINTS = { mobile: 576, tablet: 768, desktop: 99999 };
  var BUCKETS = ['mobile', 'tablet', 'desktop'];
  // Representative "design width" each breakpoint keyframe is exact at. Between
  // these widths the renderer interpolates so layout glides instead of snapping
  // at the 576/768 thresholds. Override per-scene via scene.anchorWidths.
  var DEFAULT_ANCHOR_WIDTHS = { mobile: 390, tablet: 768, desktop: 1440 };

  // ---- internal state ----------------------------------------------------

  var scene = null;                 // merged in-memory scene for this page
  var sceneLayer = null;            // the .scene-layer DOM container (viewport space)
  var bookLayer = null;             // the .scene-layer--book container inside #book-space (book space)
  var currentKey = null;            // page key set by the router (loadPage) — else derived from the URL
  var styleEl = null;               // the <style id="scene-style"> element
  var resizeObserver = null;        // observes element-anchored targets
  var readyResolve = null;
  var readyPromise = new Promise(function (res) { readyResolve = res; });

  // ---- environment / page helpers ---------------------------------------

  function isEditEnvironment() {
    if (/[?&]edit=0(&|$)/.test(location.search)) return false;   // the visitor view, on a dev host
    try {
      var host = location.hostname || '';
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
      if (/\.local$/.test(host)) return true;
      if (/[?&]edit(=|&|$)/.test(location.search)) return true;
    } catch (e) { /* non-browser / restricted */ }
    return false;
  }

  function pageKey() {
    if (currentKey) return currentKey;
    var ds = document.documentElement && document.documentElement.dataset.scenePage;
    if (ds) return ds;
    var path = (location.pathname || '/').toLowerCase();
    // strip trailing slash except root
    if (path.length > 1 && path.charAt(path.length - 1) === '/') {
      path = path.slice(0, -1);
    }
    var file = path.substring(path.lastIndexOf('/') + 1);
    if (path === '' || path === '/' || file === '' || file === 'index.html') return 'index';
    // drop .html extension -> 'projects.html' => 'projects'
    file = file.replace(/\.html?$/, '');
    return file || 'index';
  }

  function getBreakpoints() {
    if (scene && scene.breakpoints) return scene.breakpoints;
    return DEFAULT_BREAKPOINTS;
  }

  function activeBreakpoint() {
    var bp = getBreakpoints();
    var w = window.innerWidth;
    if (w <= (bp.mobile != null ? bp.mobile : DEFAULT_BREAKPOINTS.mobile)) return 'mobile';
    if (w <= (bp.tablet != null ? bp.tablet : DEFAULT_BREAKPOINTS.tablet)) return 'tablet';
    return 'desktop';
  }

  // ---- unit conversion ---------------------------------------------------

  // ---- spaces: a node lives in the viewport (default) or in "book" space — inside #book-space, an element the
  // site transforms (translate + scale) to follow the journal photo. Book nodes use % of that host, so they ride
  // the camera for free; the editor's drag math divides by the host's on-screen rect.
  function spaceOf(node) {
    var sp = (node && node.space) || (scene && scene.space) || 'viewport';
    return sp === 'book' && spaceHost() ? 'book' : 'viewport';
  }
  function spaceHost() { return document.getElementById('book-space'); }
  function spaceRect(node) {
    if (spaceOf(node) === 'book') { var r = spaceHost().getBoundingClientRect(); if (r.width > 0 && r.height > 0) return r; }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  function units(node) { return spaceOf(node) === 'book' ? { x: '%', y: '%' } : { x: 'vw', y: 'vh' }; }

  function pxToPct(px, axis, node) {
    var r = spaceRect(node);
    if (axis === 'x' || axis === 'w') return (px / r.width) * 100;
    return (px / r.height) * 100; // 'y' | 'h'
  }

  function pctToPx(pct, axis, node) {
    var r = spaceRect(node);
    if (axis === 'x' || axis === 'w') return (pct / 100) * r.width;
    return (pct / 100) * r.height;
  }

  // ---- placement resolution ----------------------------------------------

  // Resolve the placement to USE for a given bucket, with desktop as the
  // base/default fallback (desktop -> tablet -> mobile inheritance chain mirrors
  // how CSS media queries cascade off the desktop base in this codebase).
  function resolvePlacement(node, bucket) {
    var p = node.placements || {};
    if (p[bucket]) return p[bucket];
    if (bucket === 'mobile' && p.tablet) return p.tablet;
    if (p.desktop) return p.desktop;
    if (p.tablet) return p.tablet;
    if (p.mobile) return p.mobile;
    return null;
  }

  // ---- fluid interpolation -----------------------------------------------

  function getAnchorWidths() {
    var aw = (scene && scene.anchorWidths) || {};
    return {
      mobile: aw.mobile != null ? aw.mobile : DEFAULT_ANCHOR_WIDTHS.mobile,
      tablet: aw.tablet != null ? aw.tablet : DEFAULT_ANCHOR_WIDTHS.tablet,
      desktop: aw.desktop != null ? aw.desktop : DEFAULT_ANCHOR_WIDTHS.desktop
    };
  }

  // Fluid is the default. A scene (scene.fluid:false) or a single node
  // (node.fluid:false) can opt out to get hard, stepped per-breakpoint placements.
  function sceneIsFluid() { return !scene || scene.fluid !== false; }
  function nodeIsFluid(node) {
    if (node && node.fluid != null) return !!node.fluid;
    return sceneIsFluid();
  }
  function sceneHasFluid() {
    if (!scene || !scene.nodes) return false;
    for (var i = 0; i < scene.nodes.length; i++) {
      if (nodeIsFluid(scene.nodes[i])) return true;
    }
    return false;
  }

  // Present placements sorted ascending by their anchor width.
  function nodeKeyframes(node) {
    var p = node.placements || {};
    var aw = getAnchorWidths();
    var frames = [];
    for (var i = 0; i < BUCKETS.length; i++) {
      var b = BUCKETS[i];
      if (p[b]) frames.push({ w: aw[b], p: p[b] });
    }
    frames.sort(function (a, b) { return a.w - b.w; });
    return frames;
  }

  function lerpNum(a, b, t) { return a + (b - a) * t; }
  function lerpOpt(a, b, t, key) {
    var hasA = typeof a[key] === 'number', hasB = typeof b[key] === 'number';
    if (hasA && hasB) return lerpNum(a[key], b[key], t);
    if (hasA) return a[key];
    if (hasB) return b[key];
    return undefined;
  }

  // Linearly interpolate a node's placement at a given viewport width, clamping
  // to the nearest keyframe beyond the smallest/largest anchor width.
  function interpolatedPlacement(node, width) {
    var frames = nodeKeyframes(node);
    if (frames.length === 0) return null;
    if (frames.length === 1) return frames[0].p;
    if (width <= frames[0].w) return frames[0].p;
    if (width >= frames[frames.length - 1].w) return frames[frames.length - 1].p;
    for (var i = 0; i < frames.length - 1; i++) {
      var f0 = frames[i], f1 = frames[i + 1];
      if (width >= f0.w && width <= f1.w) {
        var t = (f1.w === f0.w) ? 0 : (width - f0.w) / (f1.w - f0.w);
        var a = f0.p, b = f1.p;
        var out = {
          x: lerpNum(typeof a.x === 'number' ? a.x : 0, typeof b.x === 'number' ? b.x : 0, t),
          y: lerpNum(typeof a.y === 'number' ? a.y : 0, typeof b.y === 'number' ? b.y : 0, t),
          rot: lerpNum(typeof a.rot === 'number' ? a.rot : 0, typeof b.rot === 'number' ? b.rot : 0, t),
          opacity: lerpNum(typeof a.opacity === 'number' ? a.opacity : 1, typeof b.opacity === 'number' ? b.opacity : 1, t),
          // booleans can't tween — snap to the nearer keyframe
          flipX: (t < 0.5 ? a.flipX : b.flipX),
          hidden: (t < 0.5 ? a.hidden : b.hidden)
        };
        var w = lerpOpt(a, b, t, 'w'); if (w !== undefined) out.w = w;
        var h = lerpOpt(a, b, t, 'h'); if (h !== undefined) out.h = h;
        var sc = lerpOpt(a, b, t, 'scale'); if (sc !== undefined) out.scale = sc;
        return out;
      }
    }
    return frames[frames.length - 1].p;
  }

  // The placement to render right now: interpolated when fluid, else the active
  // breakpoint's stepped snapshot.
  function effectivePlacement(node) {
    if (nodeIsFluid(node)) return interpolatedPlacement(node, window.innerWidth);
    return resolvePlacement(node, activeBreakpoint());
  }

  // ---- scene loading -----------------------------------------------------

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) return null;
      return res.json().catch(function () { return null; });
    }).catch(function () { return null; });
  }

  function emptyScene(key) {
    return {
      page: key,
      version: 1,
      breakpoints: Object.assign({}, DEFAULT_BREAKPOINTS),
      nodes: []
    };
  }

  function mergeScenes(globalScene, pageScene, key) {
    var base = pageScene || emptyScene(key);
    var merged = {
      page: base.page || key,
      version: base.version || 1,
      breakpoints: base.breakpoints || (globalScene && globalScene.breakpoints) || Object.assign({}, DEFAULT_BREAKPOINTS),
      nodes: []
    };
    // Carry through fluid + anchorWidths (page wins, else global) so they
    // survive a load/save round-trip instead of being dropped on merge.
    if (base.fluid != null) merged.fluid = base.fluid;
    else if (globalScene && globalScene.fluid != null) merged.fluid = globalScene.fluid;
    var aw = base.anchorWidths || (globalScene && globalScene.anchorWidths);
    if (aw) merged.anchorWidths = aw;
    // the journal site: which space nodes default to, and where the camera rests on this page (page wins, else global)
    var sp = base.space || (globalScene && globalScene.space); if (sp) merged.space = sp;
    var cam = base.camera || (globalScene && globalScene.camera); if (cam) merged.camera = cam;
    var byId = {};
    var order = [];
    function add(list, scope) {
      if (!list) return;
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (!n || !n.id) continue;
        if (!(n.id in byId)) order.push(n.id);
        n.scope = scope;
        byId[n.id] = n; // page wins on id collision (added after global)
      }
    }
    add(globalScene && globalScene.nodes, 'global');
    add(base.nodes, 'page');
    for (var j = 0; j < order.length; j++) merged.nodes.push(byId[order[j]]);
    return merged;
  }

  /** Fetch + merge a page's scene without applying it (the router prefetches). */
  function fetchPage(key) {
    return Promise.all([
      fetchJSON(SCENE_DIR + '_global.json'),
      fetchJSON(SCENE_DIR + key + '.json')
    ]).then(function (results) {
      return mergeScenes(results[0], results[1], key);
    });
  }
  function loadScene() { return fetchPage(pageKey()); }
  /** Switch to another page's scene in place (SPA): apply (a prefetched) scene, announce it. */
  function loadPage(key, prefetched) {
    currentKey = key;
    var p = prefetched ? Promise.resolve(prefetched) : fetchPage(key);
    return p.then(function (loaded) {
      setScene(loaded);
      try { window.dispatchEvent(new CustomEvent('scene:page', { detail: { key: key, scene: loaded } })); } catch (e) { /* old browsers */ }
      return loaded;
    });
  }

  // ---- DOM rendering -----------------------------------------------------

  function ensureSceneLayer() {
    if (sceneLayer && document.body.contains(sceneLayer)) return sceneLayer;
    sceneLayer = document.createElement('div');
    sceneLayer.className = 'scene-layer';
    sceneLayer.setAttribute('data-scene-layer', '');
    sceneLayer.setAttribute('aria-hidden', 'true');
    // Insert as the first child of body so it sits behind .container content.
    if (document.body.firstChild) {
      document.body.insertBefore(sceneLayer, document.body.firstChild);
    } else {
      document.body.appendChild(sceneLayer);
    }
    return sceneLayer;
  }

  function ensureBookLayer() {
    var host = spaceHost();
    if (!host) return null;
    if (bookLayer && host.contains(bookLayer)) return bookLayer;
    bookLayer = host.querySelector('.scene-layer--book');
    if (!bookLayer) {
      bookLayer = document.createElement('div');
      bookLayer.className = 'scene-layer scene-layer--book';
      bookLayer.setAttribute('data-scene-layer', 'book');
      bookLayer.setAttribute('aria-hidden', 'true');
      host.appendChild(bookLayer);
    }
    return bookLayer;
  }
  function layerFor(node) { return (spaceOf(node) === 'book' && ensureBookLayer()) || sceneLayer; }
  function nodeEl(id) {
    var q = '[data-node-id="' + cssEscape(id) + '"]';
    return (sceneLayer && sceneLayer.querySelector(q)) || (bookLayer && bookLayer.querySelector(q)) || null;
  }

  function ensureStyleEl() {
    styleEl = document.getElementById('scene-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'scene-style';
      document.head.appendChild(styleEl);
    }
    return styleEl;
  }

  function makeNodeElement(node) {
    var el;
    var kind = node.kind;

    if (kind === 'image') {
      el = document.createElement('img');
      el.src = node.src;
      if (node.srcset) el.srcset = node.srcset;
      if (node.a11y && node.a11y.decorative) {
        el.alt = '';
        el.setAttribute('role', 'presentation');
      } else {
        el.alt = (node.a11y && node.a11y.alt) || '';
      }
      el.decoding = 'async';
      el.loading = 'lazy';
      if (node.objectFit) el.style.objectFit = node.objectFit;
      el.draggable = false;
      if (node.action && (node.action.href || node.action.modal)) {   // a drawing you can click: a link, or a modal the site opens
        var wrap = document.createElement(node.action.href ? 'a' : 'button');
        if (node.action.href) { wrap.href = node.action.href; if (node.action.newTab) wrap.target = '_blank'; }
        else { wrap.type = 'button'; wrap.setAttribute('data-modal', node.action.modal); }
        wrap.className = 'scene-node__action';
        if (node.action.label) wrap.setAttribute('aria-label', node.action.label);
        wrap.appendChild(el); el = wrap;
      }
    } else if (kind === 'svg') {
      if (node.svg) {
        el = document.createElement('div');
        el.className = 'scene-node__svg';
        el.innerHTML = node.svg;
      } else {
        el = document.createElement('img');
        el.src = node.src;
        el.alt = (node.a11y && node.a11y.alt) || '';
        el.draggable = false;
      }
    } else if (kind === 'video') {
      el = document.createElement('video');
      el.src = node.src;
      el.loop = node.loop !== false;
      el.muted = node.muted !== false;
      el.playsInline = node.playsinline !== false;
      el.setAttribute('playsinline', '');
      el.autoplay = true;
      if (node.poster) el.poster = node.poster;
      // muted autoplay is generally allowed; guard the promise
      var play = el.play && el.play();
      if (play && typeof play.catch === 'function') play.catch(function () {});
    } else if (kind === 'gradient') {
      el = document.createElement('div');
      el.style.background = node.css || '';
    } else {
      // unknown kind — render an empty box so positioning still applies
      el = document.createElement('div');
    }

    el.classList.add('scene-node');
    el.classList.add('scene-node--' + (kind || 'unknown'));
    if (node.action && (node.action.href || node.action.modal)) el.classList.add('scene-node--interactive');
    if (node.reveal && node.reveal.type && node.reveal.type !== 'none') { el.classList.add('scene-node--reveal'); el.setAttribute('data-reveal', node.reveal.type); if (node.reveal.delay) el.style.setProperty('--reveal-delay', node.reveal.delay + 'ms'); if (node.reveal.duration) el.style.setProperty('--reveal-duration', node.reveal.duration + 'ms'); }
    el.setAttribute('data-node-id', node.id);
    if (typeof node.z === 'number') el.style.zIndex = String(node.z);
    return el;
  }

  // ---- ASCII creatures ---------------------------------------------------
  // kind:'ascii' nodes are looping <pre> creatures. They live in their own
  // .ascii-layer container (NOT wiped on every render()), so their frame timers
  // survive editor live-preview edits. Each is mode:'always' (persistent) or
  // mode:'cycle' (shown one-at-a-time on a shared sequential schedule). The editor
  // can pin one visible for editing.

  var ASCII_SOURCES = {
    jellyfish: 'assets/jellyfish-ascii-frames.json',
    butterfly: 'assets/ascii-frames-butterfly.json',
    deer: 'assets/ascii-frames-deer.json',
    moonwalk: 'assets/ascii-frames-moonwalk.json',
    horse: 'assets/ascii-frames-horse.json',
    whale: 'assets/ascii-frames-whale.json'
  };
  var asciiFrameCache = {};   // key -> [frameString,...]
  var asciiInstances = {};    // nodeId -> { el, node, timer, frame, dir, frames, visible }
  var asciiLayerEl = null;
  var asciiPinnedId = null;
  var asciiCycle = { timer: null, idx: 0, started: false };

  function loadAsciiFrames(key) {
    if (asciiFrameCache[key]) return Promise.resolve(asciiFrameCache[key]);
    var url = ASCII_SOURCES[key];
    if (!url) return Promise.resolve(null);
    return fetchJSON(url).then(function (frames) {
      if (!Array.isArray(frames)) return null;
      var sampled = [];
      for (var i = 0; i < frames.length; i += 3) {
        sampled.push(Array.isArray(frames[i]) ? frames[i].join('\n') : String(frames[i]));
      }
      asciiFrameCache[key] = sampled;
      return sampled;
    });
  }

  function ensureAsciiLayer() {
    if (asciiLayerEl && document.body.contains(asciiLayerEl)) return asciiLayerEl;
    asciiLayerEl = document.querySelector('.ascii-layer');
    if (!asciiLayerEl) {
      asciiLayerEl = document.createElement('div');
      asciiLayerEl.className = 'ascii-layer';
      document.body.appendChild(asciiLayerEl);
    }
    return asciiLayerEl;
  }

  function asciiNodes() {
    if (!scene || !scene.nodes) return [];
    return scene.nodes.filter(function (n) { return n && n.kind === 'ascii'; });
  }

  function positionAscii(inst) {
    var p = effectivePlacement(inst.node) || {};
    var scale = typeof p.scale === 'number' ? p.scale : 1;
    var rot = typeof p.rot === 'number' ? p.rot : 0;
    var el = inst.el;
    el.style.left = (typeof p.x === 'number' ? p.x : 0) + 'vw';
    el.style.top = (typeof p.y === 'number' ? p.y : 0) + 'vh';
    el.style.transform = 'rotate(' + rot + 'deg) scale(' + scale + ')';
    el.style.color = inst.node.color || '';
    if (typeof inst.node.z === 'number') el.style.zIndex = String(inst.node.z);
  }

  function startAsciiFrames(inst) {
    if (inst.timer || !inst.frames || !inst.frames.length) return;
    var speed = (inst.node && inst.node.frameSpeed) || 200;
    inst.el.textContent = inst.frames[inst.frame] || '';
    inst.timer = setInterval(function () {
      inst.el.textContent = inst.frames[inst.frame] || '';
      inst.frame += inst.dir;
      if (inst.frame >= inst.frames.length - 1) inst.dir = -1;
      else if (inst.frame <= 0) inst.dir = 1;
    }, speed);
  }
  function stopAsciiFrames(inst) {
    if (inst.timer) { clearInterval(inst.timer); inst.timer = null; }
  }
  function showAscii(inst) {
    inst.visible = true;
    inst.el.classList.add('active');
    inst.el.classList.remove('fading');
    startAsciiFrames(inst);
  }
  function hideAscii(inst) {
    inst.visible = false;
    inst.el.classList.remove('active');
    inst.el.classList.add('fading');
  }

  function reconcileAscii() {
    var nodes = asciiNodes();
    if (!nodes.length && !Object.keys(asciiInstances).length) return;
    ensureAsciiLayer();
    var seen = {};
    nodes.forEach(function (node) {
      seen[node.id] = true;
      var inst = asciiInstances[node.id];
      if (!inst) {
        var el = document.createElement('pre');
        el.className = 'scene-node scene-node--ascii ascii-art';
        el.setAttribute('data-node-id', node.id);
        asciiLayerEl.appendChild(el);
        inst = asciiInstances[node.id] = {
          el: el, node: node, timer: null, frame: 0, dir: 1, frames: null, visible: false
        };
        loadAsciiFrames(node.animation).then(function (frames) {
          inst.frames = frames;
          if (inst.visible) startAsciiFrames(inst);
        });
      } else {
        inst.node = node; // refresh config (color/mode/etc.)
      }
      positionAscii(inst);
    });
    Object.keys(asciiInstances).forEach(function (id) {
      if (!seen[id]) {
        var inst = asciiInstances[id];
        stopAsciiFrames(inst);
        if (inst.el && inst.el.parentNode) inst.el.parentNode.removeChild(inst.el);
        delete asciiInstances[id];
      }
    });
    applyAsciiVisibility();
  }

  function cycleNodeIds() {
    return asciiNodes()
      .filter(function (n) { return (n.mode || 'cycle') === 'cycle'; })
      .map(function (n) { return n.id; });
  }

  // 'always' creatures are always shown; 'cycle' creatures are hidden until the
  // scheduler reveals them; a pinned creature is forced visible for editing.
  function applyAsciiVisibility() {
    asciiNodes().forEach(function (node) {
      var inst = asciiInstances[node.id];
      if (!inst) return;
      if (asciiPinnedId === node.id) { showAscii(inst); return; }
      if ((node.mode || 'cycle') === 'always') showAscii(inst);
      else if (!asciiCycle.started) hideAscii(inst); // scheduler will reveal in turn
    });
    ensureAsciiScheduler();
  }

  function ensureAsciiScheduler() {
    if (!cycleNodeIds().length) { stopAsciiScheduler(); return; }
    if (asciiCycle.started) return;
    asciiCycle.started = true;
    asciiCycle.idx = 0;
    scheduleNextAscii();
  }
  function stopAsciiScheduler() {
    asciiCycle.started = false;
    if (asciiCycle.timer) { clearTimeout(asciiCycle.timer); asciiCycle.timer = null; }
  }
  function scheduleNextAscii() {
    if (asciiPinnedId) { asciiCycle.timer = setTimeout(scheduleNextAscii, 600); return; }
    var ids = cycleNodeIds();
    if (!ids.length) { stopAsciiScheduler(); return; }
    if (asciiCycle.idx >= ids.length) asciiCycle.idx = 0;
    var id = ids[asciiCycle.idx];
    var inst = asciiInstances[id];
    if (!inst) { asciiCycle.idx++; asciiCycle.timer = setTimeout(scheduleNextAscii, 50); return; }
    var node = inst.node;
    var duration = node.duration != null ? node.duration : 9000;
    var gap = node.gap != null ? node.gap : 2000;
    showAscii(inst);
    asciiCycle.timer = setTimeout(function () {
      if (asciiPinnedId === id) { scheduleNextAscii(); return; }
      hideAscii(inst);
      asciiCycle.timer = setTimeout(function () {
        stopAsciiFrames(inst);
        inst.frame = 0; inst.dir = 1;
        asciiCycle.idx++;
        asciiCycle.timer = setTimeout(scheduleNextAscii, gap);
      }, 1500); // match fade transition
    }, duration);
  }

  // Editor hooks: pin a creature visible while it's being edited.
  function pinNode(id) {
    var node = (scene && scene.nodes || []).filter(function (n) { return n.id === id; })[0];
    if (!node || node.kind !== 'ascii') { unpinNode(); return; }
    asciiPinnedId = id;
    var inst = asciiInstances[id];
    if (inst) showAscii(inst);
    Object.keys(asciiInstances).forEach(function (oid) {
      if (oid !== id && (asciiInstances[oid].node.mode || 'cycle') === 'cycle') {
        hideAscii(asciiInstances[oid]);
      }
    });
  }
  function unpinNode() {
    if (asciiPinnedId == null) return;
    asciiPinnedId = null;
    applyAsciiVisibility();
  }

  function repositionAscii() {
    Object.keys(asciiInstances).forEach(function (id) { positionAscii(asciiInstances[id]); });
  }

  // ---- element anchoring -------------------------------------------------

  function resolveAnchor(anchorSpec) {
    if (!anchorSpec || anchorSpec === 'viewport') return null;
    var sel = anchorSpec.element;
    if (!sel) return null;
    var target = document.querySelector(sel);
    if (!target) return null;
    var r = target.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // Re-resolve element-anchored nodes: position their .scene-node via inline
  // transform offsets layered on top of the generated base transform. We apply
  // these as CSS custom properties consumed by the generated style? Simpler:
  // directly set an inline transform that includes the anchor offset.
  function relayout() {
    if (!scene || !sceneLayer) return;
    var hasAnchored = false;
    for (var i = 0; i < scene.nodes.length; i++) {
      var node = scene.nodes[i];
      if (node.kind === 'content') continue;
      if (!node.anchor || node.anchor === 'viewport') continue;
      hasAnchored = true;
      var rect = resolveAnchor(node.anchor);
      var el = nodeEl(node.id);
      if (!el) continue;
      var p = effectivePlacement(node);
      if (!rect || !p) continue;
      var align = node.anchor.align || 'top-left';
      var off = node.anchor.offset || { x: 0, y: 0 };
      var anchorPt = anchorPoint(rect, align);
      var leftPx = anchorPt.x + (off.x || 0);
      var topPx = anchorPt.y + (off.y || 0);
      // base placement x/y are % of viewport, treated as an additional offset
      leftPx += pctToPx(p.x || 0, 'x');
      topPx += pctToPx(p.y || 0, 'y');
      var rot = p.rot || 0;
      var sx = p.flipX ? -1 : 1;
      el.style.transform = 'translate(' + leftPx + 'px,' + topPx + 'px) rotate(' + rot + 'deg) scaleX(' + sx + ')';
      el.style.width = (p.w || 0) + 'vw';
      el.style.opacity = (typeof p.opacity === 'number' ? p.opacity : 1);
      el.style.display = p.hidden ? 'none' : '';
    }
    // observe anchored targets so we relayout when they reflow
    if (hasAnchored) ensureResizeObserver();
  }

  function anchorPoint(rect, align) {
    var x = rect.left, y = rect.top;
    var parts = String(align).split('-');
    var v = parts[0], h = parts[1];
    if (align === 'center') { v = 'center'; h = 'center'; }
    if (v === 'center') y = rect.top + rect.height / 2;
    else if (v === 'bottom') y = rect.top + rect.height;
    if (h === 'center') x = rect.left + rect.width / 2;
    else if (h === 'right') x = rect.left + rect.width;
    return { x: x, y: y };
  }

  function ensureResizeObserver() {
    if (resizeObserver || typeof ResizeObserver === 'undefined') return;
    resizeObserver = new ResizeObserver(function () { relayout(); });
    // observe body as a coarse proxy for layout changes
    if (document.body) resizeObserver.observe(document.body);
  }

  // minimal CSS.escape fallback for attribute selectors
  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/["\\\]]/g, '\\$&');
  }

  // ---- generated <style> -------------------------------------------------

  function placementCss(p, kind, node) {
    if (!p) return '';
    var u = units(node);
    var lines = [];
    if (p.hidden) {
      lines.push('display:none;');
      return lines.join('');
    }
    if (kind === 'content') {
      // content nodes override an existing element's box, not draw art.
      // Emit position:absolute so left/top are unambiguously viewport-relative
      // (the target .container is position:relative by default, under which
      // left/top would only offset it from its flow position and leave a gap).
      lines.push('position:absolute;');
      // Honor the node's z so the JSON field isn't silently ignored (content
      // nodes are not rendered into .scene-layer, so they need the z-index here).
      if (node && typeof node.z === 'number') lines.push('z-index:' + node.z + ';');
      lines.push('left:' + (p.x || 0) + u.x + ';');
      lines.push('top:' + (p.y || 0) + u.y + ';');
      if (typeof p.w === 'number') {
        lines.push('width:' + p.w + u.x + ';');
        lines.push('max-width:' + p.w + u.x + ';');
        lines.push('min-width:0;');
      }
      lines.push('margin:0;');
      lines.push('right:auto;');
    } else {
      var x = (typeof p.x === 'number' ? p.x : 0);
      var y = (typeof p.y === 'number' ? p.y : 0);
      var rot = (typeof p.rot === 'number' ? p.rot : 0);
      var sx = p.flipX ? -1 : 1;
      // x,y are top-left position as % of the VIEWPORT — use left/top in
      // viewport units. CSS translate() percentages are element-relative, so
      // they would NOT mean "% of viewport"; keep only rotation/flip in transform.
      lines.push('left:' + x + u.x + ';');
      lines.push('top:' + y + u.y + ';');
      lines.push('transform:rotate(' + rot + 'deg) scaleX(' + sx + ');');
      if (typeof p.w === 'number') lines.push('width:' + p.w + u.x + ';');
      if (typeof p.h === 'number') lines.push('height:' + p.h + u.y + ';');
      lines.push('opacity:' + (typeof p.opacity === 'number' ? p.opacity : 1) + ';');
      lines.push('display:block;');
    }
    return lines.join('');
  }

  function selectorForNode(node) {
    if (node.kind === 'content') {
      return node.target || '.container';
    }
    return '.scene-layer [data-node-id="' + cssAttr(node.id) + '"]';   // matches the viewport layer and .scene-layer--book
  }

  function cssAttr(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function buildStyleBlock() {
    if (!scene) return '';
    var bp = getBreakpoints();
    var mobileMax = (bp.mobile != null ? bp.mobile : DEFAULT_BREAKPOINTS.mobile);
    var tabletMax = (bp.tablet != null ? bp.tablet : DEFAULT_BREAKPOINTS.tablet);

    var base = [];     // desktop rules (no media query) + all fluid rules
    var tablet = [];   // 577..768   (stepped nodes only)
    var mobile = [];   // <=576      (stepped nodes only)
    var width = window.innerWidth;

    for (var i = 0; i < scene.nodes.length; i++) {
      var node = scene.nodes[i];
      if (node.kind === 'ascii') continue; // positioned by the ASCII controller
      // Element-anchored, non-content nodes are positioned via JS (relayout),
      // so don't emit a transform that would fight it. We still emit width/z.
      var jsPositioned = node.kind !== 'content' && node.anchor && node.anchor !== 'viewport';
      var sel = selectorForNode(node);

      if (jsPositioned) {
        // only z-index belongs in the cascade; transforms are inline via relayout
        if (typeof node.z === 'number' && node.kind !== 'content') {
          base.push(sel + '{z-index:' + node.z + ';}');
        }
        continue;
      }

      if (nodeIsFluid(node)) {
        // One interpolated rule for the current width, refreshed on resize.
        // No media query — the value itself glides between breakpoints.
        var pf = interpolatedPlacement(node, width);
        if (pf) base.push(sel + '{' + placementCss(pf, node.kind, node) + '}');
      } else {
        var pDesktop = resolvePlacement(node, 'desktop');
        var pTablet = resolvePlacement(node, 'tablet');
        var pMobile = resolvePlacement(node, 'mobile');
        if (pDesktop) base.push(sel + '{' + placementCss(pDesktop, node.kind, node) + '}');
        if (pTablet) tablet.push(sel + '{' + placementCss(pTablet, node.kind, node) + '}');
        if (pMobile) mobile.push(sel + '{' + placementCss(pMobile, node.kind, node) + '}');
      }
    }

    var out = [];
    out.push('/* scene: ' + (scene.page || '') + ' — generated, do not edit by hand */');
    if (base.length) out.push(base.join('\n'));
    if (tablet.length) {
      out.push('@media (min-width:' + (mobileMax + 1) + 'px) and (max-width:' + tabletMax + 'px){');
      out.push(tablet.join('\n'));
      out.push('}');
    }
    if (mobile.length) {
      out.push('@media (max-width:' + mobileMax + 'px){');
      out.push(mobile.join('\n'));
      out.push('}');
    }
    return out.join('\n');
  }

  // ---- full render -------------------------------------------------------

  function render() {
    if (!scene) return;
    ensureSceneLayer();
    ensureStyleEl();

    sceneLayer.innerHTML = '';
    if (bookLayer) bookLayer.innerHTML = '';

    for (var i = 0; i < scene.nodes.length; i++) {
      var node = scene.nodes[i];
      if (!node || !node.id) continue;
      if (node.kind === 'content') continue; // handled purely via generated CSS
      if (node.kind === 'ascii') continue;   // handled by the ASCII controller

      var el = makeNodeElement(node);
      layerFor(node).appendChild(el);
    }

    styleEl.textContent = buildStyleBlock();

    // Position any element-anchored nodes now that DOM exists.
    relayout();

    // ASCII creatures live in their own persistent container (reconciled, not
    // rebuilt) so frame timers survive editor live-preview re-renders.
    reconcileAscii();

  }

  // ---- public API --------------------------------------------------------

  function getScene() { return scene; }

  // Signature of the scene's STRUCTURE (node identity/kind/source).
  // Unchanged signature => an edit is config/placement-only and can be applied
  // in place instead of a full destroy+remount render().
  function sceneSignature(s) {
    if (!s || !Array.isArray(s.nodes)) return '';
    return s.nodes.map(function (n) {
      if (!n) return '';
      // Include the content/source/z fields render() bakes into the DOM but
      // fastUpdate() does NOT re-derive — changing any of them must force a full
      // rebuild rather than silently no-op on the fast path.
      return [n.id, n.kind, n.z,
        n.src || '', n.srcset || '', n.objectFit || '', n.svg || '', n.css || '',
        n.poster || '', n.target || ''].join('|');
    }).join(';');
  }

  // Fast in-place update for non-structural scene changes (config / placement
  // edits from the editor): refresh the generated CSS without rebuilding the DOM.
  function fastUpdate(next) {
    scene = next;
    if (styleEl) styleEl.textContent = buildStyleBlock();
    reconcileAscii();
    relayout(); // re-resolves anchored nodes in place
  }

  function setScene(next) {
    next = next || emptyScene(pageKey());
    if (sceneLayer && scene && sceneSignature(next) === sceneSignature(scene)) {
      fastUpdate(next); // config/placement-only -> in-place, no remount
    } else {
      scene = next;
      render();         // structural change -> full rebuild
    }
  }

  // ---- wiring ------------------------------------------------------------

  var resizeRaf = null;
  function onResize() {
    // Stepped nodes reflow via CSS media queries on their own. Fluid nodes are
    // interpolated for the current width, so rebuild the style block each frame
    // the viewport changes. Element-anchored nodes are re-resolved via relayout.
    if (resizeRaf != null) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = null;
      if (styleEl && sceneHasFluid()) styleEl.textContent = buildStyleBlock();
      relayout();
      repositionAscii();
    });
  }

  function boot() {
    window.addEventListener('resize', onResize, { passive: true });

    loadScene().then(function (loaded) {
      scene = loaded;
      render();
      if (readyResolve) readyResolve(scene);

      // Local-only: load the editor. In prod this branch never runs, so the
      // editor file is never fetched.
      if (isEditEnvironment()) {
        import('./layout-editor.js').catch(function () { /* editor optional */ });
      }
    }).catch(function (err) {
      console.warn('[scene] failed to load scene', err);
      scene = emptyScene(pageKey());
      if (readyResolve) readyResolve(scene);
    });
  }

  // Expose the global API immediately (methods are stable even pre-render).
  window.sceneRenderer = {
    ready: readyPromise,
    getScene: getScene,
    setScene: setScene,
    render: render,
    relayout: relayout,
    activeBreakpoint: activeBreakpoint,
    pageKey: pageKey,
    fetchPage: fetchPage,
    loadPage: loadPage,
    spaceOf: spaceOf,
    spaceRect: spaceRect,
    pxToPct: pxToPct,
    pctToPx: pctToPx,
    isEditEnvironment: isEditEnvironment,
    // extras used by the editor (not part of the minimal contract):
    pinNode: pinNode,       // editor: force an ASCII creature visible while editing
    unpinNode: unpinNode
  };

  // Tell the legacy script.js ASCII cycle to stand down — the compositor owns
  // ASCII now. Set synchronously (before script.js runs its cycle) to avoid a race.
  window.__compositorAscii = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
