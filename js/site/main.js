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
  const pond = HANDHELD ? null : await bootPond({
    canvas: $('#tank'), journalRoot: $('#journal-root'), root: document.body,
    assetsBase: '/assets/pond/', visitors: true, edit,
    panel: { root: document.body, setInsets: true, hotkeys: false },
  });
  const bookSpace = pond && createBookSpace($('#book-space'), pond);
  const camera = pond && createCamera(pond);
  const modal = createModal(document.body, { onClose: () => { const cur = router.current(); if (cur && cur.route.open === 'post') router.go('/blog', { replace: true }); } });
  const rail = createRail({ pond, camera, el: $('#rail'), track: $('#track'), handheld: HANDHELD });
  await rail.mount();
  const navigator = createNavigator({ pond, rail, handheld: HANDHELD, onPage: () => bookSpace && bookSpace.apply(), openPost: (slug) => modal.open('blog/' + slug, null, { reading: true }) });
  const router = createRouter({ onNavigate: (nav, meta) => navigator.navigate(nav, meta) });

  if (pond) {
    pond.on('camera', rail.apply);
    pond.on('resize', () => { rail.reseat(); navigator.pondByPan(); });
    rail.apply();
  }
  await (renderer ? renderer.ready : Promise.resolve());
  await router.start();
  // An edge push or an arrow key is a navigation like any other, so it goes through the router and the URL
  // keeps up. On a phone the panels are stacked and the page scrolls normally — no gestures to bind.
  if (!HANDHELD) rail.bindGestures((page) => { const r = ROUTES.find((x) => x.page === page); if (r) router.go(r.path); });

  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('[data-leave-fish]'); if (!t) return; e.preventDefault(); const b = document.getElementById('btn-leave'); if (b) b.click(); });
  if (pond) mountFishPage(pond, camera, bookSpace);
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

/** The fish editor is a page in the journal, not a card over it: park #designer on the right-hand page
 *  (photo px, straight from assets/pond/book/book.json) and ease the camera onto it while it is open.
 *  This is the rail's one *focus* move — the only time the camera does anything but pan. The strip fades out
 *  while it runs, so the panels never have to scale with the zoom, and the pan is restored on close.
 *  The lab (lab/boids-lab.html) has no #book-space, so it keeps the floating card in css/pond.css. */
function mountFishPage(pond, camera, bookSpace) {
  const el = document.getElementById('designer');
  if (!el) return;
  const r = (pond.book.D && pond.book.D.right) || [783, 26, 1384, 783];
  const [pw, ph] = [r[2] - r[0], r[3] - r[1]];
  el.removeAttribute('aria-modal');   // on the page it is a region you can read past, not a modal
  Object.assign(el.style, { left: r[0] + 'px', top: r[1] + 'px', width: pw + 'px', height: ph + 'px' });
  bookSpace.el.appendChild(el);

  /** The zoom that fits the page in the view with a margin — never below the resting view.
   *  GROW buys the page a little more of the screen than a plain margin fit would give it. */
  const GROW = 32;
  function pageZoom() {
    const s = pond.book.fit.s, sc = pond.school;
    const w = sc.cw - ((sc.insets && sc.insets.right) || 0);
    return Math.max(1, Math.min((w * 0.92 + GROW) / (pw * s), (sc.ch * 0.92 + GROW) / (ph * s)));
  }
  pond.designer.on('open', () => {
    pond.designer.hold();   // measured 104ms of sprite painting, landing right on frame one of the move
    document.documentElement.classList.add('focus-journal');   // the strip steps out of the way
    // An S-curve, not outCubic: leaning in over the page should start from a standstill. outCubic opens at
    // full speed, and a camera that is already moving on frame one reads as a lurch of the objects on it.
    // rot cancels the desk tilt, so the page comes up square to write on — and squaring it is also what
    // makes the framing land, since the tilt turns about the photo's centre, which at this zoom is off-screen.
    camera.to({ zoom: pageZoom(), cx: (r[0] + r[2]) / 2, cy: (r[1] + r[3]) / 2, rot: -pond.book.deskRot() },
              { duration: 900, ease: 'inOutCubic' })
      .then(() => pond.designer.changed(true));   // paint the fish once the page has arrived
  });
  pond.designer.on('close', () => {
    document.documentElement.classList.remove('focus-journal');
    // Back to the base fit, which is exactly panel 0 — the bookmark lives on the journal, so the editor can
    // only ever be opened from there. A null target is the resting view (js/site/camera.js toScreen).
    camera.to(null, { duration: 750, ease: 'inOutCubic' });
  });
}

start().catch((e) => { console.error('[site] failed to start', e); document.documentElement.classList.add('site-failed'); });
