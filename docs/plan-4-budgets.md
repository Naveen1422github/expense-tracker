# Kharchly — Plan 4: Budgets

> **For agentic workers:** Execute Tasks 1–3 in order, in one pass (no per-task reviewer). Use superpowers:executing-plans when running it inside Claude. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Budgets.
- A limit on **everything**, a **category**, or a single **item**, resetting every **day, week or month**.
- A strip on the Spend tab shows the 3 budgets closest to their limit, each with a pace status.
- Logging past 80% or 100% adds a note to the log toast, once per budget per period.
- Budgets are managed from Settings.

**Architecture:**
- A new pure module, `budgets.js`, holds the maths: period range, elapsed share, matching, evaluation, pace, warnings. It reuses `bucketKey` / `bucketRange` / `filterEntries` / `total` from `report-data.js`.
- `store.js` gains a `budgets` key plus the warning memory in `meta.budgetWarnings`.
- `budget-view.js` holds the UI: the strip, the list, the editor, and the toast note.
- Spend and Settings each get a few small edits.

**Tech Stack:** As before: vanilla ES modules, IndexedDB, `node --test`. Zero npm dependencies.

**Spec:** `expense-tracker/docs/spec.md` §5.4 (Budgets) and §8 (user contribution: pace thresholds). This builds on Plans 1–3, which are implemented, plus the uncommitted "kharchly" rename. Anchors below are from that state.

## Global Constraints

- **Budget record:** `{id, scope: 'all'|'category'|'item', refId: string|null, period: 'day'|'week'|'month', limit: paise > 0}`.
  - `refId` is `null` for `all`.
  - Only one budget per (scope, refId, period).
- **Spent** = the sum of entries in the **current** period that match the scope.
  - Category matching uses the entry's **snapshot** `categoryId`. Item matching uses `itemId`.
  - Ledger (lend/borrow) never counts.
- **Elapsed** includes today: day = by minutes; week = (days since Monday + 1) / 7; month = day-of-month / days-in-month.
- **Warnings** fire at 80% and 100%: once per budget, per level, per period. They are remembered in `meta.budgetWarnings` so they survive reloads. Editing or deleting a budget clears its warning.
- **Logging is never blocked.** A warning is a note appended to the existing log toast, so the Undo button stays.
- Money is paise, shown with `formatINR`. All date maths goes through `dates.js` / `report-data.js`. `store.js` is the only module touching `kv`.
- **No builds. No git write commands.** The user commits. Tests run from `expense-tracker/` with `node --test`. From the main Claude session, delegate test runs to a background subagent.

## Review Focus

1. **A week budget whose week started last month.** On Thu 1 Oct, the week is 28 Sep – 4 Oct, and spending on 28–30 Sep must count. Test: `budgets.test.js` "evaluate: a week budget sums across the month boundary". Boot already loads the previous months, so the strip can stay synchronous.
2. **The warning replacing the Undo toast.** Only one toast shows at a time. The note is appended to the log toast's text (`withNote`), so Undo remains. Covered in Task 3 (spend.js edits) and its manual check.
3. **Warnings repeating after a reload.** They are stored in `meta`, not in memory. Test: `store.test.js` "budget warnings persist across reloads".
4. **A budget on a deleted item.** It must not crash: it shows "(removed)" with ₹0 spent and can still be deleted. Covered in Task 3 (`budgetName` fallback) and its manual check.
5. **Raising a limit after a warning.** The new limit must be able to warn again. Test: `store.test.js` "editing a budget clears its warning".

---

## File map

| File | Change | Task |
|---|---|---|
| `js/budgets.js` | **create**: pure budget maths | 1 |
| `tests/budgets.test.js` | **create** (7 tests) | 1 |
| `js/store.js` | **modify**: `budgets` state/key, `saveBudget`, `deleteBudget`, `markBudgetWarned` | 2 |
| `tests/store.test.js` | **modify**: append 3 tests | 2 |
| `js/budget-view.js` | **create**: strip, list, editor, toast note | 3 |
| `js/spend.js` | **modify**: strip on the tab + notes on log toasts | 3 |
| `js/settings.js` | **modify**: "manage budgets" section | 3 |
| `sw.js` | **modify**: precache 2 modules, bump the cache name | 3 |
| `style.css` | **modify**: append budget styles | 3 |

---

### Task 1: budgets.js (pure)

**Files:**
- Create: `expense-tracker/js/budgets.js`
- Test: `expense-tracker/tests/budgets.test.js`

**Interfaces:**
- Consumes:
  - `bucketKey`, `bucketRange`, `filterEntries`, `total` (`report-data.js`)
  - `dayKey`, `timeOf`, `dayDiff`, `weekStart`, `dayOfMonth`, `daysInMonth`, `monthKey` (`dates.js`)
- Produces:
  - `SCOPES`, `PERIODS`, `WARN_LEVELS = [80, 100]`, `AHEAD_MARGIN`
  - `periodRange(period, day) → {from, to}`
  - `elapsedFraction(period, ts) → number in (0, 1]`
  - `matches(budget, entry) → boolean`
  - `paceStatus(spentFrac, elapsedFrac) → 'on track'|'ahead'|'over'`
  - `evaluate(budget, entries, ts) → Eval`, where `Eval = {budget, spent, spentFrac, elapsed, status, periodKey}`
  - `mostAtRisk(evals, n=3) → Eval[]`
  - `warningsToFire(evals, warned) → {budgetId, periodKey, level, eval}[]`

**User contribution point (spec §8).** Implement `paceStatus` exactly as shown so the tests pass. Then tell the user that this rule (and `AHEAD_MARGIN`) is theirs to retune. The tests only pin behaviour any sensible rule keeps: nothing spent → on track, overspent → over, far ahead of the clock → ahead.

- [ ] **Step 1: Write the failing test** at `tests/budgets.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, elapsedFraction, matches, evaluate, paceStatus, warningsToFire, mostAtRisk } from '../js/budgets.js';

process.env.TZ = 'Asia/Kolkata';

let n = 0;
const e = (ts, amount, extra = {}) => ({
  id: `e${++n}`, itemId: null, name: 'X', categoryId: 'food', tagIds: [], qty: 1, amount, ts, note: '', ...extra,
});
const budget = (over = {}) => ({ id: 'b1', scope: 'all', refId: null, period: 'month', limit: 10000, ...over });

test('periodRange: day, week (Mon–Sun, may start last month), month', () => {
  assert.deepEqual(periodRange('day', '2026-10-01'), { from: '2026-10-01', to: '2026-10-01' });
  assert.deepEqual(periodRange('week', '2026-10-01'), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(periodRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
});

test('elapsedFraction counts today as in progress', () => {
  assert.equal(elapsedFraction('month', '2026-10-04T10:00'), 4 / 31);
  assert.equal(elapsedFraction('week', '2026-10-05T10:00'), 1 / 7); // Monday
  assert.equal(elapsedFraction('week', '2026-10-04T10:00'), 1);     // Sunday
  assert.ok(Math.abs(elapsedFraction('day', '2026-10-04T12:00') - 0.5) < 0.01);
});

test('matches uses the entry snapshot category and the item id', () => {
  const entry = e('2026-10-04T10:00', 100, { itemId: 'milk', categoryId: 'groc' });
  assert.equal(matches(budget(), entry), true);
  assert.equal(matches(budget({ scope: 'category', refId: 'groc' }), entry), true);
  assert.equal(matches(budget({ scope: 'category', refId: 'food' }), entry), false);
  assert.equal(matches(budget({ scope: 'item', refId: 'milk' }), entry), true);
  assert.equal(matches(budget({ scope: 'item', refId: 'sting' }), entry), false);
});

test('evaluate: a week budget sums across the month boundary and ignores other weeks and categories', () => {
  const b = budget({ scope: 'category', refId: 'food', period: 'week', limit: 1000 });
  const es = [
    e('2026-09-28T09:00', 300),                         // Monday of this week, last month
    e('2026-10-01T09:00', 200),
    e('2026-09-27T23:59', 999),                         // previous week
    e('2026-10-01T10:00', 500, { categoryId: 'bills' }), // other category
  ];
  const ev = evaluate(b, es, '2026-10-01T12:00');
  assert.equal(ev.spent, 500);
  assert.equal(ev.spentFrac, 0.5);
  assert.equal(ev.periodKey, '2026-09-28');
  assert.equal(ev.elapsed, 4 / 7);
  assert.equal(ev.status, 'on track');
});

test('paceStatus: nothing spent is on track, overspent is over, far ahead of the clock is ahead', () => {
  assert.equal(paceStatus(0, 0.5), 'on track');
  assert.equal(paceStatus(0.5, 0.5), 'on track');
  assert.equal(paceStatus(0.9, 0.1), 'ahead');
  assert.equal(paceStatus(1.2, 0.5), 'over');
});

test('warningsToFire: once per level per period; a new period resets; a big jump fires only 100', () => {
  const ev = (frac, periodKey = '2026-10') => ({ budget: budget(), spentFrac: frac, periodKey });
  assert.deepEqual(warningsToFire([ev(0.5)], {}), []);
  assert.deepEqual(warningsToFire([ev(0.85)], {}).map((w) => w.level), [80]);
  assert.deepEqual(warningsToFire([ev(0.85)], { b1: { periodKey: '2026-10', level: 80 } }), []);
  assert.deepEqual(warningsToFire([ev(1.05)], { b1: { periodKey: '2026-10', level: 80 } }).map((w) => w.level), [100]);
  assert.deepEqual(warningsToFire([ev(0.85, '2026-11')], { b1: { periodKey: '2026-10', level: 100 } }).map((w) => w.level), [80]);
  assert.deepEqual(warningsToFire([ev(1.2)], {}).map((w) => w.level), [100]);
});

test('mostAtRisk returns the highest spent share first', () => {
  const evs = [0.2, 0.9, 1.3, 0.5].map((f, i) => ({ budget: { id: `b${i}` }, spentFrac: f }));
  assert.deepEqual(mostAtRisk(evs, 3).map((x) => x.spentFrac), [1.3, 0.9, 0.5]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/budgets.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Create `js/budgets.js`**

```js
// budgets — pure maths: which entries a budget covers, how much of the period has passed,
// pace status, and which 80% / 100% warnings are due. no DOM, no storage.
// matching reads the entry SNAPSHOT categoryId (and itemId), never the live item.
import { bucketKey, bucketRange, filterEntries, total } from './report-data.js';
import { dayKey, timeOf, dayDiff, weekStart, dayOfMonth, daysInMonth, monthKey } from './dates.js';

export const SCOPES = ['all', 'category', 'item'];
export const PERIODS = ['day', 'week', 'month'];
export const WARN_LEVELS = [80, 100];
const EVERYTHING = { from: '0000-01-01', to: '9999-12-31' };

// the current day / week (Mon–Sun) / month containing `day`
export function periodRange(period, day) {
  return bucketRange(bucketKey(day, period), period, EVERYTHING);
}

// share of the period that has passed, counting today (or this minute) as in progress
export function elapsedFraction(period, ts) {
  const day = dayKey(ts);
  if (period === 'day') {
    const [h, m] = timeOf(ts).split(':').map(Number);
    return (h * 60 + m + 1) / 1440;
  }
  if (period === 'week') return (dayDiff(weekStart(day), day) + 1) / 7;
  return dayOfMonth(day) / daysInMonth(monthKey(day));
}

export function matches(budget, entry) {
  if (budget.scope === 'all') return true;
  if (budget.scope === 'category') return entry.categoryId === budget.refId;
  return entry.itemId === budget.refId;
}

// USER CONTRIBUTION POINT (spec §8): when does a budget count as "ahead of pace"?
// default: spent share is more than AHEAD_MARGIN above the share of the period gone.
export const AHEAD_MARGIN = 0.10;
export function paceStatus(spentFrac, elapsedFrac) {
  if (spentFrac > 1) return 'over';
  if (spentFrac > elapsedFrac + AHEAD_MARGIN) return 'ahead';
  return 'on track';
}

export function evaluate(budget, entries, ts) {
  const today = dayKey(ts);
  const spent = total(filterEntries(entries, periodRange(budget.period, today)).filter((e) => matches(budget, e)));
  const spentFrac = spent / budget.limit;
  const elapsed = elapsedFraction(budget.period, ts);
  return { budget, spent, spentFrac, elapsed, status: paceStatus(spentFrac, elapsed), periodKey: bucketKey(today, budget.period) };
}

export function mostAtRisk(evals, n = 3) {
  return [...evals].sort((a, b) => b.spentFrac - a.spentFrac).slice(0, n);
}

// levels crossed this period that haven't been shown yet.
// warned = meta.budgetWarnings = { [budgetId]: { periodKey, level } }
export function warningsToFire(evals, warned) {
  const out = [];
  for (const ev of evals) {
    const pct = ev.spentFrac * 100;
    const level = [...WARN_LEVELS].reverse().find((l) => pct >= l);
    if (!level) continue;
    const prev = warned[ev.budget.id];
    const shown = prev && prev.periodKey === ev.periodKey ? prev.level : 0;
    if (level > shown) out.push({ budgetId: ev.budget.id, periodKey: ev.periodKey, level, eval: ev });
  }
  return out;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/budgets.test.js`. Expected: PASS, 7 tests.

- [ ] **Step 5: Checkpoint.** Remind the user that `paceStatus` / `AHEAD_MARGIN` are theirs to tune.

---

### Task 2: store.js — budgets

**Files:**
- Modify: `expense-tracker/js/store.js`, `expense-tracker/tests/store.test.js`

**Interfaces:**
- Consumes: `SCOPES`, `PERIODS` from `budgets.js`.
- Produces (serialized mutators):
  - `state.budgets: Budget[]`
  - `saveBudget({id?, scope, refId?, period, limit}) → Budget` (clears that budget's warning when editing)
  - `deleteBudget(id)` (also clears its warning)
  - `markBudgetWarned(budgetId, periodKey, level)`

- [ ] **Step 1: Append the failing tests** to the end of `tests/store.test.js`

```js
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
```

- [ ] **Step 2: Run it and confirm the new tests fail**

Run: `node --test tests/store.test.js`. Expected: 23 pass and 3 fail (`saveBudget is not a function`).

- [ ] **Step 3: Modify `js/store.js`.** Make five edits.

**3a.** Replace:
```js
import { KINDS } from './ledger.js';
```
with:
```js
import { KINDS } from './ledger.js';
import { SCOPES, PERIODS } from './budgets.js';
```

**3b.** Replace:
```js
  people: 'people', ledger: 'ledger',
```
with:
```js
  people: 'people', ledger: 'ledger', budgets: 'budgets',
```

**3c.** Replace:
```js
  const state = { categories: [], tags: [], items: [], people: [], ledger: [], meta: defaultMeta(), months: new Map() };
```
with:
```js
  const state = { categories: [], tags: [], items: [], people: [], ledger: [], budgets: [], meta: defaultMeta(), months: new Map() };
```
Then replace:
```js
    state.ledger = (await kv.get(K.ledger)) || [];
```
with:
```js
    state.ledger = (await kv.get(K.ledger)) || [];
    state.budgets = (await kv.get(K.budgets)) || [];
```

**3d.** Insert immediately **before** the line `  // ---------- people + ledger ----------`:
```js
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

```

**3e.** In the returned object, replace:
```js
    restoreLedger: serial(restoreLedger),
```
with:
```js
    restoreLedger: serial(restoreLedger),
    saveBudget: serial(saveBudget),
    deleteBudget: serial(deleteBudget),
    markBudgetWarned: serial(markBudgetWarned),
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/store.test.js`. Expected: PASS, 26 tests.
Run: `node --test`. Expected: PASS, 76 tests (money 6, dates 8, frecency 7, store 26, ledger 9, report-data 13, budgets 7).

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 3: Budget UI

**Files:**
- Create: `js/budget-view.js`
- Modify: `js/spend.js`, `js/settings.js`, `sw.js`, `style.css`

**Interfaces:**
- Consumes:
  - Task 1–2 exports
  - `el`, `openModal`, `toast` (`ui.js`); `store`, `rerender` (`ctx.js`)
  - `formatINR`; `nowTs`; `amountField` (`fields.js`)
- Produces (`budget-view.js`):
  - `budgetName(budget) → string`
  - `renderBudgetStrip() → HTMLElement` (hidden when there are no budgets)
  - `openBudgetsModal()`
  - `takeBudgetNote() → Promise<string|null>`
  - `withNote(msg, note) → string`

- [ ] **Step 1: Create `js/budget-view.js`**

```js
// budget-view — the strip on the Spend tab, the budgets list + editor, and the warning note
// that rides on the log toast (one toast at a time: a separate warning toast would hide Undo).
import { el, openModal, toast } from './ui.js';
import { store, rerender } from './ctx.js';
import { formatINR } from './money.js';
import { nowTs } from './dates.js';
import { SCOPES, PERIODS, evaluate, mostAtRisk, warningsToFire } from './budgets.js';
import { amountField } from './fields.js';

export function budgetName(budget) {
  if (budget.scope === 'all') return 'all spending';
  const list = budget.scope === 'category' ? store.state.categories : store.state.items;
  return list.find((r) => r.id === budget.refId)?.name || '(removed)';
}

// boot loads this month + the previous 3, so the current day / week (which may start
// last month) / month is always inside loadedEntries() — no async load needed here.
const evaluateAll = () => store.state.budgets.map((b) => evaluate(b, store.loadedEntries(), nowTs()));

const STATUS_TEXT = { 'on track': 'on track', ahead: 'ahead of pace', over: 'over' };

function budgetRow(ev) {
  const pct = Math.round(ev.spentFrac * 100);
  return el('div', { class: 'budget-row' },
    el('div', { class: 'budget-top' },
      el('span', {}, `${budgetName(ev.budget)} · ${ev.budget.period}`),
      el('span', { class: 'budget-nums' }, `${formatINR(ev.spent)} / ${formatINR(ev.budget.limit)}`),
    ),
    el('div', { class: 'bar' },
      el('div', { class: 'bar-fill' + (ev.status === 'over' ? ' over' : ''), style: { width: `${Math.min(100, pct)}%` } })),
    el('div', { class: `budget-status ${ev.status.replace(' ', '-')}` }, `${pct}% · ${STATUS_TEXT[ev.status]}`),
  );
}

export function renderBudgetStrip() {
  const evals = evaluateAll();
  if (!evals.length) return el('div', { hidden: true });
  return el('button', { class: 'budget-strip', onClick: openBudgetsModal }, ...mostAtRisk(evals, 3).map(budgetRow));
}

// call right after a successful log/edit. returns e.g. "Food 80% month budget", or null.
// marks each warning shown so it fires once per budget per level per period.
export async function takeBudgetNote() {
  try {
    const due = warningsToFire(evaluateAll(), store.state.meta.budgetWarnings || {});
    for (const w of due) await store.markBudgetWarned(w.budgetId, w.periodKey, w.level);
    if (!due.length) return null;
    return due
      .map((w) => `${budgetName(w.eval.budget)} ${w.level >= 100 ? 'over' : '80%'} ${w.eval.budget.period} budget`)
      .join(', ');
  } catch {
    return null; // a warning must never break logging
  }
}

export const withNote = (msg, note) => (note ? `${msg} — ${note}` : msg);

// ============================================================
//  list + editor
// ============================================================
export function openBudgetsModal() {
  openModal('budgets', (body, close) => {
    const evals = evaluateAll().sort((a, b) => b.spentFrac - a.spentFrac);
    if (!evals.length) {
      body.append(el('div', { class: 'settings-info' },
        'no budgets yet. a budget is a limit on everything, a category or an item, per day, week or month.'));
    }
    for (const ev of evals) {
      body.append(el('button', { class: 'budget-list-item', onClick: () => { close(); openBudgetEditor(ev.budget); } }, budgetRow(ev)));
    }
    body.append(el('div', { class: 'modal-actions' },
      el('button', { class: 'btn-primary', onClick: () => { close(); openBudgetEditor(null); } }, '+ add budget')));
  });
}

function chipField(label, options, value, onChange) {
  const row = el('div', { class: 'chips' });
  const draw = () => row.replaceChildren(...options.map((o) => el('button', {
    type: 'button',
    class: 'chip' + (o === value ? ' active' : ''),
    onClick: () => { value = o; onChange(o); draw(); },
  }, o)));
  draw();
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, label), row);
}

function openBudgetEditor(budget) {
  openModal(budget ? 'edit budget' : 'new budget', (body, close) => {
    const f = {
      scope: budget?.scope ?? 'category',
      refId: budget?.refId ?? '',
      period: budget?.period ?? 'month',
      limit: budget?.limit ?? null,
    };
    const target = el('div');
    const drawTarget = () => {
      target.replaceChildren();
      if (f.scope === 'all') return;
      const list = (f.scope === 'category' ? store.state.categories : store.state.items)
        .filter((r) => !r.archived || r.id === f.refId)
        .sort((a, b) => a.name.localeCompare(b.name));
      const select = el('select', { class: 'input', onChange: (e) => { f.refId = e.target.value; } },
        el('option', { value: '' }, 'pick one…'),
        ...list.map((r) => el('option', { value: r.id }, r.name)));
      select.value = list.some((r) => r.id === f.refId) ? f.refId : '';
      f.refId = select.value;
      target.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, f.scope), select));
    };

    body.append(
      chipField('applies to', SCOPES, f.scope, (v) => { f.scope = v; f.refId = ''; drawTarget(); }),
      target,
      chipField('resets every', PERIODS, f.period, (v) => { f.period = v; }),
      amountField(f.limit, (v) => { f.limit = v; }, 'limit (₹)').node,
    );
    drawTarget();

    const reopenList = () => { close(); rerender(); openBudgetsModal(); };
    const actions = el('div', { class: 'modal-actions' });
    if (budget) {
      actions.append(el('button', {
        class: 'btn-danger-ghost',
        onClick: async () => {
          try { await store.deleteBudget(budget.id); reopenList(); } catch (e) { toast(e.message, 'error'); }
        },
      }, 'delete'));
    }
    actions.append(el('button', {
      class: 'btn-primary',
      onClick: async () => {
        if (!f.limit) return toast('enter a limit', 'error');
        try {
          await store.saveBudget({ id: budget?.id, scope: f.scope, refId: f.scope === 'all' ? null : f.refId, period: f.period, limit: f.limit });
          reopenList();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'save'));
    body.append(actions);
  });
}
```

- [ ] **Step 2: `js/spend.js`.** Make six edits.

**2a.** Add under the existing `import { textField, … } from './fields.js';` line:
```js
import { renderBudgetStrip, takeBudgetNote, withNote } from './budget-view.js';
```

**2b.** In `renderSpend`, replace:
```js
    renderTotals(),
```
with:
```js
    renderTotals(),
    renderBudgetStrip(),
```

**2c.** In `quickLog`, replace:
```js
    undoToast(`${item.name} ${formatINR(entry.amount)}${where}`, () => store.deleteSpend(entry));
```
with:
```js
    const note = await takeBudgetNote();
    undoToast(withNote(`${item.name} ${formatINR(entry.amount)}${where}`, note), () => store.deleteSpend(entry));
```

**2d.** In `openLogModal`, replace:
```js
              undoToast(`${item.name} ${formatINR(entry.amount)}`, () => store.deleteSpend(entry));
```
with:
```js
              undoToast(withNote(`${item.name} ${formatINR(entry.amount)}`, await takeBudgetNote()), () => store.deleteSpend(entry));
```

**2e.** In `openOneOffModal`, replace:
```js
              undoToast(`${entry.name} ${formatINR(entry.amount)}`, () => store.deleteSpend(entry));
```
with:
```js
              undoToast(withNote(`${entry.name} ${formatINR(entry.amount)}`, await takeBudgetNote()), () => store.deleteSpend(entry));
```

**2f.** In `openEntryModal`, replace:
```js
              toast('saved', 'success');
```
with:
```js
              toast(withNote('saved', await takeBudgetNote()), 'success');
```
This exact line only occurs once in `spend.js`. Check with grep first. If it occurs more than once, edit only the one inside `openEntryModal` (directly after `await jumpTo(updated.ts);`).

- [ ] **Step 3: `js/settings.js`.** Add under `import { openItemModal } from './spend.js';`:
```js
import { openBudgetsModal } from './budget-view.js';
```
Replace:
```js
      itemsSection(close),
```
with:
```js
      itemsSection(close),
      budgetsSection(close),
```
Then insert this function immediately **before** `function backupSection() {`:
```js
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

```

- [ ] **Step 4: `sw.js`.** Replace `const CACHE_NAME = 'kharchly-v5';` with `const CACHE_NAME = 'kharchly-v6';`. In `ASSETS`, after `  './js/reports.js',` add:
```js
  './js/budgets.js',
  './js/budget-view.js',
```

- [ ] **Step 5: Append budget styles** to the end of `style.css`, using the Edit tool:

```css

/* ========== kharchly: budgets ========== */
.budget-strip {
  display: flex; flex-direction: column; gap: 10px; width: 100%; margin: 12px 0;
  padding: 12px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 8px; text-align: left;
}
.budget-row { width: 100%; }
.budget-top { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-size: 12px; }
.budget-nums { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); white-space: nowrap; }
.budget-status { margin-top: 3px; font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
.budget-status.ahead { color: var(--warn); }
.budget-status.over { color: var(--danger); }
.budget-list-item { display: block; width: 100%; padding: 10px 0; border-bottom: 1px solid var(--border); text-align: left; }
```

- [ ] **Step 6: Syntax check and suite**

Run: `node --check js/budget-view.js && node --check js/spend.js && node --check js/settings.js && node --check sw.js`. Expected: no output.
Check that every `js/*.js` file appears in `sw.js` ASSETS (18 files).
Run: `node --test`. Expected: PASS, 76 tests.

- [ ] **Step 7: Manual check (the user, on kharchly.netlify.app after deploy, or locally)**
  1. **No budgets:** the Spend tab looks exactly as before. There's no strip and no stray "null" text.
  2. **Settings → manage budgets (0) → + add budget:** category · Food · month · 500 → save. Expected: the list shows "Food · month ₹0 / ₹500, 0% · on track", and the strip appears on Spend.
  3. **Log Food items up to ~₹420.** Expected: the toast reads e.g. "Chai ₹20 — Food 80% month budget" **and still has undo** (Review Focus 2). Log again: no repeat note.
  4. **Reload, then log another Food item.** Expected: still no 80% note (Review Focus 3). Push past ₹500: "— Food over month budget", the bar shows the over colour, and the status shows "over".
  5. **Edit the budget limit to 1000.** Expected: the status goes back to normal. Pushing past 80% warns again (Review Focus 5).
  6. **Week budget:** all · week · 300. Expected: the week includes Monday–today, even across a month boundary (Review Focus 1).
  7. **Item budget:** item · (an item) · day · 50. Tap the item until it's over. Expected: "over day budget".
  8. **Duplicate:** adding a second Food · month budget is rejected with "already".
  9. **Removed target:** add an item budget on a never-used item, then delete that item (Settings → items → remove). Expected: the budget shows "(removed)" with ₹0, and it can still be deleted (Review Focus 4).
  10. **Lend/borrow** entries never move any budget.

- [ ] **Step 8: Checkpoint** for the user to commit. Pushing to GitHub deploys to kharchly.netlify.app.
