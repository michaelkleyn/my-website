// The route table. Importable from Node (no DOM at module top level) so build scripts can read it too.
// `page` is the scene key (assets/scene/<page>.json) and the fragment (content/pages/<page>.html);
// `spread` orders the journal's spreads so navigation knows which way to flip.

export const ROUTES = [
  { path: '/', page: 'index', spread: 0, title: 'Michael Kleyn' },
  { path: '/work', page: 'work', spread: 1, title: 'Work · Michael Kleyn' },
  { path: '/projects', page: 'work', spread: 1, title: 'Work · Michael Kleyn' },        // the old address
  { path: '/blog', page: 'blog', spread: 2, title: 'Blog · Michael Kleyn' },
  { path: '/blog/:slug', page: 'blog', spread: 2, open: 'post', title: 'Blog · Michael Kleyn' },
  { path: '/about', page: 'about', spread: 3, title: 'About · Michael Kleyn' },
  { path: '/contact', page: 'about', spread: 3, title: 'About · Michael Kleyn' },       // the old address
  { path: '/iterations', page: 'iterations', spread: 4, title: 'Iterations · Michael Kleyn' },
];

function segments(path) {
  return String(path || '/').replace(/\/+$/, '').split('/').filter(Boolean);
}

/** Match a pathname against the table → { route, params } or null. */
export function matchRoute(pathname) {
  const want = segments(pathname);
  for (const route of ROUTES) {
    const have = segments(route.path);
    if (have.length !== want.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < have.length; i++) {
      if (have[i].startsWith(':')) params[have[i].slice(1)] = decodeURIComponent(want[i]);
      else if (have[i].toLowerCase() !== want[i].toLowerCase()) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

/** The scene key for a pathname (what the renderer should load before the router exists). */
export function pageForPath(pathname) {
  const m = matchRoute(pathname);
  return m ? m.route.page : (segments(pathname)[0] || 'index');
}

/** Canonical path for a route (+ params). */
export function pathFor(route, params) {
  return route.path.replace(/:(\w+)/g, (m, k) => encodeURIComponent((params || {})[k] || ''));
}
