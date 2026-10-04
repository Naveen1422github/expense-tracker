// people tab — who owes whom, each person's history with a running balance, one-tap settle.
// all sign/balance maths lives in ledger.js; this file only draws it.
import { el, icon, toast, openModal } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { formatINR } from './money.js';
import { nowTs, dayKey, timeOf, formatDayLabel } from './dates.js';
import { KIND_LABELS, signOf, balances, totals, history, settlement } from './ledger.js';
import { amountField, noteField, dateTimeFields, personField, kindField } from './fields.js';

const byName = (a, b) => a.person.name.localeCompare(b.person.name);

function balanceLine(balance) {
  if (balance > 0) return `owes you ${formatINR(balance)}`;
  if (balance < 0) return `you owe ${formatINR(-balance)}`;
  return 'settled';
}

// ============================================================
//  tab
// ============================================================
export function renderPeople() {
  const rows = balances(store.state.people, store.state.ledger);
  const { owedToMe, iOwe } = totals(rows);
  // archived people with money outstanding stay visible until settled
  const open = rows.filter((r) => r.balance !== 0)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || byName(a, b));
  const settled = rows.filter((r) => r.balance === 0).sort(byName);

  const pad = el('div', { class: 'view-pad' },
    el('div', { class: 'totals-card' },
      el('div', { class: 'spend-totals' },
        el('div', {},
          el('div', { class: 'metric-label' }, 'owed to you'),
          el('div', { class: 'big-num' }, formatINR(owedToMe))),
        el('div', { class: 'spend-totals-month' },
          el('div', { class: 'metric-label' }, 'you owe'),
          el('div', { class: 'med-num' }, formatINR(iOwe))),
      ),
    ),
  );

  if (!rows.length) {
    pad.appendChild(el('div', { class: 'empty' },
      el('div', { class: 'empty-text' }, 'no one yet — tap + to record money you lent or borrowed')));
  }
  for (const r of open) pad.appendChild(personRow(r));

  if (settled.length) {
    pad.appendChild(el('button', {
      class: 'link-btn settled-toggle',
      onClick: () => { view.showSettled = !view.showSettled; rerender(); },
    }, `${view.showSettled ? '▾' : '▸'} settled (${settled.length})`));
    if (view.showSettled) for (const r of settled) pad.appendChild(personRow(r));
  }

  pad.appendChild(el('button', { class: 'fab', 'aria-label': 'Add', onClick: () => openLedgerModal() }, icon('plus', 22)));
  return pad;
}

function personRow({ person, balance }) {
  const tone = balance > 0 ? ' pos' : balance < 0 ? ' neg' : '';
  return el('button', { class: 'person-row', onClick: () => openPersonModal(person.id) },
    el('span', { class: 'person-name' }, person.name, person.archived ? el('span', { class: 'log-meta' }, ' · archived') : null),
    el('span', { class: 'person-balance' + tone }, balanceLine(balance)),
  );
}

// ============================================================
//  person modal: balance, settle, history, rename/archive
// ============================================================
export function openPersonModal(personId) {
  const person = store.state.people.find((p) => p.id === personId);
  if (!person) return;
  openModal(person.name, (body, close) => {
    const rows = history(store.state.ledger, personId);
    const balance = rows.length ? rows[rows.length - 1].balanceAfter : 0;
    const settle = settlement(balance);

    body.append(el('div', { class: 'person-summary' },
      el('div', { class: 'metric-label' }, balance > 0 ? `${person.name} owes you` : balance < 0 ? `you owe ${person.name}` : 'all settled'),
      el('div', { class: 'big-num' }, formatINR(Math.abs(balance))),
    ));

    const actions = el('div', { class: 'modal-actions' });
    if (settle) {
      actions.append(el('button', {
        class: 'btn-primary',
        onClick: () => { close(); openLedgerModal({ personId, ...settle, back: personId }); },
      }, `settle ${formatINR(settle.amount)}`));
    }
    actions.append(el('button', {
      class: 'btn-ghost',
      onClick: () => { close(); openLedgerModal({ personId, back: personId }); },
    }, 'add entry'));
    body.append(actions);

    body.append(el('div', { class: 'section-label' }, 'history'));
    if (!rows.length) body.append(el('div', { class: 'hint' }, 'no entries yet'));
    for (const r of rows) {
      body.append(el('button', {
        class: 'log-row ledger-row',
        onClick: () => { close(); openLedgerModal({ entry: r, back: personId }); },
      },
        el('div', { class: 'log-main' },
          el('div', { class: 'log-name' }, KIND_LABELS[r.kind]),
          el('div', { class: 'log-meta' }, `${formatDayLabel(dayKey(r.ts)).toLowerCase()} ${timeOf(r.ts)}${r.note ? ' · ' + r.note : ''}`),
        ),
        el('div', { class: 'ledger-nums' },
          el('div', { class: 'log-amount' }, `${signOf(r.kind) > 0 ? '+' : '−'}${formatINR(r.amount)}`),
          el('div', { class: 'log-meta' }, `bal ${formatINR(r.balanceAfter)}`),
        ),
      ));
    }

    body.append(manageSection(person, rows.length > 0, close));
  });
}

function manageSection(person, hasEntries, close) {
  const nameInput = el('input', { class: 'input', type: 'text', value: person.name, maxlength: '40' });
  const reopen = () => { close(); rerender(); openPersonModal(person.id); };
  return el('div', { class: 'settings-section' },
    el('div', { class: 'settings-section-title' }, 'person'),
    el('div', { class: 'settings-list-row' },
      nameInput,
      el('button', {
        class: 'btn-ghost',
        onClick: async () => {
          try { await store.savePerson({ ...person, name: nameInput.value }); reopen(); } catch (e) { toast(e.message, 'error'); }
        },
      }, 'rename'),
    ),
    el('button', {
      class: 'btn-danger-ghost',
      style: { width: '100%' },
      onClick: async () => {
        try {
          if (hasEntries) {
            await store.savePerson({ ...person, archived: !person.archived });
            toast(person.archived ? `${person.name} unarchived` : `${person.name} archived — hidden from the picker`, 'success');
            reopen();
          } else {
            await store.deletePerson(person.id);
            close();
            rerender();
            toast(`${person.name} deleted`, 'success');
          }
        } catch (e) { toast(e.message, 'error'); }
      },
    }, hasEntries ? (person.archived ? 'unarchive' : 'archive') : 'delete'),
  );
}

// ============================================================
//  add / edit a ledger entry. `back` = person modal to return to after saving.
// ============================================================
export function openLedgerModal({ entry = null, personId = '', kind = 'lent', amount = null, back = null } = {}) {
  openModal(entry ? 'edit entry' : 'lend / borrow', (body, close) => {
    const f = {
      personId: entry?.personId ?? personId,
      kind: entry?.kind ?? kind,
      amount: entry?.amount ?? amount,
      ts: entry?.ts ?? nowTs(),
      note: entry?.note ?? '',
    };
    const finish = (reopenPerson) => {
      close();
      rerender();
      if (reopenPerson && back) openPersonModal(back);
    };

    body.append(
      personField(f.personId, (v) => { f.personId = v; }),
      kindField(f.kind, (v) => { f.kind = v; }),
      amountField(f.amount, (v) => { f.amount = v; }).node,
      dateTimeFields(f.ts, (v) => { f.ts = v; }),
      noteField(f.note, (v) => { f.note = v; }),
    );

    const actions = el('div', { class: 'modal-actions' });
    if (entry) {
      // delete returns to the tab (not the person modal) so undo never leaves a stale modal open
      actions.append(el('button', {
        class: 'btn-danger-ghost',
        onClick: async () => {
          try {
            await store.deleteLedger(entry);
            finish(false);
            toast('entry deleted', '', {
              label: 'undo',
              onClick: async () => {
                try { await store.restoreLedger(entry); rerender(); } catch (e) { toast(`undo failed: ${e.message}`, 'error'); }
              },
            });
          } catch (e) { toast(`not deleted: ${e.message}`, 'error'); }
        },
      }, 'delete'));
    }
    actions.append(el('button', {
      class: 'btn-primary',
      onClick: async () => {
        if (!f.amount) return toast('enter an amount', 'error');
        try {
          if (entry) await store.updateLedger(entry, f);
          else await store.addLedger(f);
          finish(true);
          toast('saved', 'success');
        } catch (e) { toast(`not saved: ${e.message}`, 'error'); }
      },
    }, 'save'));
    body.append(actions);
  });
}
