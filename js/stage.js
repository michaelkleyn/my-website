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
  var next = null;   // on a phone, the project waiting for the open row to fold shut
  panel.addEventListener('transitionend', function (e) {   // folded shut on a phone: on to the next row, or back to the stage
    if (e.propertyName !== 'grid-template-rows' || html.classList.contains('parked')) return;
    if (next) { var p = next; next = null; open(p); } else place(null);
  });
  function show() {
    var slug = location.hash.slice(1), proj = projs.find(function (p) { return p.dataset.project === slug; });
    if (proj && phone.matches && html.classList.contains('parked') && panel.parentNode !== rowOf(proj).parentNode) {
      next = proj; html.classList.remove('parked'); panel.classList.remove('play');   // another row: fold shut here first
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
      next = null; html.classList.remove('parked'); panel.classList.remove('play');
      if (!phone.matches) place(null);
      return;
    }
    var first = !html.classList.contains('parked');
    html.classList.add('parked');
    panel.style.setProperty('--lead', first ? '0.7s' : '0s');   // a fresh park: the content waits for the rows to land
    panel.classList.remove('play'); void panel.offsetWidth; panel.classList.add('play');   // from the top, every time
    if (phone.matches) rowOf(proj).scrollIntoView({ behavior: 'smooth', block: 'start' });   // the row's title at the top, the panel under it
  }
  show(); addEventListener('hashchange', show); phone.addEventListener('change', show);
})();
