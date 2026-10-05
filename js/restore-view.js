// restore-view — the "replace everything?" confirmation, shared by file restore (settings)
// and drive restore (drive.js). lives in its own module so the two don't import each other.
import { el, openModal, toast } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { todayKey } from './dates.js';

const describe = (c) => (c
  ? `${c.expenses} expenses · ${c.items} items · ${c.people} people · ${c.budgets} budgets`
  : 'unknown');

export function confirmRestore(dump, incoming, current, afterRestore = null) {
  openModal('restore backup', (body, close) => {
    let armed = false;
    const go = el('button', {
      class: 'btn-danger-ghost',
      onClick: async () => {
        if (!armed) {
          armed = true;
          go.textContent = 'tap again to replace everything';
          return;
        }
        try {
          await store.importRaw(dump);
          if (afterRestore) await afterRestore();
          view.day = todayKey();
          view.chip = 'all';
          view.search = '';
          close();
          rerender();
          toast('backup restored', 'success');
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'replace everything');
    body.append(
      el('div', { class: 'settings-info' }, `backup from ${String(dump.exportedAt || '?').replace('T', ' ')}`),
      el('div', { class: 'settings-info' }, `in the backup: ${describe(incoming)}`),
      el('div', { class: 'settings-info' }, `on this phone now: ${describe(current)}`),
      el('div', { class: 'settings-info warn-text' }, 'restoring replaces everything on this phone with the backup.'),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', onClick: close }, 'cancel'),
        go,
      ),
    );
  });
}
