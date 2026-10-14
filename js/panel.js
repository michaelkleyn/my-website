// The project panel's two small behaviours.
// 1. The panel's box is the frame: its content scrolls inside it and the bottom edge fades while there is more below (.more).
// 2. The recording rests as a halftone of its poster: the same dot screen as the panel tint (a fine grid at 15deg, ink dots),
//    here sized by the picture's darkness. Hover, focus or a tap resolves it to the video and plays it; leaving
//    puts the screen back. ?reveal=1 forces the revealed state. prefers-reduced-motion: the poster itself, no play.
(function () {
  var q = new URLSearchParams(location.search);

  var fold = document.querySelector('.panel .fold');
  // The panel's width glides open while the page parks, so the content re-wraps and its height changes along the way.
  // The fade must follow where it will settle, not where it passes: measure with any running layout transition
  // jumped to its end, then put each one back where it was (nothing paints in between).
  function more() {
    void fold.offsetHeight;   // flush style, so a transition just triggered by parking exists to be jumped
    var run = document.getAnimations().filter(function (a) { return a.transitionProperty && a.transitionProperty !== 'opacity' && a.playState === 'running'; });
    var at = run.map(function (a) { return a.currentTime; }), y = scrollY;
    run.forEach(function (a) { a.currentTime = a.effect.getComputedTiming().endTime; });
    var over = fold.scrollHeight - fold.scrollTop - fold.clientHeight > 2;
    run.forEach(function (a, i) { a.currentTime = at[i]; });
    // the jump laid the page out at its end (a phone's sheet shut), which clamped the page's scroll: put it back, or the page lurches when a sheet folds
    if (run.length && scrollY !== y) scrollTo({ top: y, behavior: 'instant' });
    fold.classList.toggle('more', over);
  }
  function soon() { more(); requestAnimationFrame(more); }   // at once (forced layout, settled geometry), and again after layout, before the next paint
  fold.addEventListener('scroll', more, { passive: true });
  addEventListener('resize', more); addEventListener('hashchange', soon);
  more(); requestAnimationFrame(more);
  // measure whenever the box or the open project changes size or visibility, and once everything has loaded,
  // so the fade shows only when the content really overflows
  var ro = new ResizeObserver(more); ro.observe(fold);
  fold.querySelectorAll('.proj').forEach(function (p) { ro.observe(p); new MutationObserver(more).observe(p, { attributes: true, attributeFilter: ['hidden'] }); });
  addEventListener('load', more);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(more);

  var still = matchMedia('(prefers-reduced-motion: reduce)'), forced = q.get('reveal') === '1';
  document.querySelectorAll('.rec').forEach(recording);   // one recording per project

  function recording(rec) {
    var video = rec.querySelector('video'), cv = rec.querySelector('canvas'), ctx = cv.getContext('2d');
    var img = new Image(), CELL = 4, INK = '29,74,158', dots = [], g = 1;
    img.onload = function () { (img.decode ? img.decode() : Promise.resolve()).then(draw, draw); }; img.src = video.getAttribute('poster');

    function draw() {
      var box = cv.parentNode, w = box.clientWidth, h = box.clientHeight;
      if (!w || !h || !img.complete) return;
      var dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var s = document.createElement('canvas'); s.width = w; s.height = h;   // the poster, covering the box, to read its darkness
      var sx = s.getContext('2d'), k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      sx.fillStyle = '#f6f3ec'; sx.fillRect(0, 0, w, h);
      sx.filter = 'blur(1.6px)';   // a dot reads the neighbourhood, not the pixel
      sx.drawImage(img, (w - img.naturalWidth * k) / 2, (h - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      var px = sx.getImageData(0, 0, w, h).data;
      dots = [];   // the screen's dots (x, y, radius at rest), kept so the enter can grow them
      var a = 15 * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), R = Math.hypot(w, h) / 2;
      for (var u = -R; u < R; u += CELL) for (var v = -R; v < R; v += CELL) {
        var x = w / 2 + u * c - v * sn, y = h / 2 + u * sn + v * c;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        var i = ((y | 0) * w + (x | 0)) * 4, dark = 1 - (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
        var r = Math.sqrt(Math.min(1, Math.max(0, dark - 0.07) * 4)) * CELL * 0.56;
        if (r < 0.3) continue;
        dots.push(x, y, r);
      }
      paint();
    }
    function paint() {   // the screen at growth g (1 at rest): every dot at g times its radius
      var w = cv.parentNode.clientWidth, h = cv.parentNode.clientHeight;
      ctx.fillStyle = '#f6f3ec'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgb(' + INK + ')';
      for (var k = 0; k < dots.length; k += 3) {
        var r = dots[k + 2] * g;
        if (r < 0.15) continue;
        ctx.beginPath(); ctx.arc(dots[k], dots[k + 1], r, 0, 6.2832); ctx.fill();
      }
    }
    // the content's entrance (js/enter.js): the window is held empty until its turn, then the dots grow from nothing
    var grow = null;
    rec.hold = function () { cancelAnimationFrame(grow); g = 0; paint(); };
    rec.develop = function (ms) {
      cancelAnimationFrame(grow); var t0 = performance.now();
      (function step(now) {
        var x = Math.min(1, (now - t0) / ms); g = 1 - (1 - x) * (1 - x); paint();
        if (x < 1) grow = requestAnimationFrame(step);
      })(t0);
    };
    rec.settle = function () { cancelAnimationFrame(grow); if (g !== 1) { g = 1; paint(); } };
    new ResizeObserver(draw).observe(cv.parentNode);   // a hidden panel measures 0 and draws when it shows

    function set(on) {
      if (still.matches) return;   // the poster only
      rec.classList.toggle('on', on || forced);
      if (on || forced) { video.preload = 'auto'; var p = video.play(); if (p && p.catch) p.catch(function () {}); }
      else video.pause();
    }
    rec.classList.toggle('still', still.matches);
    if (forced) set(true);
    rec.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') set(true); });
    rec.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') set(false); });
    rec.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') set(!rec.classList.contains('on')); });   // a tap on a phone
    rec.addEventListener('focus', function () { set(true); });
    rec.addEventListener('blur', function () { set(false); });
    addEventListener('hashchange', function () { if (!forced) set(false); });
  }
})();
