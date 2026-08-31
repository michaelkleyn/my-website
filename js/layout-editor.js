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
    this.selectedId = id;
    // Pin ASCII creatures visible while selected so they can be placed even when
    // their cycle would otherwise have them off-screen; unpin for other kinds.
    const node = this.nodeById(id);
    if (node && node.kind === 'ascii' && this.r.pinNode) this.r.pinNode(id);
    else if (this.r.unpinNode) this.r.unpinNode();
    this.refreshAll();
  }

  clearSelection() {
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
    // The navigator already confirms leaving a dirty page; by the time the page has switched, reloading is the only
    // correct move — a second (previously broken) confirm here used to discard edits no matter what was answered.
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
    this._sliderRefs = {};
    const SLIDER_RANGE = { x: [-10, 110], y: [-10, 110], w: [0, 60], h: [0, 100], rot: [-180, 180], opacity: [0, 1], scale: [0.05, 4] };
    const numField = (key, label, step = 1) => {
      const fallback = key === 'scale' ? 1 : '';
      const input = el('input', {
        class: 'le-num', type: 'number', step: String(step),
        value: p[key] != null ? p[key] : fallback,
        'data-key': key,
        onInput: (e) => { slider.value = e.target.value; this.onFieldInput(key, e.target.value); },
      });
      const range = SLIDER_RANGE[key] || [0, 100];
      const slider = el('input', {
        class: 'le-slider', type: 'range',
        min: String(range[0]), max: String(range[1]), step: String(step),
        value: p[key] != null ? p[key] : (key === 'scale' ? 1 : 0),
        // one undo entry per slider drag: snapshot at gesture start, apply-only after
        onPointerdown: () => this.snapshot(),
        onInput: (e) => { input.value = e.target.value; this.onFieldInput(key, e.target.value, true); },
      });
      this._fieldRefs[key] = input;
      this._sliderRefs[key] = slider;
      return el('label', { class: 'le-field' }, [
        el('span', { class: 'le-field-label', text: label }),
        input,
        slider,
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
      const slider = this._sliderRefs && this._sliderRefs[key];
      if (slider && document.activeElement !== slider) slider.value = v != null ? v : (key === 'scale' ? 1 : 0);
    }
  }

  onFieldInput(key, raw, skipSnapshot) {
    const node = this.nodeById(this.selectedId);
    if (!node) return;
    const num = parseFloat(raw);
    if (Number.isNaN(num)) return;
    if (!skipSnapshot) this.snapshot();
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

  // ----- selection chrome positioning -------------------------------------

  positionChrome() {
    // Clear handles
    this.overlay.innerHTML = '';
    if (this.cleanPreview) return;
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
    if (!this.serverOnline) this.serverOnline = await pingServer();   // a failed ping at load must not turn every save into a download
    if (!this.serverOnline) {
      this.statusEl.textContent = 'no dev server — downloaded JSON instead';
      this.statusEl.className = 'le-status le-status-warn';
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
