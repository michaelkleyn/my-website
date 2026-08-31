/**
 * Visitor "pick up and move" for scene items. Positions are session-only:
 * drags update the in-memory scene and restyle via sceneRenderer.setScene()
 * (fast path — structure unchanged), and are never written to the scene JSON,
 * so a reload or page switch puts everything back where the journal keeps it.
 *
 * Two ways in:
 *  - scene nodes flagged `"grab": true` are wired automatically (plain art
 *    with no interactive surface of its own)
 *  - window.sceneGrab.start(nodeId, pointerDownEvent) for items that manage
 *    their own surfaces (the iPod's rig calls this from its body layer)
 *
 * Inert in the layout-editor environment — the editor owns dragging there.
 */
(function () {
  'use strict';
  var sr = window.sceneRenderer;
  if (!sr) return;
  var EDIT = sr.isEditEnvironment();

  function nodeById(id) {
    var s = sr.getScene();
    var nodes = (s && s.nodes) || [];
    for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
    return null;
  }
  function clamp(v) { return Math.min(115, Math.max(-25, v)); }

  function start(id, e) {
    if (EDIT) return false;
    var node = nodeById(id);
    if (!node || !node.placements) return false;
    e.preventDefault();
    var target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    var nodeEl = document.querySelector('.scene-layer [data-node-id="' + id + '"]');
    if (nodeEl) nodeEl.classList.add('grabbed');
    var sx = e.clientX, sy = e.clientY;
    var p = node.placements;
    var orig = {};
    for (var b in p) orig[b] = { x: p[b].x || 0, y: p[b].y || 0 };
    var lx = sx, ly = sy, raf = null;

    function apply() {
      raf = null;
      // same % delta onto every breakpoint keyframe keeps fluid interpolation coherent
      var dx = sr.pxToPct(lx - sx, 'x', node);
      var dy = sr.pxToPct(ly - sy, 'y', node);
      for (var b in orig) {
        p[b].x = clamp(orig[b].x + dx);
        p[b].y = clamp(orig[b].y + dy);
      }
      sr.setScene(sr.getScene());
    }
    function move(ev) {
      lx = ev.clientX; ly = ev.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    }
    function up() {
      if (nodeEl) nodeEl.classList.remove('grabbed');
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    }
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    return true;
  }

  // auto-wire flagged nodes; re-run cheaply since renders rebuild elements
  function wire() {
    var s = sr.getScene();
    var nodes = (s && s.nodes) || [];
    nodes.forEach(function (n) {
      if (!n.grab || n.kind === 'content') return;
      var el = document.querySelector('.scene-layer [data-node-id="' + n.id + '"]');
      if (!el || el.__grabWired) return;
      el.__grabWired = true;
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'grab';
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', function (e) { start(n.id, e); });
    });
  }
  if (!EDIT) sr.ready.then(function () { wire(); setInterval(wire, 1000); });

  window.sceneGrab = { start: start };
})();
