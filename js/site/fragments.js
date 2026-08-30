// Page fragments: content/pages/<page>.html (HTML without scripts), cached; an inline <template data-page="x"> wins
// when present (single-file builds). Returns a fresh DocumentFragment each time.

const cache = new Map();
const BASE = (document.documentElement.dataset.contentBase || '/content/pages/');

async function fetchText(page) {
  const inline = document.querySelector('template[data-page="' + page + '"]');
  if (inline) return inline.innerHTML;
  const r = await fetch(BASE + page + '.html', { cache: 'no-cache' });
  if (!r.ok) throw new Error('fragment ' + page + ' → HTTP ' + r.status);
  return r.text();
}

export async function loadFragment(page) {
  if (!cache.has(page)) cache.set(page, fetchText(page).catch((e) => { cache.delete(page); throw e; }));
  const html = await cache.get(page);
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('script').forEach((s) => s.remove());
  return t.content.cloneNode(true);
}

export function prefetchFragment(page) { loadFragment(page).catch(() => {}); }
