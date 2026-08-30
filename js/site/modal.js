// A paper card over the journal for things you click on the page. [data-modal="<id>"] loads content/<id>.html;
// the pond keeps running underneath. Escape / backdrop / the close button close it; focus returns to the trigger.

export function createModal(root, opts) {
  root = root || document.body; opts = opts || {};
  let el = null, opener = null, lastFocus = null;
  const base = document.documentElement.dataset.contentBase ? document.documentElement.dataset.contentBase.replace(/pages\/$/, '') : '/content/';

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'site-modal'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="modal-card"><button class="modal-close" type="button" aria-label="Close">✕</button><div class="modal-body"></div></div>';
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.querySelector('.modal-close').addEventListener('click', close);
    root.appendChild(el);
    return el;
  }
  async function open(id, trigger, o) {
    ensure(); opener = trigger || null; lastFocus = document.activeElement; el.classList.toggle('reading', !!(o && o.reading));
    const body = el.querySelector('.modal-body');
    body.innerHTML = '<p class="modal-loading">…</p>';
    el.hidden = false; document.body.classList.add('has-modal');
    try {
      const r = await fetch(base + id + '.html', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = document.createElement('template'); t.innerHTML = await r.text();
      t.content.querySelectorAll('script').forEach((s) => s.remove());
      body.innerHTML = ''; body.appendChild(t.content);
      const v = body.querySelector('video'); if (v && v.play) v.play().catch(() => {});
    } catch (e) { body.innerHTML = '<p class="modal-error">Could not load this. ' + String(e.message) + '</p>'; }
    el.querySelector('.modal-close').focus();
  }
  function close() {
    if (!el || el.hidden) return;
    el.hidden = true; document.body.classList.remove('has-modal');
    el.querySelector('.modal-body').innerHTML = ''; el.classList.remove('reading');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    if (opts.onClose) opts.onClose();
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-modal]');
    if (!t) return;
    e.preventDefault(); open(t.getAttribute('data-modal'), t);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { open, close, get isOpen() { return !!(el && !el.hidden); } };
}
