// The site: a pond on the pages of the journal, content on the pages in book space, navigation as camera moves.
//   - js/pond/boot.js boots the pond from /assets/pond (pre-rendered atlas when it matches the config)
//   - js/scene-renderer.js (classic script, already booted) places nodes; book-space nodes ride #book-space
//   - design mode (?edit or localhost): the layout editor (renderer) + the pond panel (js/lab/panel.js)
import { bootPond } from '/js/pond/boot.js';
import { createRouter } from './router.js';
import { createBookSpace } from './book-space.js';
import { createCamera } from './camera.js';
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
  window.__site = { pond, camera, bookSpace, router, navigator, modal, renderer };
  document.documentElement.classList.add('site-ready');
}

start().catch((e) => { console.error('[site] failed to start', e); document.documentElement.classList.add('site-failed'); });
