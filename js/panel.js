// The project panel's two small behaviours.
// 1. The panel's box is the frame: its content scrolls inside it and the bottom edge fades while there is more below (.more).
// 2. The recording rests as a halftone of its poster: the same dot screen as the panel tint (a fine grid at 15deg, ink dots),
//    here sized by the picture's darkness. Hover, focus or a tap resolves it to the video and plays it; leaving
//    puts the screen back. ?reveal=1 forces the revealed state. prefers-reduced-motion: the poster itself, no play.
(function () {
  var q = new URLSearchParams(location.search);

  var fold = document.querySelector('.panel .fold');
  function more() { fold.classList.toggle('more', fold.scrollHeight - fold.scrollTop - fold.clientHeight > 2); }
  fold.addEventListener('scroll', more, { passive: true });
  addEventListener('resize', more); addEventListener('hashchange', function () { setTimeout(more, 50); });
  setTimeout(more, 300);

  var rec = document.querySelector('.rec'); if (!rec) return;
  var video = rec.querySelector('video'), cv = rec.querySelector('canvas'), ctx = cv.getContext('2d');
  var still = matchMedia('(prefers-reduced-motion: reduce)'), forced = q.get('reveal') === '1';
  var img = new Image(), CELL = 4, INK = '29,74,158';
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
    ctx.fillStyle = '#f6f3ec'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgb(' + INK + ')';
    var a = 15 * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), R = Math.hypot(w, h) / 2;
    for (var u = -R; u < R; u += CELL) for (var v = -R; v < R; v += CELL) {
      var x = w / 2 + u * c - v * sn, y = h / 2 + u * sn + v * c;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      var i = ((y | 0) * w + (x | 0)) * 4, dark = 1 - (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
      var r = Math.sqrt(Math.min(1, Math.max(0, dark - 0.07) * 4)) * CELL * 0.56;
      if (r < 0.3) continue;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
  }
  new ResizeObserver(draw).observe(cv.parentNode);

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
})();
