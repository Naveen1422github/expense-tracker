# Kharchly — Plan 8: Onboarding (starter items, empty screens, one-time tips)

> **For agentic workers:** Execute Tasks 1–3 in order, in one pass. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a new user understands kharchly without being told.
- **First open:** a "what do you buy often?" picker with fixed-price everyday items (Five Star, Coke, chai…). Tap a few, fix any price, done → a ready grid, and the first tap logs a real expense.
- **Empty screens** say what to do next.
- **One-time tips** appear inline after real actions, one at a time.

**Positioning (decided 2026-10-05):** kharchly is built for small, repeat daily buys. Varying amounts use hold-to-edit, and rare costs use a one-off expense. The picker's intro line says this honestly.

**Architecture:**
- `js/starter.js` is **pure, with no DOM**:
  - `STARTER_GROUPS` and `STARTER_ITEMS` are the user-editable list.
  - `planStarter(picks, state)` decides what to create.
  - `applyStarter(store, plan)` writes through the store API only.
- `js/starter-view.js` is the picker modal plus the first-run flag.
- `js/tips.js` holds the pure `TIPS` and `nextTip(ctx, seen)`, plus guarded localStorage helpers.
- Wiring changes go in `spend.js`, `settings.js` and `app.js`.

**Spec anchors:** this builds on commit `4bdc770`. New installs already seed the categories `Food, Groceries, Travel, Bills, Shopping` and the tag `unhealthy` (`js/store.js:17-18`).

## Global Constraints

- **Starter list:**
  - Prices are **integer paise** and are only defaults. The user can edit each price before adding.
  - Category is matched by **name, case-insensitive, archived included**. It is created only if no category with that name exists.
  - Items whose name already exists (case-insensitive) are hidden from the picker and skipped by `planStarter`.
  - The `unhealthy` flag maps to the `unhealthy` tag **only if that tag exists**.
- **First run:** the picker auto-opens once, only when there are **no items** and the flag `kharchly:starter-seen` is unset.
  - Closing it in any way sets the flag: done, skip, a tap outside, or Esc.
  - Existing users who already have items never see it.
- **Tips:**
  - At most one tip at a time, shown inline at the top of the spend tab, with a "got it" button.
  - Never shown as a toast: a toast would replace the undo toast.
  - Seen keys are stored in localStorage `kharchly:tips` as a JSON array.
- **localStorage use:**
  - It holds only per-device UI conveniences, the same as the existing install-banner flag.
  - Every read and write is wrapped in try/catch. If storage fails, the app behaves as "not seen", or skips the tip.
  - `store.js` is still the only module that touches `kv`.
- **Copy:** lowercase, the app's voice, short.
- **No builds. No git write commands.** Tests run with `node --test` from `expense-tracker/`.

## File map

| File | Change | Task |
|---|---|---|
| `js/starter.js` | **create**: list, `planStarter`, `applyStarter` | 1 |
| `tests/starter.test.js` | **create** | 1 |
| `js/tips.js` | **create**: `TIPS`, `nextTip`, `seenTips`, `markTipSeen` | 2 |
| `tests/tips.test.js` | **create** | 2 |
| `js/starter-view.js` | **create**: `openStarterPicker`, `starterSeen` | 3 |
| `js/spend.js` | empty state + tip banner | 3 |
| `js/settings.js` | "+ add common items" in the items section | 3 |
| `js/app.js` | first-run auto-open | 3 |
| `style.css` | `.starter-chips`, `.tip-banner`, `.starter-price-row` | 3 |
| `sw.js` | add 3 modules, `CACHE_NAME` → `kharchly-v11` | 3 |

---

### Task 1: starter.js (pure)

- [ ] **Step 1: Write the failing test** `tests/starter.test.js`. Copy `memKv()` and `fresh()` **verbatim** from the top of `tests/store.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { STARTER_GROUPS, STARTER_ITEMS, planStarter, applyStarter } from '../js/starter.js';

// memKv() and fresh() — copied verbatim from tests/store.test.js

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
```

- [ ] **Step 2:** Run `node --test tests/starter.test.js`. Expect FAIL (no module).

- [ ] **Step 3: Create `js/starter.js`.**

```js
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
```

- [ ] **Step 4:** Run `node --test tests/starter.test.js`. Expect PASS, 3 tests.

### Task 2: tips.js

- [ ] **Step 1: Write the failing test** `tests/tips.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIPS, nextTip } from '../js/tips.js';

test('no tip before the first log; then tips unlock in order by log count', () => {
  assert.equal(nextTip({ logs: 0 }, new Set()), null);
  assert.equal(nextTip({ logs: 1 }, new Set()).key, 'hold');
  assert.equal(nextTip({ logs: 3 }, new Set(['hold'])).key, 'edit');
  assert.equal(nextTip({ logs: 2 }, new Set(['hold'])), null);
  assert.equal(nextTip({ logs: 99 }, new Set(TIPS.map((t) => t.key))), null);
});

test('tips are short one-liners with unique keys', () => {
  assert.equal(new Set(TIPS.map((t) => t.key)).size, TIPS.length);
  for (const t of TIPS) assert.ok(t.text.length < 80, t.key);
});
```

- [ ] **Step 2:** Run it. Expect FAIL.

- [ ] **Step 3: Create `js/tips.js`.**

```js
// one-time tips — shown inline on the spend tab after real actions, one at a time, never as a toast
// (a toast would replace the undo toast). seen keys live in localStorage: a per-device convenience.
export const TIPS = [
  { key: 'hold', text: 'tip: hold an item to change qty, amount or date, or add a note.', when: (c) => c.logs >= 1 },
  { key: 'edit', text: 'tip: logged the wrong thing? tap it in the list below to fix it.', when: (c) => c.logs >= 3 },
  { key: 'swipe', text: 'tip: swipe left or right for people and reports.', when: (c) => c.logs >= 5 },
  { key: 'help', text: 'tip: tap ? at the top any time for the quick guide.', when: (c) => c.logs >= 8 },
];

// first unseen tip whose condition holds, else null. ctx: { logs }
export function nextTip(ctx, seen) {
  return TIPS.find((t) => !seen.has(t.key) && t.when(ctx)) || null;
}

const KEY = 'kharchly:tips';

export function seenTips() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(TIPS.map((t) => t.key)); }
}

export function markTipSeen(key) {
  try { localStorage.setItem(KEY, JSON.stringify([...seenTips(), key])); } catch { /* storage blocked — fine */ }
}
```

Note: when storage is unreadable, `seenTips` returns "all seen", so a tip can never get stuck on screen.

- [ ] **Step 4:** Run it. Expect PASS, 2 tests.

### Task 3: Picker UI and wiring

- [ ] **Step 1: Create `js/starter-view.js`.**

```js
// starter picker — first-open "what do you buy often?" modal, also reachable from settings and the empty grid.
import { el, openModal, toast } from './ui.js';
import { store, rerender } from './ctx.js';
import { formatINR } from './money.js';
import { amountField } from './fields.js';
import { STARTER_GROUPS, STARTER_ITEMS, planStarter, applyStarter } from './starter.js';

const FLAG = 'kharchly:starter-seen';
export function starterSeen() {
  try { return localStorage.getItem(FLAG) === '1'; } catch { return true; }
}
function markStarterSeen() {
  try { localStorage.setItem(FLAG, '1'); } catch { /* storage blocked — fine */ }
}

const exists = (name) => store.state.items.some((i) => i.name.toLowerCase() === name.toLowerCase());

export function openStarterPicker({ firstRun = false } = {}) {
  const picked = new Map(); // name -> pick (price editable)
  openModal(firstRun ? 'welcome to kharchly' : 'add common items', (body, close, onClose) => {
    if (firstRun) onClose(markStarterSeen);
    const list = el('div');
    const prices = el('div');
    const add = el('button', { class: 'btn-primary' }, 'add');

    const drawPrices = () => {
      prices.replaceChildren();
      if (!picked.size) return;
      prices.appendChild(el('div', { class: 'settings-section-title', style: { marginTop: '16px' } }, 'prices — edit if yours differ'));
      for (const p of picked.values()) {
        prices.appendChild(el('div', { class: 'starter-price-row' },
          amountField(p.price, (v) => { if (v != null && v > 0) p.price = v; }, p.name).node));
      }
    };
    const draw = () => {
      list.replaceChildren();
      for (const group of STARTER_GROUPS) {
        const items = STARTER_ITEMS.filter((i) => i.group === group && !exists(i.name));
        if (!items.length) continue;
        list.appendChild(el('div', { class: 'settings-section-title', style: { marginTop: '12px' } }, group));
        const row = el('div', { class: 'chips starter-chips' });
        for (const it of items) {
          const on = picked.has(it.name);
          row.appendChild(el('button', {
            class: 'chip' + (on ? ' active' : ''),
            onClick: () => { if (on) picked.delete(it.name); else picked.set(it.name, { ...it }); draw(); drawPrices(); },
          }, `${it.name} · ${formatINR(it.price)}`));
        }
        list.appendChild(row);
      }
      add.textContent = picked.size ? `add ${picked.size} item${picked.size > 1 ? 's' : ''}` : 'add';
    };

    add.addEventListener('click', async () => {
      if (!picked.size) return toast('pick at least one, or skip', 'error');
      try {
        const plan = planStarter([...picked.values()], store.state);
        await applyStarter(store, plan);
        close();
        rerender();
        toast(`${plan.items.length} items added — tap one to log it`, 'success');
      } catch (e) { toast(e.message, 'error'); }
    });

    body.append(
      el('div', { class: 'settings-info', style: { fontSize: '12px', marginTop: 0 } },
        'kharchly is built for everyday buys. pick what you buy often — one tap logs it later. you can add your own anytime with +.'),
      list,
      prices,
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', onClick: close }, firstRun ? 'skip' : 'cancel'),
        add,
      ),
    );
    draw();
  });
}
```

- [ ] **Step 2: `js/spend.js`.**
  - Add the imports: `import { openStarterPicker } from './starter-view.js';` and `import { nextTip, seenTips, markTipSeen } from './tips.js';`.
  - **(a) Tip banner.** In `renderSpend()`, replace the `pad.append(` call's first line `    renderTotals(),` with:
    ```js
    renderTotals(),
    ...renderTip(),
    ```
  - Add this below `renderSpend`:
    ```js
    // one-time tip, inline (a toast would clobber the undo toast). returns [] or [node] for spreading.
    function renderTip() {
      const tip = nextTip({ logs: store.loadedEntries().length }, seenTips());
      if (!tip) return [];
      return [el('div', { class: 'tip-banner' },
        el('span', {}, tip.text),
        el('button', { class: 'link-btn', onClick: () => { markTipSeen(tip.key); rerender(); } }, 'got it'),
      )];
    }
    ```
  - **(b) Empty grid.** In `fillGrid`, replace the `if (!items.length) { … return; }` block with:
    ```js
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
    ```
  - Check that `el` skips `null` children. If it doesn't, filter them out.

- [ ] **Step 3: `js/settings.js`.**
  - Add `import { openStarterPicker } from './starter-view.js';`.
  - In `itemsSection(closeSettings)`, just before its `return sec;`, add:
    ```js
    sec.appendChild(el('button', { class: 'link-btn', style: { marginTop: '8px' }, onClick: () => { closeSettings(); openStarterPicker(); } }, '+ add common items'));
    ```

- [ ] **Step 4: `js/app.js`.**
  - Add `import { openStarterPicker, starterSeen } from './starter-view.js';`.
  - In `start()`, after `initDrive(); …`, add:
    ```js
    // first open with nothing set up: offer the starter picker once
    if (!store.state.items.length && !starterSeen()) openStarterPicker({ firstRun: true });
    ```

- [ ] **Step 5: `style.css`**, next to the help styles:
```css
.starter-chips { flex-wrap: wrap; overflow: visible; }
.starter-price-row .field { margin-bottom: 8px; }
.tip-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg-raised);
  border: 1px solid var(--accent-dim);
  border-radius: 8px;
}
.tip-banner .link-btn { flex-shrink: 0; }
```

- [ ] **Step 6: `sw.js`.** Add `'./js/starter.js', './js/starter-view.js', './js/tips.js',` to `ASSETS` (after `./js/help.js`). Change `CACHE_NAME` to `'kharchly-v11'`.

- [ ] **Step 7: Checks.**
  - `node --check` passes on every changed or new js file.
  - Every `js/*.js` file is listed in `sw.js` ASSETS (28 files).
  - `node --test` passes everything: about 104 tests (99 + 3 + 2). Report the real number.

- [ ] **Step 8: Manual check** (the user, on a phone):
  1. In a fresh browser profile or incognito, the picker opens. Picking Five Star and chai and editing chai to ₹12 gives two tiles on the grid. Tapping chai logs ₹12.
  2. After that first log, the "hold an item" tip shows. "got it" hides it for good.
  3. Skipping the picker leaves an empty grid with "pick common items".
  4. Your own phone, which already has items, never sees the picker.
  5. Settings → "+ add common items" lists only items you don't have yet.
