// A visitor's fish design: normalisation, hashing, and the paint params it maps to.
import { PATTERN_NAMES } from './presets.js';
import { styleBase } from './style.js';
import { clone, clamp } from './util.js';

export var DESIGN_STYLES = ['koi', 'minnow', 'pencil'];
export var HEX = /^#[0-9a-f]{6}$/i;
export function normalizeDesign(d) {
  d = d || {};
  var o = { v: 1 };
  o.style = DESIGN_STYLES.indexOf(d.style) >= 0 ? d.style : 'koi';
  ['len', 'belly', 'tail', 'fin', 'size'].forEach(function (k) { var v = parseFloat(d[k]); o[k] = isNaN(v) ? 0.5 : +clamp(v, 0, 1).toFixed(3); });
  var cols = Array.isArray(d.colors) ? d.colors : [];
  var fallback = ['#fff1e8', '#ffdaca', '#9f3c1a', '#ff5722', '#2b2b2b'];
  o.colors = fallback.map(function (c, i) { return HEX.test(String(cols[i] || '')) ? cols[i].toLowerCase() : c; });
  o.pattern = PATTERN_NAMES.indexOf(d.pattern) >= 0 ? d.pattern : 'plain';
  var ms = parseFloat(d.markScale), md = parseFloat(d.markDensity);
  o.markScale = isNaN(ms) ? 1 : +clamp(ms, 0.5, 2).toFixed(2); o.markDensity = isNaN(md) ? 1 : +clamp(md, 0.3, 2).toFixed(2);
  o.seed = clamp(Math.round(parseFloat(d.seed) || 0), 0, 9999);
  return o;
}
/** What "unique" means for the pond: the same design gives the same hash. Names do not count. */
export function designHash(d) {
  var s = JSON.stringify(normalizeDesign(d)), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
/** The style's base params (the same ones the school's thirds paint with), bent by the design's shape sliders. */
export function designParams(d) {
  d = normalizeDesign(d);
  var B = styleBase(d.style), Pv = clone(B);
  Pv.kind = 'fish'; Pv.variety = 0;
  Pv.len = B.len * (0.78 + 0.44 * d.len);
  Pv.height = B.height * (0.7 + 0.6 * d.belly);
  Pv.belly = (d.belly - 0.5) * 0.5;
  Pv.tailLen = B.tailLen * (0.7 + 0.6 * d.tail);
  Pv.tailSpread = B.tailSpread * (0.65 + 0.8 * d.tail);
  Pv.dorsal = B.dorsal * (0.15 + 1.6 * d.fin);
  Pv.finLen = 0.75 + 0.6 * d.fin;
  Pv.markScale = d.markScale; Pv.markDensity = d.markDensity;
  return Pv;
}
