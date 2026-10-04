import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, SCHEMA_VERSION } from '../js/store.js';

function memKv() {
  const m = new Map();
  return {
    m,
    failWrites: false,
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : null; },
    async set(k, v) { if (this.failWrites) throw new Error('disk full'); m.set(k, structuredClone(v)); },
    async del(k) { m.delete(k); },
    async keys(prefix = '') { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

async function fresh(now = '2026-10-04T10:00', kv = memKv()) {
  let n = 0;
  const store = createStore(kv, { now: () => now, makeId: () => `id${++n}` });
  await store.boot();
  return { kv, store };
}
const catId = (store, name) => store.state.categories.find((c) => c.name === name).id;
async function milk(store) {
  return store.saveItem({ name: 'Amul milk', price: 3000, categoryId: catId(store, 'Groceries'), tagIds: [] });
}

test('first boot seeds categories, the unhealthy tag and meta; second boot does not duplicate', async () => {
  const { kv, store } = await fresh();
  assert.deepEqual(store.state.categories.map((c) => c.name), ['Food', 'Groceries', 'Travel', 'Bills', 'Shopping']);
  assert.deepEqual(store.state.tags.map((t) => t.name), ['unhealthy']);
  assert.equal(store.state.meta.schemaVersion, SCHEMA_VERSION);
  const { store: again } = await fresh('2026-10-04T10:00', kv);
  assert.equal(again.state.categories.length, 5);
});

test('boot refuses data from a newer app version', async () => {
  const kv = memKv();
  await kv.set('meta', { schemaVersion: 99 });
  const store = createStore(kv);
  await assert.rejects(store.boot(), /newer/);
});

test('boot loads the current month and the previous 3', async () => {
  const { store } = await fresh('2026-10-04T10:00');
  assert.deepEqual([...store.state.months.keys()], ['2026-07', '2026-08', '2026-09', '2026-10']);
});

test('categories: blank and duplicate (case-insensitive) names are rejected', async () => {
  const { store } = await fresh();
  await assert.rejects(store.saveCategory({ name: '   ' }), /required/);
  await assert.rejects(store.saveCategory({ name: 'food' }), /already exists/);
  const health = await store.saveCategory({ name: ' Health ' });
  assert.equal(health.name, 'Health');
  const renamed = await store.saveCategory({ ...health, name: 'health' }); // same record, case change ok
  assert.equal(renamed.name, 'health');
});

test('saveItem validates price and category', async () => {
  const { store } = await fresh();
  await assert.rejects(store.saveItem({ name: 'x', price: 12.5, categoryId: catId(store, 'Food') }), /price/i);
  await assert.rejects(store.saveItem({ name: 'x', price: 100, categoryId: 'nope' }), /category/i);
});

test('logItem snapshots the item into the month of its ts and marks it dirty', async () => {
  const { store, kv } = await fresh();
  const item = await milk(store);
  const e = await store.logItem(item, { qty: 2, ts: '2026-09-30T23:50' }); // backdated into September
  assert.equal(e.amount, 6000);
  assert.equal(e.name, 'Amul milk');
  assert.equal(e.categoryId, item.categoryId);
  assert.equal((await kv.get('spend:2026-09')).length, 1);
  assert.equal(await kv.get('spend:2026-10'), null);
  assert.ok(store.state.meta.dirtyMonths.includes('2026-09'));
});

test('logSpend rejects bad amount, qty, ts and missing category', async () => {
  const { store } = await fresh();
  const base = { name: 'Chai', categoryId: catId(store, 'Food'), amount: 1500 };
  await assert.rejects(store.logSpend({ ...base, amount: -1 }), /amount/i);
  await assert.rejects(store.logSpend({ ...base, amount: 15.5 }), /amount/i);
  await assert.rejects(store.logSpend({ ...base, qty: 0 }), /quantity/i);
  await assert.rejects(store.logSpend({ ...base, ts: '2026-10-04' }), /date/i);
  await assert.rejects(store.logSpend({ ...base, categoryId: 'nope' }), /category/i);
  await assert.rejects(store.logSpend({ ...base, name: ' ' }), /required/i);
});

test('updateSpend moves an entry between month keys when its date changes month', async () => {
  const { store, kv } = await fresh();
  const e = await store.logSpend({ name: 'Chai', categoryId: catId(store, 'Food'), amount: 1500, ts: '2026-10-01T08:00' });
  const moved = await store.updateSpend(e, { ts: '2026-09-30T20:00' });
  assert.equal(moved.id, e.id);
  assert.deepEqual((await kv.get('spend:2026-10')).map((x) => x.id), []);
  assert.deepEqual((await kv.get('spend:2026-09')).map((x) => x.id), [e.id]);
  assert.ok(store.state.meta.dirtyMonths.includes('2026-10') && store.state.meta.dirtyMonths.includes('2026-09'));
});

test('updateSpend with invalid data rejects and changes nothing', async () => {
  const { store } = await fresh();
  const e = await store.logSpend({ name: 'Chai', categoryId: catId(store, 'Food'), amount: 1500 });
  await assert.rejects(store.updateSpend(e, { amount: -5 }), /amount/i);
  assert.equal(store.monthEntries('2026-10')[0].amount, 1500);
});

test('overlapping writes are serialized — two fast taps never lose an entry', async () => {
  const { store, kv } = await fresh();
  const base = { categoryId: catId(store, 'Food'), amount: 1500 };
  await Promise.all([store.logSpend({ ...base, name: 'A' }), store.logSpend({ ...base, name: 'B' })]);
  assert.equal((await kv.get('spend:2026-10')).length, 2);
  assert.equal(store.monthEntries('2026-10').length, 2);
});

test('a failed write leaves state unchanged', async () => {
  const { store, kv } = await fresh();
  const before = store.monthEntries('2026-10').length;
  kv.failWrites = true;
  await assert.rejects(store.logSpend({ name: 'Chai', categoryId: catId(store, 'Food'), amount: 1500 }), /disk full/);
  assert.equal(store.monthEntries('2026-10').length, before);
  await assert.rejects(store.saveCategory({ name: 'Health' }), /disk full/);
  assert.equal(store.state.categories.length, 5);
});

test('deleteSpend then restoreSpend round-trips; restore is idempotent', async () => {
  const { store } = await fresh();
  const e = await store.logSpend({ name: 'Chai', categoryId: catId(store, 'Food'), amount: 1500 });
  await store.deleteSpend(e);
  assert.equal(store.monthEntries('2026-10').length, 0);
  await store.restoreSpend(e);
  await store.restoreSpend(e);
  assert.deepEqual(store.monthEntries('2026-10').map((x) => x.id), [e.id]);
});

test('applyItemToPast rewrites only that item, across months; one-offs untouched', async () => {
  const { store } = await fresh();
  const item = await milk(store);
  await store.logItem(item, { ts: '2026-08-10T08:00' });
  await store.logItem(item, { ts: '2026-10-02T08:00' });
  const oneOff = await store.logSpend({ name: 'Amul milk', categoryId: catId(store, 'Groceries'), amount: 3000, ts: '2026-10-02T09:00' });
  const edited = await store.saveItem({ ...item, name: 'Milk', categoryId: catId(store, 'Food') });
  assert.equal(await store.applyItemToPast(edited), 2);
  const all = store.loadedEntries();
  assert.ok(all.filter((e) => e.itemId === item.id).every((e) => e.name === 'Milk' && e.categoryId === catId(store, 'Food')));
  assert.equal(all.find((e) => e.id === oneOff.id).name, 'Amul milk');
});

test('deleteItem refuses a used item and deletes an unused one', async () => {
  const { store } = await fresh();
  const used = await milk(store);
  await store.logItem(used, { ts: '2025-01-05T08:00' }); // outside the boot window on purpose
  assert.equal(await store.isItemUsed(used.id), true);
  await assert.rejects(store.deleteItem(used.id), /archive/);
  const unused = await store.saveItem({ name: 'Sting', price: 2000, categoryId: catId(store, 'Food') });
  await store.deleteItem(unused.id);
  assert.equal(store.state.items.some((i) => i.id === unused.id), false);
});

test('entriesForDay filters by local day and sorts newest first', async () => {
  const { store } = await fresh();
  const food = catId(store, 'Food');
  await store.logSpend({ name: 'A', categoryId: food, amount: 100, ts: '2026-10-04T08:00' });
  await store.logSpend({ name: 'B', categoryId: food, amount: 100, ts: '2026-10-04T21:00' });
  await store.logSpend({ name: 'C', categoryId: food, amount: 100, ts: '2026-10-03T23:59' });
  assert.deepEqual(store.entriesForDay('2026-10-04').map((e) => e.name), ['B', 'A']);
});

test('exportRaw includes every key; wipe clears and re-seeds', async () => {
  const { store } = await fresh();
  await store.logSpend({ name: 'Chai', categoryId: catId(store, 'Food'), amount: 1500 });
  const dump = await store.exportRaw();
  assert.equal(dump.schemaVersion, SCHEMA_VERSION);
  assert.ok(dump.data['spend:2026-10'] && dump.data.categories && dump.data.meta);
  await store.wipe();
  assert.equal(store.monthEntries('2026-10').length, 0);
  assert.equal(store.state.items.length, 0);
  assert.equal(store.state.categories.length, 5);
});

// ---------- people + ledger (plan 2) ----------
async function puru(store) {
  return store.savePerson({ name: 'Puru' });
}

test('people: blank and duplicate (case-insensitive) names are rejected', async () => {
  const { store } = await fresh();
  assert.deepEqual(store.state.people, []);
  assert.deepEqual(store.state.ledger, []);
  await puru(store);
  await assert.rejects(store.savePerson({ name: 'puru' }), /already exists/);
  await assert.rejects(store.savePerson({ name: ' ' }), /required/);
});

test('addLedger validates person, kind, amount and ts', async () => {
  const { store } = await fresh();
  const p = await puru(store);
  const base = { personId: p.id, kind: 'lent', amount: 50000 };
  await assert.rejects(store.addLedger({ ...base, personId: 'nope' }), /person/i);
  await assert.rejects(store.addLedger({ ...base, kind: 'gift' }), /what happened/i);
  await assert.rejects(store.addLedger({ ...base, amount: 0 }), /more than zero/i);
  await assert.rejects(store.addLedger({ ...base, amount: -100 }), /more than zero/i);
  await assert.rejects(store.addLedger({ ...base, amount: 10.5 }), /more than zero/i);
  await assert.rejects(store.addLedger({ ...base, ts: '2026-10-04' }), /date/i);
});

test('addLedger persists and marks people dirty', async () => {
  const { store, kv } = await fresh();
  const p = await puru(store);
  const e = await store.addLedger({ personId: p.id, kind: 'lent', amount: 50000, note: ' movie ' });
  assert.equal(e.ts, '2026-10-04T10:00');
  assert.equal(e.note, 'movie');
  assert.deepEqual((await kv.get('ledger')).map((x) => x.id), [e.id]);
  assert.equal(store.state.meta.dirtyPeople, true);
});

test('ledger writes never touch spend months', async () => {
  const { store, kv } = await fresh();
  const p = await puru(store);
  await store.addLedger({ personId: p.id, kind: 'lent', amount: 50000 });
  assert.equal(await kv.get('spend:2026-10'), null);
  assert.equal(store.monthEntries('2026-10').length, 0);
  assert.deepEqual(store.state.meta.dirtyMonths, []);
});

test('updateLedger / deleteLedger / restoreLedger round-trip; restore is idempotent', async () => {
  const { store } = await fresh();
  const p = await puru(store);
  const e = await store.addLedger({ personId: p.id, kind: 'lent', amount: 50000 });
  const u = await store.updateLedger(e, { amount: 60000, kind: 'borrowed' });
  assert.equal(u.id, e.id);
  assert.deepEqual([store.state.ledger[0].amount, store.state.ledger[0].kind], [60000, 'borrowed']);
  await assert.rejects(store.updateLedger(u, { amount: 0 }), /more than zero/i);
  assert.equal(store.state.ledger[0].amount, 60000);
  await store.deleteLedger(u);
  assert.equal(store.state.ledger.length, 0);
  await store.restoreLedger(u);
  await store.restoreLedger(u);
  assert.equal(store.state.ledger.length, 1);
});

test('deletePerson refuses a person with entries; overlapping ledger writes keep both', async () => {
  const { store, kv } = await fresh();
  const p = await puru(store);
  await Promise.all([
    store.addLedger({ personId: p.id, kind: 'lent', amount: 100 }),
    store.addLedger({ personId: p.id, kind: 'lent', amount: 200 }),
  ]);
  assert.equal((await kv.get('ledger')).length, 2);
  await assert.rejects(store.deletePerson(p.id), /archive/);
  const lone = await store.savePerson({ name: 'Lone' });
  await store.deletePerson(lone.id);
  assert.equal(store.state.people.some((x) => x.id === lone.id), false);
});

// ---------- reports (plan 3) ----------
test('loadRange loads months outside the boot window and filters by local day', async () => {
  const { store, kv } = await fresh();
  const food = catId(store, 'Food');
  const old = (id, ts, amount) => ({ id, itemId: null, name: 'Old', categoryId: food, tagIds: [], qty: 1, amount, ts, note: '' });
  // written straight to kv: old data that boot never loaded
  await kv.set('spend:2025-01', [old('jan', '2025-01-31T23:00', 100)]);
  await kv.set('spend:2025-02', [old('feb1', '2025-02-01T00:30', 200), old('feb20', '2025-02-20T12:00', 300)]);
  const got = await store.loadRange('2025-02-01', '2025-02-10');
  assert.deepEqual(got.map((x) => x.id), ['feb1']);
  assert.equal(store.state.months.has('2025-02'), true);
  assert.equal(store.state.months.has('2025-01'), false);
});

// ---------- budgets (plan 4) ----------
test('saveBudget validates scope, period, limit, target and duplicates', async () => {
  const { store } = await fresh();
  const food = catId(store, 'Food');
  await assert.rejects(store.saveBudget({ scope: 'tag', period: 'month', limit: 100 }), /applies to/);
  await assert.rejects(store.saveBudget({ scope: 'all', period: 'year', limit: 100 }), /day, week or month/);
  await assert.rejects(store.saveBudget({ scope: 'all', period: 'month', limit: 0 }), /more than zero/);
  await assert.rejects(store.saveBudget({ scope: 'category', refId: 'nope', period: 'month', limit: 100 }), /category/);
  const b = await store.saveBudget({ scope: 'category', refId: food, period: 'month', limit: 500000 });
  await assert.rejects(store.saveBudget({ scope: 'category', refId: food, period: 'month', limit: 1 }), /already/);
  const all = await store.saveBudget({ scope: 'all', refId: 'ignored', period: 'day', limit: 60000 });
  assert.equal(all.refId, null);
  assert.equal(store.state.budgets.length, 2);
  assert.equal((await store.saveBudget({ ...b, limit: 600000 })).limit, 600000); // editing itself is not a duplicate
});

test('budget warnings persist across reloads; deleting a budget clears its warning', async () => {
  const { store, kv } = await fresh();
  const b = await store.saveBudget({ scope: 'all', period: 'month', limit: 1000 });
  await store.markBudgetWarned(b.id, '2026-10', 80);
  const { store: again } = await fresh('2026-10-04T10:00', kv);
  assert.deepEqual(again.state.meta.budgetWarnings[b.id], { periodKey: '2026-10', level: 80 });
  assert.equal(again.state.budgets.length, 1);
  await again.deleteBudget(b.id);
  assert.equal(again.state.budgets.length, 0);
  assert.equal(again.state.meta.budgetWarnings[b.id], undefined);
});

test('editing a budget clears its warning so a new limit can warn again', async () => {
  const { store } = await fresh();
  const b = await store.saveBudget({ scope: 'all', period: 'month', limit: 1000 });
  await store.markBudgetWarned(b.id, '2026-10', 100);
  await store.saveBudget({ ...b, limit: 5000 });
  assert.equal(store.state.meta.budgetWarnings[b.id], undefined);
});
