// Silhouettes in local space: nose at +x, tail at −x, y down.
import { quad } from './util.js';

// Shapes — local space: nose at +x, tail at −x, y down. `bend` ∈ [-1, 1]
// is only used by the painted-poses animation; the spine warp paints bend 0.
// =========================================================================

export var Shapes = {
  fish: {
    body: function (P, b) {
      var L = P.len, H = P.height, A = P.tailBend * b, T = P.tailSpread, tl = P.tailLen, be = 1 + (P.belly || 0);
      var px = -0.5 * L + tl, tx = -0.5 * L;
      return [
        [0.49 * L, 0],
        [0.37 * L, -0.24 * H], [0.17 * L, -0.48 * H], [-0.07 * L, -0.5 * H], [-0.24 * L, -0.36 * H],
        [px, -0.14 * H + A * 0.6],
        [tx, -T / 2 + A * 1.4],
        [tx + 0.45 * tl, A * 1.3],
        [tx, T / 2 + A * 1.4],
        [px, 0.14 * H + A * 0.6],
        [-0.24 * L, 0.36 * H * be], [-0.07 * L, 0.5 * H * be], [0.17 * L, 0.48 * H * be], [0.37 * L, 0.24 * H * be],
      ];
    },
    back: function (P, b) {
      var L = P.len, H = P.height, A = P.tailBend * b, px = -0.5 * L + P.tailLen;
      return [
        [0.45 * L, -0.02 * H], [0.37 * L, -0.24 * H], [0.17 * L, -0.48 * H], [-0.07 * L, -0.5 * H], [-0.24 * L, -0.36 * H],
        [px, -0.14 * H + A * 0.6], [-0.24 * L, -0.08 * H], [-0.07 * L, -0.12 * H], [0.17 * L, -0.1 * H],
      ];
    },
    tail: function (P, b) {
      var L = P.len, H = P.height, A = P.tailBend * b, T = P.tailSpread, tl = P.tailLen;
      var px = -0.5 * L + tl, tx = -0.5 * L;
      return [[px, -0.14 * H + A * 0.6], [tx, -T / 2 + A * 1.4], [tx + 0.45 * tl, A * 1.3], [tx, T / 2 + A * 1.4], [px, 0.14 * H + A * 0.6]];
    },
    dorsal: function (P) {
      if (P.dorsal <= 0) return null;
      var L = P.len, H = P.height, d = P.dorsal;
      return [[-0.1 * L, -0.47 * H], [-0.03 * L, -0.47 * H - d], [0.12 * L, -0.45 * H - d * 0.8], [0.2 * L, -0.45 * H]];
    },
    fins: function (P) {
      var L = P.len, H = P.height, f = P.finLen || 1;
      return [
        [[0.24 * L, 0.14 * H], [0.24 * L - 0.09 * L * f, 0.14 * H + 0.22 * H * f, 1.2], [0.24 * L - 0.16 * L * f, 0.14 * H + 0.38 * H * f]],
        [[0.24 * L, 0.14 * H], [0.24 * L - 0.12 * L * f, 0.14 * H + 0.1 * H * f, 0.7], [0.24 * L - 0.17 * L * f, 0.14 * H + 0.31 * H * f]],
      ];
    },
    line: function (P, b) {
      var L = P.len, H = P.height, px = -0.5 * L + P.tailLen;
      return [[0.41 * L, 0.02 * H], [0.17 * L, -0.03 * H, 0.8], [-0.12 * L, -0.02 * H], [px, P.tailBend * b * 0.4]];
    },
    eye: function (P) { return [0.37 * P.len, -0.07 * P.height]; },
    hatchAngle: function (P, b) { return P.hatchAngle + 28 * b; },
    bodyRange: function (P) { return [P.tailLen / P.len + 0.03, 0.96]; },
  },
  swallow: {
    wing: function (P, b, side) {
      var L = P.len, span = 0.5 * P.height * (1 - 0.32 * Math.abs(b)), fwd = 0.12 * L * b;
      var shoulder = [0.2 * L, side * 0.07 * L];
      var tip = [-0.18 * L + fwd, side * span];
      var root = [-0.16 * L, side * 0.06 * L];
      var lead = quad(shoulder, [0.34 * L + fwd * 0.5, side * 0.34 * span], tip, 7);
      var trail = quad(tip, [-0.02 * L + fwd * 0.5, side * 0.42 * span], root, 7);
      return lead.concat(trail.slice(1));
    },
    body: function (P, b) {
      var L = P.len, T = P.tailSpread, tl = P.tailLen, tx = -0.5 * L, nx = tx + tl * 0.6;
      var head = [[0.5 * L, 0], [0.46 * L, -0.045 * L], [0.36 * L, -0.065 * L]];
      var upper = Shapes.swallow.wing(P, b, -1);
      var tail = [[-0.3 * L, -0.045 * L], [tx, -T / 2], [nx, -0.012 * L], [nx, 0.012 * L], [tx, T / 2], [-0.3 * L, 0.045 * L]];
      var lower = Shapes.swallow.wing(P, b, 1).slice().reverse();
      var chin = [[0.36 * L, 0.065 * L], [0.46 * L, 0.045 * L]];
      return head.concat(upper, tail, lower, chin);
    },
    back: function (P) {
      var L = P.len;
      return [[0.44 * L, 0], [0.34 * L, -0.05 * L], [0.05 * L, -0.06 * L], [-0.25 * L, -0.04 * L], [-0.34 * L, 0], [-0.25 * L, 0.04 * L], [0.05 * L, 0.06 * L], [0.34 * L, 0.05 * L]];
    },
    tail: function (P) {
      var L = P.len, T = P.tailSpread, tx = -0.5 * L, nx = tx + P.tailLen * 0.6;
      return [[-0.3 * L, -0.045 * L], [tx, -T / 2], [nx, 0], [tx, T / 2], [-0.3 * L, 0.045 * L]];
    },
    dorsal: function () { return null; },
    fins: function (P, b) {
      var L = P.len, span = 0.5 * P.height * (1 - 0.32 * Math.abs(b)), fwd = 0.12 * L * b;
      return [
        [[0.16 * L, -0.08 * L], [0.2 * L + fwd * 0.5, -0.4 * span, 1.1], [-0.14 * L + fwd, -0.9 * span]],
        [[0.16 * L, 0.08 * L], [0.2 * L + fwd * 0.5, 0.4 * span, 1.1], [-0.14 * L + fwd, 0.9 * span]],
      ];
    },
    line: function () { return null; },
    eye: function (P) { return [0.44 * P.len, -0.02 * P.len]; },
    hatchAngle: function (P) { return P.hatchAngle; },
    bodyRange: function () { return [0.3, 0.95]; },
  },
};
