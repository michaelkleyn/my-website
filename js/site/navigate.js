// Navigation = a camera move over the journal: pull back a little, swap the spread, apply the page's scene,
// then settle on the page's own camera. (The big journal's page-turn frames are still to be drawn; until then
// the spread crossfades.) Only the newest pending navigation runs; reduced motion makes every step instant.
import { loadFragment } from './fragments.js';
import { cameraOf } from './camera.js';

export function createNavigator(deps) {
  const { pond, camera, spreadEl, renderer, onPage } = deps;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let busy = false, queued = null, currentSpread = null;

  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
  function fade(out) { spreadEl.classList.toggle('is-leaving', out); return wait(out ? 220 : 0); }

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
    if (!meta.initial) {
      // pull back over the spine while the pages change
      await Promise.all([fade(true), camera.to({ zoom: Math.max(0.9, target.zoom * 0.92), cx: 768, cy: 512 }, { duration: 520, ease: 'inOutQuad' })]);
      if (pond.journal && pond.journal.ready && currentSpread != null && route.spread !== currentSpread && typeof pond.journal.turn === 'function') {
        pond.journal.turn(route.spread > currentSpread ? 1 : -1);
      }
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
