// The visitor-facing markup (the paper button, the note, the fish editor) as a template.
// mountVisitorDom(root) appends it once, and bails if #visitor-ui is already there — lab/boids-lab.html
// carries its own inline copy, so this template is the site's alone. Keep the ids either way:
// designer.js finds everything by id, and Visitors.refresh() looks up #my-fish-note wherever it sits.
//
// The site moves #designer onto the journal's right page (js/site/main.js + css/fish-page.css);
// the lab keeps it a floating modal card (css/pond.css).

export var VISITOR_HTML = `
<div id="visitor-ui" aria-label="Leave a fish">
  <button class="paper-btn" id="btn-leave">Leave a fish</button>
</div>
<div id="designer" role="dialog" aria-modal="true" aria-labelledby="fd-title" hidden>
  <div class="fd-card">
    <div class="fd-head">
      <h2 id="fd-title">Leave a fish</h2>
      <span class="fd-sub">the pond keeps the newest <span id="fd-cap">30</span></span>
      <button class="fd-x" id="fd-close" aria-label="Close">&#x2715;</button>
    </div>
    <div class="fd-body">
      <div>
        <div class="fd-preview"><canvas id="fd-preview" width="10" height="10" aria-label="Your fish, painted"></canvas><span class="fd-painting" id="fd-painting">painting&#8230;</span></div>
        <div class="fd-under">
          <input class="fd-name grow" id="fd-name" type="text" maxlength="16" placeholder="Name your fish" autocomplete="off" spellcheck="false" aria-label="Fish name">
          <button class="fd-chip" id="fd-shuffle" type="button" title="Paint it again with a different hand">paint it again</button>
        </div>
      </div>
      <div id="fd-controls"></div>
    </div>
    <div class="fd-foot">
      <span class="fd-count" id="fd-count"></span>
      <span class="fd-err" id="fd-err" role="alert"></span>
      <button class="fd-release" id="fd-release" type="button">Release into the pond</button>
      <div id="my-fish-note" hidden></div>
    </div>
  </div>
</div>
`;

export function mountVisitorDom(root) {
  root = root || document.body;
  if (root.querySelector('#visitor-ui')) return root;
  var t = document.createElement('template'); t.innerHTML = VISITOR_HTML;
  root.appendChild(t.content);
  return root;
}
