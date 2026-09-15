// The cursor: a soft coral dot that tightens into a bar over readable text. Drawn in the page so it can morph,
// and moved with a bare transform on its own layer so it trails the pointer by a frame at most.
(function () {
  if (!matchMedia('(hover: hover)').matches) return;
  var TEXT = 'h1, .lede, .prose p', el = document.createElement('div');
  var text = null, range = document.createRange(), knock = null;   // the text element under the pointer, and a range over its contents
  el.className = 'cursor hidden'; document.body.appendChild(el); document.documentElement.classList.add('has-cursor');

  // the bar only over the type itself, not the block around it: the range's client rects are the actual lines of text.
  // The gap between two lines of the same block counts as text too (bridged to the union of both lines' spans), so moving
  // down a paragraph doesn't flicker dot / bar / dot; past the end of a line, or out of the block, it drops at once.
  function overInk(x, y) {
    var rects = range.getClientRects(), prev = null;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      if (prev && r.top > prev.bottom && y > prev.bottom && y < r.top && x >= Math.min(prev.left, r.left) && x <= Math.max(prev.right, r.right)) return true;
      if (!prev || r.top >= prev.bottom) prev = r;   // one rect per line: keep the first rect of each line as the anchor
    }
    return false;
  }
  addEventListener('pointerover', function (e) {
    var t = e.target.closest(TEXT), link = e.target.closest('a');
    if (t && !link) { text = t; range.selectNodeContents(text); el.style.setProperty('--bar-h', parseFloat(getComputedStyle(text).fontSize) * 1.15 + 'px'); }
    else if (!link && e.target.closest('.prose') && text) { /* the gap between blocks of the prose: keep the last block's lines, so the bar can hold across it */ }
    else { text = null; el.classList.remove('bar'); }   // links keep the dot; off the prose entirely, drop the bar
    el.classList.toggle('big', !!e.target.closest('.name'));     // over the name the dot grows
    knock = e.target.closest('.name, .nav a');                    // over the name or a nav link, the letters under the dot turn paper (the ::after knockout)
    el.classList.toggle('soft', !!e.target.closest('.rows a'));   // inside a row link the dot softens into the row's halo
    el.classList.toggle('gone', !!e.target.closest('.hello'));    // inside the hello link the dot is gone: the box's halo is the cursor
  });
  var px = 0, py = 0, fx = 0, fy = 0, fvx = 0, fvy = 0, lastGap = 0, s = 0, sq = 0, plx = 0, ply = 0, last = 0;
  addEventListener('pointermove', function (e) {
    px = e.clientX; py = e.clientY;
    if (el.classList.contains('hidden')) { fx = px; fy = py; fvx = fvy = 0; }   // (re)entering the window: no lunge from wherever the follower was
    el.style.translate = px + 'px ' + py + 'px';
    el.classList.remove('hidden');
    if (knock) { var kr = knock.getBoundingClientRect(); knock.style.setProperty('--kx', (px - kr.left) + 'px'); knock.style.setProperty('--ky', (py - kr.top) + 'px'); }
    var bar = !!text && overInk(px, py);
    // between paragraphs the bar holds: leaving a block vertically keeps it if the pointer is still within the block's line span,
    // so a move down the prose never flickers. Past a line's end, or off into something that isn't text, it drops at once.
    if (!bar && el.classList.contains('bar') && text) {
      var rs = range.getClientRects(), first = rs[0], last = rs[rs.length - 1];
      if (first && (py < first.top || py > last.bottom) && px >= Math.min(first.left, last.left) && px <= Math.max(first.right, last.right)) bar = true;
    }
    el.classList.toggle('bar', bar);
  });
  // squash and stretch from a spring: a damped follower trails the pointer, and the gap between them is the strain.
  // Speeding up opens the gap (the dot stretches into an egg, round end forward); braking lets the follower catch up and
  // overshoot (the egg flips through round to a short one pointing ahead), then settle. A spring integrates the motion, so
  // unlike a measured acceleration it is smooth by construction and a hand's micro-jitter never reaches the shape.
  var K = 0.2, D = 0.8;   // stiffness and damping per frame; D just under 2*sqrt(K) gives a small, quick overshoot
  (function frame(now) {
    var dt = Math.min(2, Math.max(0.5, (now - last) / 16.7)) || 1; last = now;   // dt in frames
    fvx += ((px - fx) * K - fvx * D) * dt; fvy += ((py - fy) * K - fvy * D) * dt; fx += fvx * dt; fy += fvy * dt;
    // the nearest link pulls on the dot (window.linkPull from glow.js): a smoothed lean of up to 26px toward it, added to the
    // spring gap so the egg forms toward the link even when the pointer is still
    var P = window.linkPull || { x: 0, y: 0, n: 0 }; plx += (-P.x * P.n * 30 - plx) * 0.15 * dt; ply += (-P.y * P.n * 30 - ply) * 0.15 * dt;   // negated: the tail points at the link, the round head faces away
    var dx = px - fx + plx, dy = py - fy + ply, gap = Math.hypot(dx, dy), closing = (lastGap - gap) / dt; lastGap = gap;
    // strain: the spring gap (speed) on its own scale, plus the lean on its own, so the lean is a clear egg even when still
    var stretch = Math.max(0, Math.min(0.5, Math.hypot(px - fx, py - fy) / 160) - 0.03) + 0.3 * Math.min(1, Math.hypot(plx, ply) / 30);
    sq = Math.max(sq * Math.pow(0.85, dt), Math.min(0.3, (closing - 4) / 30));   // the gap closing fast is braking: a squash that peaks, then decays over ~10 frames
    s += Math.max(-0.12 * dt, Math.min(0.12 * dt, stretch - sq - s));   // slew-limited: a dead stop squashes over a few frames instead of popping
    var q = -0.4 * s;
    if (el.classList.contains('bar') || Math.abs(s) < 0.003) { el.style.scale = el.style.borderRadius = el.style.transform = ''; el.style.rotate = '0deg'; }
    else {
      // face the pointer's lead over the follower and elongate along it. Corner radii make the egg: a short horizontal radius
      // is a blunt end, a long one a taper, so the leading corners get the short radius. The widest point (the head) sits
      // t% of the length ahead of the box centre, so the box is shifted back by that much to keep the head on the pointer:
      // the tail then grows and retracts behind the head, and nothing shifts when the shape rounds off.
      var t = Math.max(0, s) / 0.5 * 20;   // % corner asymmetry; a braking squash stays a symmetric pancake
      el.style.rotate = Math.atan2(dy, dx) + 'rad';
      el.style.scale = (1 + s) + ' ' + (1 + q);
      el.style.borderRadius = (50 + t) + '% ' + (50 - t) + '% ' + (50 - t) + '% ' + (50 + t) + '% / 50%';
      el.style.transform = 'translate(-50%, -50%) translateX(' + (-0.3 * t) + 'px)';   // local px, before scale: t% of the 30px box
    }
    requestAnimationFrame(frame);
  })(0);
  document.documentElement.addEventListener('pointerleave', function () { el.classList.add('hidden'); });
})();
