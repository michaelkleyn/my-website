// Navigation = a pan along the rail. Every panel is already built and in the DOM (js/site/rail.js), so a route
// change fetches nothing and swaps nothing: it slides the strip, and the journal on panel 0 slides with it
// because both take the same Book.camera.x. Only the newest pending navigation runs; reduced motion makes
// every step instant.

export function createNavigator(deps) {
  const { pond, rail, onPage } = deps;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let busy = false, queued = null;

  /** How much of the pond reaches the page, as a function of where we are — not of which route we are on.
   *  The journal lives on panel 0, so it fades out as the strip carries it off and is fully gone by the time
   *  panel 1 is in frame. Everything painted on the paper goes through the world canvas, so this one alpha
   *  takes the water, the ripples and every fish together; below 0.001 the pond stops doing any work at all
   *  (js/pond/school.js, js/pond/pond.js). #journal-root is DOM over the pond rather than part of the world,
   *  so it rides along on the 500ms opacity transition it already carries in css/site.css. */
  function pondByPan() {
    if (!pond) return;   // handheld: no journal was ever booted
    const w = window.innerWidth || 1;
    const a = Math.max(0, Math.min(1, 1 + pond.camera.x / w));   // camera.x is 0 on panel 0, -w on panel 1
    pond.book.worldAlpha = a;
    const jr = document.getElementById('journal-root');
    if (jr) jr.style.opacity = String(a < 0.02 ? 0 : 1);
  }

  async function run(nav, meta) {
    const { route, params } = nav;
    const page = route.page;
    if (typeof window.__layoutEditor !== 'undefined' && window.__layoutEditor && window.__layoutEditor.dirty && !meta.initial) {
      if (!window.confirm('Leave this page? Unsaved layout changes will be lost.')) return;
    }
    // The nav stays live while the fish editor is open, on purpose: clicking a section is a way out of it.
    // hide() starts its own restore, and rail.goTo's panTo settles zoom/rot/y as well as x, so whichever
    // lands last leaves the camera flat rather than stranded part-way.
    if (pond && pond.designer && pond.designer.open) pond.designer.hide();
    document.title = route.title || document.title;
    document.querySelectorAll('nav [data-route]').forEach((a) => { a.classList.toggle('is-active', a.dataset.route === page); if (a.dataset.route === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

    const off = pond ? pond.on('camera', pondByPan) : null;   // follow the pan frame by frame, not just at the ends
    try { await rail.goTo(page, { instant: meta.initial }); }
    finally { if (off) off(); pondByPan(); }

    if (onPage) onPage(nav);
    // preventScroll matters on a rail: focusing an element in an off-screen panel would otherwise yank the
    // scroll position and desync the strip from the camera.
    const h = rail.panels.get(page);
    const head = h && h.scroll.querySelector('h1');
    if (head && !meta.initial) { head.tabIndex = -1; head.focus({ preventScroll: true }); }
    if (route.open === 'post' && deps.openPost) deps.openPost(params.slug);
  }

  async function navigate(nav, meta) {
    if (busy) { queued = [nav, meta]; return; }
    busy = true;
    try { await run(nav, meta); }
    catch (e) { console.error('[site] navigation failed', e); }
    finally { busy = false; }
    if (queued) { const q = queued; queued = null; navigate(q[0], q[1]); }
  }

  return { navigate, pondByPan, get busy() { return busy; }, idle() { return new Promise((r) => { const t = () => (busy ? setTimeout(t, 40) : r()); t(); }); } };
}
