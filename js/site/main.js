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

// ---- work / life: the nav's second life (links swap; the spreads themselves come later)
const MODE_KEY = 'siteMode';
function applyMode(mode) {
  document.documentElement.dataset.mode = mode;
  document.querySelectorAll('nav a[data-work]').forEach((a) => {
    const href = a.dataset[mode === 'life' ? 'life' : 'work']; if (href) a.setAttribute('href', href);
    const label = a.dataset[mode === 'life' ? 'lifeLabel' : 'workLabel']; if (label) a.textContent = label;
    if (mode === 'life' && /^https?:/.test(href || '')) a.setAttribute('data-no-router', ''); else a.removeAttribute('data-no-router');
  });
  const t = $('#mode-toggle'); if (t) { t.setAttribute('aria-pressed', mode === 'life' ? 'true' : 'false'); t.textContent = mode === 'life' ? 'life' : 'work'; }
  try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* private mode */ }
}
let mode = 'work'; try { mode = localStorage.getItem(MODE_KEY) === 'life' ? 'life' : 'work'; } catch (e) { /* private mode */ }

async function start() {
  const pond = await bootPond({
    canvas: $('#tank'), journalRoot: $('#journal-root'), root: document.body,
    assetsBase: '/assets/pond/', visitors: true, edit,
    panel: { root: document.body, setInsets: true },
  });
  const bookSpace = createBookSpace($('#book-space'), pond);
  const camera = createCamera(pond);
  const modal = createModal(document.body);
  const navigator = createNavigator({ pond, camera, spreadEl: $('#spread'), renderer, onPage: () => bookSpace.apply() });
  const router = createRouter({ onNavigate: (nav, meta) => navigator.navigate(nav, meta) });

  applyMode(mode);
  const toggle = $('#mode-toggle'); if (toggle) toggle.addEventListener('click', () => { mode = mode === 'life' ? 'work' : 'life'; applyMode(mode); });

  await (renderer ? renderer.ready : Promise.resolve());
  await router.start();
  ROUTES.forEach((r) => { if (r.page !== (router.current() || {}).route?.page) prefetchFragment(r.page); });

  window.__site = { pond, camera, bookSpace, router, navigator, modal, renderer };
  document.documentElement.classList.add('site-ready');
}

start().catch((e) => { console.error('[site] failed to start', e); document.documentElement.classList.add('site-failed'); });
