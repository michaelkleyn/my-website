// Materialise the time capsule: frozen design snapshots from git tags into <out>/<dir>/ (committed on the site branch,
// so the host needs no build and no git history). Each snapshot is the tag's tree minus tooling, with a small
// "design iterations" switcher injected into every HTML page, and any node that points at assets outside git removed.
//   node scripts/build-archive.mjs [--out .] [--only v2]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('--out', '.'));
const ONLY = opt('--only', null);

export const SNAPSHOTS = [
  { tag: 'design/v2', dir: 'v2', label: '2026 · the compositor, the butterfly and the ASCII creatures', dropNodes: ['splat-butterfly'], dropComponents: ['splat-butterfly'] },
];
const PRUNE = ['node_modules', '.claude', '.conductor', 'docs', 'scripts', 'tools', 'package.json', 'package-lock.json', 'README.md', '.gitignore',
  '.DS_Store', 'assets/.DS_Store', 'blog/build.js', 'blog/posts', 'blog/package.json', 'blog/package-lock.json', 'blog/chapters.json', 'blog/templates', 'assets/scene/_raw', 'lab'];

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}

for (const snap of SNAPSHOTS) {
  if (ONLY && snap.dir !== ONLY) continue;
  const ref = 'refs/tags/' + snap.tag;
  execFileSync('git', ['rev-parse', '--verify', ref + '^{commit}'], { cwd: ROOT, stdio: 'pipe' });   // fully qualified: a branch of the same name can never win
  const dest = join(OUT, snap.dir);
  rmSync(dest, { recursive: true, force: true }); mkdirSync(dest, { recursive: true });
  execFileSync('sh', ['-c', 'git archive --format=tar "$1" | tar -x -C "$2"', '_', ref, dest], { cwd: ROOT, stdio: 'inherit' });
  for (const p of PRUNE) rmSync(join(dest, p), { recursive: true, force: true });

  // nodes that need assets outside git (the splat PLYs) leave the scene, so the capsule never points at a 404
  const sceneDir = join(dest, 'assets/scene');
  if (existsSync(sceneDir)) {
    for (const f of readdirSync(sceneDir).filter((f) => f.endsWith('.json'))) {
      const path = join(sceneDir, f);
      let scene; try { scene = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
      if (!scene || !Array.isArray(scene.nodes)) continue;
      const before = scene.nodes.length;
      scene.nodes = scene.nodes.filter((n) => !(snap.dropNodes || []).includes(n.id) && !(snap.dropComponents || []).includes(n.component));
      if (scene.nodes.length !== before) writeFileSync(path, JSON.stringify(scene, null, 2) + '\n');
    }
    if (!existsSync(join(sceneDir, '_global.json'))) writeFileSync(join(sceneDir, '_global.json'), JSON.stringify({ page: '_global', version: 1, nodes: [] }, null, 2) + '\n');   // the renderer asks for it; spare the 404
    // the snapshot's renderer derives the page key from the URL: "/v2/" → "v2" — give that key the index scene
    if (existsSync(join(sceneDir, 'index.json')) && !existsSync(join(sceneDir, snap.dir + '.json'))) copyFileSync(join(sceneDir, 'index.json'), join(sceneDir, snap.dir + '.json'));
  }

  // the switcher, once per page (idempotent), before </body>
  const tag = `<script src="/archive/switcher.js" data-iteration="${snap.dir}" defer></script>`;
  let pages = 0;
  for (const f of walk(dest).filter((f) => f.endsWith('.html'))) {
    let html = readFileSync(f, 'utf8');
    if (html.includes('data-iteration=')) continue;
    html = html.includes('</body>') ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, tag + '\n</body>') : html + '\n' + tag + '\n';
    writeFileSync(f, html); pages++;
  }
  const size = walk(dest).reduce((n, f) => n + statSync(f).size, 0);
  console.log(`${snap.dir}: ${snap.tag} → ${dest} (${(size / 1048576).toFixed(1)} MB, switcher in ${pages} pages)`);
}

// the switcher itself, with the manifest inlined (no fetch)
const manifest = SNAPSHOTS.map((s) => ({ id: s.dir, label: s.label, path: '/' + s.dir + '/' }));
const src = readFileSync(join(ROOT, 'js/site/archive-switcher.js'), 'utf8').replace('__ITERATIONS__', JSON.stringify(manifest));
mkdirSync(join(OUT, 'archive'), { recursive: true });
writeFileSync(join(OUT, 'archive/switcher.js'), src);
console.log('archive/switcher.js written');
