// Navigation = turning to a spread: fade the pages out, swap the spread, apply the page's scene, then settle on
// whatever camera that page asks for — the section routes ask for none and stay at the resting view, so on a
// desktop nothing moves at all. (The big journal's page-turn frames are still to be drawn; until then the spread
// crossfades — `dir` below is the seam the turn lands in.) Only the newest pending navigation runs; reduced
// motion makes every step instant.
import { loadFragment } from './fragments.js';
import { cameraOf } from './camera.js';

export function createNavigator(deps) {
  const { pond, camera, spreadEl, renderer, onPage } = deps;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let busy = false, queued = null, currentSpread = null;

  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
  function fade(out) { spreadEl.classList.toggle('is-leaving', out); return wait(out ? 220 : 0); }

  /** The pond belongs to the home spread. A section page declares `"pond": false` and everything painted on the
   *  paper leaves: the water, the ripples and every fish through one alpha on the world's multiply
   *  (js/pond/book.js), and the drawn journal object — boulder, page-turn rocks — with it, since it is DOM over
   *  the pond rather than part of the world. Nothing is destroyed, so coming home costs nothing to restore, and
   *  the photo underneath is untouched either way: it is never part of the world canvas.
   *  #journal-root already carries a 500ms opacity transition (css/site.css), so it needs no tween of its own. */
  let pondAnim = null;
  function setPond(on, instant) {
    const B = pond.book, to = on ? 1 : 0;
    const jr = document.getElementById('journal-root');
    if (jr) jr.style.opacity = String(to);
    if (pondAnim && pondAnim.cancel) pondAnim.cancel();
    pondAnim = null;
    if (instant || reduced || !window.anime || typeof window.anime.animate !== 'function') { B.worldAlpha = to; return; }
    if (Math.abs(B.worldAlpha - to) < 0.001) return;
    const s = { a: B.worldAlpha };
    pondAnim = window.anime.animate(s, {
      a: to, duration: 420, ease: 'inOutQuad',
      onUpdate: () => { B.worldAlpha = s.a; },
      onComplete: () => { B.worldAlpha = to; pondAnim = null; },
    });
  }

  async function run(nav, meta) {
    const { route, params } = nav;
    const page = route.page;
    if (typeof window.__layoutEditor !== 'undefined' && window.__layoutEditor && window.__layoutEditor.dirty && !meta.initial) {
      if (!window.confirm('Leave this page? Unsaved layout changes will be lost.')) return;
    }
    const [scene, fragment] = await Promise.all([
      meta.initial ? Promise.resolve(renderer.getScene()) : renderer.fetchPage(page),
      loadFragment(page),
    ]);
    const bucket = renderer.activeBreakpoint();
    const target = cameraOf(scene, bucket);
    // Which way the book turns to get here: +1 forward, -1 back, 0 = the same spread (closing a post, or
    // /work ↔ /projects). Never hand 0 to turn(): its step counter would never reach either end, so `playing`
    // would latch on, freezing the last frame and blocking every turn after it.
    const dir = (currentSpread == null || route.spread === currentSpread) ? 0 : (route.spread > currentSpread ? 1 : -1);
    setPond(!scene || scene.pond !== false, meta.initial);   // starts with the fade, lands under the turn later
    if (!meta.initial) {
      // ---- the seam the page turn drops into ----
      // For now the pages just crossfade: #spread's own 220ms opacity transition carries them back in when
      // is-leaving comes off below, so there is nothing to await on the way in.
      await fade(true);
      if (dir && pond.journal && pond.journal.ready && typeof pond.journal.turn === 'function') pond.journal.turn(dir);
    }
    spreadEl.innerHTML = '';
    spreadEl.appendChild(fragment);
    spreadEl.dataset.page = page;
    document.title = route.title || document.title;
    document.querySelectorAll('nav [data-route]').forEach((a) => { a.classList.toggle('is-active', a.dataset.route === page); if (a.dataset.route === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (!meta.initial) await renderer.loadPage(page, scene);
    currentSpread = route.spread;
    if (onPage) onPage(nav, scene);
    await fade(false);
    await camera.to(target, { duration: meta.initial ? 0 : 760, ease: 'outCubic' });
    spreadEl.querySelectorAll('.scene-node--reveal, [data-reveal]').forEach((el) => el.classList.add('is-revealed'));
    document.querySelectorAll('.scene-layer--book .scene-node--reveal').forEach((el) => el.classList.add('is-revealed'));
    const h1 = spreadEl.querySelector('h1'); if (h1 && !meta.initial) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
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

  return { navigate, get busy() { return busy; }, idle() { return new Promise((r) => { const t = () => (busy ? setTimeout(t, 40) : r()); t(); }); } };
}
