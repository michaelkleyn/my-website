// Asset loaders. Manifests in assets/pond/ reference files by relative path; these resolve them against the
// manifest URL and inline the hatch recipes, so the objects look exactly like the old window.JOURNAL / window.BOOK.
// A single-file build sets globalThis.POND_ASSETS (data URLs, recipes inline) and nothing here fetches.

export function fromInline() { return (typeof globalThis !== 'undefined' && globalThis.POND_ASSETS) || null; }

async function getJSON(url) {
  var r = await fetch(url);
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  return r.json();
}
function absolute(base, p) { return new URL(p, base).href; }

/** The compiled journal: notebook layers, page-turn items (+ hatch recipes), props (+ recipes), sequences, journalHatch. */
export async function loadJournal(url) {
  var inline = fromInline(); if (inline && inline.journal) return inline.journal;
  var base = absolute(location.href, url), m = await getJSON(base);
  var abs = function (p) { return absolute(base, p); };
  var recipe = function (p) { return typeof p === 'string' ? getJSON(abs(p)) : Promise.resolve(p); };
  var jobs = [];
  (m.notebook || []).forEach(function (l) { l.src = abs(l.src); });
  Object.keys(m.items || {}).forEach(function (k) {
    var it = m.items[k]; it.src = abs(it.src);
    if (it.hatch) jobs.push(recipe(it.hatch).then(function (r) { it.hatch = r; }));
  });
  (m.props || []).forEach(function (p) {
    p.src = abs(p.src);
    if (p.hatch) jobs.push(recipe(p.hatch).then(function (r) { p.hatch = r; }));
  });
  var jh = m.journalHatch;
  if (jh) {
    jh.src = abs(jh.src);
    if (jh.recipe) jobs.push(recipe(jh.recipe).then(function (r) { jh.recipe = r; }));
    if (jh.shadow) jobs.push(recipe(jh.shadow).then(function (r) { jh.shadow = r; }));
  }
  await Promise.all(jobs);
  return m;
}

/** The journal photo (cut-out, with alpha) and its page masks. */
export async function loadBook(url) {
  var inline = fromInline(); if (inline && inline.book) return inline.book;
  var base = absolute(location.href, url), b = await getJSON(base);
  b.src = absolute(base, b.src); b.pages = absolute(base, b.pages);
  return b;
}

/** The approved config (normalised by the pond when it boots). */
export async function loadConfig(url) {
  var inline = fromInline(); if (inline && inline.config) return inline.config;
  return getJSON(absolute(location.href, url));
}

/** A pre-rendered fish atlas for `key`, or null when there is none (never throws). */
export async function loadAtlas(base, key) {
  var inline = fromInline(); if (inline) return (inline.atlas && inline.atlas.key === key) ? inline.atlas : null;
  try {
    var url = absolute(location.href, base + 'atlas/' + key + '.json'), meta = await getJSON(url);
    if (meta.key !== key) return null;
    meta.src = absolute(url, meta.src);
    return meta;
  } catch (e) { return null; }
}

/** Everything the pond needs from assets/pond/<base>/: { journal, book, config }. */
export async function loadPondAssets(base) {
  base = base || 'assets/pond/';
  if (base && !/\/$/.test(base)) base += '/';
  var r = await Promise.all([loadJournal(base + 'journal/journal.json'), loadBook(base + 'book/book.json'), loadConfig(base + 'pond.config.json')]);
  return { journal: r[0], book: r[1], config: r[2] };
}
