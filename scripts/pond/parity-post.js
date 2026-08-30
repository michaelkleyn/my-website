// POST expression for the module-split parity checks: a stable dump of the lab's API surface and state.
// Used as: POST="$(cat scripts/pond/parity-post.js)" node scripts/pond/shot.mjs "<url>?det=7&freeze=240" out/parity/<step>
(function () {
  var L = window.BoidsLab, P = L.P, A = L.school.atlas;
  var h = function (s) { var x = 5381; for (var i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0; return x.toString(36); };
  var fish = L.school.fish.map(function (f) { return [Math.round(f.x), Math.round(f.y), +f.heading.toFixed(3), f.variant]; });
  return JSON.stringify({
    keys: Object.keys(L).sort(),
    pHash: h(JSON.stringify(P)), pKeys: Object.keys(P).length,
    atlas: A ? [A.canvas.width, A.canvas.height, A.cellW, A.cellH, A.poses, A.variants, Math.round(A.ox), Math.round(A.oy), Math.round(A.bodyW)] : null,
    fishN: L.school.fish.length, fishHash: h(JSON.stringify(fish)), residents: L.school.residents.length,
    world: [L.school.W, L.school.H, Math.round(L.school.ox), Math.round(L.school.oy)],
    book: L.Book && L.Book.ready ? { fit: [+L.Book.fit.s.toFixed(4), Math.round(L.Book.fit.x), Math.round(L.Book.fit.y)], spine: L.Book.spineX } : null,
    journal: L.Journal && L.Journal.ready ? { props: L.Journal.exportProps(), FW: L.Journal.FW, FH: L.Journal.FH } : null,
    drawings: L.Drawings ? L.Drawings.items.length : null,
    water: [L.Water.cols, L.Water.rows, L.Water.glW, L.Water.glH],
    ids: ['tank', 'journal-root', 'visitor-ui', 'designer', 'panel', 'status', 'c-book', 'c-visitors', 'presets', 'json'].filter(function (i) { return !!document.getElementById(i); }),
    paused: !!(document.querySelector('#btn-pause') && document.querySelector('#btn-pause').textContent === 'Play'),
  });
})()
