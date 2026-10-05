// store — app state + every read/write. the ONLY module that touches storage.
// storage is injected (kv = {get,set,del,keys}) so this file runs under node tests.
// rule: validate -> write kv -> only then update state. a failed write changes nothing.
import { nowTs, monthKey, dayKey, addMonths, monthsBetween } from './dates.js';
import { KINDS } from './ledger.js';
import { SCOPES, PERIODS } from './budgets.js';
import { validateBackup } from './export.js';

export const SCHEMA_VERSION = 1;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const K = {
  categories: 'categories', tags: 'tags', items: 'items', meta: 'meta',
  people: 'people', ledger: 'ledger', budgets: 'budgets',
  month: (mk) => `spend:${mk}`,
};
const SEED_CATEGORIES = ['Food', 'Groceries', 'Travel', 'Bills', 'Shopping'];
const SEED_TAGS = ['unhealthy'];
const BOOT_MONTHS_BACK = 3; // frecency lookback + cross-month weeks + "vs last month"
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const defaultMeta = () => ({
  schemaVersion: SCHEMA_VERSION,
  lastBackupAt: null,
  dirtyMonths: [],
  dirtyPeople: false,
  drive: { connected: false, folderId: null, fileIds: {} },
  budgetWarnings: {},
});

function cleanName(name) {
  const s = String(name ?? '').trim();
  if (!s) throw new Error('Name is required');
  return s;
}

export function createStore(kv, { now = nowTs, makeId = uid } = {}) {
  const state = { categories: [], tags: [], items: [], people: [], ledger: [], budgets: [], meta: defaultMeta(), months: new Map() };

  // ---------- boot ----------
  async function boot() {
    const meta = await kv.get(K.meta);
    if (meta && meta.schemaVersion > SCHEMA_VERSION) {
      throw new Error(`Data is from a newer app version (${meta.schemaVersion})`);
    }
    if (!meta) await kv.set(K.meta, defaultMeta());
    state.meta = meta || defaultMeta();

    let cats = await kv.get(K.categories);
    if (!cats) {
      cats = SEED_CATEGORIES.map((name) => ({ id: makeId(), name, archived: false }));
      await kv.set(K.categories, cats);
    }
    let tags = await kv.get(K.tags);
    if (!tags) {
      tags = SEED_TAGS.map((name) => ({ id: makeId(), name }));
      await kv.set(K.tags, tags);
    }
    state.categories = cats;
    state.tags = tags;
    state.items = (await kv.get(K.items)) || [];
    state.people = (await kv.get(K.people)) || [];
    state.ledger = (await kv.get(K.ledger)) || [];
    state.budgets = (await kv.get(K.budgets)) || [];

    state.months = new Map();
    const cur = monthKey(now());
    for (let i = BOOT_MONTHS_BACK; i >= 0; i--) await ensureMonth(addMonths(cur, -i));
  }

  // ---------- months ----------
  async function ensureMonth(mk) {
    if (!state.months.has(mk)) {
      const loaded = (await kv.get(K.month(mk))) || [];
      // re-check: a write may have cached this month while we were reading
      if (!state.months.has(mk)) state.months.set(mk, loaded);
    }
    return state.months.get(mk);
  }

  async function writeMonth(mk, entries) {
    await kv.set(K.month(mk), entries);
    state.months.set(mk, entries);
    if (!state.meta.dirtyMonths.includes(mk)) {
      const meta = { ...state.meta, dirtyMonths: [...state.meta.dirtyMonths, mk] };
      await kv.set(K.meta, meta);
      state.meta = meta;
    }
  }

  async function spendMonthKeys() {
    return (await kv.keys('spend:')).map((k) => k.slice('spend:'.length)).sort();
  }

  // ---------- named lists (categories, tags, items) ----------
  async function upsert(key, field, record) {
    const list = state[field];
    const next = list.some((r) => r.id === record.id)
      ? list.map((r) => (r.id === record.id ? record : r))
      : [...list, record];
    await kv.set(key, next);
    state[field] = next;
    return record;
  }

  function assertUniqueName(list, name, id, label) {
    const dup = list.find((r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== id);
    if (dup) throw new Error(`${label} "${dup.name}" already exists`);
  }

  async function saveCategory({ id, name, archived = false }) {
    name = cleanName(name);
    assertUniqueName(state.categories, name, id, 'Category');
    return upsert(K.categories, 'categories', { id: id || makeId(), name, archived: !!archived });
  }

  async function saveTag({ id, name }) {
    name = cleanName(name);
    assertUniqueName(state.tags, name, id, 'Tag');
    return upsert(K.tags, 'tags', { id: id || makeId(), name });
  }

  async function saveItem({ id, name, price, categoryId, tagIds = [], archived = false }) {
    name = cleanName(name);
    if (!Number.isInteger(price) || price < 0) throw new Error('Price must be a valid amount');
    if (!state.categories.some((c) => c.id === categoryId)) throw new Error('Pick a category');
    const prev = id ? state.items.find((i) => i.id === id) : null;
    return upsert(K.items, 'items', {
      id: id || makeId(),
      name,
      price,
      categoryId,
      tagIds: tagIds.filter((t) => state.tags.some((x) => x.id === t)),
      archived: !!archived,
      createdAt: prev?.createdAt || now(),
    });
  }

  async function isItemUsed(itemId) {
    for (const mk of await spendMonthKeys()) {
      if ((await ensureMonth(mk)).some((e) => e.itemId === itemId)) return true;
    }
    return false;
  }

  async function deleteItem(itemId) {
    if (await isItemUsed(itemId)) throw new Error('Item has history — archive it instead');
    const next = state.items.filter((i) => i.id !== itemId);
    await kv.set(K.items, next);
    state.items = next;
  }

  // rewrite the snapshot fields of every past entry of this item
  async function applyItemToPast(item) {
    let count = 0;
    for (const mk of await spendMonthKeys()) {
      const list = await ensureMonth(mk);
      if (!list.some((e) => e.itemId === item.id)) continue;
      const next = list.map((e) => {
        if (e.itemId !== item.id) return e;
        count++;
        return { ...e, name: item.name, categoryId: item.categoryId, tagIds: [...item.tagIds] };
      });
      await writeMonth(mk, next);
    }
    return count;
  }

  // ---------- spend entries ----------
  function validateEntry(e) {
    cleanName(e.name);
    if (!Number.isInteger(e.amount) || e.amount < 0) throw new Error('Amount must be a valid amount');
    if (!Number.isInteger(e.qty) || e.qty < 1) throw new Error('Quantity must be at least 1');
    if (!TS_RE.test(e.ts)) throw new Error('Invalid date/time');
    if (!state.categories.some((c) => c.id === e.categoryId)) throw new Error('Pick a category');
  }

  async function logSpend({ itemId = null, name, categoryId, tagIds = [], qty = 1, amount, ts = now(), note = '' }) {
    const entry = {
      id: makeId(),
      itemId,
      name: String(name ?? '').trim(),
      categoryId,
      tagIds: [...tagIds],
      qty,
      amount,
      ts,
      note: String(note ?? '').trim(),
    };
    validateEntry(entry);
    const mk = monthKey(ts);
    await writeMonth(mk, [...(await ensureMonth(mk)), entry]);
    return entry;
  }

  function logItem(item, { qty = 1, amount, ts, note } = {}) {
    return logSpend({
      itemId: item.id,
      name: item.name,
      categoryId: item.categoryId,
      tagIds: item.tagIds,
      qty,
      amount: amount ?? item.price * qty,
      ts,
      note,
    });
  }

  async function updateSpend(entry, patch) {
    const updated = { ...entry, ...patch, id: entry.id, itemId: entry.itemId };
    updated.name = String(updated.name ?? '').trim();
    updated.note = String(updated.note ?? '').trim();
    validateEntry(updated);
    const oldMk = monthKey(entry.ts);
    const newMk = monthKey(updated.ts);
    if (oldMk === newMk) {
      await writeMonth(oldMk, (await ensureMonth(oldMk)).map((e) => (e.id === entry.id ? updated : e)));
    } else {
      // new month first: if the second write fails the entry is duplicated, never lost
      await writeMonth(newMk, [...(await ensureMonth(newMk)), updated]);
      await writeMonth(oldMk, (await ensureMonth(oldMk)).filter((e) => e.id !== entry.id));
    }
    return updated;
  }

  async function deleteSpend(entry) {
    const mk = monthKey(entry.ts);
    await writeMonth(mk, (await ensureMonth(mk)).filter((e) => e.id !== entry.id));
  }

  async function restoreSpend(entry) {
    const mk = monthKey(entry.ts);
    const list = await ensureMonth(mk);
    if (list.some((e) => e.id === entry.id)) return;
    await writeMonth(mk, [...list, entry]);
  }

  // ---------- budgets ----------
  async function clearBudgetWarning(budgetId) {
    const warned = state.meta.budgetWarnings || {};
    if (!warned[budgetId]) return;
    const { [budgetId]: _gone, ...rest } = warned;
    const meta = { ...state.meta, budgetWarnings: rest };
    await kv.set(K.meta, meta);
    state.meta = meta;
  }

  async function saveBudget({ id, scope, refId = null, period, limit }) {
    if (!SCOPES.includes(scope)) throw new Error('Pick what the budget applies to');
    if (!PERIODS.includes(period)) throw new Error('Pick day, week or month');
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('Limit must be more than zero');
    if (scope === 'all') refId = null;
    else if (!(scope === 'category' ? state.categories : state.items).some((r) => r.id === refId)) {
      throw new Error(`Pick a ${scope}`);
    }
    const dup = state.budgets.find((b) => b.id !== id && b.scope === scope && b.refId === refId && b.period === period);
    if (dup) throw new Error(`There is already a ${period} budget for that`);
    const budget = await upsert(K.budgets, 'budgets', { id: id || makeId(), scope, refId, period, limit });
    if (id) await clearBudgetWarning(id); // a changed limit may warn again
    return budget;
  }

  async function deleteBudget(budgetId) {
    const next = state.budgets.filter((b) => b.id !== budgetId);
    await kv.set(K.budgets, next);
    state.budgets = next;
    await clearBudgetWarning(budgetId);
  }

  async function markBudgetWarned(budgetId, periodKey, level) {
    const meta = { ...state.meta, budgetWarnings: { ...(state.meta.budgetWarnings || {}), [budgetId]: { periodKey, level } } };
    await kv.set(K.meta, meta);
    state.meta = meta;
  }

  // ---------- people + ledger ----------
  async function markPeopleDirty() {
    if (state.meta.dirtyPeople) return;
    const meta = { ...state.meta, dirtyPeople: true };
    await kv.set(K.meta, meta);
    state.meta = meta;
  }

  async function savePerson({ id, name, archived = false }) {
    name = cleanName(name);
    assertUniqueName(state.people, name, id, 'Person');
    const person = await upsert(K.people, 'people', { id: id || makeId(), name, archived: !!archived });
    await markPeopleDirty();
    return person;
  }

  async function deletePerson(personId) {
    if (state.ledger.some((e) => e.personId === personId)) throw new Error('Person has entries — archive them instead');
    const next = state.people.filter((p) => p.id !== personId);
    await kv.set(K.people, next);
    state.people = next;
    await markPeopleDirty();
  }

  function validateLedger(e) {
    if (!state.people.some((p) => p.id === e.personId)) throw new Error('Pick a person');
    if (!KINDS.includes(e.kind)) throw new Error('Pick what happened');
    if (!Number.isInteger(e.amount) || e.amount <= 0) throw new Error('Amount must be more than zero');
    if (!TS_RE.test(e.ts)) throw new Error('Invalid date/time');
  }

  async function writeLedger(next) {
    await kv.set(K.ledger, next);
    state.ledger = next;
    await markPeopleDirty();
  }

  async function addLedger({ personId, kind, amount, ts = now(), note = '' }) {
    const entry = { id: makeId(), personId, kind, amount, ts, note: String(note ?? '').trim() };
    validateLedger(entry);
    await writeLedger([...state.ledger, entry]);
    return entry;
  }

  async function updateLedger(entry, patch) {
    const updated = { ...entry, ...patch, id: entry.id };
    updated.note = String(updated.note ?? '').trim();
    validateLedger(updated);
    await writeLedger(state.ledger.map((e) => (e.id === entry.id ? updated : e)));
    return updated;
  }

  async function deleteLedger(entry) {
    await writeLedger(state.ledger.filter((e) => e.id !== entry.id));
  }

  async function restoreLedger(entry) {
    if (state.ledger.some((e) => e.id === entry.id)) return;
    await writeLedger([...state.ledger, entry]);
  }

  // ---------- reads ----------
  const monthEntries = (mk) => state.months.get(mk) || [];
  const loadedEntries = () => [...state.months.values()].flat();
  function entriesForDay(day) {
    return monthEntries(monthKey(day))
      .filter((e) => dayKey(e.ts) === day)
      .sort((a, b) => b.ts.localeCompare(a.ts));
  }

  // every entry whose local day is in [from, to]; loads (and caches) any month keys it needs
  async function loadRange(from, to) {
    const out = [];
    for (const mk of monthsBetween(from, to)) {
      for (const e of await ensureMonth(mk)) {
        const d = dayKey(e.ts);
        if (d >= from && d <= to) out.push(e);
      }
    }
    return out;
  }

  // ---------- whole-db ----------
  async function exportRaw() {
    const data = {};
    for (const k of await kv.keys('')) data[k] = await kv.get(k);
    return { app: 'expense-tracker', schemaVersion: SCHEMA_VERSION, exportedAt: now(), data };
  }

  async function wipe() {
    for (const k of await kv.keys('')) await kv.del(k);
    await boot();
  }

  // replace EVERYTHING with a backup. validated first, so a bad file never touches the phone.
  // keeps this device's drive link; marks every month dirty so a connected drive re-uploads.
  async function importRaw(dump) {
    validateBackup(dump, SCHEMA_VERSION);
    const d = dump.data;
    const monthKeys = Object.keys(d).filter((k) => k.startsWith('spend:'));
    const meta = {
      ...defaultMeta(),
      ...d.meta,
      schemaVersion: SCHEMA_VERSION,
      drive: state.meta.drive,
      dirtyMonths: monthKeys.map((k) => k.slice('spend:'.length)).sort(),
      dirtyPeople: true,
      lastBackupAt: now(),
    };
    const before = (await exportRaw()).data;
    try {
      for (const k of await kv.keys('')) await kv.del(k);
      for (const k of ['categories', 'tags', 'items', 'people', 'ledger', 'budgets', ...monthKeys]) {
        if (d[k] !== undefined) await kv.set(k, d[k]);
      }
      await kv.set(K.meta, meta);
    } catch (err) {
      // best effort: put the previous data back before reporting the failure
      try {
        for (const k of await kv.keys('')) await kv.del(k);
        for (const [k, v] of Object.entries(before)) await kv.set(k, v);
      } catch { /* nothing more we can do */ }
      await boot();
      throw err;
    }
    await boot();
  }

  async function markBackedUp() {
    const meta = { ...state.meta, lastBackupAt: now() };
    await kv.set(K.meta, meta);
    state.meta = meta;
  }

  // ---------- drive bookkeeping (meta only: these never notify) ----------
  async function setDrive(drive) {
    const meta = { ...state.meta, drive };
    await kv.set(K.meta, meta);
    state.meta = meta;
  }

  // clear exactly what an upload sent — unless data changed while it ran (then the next backup re-sends)
  async function clearDirty(months, people, seqAtStart) {
    if (seq !== seqAtStart) return false;
    const meta = {
      ...state.meta,
      dirtyMonths: state.meta.dirtyMonths.filter((m) => !months.includes(m)),
      dirtyPeople: people ? false : state.meta.dirtyPeople,
    };
    await kv.set(K.meta, meta);
    state.meta = meta;
    return true;
  }

  async function markAllDirty() {
    const meta = { ...state.meta, dirtyMonths: await spendMonthKeys(), dirtyPeople: true };
    await kv.set(K.meta, meta);
    state.meta = meta;
  }

  // ---------- change notifications ----------
  let seq = 0;
  const listeners = new Set();
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  // every public mutator runs one at a time. without this, two fast taps both read the
  // same month array while the first idb write is pending, and the second write drops the first entry.
  // internal calls (logItem -> logSpend, wipe -> boot) use the raw functions, so the queue never waits on itself.
  let tail = Promise.resolve();
  const serial = (fn) => (...args) => {
    const run = tail.then(() => fn(...args));
    tail = run.catch(() => {});
    return run;
  };
  // data mutators: serialized, and after a SUCCESSFUL run bump the change counter and notify
  const data = (fn) => serial(async (...args) => {
    const result = await fn(...args);
    seq += 1;
    for (const l of listeners) { try { l(); } catch { /* a listener must never break a write */ } }
    return result;
  });

  return {
    state,
    boot: serial(boot),
    ensureMonth,
    saveCategory: data(saveCategory),
    saveTag: data(saveTag),
    saveItem: data(saveItem),
    deleteItem: data(deleteItem),
    isItemUsed,
    applyItemToPast: data(applyItemToPast),
    logSpend: data(logSpend),
    logItem: data(logItem),
    updateSpend: data(updateSpend),
    deleteSpend: data(deleteSpend),
    restoreSpend: data(restoreSpend),
    savePerson: data(savePerson),
    deletePerson: data(deletePerson),
    addLedger: data(addLedger),
    updateLedger: data(updateLedger),
    deleteLedger: data(deleteLedger),
    restoreLedger: data(restoreLedger),
    saveBudget: data(saveBudget),
    deleteBudget: data(deleteBudget),
    markBudgetWarned: serial(markBudgetWarned),
    entriesForDay, monthEntries, loadedEntries, loadRange,
    exportRaw,
    wipe: data(wipe),
    importRaw: data(importRaw),
    markBackedUp: serial(markBackedUp),
    setDrive: serial(setDrive),
    clearDirty: serial(clearDirty),
    markAllDirty: serial(markAllDirty),
    subscribe,
    changeSeq: () => seq,
  };
}
