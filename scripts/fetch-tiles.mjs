import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// OpenFreeMap: fully free, no API key, OpenMapTiles schema.
// https://openfreemap.org/quick_start/
// The planet dataset is versioned by date — fetch TileJSON to get the live URL template.
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

async function getTileUrlTemplate() {
  const res = await fetch(TILEJSON_URL);
  if (!res.ok) throw new Error(`TileJSON HTTP ${res.status}`);
  const json = await res.json();
  return json.tiles[0]; // e.g. https://.../planet/20260408_001001_pt/{z}/{x}/{y}.pbf
}

let TILE_URL_TEMPLATE = null;
const TILE_URL = (z, x, y) =>
  TILE_URL_TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y);

const CITIES = [
  {
    slug: 'sf',
    label: 'San Francisco',
    lon: -122.4194,
    lat: 37.7749,
    zoom: 12,
    // Asymmetric: lean heavy on the Pacific so SF feels perched on the edge.
    bbox: { west: 7, east: 3, north: 3, south: 4 },
  },
  {
    slug: 'south-bend',
    label: 'South Bend, WA',
    lon: -123.8045,
    lat: 46.6643,
    zoom: 14,
    radius: 1,
  },
];

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

async function fetchTile(z, x, y, outPath) {
  const url = TILE_URL(z, x, y);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'mkleyn.com tile spike (michaelkleyn@gmail.com)' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
  return buf.length;
}

TILE_URL_TEMPLATE = await getTileUrlTemplate();
console.log(`Tile URL template: ${TILE_URL_TEMPLATE}`);

for (const city of CITIES) {
  const center = lonLatToTile(city.lon, city.lat, city.zoom);
  const dir = join(ROOT, 'assets', 'tiles', city.slug);
  await mkdir(dir, { recursive: true });

  console.log(
    `\n${city.label} — z${city.zoom}, center tile (${center.x}, ${center.y})`
  );

  const meta = {
    label: city.label,
    lon: city.lon,
    lat: city.lat,
    zoom: city.zoom,
    center,
    tiles: [],
  };

  // Determine grid extents — radius (symmetric) or bbox (asymmetric)
  const west  = city.bbox?.west  ?? city.radius;
  const east  = city.bbox?.east  ?? city.radius;
  const north = city.bbox?.north ?? city.radius;
  const south = city.bbox?.south ?? city.radius;

  for (let dx = -west; dx <= east; dx++) {
    for (let dy = -north; dy <= south; dy++) {
      const x = center.x + dx;
      const y = center.y + dy;
      const file = `${city.zoom}-${x}-${y}.pbf`;
      const out = join(dir, file);
      try {
        const bytes = await fetchTile(city.zoom, x, y, out);
        meta.tiles.push({ x, y, file, bytes });
        console.log(`  ${file}  ${bytes.toLocaleString()} bytes`);
      } catch (err) {
        console.error(`  ${file}  FAILED: ${err.message}`);
      }
    }
  }

  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify(meta, null, 2) + '\n'
  );
}
