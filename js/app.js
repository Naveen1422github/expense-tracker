// expense — one-tap expense tracker PWA. vanilla JS modules, IndexedDB, no dependencies.
import { $, el, icon, attachSwipe } from './ui.js';
import { store, view, setRender } from './ctx.js';
import { renderSpend } from './spend.js';
import { renderPeople } from './people.js';
import { renderReports } from './reports.js';
import { openSettings } from './settings.js';

const TABS = ['spend', 'people', 'reports'];

function render() {
  const app = $('#app');
  // keep the scroll position across re-renders (otherwise every one-tap log jumps to the top).
  // macro's #app uses min-height, so usually the window scrolls; save both to be safe.
  const prevScroll = $('.content')?.scrollTop || 0;
  const prevWindowScroll = window.scrollY;
  app.innerHTML = '';
  app.appendChild(renderHeader());
  app.appendChild(renderTabs());
  const content = el('div', { class: 'content' });
  attachSwipe(content, (dir) => switchTab(dir === 'left' ? 1 : -1));
  content.appendChild(renderTab());
  app.appendChild(content);
  content.scrollTop = prevScroll;
  window.scrollTo(0, prevWindowScroll);
}

function renderTab() {
  if (view.tab === 'spend') return renderSpend();
  if (view.tab === 'people') return renderPeople();
  return renderReports();
}

function renderHeader() {
  return el('div', { class: 'header' },
    el('div', { class: 'brand' },
      el('span', { class: 'brand-dot' }),
      el('span', { class: 'brand-text' }, 'expense'),
    ),
    el('div', { class: 'header-actions' },
      el('button', { class: 'icon-btn', 'aria-label': 'Settings', onClick: openSettings }, icon('settings', 16)),
    ),
  );
}

function renderTabs() {
  const t = el('div', { class: 'tabs' });
  for (const name of TABS) {
    t.appendChild(el('button', {
      class: 'tab' + (view.tab === name ? ' active' : ''),
      onClick: () => { view.tab = name; render(); },
    }, name));
  }
  return t;
}

function switchTab(delta) {
  const idx = TABS.indexOf(view.tab) + delta;
  if (idx < 0 || idx >= TABS.length) return;
  view.tab = TABS[idx];
  $('.content') && ($('.content').scrollTop = 0);
  render();
}

// ============================================================
//  PWA install banner
// ============================================================
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  if (localStorage.getItem('expense:install-dismissed')) return;
  if ($('.install-banner')) return;
  const banner = el('div', { class: 'install-banner' },
    el('div', { class: 'install-banner-text' },
      'install expense',
      el('small', {}, 'works offline · adds to home screen'),
    ),
    el('button', {
      class: 'install-btn',
      onClick: async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') banner.remove();
        deferredInstallPrompt = null;
      },
    }, 'install'),
    el('button', {
      class: 'install-dismiss',
      'aria-label': 'Dismiss',
      onClick: () => {
        localStorage.setItem('expense:install-dismissed', '1');
        banner.remove();
      },
    }, icon('x', 14)),
  );
  document.body.appendChild(banner);
}

async function start() {
  setRender(render);
  // ask the browser not to evict our data under storage pressure (installed PWAs usually get it)
  try { await navigator.storage?.persist?.(); } catch { /* not supported — fine */ }
  await store.boot();
  render();
}

start().catch((err) => {
  console.error(err);
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(el('div', { class: 'loading' }, `storage error: ${err.message}`));
});
