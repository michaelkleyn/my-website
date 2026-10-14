// The project panel's content comes in after the frame, as ink laid down. Text can't be wiped by a moving edge (it
// reads as broken mid-glyph), so the reveal only ever shows whole letters, whole lines, whole blocks.
// A mask on the open project, one rectangle per line (and per rule, bullet, media window), measured from the text itself:
//   ?enter=ink (default)  block by block in reading order; each line laid down left to right along its baseline, one
//                         whole letter at a time; the media window's halftone develops, dots growing. About 600 ms in all.
//   ?enter=lines          one edge from the top down, snapped to line boxes: a line appears whole as the edge passes
//                         its bottom. Paced to the frame's descending stroke on the first open, about 400 ms on a switch.
// stage.js calls panelEnter.start(proj, elapsed): elapsed is ms since the frame began drawing (the first open), or null
// (a switch, or a reopen: the frame is already there, so the content comes at once). Reduced motion: nothing, all at once.
(function () {
  var q = new URLSearchParams(location.search), mode = q.get('enter') === 'lines' ? 'lines' : 'ink';
  var still = matchMedia('(prefers-reduced-motion: reduce)');
  var STROKE_END = 1900, RIGHT_AT = 780, RIGHT_MS = 320;   // the frame's clock (css): last edge done; the right edge's start and length
  var TOTAL = 600, LINE = 120, RULE = 120, MEDIA = 300;   // ink: the whole entrance, one line, one rule, the halftone developing
  var HIDE = 'linear-gradient(#000, #000)';
  var run = null;

  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeOut(x) { return 1 - (1 - x) * (1 - x); }

  // ---- measuring: every piece of the open project that must come in, in reading order ----
  function collect(proj) {
    var pr = proj.getBoundingClientRect(), units = [], cur = null, range = document.createRange(), prevBlock = null;
    function blockOf(el) { while (el.parentNode !== proj && !/^(OL|UL)$/.test(el.parentNode.tagName)) el = el.parentNode; return el; }
    function add(u, el) { u.block = blockOf(el); units.push(u); return u; }
    function box(el, kind, extra) {
      var r = el.getBoundingClientRect();
      return add({ kind: kind, x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height, rec: extra || null }, el);
    }
    function text(n) {
      if (!/\S/.test(n.data)) return;
      for (var i = 0; i < n.length; i++) {
        range.setStart(n, i); range.setEnd(n, i + 1);
        var r = range.getClientRects()[0];
        if (!r || r.width < 0.5) continue;
        var cy = (r.top + r.bottom) / 2;
        var owner = n.parentNode.closest('li, p, h1, h2, figcaption, header');
        if (!cur || owner !== cur.owner || cy < cur.t - 1 || cy > cur.b + 1 || r.left < cur.right - 2) {
          cur = add({ kind: 'line', t: r.top, b: r.bottom, l: r.left, right: r.right, edges: [], node: n, owner: owner }, n.parentNode);
        }
        cur.t = Math.min(cur.t, r.top); cur.b = Math.max(cur.b, r.bottom); cur.right = r.right;
        cur.edges.push(r.right - pr.left);
      }
    }
    function walk(n) {
      if (n.nodeType === 3) { text(n); return; }
      if (n.nodeType !== 1) return;
      var cs = getComputedStyle(n);
      if (cs.display === 'none') return;
      if (n.matches('.view')) { box(n, 'media', n.closest('.rec')); cur = null; return; }
      if (n.matches('iframe, img, svg')) { box(n, 'block'); cur = null; return; }
      if (n.matches('video, canvas, script, style')) return;
      if (n.tagName === 'LI') {
        var r = n.getBoundingClientRect(), bt = parseFloat(cs.borderTopWidth) || 0, ps = getComputedStyle(n, '::before');
        if (bt) add({ kind: 'rule', x: r.left - pr.left, y: r.top - pr.top - 1, w: r.width, h: bt + 2 }, n);
        if (ps.content !== 'none' && ps.position === 'absolute' && parseFloat(ps.width) > 0)
          add({ kind: 'bullet', x: r.left - pr.left + parseFloat(ps.left) - 1, y: r.top - pr.top + parseFloat(ps.top) - 1, w: parseFloat(ps.width) + 2, h: parseFloat(ps.height) + 2 }, n);
      }
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (/^(P|H1|H2|LI|FIGCAPTION)$/.test(n.tagName)) cur = null;
    }
    walk(proj);
    units.forEach(function (u) {
      if (u.kind !== 'line') return;
      u.x = u.l - pr.left - 1.5; u.y = u.t - pr.top - 1; u.h = u.b - u.t + 2; u.w = u.edges[u.edges.length - 1] - u.x + 3;
    });
    return { units: units, width: pr.width, height: pr.height };
  }

  // ---- ink: the schedule ----
  function plan(units) {
    var pos = 0, prev = null;
    units.forEach(function (u) {
      if (prev && prev.block !== u.block) pos += 0.6;   // a beat between blocks
      u.pos = pos;
      u.dur = u.kind === 'line' ? LINE : u.kind === 'rule' ? RULE : u.kind === 'media' ? MEDIA : 0;
      pos += u.kind === 'line' ? 1 : u.kind === 'media' ? 2 : u.kind === 'block' ? 1 : 0;   // rules and bullets go with their line
      prev = u;
    });
    var G = Infinity;
    units.forEach(function (u) { if (u.pos > 0) G = Math.min(G, (TOTAL - u.dur) / u.pos); });
    if (!isFinite(G)) G = 0;
    units.forEach(function (u) { u.s = u.pos * G; });
  }

  function size(u, t) {   // the rectangle's current size, in px
    if (mode === 'lines') return u.on ? [u.w, u.h] : [0, 0];
    var p = clamp((t - u.s) / (u.dur || 1));
    if (t < u.s) return [0, 0];
    if (u.kind === 'line') {
      var n = u.edges.length, k = Math.round(easeOut(p) * n);   // whole letters only
      return [k >= n ? u.w : k ? u.edges[k - 1] - u.x : 0, u.h];
    }
    if (u.kind === 'rule') return [u.w * easeOut(p), u.h];
    return [u.w, u.h];
  }

  function clear(r) {
    cancelAnimationFrame(r.raf); clearTimeout(r.timer); clearTimeout(r.dog);
    var s = r.proj.style; s.maskImage = s.maskSize = s.maskPosition = s.maskRepeat = '';
    r.proj.querySelectorAll('.rec').forEach(function (rec) { if (rec.settle) rec.settle(); });
  }
  function cancel() { if (run) { clear(run); run = null; } }

  function start(proj, elapsed) {
    cancel();
    if (still.matches) return;
    var r = run = { proj: proj, raf: 0, timer: 0 }, s = proj.style;
    s.maskImage = HIDE; s.maskSize = '0 0'; s.maskPosition = '0 0'; s.maskRepeat = 'no-repeat';   // nothing before its moment
    proj.querySelectorAll('.rec').forEach(function (rec) { if (rec.hold) rec.hold(); });
    var first = elapsed != null, delay, span;
    if (mode === 'ink') delay = first ? Math.max(0, STROKE_END - elapsed) : 0;
    else { delay = first ? Math.max(0, RIGHT_AT - elapsed) : 0; span = first ? Math.max(120, Math.min(RIGHT_MS, RIGHT_AT + RIGHT_MS - elapsed)) : 400; }
    function go() {
      var m = collect(proj), units = m.units, N = units.length, t0 = performance.now(), last = '', fold = proj.closest('.fold');
      if (!N) { clear(r); run = null; return; }
      if (mode === 'ink') plan(units);
      else {
        var H = Math.min(m.height, matchMedia('(max-width: 960px)').matches ? m.height : fold.clientHeight);
        units.forEach(function (u) { if (u.kind === 'line') { u.x = 0; u.w = m.width; } u.bottom = u.y + u.h - 1; });
      }
      s.maskImage = units.map(function () { return HIDE; }).join(',');
      s.maskPosition = units.map(function (u) { return u.x.toFixed(2) + 'px ' + u.y.toFixed(2) + 'px'; }).join(',');
      s.maskRepeat = 'no-repeat';
      var ro = new ResizeObserver(function () { if (Math.abs(proj.getBoundingClientRect().width - m.width) > 1) finish(); });   // a re-wrap invalidates the measure: show all
      ro.observe(proj);
      function finish() { ro.disconnect(); clear(r); if (run === r) run = null; }
      function frame(now) {
        var t = now - t0, end;
        if (mode === 'ink') {
          end = t >= TOTAL;
          units.forEach(function (u) { if (u.kind === 'media' && u.rec && !u.started && t >= u.s) { u.started = true; u.rec.develop(MEDIA); } });
        } else {
          var e = easeOut(clamp(t / span)) * H;
          end = t >= span;
          units.forEach(function (u) {
            u.on = end || u.bottom <= e + 0.5;
            if (u.on && u.kind === 'media' && u.rec && !u.started) { u.started = true; u.rec.develop(MEDIA); }
          });
        }
        var sizes = units.map(function (u) { var z = size(u, t); return z[0].toFixed(2) + 'px ' + z[1].toFixed(2) + 'px'; }).join(',');
        if (sizes !== last) { s.maskSize = sizes; last = sizes; }
        if (end) { if (run === r) { r.timer = setTimeout(finish, mode === "ink" ? 40 : MEDIA + 40); } return; }   // let the last halftone finish developing, then drop the mask
        r.raf = requestAnimationFrame(frame);
      }
      r.dog = setTimeout(finish, (mode === 'ink' ? TOTAL : span) + MEDIA + 500);   // whatever happens, the mask comes off
      r.raf = requestAnimationFrame(frame);
    }
    if (delay) r.timer = setTimeout(go, delay); else go();
  }

  window.panelEnter = { start: start, cancel: cancel, mode: mode };
})();
