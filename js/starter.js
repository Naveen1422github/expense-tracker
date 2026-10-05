// starter items — the "what do you buy often?" list shown on first open. pure: no DOM.
// kharchly shines for small, repeat, fixed-price buys, so the list is packaged goods with a known MRP.
// prices are defaults in paise; the user can edit each one before adding. edit this list freely.
export const STARTER_GROUPS = ['snacks', 'drinks', 'daily', 'travel'];

export const STARTER_ITEMS = [
  { group: 'snacks', name: 'Five Star', price: 1000, category: 'Food', unhealthy: true },
  { group: 'snacks', name: 'Dairy Milk', price: 1000, category: 'Food', unhealthy: true },
  { group: 'snacks', name: 'Lays', price: 1000, category: 'Food', unhealthy: true },
  { group: 'snacks', name: 'Kurkure', price: 1000, category: 'Food', unhealthy: true },
  { group: 'snacks', name: 'Parle-G', price: 1000, category: 'Food' },
  { group: 'snacks', name: 'Maggi', price: 1500, category: 'Food', unhealthy: true },
  { group: 'drinks', name: 'Coke 250 ml', price: 2000, category: 'Food', unhealthy: true },
  { group: 'drinks', name: 'Thums Up 250 ml', price: 2000, category: 'Food', unhealthy: true },
  { group: 'drinks', name: 'Frooti', price: 1000, category: 'Food' },
  { group: 'drinks', name: 'Red Bull', price: 12500, category: 'Food', unhealthy: true },
  { group: 'drinks', name: 'water 1 L', price: 2000, category: 'Food' },
  { group: 'daily', name: 'chai', price: 1500, category: 'Food' },
  { group: 'daily', name: 'coffee', price: 2000, category: 'Food' },
  { group: 'daily', name: 'milk 500 ml', price: 2800, category: 'Groceries' },
  { group: 'daily', name: 'bread', price: 4000, category: 'Groceries' },
  { group: 'daily', name: 'eggs (6)', price: 4500, category: 'Groceries' },
  { group: 'travel', name: 'metro', price: 3000, category: 'Travel' },
  { group: 'travel', name: 'auto (short)', price: 5000, category: 'Travel' },
];

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// picks: [{name, price, category, unhealthy?}] → { newCategories: [name], items: [{name, price, categoryName, tagNames}] }
// skips names that already exist; reuses any category with the same name (archived too — a new one would clash).
export function planStarter(picks, state) {
  const newCategories = [];
  const items = [];
  const hasTag = state.tags.some((t) => same(t.name, 'unhealthy'));
  for (const p of picks) {
    if (state.items.some((i) => same(i.name, p.name))) continue;
    const existing = state.categories.find((c) => same(c.name, p.category));
    const categoryName = existing ? existing.name : p.category;
    if (!existing && !newCategories.includes(p.category)) newCategories.push(p.category);
    items.push({ name: p.name, price: p.price, categoryName, tagNames: p.unhealthy && hasTag ? ['unhealthy'] : [] });
  }
  return { newCategories, items };
}

// writes the plan through the store api only (store.js stays the only kv owner). sequential: each save
// reads the state the previous one wrote.
export async function applyStarter(store, plan) {
  for (const name of plan.newCategories) await store.saveCategory({ name });
  const catId = (name) => store.state.categories.find((c) => same(c.name, name)).id;
  const tagIds = (names) => names.map((n) => store.state.tags.find((t) => same(t.name, n))?.id).filter(Boolean);
  for (const it of plan.items) {
    await store.saveItem({ name: it.name, price: it.price, categoryId: catId(it.categoryName), tagIds: tagIds(it.tagNames) });
  }
}
