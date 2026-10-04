// settings — manage categories / tags / items, download a backup, erase everything.
import { el, openModal, toast } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { openItemModal } from './spend.js';
import { openBudgetsModal } from './budget-view.js';
import { formatINR } from './money.js';
import { todayKey } from './dates.js';

export function openSettings() {
  openModal('settings', (body, close) => {
    body.append(
      namedListSection('categories', 'category', () => store.state.categories, (rec) => store.saveCategory(rec), true),
      namedListSection('tags', 'tag', () => store.state.tags, (rec) => store.saveTag(rec), false),
      itemsSection(close),
      budgetsSection(close),
      backupSection(),
      dangerSection(close),
      el('div', { class: 'settings-info', style: { textAlign: 'center', marginTop: '16px' } }, 'kharchly · stored locally on your device'),
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

function backupSection() {
  return el('div', { class: 'settings-section' },
    el('div', { class: 'settings-section-title' }, 'backup'),
    el('button', { class: 'btn-ghost', style: { width: '100%' }, onClick: downloadJson }, 'download backup (json)'),
    el('div', { class: 'settings-info' },
      'a full copy of your data. restore and google drive backup arrive in a later update — download one now and then until then.'),
  );
}

async function downloadJson() {
  try {
    const dump = await store.exportRaw();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `kharchly-backup-${dump.exportedAt.slice(0, 10)}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('backup downloaded', 'success');
  } catch (e) { toast(`backup failed: ${e.message}`, 'error'); }
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
