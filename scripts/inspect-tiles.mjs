import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TILES_DIR = join(ROOT, 'assets', 'tiles');

const cities = await readdir(TILES_DIR);

for (const city of cities) {
  const cityDir = join(TILES_DIR, city);
  const files = (await readdir(cityDir)).filter((f) => f.endsWith('.pbf'));
  console.log(`\n=== ${city} (${files.length} tiles) ===`);

  // Aggregate layer/feature counts across all tiles in the city
  const totals = new Map();
  for (const file of files) {
    const buf = await readFile(join(cityDir, file));
    const tile = new VectorTile(new Pbf(buf));
    for (const [name, layer] of Object.entries(tile.layers)) {
      const t = totals.get(name) || { features: 0, geomTypes: new Set(), classes: new Set() };
      t.features += layer.length;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        t.geomTypes.add(['Unknown', 'Point', 'LineString', 'Polygon'][f.type]);
        if (f.properties.class) t.classes.add(f.properties.class);
      }
      totals.set(name, t);
    }
  }

  // Sort by feature count desc
  const sorted = [...totals.entries()].sort((a, b) => b[1].features - a[1].features);
  for (const [layer, t] of sorted) {
    const classes = [...t.classes].slice(0, 8).join(', ');
    const more = t.classes.size > 8 ? ` +${t.classes.size - 8} more` : '';
    console.log(
      `  ${layer.padEnd(20)} ${String(t.features).padStart(5)} features  [${[...t.geomTypes].join('|')}]  classes: ${classes}${more}`
    );
  }
}
