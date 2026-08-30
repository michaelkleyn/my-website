// p5.brush is a UMD build: it cannot be imported, only read from the global that the vendored script defines.

export let brush = globalThis.brush || null;
export function setBrush(b) { brush = b; return brush; }
/** Resolve the global if it is already there, else inject the vendor script and wait for it. */
export function loadBrush(url) {
  return new Promise(function (res, rej) {
    if (globalThis.brush) { brush = globalThis.brush; return res(brush); }
    var s = document.createElement('script'); s.src = url;
    s.onload = function () { brush = globalThis.brush || null; if (brush) res(brush); else rej(new Error('p5.brush did not define window.brush')); };
    s.onerror = function () { rej(new Error('failed to load ' + url)); };
    document.head.appendChild(s);
  });
}
