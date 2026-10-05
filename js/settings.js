// settings — manage categories / tags / items, download a backup, erase everything.
import { el, openModal, toast } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { openItemModal } from './spend.js';
import { openBudgetsModal } from './budget-view.js';
import { formatINR } from './money.js';
import { todayKey, nowTs, monthKey } from './dates.js';
import { SCHEMA_VERSION } from './store.js';
import { validateBackup, daysSinceBackup, backupDue } from './export.js';
import { buildSummary, buildMonthCsv, hasData, currentCounts } from './backup-files.js';
import { confirmRestore } from './restore-view.js';
import { renderDriveSection } from './drive.js';

export function openSettings() {
  openModal('settings', (body, close) => {
    body.append(
      namedListSection('categories', 'category', () => store.state.categories, (rec) => store.saveCategory(rec), true),
      namedListSection('tags', 'tag', () => store.state.tags, (rec) => store.saveTag(rec), false),
      itemsSection(close),
      budgetsSection(close),
      renderDriveSection(close),
      backupSection(close),
      dangerSection(close),
      el('div', { class: 'settings-info', style: { textAlign: 'center', marginTop: '16px' } }, 'kharchly · stored locally on your device · ',
        el('a', { href: 'privacy.html', target: '_blank', rel: 'noopener', style: { color: 'inherit' } }, 'privacy')),
    );
  });
}

// rename inline (on change), archive/restore, add new
function namedListSection(title, singular, getList, save, archivable) {
  const sec = el('div', { class: 'settings-section' });
  const run = async (fn) => {
    try { await fn(); draw(); rerender(); } catch (e) { toast(e.message, 'error'); draw(); }
  };
  const draw = () => {
    sec.replaceChildren(el('div', { class: 'settings-section-title' }, title));
    for (const rec of getList()) {
      sec.appendChild(el('div', { class: 'settings-list-row' + (rec.archived ? ' archived' : '') },
        el('input', {
          class: 'input', type: 'text', value: rec.name, maxlength: '40',
          onChange: (e) => run(() => save({ ...rec, name: e.target.value })),
        }),
        archivable
          ? el('button', { class: 'btn-ghost', onClick: () => run(() => save({ ...rec, archived: !rec.archived })) },
            rec.archived ? 'restore' : 'archive')
          : null,
      ));
    }
    const add = el('input', { class: 'input', type: 'text', placeholder: `new ${singular}`, maxlength: '40' });
    sec.appendChild(el('div', { class: 'settings-list-row' },
      add,
      el('button', { class: 'btn-ghost', onClick: () => run(() => save({ name: add.value })) }, 'add'),
    ));
  };
  draw();
  return sec;
}

function itemsSection(closeSettings) {
  const sec = el('div', { class: 'settings-section' }, el('div', { class: 'settings-section-title' }, 'items'));
  const items = [...store.state.items].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  if (!items.length) sec.appendChild(el('div', { class: 'settings-info' }, 'no items yet'));
  for (const item of items) {
    sec.appendChild(el('button', {
      class: 'settings-item-row' + (item.archived ? ' archived' : ''),
      onClick: () => { closeSettings(); if (item.archived) restoreItem(item); else openItemModal(item); },
    },
      el('span', {}, item.archived ? `${item.name} (archived — tap to restore)` : item.name),
      el('span', { class: 'settings-item-price' }, formatINR(item.price)),
    ));
  }
  return sec;
}

async function restoreItem(item) {
  try {
    await store.saveItem({ ...item, archived: false });
    rerender();
    toast(`${item.name} restored`, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function budgetsSection(closeSettings) {
  return el('div', { class: 'settings-section' },
    el('div', { class: 'settings-section-title' }, 'budgets'),
    el('button', {
      class: 'btn-ghost',
      style: { width: '100%' },
      onClick: () => { closeSettings(); openBudgetsModal(); },
    }, `manage budgets (${store.state.budgets.length})`),
  );
}

function backupSection(closeSettings) {
  const days = daysSinceBackup(store.state.meta, nowTs());
  const last = days === null ? 'never' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  const due = backupDue(store.state.meta, nowTs(), hasData());
  return el('div', { class: 'settings-section' },
    el('div', { class: 'settings-section-title' }, 'backup'),
    el('div', { class: 'settings-info' + (due ? ' warn-text' : '') }, `last backup: ${last}`),
    el('div', { class: 'settings-btn-row' },
      el('button', { class: 'btn-ghost', onClick: downloadJson }, 'backup (json)'),
      el('button', { class: 'btn-ghost', onClick: () => pickRestore(closeSettings) }, 'restore'),
    ),
    el('div', { class: 'settings-btn-row' },
      el('button', { class: 'btn-ghost', onClick: downloadSummary }, 'summary.md'),
      el('button', { class: 'btn-ghost', onClick: downloadMonthCsv }, 'this month (csv)'),
    ),
    el('div', { class: 'settings-info' },
      'json = full copy you can restore. summary.md + csv = readable reports (for you, excel, or claude). for automatic backups, connect google drive above.'),
  );
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadJson() {
  try {
    const dump = await store.exportRaw();
    download(`kharchly-backup-${dump.exportedAt.slice(0, 10)}.json`, JSON.stringify(dump, null, 2), 'application/json');
    await store.markBackedUp();
    rerender();
    toast('backup downloaded', 'success');
  } catch (e) { toast(`backup failed: ${e.message}`, 'error'); }
}

async function downloadSummary() {
  try {
    download(`kharchly-summary-${todayKey()}.md`, await buildSummary(), 'text/markdown');
  } catch (e) { toast(`summary failed: ${e.message}`, 'error'); }
}

async function downloadMonthCsv() {
  try {
    const mk = monthKey(todayKey());
    download(`spend-${mk}.csv`, await buildMonthCsv(mk), 'text/csv');
  } catch (e) { toast(`csv failed: ${e.message}`, 'error'); }
}

// restore: pick file -> parse -> validate -> confirm with counts -> replace everything
function pickRestore(closeSettings) {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    try {
      let dump;
      try { dump = JSON.parse(await file.text()); } catch { throw new Error('Not a valid backup: not a JSON file'); }
      const { counts } = validateBackup(dump, SCHEMA_VERSION);
      closeSettings();
      confirmRestore(dump, counts, await currentCounts());
    } catch (e) { toast(e.message, 'error'); }
  });
  document.body.appendChild(input);
  input.click();
}

// two-tap erase (no confirm() dialogs)
function dangerSection(closeSettings) {
  let armed = false;
  const btn = el('button', {
    class: 'btn-danger-ghost',
    style: { width: '100%' },
    onClick: async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'tap again to erase everything';
        setTimeout(() => { armed = false; btn.textContent = 'erase all data'; }, 4000);
        return;
      }
      try {
        await store.wipe();
        view.day = todayKey();
        view.chip = 'all';
        view.search = '';
        closeSettings();
        rerender();
        toast('all data erased');
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'erase all data');
  return el('div', { class: 'settings-section' }, el('div', { class: 'settings-section-title' }, 'danger zone'), btn);
}
