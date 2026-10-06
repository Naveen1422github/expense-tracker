// spend tab — item grid (frecency-ranked), one-tap log + undo, day list, and its modals.
import { el, icon, toast, openModal, attachSwipe, onTapOrHold } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { formatINR, toInputValue } from './money.js';
import { nowTs, todayKey, dayKey, monthKey, timeOf, joinTs, addDays, formatDayLabel, formatMonthLabel } from './dates.js';
import { rankItems } from './frecency.js';
import { textField, noteField, amountField, categoryField, tagToggles, dateTimeFields } from './fields.js';
import { renderBudgetStrip, takeBudgetNote, withNote } from './budget-view.js';
import { openStarterPicker } from './starter-view.js';

const sum = (list) => list.reduce((s, e) => s + e.amount, 0);
const catName = (id) => store.state.categories.find((c) => c.id === id)?.name || '—';
const tagName = (id) => store.state.tags.find((t) => t.id === id)?.name || '';

// new entries go on the day being viewed, at the current time of day
const tsForViewedDay = () => joinTs(view.day, timeOf(nowTs()));
const defaultCategory = () => (view.chip !== 'all' ? view.chip : '');

async function undoWith(fn) {
  try { await fn(); rerender(); } catch (e) { toast(`undo failed: ${e.message}`, 'error'); }
}

function undoToast(msg, undoFn) {
  toast(msg, 'success', { label: 'undo', onClick: () => undoWith(undoFn) });
}

async function jumpTo(ts) {
  await store.ensureMonth(monthKey(ts));
  view.day = dayKey(ts);
  rerender();
}

// ============================================================
//  view
// ============================================================
export function renderSpend() {
  const pad = el('div', { class: 'view-pad' });
  const chips = el('div', { class: 'chips' });
  const grid = el('div', { class: 'item-grid' });
  // search/chips refresh only the grid + chips (a full render would steal input focus)
  const refresh = () => { fillChips(chips, refresh); fillGrid(grid); };
  // the chips row scrolls sideways; don't let that horizontal drag also switch tabs
  attachSwipe(chips, () => {}, { stopProp: true });
  pad.append(
    renderTotals(),
    renderBudgetStrip(),
    renderSearch(refresh),
    chips,
    grid,
    renderDayList(),
    el('button', { class: 'fab', 'aria-label': 'Add', onClick: openAddChooser }, icon('plus', 22)),
  );
  refresh();
  return pad;
}

function renderTotals() {
  const card = el('div', { class: 'totals-card' },
    el('div', { class: 'date-nav' },
      el('button', { class: 'nav-btn', 'aria-label': 'Previous day', onClick: () => shiftDay(-1) }, icon('chevronLeft', 16)),
      el('div', { class: 'date-label' }, formatDayLabel(view.day)),
      el('button', {
        class: 'nav-btn', 'aria-label': 'Next day', disabled: view.day >= todayKey(), onClick: () => shiftDay(1),
      }, icon('chevronRight', 16)),
    ),
    el('div', { class: 'spend-totals' },
      el('div', {},
        el('div', { class: 'metric-label' }, 'day'),
        el('div', { class: 'big-num' }, formatINR(sum(store.entriesForDay(view.day))))),
      el('div', { class: 'spend-totals-month' },
        el('div', { class: 'metric-label' }, formatMonthLabel(monthKey(view.day)).toLowerCase()),
        el('div', { class: 'med-num' }, formatINR(sum(store.monthEntries(monthKey(view.day)))))),
    ),
  );
  // swipe on the card changes day; stopProp keeps it from also switching tabs
  attachSwipe(card, (dir) => shiftDay(dir === 'left' ? 1 : -1), { stopProp: true });
  return card;
}

async function shiftDay(delta) {
  const next = addDays(view.day, delta);
  if (next > todayKey()) return;
  try {
    await store.ensureMonth(monthKey(next));
    view.day = next;
    rerender();
  } catch (e) { toast(e.message, 'error'); }
}

function renderSearch(onChange) {
  return el('div', { class: 'search-wrap' },
    el('span', { class: 'search-icon' }, icon('search', 14)),
    el('input', {
      class: 'search-input', type: 'search', placeholder: 'search items, categories, tags', value: view.search,
      onInput: (e) => { view.search = e.target.value; onChange(); },
    }),
  );
}

function fillChips(row, onChange) {
  row.innerHTML = '';
  const options = [{ id: 'all', name: 'all' }, ...store.state.categories.filter((c) => !c.archived)];
  for (const c of options) {
    row.appendChild(el('button', {
      class: 'chip' + (view.chip === c.id ? ' active' : ''),
      onClick: () => { view.chip = c.id; onChange(); },
    }, c.name));
  }
}

function visibleItems() {
  const q = view.search.trim().toLowerCase();
  let items = store.state.items.filter((i) => !i.archived);
  if (view.chip !== 'all') items = items.filter((i) => i.categoryId === view.chip);
  if (q) {
    items = items.filter((i) =>
      [i.name, catName(i.categoryId), ...i.tagIds.map(tagName)].some((s) => s.toLowerCase().includes(q)));
  }
  const ranked = rankItems(items, store.loadedEntries(), Date.now());
  return ranked;
}

function fillGrid(grid) {
  grid.innerHTML = '';
  const items = visibleItems();
  if (!items.length) {
    const q = view.search.trim();
    const none = !store.state.items.length;
    grid.appendChild(el('div', { class: 'empty' },
      el('div', { class: 'empty-text' },
        none ? 'no items yet — pick things you buy often, then one tap logs them' : 'no matching items'),
      none && !q
        ? el('button', { class: 'link-btn', onClick: () => openStarterPicker() }, 'pick common items')
        : null,
      el('button', { class: 'link-btn', onClick: () => openItemModal(null, { name: q }) },
        q ? `+ add "${q}"` : '+ new item'),
    ));
    return;
  }
  for (const item of items) {
    const tile = el('button', { class: 'item-tile' },
      el('span', { class: 'item-tile-name' }, item.name),
      el('span', { class: 'item-tile-price' }, formatINR(item.price)),
    );
    onTapOrHold(tile, () => quickLog(item), () => openLogModal(item));
    grid.appendChild(tile);
  }
}

async function quickLog(item) {
  try {
    const entry = await store.logItem(item, { ts: tsForViewedDay() });
    rerender();
    const where = view.day === todayKey() ? '' : ` → ${formatDayLabel(view.day).toLowerCase()}`;
    const note = await takeBudgetNote();
    undoToast(withNote(`${item.name} ${formatINR(entry.amount)}${where}`, note), () => store.deleteSpend(entry));
  } catch (e) { toast(`not saved: ${e.message}`, 'error'); }
}

function renderDayList() {
  const entries = store.entriesForDay(view.day);
  const wrap = el('div', {},
    el('div', { class: 'section-label' }, `${formatDayLabel(view.day).toLowerCase()} · ${entries.length}`));
  if (!entries.length) {
    wrap.appendChild(el('div', { class: 'hint' }, 'nothing logged — tap an item above'));
    return wrap;
  }
  for (const e of entries) {
    const row = el('div', { class: 'log-row', onClick: () => openEntryModal(e) },
      el('div', { class: 'log-main' },
        el('div', { class: 'log-name' }, e.name, e.qty > 1 ? el('span', { class: 'log-qty' }, ` ×${e.qty}`) : null),
        el('div', { class: 'log-meta' }, `${timeOf(e.ts)} · ${catName(e.categoryId)}${e.note ? ' · ' + e.note : ''}`),
      ),
      el('div', { class: 'log-amount' }, formatINR(e.amount)),
    );
    attachSwipe(row, (dir) => { if (dir === 'left') removeEntry(e); }, { stopProp: true });
    wrap.appendChild(row);
  }
  return wrap;
}

async function removeEntry(entry) {
  try {
    await store.deleteSpend(entry);
    rerender();
    undoToast(`deleted ${entry.name}`, () => store.restoreSpend(entry));
  } catch (e) { toast(`not deleted: ${e.message}`, 'error'); }
}

// ============================================================
//  modals
// ============================================================
function openAddChooser() {
  openModal('add', (body, close) => {
    body.append(
      el('button', { class: 'btn-primary', style: { width: '100%' }, onClick: () => { close(); openItemModal(null); } }, 'new item'),
      el('div', { class: 'settings-info' }, 'something you buy again and again — goes on the grid for one-tap logging'),
      el('button', { class: 'btn-ghost', style: { width: '100%', marginTop: '16px' }, onClick: () => { close(); openOneOffModal(); } }, 'one-off expense'),
      el('div', { class: 'settings-info' }, "a single spend you won't repeat — logged without creating an item"),
    );
  });
}

// long-press: log with qty / custom amount / other date / note
function openLogModal(item) {
  openModal(item.name, (body, close) => {
    const f = { qty: 1, amount: item.price, ts: tsForViewedDay(), note: '' };
    let amountTouched = false;
    const qtyLabel = el('div', { class: 'qty-big' }, '1');
    const amt = amountField(f.amount, (v) => { f.amount = v; amountTouched = true; });
    const setQty = (q) => {
      f.qty = Math.max(1, q);
      qtyLabel.textContent = String(f.qty);
      if (!amountTouched) { f.amount = item.price * f.qty; amt.input.value = toInputValue(f.amount); }
    };
    body.append(
      el('div', { class: 'qty-control' },
        el('button', { class: 'qty-step', type: 'button', 'aria-label': 'Less', onClick: () => setQty(f.qty - 1) }, '−'),
        qtyLabel,
        el('button', { class: 'qty-step', type: 'button', 'aria-label': 'More', onClick: () => setQty(f.qty + 1) }, '+'),
      ),
      amt.node,
      dateTimeFields(f.ts, (v) => { f.ts = v; }),
      noteField('', (v) => { f.note = v; }),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', onClick: () => { close(); openItemModal(item); } }, 'edit item'),
        el('button', {
          class: 'btn-primary',
          onClick: async () => {
            if (f.amount == null) return toast('enter a valid amount', 'error');
            try {
              const entry = await store.logItem(item, f);
              close();
              await jumpTo(entry.ts);
              undoToast(withNote(`${item.name} ${formatINR(entry.amount)}`, await takeBudgetNote()), () => store.deleteSpend(entry));
            } catch (e) { toast(`not saved: ${e.message}`, 'error'); }
          },
        }, 'log'),
      ),
    );
  });
}

// create (item = null) or edit an item. exported for settings.
export function openItemModal(item, defaults = {}) {
  openModal(item ? 'edit item' : 'new item', (body, close) => {
    const f = {
      name: item?.name ?? defaults.name ?? '',
      price: item?.price ?? null,
      categoryId: item?.categoryId ?? defaultCategory(),
      tagIds: [...(item?.tagIds ?? [])],
    };
    const actions = el('div', { class: 'modal-actions' });
    body.append(
      textField('name', f.name, (v) => { f.name = v; }),
      amountField(f.price, (v) => { f.price = v; }, 'usual price (₹)').node,
      categoryField(f.categoryId, (v) => { f.categoryId = v; }),
      tagToggles(f.tagIds, (v) => { f.tagIds = v; }),
      actions,
    );

    const save = async (andLog) => {
      if (f.price == null) return toast('enter a valid price', 'error');
      try {
        const saved = await store.saveItem({ id: item?.id, archived: item?.archived ?? false, ...f });
        const snapshotChanged = item && (
          item.name !== saved.name || item.categoryId !== saved.categoryId || item.tagIds.join() !== saved.tagIds.join());
        if (snapshotChanged && await store.isItemUsed(saved.id)) {
          askApplyToPast(body, actions, saved, close);
          return;
        }
        close();
        rerender();
        if (andLog) await quickLog(saved);
        else toast(item ? 'item saved' : 'item added', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };

    if (item) actions.append(el('button', { class: 'btn-danger-ghost', onClick: () => removeItem(item, close) }, 'remove'));
    if (!item) actions.append(el('button', { class: 'btn-ghost', onClick: () => save(true) }, 'save & log'));
    actions.append(el('button', { class: 'btn-primary', onClick: () => save(false) }, 'save'));
  });
}

// the item changed name/category/tags and has history: ask in-modal (no confirm())
function askApplyToPast(body, actions, saved, close) {
  body.insertBefore(
    el('div', { class: 'settings-info' }, 'this item has past entries. update their name / category / tags too?'),
    actions,
  );
  actions.replaceChildren(
    el('button', {
      class: 'btn-ghost',
      onClick: () => { close(); rerender(); toast('saved — past entries unchanged', 'success'); },
    }, 'only future'),
    el('button', {
      class: 'btn-primary',
      onClick: async () => {
        try {
          const n = await store.applyItemToPast(saved);
          close();
          rerender();
          toast(`saved — ${n} past entries updated`, 'success');
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'past too'),
  );
}

// used items are archived (history keeps them); unused items are deleted
async function removeItem(item, close) {
  try {
    if (await store.isItemUsed(item.id)) {
      await store.saveItem({ ...item, archived: true });
      toast('archived — history kept', 'success');
    } else {
      await store.deleteItem(item.id);
      toast('item deleted', 'success');
    }
    close();
    rerender();
  } catch (e) { toast(e.message, 'error'); }
}

function openOneOffModal() {
  openModal('one-off expense', (body, close) => {
    const f = { name: '', amount: null, categoryId: defaultCategory(), tagIds: [], ts: tsForViewedDay(), note: '' };
    body.append(
      textField('what', '', (v) => { f.name = v; }),
      amountField(null, (v) => { f.amount = v; }).node,
      categoryField(f.categoryId, (v) => { f.categoryId = v; }),
      tagToggles([], (v) => { f.tagIds = v; }),
      dateTimeFields(f.ts, (v) => { f.ts = v; }),
      noteField('', (v) => { f.note = v; }),
      el('div', { class: 'modal-actions' },
        el('button', {
          class: 'btn-primary',
          onClick: async () => {
            if (f.amount == null) return toast('enter a valid amount', 'error');
            try {
              const entry = await store.logSpend({ ...f, itemId: null, qty: 1 });
              close();
              await jumpTo(entry.ts);
              undoToast(withNote(`${entry.name} ${formatINR(entry.amount)}`, await takeBudgetNote()), () => store.deleteSpend(entry));
            } catch (e) { toast(`not saved: ${e.message}`, 'error'); }
          },
        }, 'log'),
      ),
    );
  });
}

// item entries: amount/date/note editable; name/category come from the item (edit the item + "past too").
// one-off entries: everything editable.
function openEntryModal(entry) {
  openModal('edit entry', (body, close) => {
    const f = { name: entry.name, amount: entry.amount, categoryId: entry.categoryId, tagIds: [...entry.tagIds], ts: entry.ts, note: entry.note };
    const oneOff = entry.itemId === null;
    if (oneOff) body.append(textField('what', f.name, (v) => { f.name = v; }));
    else body.append(el('div', { class: 'settings-info' }, `${entry.name}${entry.qty > 1 ? ' ×' + entry.qty : ''} · ${catName(entry.categoryId)}`));
    body.append(amountField(f.amount, (v) => { f.amount = v; }).node);
    if (oneOff) {
      body.append(
        categoryField(f.categoryId, (v) => { f.categoryId = v; }),
        tagToggles(f.tagIds, (v) => { f.tagIds = v; }),
      );
    }
    body.append(
      dateTimeFields(f.ts, (v) => { f.ts = v; }),
      noteField(f.note, (v) => { f.note = v; }),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-danger-ghost', onClick: () => { close(); removeEntry(entry); } }, 'delete'),
        el('button', {
          class: 'btn-primary',
          onClick: async () => {
            if (f.amount == null) return toast('enter a valid amount', 'error');
            try {
              const updated = await store.updateSpend(entry, f);
              close();
              await jumpTo(updated.ts);
              toast(withNote('saved', await takeBudgetNote()), 'success');
            } catch (e) { toast(`not saved: ${e.message}`, 'error'); }
          },
        }, 'save'),
      ),
    );
  });
}
