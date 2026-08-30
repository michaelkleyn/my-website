// Build the Painted Boids Lab as ONE self-contained HTML file (dist/lab.html) for publishing as a claude.ai
// artifact: the module graph bundled with esbuild, assets/pond inlined as data URLs, the vendored p5.brush and the
// stylesheets inlined. The sandbox blocks every fetch, so nothing in the output may load anything but Google Fonts.
//   node scripts/build-lab.mjs [--out dist/lab.html]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { inlineAssets } from './pond/inline-assets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const OUT = resolve(ROOT, outArg > 0 ? process.argv[outArg + 1] : 'dist/lab.html');
const LIMIT = 15 * 1024 * 1024;

const html = readFileSync(join(ROOT, 'lab/boids-lab.html'), 'utf8');
const r = await build({ entryPoints: [join(ROOT, 'js/lab/main.js')], bundle: true, format: 'iife', target: 'es2019', write: false, logLevel: 'warning', legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const assets = inlineAssets(join(ROOT, 'assets/pond'));

let out = html, hits = 0;
out = out.replace(/<link rel="stylesheet" href="\.\.\/css\/([^"]+)">/g, (m, f) => { hits++; return '<style>\n' + readFileSync(join(ROOT, 'css', f), 'utf8') + '\n</style>'; });
out = out.replace(/<script src="\.\.\/js\/vendor\/([^"]+)"><\/script>/g, (m, f) => { hits++; return '<script>\n' + readFileSync(join(ROOT, 'js/vendor', f), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>'; });
const entry = '<script type="module" src="../js/lab/main.js"></script>';
if (!out.includes(entry)) throw new Error('lab/boids-lab.html has no module entry tag: ' + entry);
out = out.replace(entry, '<script>window.POND_ASSETS = ' + assets + ';</script>\n<script>\n' + js + '\n</script>'); hits++;
if (/<script id="(journal|book)-data">/.test(out)) throw new Error('inline data blobs still present in lab/boids-lab.html — run the asset step first');
if (/src="\.\.\//.test(out) || /href="\.\.\//.test(out)) throw new Error('relative references remain in the built page');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
const mb = (out.length / 1048576).toFixed(2);
console.log(`dist: ${OUT} — ${mb} MB (${hits} replacements; bundle ${(js.length / 1024).toFixed(0)} KB, assets ${(assets.length / 1048576).toFixed(2)} MB)`);
if (out.length > LIMIT) { console.error('over the 15 MB limit'); process.exit(1); }
