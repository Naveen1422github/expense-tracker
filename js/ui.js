// ui helpers — copied from macro/app.js. CHANGED: toast() takes an action. NEW: onTapOrHold().

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const BOOL_ATTRS = new Set(['disabled', 'checked', 'readonly', 'required', 'hidden', 'autofocus']);
export const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style') Object.assign(e.style, v);
    else if (BOOL_ATTRS.has(k)) {
      // boolean attributes: presence = true. only set when truthy.
      if (v) e.setAttribute(k, '');
      else e.removeAttribute(k);
    }
    else if (v == null || v === false) continue;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
};

export const icon = (name, size = 16) => {
  const paths = {
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
    chevronRight: '<polyline points="9 18 15 12 9 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    apple: '<path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/><path d="M10 2c1 .5 2 2 2 5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  };
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.innerHTML = svg;
  return wrap;
};

export function openModal(title, bodyBuilder) {
  const overlay = el('div', { class: 'modal-overlay' });
  const modal = el('div', { class: 'modal' });
  const cleanups = [];
  const close = () => {
    cleanups.forEach(fn => { try { fn(); } catch (e) {} });
    overlay.remove();
  };
  // bodyBuilder can register cleanup work via the 3rd arg
  const onClose = (fn) => cleanups.push(fn);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);
  cleanups.push(() => document.removeEventListener('keydown', escHandler));
  modal.appendChild(el('div', { class: 'modal-header' },
    el('span', { class: 'modal-title' }, title),
    el('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close }, icon('x', 16)),
  ));
  const body = el('div', { class: 'modal-body' });
  bodyBuilder(body, close, onClose);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  return { overlay, close };
}

export function attachSwipe(node, onSwipe, opts = {}) {
  let startX = 0, startY = 0, tracking = false;
  node.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  node.addEventListener('touchend', e => {
    if (!tracking || e.changedTouches.length === 0) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < Math.abs(dy)) return; // mostly vertical, ignore
    if (Math.abs(dx) < 60) return;
    // a real horizontal swipe happened here — if asked, don't let it bubble
    // up to the tab-swipe handler on the content container.
    if (opts.stopProp) e.stopPropagation();
    onSwipe(dx > 0 ? 'right' : 'left');
  }, { passive: true });
}

// CHANGED from macro: optional action button (used for undo). stays 4s when it has one.
let toastTimeout = null;
export function toast(msg, kind = '', action = null) {
  const existing = $('.toast');
  if (existing) existing.remove();
  if (toastTimeout) clearTimeout(toastTimeout);
  const t = el('div', { class: `toast ${kind}` }, msg);
  if (action) {
    t.appendChild(el('button', {
      class: 'toast-action',
      onClick: () => { clearTimeout(toastTimeout); t.remove(); action.onClick(); },
    }, action.label));
  }
  document.body.appendChild(t);
  toastTimeout = setTimeout(() => t.remove(), action ? 4000 : 2200);
}

// NEW: tap and long-press on one node. a long-press never also fires the tap,
// and moving the finger (scrolling) cancels the long-press.
export function onTapOrHold(node, onTap, onHold, ms = 450) {
  let timer = null;
  let held = false;
  let sx = 0;
  let sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  node.addEventListener('contextmenu', (e) => e.preventDefault());
  node.addEventListener('pointerdown', (e) => {
    held = false;
    sx = e.clientX;
    sy = e.clientY;
    timer = setTimeout(() => { timer = null; held = true; onHold(); }, ms);
  });
  node.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  });
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', (e) => {
    if (held) { held = false; e.preventDefault(); return; }
    onTap(e);
  });
}
