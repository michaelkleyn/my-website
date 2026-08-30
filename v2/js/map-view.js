/**
 * Runtime MVT rasterizer — loads pre-fetched vector tiles, then on every
 * pan/zoom, rasterizes the visible viewport into a small braille grid and
 * paints it to a canvas. Constant per-frame work regardless of world extent.
 */

import { VectorTile } from 'https://esm.sh/@mapbox/vector-tile@2.0.3';
import Pbf from 'https://esm.sh/pbf@4.0.1';

const TILE_EXTENT = 4096;

// Braille bit layout within a 2x4 sub-pixel cell
const BIT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

// Color palette — monochrome blue family on cream
const COLOR = {
  water: '#2c5d8f',
  coast: '#1c3144',
  waterway: '#4a7fae',
  road: 'rgba(28, 49, 68, 0.45)',
  park: 'rgba(44, 93, 143, 0.18)',
};

// Layer priority: highest wins when multiple layers overlap in one cell
const LAYER_PRIORITY = ['coast', 'waterway', 'water', 'road', 'park'];

// Road classes worth rendering — subset changes by zoom (see renderOpts)
const ROAD_CLASSES = {
  motorway: 0,
  trunk: 0,
  primary: 1,
  secondary: 2,
  tertiary: 3,
  minor: 4,
};

function lonLatToWorld(lon, lat, zoom) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n * TILE_EXTENT;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n * TILE_EXTENT;
  return { x, y };
}

export class MapView {
  constructor({ canvas, manifest, tileBaseUrl }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.manifest = manifest;
    this.tileBaseUrl = tileBaseUrl;

    // Parsed features per tile, in world coords at manifest.zoom.
    this.tileCache = new Map();

    // Viewport state — center in world coords, units-per-pixel scale.
    const c = lonLatToWorld(manifest.lon, manifest.lat, manifest.zoom);
    this.state = {
      cx: c.x,
      cy: c.y,
      upx: 12, // world units per CSS pixel; ~30m/px default at z12
    };

    // Cell grid sizes (computed on resize)
    this.cellW = 0;
    this.cellH = 0;
    this.subW = 0;
    this.subH = 0;
    this.buffer = null;       // Uint8Array: braille bits per cell
    this.layerBuffer = null;  // Uint8Array: highest-priority layer per cell
    this.subBuffer = null;    // Uint8Array: per-sub-pixel layer id for fill

    // Font metrics
    this.charW = 0;
    this.lineH = 0;
    this.fontSize = 13;
    this.dpr = 1;

    this.renderScheduled = false;
    this.tilesLoaded = false;
  }

  async loadTiles() {
    const loads = this.manifest.tiles.map(async (t) => {
      const url = `${this.tileBaseUrl}/${t.file}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`tile ${t.file} ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const tile = new VectorTile(new Pbf(buf));
      this.tileCache.set(`${t.x},${t.y}`, this.processTile(tile, t.x, t.y));
    });
    await Promise.all(loads);
    this.tilesLoaded = true;
  }

  processTile(tile, tileX, tileY) {
    const baseX = tileX * TILE_EXTENT;
    const baseY = tileY * TILE_EXTENT;
    const transform = (rings) =>
      rings.map((ring) =>
        ring.map((p) => ({ x: baseX + p.x, y: baseY + p.y }))
      );

    const out = { water: [], waterway: [], road: [], park: [] };

    const water = tile.layers.water;
    if (water) {
      for (let i = 0; i < water.length; i++) {
        const f = water.feature(i);
        if (f.type !== 3) continue;
        out.water.push({ rings: transform(f.loadGeometry()) });
      }
    }

    const waterway = tile.layers.waterway;
    if (waterway) {
      for (let i = 0; i < waterway.length; i++) {
        const f = waterway.feature(i);
        if (f.type !== 2) continue;
        out.waterway.push({ lines: transform(f.loadGeometry()) });
      }
    }

    const transportation = tile.layers.transportation;
    if (transportation) {
      for (let i = 0; i < transportation.length; i++) {
        const f = transportation.feature(i);
        const cls = f.properties.class;
        if (!(cls in ROAD_CLASSES)) continue;
        out.road.push({
          lines: transform(f.loadGeometry()),
          rank: ROAD_CLASSES[cls],
          type: f.type,
        });
      }
    }

    const park = tile.layers.park;
    if (park) {
      for (let i = 0; i < park.length; i++) {
        const f = park.feature(i);
        if (f.type !== 3) continue;
        out.park.push({ rings: transform(f.loadGeometry()) });
      }
    }

    return out;
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (!cssW || !cssH) return;

    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);

    // Measure monospace char advance at chosen font size
    this.ctx.font = `${this.fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
    this.ctx.textBaseline = 'top';
    const metrics = this.ctx.measureText('\u2800');
    this.charW = metrics.width;
    this.lineH = this.fontSize * 1.0;

    this.cellW = Math.max(1, Math.floor(cssW / this.charW));
    this.cellH = Math.max(1, Math.floor(cssH / this.lineH));
    this.subW = this.cellW * 2;
    this.subH = this.cellH * 4;

    this.buffer = new Uint8Array(this.cellW * this.cellH);
    this.layerBuffer = new Uint8Array(this.cellW * this.cellH);
    this.subBuffer = new Uint8Array(this.subW * this.subH);
  }

  // ----- Public pan/zoom API -----

  panBy(dxPx, dyPx) {
    this.state.cx -= dxPx * this.state.upx;
    this.state.cy -= dyPx * this.state.upx;
    this.scheduleRender();
  }

  zoomAt(pxX, pxY, factor) {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    const prev = this.state.upx;
    const next = Math.max(0.5, Math.min(200, prev / factor));
    if (next === prev) return;
    // Keep the world point under cursor fixed
    const worldX = this.state.cx + (pxX - cssW / 2) * prev;
    const worldY = this.state.cy + (pxY - cssH / 2) * prev;
    this.state.cx = worldX - (pxX - cssW / 2) * next;
    this.state.cy = worldY - (pxY - cssH / 2) * next;
    this.state.upx = next;
    this.scheduleRender();
  }

  scheduleRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  // ----- Rasterization -----

  render() {
    if (!this.tilesLoaded || !this.buffer) return;

    this.buffer.fill(0);
    this.layerBuffer.fill(0);
    this.subBuffer.fill(0);

    const { cx, cy, upx } = this.state;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;

    // Viewport world bounds
    const halfW = (cssW / 2) * upx;
    const halfH = (cssH / 2) * upx;
    const minX = cx - halfW;
    const maxX = cx + halfW;
    const minY = cy - halfH;
    const maxY = cy + halfH;

    // World → sub-pixel transform
    const subPerUnitX = this.subW / (2 * halfW);
    const subPerUnitY = this.subH / (2 * halfH);
    const worldToSub = (p) => ({
      x: (p.x - minX) * subPerUnitX,
      y: (p.y - minY) * subPerUnitY,
    });

    // Level-of-detail rules — less at big upx, more at small upx
    const opts = {
      showPark: upx < 20,
      showWaterway: upx < 30,
      // roads filter: higher upx → fewer roads
      roadRankMax:
        upx > 50 ? 0 : upx > 20 ? 1 : upx > 8 ? 2 : upx > 4 ? 3 : 4,
      showWater: true,
      showCoast: upx < 150,
    };

    // Tile range intersecting viewport
    const minTileX = Math.floor(minX / TILE_EXTENT);
    const maxTileX = Math.floor(maxX / TILE_EXTENT);
    const minTileY = Math.floor(minY / TILE_EXTENT);
    const maxTileY = Math.floor(maxY / TILE_EXTENT);

    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        const tile = this.tileCache.get(`${tx},${ty}`);
        if (!tile) continue;

        // Draw order: park (bottom) → water → coast → road → waterway (top)
        if (opts.showPark) {
          for (const f of tile.park)
            this.fillRings(f.rings.map((r) => r.map(worldToSub)), 5);
        }
        if (opts.showWater) {
          for (const f of tile.water) {
            const subRings = f.rings.map((r) => r.map(worldToSub));
            this.fillRings(subRings, 3);
            if (opts.showCoast) this.strokeRings(subRings, 1);
          }
        }
        for (const f of tile.road) {
          if (f.rank > opts.roadRankMax) continue;
          const subLines = f.lines.map((r) => r.map(worldToSub));
          if (f.type === 2) {
            for (const line of subLines) this.drawLine(line, 4);
          } else if (f.type === 3) {
            for (const ring of subLines) this.drawLine(ring, 4);
          }
        }
        if (opts.showWaterway) {
          for (const f of tile.waterway)
            for (const line of f.lines.map((r) => r.map(worldToSub)))
              this.drawLine(line, 2);
        }
      }
    }

    this.packCells();
    this.paint();
  }

  // Scanline fill, even-odd rule across all rings
  fillRings(rings, layerId) {
    const edges = [];
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        if (a.y === b.y) continue;
        edges.push(a.y < b.y ? [a.x, a.y, b.x, b.y] : [b.x, b.y, a.x, a.y]);
        if (a.y < yMin) yMin = a.y;
        if (b.y < yMin) yMin = b.y;
        if (a.y > yMax) yMax = a.y;
        if (b.y > yMax) yMax = b.y;
      }
    }
    if (edges.length === 0) return;

    const y0 = Math.max(0, Math.floor(yMin));
    const y1 = Math.min(this.subH - 1, Math.ceil(yMax));

    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      const ints = [];
      for (const e of edges) {
        if (e[1] <= cy && e[3] > cy) {
          const t = (cy - e[1]) / (e[3] - e[1]);
          ints.push(e[0] + t * (e[2] - e[0]));
        }
      }
      ints.sort((a, b) => a - b);
      for (let i = 0; i + 1 < ints.length; i += 2) {
        const xa = Math.max(0, Math.ceil(ints[i] - 0.5));
        const xb = Math.min(this.subW - 1, Math.floor(ints[i + 1] - 0.5));
        const rowOff = y * this.subW;
        for (let x = xa; x <= xb; x++) this.subBuffer[rowOff + x] = layerId;
      }
    }
  }

  strokeRings(rings, layerId) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        this.drawLine([ring[i], ring[i + 1]], layerId);
      }
    }
  }

  // Bresenham — line is an array [p0, p1] or longer polyline
  drawLine(pts, layerId) {
    for (let i = 0; i < pts.length - 1; i++) {
      this.drawSegment(pts[i], pts[i + 1], layerId);
    }
  }

  drawSegment(p0, p1, layerId) {
    let x0 = Math.round(p0.x);
    let y0 = Math.round(p0.y);
    const x1 = Math.round(p1.x);
    const y1 = Math.round(p1.y);
    const dx = Math.abs(x1 - x0);
    const sxStep = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const syStep = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (x0 >= 0 && x0 < this.subW && y0 >= 0 && y0 < this.subH) {
        this.subBuffer[y0 * this.subW + x0] = layerId;
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sxStep; }
      if (e2 <= dx) { err += dx; y0 += syStep; }
    }
  }

  // Walk sub-pixel buffer, build per-cell braille bits + dominant layer
  packCells() {
    // Priority order: coast(1) > waterway(2) > water(3) > road(4) > park(5)
    // Higher priority = lower number here (1 wins over 5)
    for (let cy = 0; cy < this.cellH; cy++) {
      for (let cx = 0; cx < this.cellW; cx++) {
        let bits = 0;
        let bestLayer = 0;
        for (let dx = 0; dx < 2; dx++) {
          for (let dy = 0; dy < 4; dy++) {
            const px = cx * 2 + dx;
            const py = cy * 4 + dy;
            const layer = this.subBuffer[py * this.subW + px];
            if (!layer) continue;
            bits |= BIT[dx][dy];
            if (!bestLayer || layer < bestLayer) bestLayer = layer;
          }
        }
        const idx = cy * this.cellW + cx;
        this.buffer[idx] = bits;
        this.layerBuffer[idx] = bestLayer;
      }
    }
  }

  paint() {
    const ctx = this.ctx;
    const dpr = this.dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.font = `${this.fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textBaseline = 'top';

    const layerToColor = [
      null,
      COLOR.coast,
      COLOR.waterway,
      COLOR.water,
      COLOR.road,
      COLOR.park,
    ];

    // Render one row at a time, breaking into runs by layer color
    for (let cy = 0; cy < this.cellH; cy++) {
      let cx = 0;
      const y = cy * this.lineH;
      while (cx < this.cellW) {
        const idx = cy * this.cellW + cx;
        const layer = this.layerBuffer[idx];
        if (!layer) {
          cx++;
          continue;
        }
        let end = cx;
        let text = '';
        while (end < this.cellW && this.layerBuffer[cy * this.cellW + end] === layer) {
          text += String.fromCharCode(0x2800 + this.buffer[cy * this.cellW + end]);
          end++;
        }
        ctx.fillStyle = layerToColor[layer];
        ctx.fillText(text, cx * this.charW, y);
        cx = end;
      }
    }

    ctx.restore();
  }
}
