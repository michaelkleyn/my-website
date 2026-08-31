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

  function set(t) { running && running.cancel && running.cancel(); running = null; pond.setCamera(toScreen(t)); }

  function to(t, o) {
    o = o || {};
    const target = toScreen(t), cam = pond.camera;
    if (reduced || o.duration === 0 || !window.anime || typeof window.anime.animate !== 'function') { set(t); return Promise.resolve(); }
    if (running && running.cancel) running.cancel();
    const state = { zoom: cam.zoom, x: cam.x, y: cam.y };
    return new Promise((resolve) => {
      running = window.anime.animate(state, {
        zoom: target.zoom, x: target.x, y: target.y,
        duration: o.duration || 700, ease: o.ease || 'inOutQuad',
        onUpdate: () => pond.setCamera(state),
        onComplete: () => { running = null; pond.setCamera(target); resolve(); },
      });
    });
  }

  return { to, set, toScreen, get current() { return pond.camera; } };
}

/** The camera target a scene declares for the current breakpoint. No camera — or an explicit null — means
 *  the base fit: the book sits where the pond config (bookX/bookY/bookZoom) puts it. */
export function cameraOf(scene, bucket) {
  const c = scene && scene.camera;
  if (!c) return null;
  for (const k of [bucket, 'desktop', 'tablet', 'mobile']) if (c[k] !== undefined) return c[k];
  return null;
}
