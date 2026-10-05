import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { STARTER_GROUPS, STARTER_ITEMS, planStarter, applyStarter } from '../js/starter.js';

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

test('starter list: unique names, integer paise > 0, known groups, seeded category names', () => {
  const names = STARTER_ITEMS.map((i) => i.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  for (const i of STARTER_ITEMS) {
    assert.ok(Number.isInteger(i.price) && i.price > 0, i.name);
    assert.ok(STARTER_GROUPS.includes(i.group), i.name);
    assert.ok(['Food', 'Groceries', 'Travel'].includes(i.category), i.name);
  }
});

test('planStarter skips existing item names, reuses categories case-insensitively, lists missing ones once', () => {
  const state = {
    categories: [{ id: 'c1', name: 'food', archived: false }, { id: 'c2', name: 'Travel', archived: true }],
    items: [{ id: 'i1', name: 'CHAI' }],
    tags: [{ id: 't1', name: 'unhealthy' }],
  };
  const picks = [
    { name: 'chai', price: 1500, category: 'Food' },
    { name: 'Five Star', price: 1000, category: 'Food', unhealthy: true },
    { name: 'milk 500 ml', price: 2800, category: 'Groceries' },
    { name: 'bread', price: 4000, category: 'Groceries' },
    { name: 'metro', price: 3000, category: 'Travel' },
  ];
  const plan = planStarter(picks, state);
  assert.deepEqual(plan.newCategories, ['Groceries']);
  assert.deepEqual(plan.items.map((i) => i.name), ['Five Star', 'milk 500 ml', 'bread', 'metro']);
  assert.deepEqual(plan.items[0], { name: 'Five Star', price: 1000, categoryName: 'food', tagNames: ['unhealthy'] });
  assert.deepEqual(plan.items[1].tagNames, []);
});

test('applyStarter creates items with the right category, price and tag on a fresh store', async () => {
  const { store } = await fresh();
  await store.saveCategory({ ...store.state.categories.find((c) => c.name === 'Groceries'), name: 'Kirana' });
  const plan = planStarter([
    { name: 'Coke 250 ml', price: 2000, category: 'Food', unhealthy: true },
    { name: 'eggs (6)', price: 4500, category: 'Groceries' },
  ], store.state);
  assert.deepEqual(plan.newCategories, ['Groceries']);
  await applyStarter(store, plan);
  const cat = (name) => store.state.categories.find((c) => c.name === name);
  const coke = store.state.items.find((i) => i.name === 'Coke 250 ml');
  const eggs = store.state.items.find((i) => i.name === 'eggs (6)');
  assert.equal(coke.price, 2000);
  assert.equal(coke.categoryId, cat('Food').id);
  assert.deepEqual(coke.tagIds, [store.state.tags.find((t) => t.name === 'unhealthy').id]);
  assert.equal(eggs.categoryId, cat('Groceries').id);
  assert.ok(cat('Kirana'));
});
