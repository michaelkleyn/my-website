// The project panel. A row's hash (#headliner, ...) parks the rows to the left and fades the project in beside them.
// Choosing another project while parked swaps the panel alone; #work (or any other section) unparks. The nav dot
// resolves these hashes to the section their row lives in (dot.js idx), so Art rows park under Art.
(function () {
  var html = document.documentElement, panel = document.querySelector('.panel');
  var projs = Array.from(panel.querySelectorAll('.proj'));
  function show() {
    var slug = location.hash.slice(1), proj = projs.find(function (p) { return p.dataset.project === slug; });
    projs.forEach(function (p) {
      var leaving = p !== proj && !p.hidden;
      p.hidden = p !== proj; p.classList.toggle('on', p === proj);
      // leaving a project with a player: swap the iframe for a fresh copy. Taking it out of the document ends its playback;
      // the copy is lazy and hidden, so it doesn't load until the project is opened again (a src reset alone is deferred the same way, and the old one plays on)
      if (leaving) p.querySelectorAll('iframe').forEach(function (f) { f.replaceWith(f.cloneNode()); });
    });
    if (!proj) {   // not a project: unpark
      html.classList.remove('parked'); panel.classList.remove('play');
      return;
    }
    var first = !html.classList.contains('parked');
    html.classList.add('parked');
    panel.style.setProperty('--lead', first ? '0.7s' : '0s');   // a fresh park: the content waits for the rows to land
    panel.classList.remove('play'); void panel.offsetWidth; panel.classList.add('play');   // from the top, every time
    if (matchMedia('(max-width: 960px)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  show(); addEventListener('hashchange', show);
})();
