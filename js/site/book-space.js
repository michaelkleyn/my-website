// #book-space: a 1536×1024 (photo px) element the site transforms to sit exactly on the journal photo, camera
// included. Everything "on the page" (nav, hero, drawings, modal triggers) is a child, so it rides along for free.
// Dispatches `scene:transform` on every change (the layout editor keeps its chrome glued to nodes with it).

export function createBookSpace(el, pond) {
  const D = pond.book.D || { W: 1536, H: 1024 };
  el.style.width = D.W + 'px';
  el.style.height = D.H + 'px';
  el.style.transformOrigin = '0 0';
  let raf = 0, last = '';

  function apply() {
    const f = pond.screenFit;
    const t = 'translate(' + f.x.toFixed(2) + 'px,' + f.y.toFixed(2) + 'px) scale(' + f.s.toFixed(5) + ')';
    if (t === last) return;
    last = t;
    el.style.transform = t;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; window.dispatchEvent(new CustomEvent('scene:transform', { detail: f })); });
  }
  const offResize = pond.on('resize', apply);
  const offCamera = pond.on('camera', apply);
  apply();
  return {
    el, apply,
    /** photo px → screen px */
    toScreen(px, py) { const f = pond.screenFit; return [f.x + px * f.s, f.y + py * f.s]; },
    destroy() { offResize(); offCamera(); },
  };
}
