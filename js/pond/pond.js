// createPond — the composition root: wires the modules together, runs the frame loop, dispatches config changes to
// the side effects they need, and exposes one object the site and the lab panel both talk to.
//
//   const pond = createPond({ canvas, journalRoot, root, config, presetId, assets: { journal, book }, insets, remote, visitors });
//   pond.on('status', text => …); pond.setConfig({ count: 40 }); pond.book.fit; pond.journal.turn(1); pond.destroy();
//
import { P, activePreset, replace as replaceConfig, patch as patchConfig, set as setConfigKey, snapshot, on as onConfig, off as offConfig } from './config.js';
import { FLAGS } from './schema.js';
import { clearStyleCache } from './style.js';
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
      if (f.book === 'layout') { school.resize(); Journal.layout(); Book.maskDirty = true; }
      if (f.book === 'mask') Book.maskDirty = true;
    });
    if (opts2 && opts2.silent) return;
    if (paint) scheduleRepaint(); else school.sync();
    emit('config', { keys: keys });
  }
  function applyReplace() {
    if (Journal.ready) { Journal.applyProps(P.journalProps); Journal.refit(); }
    Book.syncFromP(); if (Book.ready) { school.resize(); Journal.layout(); }
    school.sync();
    emit('config', { keys: null });
  }
  unsubs.push(onConfig('change', function (e) { if (e.source === 'pond') return; applyChange(e.keys, e); }));
  unsubs.push(onConfig('replace', function () { applyReplace(); }));

  // ---- the journal, the drawings, the book
  var assets = opts.assets || {};
  Journal.init(assets.journal || null, { root: journalRoot, school: school });
  unsubs.push(Journal.on('props', function () { emit('config', { keys: ['journalProps'] }); }));
  Drawings.init(); Journal.setDrawings(Drawings);
  Book.init(assets.book || null, { canvas: canvas });
  unsubs.push(Book.on('ready', function () { school.resize(); Journal.layout(); emit('resize'); }));
  unsubs.push(Book.on('edits', function () { emit('config', { keys: ['bookMask'] }); }));
  listen(document, 'pointermove', function (e) { Drawings.setPointer(e.clientX, e.clientY); });

  // ---- visitors
  PondStore.init({ remote: opts.remote });
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
  listen(window, 'resize', function () { school.resize(); Journal.layout(); emit('resize'); });
  listen(document, 'visibilitychange', function () {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf && !destroyed) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });

  // ---- go
  raf = requestAnimationFrame(frame);
  var ok = Painter.init();
  if (!ok) emit('error', { code: brush ? 'webgl2' : 'brush', text: brush ? 'WebGL2 unavailable.' : 'p5.brush failed to load.' });
  else setTimeout(repaint, 0);   // deferred so the caller can subscribe to 'status' / 'atlas' first

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
    pause: function () { paused = true; emit('paused', true); },
    resume: function () { paused = false; emit('paused', false); },
    setPaused: function (v) { paused = !!v; emit('paused', paused); },
    resize: function () { school.resize(); Journal.layout(); emit('resize'); },
    setInsets: function (ins) { school.insets = ins || { right: 0 }; school.resize(); Journal.layout(); emit('resize'); },
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
