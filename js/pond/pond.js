// createPond — the composition root: wires the modules together, runs the frame loop, dispatches config changes to
// the side effects they need, and exposes one object the site and the lab panel both talk to.
//
//   const pond = createPond({ canvas, journalRoot, root, config, presetId, assets: { journal, book }, insets, visitors });
//   pond.on('status', text => …); pond.setConfig({ count: 40 }); pond.book.fit; pond.journal.turn(1); pond.destroy();
//
import { P, activePreset, replace as replaceConfig, patch as patchConfig, set as setConfigKey, snapshot, on as onConfig, off as offConfig } from './config.js';
import { FLAGS } from './schema.js';
import { clearStyleCache, atlasKey } from './style.js';
import { brush, setBrush } from './brush.js';
import { Painter } from './painter.js';
import { Water } from './water.js';
import { PondFlow } from './pond-flow.js';
import { Book } from './book.js';
import { Journal } from './journal.js';
import { Drawings } from './drawings.js';
import { School } from './school.js';
import { PondStore } from './store.js';
import { Residents } from './residents.js';
import { Designer } from './visitors/designer.js';
import { Visitors } from './visitors/visitors-ui.js';
import { createEmitter } from './emitter.js';
import { clamp } from './util.js';

export function createPond(opts) {
  opts = opts || {};
  var canvas = opts.canvas, journalRoot = opts.journalRoot || null, root = opts.root || document.body;
  var bus = createEmitter(), emit = bus.emit;
  var listeners = [];   // [target, type, fn] for destroy()
  var listen = function (t, type, fn, o) { t.addEventListener(type, fn, o); listeners.push([t, type, fn, o]); };
  var unsubs = [];

  if (opts.brush) setBrush(opts.brush);
  replaceConfig(opts.config || {}, opts.presetId === undefined ? null : opts.presetId);

  // ---- the school and the loop
  var school = new School(canvas, { insets: opts.insets || { right: 0 }, root: root });
  var paused = false, raf = 0, last = 0, lastPaintMs = 0, fps = 0, fpsN = 0, fpsT = 0, frames = 0, destroyed = false;
  var reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced && opts.respectReducedMotion !== false) paused = true;

  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    emit('frame', { now: now, dt: dt });
    if (!paused) school.step(dt);
    if (Journal.ready) { if (Journal.obstacleDirty) Journal.rebuildObstacle(); Journal.tick(now); }
    if (Drawings.items.length) { if (school.atlas && !Painter.painting) Drawings.paintDirty(); Drawings.tick(now, dt); }
    if (school.residents.length) Residents.tick(now);
    if (P.waterOn && !paused && school.atlas && !Painter.painting && now - Water.lastPaint > P.inkEvery) { Water.lastPaint = now; Water.paint(now); }
    school.draw();
    frames++;
    tickStats(now);
  }
  function tickStats(now) {
    if (!school.atlas) return;
    if (!fpsT) fpsT = now;
    if (now - fpsT > 800) {
      fps = Math.round(fpsN / ((now - fpsT) / 1000)); fpsN = 0; fpsT = now;
      emit('stats', { fps: fps, count: P.count, residents: school.residents.length, atlasW: school.atlas.canvas.width, atlasH: school.atlas.canvas.height, paintMs: lastPaintMs });
    }
    fpsN++;
  }

  // ---- painting
  function repaint() {
    if (!Painter.ok) return;
    clearStyleCache();
    Residents.invalidate();
    emit('status', { text: 'painting 0/' + clamp(P.variants, 1, 9) + '…', painting: true });
    Painter.paintAtlas(P, function (v, n) {
      emit('status', { text: 'painting ' + v + '/' + n + '…', painting: true });
    }, function (atlas) {
      school.atlas = atlas;
      lastPaintMs = atlas.ms;
      emit('atlas', atlas);
    });
  }
  var repaintTimer = 0;
  function scheduleRepaint() { clearStyleCache(); clearTimeout(repaintTimer); repaintTimer = setTimeout(repaint, 220); }

  // ---- config changes → side effects (what the panel's setParam used to do)
  function applyChange(keys, opts2) {
    var paint = false, sync = false;
    keys.forEach(function (k) {
      var f = FLAGS[k] || {};
      if (f.paint) paint = true; else sync = true;
      if (f.water) { Water.resize(school.fullW, school.H); Journal.obstacleDirty = true; }
      if (f.pond || k === 'seed') Water.pondDirty = true;
      if (f.damp) Water.rebuildDamping();
      if (f.journal) { Journal.layout(); if (k === 'journalScale') Drawings.markDirty(); }
      if (f.rock) Drawings.markDirty();
      if (f.visitors) { Residents.trim(); Visitors.refresh(); }
      if (f.book === 'layout') { school.resize(); Journal.layout(); Book.maskDirty = true; syncJournalView(); scheduleJournalMask(); emit('resize'); }
      if (f.book === 'mask') { Book.maskDirty = true; scheduleJournalMask(); }
      if (f.bookmark) applyBookmarkVars();
    });
    if (opts2 && opts2.silent) return;
    if (paint) scheduleRepaint(); else school.sync();
    emit('config', { keys: keys });
  }
  /** The bookmark button (site DOM) is placed by config so the panel's sliders drive it. */
  function applyBookmarkVars() {
    var el = document.getElementById('bookmark-leave'); if (!el) return;
    el.style.setProperty('--bm-x', P.bookmarkX + 'px');
    el.style.setProperty('--bm-y', P.bookmarkY + 'px');
    el.style.width = P.bookmarkW + 'px';
  }
  function applyReplace() {
    if (Journal.ready) { Journal.applyProps(P.journalProps); Journal.refit(); }
    Book.syncFromP(); if (Book.ready) { school.resize(); Journal.layout(); syncJournalView(); scheduleJournalMask(); }
    applyBookmarkVars();
    school.sync();
    emit('config', { keys: null });
  }
  unsubs.push(onConfig('change', function (e) { if (e.source === 'pond') return; applyChange(e.keys, e); }));
  unsubs.push(onConfig('replace', function () { applyReplace(); }));

  // ---- the journal DOM rides the same transform as the photo (fit × camera), so it scales with the book,
  // and wears the page mask as a CSS mask so drawings on the pages are cut off like the fish.
  var lastFitS = 0, maskCssTimer = 0;
  function placeJournalRoot() {
    if (!journalRoot) return;
    var sf = Book.screenFit();
    // Box = the photo, so the border box coincides with the mask image (mask-clip clips painting to the
    // border box — a viewport-sized box would guillotine the journal at window edges in local px).
    if (Book.active()) { journalRoot.style.width = Book.D.W + 'px'; journalRoot.style.height = Book.D.H + 'px'; }
    else { journalRoot.style.width = journalRoot.style.height = ''; }
    journalRoot.style.transformOrigin = '0 0';
    journalRoot.style.transform = 'translate(' + sf.x + 'px,' + sf.y + 'px) scale(' + sf.s + ')';
  }
  function applyJournalMask() {
    if (!journalRoot) return;
    var bmTab = document.querySelector('#bookmark-leave .bm-tab');   // the bookmark's tab: page mask swallows it at the page edge
    if (!Book.active()) {
      journalRoot.style.webkitMaskImage = journalRoot.style.maskImage = 'none';
      if (bmTab) bmTab.style.webkitMaskImage = bmTab.style.maskImage = 'none';
      return;
    }
    var url = 'url(' + Book.maskUrl() + ')', size = Book.D.W + 'px ' + Book.D.H + 'px';
    journalRoot.style.webkitMaskImage = url; journalRoot.style.maskImage = url;
    journalRoot.style.webkitMaskSize = size; journalRoot.style.maskSize = size;
    journalRoot.style.webkitMaskRepeat = 'no-repeat'; journalRoot.style.maskRepeat = 'no-repeat';
    if (bmTab) { bmTab.style.webkitMaskImage = url; bmTab.style.maskImage = url; }   // size/position live in css/site.css
  }
  function scheduleJournalMask() { clearTimeout(maskCssTimer); maskCssTimer = setTimeout(applyJournalMask, 250); }
  function syncJournalView() {
    placeJournalRoot();
    if (Book.ready && Math.abs(Book.fit.s - lastFitS) > 0.02) { lastFitS = Book.fit.s; Drawings.markDirty(); }
  }

  // ---- the journal, the drawings, the book
  var assets = opts.assets || {};
  Journal.init(assets.journal || null, { root: journalRoot, school: school });
  unsubs.push(Journal.on('props', function () { emit('config', { keys: ['journalProps'] }); }));
  Drawings.init(); Journal.setDrawings(Drawings);
  Book.init(assets.book || null, { canvas: canvas });
  unsubs.push(Book.on('ready', function () { school.resize(); Journal.layout(); syncJournalView(); applyJournalMask(); applyBookmarkVars(); emit('resize'); }));
  unsubs.push(Book.on('edits', function () { scheduleJournalMask(); emit('config', { keys: ['bookMask'] }); }));
  unsubs.push(Book.on('mask', function () { scheduleJournalMask(); }));   // live: the compose rebuilds the mask per stroke
  listen(document, 'pointermove', function (e) { Drawings.setPointer(e.clientX, e.clientY); });

  // ---- visitors
  Residents.init({ school: school });
  var visitorsOn = opts.visitors !== false;
  if (visitorsOn) {
    Visitors.init({ root: opts.visitorRoot || document, school: school });
    Designer.init({ root: opts.visitorRoot || document, school: school });
    unsubs.push(Designer.on('status', function (t) { emit('status', { text: t }); }));
    Visitors.refresh();
  }
  PondStore.list().then(function (list) { Residents.load(list); if (visitorsOn) Visitors.refresh(); emit('residents'); });

  // ---- pointer, resize, visibility
  listen(canvas, 'pointermove', function (e) {
    if (Book.editing) { Book.pointer(e, 'move'); school.pointer.on = false; return; }
    var w = school.toWorld(e.clientX, e.clientY);
    school.pointer.x = w[0]; school.pointer.y = w[1]; school.pointer.on = true;
    if (e.buttons && P.waterOn && P.rippleTouch > 0) Water.disturb(w[0], w[1], P.rippleTouch * 0.25, 1);
  });
  listen(canvas, 'pointerdown', function (e) {
    if (Book.editing) { Book.pointer(e, 'down'); return; }
    var w = school.toWorld(e.clientX, e.clientY);
    if (P.waterOn && P.rippleTouch > 0) Water.disturb(w[0], w[1], P.rippleTouch * 1.2, 2);
  });
  listen(canvas, 'pointerup', function (e) { if (Book.editing) Book.pointer(e, 'up'); });
  listen(canvas, 'pointercancel', function (e) { if (Book.editing) Book.pointer(e, 'up'); });
  listen(canvas, 'pointerleave', function () { school.pointer.on = false; if (!Book.stroke) Book.brushPos = null; });
  listen(window, 'resize', function () { school.resize(); Journal.layout(); syncJournalView(); emit('resize'); });
  listen(document, 'visibilitychange', function () {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf && !destroyed) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });

  // ---- go
  raf = requestAnimationFrame(frame);
  var ok = Painter.init();
  function usePrerendered(meta) {   // { key, cellW, cellH, poses, variants, ox, oy, margin, bodyW, src } → school.atlas
    var img = new Image();
    img.onload = function () {
      if (destroyed) return;
      var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
      school.atlas = { canvas: c, cellW: meta.cellW, cellH: meta.cellH, poses: meta.poses, variants: meta.variants, ox: meta.ox, oy: meta.oy, margin: meta.margin, bodyW: meta.bodyW, ms: 0, prerendered: true };
      lastPaintMs = 0; emit('status', { text: 'atlas loaded' }); emit('atlas', school.atlas);
    };
    img.onerror = function () { if (!destroyed && Painter.ok) repaint(); };
    img.src = meta.src;
  }
  var pre = assets.atlas, mode = opts.paintOnClient || 'auto';
  if (!ok) emit('error', { code: brush ? 'webgl2' : 'brush', text: brush ? 'WebGL2 unavailable.' : 'p5.brush failed to load.' });
  if (pre && mode !== 'always' && pre.key === atlasKey(P, Painter.MAXW + 'x' + Painter.MAXH)) usePrerendered(pre);
  else if (ok && mode !== 'never') setTimeout(repaint, 0);   // deferred so the caller can subscribe to 'status' / 'atlas' first

  var pond = {
    school: school, painter: Painter, water: Water, pondFlow: PondFlow, journal: Journal, drawings: Drawings, book: Book,
    store: PondStore, residents: Residents, designer: Designer, visitors: Visitors,
    get config() { return P; },
    get activePreset() { return activePreset; },
    get paused() { return paused; },
    get ok() { return ok; },
    get frameCount() { return frames; },
    get ready() { return !!school.atlas; },
    on: bus.on, off: bus.off, emit: emit,
    getConfig: snapshot,
    setConfig: function (partial, o) { patchConfig(partial, { source: (o && o.source) || 'site', keepPreset: !!(o && o.keepPreset) }); },
    set: function (k, v, o) { setConfigKey(k, v, o); },
    replaceConfig: function (obj, presetId) { replaceConfig(obj, presetId); },
    repaint: repaint,
    scheduleRepaint: scheduleRepaint,
    atlasKey: function () { return atlasKey(P, Painter.MAXW + 'x' + Painter.MAXH); },
    /** The painted atlas as a WebP data URL plus the metadata the school needs to draw from it. */
    exportAtlas: function (quality) {
      var A = school.atlas; if (!A) return null;
      return { key: atlasKey(P, Painter.MAXW + 'x' + Painter.MAXH), cellW: A.cellW, cellH: A.cellH, poses: A.poses, variants: A.variants, ox: A.ox, oy: A.oy, margin: A.margin, bodyW: A.bodyW,
               w: A.canvas.width, h: A.canvas.height, dataUrl: A.canvas.toDataURL('image/webp', quality || 0.92) };
    },
    pause: function () { paused = true; emit('paused', true); },
    resume: function () { paused = false; emit('paused', false); },
    setPaused: function (v) { paused = !!v; emit('paused', paused); },
    resize: function () { school.resize(); Journal.layout(); syncJournalView(); emit('resize'); },
    setInsets: function (ins) { school.insets = ins || { right: 0 }; school.resize(); Journal.layout(); syncJournalView(); emit('resize'); },
    /** The runtime camera (navigation): a screen-space translate+scale over photo, pond and journal object. */
    get camera() { return Book.camera; },
    setCamera: function (c) {
      var cam = Book.camera; if (c) { if (c.zoom != null) cam.zoom = Math.max(0.05, c.zoom); if (c.x != null) cam.x = c.x; if (c.y != null) cam.y = c.y; }
      placeJournalRoot();
      emit('camera', cam);
      return cam;
    },
    /** #book-space transform = the photo's on-screen fit with the camera applied */
    get screenFit() { return Book.screenFit(); },
    step: function (n, dt) { for (var i = 0; i < (n || 1); i++) school.step(dt || 1 / 60); },
    destroy: function () {
      destroyed = true; cancelAnimationFrame(raf); raf = 0; clearTimeout(repaintTimer);
      listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); }); listeners = [];
      unsubs.forEach(function (u) { if (typeof u === 'function') u(); }); unsubs = [];
      if (journalRoot) journalRoot.innerHTML = '';
      if (typeof Painter.dispose === 'function') Painter.dispose();
    },
  };
  return pond;
}
