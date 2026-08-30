// The lab's control panel over a pond: sliders from SCHEMA, presets, palette, style mix, JSON, arrange, mask brush,
// visitors group, status line, keys. mountPanel(pond, { root, setInsets }) works on the lab page and in the site's design mode.
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
import { PondStore } from '../pond/store.js';
import { Residents } from '../pond/residents.js';
import { Designer } from '../pond/visitors/designer.js';
import { Visitors, DEMO_NAMES } from '../pond/visitors/visitors-ui.js';
import { mountPanelDom } from './panel-dom.js';

export function mountPanel(pond, opts) {
  'use strict';
  opts = opts || {};
  var root = opts.root || document.body;
  // the panel's stylesheet, when the page does not carry it (the site in design mode)
  if (!document.querySelector('link[href*="lab.css"]')) { var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = opts.cssHref || '/css/lab.css'; link.addEventListener('load', function () { pond.resize(); }); document.head.appendChild(link); }
  mountPanelDom(root);
  var school = pond.school;
  var panelInsets = { get right() { var panel = root.querySelector('#panel'); return panel && !panel.classList.contains('hidden') && window.innerWidth > 900 ? panel.offsetWidth : 0; } };

  // =========================================================================
  // Parameters, presets, schema
  // =========================================================================

  // =========================================================================
  // Visitor fish — a small design (~200 bytes) a visitor makes in the "Leave a fish" card:
  // one of the three inking styles, four shape sliders, a size, colours, a koi pattern, a seed.
  // Painted here with the same brushes as the school, so it belongs to the same drawing.
  // =========================================================================

  // Painter — p5.brush standalone, one WebGL2 canvas reused for every sprite.
  // =========================================================================

  // =========================================================================
  // Book — the pond drawn on the pages of a journal. The photo sits under everything; the pond is drawn into a
  // "world" canvas the size of the page spread and multiplied onto the photo through the page mask, so the ink
  // takes the paper's shading and grain and stops at the page edges. Only the pages are pond: the mask leaves the
  // spine out, so fish pass under it. The mask = SAM pages → inset/feather via a distance field → spine band →
  // brush edits (a separate soft layer, so nothing is ever lost), all editable live.
  // =========================================================================

  // =========================================================================
  // School — boids over sprites
  // =========================================================================

  // =========================================================================
  // Water — a ripple simulation the fish drive, painted as brush strokes along
  // the ripple contours (the way water is drawn, not rendered). One layer of
  // strokes every P.waterPaintEvery ms, crossfaded over the previous one.
  // =========================================================================

  // =========================================================================
  // Journal — the compiled object (boulder, notebook layers, page-turn rocks, Turn sequences)
  // living on the pond as DOM above the canvas. The boulder is also an obstacle for the
  // simulation: fish steer around it and ripples reflect off it.
  // =========================================================================

  // =========================================================================
  // RockDrawing — the boulder as a crosshatch drawing painted once by p5.brush from its tonal
  // recipe; a spotlight under the pointer dissolves the drawing away to show the real rock.
  // =========================================================================

  // =========================================================================
  // Pond store — where visitor fish live between visits. "local" is this browser only (the lab, and the
  // fallback when nothing else answers); "remote" is a tiny HTTP API with the same three calls
  // (lab/pond/pond_fish.sql + README). Policy: the pond keeps the newest `visitorCap` fish — a new arrival
  // retires the oldest; the same design is never stored twice; one fish per visitor, leaving another replaces it.
  // =========================================================================

  // =========================================================================
  // Residents — the visitor fish in the pond. Records come from the store; sprites are painted lazily, one at a time
  // between frames, so thirty of them arrive over a few seconds instead of stalling the page. Painted sprites are
  // cached by design hash, and thrown away whenever the base painting changes (repaint).
  // =========================================================================

  // =========================================================================
  // Leave a fish — the visitor-facing card: a live painted preview, a few honest controls, a name, release.
  // =========================================================================

  /** The visitor UI outside the card: the button, the "your fish is here" note, and the lab's Visitors group. */
  // =========================================================================
  // UI
  // =========================================================================

  var $ = function (s) { return root.querySelector(s); };
  var statusEl = $('#status');
  var ui = {}; // key → { input, val }

  function fmt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 3 : 2).replace(/\.?0+$/, '');
    return String(v);
  }

  function buildGroup(container, list) {
    list.forEach(function (c) {
      if (c.sub) { var hh = document.createElement('div'); hh.className = 'sub'; hh.textContent = c.sub; container.appendChild(hh); return; }
      var row = document.createElement('div');
      row.className = 'ctl' + (c.t === 'range' ? '' : ' wide');
      if (c.tip) row.title = c.tip;
      var label = document.createElement('label');
      label.textContent = c.l; label.htmlFor = 'in-' + c.k;
      row.appendChild(label);
      var input, val;
      if (c.t === 'range') {
        input = document.createElement('input'); input.type = 'range';
        input.min = c.min; input.max = c.max; input.step = c.step;
        val = document.createElement('span'); val.className = 'val';
      } else if (c.t === 'select') {
        input = document.createElement('select');
        c.o.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; input.appendChild(op); });
      } else if (c.t === 'bool') {
        input = document.createElement('input'); input.type = 'checkbox';
      } else if (c.t === 'color') {
        input = document.createElement('input'); input.type = 'color';
      }
      input.id = 'in-' + c.k;
      row.appendChild(input);
      if (val) row.appendChild(val);
      container.appendChild(row);
      ui[c.k] = { input: input, val: val, c: c };

      var handler = function () {
        var v;
        if (c.t === 'range') v = parseFloat(input.value);
        else if (c.t === 'bool') v = input.checked;
        else v = input.value;
        setParam(c.k, v, c.paint);
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });
  }

  function refreshInputs() {
    if (Journal.ready) { Journal.applyProps(P.journalProps); Journal.refit(); }
    Book.syncFromP(); if (Book.ready) { school.resize(); Journal.layout(); }
    Object.keys(ui).forEach(function (kk) {
      var u = ui[kk], v = P[kk];
      if (u.c.t === 'bool') u.input.checked = !!v;
      else u.input.value = v;
      if (u.val) u.val.textContent = fmt(v);
    });
    buildPalette();
    refreshJSON();
    renderPresets();
  }

  var repaintTimer = 0;
  function setParam(kk, v) {
    var o = {}; o[kk] = v;
    patchConfig(o, { source: 'panel' });   // the pond applies the side effects, then syncs or repaints
    if (ui[kk] && ui[kk].val) ui[kk].val.textContent = fmt(v);
    renderPresets();
    refreshJSON();
  }
  function scheduleRepaint() { pond.scheduleRepaint(); }

  function buildPalette() {
    var box = $('#c-palette');
    box.innerHTML = '';
    var vrow = document.createElement('div'); vrow.className = 'ctl';
    vrow.innerHTML = '<label for="in-variants">Variants</label>';
    var vin = document.createElement('input'); vin.type = 'range'; vin.min = 1; vin.max = 9; vin.step = 1; vin.value = P.variants; vin.id = 'in-variants';
    var vval = document.createElement('span'); vval.className = 'val'; vval.textContent = P.variants;
    vin.addEventListener('input', function () { P.variants = parseInt(vin.value, 10); vval.textContent = P.variants; setActivePreset(null); renderPresets(); buildPalette(); school.sync(); scheduleRepaint(); refreshJSON(); });
    vrow.appendChild(vin); vrow.appendChild(vval); box.appendChild(vrow);

    var legend = document.createElement('div'); legend.className = 'plegend';
    legend.innerHTML = '<span></span><span>wash</span><span>glaze</span><span>line</span><span>mark</span><span>sumi</span><span>pattern</span>';
    box.appendChild(legend);
    var grid = document.createElement('div'); grid.className = 'palette';
    P.palette.forEach(function (row, i) {
      var r = document.createElement('div'); r.className = 'prow' + (i >= P.variants ? ' off' : '');
      var nn = document.createElement('span'); nn.className = 'n'; nn.textContent = i + 1; r.appendChild(nn);
      row.forEach(function (col, j) {
        var inp = document.createElement('input'); inp.type = 'color'; inp.value = col;
        inp.setAttribute('aria-label', 'variant ' + (i + 1) + ' colour ' + (j + 1));
        inp.addEventListener('input', function () { P.palette[i][j] = inp.value; setActivePreset(null); renderPresets(); scheduleRepaint(); refreshJSON(); });
        r.appendChild(inp);
      });
      var sel = document.createElement('select');
      sel.setAttribute('aria-label', 'variant ' + (i + 1) + ' pattern');
      PATTERN_NAMES.forEach(function (nm) { var op = document.createElement('option'); op.value = nm; op.textContent = nm; sel.appendChild(op); });
      sel.value = P.patterns[i];
      sel.addEventListener('change', function () { P.patterns[i] = sel.value; setActivePreset(null); renderPresets(); scheduleRepaint(); refreshJSON(); });
      r.appendChild(sel);
      grid.appendChild(r);
    });
    box.appendChild(grid);
    var row = document.createElement('div'); row.className = 'row';
    var b1 = document.createElement('button'); b1.className = 'btn small'; b1.textContent = 'Fill from variant 1';
    b1.addEventListener('click', function () { for (var i = 1; i < 6; i++) { P.palette[i] = clone(P.palette[0]); P.patterns[i] = P.patterns[0]; } buildPalette(); scheduleRepaint(); refreshJSON(); });
    row.appendChild(b1);
    box.appendChild(row);
  }

  // ---- presets
  var saved = [];
  try { saved = JSON.parse(localStorage.getItem('boids-lab-presets') || '[]'); } catch (e) { saved = []; }
  function persist() { try { localStorage.setItem('boids-lab-presets', JSON.stringify(saved)); } catch (e) { /* private mode etc. */ } }

  var STYLE_OPTIONS = [['', 'current'], ['koi', 'Watercolor Koi'], ['minnow', 'Ink Minnow'], ['charcoal', 'Charcoal Shoal'], ['tetra', 'Marker Tetra'], ['sardine', 'Spray Sardines'], ['pencil', 'Pencil Study']];
  function renderStyleMix() {
    var box = $('#stylemix'); box.innerHTML = '';
    var mix = P.styleMix || [];
    for (var i = 0; i < 3; i++) (function (i) {
      var sel = document.createElement('select'); sel.style.flex = '1'; sel.style.fontSize = '12px';
      STYLE_OPTIONS.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = (i + 1) + ' · ' + o[1]; sel.appendChild(op); });
      sel.value = mix[i] || '';
      sel.addEventListener('change', function () {
        var m = (P.styleMix || []).slice(); while (m.length < 3) m.push(''); m[i] = sel.value;
        P.styleMix = m.filter(Boolean).length ? m : []; if (P.styleMix.length && P.variants < 9) P.variants = 9;
        setActivePreset(null); refreshInputs(); school.sync(); repaint();
      });
      box.appendChild(sel);
    })(i);
  }
  function renderPresets() {
    renderStyleMix();
    var box = $('#presets');
    box.innerHTML = '';
    PRESETS.concat(saved).forEach(function (pr) {
      var b = document.createElement('button');
      b.className = 'chip' + (pr.id === activePreset ? ' active' : '');
      b.innerHTML = '<span class="swatch" style="background:' + pr.swatch + '"></span>' + pr.name + (pr.user ? '<span class="x" title="Remove">✕</span>' : '');
      b.addEventListener('click', function (e) {
        if (pr.user && e.target.classList.contains('x')) {
          saved = saved.filter(function (s) { return s.id !== pr.id; }); persist(); renderPresets(); return;
        }
        loadPreset(pr);
      });
      box.appendChild(b);
    });
    var note = $('#preset-note');
    var cur = PRESETS.concat(saved).filter(function (p) { return p.id === activePreset; })[0];
    note.textContent = cur ? cur.note : 'Edited — save it as a preset to keep it.';
  }

  function loadPreset(pr) {
    replaceConfig(pr.params, pr.id);
    refreshInputs();
    school.sync();
    repaint();
  }

  $('#btn-save').addEventListener('click', function () {
    $('#btn-save').hidden = true; $('#save-name').hidden = false; $('#btn-save-ok').hidden = false;
    $('#save-name').value = ''; $('#save-name').focus();
  });
  function commitSave() {
    var name = $('#save-name').value.trim();
    $('#btn-save').hidden = false; $('#save-name').hidden = true; $('#btn-save-ok').hidden = true;
    if (!name) return;
    var pr = { id: 'u' + Date.now(), name: name, swatch: P.palette[0][3], note: 'Saved in this browser.', user: true, params: clone(P) };
    saved.push(pr); persist(); setActivePreset(pr.id); renderPresets();
  }
  $('#btn-save-ok').addEventListener('click', commitSave);
  $('#save-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') commitSave(); if (e.key === 'Escape') { $('#save-name').value = ''; commitSave(); } });

  $('#btn-surprise').addEventListener('click', function () {
    var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
    var hue = Math.random() * 360, warm = Math.random() < 0.5;
    var hsl = function (h, sat, l) { return hslToHex(((h % 360) + 360) % 360, sat, l); };
    Object.assign(P, {
      washOn: Math.random() < 0.8, washOpacity: Math.round(rand(90, 220)), bleed: +rand(0.05, 0.5).toFixed(2),
      texture: +rand(0.1, 0.9).toFixed(2), border: +rand(0.1, 0.8).toFixed(2), scatter: Math.random() < 0.6,
      glazeOn: Math.random() < 0.7, glazeOpacity: Math.round(rand(30, 120)),
      markingsOn: P.kind === 'fish' && Math.random() < 0.7, markScale: +rand(0.7, 1.4).toFixed(2), markDensity: +rand(0.6, 1.6).toFixed(1),
      outlineBrush: pick(BRUSHES.filter(function (b) { return b !== 'hatch_brush'; })), outlineWeight: +rand(0.6, 1.8).toFixed(2), wiggle: Math.round(rand(0, 4)),
      hatchOn: Math.random() < 0.5, hatchRegion: pick(['tail', 'body', 'back']), hatchBrush: pick(['2H', 'HB', 'rotring', 'pen']),
      hatchDist: +rand(3, 12).toFixed(1), hatchAngle: Math.round(rand(-60, 60)), hatchRand: +rand(0, 0.5).toFixed(2),
      seed: Math.floor(Math.random() * 100),
    });
    for (var i = 0; i < 6; i++) {
      var h = hue + (warm ? rand(-25, 25) : rand(-90, 90)) + (i % 2 ? 180 * (Math.random() < 0.35 ? 1 : 0) : 0);
      P.palette[i] = [hsl(h, rand(0.45, 0.8), rand(0.6, 0.78)), hsl(h + rand(-10, 10), rand(0.5, 0.85), rand(0.38, 0.52)), hsl(h + rand(-15, 15), rand(0.4, 0.7), rand(0.16, 0.3)),
                      hsl(h + rand(-30, 30), rand(0.6, 0.9), rand(0.42, 0.58)), hsl(h + rand(-20, 20), rand(0.2, 0.5), rand(0.1, 0.22))];
      P.patterns[i] = P.markingsOn ? pick(PATTERN_NAMES) : 'plain';
    }
    setActivePreset(null); refreshInputs(); repaint();
  });
  // ---- JSON
  function refreshJSON() { $('#json').value = JSON.stringify(P, null, 1); }
  $('#btn-refresh-json').addEventListener('click', refreshJSON);
  $('#btn-copy').addEventListener('click', function () {
    var ta = $('#json'); refreshJSON(); ta.select();
    var done = function () { statusEl.textContent = 'Config copied.'; };
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done, function () { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
  });
  $('#btn-apply').addEventListener('click', function () {
    try {
      var obj = JSON.parse($('#json').value);
      replaceConfig(obj, null);
      refreshInputs(); school.sync(); repaint();
    } catch (e) { statusEl.textContent = 'That JSON did not parse: ' + e.message; }
  });

  // ---- save to site: only when the dev server answers (never in the artifact or on the live site)
  (function () {
    var btn = $('#btn-save-site'); if (!btn) return;
    fetch('/__editor/ping').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.ok) btn.hidden = false; }).catch(function () { /* no server */ });
    btn.addEventListener('click', function () {
      btn.disabled = true;
      fetch('/__editor/pond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(P, null, 2) })
        .then(function (r) { return r.json().then(function (j) { return r.ok && j.ok ? j : Promise.reject(new Error(j.error || ('HTTP ' + r.status))); }); })
        .then(function (j) { statusEl.textContent = 'Saved to assets/pond/pond.config.json (' + j.bytes + ' bytes).'; }, function (e) { statusEl.textContent = 'Save failed: ' + e.message; })
        .then(function () { btn.disabled = false; });
    });
  })();

  // ---- painting + status (rendered from the pond's events)
  function repaint() { pond.repaint(); }
  pond.on('status', function (e) { if (e.painting) statusEl.innerHTML = '<span class="painting">' + e.text + '</span>'; else statusEl.textContent = e.text; });
  pond.on('stats', function (st) { statusEl.textContent = st.count + ' boids' + (st.residents ? ' + ' + st.residents + ' visitor fish' : '') + ' · ' + st.fps + ' fps · atlas ' + st.atlasW + '×' + st.atlasH + ' painted in ' + st.paintMs + ' ms'; });
  pond.on('config', refreshJSON);

  function setPaused(v) { pond.setPaused(v); $('#btn-pause').textContent = pond.paused ? 'Play' : 'Pause'; }
  $('#btn-pause').addEventListener('click', function () { setPaused(!pond.paused); });
  $('#btn-repaint').addEventListener('click', function () { P.seed = (P.seed + 1) % 100; if (ui.seed) { ui.seed.input.value = P.seed; ui.seed.val.textContent = P.seed; } refreshJSON(); repaint(); });
  function hidePanel(v) { $('#panel').classList.toggle('hidden', v); pond.resize(); }
  $('#btn-hide').addEventListener('click', function () { hidePanel(true); });
  $('#toggle-panel').addEventListener('click', function () { hidePanel(false); });
  setPaused(pond.paused);

  document.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); setPaused(!pond.paused); }
    else if (e.key === 'r') $('#btn-repaint').click();
    else if (e.key === 'h') hidePanel(!$('#panel').classList.contains('hidden'));
    else if (e.key === 'a') { P.showAtlas = !P.showAtlas; if (ui.showAtlas) ui.showAtlas.input.checked = P.showAtlas; }
    else if (Book.editing && (e.key === '[' || e.key === ']')) { setParam('bookBrushSize', clamp(P.bookBrushSize + (e.key === ']' ? 6 : -6), 6, 400)); if (ui.bookBrushSize) ui.bookBrushSize.input.value = P.bookBrushSize; }
  });

  $('#bk-edit').addEventListener('click', function () { Book.setEditing(!Book.editing); });
  $('#bk-undo').addEventListener('click', function () { Book.undoStroke(); });
  $('#bk-reset').addEventListener('click', function () { Book.reset(); });
  $('#bk-copy').addEventListener('click', function () { if (!Book.dist) return; var url = Book.exportMask(); if (navigator.clipboard) navigator.clipboard.writeText(url); statusEl.textContent = 'Final mask PNG (' + Math.round(url.length * 0.75 / 1024) + ' KB) copied as a data URL.'; });
  $('#jr-arrange').addEventListener('click', function () { Journal.setArrange(!Journal.arranging); });
  $('#jr-pick').addEventListener('change', function () { var v = this.value; Journal.arrSel = v === 'journal' ? 'journal' : Journal.props.filter(function (p) { return p.name === v; })[0]; Journal.fillArr(); });
  [['jr-x', 'x'], ['jr-y', 'y'], ['jr-s', 's'], ['jr-r', 'r']].forEach(function (d) {
    $('#' + d[0]).addEventListener('input', function () {
      var v = parseFloat(this.value); if (isNaN(v) || !Journal.arrSel) return;
      if (Journal.arrSel === 'journal') { if (d[1] === 'x') P.journalX = v / school.fullW; else if (d[1] === 'y') P.journalY = v / school.H; else if (d[1] === 's') P.journalScale = v; Journal.layout(); refreshInputs(); }
      else { Journal.arrSel[d[1]] = v; Journal.propsChanged(); }
    });
  });
  $('#jr-copy').addEventListener('click', function () { var txt = JSON.stringify({ journalX: P.journalX, journalY: P.journalY, journalScale: P.journalScale, journalProps: Journal.exportProps() }, null, 1); if (navigator.clipboard) navigator.clipboard.writeText(txt); statusEl.textContent = 'Journal placement copied.'; });
  $('#jr-reset').addEventListener('click', function () { Journal.props = Journal.D.props.map(function (p) { return JSON.parse(JSON.stringify(p)); }); Journal.props.forEach(function (p) { var el = Journal.propEls[p.name]; if (el) el.dataset.name = p.name; }); Journal.propsChanged(); });
  document.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (!Journal.arranging || !Journal.arrSel || Journal.arrSel === 'journal') return;
    var big = e.shiftKey ? 10 : 1, k = e.key, p = Journal.arrSel;
    if (k === 'ArrowLeft') p.x -= big; else if (k === 'ArrowRight') p.x += big; else if (k === 'ArrowUp') p.y -= big; else if (k === 'ArrowDown') p.y += big;
    else if (k === '[') p.r -= big; else if (k === ']') p.r += big; else if (k === '-') p.s = Math.max(0.05, +(p.s - 0.01 * big).toFixed(3)); else if (k === '=' || k === '+') p.s = +(p.s + 0.01 * big).toFixed(3);
    else return;
    e.preventDefault(); Journal.propsChanged();
  });

  // ---- boot
  buildGroup($('#c-shape'), SCHEMA.shape);
  buildGroup($('#c-paint'), SCHEMA.paint);
  buildGroup($('#c-school'), SCHEMA.school);
  buildGroup($('#c-motion'), SCHEMA.motion);
  buildGroup($('#c-journal'), SCHEMA.journal);
  buildGroup($('#c-rock'), SCHEMA.rock);
  buildGroup($('#c-water'), SCHEMA.water);
  buildGroup($('#c-book'), SCHEMA.book);
  buildGroup($('#c-brush'), SCHEMA.brush);
  buildGroup($('#c-visitors'), SCHEMA.visitors);
  buildGroup($('#c-tank'), SCHEMA.tank);
  refreshInputs();

  (function () { var pick = $('#jr-pick'); pick.innerHTML = ''; ['journal'].concat(Journal.props.map(function (p) { return p.name; })).forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; pick.appendChild(o); }); })();
  Journal.on('arrange', function (on) { $('#jr-arrange').classList.toggle('on', on); $('#jr-kv').style.display = on ? '' : 'none'; });
  Journal.on('select', function (sel) {
    $('#jr-pick').value = sel === 'journal' ? 'journal' : sel.name;
    if (sel === 'journal') { $('#jr-x').value = Math.round(P.journalX * school.fullW); $('#jr-y').value = Math.round(P.journalY * school.H); $('#jr-s').value = P.journalScale; $('#jr-r').value = 0; $('#jr-r').disabled = true; }
    else { $('#jr-x').value = sel.x; $('#jr-y').value = sel.y; $('#jr-s').value = sel.s; $('#jr-r').value = sel.r; $('#jr-r').disabled = false; }
  });
  Book.on('editing', function (on) { $('#bk-edit').classList.toggle('on', on); });
  Book.setTool($('#bk-tool').value); $('#bk-tool').addEventListener('change', function () { Book.setTool(this.value); });
  $('#vs-demo').addEventListener('click', function () { Visitors.demo(); });
  $('#vs-clear').addEventListener('click', function () { if (PondStore.mode === 'local') PondStore.clearLocal(); Residents.clear(); Visitors.refresh(); });
  $('#vs-find').addEventListener('click', function () { var m = PondStore.mine(); if (!m || !school.spotlight(m.id)) statusEl.textContent = 'No fish of yours in the pond.'; });
  if (!pond.ok) {
    $('#unsupported').style.display = 'block';
    statusEl.textContent = typeof window.brush === 'undefined' ? 'p5.brush failed to load.' : 'WebGL2 unavailable.';
  }

  if (opts.setInsets !== false) pond.setInsets(panelInsets);
  return { refreshInputs: refreshInputs, refreshJSON: refreshJSON, setPaused: setPaused, hidePanel: hidePanel, statusEl: statusEl, panelInsets: panelInsets };
}
