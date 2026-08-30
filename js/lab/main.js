// Painted Boids Lab — the design-mode entry: the pond plus the control panel, presets, JSON and arrange/mask tools.
import { clone, rand, wrapAngle, clamp, mulberry, quad, mixHex, cleanName, hslToHex } from '../pond/util.js';
import { PLAIN6, DEFAULTS, PATTERN_NAMES, PRESETS, BRUSHES, migrate, normalize, merge } from '../pond/presets.js';
import { SCHEMA, FLAGS } from '../pond/schema.js';
import { P, activePreset, replace as replaceConfig, patch as patchConfig, setActivePreset, on as onConfig } from '../pond/config.js';
import { Shapes } from '../pond/shapes.js';
import { STYLE_KEYS, styleFor, styleBase, variantParams, clearStyleCache } from '../pond/style.js';
import { DESIGN_STYLES, normalizeDesign, designHash, designParams } from '../pond/design.js';
import { bodySpace, PATTERNS } from '../pond/markings.js';
import { brush } from '../pond/brush.js';
import { Painter } from '../pond/painter.js';
import { PondFlow } from '../pond/pond-flow.js';
import { Water } from '../pond/water.js';
import { Book } from '../pond/book.js';
import { Journal } from '../pond/journal.js';
import { Drawings } from '../pond/drawings.js';
import { School } from '../pond/school.js';
import { createPond } from '../pond/pond.js';
import { loadJournal, loadBook } from '../pond/assets.js';
import { PondStore } from '../pond/store.js';
import { Residents } from '../pond/residents.js';
import { Designer } from '../pond/visitors/designer.js';
import { Visitors, DEMO_NAMES } from '../pond/visitors/visitors-ui.js';
import { mountPanel } from './panel.js';

function boot(ASSETS) {
  'use strict';
  document.body.classList.add('lab');
  var $ = function (sel) { return document.querySelector(sel); };
  // ---- parity hooks (lab only): ?det=N seeds Math.random, ?freeze=N steps the school N times once the atlas is up, then pauses
  var Q = new URLSearchParams(location.search), FREEZE = parseInt(Q.get('freeze') || '0', 10) || 0;
  if (Q.has('det')) { var detRng = mulberry(parseInt(Q.get('det'), 10) || 1); Math.random = function () { return detRng(); }; }
  // ---- the pond
  var tank = $('#tank');
  var panelInsets = { get right() { var panel = document.getElementById('panel'); return panel && !panel.classList.contains('hidden') && window.innerWidth > 900 ? panel.offsetWidth : 0; } };
  var pond = createPond({
    canvas: tank, journalRoot: $('#journal-root'), root: document.body,
    config: PRESETS[0].params, presetId: 'koi',
    assets: ASSETS,
    insets: panelInsets, remote: window.POND_REMOTE, visitors: true,
  });
  var school = pond.school;
  var panel = mountPanel(pond, { root: document.body, setInsets: false });
  pond.on('atlas', function () { if (FREEZE > 0) { pond.step(FREEZE, 1 / 60); FREEZE = 0; panel.setPaused(true); } });
  window.BoidsLab = { get P() { return P; }, pond: pond, school: school, Painter: Painter, Water: Water, PondFlow: PondFlow, Journal: Journal, Drawings: Drawings, repaint: pond.repaint, Shapes: Shapes, PATTERNS: PATTERNS,
    Residents: Residents, PondStore: PondStore, Designer: Designer, Visitors: Visitors, designParams: designParams, normalizeDesign: normalizeDesign, Book: Book };
}

Promise.all([loadJournal('../assets/pond/journal/journal.json'), loadBook('../assets/pond/book/book.json')]).then(function (r) {
  boot({ journal: r[0], book: r[1] });
}, function (e) {
  console.error(e);
  var st = document.querySelector('#status'); if (st) st.textContent = 'Assets failed to load: ' + e.message;
});
