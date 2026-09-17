// The panel tint's water. The halftone screen is a stack of rows, each a 10px strip of the same 5px dot grid, and
// each row's dot size and ink follow the height of water in a wave tank (the same across a row, so a row is the unit:
// a few dozen elements, three properties each per frame). The dots sweep up the panel with the last
// edge of the frame; reaching the top is the impact, and a Ricker pulse (a crest with a trough either side) runs
// straight back down. The walls are done by the method of images, the source mirrored across each wall, so the
// pulse comes back up weaker, and down again fainter.
// JS sets three custom properties per row per frame; CSS draws the dots and the raster's reveal. Runs from the fill's cue until the water is
// still, then stops. Starts when the page parks (html.parked), the same cue as the frame.
(function () {
  var html = document.documentElement, wave = document.querySelector('.frame .tone.wave');
  if (!wave) return;
  var T = 10, R0 = 0.9, A0 = 0.13;   // row height (2 dots), rest radius px, rest ink
  var C = 1800, W0 = 70, DECAY = 2.0, RHO = 0.5;   // wave speed px/s, pulse half-width px, decay /s, wall reflection
  var DELAY = 1600, FRONT = 300, RUN = 2000;   // ms: fill cue after the park (with the last edge), the fill's raster, how long the water moves
  var grid, W = 0, H = 0, raf = null, t0 = 0;

  var rows = [];
  function build() {   // one strip per row of dots: the wave is the same across a row, so a row is the unit
    var w = wave.clientWidth, h = wave.clientHeight;
    if (w === W && h === H && grid) return;
    W = w; H = h;
    if (grid) grid.remove();
    grid = document.createElement('span'); grid.className = 'grid';
    var n = Math.ceil(H / T); rows = [];
    var frag = document.createDocumentFragment();
    for (var j = 0; j < n; j++) {
      var el = document.createElement('i');
      el.style.setProperty('--dir', j % 2 ? 'to left' : 'to right');   // the raster: each row fills the other way to the last
      rows.push({ el: el, y: (j + 0.5) * T, s: (n - 1 - j) / n });   // s: the row's place in the raster, 0 at the bottom
      frag.appendChild(el);
    }
    grid.appendChild(frag); wave.appendChild(grid);
  }

  // water height at y, t seconds after the impact: a wave machine. A pulse leaves the top wall for the bottom,
  // straight across the panel, comes back off the bottom weaker, off the top weaker again, and dies.
  // The bounces are images of the source across the walls, RHO weaker each
  function height(y, t) {
    var sum = 0, r = C * t;
    for (var k = -2; k <= 2; k++) {
      var sy = 2 * k * H, u = (Math.abs(y - sy) - r) / W0;
      if (u > 3 || u < -3) continue;
      sum += Math.pow(RHO, Math.abs(k)) * (1 - u * u) * Math.exp(-u * u / 2);   // Ricker: crest, trough either side
    }
    return sum * Math.exp(-DECAY * t);
  }

  function frame(now) {
    var ms = now - t0, n = rows.length, p = Math.min(1, ms / FRONT) * (1 + 3 / n), td = Math.max(0, ms - FRONT) / 1000;   // raster position (three rows in flight); the wave starts when the raster reaches the top: the impact
    for (var k = 0; k < n; k++) {
      var row = rows[k], q = Math.max(0, Math.min(1, (p - row.s) * n / 3)), h = q ? height(row.y, td) : 0;
      var r = Math.max(0, R0 + 0.35 * h), a = Math.max(0.05, Math.min(0.19, A0 + 0.04 * h));   // the crest a smidge bigger and darker than rest, the trough a smidge less
      row.el.style.setProperty('--p', (q * 106).toFixed(1) + '%');
      row.el.style.setProperty('--r', r.toFixed(2) + 'px'); row.el.style.setProperty('--a', a.toFixed(3));
    }
    if (ms < RUN) raf = requestAnimationFrame(frame);
    else { raf = null; rest(); }
  }
  function rest() { rows.forEach(function (row) { row.el.style.setProperty('--p', '106%'); row.el.style.setProperty('--r', R0 + 'px'); row.el.style.setProperty('--a', A0); }); }
  function clear() { rows.forEach(function (row) { row.el.style.setProperty('--p', '0%'); }); }

  var timer = null;
  function start() {
    stop(); clear();
    timer = setTimeout(function () {   // built at the cue, not the park: the panel is still opening until then and would measure narrow
      build(); clear(); t0 = performance.now(); raf = requestAnimationFrame(frame);
    }, DELAY);
  }
  function stop() { clearTimeout(timer); cancelAnimationFrame(raf); raf = null; }
  // on the park, and only the park: switching projects while parked re-adds the class (a mutation with no change),
  // and the screen must stay as it is, not replay
  var parked = html.classList.contains('parked');
  new MutationObserver(function () {
    var now = html.classList.contains('parked');
    if (now === parked) return;
    parked = now;
    parked ? start() : (stop(), clear());
  }).observe(html, { attributes: true, attributeFilter: ['class'] });
  if (parked) start();
})();
