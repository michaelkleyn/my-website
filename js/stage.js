// The project panel. A row's hash (#headliner, ...) parks the rows to the left and fades the project in beside them
// (on a phone: opens it inside the row, between its link and its rule).
// Choosing another project while parked swaps the panel alone; #work (or any other section) unparks. The nav dot
// resolves these hashes to the section their row lives in (dot.js idx), so Art rows park under Art.
(function () {
  var html = document.documentElement, panel = document.querySelector('.panel'), stage = document.querySelector('.stage');
  var projs = Array.from(panel.querySelectorAll('.proj')), phone = matchMedia('(max-width: 960px)');
  function rowOf(proj) { return document.querySelector('.rows a[href="#' + proj.dataset.project + '"]'); }
  function place(proj) {   // on a phone the panel opens inside the chosen row, under its link; otherwise it lives beside the rows
    var row = proj && phone.matches && rowOf(proj), home = row ? row.parentNode : stage;
    if (panel.parentNode !== home) home.appendChild(panel);
  }
  var still0 = matchMedia('(prefers-reduced-motion: reduce)'), FRAME_MS = 2500;   // the frame's whole drawing (css), the last corner settled
  var drawStart = null, drawTimer = 0;   // while the frame's one drawing runs: when it began
  function settleFrame() {   // the drawing is done (or cut short): the frame is simply there from now on (css: html.drawn)
    clearTimeout(drawTimer); drawStart = null; html.classList.add('drawn'); html.classList.remove('drawing');
  }
  function enter(proj, elapsed) { if (window.panelEnter) { if (proj) panelEnter.start(proj, elapsed); else panelEnter.cancel(); } }
  var next = null;   // on a phone, the project waiting for the open row to fold shut
  panel.addEventListener('transitionend', function (e) {   // folded shut on a phone: on to the next row, or back to the stage
    if (e.propertyName !== 'grid-template-rows' || html.classList.contains('parked')) return;
    if (next) { var p = next; next = null; open(p); } else place(null);
  });
  function still() {   // no transition will run on the panel (reduced motion): transitionend would never come
    void panel.offsetWidth;
    return getComputedStyle(panel).transitionDuration.split(',').every(function (d) { return !parseFloat(d); });
  }
  function show() {
    var slug = location.hash.slice(1), proj = projs.find(function (p) { return p.dataset.project === slug; });
    if (proj && phone.matches && html.classList.contains('parked') && panel.parentNode !== rowOf(proj).parentNode) {
      next = proj; enter(null); if (drawStart !== null) settleFrame(); html.classList.remove('parked'); panel.classList.remove('play');   // another row: fold shut here first
      if (still()) { next = null; open(proj); }   // nothing to wait for
      return;
    }
    open(proj);
  }
  function open(proj) {
    if (proj) { place(proj); void panel.offsetWidth; }   // in its row (phone) and laid out shut, so it can unfold from there
    projs.forEach(function (p) {
      var leaving = p !== proj && !p.hidden;
      p.hidden = p !== proj; p.classList.toggle('on', p === proj);
      // leaving a project with a player: swap the iframe for a fresh copy. Taking it out of the document ends its playback;
      // the copy is lazy and hidden, so it doesn't load until the project is opened again (a src reset alone is deferred the same way, and the old one plays on)
      if (leaving) p.querySelectorAll('iframe').forEach(function (f) { f.replaceWith(f.cloneNode()); });
    });
    if (!proj) {   // not a project: unpark (on a phone the panel folds shut in its row first, then goes home: transitionend above)
      next = null; enter(null); clearTimeout(drawTimer); drawStart = null; html.classList.remove('parked', 'drawing'); panel.classList.remove('play');   // a drawing cut short is drawn again next time
      if (!phone.matches || still()) place(null);
      return;
    }
    html.classList.add('parked');
    // the frame draws once per page load, on the first open (css: html.drawing, then html.drawn); a switch leaves it be.
    // The content comes in after it (js/enter.js): when the stroke is done on the first open, at once on a switch.
    if (!html.classList.contains('drawn') && drawStart === null) {
      html.classList.remove('drawing'); void html.offsetWidth; html.classList.add('drawing');
      drawStart = performance.now(); drawTimer = setTimeout(settleFrame, still0.matches ? 0 : FRAME_MS);
      dispatchEvent(new Event('framedraw'));
    }
    panel.classList.remove('play'); void panel.offsetWidth; panel.classList.add('play');
    enter(proj, drawStart === null ? null : performance.now() - drawStart);
    if (phone.matches) rowOf(proj).scrollIntoView({ behavior: 'smooth', block: 'start' });   // the row's title at the top, the panel under it
  }
  show(); addEventListener('hashchange', show); phone.addEventListener('change', show);
})();
