// npm run check — the end-to-end checks, headless. Needs the dev server on 5173 (npm run dev) and Chrome.
//   node scripts/check.mjs [--lab] [--file] [--only <name>]
// Each check drives scripts/pond/shot.mjs and asserts on the JSON its POST expression returns.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SITE || 'http://127.0.0.1:5173';
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
mkdirSync(join(ROOT, 'out/check'), { recursive: true });

const SITE_READY = "document.documentElement.classList.contains('site-ready') && window.__site && __site.pond.ready ? 1 : 0";
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function shot(name, url, ready, post, extra = []) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/pond/shot.mjs'), url, join(ROOT, 'out/check', name), '--wait', '150000', '--ready', ready, '--post', post, '--post-wait', '400', ...extra], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  const line = out.split('\n').find((l) => l.startsWith('POST: '));
  const ready1 = /ready=1/.test(out);
  const exceptions = out.split('\n').filter((l) => l.startsWith('EXCEPTION')).map((l) => l.slice(0, 160));
  let data = null; try { data = line ? JSON.parse(JSON.parse(line.slice(6))) : null; } catch { data = null; }
  return { ready: ready1, data, exceptions, out };
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('server', async () => {
  const ping = await fetch(BASE + '/__editor/ping').then((r) => r.json()).catch(() => null);
  const spa = await fetch(BASE + '/projects', { method: 'HEAD', headers: { Accept: 'text/html' } }).then((r) => r.status);
  const missing = await fetch(BASE + '/nope.png').then((r) => r.status);
  const api404 = await fetch(BASE + '/__editor/nope').then((r) => r.status);
  return { ok: !!(ping && ping.ok) && spa === 200 && missing === 404 && api404 === 404, detail: { ping, spa, missing, api404 } };
});

check('site-visitor', async () => {
  const s = shot('site-visitor', BASE + '/?edit=0', SITE_READY, "(function(){ var s = __site, bs = document.getElementById('book-space').getBoundingClientRect(), f = s.pond.screenFit, hp = document.querySelector('[data-node=hero] p'); return JSON.stringify({ rect: [bs.left, bs.top, bs.width, bs.height], expect: [f.x, f.y, f.s*1536, f.s*1024], ink: getComputedStyle(hp).color, panel: !!document.querySelector('#panel'), editor: !!document.querySelector('#le-root'), atlas: !!(s.pond.school.atlas && s.pond.school.atlas.prerendered), world: [s.pond.school.W, s.pond.school.H] }); })()");
  const d = s.data || {};
  const aligned = d.rect && d.rect.every((v, i) => near(v, d.expect[i], 1));
  return { ok: s.ready && aligned && d.ink === 'rgb(43, 58, 72)' && !d.panel && !d.editor && d.world[0] > 400, detail: { ready: s.ready, aligned, ink: d.ink, panel: d.panel, editor: d.editor, atlas: d.atlas, world: d.world, exceptions: s.exceptions } };
});

check('site-design-mode', async () => {
  const s = shot('site-edit', BASE + '/', SITE_READY, "JSON.stringify({ panel: !!document.querySelector('#panel'), editor: !!document.querySelector('#le-root'), panelW: (document.querySelector('#panel')||{}).offsetWidth, world: [__site.pond.school.W, __site.pond.school.H] })");
  const d = s.data || {};
  return { ok: s.ready && d.panel && d.editor && d.panelW === 348 && d.world[0] > 400, detail: { ...d, exceptions: s.exceptions } };
});

check('site-navigate', async () => {
  const s = shot('site-nav', BASE + '/?edit=0', SITE_READY, "(async function(){ var s = __site, f0 = s.pond.frameCount; await s.router.go('/projects'); await s.navigator.idle(); var bs = document.getElementById('book-space').getBoundingClientRect(), f = s.pond.screenFit; return JSON.stringify({ path: location.pathname, page: s.renderer.pageKey(), spread: document.querySelector('#spread').dataset.page, zoom: s.pond.camera.zoom, rect: [bs.left, bs.top, bs.width, bs.height], expect: [f.x, f.y, f.s*1536, f.s*1024], frames: s.pond.frameCount - f0, active: (document.querySelector('nav a.is-active')||{}).textContent }); })()");
  const d = s.data || {};
  const aligned = d.rect && d.rect.every((v, i) => near(v, d.expect[i], 1));
  return { ok: s.ready && d.path === '/projects' && d.page === 'projects' && d.spread === 'projects' && near(d.zoom, 1.45, 0.01) && aligned && d.frames > 0 && d.active === 'projects', detail: { ...d, aligned, exceptions: s.exceptions } };
});

check('site-direct-route', async () => {
  const s = shot('site-direct', BASE + '/projects?edit=0', SITE_READY, "JSON.stringify({ path: location.pathname, page: __site.renderer.pageKey(), spread: document.querySelector('#spread').dataset.page, zoom: __site.pond.camera.zoom })");
  const d = s.data || {};
  return { ok: s.ready && d.page === 'projects' && d.spread === 'projects' && near(d.zoom, 1.45, 0.01), detail: { ...d, exceptions: s.exceptions } };
});

check('capsule-v2', async () => {
  const s = shot('v2', BASE + '/v2/', "(window.sceneRenderer && document.querySelectorAll('.scene-layer [data-node-id]').length >= 2 && document.getElementById('design-iterations')) ? 1 : 0", "JSON.stringify({ page: sceneRenderer.pageKey(), nodes: document.querySelectorAll('.scene-layer [data-node-id]').length, switcher: !!document.getElementById('design-iterations'), bad: [] })");
  const d = s.data || {};
  const bad = (s.out.match(/^(404|FAILED) .*$/gm) || []).filter((l) => !/favicon/.test(l));
  return { ok: s.ready && d.page === 'v2' && d.nodes >= 2 && d.switcher && bad.length === 0, detail: { ...d, bad, exceptions: s.exceptions } };
});

check('blog-post', async () => {
  const s = shot('blog-post', BASE + '/blog/memory-bandwidth?edit=0', SITE_READY, "(async function(){ await __site.navigator.idle(); await new Promise(function(r){ setTimeout(r, 800); }); var m = document.getElementById('site-modal'); return JSON.stringify({ path: location.pathname, page: __site.renderer.pageKey(), open: !!(m && !m.hidden), reading: !!(m && m.classList.contains('reading')), title: (document.querySelector('#site-modal .post h1')||{}).textContent, list: document.querySelectorAll('#spread .posts li').length }); })()");
  const d = s.data || {};
  return { ok: s.ready && d.page === 'blog' && d.open && d.reading && !!d.title && d.list >= 1, detail: { ...d, exceptions: s.exceptions } };
});

if (argv.includes('--lab')) check('lab-parity', async () => {
  const post = readFileSync(join(ROOT, 'scripts/pond/parity-post.js'), 'utf8');
  const s = shot('lab', BASE + '/lab/boids-lab.html?det=7&freeze=240', "(window.BoidsLab && BoidsLab.school.atlas && !/painting/.test(document.querySelector('#status').textContent)) ? 1 : 0", post);
  const basePath = join(ROOT, 'out/parity/base.json');
  if (!existsSync(basePath)) return { ok: false, detail: 'no baseline at out/parity/base.json' };
  const base = JSON.parse(readFileSync(basePath, 'utf8')); const d = s.data || {};
  delete base.fishHash; delete d.fishHash;
  const same = JSON.stringify(base) === JSON.stringify(d);
  const diff = same ? [] : Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(d[k]));
  return { ok: s.ready && same, detail: { same, diff, exceptions: s.exceptions } };
});

if (argv.includes('--file')) check('artifact-file', async () => {
  const f = join(ROOT, 'dist/lab.html');
  if (!existsSync(f)) return { ok: false, detail: 'run npm run build:lab first' };
  const s = shot('file', 'file://' + f, "(window.BoidsLab && BoidsLab.school.atlas) ? 1 : 0", "JSON.stringify({ atlas: [BoidsLab.school.atlas.canvas.width, BoidsLab.school.atlas.canvas.height], fit: BoidsLab.Book.fit.s })");
  const d = s.data || {};
  return { ok: s.ready && d.atlas && d.atlas[1] > 1000 && d.fit > 0, detail: { ...d, exceptions: s.exceptions } };
});

let failed = 0;
for (const c of checks) {
  if (only && c.name !== only) continue;
  const t0 = Date.now();
  let r; try { r = await c.fn(); } catch (e) { r = { ok: false, detail: String(e) }; }
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(18)} ${((Date.now() - t0) / 1000).toFixed(0)}s  ${JSON.stringify(r.detail).slice(0, 220)}`);
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
