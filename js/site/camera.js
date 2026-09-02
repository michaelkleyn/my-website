// The camera: where the journal sits on screen. Targets are authored in photo space — { zoom, cx, cy } means
// "photo point (cx, cy) at the centre of the view, this much bigger" — so they survive any viewport size.
// Tweens use anime.js v4 when it is on the page; otherwise they are instant.

export function createCamera(pond) {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let running = null;

  function area() {
    const sc = pond.school;
    return { w: sc.cw - ((sc.insets && sc.insets.right) || 0), h: sc.ch };
  }
  /** photo-space target → the pond's screen-space camera { zoom, x, y } */
  function toScreen(t) {
    if (!t) return { zoom: 1, x: 0, y: 0 };   // null target = the base fit (bookX/bookY/bookZoom place the book)
    const f = pond.book.fit, a = area();
    const zoom = t.zoom || 1, cx = t.cx != null ? t.cx : 768, cy = t.cy != null ? t.cy : 512;
    return { zoom, x: a.w / 2 - (f.x + cx * f.s) * zoom, y: a.h / 2 - (f.y + cy * f.s) * zoom };
  }

  /** Stop the running tween AND settle its promise. anime's cancel() never fires onComplete, so a bare
   *  cancel strands whoever awaited that move — and navigate.js awaits it while holding its `busy` latch,
   *  so one interrupted move (open the fish editor mid-navigation) would kill routing until reload. */
  function stop() { const r = running; running = null; if (!r) return; if (r.cancel) r.cancel(); if (r.settle) r.settle(); }

  /** Already there, to within a pixel? Then there is nothing to tween. */
  function near(a, b) { return Math.abs(a.zoom - b.zoom) < 1e-4 && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5; }

  function set(t) { stop(); pond.setCamera(toScreen(t)); }

  function to(t, o) {
    o = o || {};
    const target = toScreen(t), cam = pond.camera;
    if (reduced || o.duration === 0 || !window.anime || typeof window.anime.animate !== 'function') { set(t); return Promise.resolve(); }
    if (!running && near(target, cam)) return Promise.resolve();   // a route with no camera of its own: don't tween nothing
    stop();
    const state = { zoom: cam.zoom, x: cam.x, y: cam.y };
    return new Promise((resolve) => {
      const anim = window.anime.animate(state, {
        zoom: target.zoom, x: target.x, y: target.y,
        duration: o.duration || 700, ease: o.ease || 'inOutQuad',
        onUpdate: () => pond.setCamera(state),
        onComplete: () => { running = null; pond.setCamera(target); resolve(); },
      });
      anim.settle = resolve;
      running = anim;
    });
  }

  /** Slide the whole world sideways. The rail's panels are viewport-widths apart, which is a screen-space
   *  quantity — `to()` maps photo-space {zoom,cx,cy} targets and is the wrong shape for it. x moves alone:
   *  pond.setCamera only assigns the keys it is given, so zoom and y are left as they are. */
  function panTo(x, o) {
    o = o || {};
    const cam = pond.camera;
    if (reduced || o.duration === 0 || !window.anime || typeof window.anime.animate !== 'function') {
      stop(); pond.setCamera({ x }); return Promise.resolve();
    }
    if (!running && Math.abs(cam.x - x) < 0.5) return Promise.resolve();
    stop();
    const state = { x: cam.x };
    return new Promise((resolve) => {
      const anim = window.anime.animate(state, {
        x, duration: o.duration || 900, ease: o.ease || 'inOutCubic',
        onUpdate: () => pond.setCamera({ x: state.x }),
        onComplete: () => { running = null; pond.setCamera({ x: x }); resolve(); },
      });
      anim.settle = resolve;
      running = anim;
    });
  }

  return { to, set, panTo, toScreen, get current() { return pond.camera; } };
}

/** The camera target a scene declares for the current breakpoint. No camera — or an explicit null — means
 *  the base fit: the book sits where the pond config (bookX/bookY/bookZoom) puts it. */
export function cameraOf(scene, bucket) {
  const c = scene && scene.camera;
  if (!c) return null;
  for (const k of [bucket, 'desktop', 'tablet', 'mobile']) if (c[k] !== undefined) return c[k];
  return null;
}
