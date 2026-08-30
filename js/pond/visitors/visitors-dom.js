// The visitor-facing markup (the paper button, the note, the "Leave a fish" card) as a template, so the site and the
// lab share one source. mountVisitorDom(root) appends it once.

export var VISITOR_HTML = "<div id=\"visitor-ui\" aria-label=\"Leave a fish\">\n  <div id=\"my-fish-note\" hidden></div>\n  <button class=\"paper-btn\" id=\"btn-leave\">Leave a fish</button>\n</div>\n<div id=\"designer\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"fd-title\" hidden>\n  <div class=\"fd-card\">\n    <div class=\"fd-head\">\n      <h2 id=\"fd-title\">Leave a fish</h2>\n      <span class=\"fd-sub\">Design a small fish and release it into the pond. The pond keeps the <span id=\"fd-cap\">30</span> most recent; come back any time to find yours.</span>\n      <button class=\"fd-x\" id=\"fd-close\" aria-label=\"Close\">\u2715</button>\n    </div>\n    <div class=\"fd-body\">\n      <div>\n        <div class=\"fd-preview\"><canvas id=\"fd-preview\" width=\"10\" height=\"10\" aria-label=\"Your fish, painted\"></canvas><span class=\"fd-painting\" id=\"fd-painting\">painting\u2026</span></div>\n        <div class=\"fd-under\">\n          <input class=\"fd-name grow\" id=\"fd-name\" type=\"text\" maxlength=\"16\" placeholder=\"Name your fish\" autocomplete=\"off\" spellcheck=\"false\" aria-label=\"Fish name\">\n          <button class=\"fd-chip\" id=\"fd-shuffle\" type=\"button\" title=\"Paint it again with a different hand\">Shuffle</button>\n        </div>\n      </div>\n      <div id=\"fd-controls\"></div>\n    </div>\n    <div class=\"fd-foot\">\n      <span class=\"fd-count\" id=\"fd-count\"></span>\n      <span class=\"fd-err\" id=\"fd-err\" role=\"alert\"></span>\n      <button class=\"fd-release\" id=\"fd-release\" type=\"button\">Release into the pond</button>\n    </div>\n  </div>\n</div>\n";

export function mountVisitorDom(root) {
  root = root || document.body;
  if (root.querySelector('#visitor-ui')) return root;
  var t = document.createElement('template'); t.innerHTML = VISITOR_HTML;
  root.appendChild(t.content);
  return root;
}
