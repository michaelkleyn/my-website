// The site: a pond on the pages of the journal, content on the pages in book space, navigation as camera moves.
//   - js/pond/boot.js boots the pond from /assets/pond (pre-rendered atlas when it matches the config)
//   - js/scene-renderer.js (classic script, already booted) places nodes; book-space nodes ride #book-space
//   - design mode (?edit or localhost): the layout editor (renderer) + the pond panel (js/lab/panel.js)
import { bootPond } from '/js/pond/boot.js';
import { createRouter } from './router.js';
import { createBookSpace } from './book-space.js';
import { createCamera, cameraOf } from './camera.js';
import { createNavigator } from './navigate.js';
import { createModal } from './modal.js';
import { prefetchFragment } from './fragments.js';
import { ROUTES } from './routes.js';

const renderer = window.sceneRenderer;
const edit = !!(renderer && renderer.isEditEnvironment());
const $ = (s) => document.querySelector(s);

async function start() {
  const pond = await bootPond({
    canvas: $('#tank'), journalRoot: $('#journal-root'), root: document.body,
    assetsBase: '/assets/pond/', visitors: true, edit,
    panel: { root: document.body, setInsets: true, hotkeys: false },
  });
  const bookSpace = createBookSpace($('#book-space'), pond);
  const camera = createCamera(pond);
  const modal = createModal(document.body, { onClose: () => { const cur = router.current(); if (cur && cur.route.open === 'post') router.go('/blog', { replace: true }); } });
  const navigator = createNavigator({ pond, camera, spreadEl: $('#spread'), renderer, onPage: () => bookSpace.apply(), openPost: (slug) => modal.open('blog/' + slug, null, { reading: true }) });
  const router = createRouter({ onNavigate: (nav, meta) => navigator.navigate(nav, meta) });

  await (renderer ? renderer.ready : Promise.resolve());
  await router.start();
  ROUTES.forEach((r) => { if (r.page !== (router.current() || {}).route?.page) prefetchFragment(r.page); });

  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('[data-leave-fish]'); if (!t) return; e.preventDefault(); const b = document.getElementById('btn-leave'); if (b) b.click(); });
  mountFishPage(pond, camera, bookSpace);
  window.__site = { pond, camera, bookSpace, router, navigator, modal, renderer };
  // One reveal for the whole scene: hold it until the spread's art has decoded, so nothing arrives
  // half-dressed (the iPod's screen before its body). Bounded — a slow asset can't strand the page.
  const art = Array.from(document.querySelectorAll('#book-space img'), (i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
  const photo = new Promise((res) => {   // the journal photo the canvas composes — in the dark, the night one
    const ok = () => pond.book.ready && (!pond.book.darkImg || pond.book.darkReady);
    if (ok()) return res();
    const iv = setInterval(() => { if (ok()) { clearInterval(iv); res(); } }, 60);
  });
  await Promise.race([Promise.all([...art, photo]), new Promise((r) => setTimeout(r, 1500))]);
  document.documentElement.classList.add('site-ready');
}

/** The fish editor is a page in the journal, not a card over it: park #designer on the right-hand page
 *  (photo px, straight from assets/pond/book/book.json) and ease the camera onto it while it is open.
 *  One layout everywhere — the camera, not a media query, is what makes it readable on a phone.
 *  The lab (lab/boids-lab.html) has no #book-space, so it keeps the floating card in css/pond.css. */
function mountFishPage(pond, camera, bookSpace) {
  const el = document.getElementById('designer');
  if (!el) return;
  const r = (pond.book.D && pond.book.D.right) || [783, 26, 1384, 783];
  const [pw, ph] = [r[2] - r[0], r[3] - r[1]];
  el.removeAttribute('aria-modal');   // on the page it is a region you can read past, not a modal
  Object.assign(el.style, { left: r[0] + 'px', top: r[1] + 'px', width: pw + 'px', height: ph + 'px' });
  bookSpace.el.appendChild(el);

  /** The zoom that fits the page in the view with a margin — never below the resting view. */
  function pageZoom() {
    const s = pond.book.fit.s, sc = pond.school;
    const w = sc.cw - ((sc.insets && sc.insets.right) || 0);
    return Math.max(1, Math.min((w * 0.92) / (pw * s), (sc.ch * 0.92) / (ph * s)));
  }
  pond.designer.on('open', () => {
    document.documentElement.classList.add('fish-page');
    camera.to({ zoom: pageZoom(), cx: (r[0] + r[2]) / 2, cy: (r[1] + r[3]) / 2 }, { duration: 620, ease: 'outCubic' });
  });
  pond.designer.on('close', () => {
    document.documentElement.classList.remove('fish-page');
    camera.to(cameraOf(renderer.getScene(), renderer.activeBreakpoint()), { duration: 520, ease: 'outCubic' });
  });
}

start().catch((e) => { console.error('[site] failed to start', e); document.documentElement.classList.add('site-failed'); });
