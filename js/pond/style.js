// Which style paints which variant, per-variant proportions, and the style cache.
import { P, activePreset } from './config.js';
import { PRESETS, PRESETS_VERSION, normalize, merge } from './presets.js';
import { clone, clamp, mulberry } from './util.js';

/** Per-variant proportions: the same base shape, jittered by `variety` from the seed. */
// Keys that make up a *style* (silhouette + inking); everything else (school, motion, water, journal) stays the base config.
export var STYLE_KEYS = ['len', 'height', 'tailBend', 'tailLen', 'tailSpread', 'dorsal', 'curvature', 'variety', 'brushScale',
  'washOn', 'washOpacity', 'bleed', 'bleedDir', 'texture', 'border', 'scatter', 'glazeOn', 'glazeOpacity', 'glazeBleed',
  'markingsOn', 'markOpacity', 'markBleed', 'markScale', 'markDensity', 'outlineOn', 'outlineBrush', 'outlineWeight', 'wiggle',
  'hatchOn', 'hatchBrush', 'hatchWeight', 'hatchDist', 'hatchAngle', 'hatchRand', 'hatchRegion', 'finsOn', 'lineOn', 'eyeOn', 'eyeSize', 'palette', 'patterns'];
export var styleCache = {};
/** Which style paints variant v, and which palette row of that style. With a mix of n styles, variant v → style v % n, row floor(v / n). */
export function styleFor(P, v) {
  var mix = (P.styleMix || []).filter(Boolean);
  if (!mix.length) return { params: P, row: v % P.palette.length, id: 'base' };
  var id = mix[v % mix.length], idx = Math.floor(v / mix.length);
  var sp = styleBase(id, P); return { params: sp, row: idx % sp.palette.length, id: sp === P ? 'base' : id };
}
/** The params a named style paints with: the base config with that preset's STYLE_KEYS laid over it (cached per base seed). */
export function styleBase(id, base) {
  base = base || P;
  if (!id || id === 'koi' || id === activePreset || id === 'base') return base;
  var pr = PRESETS.filter(function (q) { return q.id === id; })[0]; if (!pr) return base;
  var key = id + '|' + JSON.stringify(base.seed);
  if (!styleCache[key]) { var over = {}; STYLE_KEYS.forEach(function (k) { if (pr.params[k] !== undefined) over[k] = clone(pr.params[k]); }); styleCache[key] = normalize(merge(base, over)); }
  return styleCache[key];
}
export function variantParams(P, v) {
  var st = styleFor(P, v); P = st.params;
  var Pv = clone(P);
  var r = mulberry(P.seed * 31 + v * 977 + 5), k = P.variety;
  var j = function (amt) { return 1 + k * (r() * 2 - 1) * amt; };
  Pv.len = P.len * j(0.16);
  Pv.height = P.height * j(0.24);
  Pv.dorsal = P.dorsal * j(0.45);
  Pv.tailSpread = P.tailSpread * j(0.3);
  Pv.tailLen = P.tailLen * j(0.3);
  Pv.belly = k * (r() * 2 - 1) * 0.35;
  Pv.curvature = clamp(P.curvature + k * (r() * 2 - 1) * 0.25, 0, 1);
  Pv.eyeSize = P.eyeSize * j(0.3);
  Pv.finLen = j(0.4);
  return Pv;
}


// =========================================================================

export function clearStyleCache() { styleCache = {}; }

/** Everything the painted atlas depends on, hashed: a pre-rendered atlas is used only when its key matches. */
export var ATLAS_KEYS = STYLE_KEYS.concat(['kind', 'seed', 'variants', 'animMode', 'styleMix']);
export function atlasKey(cfg, extra) {
  var pick = {}; ATLAS_KEYS.forEach(function (k) { pick[k] = cfg[k]; });
  var s = JSON.stringify(pick) + '|' + PRESETS_VERSION + '|' + (extra || ''), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
