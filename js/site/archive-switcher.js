// Injected into every page of an archived design iteration (see scripts/build-archive.mjs): a small paper pill,
// bottom-left, listing the iterations with a way back to the current site. Plain script, no dependencies.
(function () {
  var ITERATIONS = __ITERATIONS__;
  var me = (document.currentScript && document.currentScript.getAttribute('data-iteration')) || '';
  var css = '#design-iterations{position:fixed;left:14px;bottom:14px;z-index:100000;font:italic 600 15px/1 "Cormorant Garamond",Georgia,serif;color:#2b3a48;background:#fbf7ee;border:1px solid #2b3a48;border-radius:3px;padding:8px 12px 9px;box-shadow:2px 3px 0 rgba(43,58,72,.18);transform:rotate(-1deg)}' +
    '#design-iterations a{color:#b0522f;text-decoration:none;margin-left:8px}#design-iterations a:hover{text-decoration:underline}#design-iterations b{font-weight:600;margin-left:8px}#design-iterations .lbl{color:#5a6b79;font-style:normal;font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-family:"IBM Plex Mono",monospace}';
  var style = document.createElement('style'); style.textContent = css;
  var box = document.createElement('div'); box.id = 'design-iterations';
  var lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = 'design iterations'; box.appendChild(lbl);
  ITERATIONS.forEach(function (it) {
    if (it.id === me) { var b = document.createElement('b'); b.textContent = it.id; b.title = it.label; box.appendChild(b); }
    else { var a = document.createElement('a'); a.href = it.path; a.textContent = it.id; a.title = it.label; box.appendChild(a); }
  });
  var cur = document.createElement('a'); cur.href = '/'; cur.textContent = 'current'; cur.title = 'back to the current site'; box.appendChild(cur);
  function mount() { document.head.appendChild(style); document.body.appendChild(box); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
