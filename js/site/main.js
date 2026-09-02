// The site: one strip of panels laid out sideways (js/site/rail.js). Panel 0 is the journal on its desk with
// the pond alive on its pages; the sections lie to its right. Navigation is a pan, so the strip and the photo
// move by the same Book.camera.x.
//   - js/pond/boot.js boots the pond from /assets/pond (pre-rendered atlas when it matches the config)
//   - js/scene-renderer.js (classic script, already booted) places nodes; book-space nodes ride #book-space
//   - design mode (?edit or localhost): the layout editor (renderer) + the pond panel (js/lab/panel.js)
//   - on a phone there is no journal at all: the pond never boots and the panels stack (see HANDHELD)
import { bootPond } from '/js/pond/boot.js';
import { createRouter } from './router.js';
import { createBookSpace } from './book-space.js';
import { createCamera } from './camera.js';
import { createNavigator } from './navigate.js';
import { createRail } from './rail.js';
import { createModal } from './modal.js';
import { ROUTES } from './routes.js';

const renderer = window.sceneRenderer;
const edit = !!(renderer && renderer.isEditEnvironment());
const $ = (s) => document.querySelector(s);

/** A phone gets no journal and no pond: a 1536×1024 photograph is either unreadable or a fraction of itself,
 *  and hiding the canvas would save nothing — the sim, the world repaint and the composite all keep running.
 *  The only way not to pay for it is not to start it. Leave a Fish goes with it; it is a desktop feature. */
const HANDHELD = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

async function start() {
  document.documentElement.classList.toggle('handheld', HANDHELD);
  // Below this the journal and everything on it stop resizing and slide out of view instead; the
  // compositor reads it too, so the objects stay glued to the book rather than drifting over it.
  document.documentElement.dataset.designWidth = '1440';
  const pond = HANDHELD ? null : await bootPond({
    canvas: $('#tank'), journalRoot: $('#journal-root'), root: document.body,
    assetsBase: '/assets/pond/', visitors: true, edit,
    panel: { root: document.body, setInsets: true, hotkeys: false },
  });
  if (pond) { pond.book.designW = +document.documentElement.dataset.designWidth; pond.resize(); }
  const bookSpace = pond && createBookSpace($('#book-space'), pond);
  const camera = pond && createCamera(pond);
  const modal = createModal(document.body, { onClose: () => { const cur = router.current(); if (cur && cur.route.open === 'post') router.go('/blog', { replace: true }); } });
  const rail = createRail({ pond, camera, el: $('#rail'), track: $('#track'), handheld: HANDHELD });
  await rail.mount();
  const navigator = createNavigator({ pond, rail, handheld: HANDHELD, onPage: () => bookSpace && bookSpace.apply(), openPost: (slug) => modal.open('blog/' + slug, null, { reading: true }) });
  const router = createRouter({ onNavigate: (nav, meta) => navigator.navigate(nav, meta) });

  if (pond) {
    pond.on('camera', rail.apply);
    pond.on('resize', () => {
      if (document.documentElement.classList.contains('focus-journal')) return;   // the editor re-frames itself
      rail.reseat(); navigator.pondByPan();
    });
    rail.apply();
  }
  await (renderer ? renderer.ready : Promise.resolve());
  await router.start();
  // An edge push or an arrow key is a navigation like any other, so it goes through the router and the URL
  // keeps up. On a phone the panels are stacked and the page scrolls normally — no gestures to bind.
  if (!HANDHELD) rail.bindGestures((page) => { const r = ROUTES.find((x) => x.page === page); if (r) router.go(r.path); });

  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('[data-leave-fish]'); if (!t) return; e.preventDefault(); const b = document.getElementById('btn-leave'); if (b) b.click(); });
  if (pond) mountFishPage(pond, camera);
  window.__site = { pond, camera, bookSpace, rail, router, navigator, modal, renderer, handheld: HANDHELD };
  // One reveal for the whole scene: hold it until the art has decoded, so nothing arrives half-dressed (the
  // iPod's screen before its body). Bounded — a slow asset can't strand the page. On a phone there is no
  // journal to wait for, so only the panels gate it.
  const art = Array.from(document.querySelectorAll('#book-space img'), (i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
  const photo = pond ? new Promise((res) => {   // the journal photo the canvas composes — in the dark, the night one
    const ok = () => pond.book.ready && (!pond.book.darkImg || pond.book.darkReady);
    if (ok()) return res();
    const iv = setInterval(() => { if (ok()) { clearInterval(iv); res(); } }, 60);
  }) : Promise.resolve();
  await Promise.race([Promise.all([...art, photo]), new Promise((r) => setTimeout(r, 1500))]);
  document.documentElement.classList.add('site-ready');
}

/** The fish editor is a loose sheet on the desk beside the journal: a fixed column down the right
 *  (css/fish-page.css .fish-panel), with the camera easing the book left and up a little so the page it
 *  writes onto is in clear view next to it. Screen space, not book space — so it never inherits the book's
 *  tilt or scale, the loose objects can't stack over it, and its ✕ sits in open air.
 *  The nav stays live on purpose: clicking work/writing/about is a way out (js/site/navigate.js closes it).
 *  The lab (lab/boids-lab.html) has no rail, so it keeps the floating card in css/pond.css. */
function mountFishPage(pond, camera) {
  const el = document.getElementById('designer');
  if (!el) return;
  const r = (pond.book.D && pond.book.D.right) || [783, 26, 1384, 783];
  const [pw, ph] = [r[2] - r[0], r[3] - r[1]];
  el.removeAttribute('aria-modal');   // beside the page it is a region you can read past, not a modal
  el.classList.add('fish-panel');

  /** How the book is framed while the editor is open: the page fits the height with room to breathe under
   *  the header, in whatever width the panel leaves — never below the resting view. */
  function frame() {
    const s = pond.book.fit.s, sc = pond.school;
    const panelW = el.getBoundingClientRect().width || 380;
    const avail = sc.cw - panelW;
    return {
      zoom: Math.max(1, Math.min((avail * 0.94) / (pw * s), (sc.ch * 0.86) / (ph * s))),
      cx: (r[0] + r[2]) / 2, cy: (r[1] + r[3]) / 2,
      rot: -pond.book.deskRot(),   // cancel the desk tilt: square to read, and it is what makes the framing land
      dx: -panelW / 2,             // ...and slide the book left, out from under the panel
    };
  }
  pond.designer.on('open', () => {
    pond.designer.hold();   // measured 104ms of sprite painting, landing right on frame one of the move
    document.documentElement.classList.add('focus-journal');
    // An S-curve, not outCubic: leaning in over the page should start from a standstill. outCubic opens at
    // full speed, and a camera that is already moving on frame one reads as a lurch of the objects on it.
    camera.to(frame(), { duration: 900, ease: 'inOutCubic' })
      .then(() => pond.designer.changed(true));   // paint the fish once the page has arrived
  });
  pond.on('resize', () => { if (pond.designer.open) camera.to(frame(), { duration: 0 }); });
  pond.designer.on('close', () => {
    document.documentElement.classList.remove('focus-journal');
    // Back to the base fit, which is exactly panel 0 — the bookmark lives on the journal, so the editor can
    // only ever be opened from there. A null target is the resting view (js/site/camera.js toScreen).
    camera.to(null, { duration: 750, ease: 'inOutCubic' });
  });
}

start().catch((e) => { console.error('[site] failed to start', e); document.documentElement.classList.add('site-failed'); });
