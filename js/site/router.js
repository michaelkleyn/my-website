// A small SPA router (History API). It intercepts only same-origin links whose path is in the route table —
// everything else (PDFs, /v2/…, externals) is a normal navigation.
import { matchRoute } from './routes.js';

export function createRouter(opts) {
  opts = opts || {};
  const onNavigate = opts.onNavigate || function () {};
  let current = null;

  function canonical(path) { path = path.replace(/\/+$/, ''); return path === '' ? '/' : path; }
  function write(path, replace) {
    if (replace) history.replaceState({ path }, '', path); else history.pushState({ path }, '', path);
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
    if (!resolve(url.pathname)) return;
    e.preventDefault();
    go(url.pathname);
  }
  function onPop() { go(location.pathname, { popstate: true }); }

  return {
    start() {
      document.addEventListener('click', onClick);
      window.addEventListener('popstate', onPop);
      const path = location.pathname;
      const m = resolve(path);
      if (m && canonical(path) !== path) write(canonical(path), true);
      return go(m ? path : '/', { initial: true, replace: true });
    },
    go,
    resolve,
    current() { return current; },
  };
}
