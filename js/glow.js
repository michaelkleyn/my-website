// iPadOS-style pointer highlight on the row links (and, in a harder-edged variant, the hello link): a coral box the cursor melts into.
// The box, the edge ring and the cursor halo are plain CSS; the sticky merge between halo and edge is the #goo SVG filter
// in index.html. JS feeds each row the pointer position and how near it is (the ring glows faintly on approach, strongest
// on the nearest edge), anchors the ink to the point of entry (and of exit, for the drain), and tells the cursor which
// link is pulling on it (window.linkPull, read by cursor.js).
(function () {
  if (!matchMedia('(hover: hover)').matches) return;
  var REACH = 128, LEAN = 64, EDGE = 35;   // px outside the box at which the edge starts to answer / the cursor starts to lean; px inside an edge at which the ring rises
  var rows = Array.prototype.map.call(document.querySelectorAll('.rows a, .hello'), function (a) {
    var glow = document.createElement('span'), goo = document.createElement('span');
    glow.className = 'glow'; goo.className = 'goo'; glow.appendChild(goo); a.appendChild(glow);
    function anchor(e) {   // the ink flows out from the point of entry, and drains toward the point of exit
      var r = glow.getBoundingClientRect(), x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
      glow.style.setProperty('--ex', x + 'px'); glow.style.setProperty('--ey', y + 'px');
      glow.style.setProperty('--far', Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) + 'px');   // to the far corner: the whole sweep is visible travel
    }
    a.addEventListener('pointerenter', anchor); a.addEventListener('pointerleave', anchor);
    return { glow: glow, goo: goo, pull: !a.matches('.hello') };   // the hello link gets the glow but not the cursor lean
  });
  window.linkPull = { x: 0, y: 0, n: 0 };
  addEventListener('pointermove', function (e) {
    var best = null;
    var m = rows.map(function (row) {
      var r = row.goo.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      var cx = Math.max(0, Math.min(r.width, x)), cy = Math.max(0, Math.min(r.height, y)), d = Math.hypot(cx - x, cy - y);   // nearest point of the box, and how far outside
      var near = Math.max(0, 1 - d / REACH);
      if (row.pull && (!best || d < best.d)) best = { d: d, near: near, x: cx - x, y: cy - y };   // only rows pull on the cursor
      var dEdge = Math.min(x, r.width - x, y, r.height - y);   // inside: how close to the nearest edge; the ring is quiet mid-row and rises as the cursor drifts to an edge
      return { row: row, x: cx, y: cy, near: near, inside: d === 0, edge: Math.max(0, 1 - dEdge / EDGE) };
    });
    var inside = m.some(function (i) { return i.inside; });
    m.forEach(function (i) {
      var near = inside && !i.inside ? 0 : i.inside ? i.edge : i.near;   // while inside one link, the others stay quiet
      var s = i.row.goo.style;
      s.setProperty('--mx', i.x + 'px'); s.setProperty('--my', i.y + 'px');
      i.row.glow.style.setProperty('--mx', i.x + 'px'); i.row.glow.style.setProperty('--my', i.y + 'px');   // the hello fill draws its glow at the pointer too
      s.setProperty('--near', near.toFixed(3));
      s.setProperty('--ring-o', (i.inside ? 0.06 + 0.22 * i.edge : 0.14 * Math.pow(near, 1.5)).toFixed(3));   // approach: a light glow trailing the lean; inside: faint mid-row, full at an edge
      s.setProperty('--spread', i.inside ? '0.5' : '0.35');                                              // the ring stays near the cursor (eased in CSS)
    });
    // the cursor leans on approach; no pull once inside. Shorter perimeter than the glow: the lean starts at LEAN px out
    var n = best && best.d > 0 ? Math.max(0, 1 - best.d / LEAN) : 0;   // linear, so the lean is the first thing to move
    window.linkPull = { x: n ? best.x / best.d : 0, y: n ? best.y / best.d : 0, n: n };
  });
})();
