// Pure helpers shared by every pond module.

export function clone(o) { return JSON.parse(JSON.stringify(o)); }
export function rand(a, b) { return a + Math.random() * (b - a); }
export function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
/** Small seeded PRNG so a variant's markings/proportions are stable across repaints. */
export function mulberry(seed) {
  var t = (seed * 1000003) >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    var r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
/** n points sampled along a quadratic Bézier a→c with control b. */
export function quad(a, b, c, n) {
  var out = [];
  for (var i = 0; i <= n; i++) {
    var t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]);
  }
  return out;
}


export function mixHex(a, b, t) {
  var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), out = '#';
  for (var i = 16; i >= 0; i -= 8) { var ca = (pa >> i) & 255, cb = (pb >> i) & 255; out += ('0' + Math.round(ca + (cb - ca) * t).toString(16)).slice(-2); }
  return out;
}
export function cleanName(s) {
  var re; try { re = new RegExp("[^\\p{L}\\p{N} .'\\-]", 'gu'); } catch (e) { re = /[^A-Za-z0-9 .'\-]/g; }
  return String(s || '').replace(re, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

export function hslToHex(h, s, l) {
  var a = s * Math.min(l, 1 - l);
  var f = function (n) { var kk = (n + h / 30) % 12; var c = l - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}
