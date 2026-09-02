// The rail: the site is one long strip laid out sideways. Panel 0 is the journal on its desk; the sections
// lie to its right, a viewport apart. Moving between them is a pan, not a page load — every panel is built
// once at boot and stays in the DOM.
//
// The strip and the photo move by the same scalar. `Book.camera.x` already translates the canvas (photo, pond)
// and #book-space together; the track takes the same value, applied in the same frame, from the pond's own
// draw loop (js/pond/pond.js syncCameraDom). That is what keeps DOM and canvas from sliding against each other
// — see the 155px slip the comment there records. Three rules come with that, learned from book-space.js:
// write the transform synchronously in the handler, subscribe to `resize` as well as `camera` (a resize
// changes the fit without dirtying the camera), and apply once at mount or the strip sits at identity.
import { loadFragment } from './fragments.js';
import { ROUTES } from './routes.js';

/** The panels, in the order the journal's spreads run. One per distinct page. */
export function panelOrder() {
  const seen = new Map();
  for (const r of ROUTES) if (!seen.has(r.page)) seen.set(r.page, r.spread);
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([page]) => page);
}

export function createRail(opts) {
  const { pond, camera, el, track } = opts;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pages = panelOrder();
  const panels = new Map();
  let index = 0, lastT = '';

  for (const page of pages) {
    const sec = document.createElement('section');
    sec.className = 'panel';
    sec.dataset.panel = page;
    const scroll = document.createElement('div');
    scroll.className = 'panel-scroll';
    sec.appendChild(scroll);
    track.appendChild(sec);
    panels.set(page, { el: sec, scroll });
  }

  /** Every panel's content is fetched once, at boot. Navigation never waits on the network again. */
  async function mount() {
    await Promise.all(pages.map(async (page) => {
      try { panels.get(page).scroll.appendChild(await loadFragment(page)); }
      catch (e) { console.error('[rail] fragment failed: ' + page, e); }
    }));
  }

  const width = () => window.innerWidth;
  const panXOf = (i) => i * width();

  /** The pond owns the camera value; the track only mirrors it, in the frame the pond drew with. */
  function apply() {
    const t = 'translateX(' + pond.camera.x.toFixed(2) + 'px)';
    if (t === lastT) return;
    lastT = t;
    track.style.transform = t;
  }

  let panning = false;

  function goTo(page, o) {
    o = o || {};
    const i = Math.max(0, pages.indexOf(page));
    index = i;
    el.dataset.panel = pages[i];
    for (const [p, panel] of panels) panel.el.classList.toggle('is-current', p === pages[i]);
    // Only the panel you are on takes the keyboard; the rest are off-screen and must not be tab stops.
    for (const [p, panel] of panels) panel.el.inert = p !== pages[i];
    if (!camera) return Promise.resolve();   // handheld: the panels are stacked, there is nothing to pan
    panning = true;
    const done = camera.panTo(-panXOf(i), { duration: o.instant || reduced ? 0 : (o.duration || 900), ease: 'inOutCubic' });
    return done.then(() => { panning = false; });
  }

  const step = (d) => { const n = index + d; return n >= 0 && n < pages.length ? pages[n] : null; };

  /** Scrolling is ordinary and vertical inside a panel. Only a deliberate push *past* an end moves sideways:
   *  the overscroll has to add up past a threshold, and then the rail stays locked until the wheel has been
   *  quiet for a moment, so a trackpad's momentum tail cannot skate through three panels on one flick. */
  const EDGE = 120, QUIET = 220;
  function bindGestures(onEdge) {
    let acc = 0, dirLast = 0, lock = false, quiet = 0;
    const release = () => { clearTimeout(quiet); quiet = setTimeout(() => { lock = false; acc = 0; }, QUIET); };

    window.addEventListener('wheel', (e) => {
      // Two other things own the wheel: the iPod's own menu (js/ipod/ipod.js) and any open card's scroller.
      if (e.target.closest && e.target.closest('#ipod-rig, .modal-card, #designer')) return;
      if (document.documentElement.classList.contains('focus-journal')) return;   // the editor has the view
      const cur = panels.get(pages[index]);
      if (!cur) return;
      const sc = cur.scroll, dy = e.deltaY;
      if (!dy) return;
      if (lock || panning) { release(); return; }
      const dir = dy > 0 ? 1 : -1;
      const atTop = sc.scrollTop <= 0;
      const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
      if ((dir > 0 && !atEnd) || (dir < 0 && !atTop)) { acc = 0; dirLast = 0; return; }   // still room to scroll
      if (dir !== dirLast) { acc = 0; dirLast = dir; }
      acc += Math.abs(dy);
      if (acc < EDGE) return;
      const next = step(dir);
      acc = 0;
      if (!next) return;
      lock = true; release();
      onEdge(next);
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.documentElement.classList.contains('focus-journal')) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
      const next = e.key === 'ArrowRight' ? step(1) : e.key === 'ArrowLeft' ? step(-1) : null;
      if (!next) return;
      e.preventDefault();
      onEdge(next);
    });
  }

  return {
    mount, apply, goTo, bindGestures,
    get page() { return pages[index]; },
    get index() { return index; },
    get panning() { return panning; },
    pages, panels, step,
    /** Re-seat the strip when the viewport width changes — the panels are viewport-wide. */
    reseat() { if (camera) { camera.panTo(-panXOf(index), { duration: 0 }); apply(); } },
  };
}
