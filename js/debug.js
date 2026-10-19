// ?debug=1 only: a small fixed text overlay, the measurement channel for devices that can only be screenshotted. Loads before glow.js so its counters see every event.
(function () {
  if (!/[?&]debug=1/.test(location.search)) return;
  var ev = ['pointermove', 'pointerover', 'pointerenter', 'mousemove', 'mouseover', 'touchstart'], count = {}, types = {};
  ev.forEach(function (n) { count[n] = 0; types[n] = {}; document.addEventListener(n, function (e) { count[n]++; types[n][e.pointerType || '-'] = 1; }, true); });
  var el = document.createElement('pre');
  el.style.cssText = 'position:fixed;left:0;top:60px;max-width:100vw;box-sizing:border-box;z-index:99999;margin:0;padding:4px;font:10px/1.2 monospace;color:#0f0;background:rgba(0,0,0,.85);pointer-events:none;white-space:pre-wrap;word-break:break-all';
  document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(el); });
  function mm(q) { return matchMedia(q).matches ? 1 : 0; }
  function draw() {
    var t = 'hover:hover ' + mm('(hover: hover)') + ' hover:none ' + mm('(hover: none)') + ' coarse ' + mm('(pointer: coarse)') + ' fine ' + mm('(pointer: fine)') +
      '\npointed ' + (document.documentElement.classList.contains('pointed') ? 1 : 0) + '\n' +
      ev.map(function (n) { return n + ' ' + count[n] + (count[n] ? '(' + Object.keys(types[n]).join(',') + ')' : ''); }).join(' ');
    var gl = document.querySelectorAll('.rows a .glow');
    t += '\nglows ' + gl.length;
    Array.prototype.forEach.call(document.querySelectorAll('.rows a'), function (a, i) {
      var g = a.querySelector('.glow'), o = a.querySelector('.goo');
      if (!g) { t += '\nrow' + i + ' no .glow'; return; }
      var cs = getComputedStyle(g), co = getComputedStyle(o), v = function (s, p) { return (s.getPropertyValue(p) || '-').trim(); };
      t += '\nrow' + i + ' vis ' + cs.visibility + ' op ' + co.opacity + ' mx ' + v(o.style, '--mx') + ' my ' + v(o.style, '--my') + ' ring ' + v(o.style, '--ring-o') + ' near ' + v(o.style, '--near');
    });
    el.textContent = t;
  }
  setInterval(draw, 250);
})();
