// bootPond — everything the site needs to put the pond on a page: load the manifests, the config and (when its key
// still matches) the pre-rendered atlas, mount the visitor UI, create the pond; in design mode also load the panel.
//
//   const pond = await bootPond({ canvas, journalRoot, root, assetsBase: '/assets/pond/', edit: isEditEnvironment() });
//
import { createPond } from './pond.js';
import { loadJournal, loadBook, loadConfig, loadAtlas } from './assets.js';
import { atlasKey } from './style.js';
import { normalize } from './presets.js';
import { Painter } from './painter.js';
import { mountVisitorDom } from './visitors/visitors-dom.js';

export async function bootPond(opts) {
  opts = opts || {};
  var base = opts.assetsBase || 'assets/pond/';
  if (!/\/$/.test(base)) base += '/';
  var journalP = loadJournal(base + 'journal/journal.json');
  var bookP = loadBook(base + 'book/book.json');
  var configP = opts.config ? Promise.resolve(opts.config) : loadConfig(opts.configUrl || (base + 'pond.config.json'));
  var config = await configP;
  var key = atlasKey(normalize(JSON.parse(JSON.stringify(config))), Painter.MAXW + 'x' + Painter.MAXH);
  var atlasP = opts.paintOnClient === 'always' ? Promise.resolve(null) : loadAtlas(base, key);
  var r = await Promise.all([journalP, bookP, atlasP]);
  var root = opts.root || document.body;
  if (opts.visitors !== false) mountVisitorDom(opts.visitorRoot || root);
  var pond = createPond({
    canvas: opts.canvas, journalRoot: opts.journalRoot, root: root,
    config: config, presetId: opts.presetId === undefined ? null : opts.presetId,
    assets: { journal: r[0], book: r[1], atlas: r[2] },
    insets: opts.insets, remote: opts.remote, visitors: opts.visitors !== false, visitorRoot: opts.visitorRoot,
    paintOnClient: opts.paintOnClient, respectReducedMotion: opts.respectReducedMotion,
  });
  if (opts.edit) {
    try { var panel = await import('../lab/panel.js'); if (panel && panel.mountPanel) panel.mountPanel(pond, opts.panel || {}); }
    catch (e) { console.warn('design mode panel unavailable:', e); }
  }
  return pond;
}
