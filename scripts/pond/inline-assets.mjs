// assets/pond/ → one JS object literal for a single-file build: images become data URLs, hatch recipes are inlined,
// so the objects are exactly what js/pond/assets.js would produce (the old window.JOURNAL / window.BOOK shapes).
//   import { inlineAssets } from './inline-assets.mjs';  const literal = inlineAssets('assets/pond');
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const dataUrl = (file) => 'data:' + (MIME[extname(file)] || 'application/octet-stream') + ';base64,' + readFileSync(file).toString('base64');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function inlineAssets(dir) {
  const jdir = join(dir, 'journal'), bdir = join(dir, 'book');
  const journal = json(join(jdir, 'journal.json'));
  const rel = (p) => join(jdir, p);
  (journal.notebook || []).forEach((l) => { l.src = dataUrl(rel(l.src)); });
  for (const it of Object.values(journal.items || {})) { it.src = dataUrl(rel(it.src)); if (typeof it.hatch === 'string') it.hatch = json(rel(it.hatch)); }
  (journal.props || []).forEach((p) => { p.src = dataUrl(rel(p.src)); if (typeof p.hatch === 'string') p.hatch = json(rel(p.hatch)); });
  const jh = journal.journalHatch;
  if (jh) { jh.src = dataUrl(rel(jh.src)); if (typeof jh.recipe === 'string') jh.recipe = json(rel(jh.recipe)); if (typeof jh.shadow === 'string') jh.shadow = json(rel(jh.shadow)); }
  const book = json(join(bdir, 'book.json'));
  book.src = dataUrl(join(bdir, book.src)); book.pages = dataUrl(join(bdir, book.pages));
  const config = json(join(dir, 'pond.config.json'));
  // never let the literal close the <script> that carries it
  return JSON.stringify({ journal, book, config }).replace(/<\/script/gi, '<\\/script');
}
