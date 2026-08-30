/**
 * Map panel — UI shell that hosts a MapView. Parses data-map on trigger links
 * (URL of the city's manifest.json), lazy-loads tiles, handles drag-to-pan
 * and wheel-to-zoom. Per-frame rasterization is delegated to MapView.
 */

import { MapView } from './map-view.js';

class MapPanel {
  constructor() {
    this.panel = null;
    this.canvas = null;
    this.label = null;
    this.views = new Map(); // manifest url -> MapView
    this.current = null;
    this.drag = null;
    this.init();
  }

  init() {
    this.createPanel();
    this.wireLinks();
    this.wireGlobal();
  }

  createPanel() {
    const panel = document.createElement('aside');
    panel.className = 'map-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
      <button class="map-close" type="button" aria-label="Close map">close ×</button>
      <div class="map-label" data-map-label></div>
      <div class="map-hint">drag · scroll to zoom</div>
      <div class="map-viewport" data-map-viewport>
        <canvas class="map-canvas" data-map-canvas></canvas>
      </div>
    `;
    document.body.appendChild(panel);

    this.panel = panel;
    this.viewport = panel.querySelector('[data-map-viewport]');
    this.canvas = panel.querySelector('[data-map-canvas]');
    this.label = panel.querySelector('[data-map-label]');

    panel.querySelector('.map-close').addEventListener('click', () => this.close());
  }

  wireLinks() {
    document.querySelectorAll('a[data-map]').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.open(link.dataset.map);
      });
    });
  }

  wireGlobal() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel.classList.contains('open')) {
        this.close();
      }
    });

    // Drag
    this.viewport.addEventListener('mousedown', (e) => this.onDragStart(e));
    window.addEventListener('mousemove', (e) => this.onDragMove(e));
    window.addEventListener('mouseup', () => this.onDragEnd());

    // Wheel zoom
    this.viewport.addEventListener('wheel', (e) => this.onWheel(e), {
      passive: false,
    });

    // Touch pan
    this.viewport.addEventListener('touchstart', (e) => this.onTouchStart(e), {
      passive: false,
    });
    this.viewport.addEventListener('touchmove', (e) => this.onTouchMove(e), {
      passive: false,
    });
    this.viewport.addEventListener('touchend', () => this.onDragEnd());

    // Resize — relayout canvas + rerender
    const ro = new ResizeObserver(() => {
      if (this.current) {
        this.current.resize();
        this.current.scheduleRender();
      }
    });
    ro.observe(this.canvas);
  }

  async open(manifestUrl) {
    let view = this.views.get(manifestUrl);

    document.body.classList.add('map-open');
    this.panel.classList.add('open');
    this.panel.setAttribute('aria-hidden', 'false');

    if (!view) {
      const res = await fetch(manifestUrl);
      if (!res.ok) {
        console.error(`manifest ${manifestUrl} ${res.status}`);
        return;
      }
      const manifest = await res.json();
      const tileBaseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/'));
      view = new MapView({
        canvas: this.canvas,
        manifest,
        tileBaseUrl,
      });
      this.views.set(manifestUrl, view);
      // Load tiles in background, render progressively
      view.resize();
      view.loadTiles().then(() => {
        if (this.current === view) view.scheduleRender();
      });
    }

    this.current = view;
    this.label.textContent = view.manifest.label;

    // Re-bind the canvas to this view (in case we switched cities)
    view.canvas = this.canvas;
    view.ctx = this.canvas.getContext('2d');
    view.resize();
    view.scheduleRender();
  }

  close() {
    this.panel.classList.remove('open');
    this.panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('map-open');
  }

  onDragStart(e) {
    if (e.button !== 0 || !this.current) return;
    e.preventDefault();
    this.drag = { x: e.clientX, y: e.clientY };
    this.viewport.classList.add('grabbing');
  }

  onDragMove(e) {
    if (!this.drag || !this.current) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.current.panBy(dx, dy);
  }

  onDragEnd() {
    this.drag = null;
    this.viewport.classList.remove('grabbing');
  }

  onTouchStart(e) {
    if (e.touches.length !== 1 || !this.current) return;
    e.preventDefault();
    const t = e.touches[0];
    this.drag = { x: t.clientX, y: t.clientY };
  }

  onTouchMove(e) {
    if (!this.drag || !this.current || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - this.drag.x;
    const dy = t.clientY - this.drag.y;
    this.drag.x = t.clientX;
    this.drag.y = t.clientY;
    this.current.panBy(dx, dy);
  }

  onWheel(e) {
    if (!this.current) return;
    e.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const step = Math.exp(-e.deltaY * 0.0015);
    this.current.zoomAt(px, py, step);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.mapPanel = new MapPanel();
});
