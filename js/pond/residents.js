// Residents — the visitor fish in the pond: records from the store, sprites painted lazily between frames and cached
// by design hash (thrown away when the base painting changes).
import { P } from './config.js';
import { Painter } from './painter.js';
import { PondStore } from './store.js';
import { normalizeDesign, designHash, designParams } from './design.js';

var school = null;   // injected by init({ school })

export var Residents = {
  cache: {}, lastPaint: 0, loaded: false,
  count: function () { return school.residents.filter(function (f) { return !f.res.gone; }).length; },
  add: function (rec, opts) {
    if (school.findResident(rec.id)) return null;
    rec.hash = rec.hash || designHash(rec.design);
    var f = school.spawnResident(rec, opts); school.residents.push(f); return f;
  },
  remove: function (id) { school.residents.forEach(function (f) { if (f.res.id === id) f.res.gone = true; }); },
  clear: function () { school.residents.forEach(function (f) { f.res.gone = true; }); },
  invalidate: function () { this.cache = {}; school.residents.forEach(function (f) { f.stale = true; }); },
  /** Keep the newest `visitorCap`; the rest swim on. */
  trim: function () {
    var live = school.residents.filter(function (f) { return !f.res.gone; }).sort(function (a, b) { return a.res.createdAt < b.res.createdAt ? -1 : a.res.createdAt > b.res.createdAt ? 1 : 0; });
    while (live.length > P.visitorCap) live.shift().res.gone = true;
  },
  /** Replace the residents with the store's list, keeping the ones already swimming. */
  load: function (list) {
    var ids = {}; list.forEach(function (r) { ids[r.id] = true; });
    school.residents.forEach(function (f) { if (!ids[f.res.id]) f.res.gone = true; });
    var mine = PondStore.mine();
    list.forEach(function (r) { r.mine = !!(mine && mine.id === r.id); Residents.add(r); });
    this.loaded = true; this.trim();
  },
  /** At most one sprite per tick, never while the atlas job is painting. */
  tick: function (now) {
    if (!Painter.ok || !school.atlas || Painter.painting || now - this.lastPaint < 120) return;
    var f = null;
    for (var i = 0; i < school.residents.length; i++) { var g = school.residents[i]; if (!g.res.gone && (!g.sprite || g.stale)) { f = g; break; } }
    if (!f) return;
    var key = f.res.hash;
    if (!this.cache[key]) this.cache[key] = this.paint(f.res.design);
    f.sprite = this.cache[key]; f.stale = false;
    this.lastPaint = performance.now();
  },
  paint: function (design) {
    var d = normalizeDesign(design);
    var sp = Painter.paintSprite(designParams(d), d.colors, d.pattern, 100000 + d.seed * 13);
    Painter.setScale(P.brushScale);
    return sp;
  },
};

Residents.init = function (opts) { school = opts.school; return Residents; };
