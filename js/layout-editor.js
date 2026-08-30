/**
 * Layout Compositor — local-only WYSIWYG editor (Agent C, MVP).
 *
 * ES MODULE. Dynamically imported by js/scene-renderer.js ONLY when
 * window.sceneRenderer.isEditEnvironment() is true (localhost / *.local / ?edit).
 * NEVER fetched in production.
 *
 * Talks to the page exclusively through the window.sceneRenderer global API:
 *   - getScene() / setScene(scene)  -> read + live-preview the scene
 *   - pxToPct(px, axis)             -> convert drag/resize deltas to % per bucket
 *   - activeBreakpoint()            -> which bucket we edit ('mobile'|'tablet'|'desktop')
 *   - pageKey()                     -> save target
 *   - relayout()                    -> re-resolve element-anchored nodes
 * and to the dev server (same-origin) for persistence:
 *   - GET  /__editor/ping           -> availability probe
 *   - POST /__editor/scene/<page>   -> persist the scene JSON
 *
 * Node elements rendered by the renderer carry data-node-id=<id>; we read their
 * live getBoundingClientRect() to draw selection chrome, and we mutate the
 * node's placement for the ACTIVE breakpoint, then call setScene() for preview.
 */

import * as THREE from 'three'; // only for sampling the flight-path curve (WYSIWYG preview)

const CSS_HREF = '/css/layout-editor.css';
const PING_URL = '/__editor/ping';
const MAX_HISTORY = 100;
const BUCKETS = ['mobile', 'tablet', 'desktop'];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== null && v !== undefined) {
      node.setAttribute(k, v);
    }
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Default placement used when a node has no placement for a bucket yet.
function defaultPlacement() {
  return {
    x: 0, y: 0, w: 20, rot: 0, opacity: 1, flipX: false, hidden: false,
  };
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

class LayoutEditor {
  constructor(renderer) {
    this.r = renderer;
    this.scene = null;          // working copy (we own it; we push via setScene)
    this.selectedId = null;
    this.editBucket = this.r.activeBreakpoint();
    this.serverOnline = false;
    this.dirty = false;

    // history
    this.undoStack = [];
    this.redoStack = [];

    // interaction state
    this.gesture = null;        // { type, ... } during drag/resize/rotate
    this.cleanPreview = false;  // Tab toggles editor-chrome visibility

    // dom refs
    this.root = null;
    this.overlay = null;        // selection/handle layer (pointer transparent except handles)
    this.layerList = null;
    this.inspector = null;
    this.statusEl = null;
    this.saveBtn = null;
  }

  // ----- bootstrap ---------------------------------------------------------

  async init() {
    injectStylesheet();
    this.scene = clone(this.r.getScene());
    this.serverOnline = await pingServer();
    this.buildChrome();
    this.refreshAll();
    this.bindGlobalKeys();
    this.bindResync();
  }

  // ----- scene access ------------------------------------------------------

  nodeById(id) {
    return this.scene.nodes.find((n) => n.id === id) || null;
  }

  // Placement for the bucket currently being edited; create from default if absent.
  placementFor(node, bucket = this.editBucket) {
    if (!node.placements) node.placements = {};
    if (!node.placements[bucket]) {
      // seed from any existing bucket (prefer desktop base) so editing one bucket
      // doesn't start from zero when others are defined.
      const seed = node.placements.desktop
        || node.placements[BUCKETS.find((b) => node.placements[b])]
        || defaultPlacement();
      node.placements[bucket] = clone(seed);
    }
    return node.placements[bucket];
  }

  // Push the working scene to the renderer for live preview.
  preview() {
    this.r.setScene(clone(this.scene));
    // Renderer rebuilds .scene-layer; reposition chrome on next frame.
    requestAnimationFrame(() => this.positionChrome());
  }

  // ----- history -----------------------------------------------------------

  snapshot() {
    this.undoStack.push(clone(this.scene));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.markDirty();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(clone(this.scene));
    this.scene = this.undoStack.pop();
    this.afterHistory();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(clone(this.scene));
    this.scene = this.redoStack.pop();
    this.afterHistory();
  }

  afterHistory() {
    if (this.selectedId && !this.nodeById(this.selectedId)) this.selectedId = null;
    this.markDirty();
    this.r.setScene(clone(this.scene));
    requestAnimationFrame(() => this.refreshAll());
  }

  markDirty() {
    this.dirty = true;
    this.renderStatus();
  }

  // ----- selection ---------------------------------------------------------

  select(id) {
    // Leaving the path-edit node? tear down path-edit (and its window listener)
    // so it can't keep editing a node that's no longer selected.
    if (this.pathEdit && this.pathEdit.nodeId !== id) {
      if (this._pathClick) { window.removeEventListener('mousedown', this._pathClick); this._pathClick = null; }
      this.pathEdit = null;
    }
    this.selectedId = id;
    // Pin ASCII creatures visible while selected so they can be placed even when
    // their cycle would otherwise have them off-screen; unpin for other kinds.
    const node = this.nodeById(id);
    if (node && node.kind === 'ascii' && this.r.pinNode) this.r.pinNode(id);
    else if (this.r.unpinNode) this.r.unpinNode();
    this.refreshAll();
  }

  clearSelection() {
    if (this.pathEdit) {
      if (this._pathClick) { window.removeEventListener('mousedown', this._pathClick); this._pathClick = null; }
      this.pathEdit = null;
    }
    this.selectedId = null;
    if (this.r.unpinNode) this.r.unpinNode();
    this.refreshAll();
  }

  // The renderer-rendered DOM element for a node (carries data-node-id).
  domFor(id) {
    // Content nodes aren't drawn in .scene-layer — their DOM is the existing
    // element matched by `target`, which has no data-node-id.
    const node = this.nodeById(id);
    if (node && node.kind === 'content' && node.target) {
      return document.querySelector(node.target);
    }
    return document.querySelector(`.scene-layer [data-node-id="${cssEscape(id)}"]`)
      || document.querySelector(`[data-node-id="${cssEscape(id)}"]`);
  }

  // ----- chrome (panels + overlay) ----------------------------------------

  buildChrome() {
    this.root = el('div', { id: 'le-root' });

    // --- toolbar ---
    const bucketBtns = BUCKETS.map((b) =>
      el('button', {
        class: 'le-bucket',
        'data-bucket': b,
        text: b,
        onClick: () => this.setBucket(b),
      })
    );
    this.bucketBtns = bucketBtns;

    this.saveBtn = el('button', {
      class: 'le-btn le-save',
      text: 'Save',
      onClick: () => this.save(),
    });

    // Smooth scaling = fluid interpolation between breakpoints (default on).
    this.smoothBtn = el('button', {
      class: 'le-btn le-smooth',
      title: 'Smoothly scale between breakpoints instead of snapping',
      text: 'Smooth',
      onClick: () => this.toggleSmooth(),
    });

    this.statusEl = el('span', { class: 'le-status' });

    const toolbar = el('div', { class: 'le-toolbar' }, [
      el('span', { class: 'le-brand', text: 'compositor' }),
      el('span', { class: 'le-page', text: this.r.pageKey() }),
      el('span', { class: 'le-sep' }),
      el('span', { class: 'le-tlabel', text: 'bucket' }),
      ...bucketBtns,
      el('span', { class: 'le-sep' }),
      this.smoothBtn,
      el('span', { class: 'le-sep' }),
      el('button', { class: 'le-btn', text: 'Undo', onClick: () => this.undo() }),
      el('button', { class: 'le-btn', text: 'Redo', onClick: () => this.redo() }),
      el('span', { class: 'le-sep' }),
      this.saveBtn,
      this.statusEl,
      el('span', { class: 'le-spacer' }),
      el('span', { class: 'le-hint', text: 'Tab: preview · Esc: deselect · arrows: nudge' }),
    ]);

    // --- layer list (left) ---
    this.layerList = el('div', { class: 'le-list' });
    const left = el('aside', { class: 'le-panel le-left' }, [
      el('div', { class: 'le-panel-title', text: 'layers' }),
      this.layerList,
    ]);

    // --- inspector (right) ---
    this.inspector = el('div', { class: 'le-inspect-body' });
    const right = el('aside', { class: 'le-panel le-right' }, [
      el('div', { class: 'le-panel-title', text: 'inspector' }),
      this.inspector,
    ]);

    // --- overlay (capture + handles) ---
    this.overlay = el('div', { class: 'le-overlay' });
    // Click on empty overlay = deselect; clicks that hit a node get routed in
    // pointerdown handler below.
    this.overlay.addEventListener('mousedown', (e) => this.onOverlayDown(e));

    this.root.append(toolbar, left, right, this.overlay);
    document.body.appendChild(this.root);

    if (!this.serverOnline) {
      this.root.classList.add('le-offline');
    }
  }

  setBucket(b) {
    this.editBucket = b;
    this.refreshAll();
  }

  // Toggle fluid interpolation for the whole scene. Default is on (fluid),
  // so the stored flag is only written when turning it off.
  toggleSmooth() {
    this.snapshot();
    const isFluid = this.scene.fluid !== false;
    this.scene.fluid = !isFluid; // flip
    this.preview();
    this.refreshAll();
  }

  // ----- overlay interaction ----------------------------------------------

  // Hit-test the scene nodes under the pointer (topmost by z wins). We can't use
  // elementsFromPoint here because scene nodes are pointer-events:none — they are
  // invisible to that API — so test each node's bounding rect geometrically.
  // Content nodes are excluded so clicking page text doesn't hijack it; they stay
  // selectable via the layer list and draggable once selected.
  hitTest(clientX, clientY) {
    let bestId = null;
    let bestZ = -Infinity;
    for (const node of this.scene.nodes) {
      if (node.kind === 'content') continue;
      const dom = this.domFor(node.id);
      if (!dom) continue;
      const cs = getComputedStyle(dom);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = dom.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        const z = typeof node.z === 'number' ? node.z : 0;
        if (z >= bestZ) { bestZ = z; bestId = node.id; }
      }
    }
    return bestId;
  }

  onOverlayDown(e) {
    if (this.cleanPreview) return;
    if (this.pathEdit) return; // path-edit owns clicks (add/move points), not node selection
    // Handles sit on top and handle their own mousedown (stopPropagation).
    // If a node is already selected and the press lands inside its box, move it.
    // This is what lets content nodes (selected via the layer list) be dragged,
    // since they have no data-node-id to hit-test by content.
    if (this.selectedId) {
      const dom = this.domFor(this.selectedId);
      if (dom) {
        const r = dom.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          this.beginMove(e);
          return;
        }
      }
    }
    const id = this.hitTest(e.clientX, e.clientY);
    if (!id) {
      this.clearSelection();
      return;
    }
    this.select(id);
    // Begin a move gesture on the freshly selected node body.
    this.beginMove(e);
  }

  beginMove(e) {
    const node = this.nodeById(this.selectedId);
    if (!node) return;
    const p = this.placementFor(node);
    this.gesture = {
      type: 'move',
      startX: e.clientX,
      startY: e.clientY,
      px: p.x,
      py: p.y,
      moved: false,
    };
    this.attachGestureListeners();
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  beginResize(e, dir) {
    e.stopPropagation();
    const node = this.nodeById(this.selectedId);
    if (!node) return;
    const dom = this.domFor(node.id);
    const rect = dom ? dom.getBoundingClientRect() : null;
    const p = this.placementFor(node);
    this.gesture = {
      type: 'resize',
      dir, // one of n,s,e,w,ne,nw,se,sw
      startX: e.clientX,
      startY: e.clientY,
      px: p.x,
      py: p.y,
      pw: p.w,
      ph: p.h, // may be undefined for images
      // pixel geometry at gesture start (for aspect math)
      rectW: rect ? rect.width : 0,
      rectH: rect ? rect.height : 0,
      natRatio: node.natW && node.natH ? node.natH / node.natW : null,
      // splat-butterfly renders full-viewport, so the box doesn't size it —
      // resizing maps to config.scale instead (see applyResize).
      startScale: (node.config && node.config.scale != null) ? node.config.scale : 1,
      moved: false,
    };
    this.attachGestureListeners();
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  beginRotate(e) {
    e.stopPropagation();
    const node = this.nodeById(this.selectedId);
    if (!node) return;
    const dom = this.domFor(node.id);
    const rect = dom ? dom.getBoundingClientRect() : this.overlay.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const p = this.placementFor(node);
    this.gesture = {
      type: 'rotate',
      cx,
      cy,
      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI,
      startRot: p.rot || 0,
      moved: false,
    };
    this.attachGestureListeners();
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  attachGestureListeners() {
    // Capture the pre-gesture scene exactly once so the whole drag coalesces
    // into a single undo entry (see onGestureUp).
    this._preGesture = clone(this.scene);
    this._onMove = (e) => this.onGestureMove(e);
    this._onUp = (e) => this.onGestureUp(e);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
  }

  detachGestureListeners() {
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    this._onMove = this._onUp = null;
  }

  onGestureMove(e) {
    const g = this.gesture;
    if (!g) return;
    const node = this.nodeById(this.selectedId);
    if (!node) return;
    const p = this.placementFor(node);
    g.moved = true;

    if (g.type === 'move') {
      const dxPct = this.r.pxToPct(e.clientX - g.startX, 'x', node);
      const dyPct = this.r.pxToPct(e.clientY - g.startY, 'y', node);
      p.x = round2(g.px + dxPct);
      p.y = round2(g.py + dyPct);
    } else if (g.type === 'resize') {
      this.applyResize(g, p, e);
    } else if (g.type === 'rotate') {
      let ang = Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * 180 / Math.PI;
      let rot = g.startRot + (ang - g.startAngle);
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      p.rot = round2(((rot % 360) + 360) % 360);
    }

    this.preview();
    this.renderInspectorValues();
  }

  applyResize(g, p, e) {
    const node = this.nodeById(this.selectedId);
    const dxPct = this.r.pxToPct(e.clientX - g.startX, 'w', node);
    // y/h deltas are relative to the node's space (viewport, or the book host)
    const dyPctH = this.r.pxToPct(e.clientY - g.startY, 'h', node);
    const dxPctX = this.r.pxToPct(e.clientX - g.startX, 'x', node);
    const dyPctY = this.r.pxToPct(e.clientY - g.startY, 'y', node);
    const dir = g.dir;
    const lockAspect = e.shiftKey;

    let w = g.pw;
    let h = g.ph;
    let x = g.px;
    let y = g.py;

    // East/west edges change width (and x when dragging the west side).
    if (dir.includes('e')) {
      w = Math.max(0.5, g.pw + dxPct);
    } else if (dir.includes('w')) {
      w = Math.max(0.5, g.pw - dxPct);
      x = g.px + dxPctX;
    }

    // North/south edges change height (only meaningful if h is explicit OR locking).
    const hadH = typeof g.ph === 'number';
    if (lockAspect && g.natRatio != null) {
      // Width drives height via natural ratio, expressed in vh.
      // h(vh) derived from w(vw): pixel height = pixelWidth * ratio.
      const pxW = this.r.pctToPx(w, 'w', node);
      const pxH = pxW * g.natRatio;
      h = round2(this.r.pxToPct(pxH, 'h', node));
    } else if (hadH) {
      if (dir.includes('s')) {
        h = Math.max(0.5, g.ph + dyPctH);
      } else if (dir.includes('n')) {
        h = Math.max(0.5, g.ph - dyPctH);
        y = g.py + dyPctY;
      }
    }

    p.w = round2(w);
    if (typeof h === 'number') p.h = round2(h);
    p.x = round2(x);
    p.y = round2(y);

    // splat-butterfly is full-viewport: the box w/h doesn't drive its render
    // size, config.scale does. Map the resize into config.scale so dragging the
    // handles grows/shrinks the butterfly live. (config.scale stays out of the
    // writePathPoints box-fit, so a later path edit won't reset it.)
    if (node && node.component === 'splat-butterfly') {
      const fw = g.pw ? w / g.pw : 1;
      const fh = (typeof g.ph === 'number' && g.ph) ? h / g.ph : fw;
      const factor = Math.sqrt(Math.max(0.01, fw) * Math.max(0.01, fh));
      const base = g.startScale != null ? g.startScale : 1;
      node.config = node.config || {};
      node.config.scale = clamp(round2(base * factor), 0.05, 20);
    }
  }

  onGestureUp() {
    const g = this.gesture;
    this.detachGestureListeners();
    document.body.style.userSelect = '';
    this.gesture = null;
    // Coalesce the whole drag into ONE undo entry: push the scene snapshot we
    // captured at gesture start (this._preGesture). Intermediate preview()
    // calls during the drag never touched history, so undo jumps straight back
    // to the pre-drag state. If nothing actually moved, discard the snapshot.
    if (g && g.moved && this._preGesture) {
      this.undoStack.push(this._preGesture);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack.length = 0;
      this.markDirty();
    }
    this._preGesture = null;
    this.refreshAll();
  }

  // ----- chrome rendering --------------------------------------------------

  /** The renderer switched pages (SPA navigation): edit what is on screen now, with a clean history. */
  reloadFromRenderer() {
    if (this.dirty && !window.confirm('Discard unsaved layout changes on the previous page?')) { /* keep editing the stale copy */ }
    this.scene = clone(this.r.getScene());
    this.undoStack = []; this.redoStack = []; this.selectedId = null; this.dirty = false;
    const label = document.querySelector('.le-page'); if (label) label.textContent = this.r.pageKey();
    this.refreshAll();
  }

  refreshAll() {
    this.renderBucketButtons();
    if (this.smoothBtn) {
      this.smoothBtn.classList.toggle('active', this.scene.fluid !== false);
    }
    this.renderLayerList();
    this.renderInspector();
    this.renderStatus();
    this.positionChrome();
  }

  renderBucketButtons() {
    this.bucketBtns.forEach((b) => {
      b.classList.toggle('active', b.dataset.bucket === this.editBucket);
    });
  }

  renderStatus() {
    let txt;
    if (!this.serverOnline) txt = 'no dev server — run npm run dev';
    else if (this.dirty) txt = 'unsaved changes';
    else txt = 'saved';
    this.statusEl.textContent = txt;
    this.statusEl.className = 'le-status'
      + (!this.serverOnline ? ' le-status-warn' : this.dirty ? ' le-status-dirty' : ' le-status-clean');
    this.saveBtn.textContent = this.serverOnline ? 'Save' : 'Download JSON';
  }

  renderLayerList() {
    this.layerList.innerHTML = '';
    // Reflect z-order: highest z at the top of the list.
    const ordered = [...this.scene.nodes].sort((a, b) => (b.z || 0) - (a.z || 0));
    for (const node of ordered) {
      const p = node.placements && node.placements[this.editBucket];
      const hidden = p ? !!p.hidden : false;
      const row = el('div', {
        class: 'le-row' + (node.id === this.selectedId ? ' selected' : ''),
        onClick: () => this.select(node.id),
      }, [
        el('button', {
          class: 'le-eye' + (hidden ? ' off' : ''),
          title: hidden ? 'show' : 'hide',
          text: hidden ? '◌' : '◉',
          onClick: (e) => { e.stopPropagation(); this.toggleHidden(node.id); },
        }),
        el('span', { class: 'le-row-name', text: node.name || node.id }),
        el('span', { class: 'le-row-kind', text: node.kind }),
      ]);
      this.layerList.appendChild(row);
    }
    if (!ordered.length) {
      this.layerList.appendChild(el('div', { class: 'le-empty', text: 'no nodes in scene' }));
    }
  }

  toggleHidden(id) {
    const node = this.nodeById(id);
    if (!node) return;
    this.snapshot();
    const p = this.placementFor(node);
    p.hidden = !p.hidden;
    this.preview();
    this.refreshAll();
  }

  renderInspector() {
    this.inspector.innerHTML = '';
    const node = this.selectedId ? this.nodeById(this.selectedId) : null;
    if (!node) {
      this.inspector.appendChild(el('div', { class: 'le-empty', text: 'nothing selected' }));
      return;
    }
    const p = this.placementFor(node);

    this.inspector.appendChild(el('div', { class: 'le-insp-head' }, [
      el('div', { class: 'le-insp-name', text: node.name || node.id }),
      el('div', { class: 'le-insp-meta', text: `${node.kind} · z ${node.z || 0} · ${this.editBucket}` }),
    ]));

    const grid = el('div', { class: 'le-fields' });
    this._fieldRefs = {};
    const numField = (key, label, step = 1) => {
      const fallback = key === 'scale' ? 1 : '';
      const input = el('input', {
        class: 'le-num', type: 'number', step: String(step),
        value: p[key] != null ? p[key] : fallback,
        'data-key': key,
        onInput: (e) => this.onFieldInput(key, e.target.value),
      });
      this._fieldRefs[key] = input;
      return el('label', { class: 'le-field' }, [
        el('span', { class: 'le-field-label', text: label }),
        input,
      ]);
    };

    const isAscii = node.kind === 'ascii';
    if (isAscii) {
      // ASCII creatures are intrinsic-sized <pre>; "size" is a scale multiplier.
      grid.append(
        numField('x', 'x %', 0.1),
        numField('y', 'y %', 0.1),
        numField('scale', 'scale', 0.05),
        numField('rot', 'rot°', 1),
        numField('opacity', 'opacity', 0.05),
      );
    } else {
      grid.append(
        numField('x', 'x %', 0.1),
        numField('y', 'y %', 0.1),
        numField('w', 'w vw', 0.1),
        numField('h', 'h vh', 0.1),
        numField('rot', 'rot°', 1),
        numField('opacity', 'opacity', 0.05),
      );
    }
    this.inspector.appendChild(grid);

    const toggles = el('div', { class: 'le-toggles' }, [
      this.toggle('flipX', 'flip X', !!p.flipX),
      this.toggle('hidden', 'hidden', !!p.hidden),
    ]);
    this.inspector.appendChild(toggles);

    if (isAscii) this.renderAsciiConfig(node);
    if (node.kind === 'component') this.renderComponentConfig(node);
  }

  // Node-level controls for ASCII creatures: color + cycle/always mode.
  renderAsciiConfig(node) {
    const wrap = el('div', { class: 'le-ascii-config' });

    const colorInput = el('input', {
      class: 'le-color', type: 'color',
      value: node.color || '#9dd1e3',
      onInput: (e) => this.onNodeProp('color', e.target.value, false),
    });
    wrap.appendChild(el('label', { class: 'le-field' }, [
      el('span', { class: 'le-field-label', text: 'color' }),
      colorInput,
    ]));

    const modeSel = el('select', {
      class: 'le-select',
      onChange: (e) => this.onNodeProp('mode', e.target.value, true),
    }, [
      el('option', { value: 'cycle', text: 'cycle (pop in/out)' }),
      el('option', { value: 'always', text: 'always on' }),
    ]);
    modeSel.value = node.mode || 'cycle';
    wrap.appendChild(el('label', { class: 'le-field' }, [
      el('span', { class: 'le-field-label', text: 'mode' }),
      modeSel,
    ]));

    this.inspector.appendChild(wrap);
  }

  // Edit a node-level (not per-breakpoint) property such as color or mode.
  onNodeProp(key, val, refresh) {
    const node = this.nodeById(this.selectedId);
    if (!node) return;
    this.snapshot();
    node[key] = val;
    this.preview();
    if (refresh) this.refreshAll(); else this.renderStatus();
  }

  toggle(key, label, on) {
    return el('label', { class: 'le-toggle' }, [
      el('input', {
        type: 'checkbox', ...(on ? { checked: 'checked' } : {}),
        onChange: (e) => this.onToggle(key, e.target.checked),
      }),
      el('span', { text: label }),
    ]);
  }

  // Update only the values in the existing inspector inputs (during drags).
  renderInspectorValues() {
    const node = this.selectedId ? this.nodeById(this.selectedId) : null;
    if (!node || !this._fieldRefs) return;
    const p = this.placementFor(node);
    for (const [key, input] of Object.entries(this._fieldRefs)) {
      if (document.activeElement === input) continue; // don't fight the user typing
      const v = p[key];
      input.value = v != null ? v : '';
    }
  }

  onFieldInput(key, raw) {
    const node = this.nodeById(this.selectedId);
    if (!node) return;
    const num = parseFloat(raw);
    if (Number.isNaN(num)) return;
    this.snapshot();
    const p = this.placementFor(node);
    p[key] = key === 'opacity' ? clamp(num, 0, 1) : num;
    this.preview();
    this.renderStatus();
  }

  onToggle(key, val) {
    const node = this.nodeById(this.selectedId);
    if (!node) return;
    this.snapshot();
    const p = this.placementFor(node);
    p[key] = !!val;
    this.preview();
    this.refreshAll();
  }

  // ----- component config + flight-path drawing tool ----------------------

  // Render the selected component's configSchema as editable fields, plus the
  // "draw flight path" entry for splat-butterfly.
  renderComponentConfig(node) {
    const reg = window.sceneComponents;
    const def = reg && typeof reg.get === 'function' ? reg.get(node.component) : null;
    const schema = def && def.configSchema;
    node.config = node.config || {};

    const wrap = el('div', { class: 'le-fields' });
    wrap.appendChild(el('div', { class: 'le-field-label', text: `config · ${node.component}` }));
    if (Array.isArray(schema)) {
      for (const f of schema) {
        if (f.key === 'flightPath') continue; // authored via the draw tool below
        wrap.appendChild(this.configField(node, f));
      }
    }
    this.inspector.appendChild(wrap);

    if (node.component === 'splat-butterfly') {
      const editing = !!this.pathEdit && this.pathEdit.nodeId === node.id;
      const btn = el('button', {
        class: 'le-btn',
        text: editing ? 'finish paths' : 'edit flight paths…',
        onClick: () => (editing ? this.endPathEdit() : this.startPathEdit(node)),
      });
      btn.style.marginTop = '8px';
      this.inspector.appendChild(btn);
      if ((node.config.routes || node.config.flightPath || '').length) {
        const clr = el('button', { class: 'le-btn', text: 'clear', onClick: () => this.clearPath(node) });
        clr.style.marginLeft = '6px';
        this.inspector.appendChild(clr);
      }
    }
  }

  configField(node, f) {
    const cur = node.config[f.key] != null ? node.config[f.key] : f.default;
    let input;
    if (f.type === 'boolean') {
      input = el('input', { type: 'checkbox', ...(cur ? { checked: 'checked' } : {}),
        onChange: (e) => this.onConfigInput(node, f, e.target.checked) });
    } else if (f.type === 'enum') {
      input = el('select', { class: 'le-num', onChange: (e) => this.onConfigInput(node, f, e.target.value) });
      for (const opt of (f.options || [])) {
        const o = el('option', { value: opt, text: opt });
        if (opt === cur) o.selected = true;
        input.appendChild(o);
      }
    } else if (f.type === 'number') {
      input = el('input', { class: 'le-num', type: 'number', value: cur,
        ...(f.step != null ? { step: String(f.step) } : {}),
        ...(f.min != null ? { min: String(f.min) } : {}),
        ...(f.max != null ? { max: String(f.max) } : {}),
        onInput: (e) => this.onConfigInput(node, f, e.target.value) });
    } else {
      input = el('input', { class: 'le-num', type: 'text', value: cur == null ? '' : cur,
        onInput: (e) => this.onConfigInput(node, f, e.target.value) });
    }
    return el('label', { class: 'le-field' }, [
      el('span', { class: 'le-field-label', text: f.label || f.key }),
      input,
    ]);
  }

  onConfigInput(node, f, raw) {
    let v = raw;
    if (f.type === 'number') { v = parseFloat(raw); if (Number.isNaN(v)) return; }
    else if (f.type === 'boolean') { v = !!raw; }
    this.snapshot();
    node.config = node.config || {};
    node.config[f.key] = v;
    this.preview();
  }

  parsePathPoints(raw) {
    if (!raw) return [];
    try {
      const a = JSON.parse(raw);
      if (!Array.isArray(a)) return [];
      return a.map((p) => ({
        u: +p.u || 0, v: +p.v || 0, depth: +p.depth || 0,
        rot: p.rot ? { x: +p.rot.x || 0, y: +p.rot.y || 0, z: +p.rot.z || 0 } : { x: 0, y: 0, z: 0 },
        scale: p.scale != null ? +p.scale : 1,
      }));
    } catch (e) { return []; }
  }

  startPathEdit(node) {
    const routes = this.parseRoutes(node.config);
    if (!routes.length) routes.push({ kind: 'path', points: [], duration: 1.5 });
    // routes: [{kind:'path'|'rest', points:[...], duration}]; `active` = the
    // route being edited; `sel` = selected point within it. The butterfly
    // wanders between routes at random and flaps in place at rest points.
    this.pathEdit = { nodeId: node.id, routes, active: 0, sel: null };
    // Add points by clicking anywhere on the page (viewport-space). Handles /
    // panels / the route list stopPropagation; chrome is skipped by class.
    this._pathClick = (e) => this.onPathCanvasDown(e);
    window.addEventListener('mousedown', this._pathClick);
    this.refreshAll();
  }

  endPathEdit() {
    if (this._pathClick) { window.removeEventListener('mousedown', this._pathClick); this._pathClick = null; }
    this.pathEdit = null;
    this.refreshAll();
  }

  // Parse config.routes (or migrate a single legacy flightPath) into editable
  // routes: [{ kind:'path'|'rest', points:[{u,v,depth,rot,scale}], duration }].
  parseRoutes(config) {
    const cfg = config || {};
    let arr = null;
    if (cfg.routes) { try { arr = JSON.parse(cfg.routes); } catch (e) { arr = null; } }
    if (!Array.isArray(arr)) {
      const pts = this.parsePathPoints(cfg.flightPath); // migrate old single path
      arr = pts.length ? [{ kind: 'path', points: pts }] : [];
    }
    return arr.map((seg) => {
      let pts = seg && seg.points;
      if (typeof pts === 'string') { try { pts = JSON.parse(pts); } catch (e) { pts = []; } }
      pts = Array.isArray(pts) ? pts : [];
      const points = pts.map((p) => ({
        u: +p.u || 0, v: +p.v || 0, depth: +p.depth || 0,
        rot: p.rot ? { x: +p.rot.x || 0, y: +p.rot.y || 0, z: +p.rot.z || 0 } : { x: 0, y: 0, z: 0 },
        scale: p.scale != null ? +p.scale : 1,
      }));
      return { kind: seg && seg.kind === 'rest' ? 'rest' : 'path', points, duration: seg && seg.duration != null ? +seg.duration : 1.5 };
    });
  }

  addRoute(kind) {
    const pe = this.pathEdit;
    pe.routes.push({ kind, points: [], duration: 1.5 });
    pe.active = pe.routes.length - 1;
    pe.sel = null;
    this.writePathPoints(true);
    this.positionChrome();
  }

  selectRoute(idx) {
    this.pathEdit.active = idx;
    this.pathEdit.sel = null;
    this.positionChrome();
  }

  removeRoute(idx) {
    const pe = this.pathEdit;
    pe.routes.splice(idx, 1);
    if (!pe.routes.length) pe.routes.push({ kind: 'path', points: [], duration: 1.5 });
    if (pe.active >= pe.routes.length) pe.active = pe.routes.length - 1;
    pe.sel = null;
    this.writePathPoints(true);
    this.positionChrome();
  }

  clearPath(node) {
    this.snapshot();
    node.config = node.config || {};
    delete node.config.flightPath;
    delete node.config.routes;
    if (this.pathEdit && this.pathEdit.nodeId === node.id) {
      this.pathEdit.routes = [{ kind: 'path', points: [], duration: 1.5 }];
      this.pathEdit.active = 0; this.pathEdit.sel = null;
    }
    this.preview();
    this.refreshAll();
  }

  // Serialize ALL routes (paths + rests) into config.routes and preview; fit the
  // node box to every point so it stays centered on the whole choreography.
  // (Name kept for caller compatibility — it writes routes, not a single path.)
  writePathPoints(commit) {
    const pe = this.pathEdit;
    if (!pe) return;
    const node = this.nodeById(pe.nodeId);
    if (!node) return;
    if (commit) this.snapshot();
    node.config = node.config || {};
    delete node.config.flightPath; // superseded by routes
    node.config.routes = JSON.stringify(pe.routes.map((seg) => {
      const out = {
        kind: seg.kind,
        points: seg.points.map((p) => {
          const r = p.rot || {};
          return {
            u: +p.u.toFixed(4), v: +p.v.toFixed(4), depth: +p.depth.toFixed(3),
            rot: { x: +(r.x || 0).toFixed(1), y: +(r.y || 0).toFixed(1), z: +(r.z || 0).toFixed(1) },
            scale: +(p.scale != null ? p.scale : 1).toFixed(3),
          };
        }),
      };
      if (seg.kind === 'rest') out.duration = +(+seg.duration || 1.5).toFixed(2);
      return out;
    }));
    // The canvas is full-viewport, so the node box doesn't cage the flight — fit
    // it (with a small margin) to ALL route points so it centers on the whole set.
    if (commit) {
      let minU = 1, maxU = 0, minV = 1, maxV = 0, any = false;
      for (const seg of pe.routes) {
        for (const p of seg.points) {
          any = true;
          if (p.u < minU) minU = p.u;
          if (p.u > maxU) maxU = p.u;
          if (p.v < minV) minV = p.v;
          if (p.v > maxV) maxV = p.v;
        }
      }
      if (any) {
        const mx = 0.03, my = 0.03;
        const pl = this.placementFor(node);
        pl.x = +(Math.max(0, minU - mx) * 100).toFixed(2);
        pl.y = +(Math.max(0, minV - my) * 100).toFixed(2);
        pl.w = +(Math.max(0.05, maxU - minU + 2 * mx) * 100).toFixed(2);
        pl.h = +(Math.max(0.05, maxV - minV + 2 * my) * 100).toFixed(2);
        this.renderInspectorValues();
      }
    }
    this.preview();
  }

  // window mousedown while path-editing: add a point unless the click landed on
  // editor chrome, a handle, or the per-point panel.
  onPathCanvasDown(e) {
    if (!this.pathEdit || e.button !== 0) return;
    if (this.pathEdit.nodeId !== this.selectedId) return; // selection moved on; ignore
    const t = e.target;
    if (t && t.closest && t.closest('.le-panel, .le-toolbar, .le-pathctl, .le-pathhandle, .le-routelist, #le-root .le-btn')) return;
    this.addPathPoint(e);
  }

  addPathPoint(e) {
    const pe = this.pathEdit, seg = pe.routes[pe.active];
    const u = clamp(e.clientX / window.innerWidth, 0, 1);
    const v = clamp(e.clientY / window.innerHeight, 0, 1);
    if (seg.kind === 'rest') { // a rest is a single landing spot — set/move it
      if (seg.points.length) { seg.points[0].u = u; seg.points[0].v = v; }
      else seg.points.push({ u, v, depth: 0, rot: { x: 0, y: 0, z: 0 }, scale: 1 });
      pe.sel = 0;
    } else {
      seg.points.push({ u, v, depth: 0, rot: { x: 0, y: 0, z: 0 }, scale: 1 });
      pe.sel = seg.points.length - 1;
    }
    this.writePathPoints(true);
    this.positionChrome();
  }

  removePathPoint(i) {
    const seg = this.pathEdit.routes[this.pathEdit.active];
    seg.points.splice(i, 1);
    if (this.pathEdit.sel === i) this.pathEdit.sel = null;
    else if (this.pathEdit.sel > i) this.pathEdit.sel -= 1;
    this.writePathPoints(true);
    this.positionChrome();
  }

  beginPathDrag(e, i) {
    e.preventDefault();
    e.stopPropagation();
    const pe = this.pathEdit;
    const pt = pe.routes[pe.active].points[i];
    pe.sel = i;
    const depthMode = e.shiftKey;
    const startY = e.clientY;
    const startDepth = pt.depth || 0;
    const move = (ev) => {
      if (depthMode) {
        pt.depth = clamp(startDepth + (startY - ev.clientY) / 120, -1, 1); // drag up = toward viewer
      } else {
        pt.u = clamp(ev.clientX / window.innerWidth, 0, 1);
        pt.v = clamp(ev.clientY / window.innerHeight, 0, 1);
      }
      this.writePathPoints(false);
      this.positionChrome();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.writePathPoints(true);
      this.positionChrome();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // Draw the flight-path editor chrome (spline + draggable points + per-point
  // rotation/scale panel) over the WHOLE VIEWPORT. Called from positionChrome().
  drawPathEditor() {
    const pe = this.pathEdit;
    const node = this.nodeById(pe.nodeId);
    if (!node) { this.pathEdit = null; return; }
    const W = window.innerWidth, H = window.innerHeight;
    const SVGNS = 'http://www.w3.org/2000/svg';

    // Draw EVERY route: paths as their actual open centripetal curve (WYSIWYG),
    // rests as a ring. The active route is bright; the others dimmed.
    const svg = document.createElementNS(SVGNS, 'svg');
    Object.assign(svg.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: '5', overflow: 'visible' });
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    pe.routes.forEach((seg, ri) => {
      const active = ri === pe.active;
      if (seg.kind === 'rest') {
        const p = seg.points[0];
        if (!p) return;
        const c = document.createElementNS(SVGNS, 'circle');
        c.setAttribute('cx', p.u * W); c.setAttribute('cy', p.v * H); c.setAttribute('r', active ? 13 : 10);
        c.setAttribute('fill', 'rgba(224,138,30,0.12)');
        c.setAttribute('stroke', active ? '#e08a1e' : '#c9a96a');
        c.setAttribute('stroke-width', active ? 3 : 2);
        c.setAttribute('opacity', active ? 0.95 : 0.5);
        svg.appendChild(c);
      } else if (seg.points.length > 1) {
        const vecs = seg.points.map((p) => new THREE.Vector3(p.u * W, p.v * H, 0));
        const curve = new THREE.CatmullRomCurve3(vecs, false, 'centripetal'); // OPEN route
        const sampled = curve.getPoints(Math.max(48, seg.points.length * 20));
        const poly = document.createElementNS(SVGNS, 'polyline');
        poly.setAttribute('points', sampled.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '));
        poly.setAttribute('fill', 'none');
        poly.setAttribute('stroke', active ? '#23448d' : '#9aa6c4');
        poly.setAttribute('stroke-width', active ? 2 : 1.5);
        poly.setAttribute('stroke-dasharray', '5 4');
        poly.setAttribute('opacity', active ? 0.9 : 0.4);
        svg.appendChild(poly);
      }
    });
    this.overlay.appendChild(svg);

    // draggable handles for the ACTIVE route only
    const seg = pe.routes[pe.active];
    seg.points.forEach((p, i) => {
      const cx = p.u * W, cy = p.v * H, d = p.depth || 0;
      const col = seg.kind === 'rest' ? '#e08a1e' : (d > 0.02 ? '#3a6df0' : d < -0.02 ? '#e74e4d' : '#23448d');
      const sel = pe.sel === i;
      const sz = sel ? 18 : 14;
      const h = document.createElement('div');
      h.className = 'le-pathhandle';
      Object.assign(h.style, {
        position: 'fixed', left: `${cx - sz / 2}px`, top: `${cy - sz / 2}px`,
        width: `${sz}px`, height: `${sz}px`, borderRadius: '50%', background: col,
        border: sel ? '3px solid #ffcc00' : '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.35)',
        pointerEvents: 'auto', cursor: 'grab', zIndex: '6',
      });
      h.title = `${seg.kind} point ${i + 1} · drag move · shift-drag depth · dbl-click delete`;
      h.addEventListener('mousedown', (e) => this.beginPathDrag(e, i));
      h.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); this.removePathPoint(i); });
      this.overlay.appendChild(h);
      const lbl = document.createElement('div');
      Object.assign(lbl.style, { position: 'fixed', left: `${cx + 10}px`, top: `${cy - 9}px`, font: '10px ui-monospace, monospace', color: col, pointerEvents: 'none', zIndex: '6' });
      lbl.textContent = String(i + 1);
      this.overlay.appendChild(lbl);
    });

    // hint label (top-center, clear of the panels)
    const hint = document.createElement('div');
    Object.assign(hint.style, {
      position: 'fixed', left: '50%', top: '8px', transform: 'translateX(-50%)',
      font: '11px ui-monospace, monospace', color: '#23448d',
      background: 'rgba(243,239,226,0.92)', padding: '3px 9px', borderRadius: '4px',
      pointerEvents: 'none', zIndex: '7', whiteSpace: 'nowrap',
    });
    hint.textContent = seg.kind === 'rest'
      ? 'REST · click the page to place the spot · set its seconds in the list →'
      : 'PATH · click page to add points · drag move · shift-drag depth · click a point for rotation/scale';
    this.overlay.appendChild(hint);

    this.drawRouteListPanel();
    // per-point rotation + scale panel (paths only; rests use the duration field)
    if (seg.kind === 'path' && pe.sel != null && seg.points[pe.sel]) {
      this.drawPathPointPanel(seg.points[pe.sel], pe.sel);
    }
  }

  // The list of routes (bottom-left): select / delete each, set a rest's
  // seconds, and add new paths/rests. Wander order is random at runtime.
  drawRouteListPanel() {
    const pe = this.pathEdit;
    const panel = document.createElement('div');
    panel.className = 'le-routelist';
    Object.assign(panel.style, {
      position: 'fixed', left: '14px', bottom: '14px', width: '210px',
      background: 'rgba(243,239,226,0.97)', border: '1px solid rgba(35,68,141,0.4)',
      borderRadius: '6px', padding: '8px 10px', font: '11px ui-monospace, monospace',
      color: '#23448d', pointerEvents: 'auto', zIndex: '8', boxShadow: '0 2px 12px rgba(0,0,0,.22)',
    });
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    const title = document.createElement('div');
    title.textContent = `paths & rests · ${pe.routes.length}`;
    Object.assign(title.style, { fontWeight: '600', marginBottom: '6px' });
    panel.appendChild(title);

    pe.routes.forEach((seg, ri) => {
      const active = ri === pe.active;
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '6px', margin: '2px 0',
        padding: '3px 5px', borderRadius: '4px', cursor: 'pointer',
        background: active ? 'rgba(35,68,141,0.14)' : 'transparent',
      });
      row.addEventListener('click', () => this.selectRoute(ri));
      const label = document.createElement('span');
      label.style.flex = '1';
      label.textContent = seg.kind === 'rest' ? `⏸ rest ${ri + 1}` : `⇝ path ${ri + 1} (${seg.points.length})`;
      row.appendChild(label);
      if (seg.kind === 'rest') {
        const dur = document.createElement('input');
        dur.type = 'number'; dur.step = '0.5'; dur.min = '0';
        dur.value = seg.duration != null ? seg.duration : 1.5;
        Object.assign(dur.style, { width: '44px', font: '11px ui-monospace, monospace', padding: '0 3px' });
        dur.title = 'rest seconds';
        dur.addEventListener('click', (e) => e.stopPropagation());
        dur.addEventListener('input', () => { const v = parseFloat(dur.value); if (!Number.isNaN(v)) { seg.duration = v; this.writePathPoints(false); } });
        dur.addEventListener('change', () => this.writePathPoints(true));
        row.appendChild(dur);
        const s = document.createElement('span'); s.textContent = 's'; row.appendChild(s);
      }
      const del = document.createElement('button');
      del.textContent = '×';
      Object.assign(del.style, { border: 'none', background: 'transparent', color: '#a33', cursor: 'pointer', fontSize: '13px', lineHeight: '1', padding: '0 2px' });
      del.title = 'delete';
      del.addEventListener('click', (e) => { e.stopPropagation(); this.removeRoute(ri); });
      row.appendChild(del);
      panel.appendChild(row);
    });

    const btns = document.createElement('div');
    Object.assign(btns.style, { display: 'flex', gap: '6px', marginTop: '6px' });
    const mk = (txt, fn) => {
      const b = document.createElement('button');
      b.className = 'le-btn'; b.textContent = txt; b.style.flex = '1';
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    btns.appendChild(mk('+ path', () => this.addRoute('path')));
    btns.appendChild(mk('+ rest', () => this.addRoute('rest')));
    panel.appendChild(btns);
    const finish = mk('finish', () => this.endPathEdit());
    Object.assign(finish.style, { marginTop: '6px', width: '100%', flex: 'none' });
    panel.appendChild(finish);
    this.overlay.appendChild(panel);
  }

  drawPathPointPanel(pt, i) {
    pt.rot = pt.rot || { x: 0, y: 0, z: 0 };
    const panel = document.createElement('div');
    panel.className = 'le-pathctl';
    Object.assign(panel.style, {
      position: 'fixed', right: '14px', bottom: '14px', width: '188px',
      background: 'rgba(243,239,226,0.97)', border: '1px solid rgba(35,68,141,0.4)',
      borderRadius: '6px', padding: '8px 10px', font: '11px ui-monospace, monospace',
      color: '#23448d', pointerEvents: 'auto', zIndex: '8', boxShadow: '0 2px 12px rgba(0,0,0,.22)',
    });
    panel.addEventListener('mousedown', (e) => e.stopPropagation()); // don't add a point
    const title = document.createElement('div');
    title.textContent = `point ${i + 1} · rotation / scale`;
    Object.assign(title.style, { fontWeight: '600', marginBottom: '6px' });
    panel.appendChild(title);

    const row = (label, get, set, step) => {
      const r = document.createElement('label');
      Object.assign(r.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '3px 0', gap: '8px' });
      const sp = document.createElement('span'); sp.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.step = String(step); inp.value = get();
      Object.assign(inp.style, { width: '76px', font: '11px ui-monospace, monospace', padding: '1px 4px' });
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) { set(v); this.writePathPoints(false); } });
      inp.addEventListener('change', () => this.writePathPoints(true));
      r.append(sp, inp);
      return r;
    };
    panel.appendChild(row('rot X°', () => pt.rot.x || 0, (v) => { pt.rot.x = v; }, 5));
    panel.appendChild(row('rot Y°', () => pt.rot.y || 0, (v) => { pt.rot.y = v; }, 5));
    panel.appendChild(row('rot Z°', () => pt.rot.z || 0, (v) => { pt.rot.z = v; }, 5));
    panel.appendChild(row('scale', () => (pt.scale != null ? pt.scale : 1), (v) => { pt.scale = v; }, 0.05));
    const del = document.createElement('button');
    del.className = 'le-btn'; del.textContent = 'delete point';
    del.style.marginTop = '6px';
    del.addEventListener('click', (e) => { e.stopPropagation(); this.removePathPoint(i); });
    panel.appendChild(del);
    this.overlay.appendChild(panel);
  }

  // ----- selection chrome positioning -------------------------------------

  positionChrome() {
    // Clear handles
    this.overlay.innerHTML = '';
    if (this.cleanPreview) return;
    // While path-editing, show ONLY the path chrome — no selection box or resize/
    // rotate handles, so add-point clicks can't collide with a resize handle.
    if (this.pathEdit) { this.drawPathEditor(); return; }
    const node = this.selectedId ? this.nodeById(this.selectedId) : null;
    if (!node) return;
    const dom = this.domFor(node.id);
    if (!dom) return;
    const r = dom.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;

    const box = el('div', { class: 'le-selbox' });
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;

    // 8 resize handles
    const dirs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const d of dirs) {
      const h = el('div', { class: `le-handle le-${d}`, 'data-dir': d });
      h.addEventListener('mousedown', (e) => this.beginResize(e, d));
      box.appendChild(h);
    }
    // rotate handle above top-center
    const rot = el('div', { class: 'le-rotate' });
    rot.addEventListener('mousedown', (e) => this.beginRotate(e));
    box.appendChild(rot);
    box.appendChild(el('div', { class: 'le-rotate-stem' }));

    this.overlay.appendChild(box);
  }

  // ----- keyboard ----------------------------------------------------------

  bindGlobalKeys() {
    this._keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this._keyHandler, true);
  }

  onKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);

    // Undo / Redo (work even while not typing in a field)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.save();
      return;
    }

    if (e.key === 'Tab' && !typing) {
      e.preventDefault();
      this.toggleCleanPreview();
      return;
    }

    if (typing) return;

    if (e.key === 'Escape') {
      if (this.cleanPreview) { this.toggleCleanPreview(); return; }
      this.clearSelection();
      return;
    }

    // Arrow nudge
    if (this.selectedId && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const node = this.nodeById(this.selectedId);
      if (!node) return;
      const stepPx = e.shiftKey ? 10 : 1;
      const p = this.placementFor(node);
      this.snapshot();
      if (e.key === 'ArrowLeft') p.x = round2(p.x - this.r.pxToPct(stepPx, 'x', node));
      if (e.key === 'ArrowRight') p.x = round2(p.x + this.r.pxToPct(stepPx, 'x', node));
      if (e.key === 'ArrowUp') p.y = round2(p.y - this.r.pxToPct(stepPx, 'y', node));
      if (e.key === 'ArrowDown') p.y = round2(p.y + this.r.pxToPct(stepPx, 'y', node));
      this.preview();
      this.renderInspectorValues();
      this.renderStatus();
    }
  }

  toggleCleanPreview() {
    this.cleanPreview = !this.cleanPreview;
    this.root.classList.toggle('le-clean', this.cleanPreview);
    this.positionChrome();
  }

  // ----- resync on resize / renderer relayout -----------------------------

  bindResync() {
    let raf = null;
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // If the active bucket changed because the window crossed a breakpoint,
        // follow it so the inspector edits what the user actually sees.
        const active = this.r.activeBreakpoint();
        if (active !== this.editBucket && !this.gesture) {
          this.editBucket = active;
        }
        this.refreshAll();
      });
    };
    window.addEventListener('resize', onResize);
    this._onResize = onResize;
    // the site's camera moves #book-space: keep the chrome glued; a page swap replaces the scene under us
    this._onTransform = () => this.positionChrome();
    window.addEventListener('scene:transform', this._onTransform);
    this._onPage = () => this.reloadFromRenderer();
    window.addEventListener('scene:page', this._onPage);

    // Keep chrome glued to nodes if the renderer reflows element-anchored art.
    if ('ResizeObserver' in window) {
      this._ro = new ResizeObserver(() => this.positionChrome());
      this._ro.observe(document.body);
    }
  }

  // ----- save --------------------------------------------------------------

  async save() {
    if (!this.serverOnline) {
      this.downloadJSON();
      return;
    }
    const page = this.r.pageKey();
    try {
      // nodes that came from _global.json go back there; the rest to the page — never shadow a global with a page copy
      const strip = (n) => { const c = Object.assign({}, n); delete c.scope; return c; };
      const globals = this.scene.nodes.filter((n) => n.scope === 'global').map(strip);
      const own = this.scene.nodes.filter((n) => n.scope !== 'global').map(strip);
      // the page file keeps its top-level fields (space, camera, fluid, anchorWidths) even if this working copy predates them
      const live = (this.r.getScene && this.r.getScene()) || {};
      const pageScene = Object.assign({}, live, this.scene, { nodes: own });
      ['space', 'camera', 'fluid', 'anchorWidths'].forEach((k) => { if (pageScene[k] === undefined && live[k] !== undefined) pageScene[k] = live[k]; });
      const post = (key, body) => fetch(`/__editor/scene/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) + '\n' })
        .then(async (res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json().catch(() => ({})); });
      const data = await post(page, pageScene);
      if (globals.length) await post('_global', { page: '_global', version: this.scene.version || 1, nodes: globals });
      this.dirty = false;
      this.statusEl.textContent = (data.bytes ? `saved (${data.bytes} b)` : 'saved') + (globals.length ? ` + ${globals.length} global` : '');
      this.statusEl.className = 'le-status le-status-clean';
    } catch (err) {
      this.statusEl.textContent = `save failed: ${err.message}`;
      this.statusEl.className = 'le-status le-status-warn';
    }
  }

  downloadJSON() {
    const blob = new Blob([JSON.stringify(this.scene, null, 2) + '\n'], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `${this.r.pageKey()}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    this.dirty = false;
    this.statusEl.textContent = 'downloaded';
    this.statusEl.className = 'le-status le-status-clean';
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\\]]/g, '\\$&');
}

function injectStylesheet() {
  if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  document.head.appendChild(link);
}

async function pingServer() {
  try {
    const res = await fetch(PING_URL, { method: 'GET' });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return !!data.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  const renderer = window.sceneRenderer;
  if (!renderer) {
    console.warn('[layout-editor] window.sceneRenderer missing; aborting.');
    return;
  }
  if (renderer.ready && typeof renderer.ready.then === 'function') {
    await renderer.ready;
  }
  // Guard against double-boot (renderer may import us once, but be defensive).
  if (window.__layoutEditor) return;
  const editor = new LayoutEditor(renderer);
  window.__layoutEditor = editor;
  await editor.init();
}

boot().catch((err) => console.error('[layout-editor] failed to start', err));

export default boot;
