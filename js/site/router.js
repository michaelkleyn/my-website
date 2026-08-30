// A small SPA router: History API on the site, hash mode for single-file builds. It intercepts only same-origin
// links whose path is in the route table — everything else (PDFs, /v2/…, externals) is a normal navigation.
import { matchRoute } from './routes.js';

export function createRouter(opts) {
  opts = opts || {};
  const mode = opts.mode || (document.documentElement.dataset.router || (location.protocol === 'file:' ? 'hash' : 'history'));
  const onNavigate = opts.onNavigate || function () {};
  let current = null;

  function readPath() {
    if (mode === 'hash') { const h = location.hash.replace(/^#/, ''); return h.startsWith('/') ? h : '/' + h; }
    return location.pathname;
  }
  function canonical(path) { path = path.replace(/\/+$/, ''); return path === '' ? '/' : path; }
  function write(path, replace) {
    if (mode === 'hash') { const h = '#' + path; if (replace) history.replaceState({ path }, '', h); else history.pushState({ path }, '', h); }
    else if (replace) history.replaceState({ path }, '', path); else history.pushState({ path }, '', path);
  }

  function resolve(path) { return matchRoute(canonical(path)); }

  function go(path, o) {
    o = o || {};
    path = canonical(path);
    const m = resolve(path);
    if (!m) { location.href = path; return Promise.resolve(false); }
    if (!o.popstate) write(path, !!o.replace);
    const prev = current; current = { path, route: m.route, params: m.params };
    return Promise.resolve(onNavigate(current, { prev, initial: !!o.initial, popstate: !!o.popstate })).then(() => true);
  }

  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-no-router')) return;
    const url = new URL(a.getAttribute('href'), location.href);
    if (url.origin !== location.origin) return;
    const path = mode === 'hash' ? (url.hash ? url.hash.replace(/^#/, '') : url.pathname) : url.pathname;
    if (!resolve(path)) return;
    e.preventDefault();
    go(path);
  }
  function onPop() { go(readPath(), { popstate: true }); }

  return {
    mode,
    start() {
      document.addEventListener('click', onClick);
      window.addEventListener(mode === 'hash' ? 'hashchange' : 'popstate', onPop);
      const path = readPath();
      const m = resolve(path);
      if (m && canonical(path) !== path) write(canonical(path), true);
      return go(m ? path : '/', { initial: true, replace: true });
    },
    go,
    resolve,
    current() { return current; },
  };
}
