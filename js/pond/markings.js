// Koi markings in body space, mapped through the real outline.
import { clamp } from './util.js';

// ---- Markings live in "body space": u along the body (0 tail root → 1 nose),
//      v across it (−1 back → +1 belly). Mapped through the actual outline,
//      so patches follow the silhouette and bend with the tail.
export function bodySpace(poly, range) {
  var xs = poly.map(function (p) { return p[0]; });
  var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs), n = poly.length;
  function extents(x) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n];
      if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) {
        var y = a[1] + (x - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    return lo === Infinity ? null : [lo, hi];
  }
  return {
    map: function (u, v) {
      var x = xmin + (range[0] + (range[1] - range[0]) * clamp(u, 0, 1)) * (xmax - xmin);
      var e = extents(x) || [-1, 1];
      var mid = (e[0] + e[1]) / 2, half = (e[1] - e[0]) / 2;
      return [x, mid + clamp(v, -1, 1) * half * 0.88];
    },
  };
}
export function blob(bs, r, cu, cv, ru, rv, n) {
  var pts = [], rot = r() * Math.PI;
  for (var k = 0; k < n; k++) {
    var a = rot + (k / n) * Math.PI * 2, rad = 0.72 + 0.56 * r();
    pts.push(bs.map(cu + Math.cos(a) * ru * rad, cv + Math.sin(a) * rv * rad));
  }
  return pts;
}
export function sumiSpots(bs, r, P, count) {
  var out = [], s = P.markScale, n = Math.round(count * P.markDensity);
  for (var i = 0; i < n; i++) {
    out.push({ pts: blob(bs, r, 0.1 + r() * 0.82, -0.55 + r() * 0.9, (0.025 + 0.035 * r()) * s, (0.12 + 0.16 * r()) * s, 8), color: 4, op: 1.3, curv: 0.7 });
  }
  return out;
}
// Each pattern → list of { pts, color (palette index), op (opacity ×), curv }; `net` asks for the Asagi crosshatch.
export var PATTERNS = {
  plain: function () { return []; },
  kohaku: function (bs, r, P) {
    var out = [], s = P.markScale, n = Math.max(1, Math.round((2 + r() * 2.5) * P.markDensity));
    for (var i = 0; i < n; i++) {
      var cu = 0.06 + ((i + 0.5 + (r() - 0.5) * 0.5) / n) * 0.88;
      out.push({ pts: blob(bs, r, cu, -0.3 + (r() - 0.5) * 0.7, (0.08 + 0.09 * r()) * s, (0.35 + 0.35 * r()) * s, 10), color: 3, op: 1, curv: 0.6 });
    }
    return out;
  },
  sanke: function (bs, r, P) { return PATTERNS.kohaku(bs, r, P).concat(sumiSpots(bs, r, P, 2 + r() * 4)); },
  showa: function (bs, r, P) {
    var out = [], s = P.markScale, n = Math.max(1, Math.round((2 + r() * 1.5) * P.markDensity));
    for (var i = 0; i < n; i++) {
      out.push({ pts: blob(bs, r, 0.08 + ((i + 0.5 + (r() - 0.5) * 0.6) / n) * 0.84, (r() - 0.5) * 1.2, (0.11 + 0.1 * r()) * s, (0.5 + 0.4 * r()) * s, 10), color: 4, op: 1.15, curv: 0.6 });
    }
    for (var j = 0; j < 2; j++) {
      out.push({ pts: blob(bs, r, 0.2 + r() * 0.6, -0.4 + (r() - 0.5) * 0.6, (0.07 + 0.07 * r()) * s, (0.3 + 0.3 * r()) * s, 9), color: 3, op: 1, curv: 0.6 });
    }
    return out;
  },
  bekko: function (bs, r, P) { return sumiSpots(bs, r, P, 3 + r() * 4); },
  tancho: function (bs, r, P) {
    return [{ pts: blob(bs, r, 0.83, -0.12, 0.055 * P.markScale, 0.36 * P.markScale, 12), color: 3, op: 1.05, curv: 0.8 }];
  },
  asagi: function (bs, r, P) {
    var out = [], s = P.markScale, n = Math.max(1, Math.round((2 + r() * 2) * P.markDensity));
    for (var i = 0; i < n; i++) {
      out.push({ pts: blob(bs, r, 0.12 + ((i + 0.5 + (r() - 0.5) * 0.5) / n) * 0.7, 0.7 + r() * 0.25, (0.09 + 0.09 * r()) * s, (0.22 + 0.18 * r()) * s, 9), color: 3, op: 0.85, curv: 0.6 });
    }
    out.push({ pts: blob(bs, r, 0.9, 0.35, 0.05 * s, 0.28 * s, 9), color: 3, op: 0.85, curv: 0.7 });
    out.net = true;
    return out;
  },
};

// =========================================================================
