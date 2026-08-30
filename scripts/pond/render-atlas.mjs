// Pre-render the fish atlas for the site config with headless Chrome, so visitors never wait for p5.brush.
//   node scripts/pond/render-atlas.mjs [--url http://127.0.0.1:5173/lab/render.html] [--gpu] [--out assets/pond]
// Writes assets/pond/atlas/<key>.webp + <key>.json; the pond uses them only when its config still hashes to <key>.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const url = opt('--url', 'http://127.0.0.1:5173/lab/render.html');
const out = resolve(ROOT, opt('--out', 'assets/pond'));
const gpu = argv.includes('--gpu');

const POST = "(function(){ var a = window.pond && window.pond.exportAtlas(0.92); return a ? JSON.stringify(a) : null; })()";
const READY = "(window.pond && window.pond.ready) ? 1 : 0";
const args = [join(ROOT, 'scripts/pond/shot.mjs'), url, join(ROOT, 'out/render-atlas'), '--ready', READY, '--post', POST, '--post-wait', '100', '--wait', '300000'];
if (gpu) args.push('--gpu');
mkdirSync(join(ROOT, 'out'), { recursive: true });
const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const line = (r.stdout || '').split('\n').find((l) => l.startsWith('POST: '));
if (!line) { console.error(r.stdout, r.stderr); throw new Error('no atlas exported (is the dev server running on 5173?)'); }
const atlas = JSON.parse(JSON.parse(line.slice(6)));
if (!atlas) throw new Error('pond had no atlas');
const { dataUrl, ...meta } = atlas;
const b64 = dataUrl.split(',')[1];
mkdirSync(join(out, 'atlas'), { recursive: true });
writeFileSync(join(out, 'atlas', meta.key + '.webp'), Buffer.from(b64, 'base64'));
meta.src = meta.key + '.webp'; meta.backend = gpu ? 'gpu' : 'swiftshader'; meta.generatedAt = new Date().toISOString();
writeFileSync(join(out, 'atlas', meta.key + '.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`atlas ${meta.key}: ${meta.w}×${meta.h}, ${meta.variants} variants, ${(b64.length * 0.75 / 1024).toFixed(0)} KB → ${join(out, 'atlas')}`);
