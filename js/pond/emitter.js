// Tiny event emitter shared by the pond modules.

export function createEmitter() {
  var m = {};
  return {
    on: function (e, f) { (m[e] = m[e] || []).push(f); return function () { m[e] = (m[e] || []).filter(function (g) { return g !== f; }); }; },
    off: function (e, f) { m[e] = (m[e] || []).filter(function (g) { return g !== f; }); },
    emit: function (e, d) { (m[e] || []).slice().forEach(function (f) { f(d); }); },
  };
}
