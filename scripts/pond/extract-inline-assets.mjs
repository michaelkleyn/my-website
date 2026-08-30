#!/usr/bin/env node
// Pull the pond's inline data out of lab/boids-lab.html into files, byte-exactly.
//
//   <script id="journal-data">window.JOURNAL = {…};</script>  →  assets/pond/journal/journal.json + notebook/ items/ props/ hatch/
//   <script id="book-data">window.BOOK = {…};</script>        →  assets/pond/book/book.json + book.webp + pages.png
//
// Every data URL becomes a file (bytes decoded from base64, extension from the mime); every hatch recipe
// becomes a JSON file; the manifests keep every other field verbatim and in the same key order, with `src`
// and recipe fields turned into paths relative to the manifest. `--verify` re-reads everything written and
// checks that rehydrating the manifests reproduces the original objects deep-equal (and every data URL string
// exactly). `--config` additionally loads the lab headlessly (dev server on 5173), applies lab/configs/koi-v5.json
// and writes the NORMALIZED config to assets/pond/pond.config.json.
//
//   node scripts/pond/extract-inline-assets.mjs [--verify] [--config] [--lab lab/boids-lab.html] [--out assets/pond]
//
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const LAB = resolve(REPO, opt('--lab', 'lab/boids-lab.html'));
const OUT = resolve(REPO, opt('--out', 'assets/pond'));
const EXT = { 'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

const html = readFileSync(LAB, 'utf8');
if (!html.includes('<script id="journal-data">')) {
  console.error('No <script id="journal-data"> in ' + LAB + ' — the inline blobs are gone (already extracted?). Nothing to do.');
  process.exit(1);
}
function grab(id, global) {
  const m = html.match(new RegExp('<script id="' + id + '">window\\.' + global + ' = (.*?);</script>'));
  if (!m) throw new Error('blob ' + id + ' not found');
  return JSON.parse(m[1]);
}
const JOURNAL = grab('journal-data', 'JOURNAL');
const BOOK = grab('book-data', 'BOOK');

const written = []; // { path, bytes, dataUrl? , json? }
function writeDataUrl(dataUrl, relBase) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('not a base64 data URL for ' + relBase);
  const ext = EXT[m[1]]; if (!ext) throw new Error('unknown mime ' + m[1] + ' for ' + relBase);
  const rel = relBase + ext, abs = join(OUT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const bytes = Buffer.from(m[2], 'base64');
  writeFileSync(abs, bytes);
  written.push({ path: rel, bytes: bytes.length, dataUrl });
  return rel;
}
function writeJson(obj, rel) {
  const abs = join(OUT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const text = JSON.stringify(obj);
  writeFileSync(abs, text + '\n');
  written.push({ path: rel, bytes: text.length + 1, json: obj });
  return rel;
}
const relTo = (manifestDir, rel) => rel.slice(manifestDir.length + 1); // path relative to the manifest's directory

// ---- journal --------------------------------------------------------------
const J = {};
for (const [k, v] of Object.entries(JOURNAL)) {
  if (k === 'notebook') J.notebook = v.map((layer) => remap(layer, { src: 'journal/notebook/' + layer.name }));
  else if (k === 'items') J.items = Object.fromEntries(Object.entries(v).map(([id, it]) => [id, remap(it, { src: 'journal/items/' + id, hatch: 'journal/hatch/' + id })]));
  else if (k === 'props') J.props = v.map((p) => remap(p, { src: 'journal/props/' + p.name, hatch: 'journal/hatch/' + p.name }));
  else if (k === 'journalHatch') J.journalHatch = remap(v, { src: 'journal/props/journal-flat', recipe: 'journal/hatch/journal-flat', shadow: 'journal/hatch/journal-shadow' });
  else J[k] = v; // W, H, sequences — verbatim
}
function remap(obj, targets) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (targets[k] !== undefined && typeof v === 'string' && v.startsWith('data:')) out[k] = relTo('journal', writeDataUrl(v, targets[k]));
    else if (targets[k] !== undefined && v && typeof v === 'object') out[k] = relTo('journal', writeJson(v, targets[k] + '.json'));
    else out[k] = v;
  }
  return out;
}
mkdirSync(join(OUT, 'journal'), { recursive: true });
writeFileSync(join(OUT, 'journal', 'journal.json'), JSON.stringify(J, null, 1) + '\n');

// ---- book -----------------------------------------------------------------
const Bk = {};
for (const [k, v] of Object.entries(BOOK)) {
  if ((k === 'src' || k === 'pages') && typeof v === 'string' && v.startsWith('data:')) Bk[k] = relTo('book', writeDataUrl(v, 'book/' + (k === 'src' ? 'book' : 'pages')));
  else Bk[k] = v;
}
writeFileSync(join(OUT, 'book', 'book.json'), JSON.stringify(Bk, null, 1) + '\n');

const total = written.reduce((s, w) => s + w.bytes, 0);
console.log(`wrote ${written.length} files (${(total / 1024).toFixed(0)} KB) + journal/journal.json + book/book.json under ${OUT}`);

// ---- verify ---------------------------------------------------------------
if (flag('--verify')) {
  let bad = 0;
  for (const w of written) {
    const abs = join(OUT, w.path), bytes = readFileSync(abs);
    if (w.dataUrl) {
      const back = 'data:' + MIME[extname(w.path)] + ';base64,' + bytes.toString('base64');
      if (back !== w.dataUrl) { bad++; console.error('data URL mismatch: ' + w.path); }
    } else if (JSON.stringify(JSON.parse(bytes.toString('utf8'))) !== JSON.stringify(w.json)) { bad++; console.error('json mismatch: ' + w.path); }
  }
  const hydrate = (manifestDir, node) => {
    if (typeof node === 'string' && /\.(webp|png|jpg|gif|json)$/.test(node) && existsSync(join(OUT, manifestDir, node))) {
      const abs = join(OUT, manifestDir, node);
      if (node.endsWith('.json')) return JSON.parse(readFileSync(abs, 'utf8'));
      return 'data:' + MIME[extname(node)] + ';base64,' + readFileSync(abs).toString('base64');
    }
    if (Array.isArray(node)) return node.map((n) => hydrate(manifestDir, n));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, hydrate(manifestDir, v)]));
    return node;
  };
  const jBack = hydrate('journal', JSON.parse(readFileSync(join(OUT, 'journal', 'journal.json'), 'utf8')));
  const bBack = hydrate('book', JSON.parse(readFileSync(join(OUT, 'book', 'book.json'), 'utf8')));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(jBack, JOURNAL)) { bad++; console.error('journal.json does not round-trip'); }
  if (!same(bBack, BOOK)) { bad++; console.error('book.json does not round-trip'); }
  console.log(bad ? `VERIFY FAILED (${bad})` : `verify ok: ${written.length} files round-trip exactly; journal.json and book.json rehydrate deep-equal (${Object.keys(JOURNAL.items).length} items, ${JOURNAL.props.length} props, ${JOURNAL.notebook.length} layers)`);
  if (bad) process.exit(1);
}

// ---- normalized config via the headless lab -------------------------------
if (flag('--config')) {
  const cfgPath = resolve(REPO, opt('--from', 'lab/configs/koi-v5.json'));
  const cfg = JSON.stringify(JSON.parse(readFileSync(cfgPath, 'utf8')));
  const url = opt('--url', 'http://127.0.0.1:5173/lab/boids-lab.html');
  mkdirSync(join(REPO, 'out'), { recursive: true });
  const pre = `(function(){ var ta = document.querySelector('#json'); ta.value = ${JSON.stringify(cfg)}; document.querySelector('#btn-apply').click(); return Object.keys(window.BoidsLab.P).length; })()`;
  const post = 'JSON.stringify(window.BoidsLab.P)';
  console.log('loading the lab headlessly to normalize ' + cfgPath + ' …');
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'pond', 'shot.mjs'), url, join(REPO, 'out', 'extract-config'), '--pre', pre, '--post', post], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('POST: '));
  if (!line) { console.error('headless run produced no POST line:\n' + (r.stdout || '') + (r.stderr || '')); process.exit(1); }
  const P = JSON.parse(JSON.parse(line.slice(6)));
  const target = join(OUT, 'pond.config.json');
  writeFileSync(target, JSON.stringify(P, null, 2) + '\n');
  const before = JSON.parse(cfg);
  const added = Object.keys(P).filter((k) => !(k in before)), changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(P[k]));
  console.log(`pond.config.json: ${Object.keys(P).length} keys (${statSync(target).size} bytes); added by normalize: ${added.join(', ') || 'none'}; changed: ${changed.join(', ') || 'none'}`);
}
