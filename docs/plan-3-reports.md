# Expense Tracker — Plan 3: Reports

> **For agentic workers:** Execute Tasks 1–3 in order, in one pass (no per-task reviewer). Use superpowers:executing-plans when running it inside Claude. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Reports tab. A Spend segment shows range × group controls, a total with "vs previous period", a trend bar chart you can drill into, a by-category breakdown, top items, and a tag filter. A People segment shows the balances list.

**Architecture:**
- All report maths lives in a new pure module, `report-data.js`: ranges, buckets, comparisons and breakdowns. It's unit-tested.
- `dates.js` gains three small helpers.
- `store.js` gains `loadRange(from, to)`, which loads any month keys a range touches.
- `charts.js` draws the hand-made SVG trend chart and the HTML horizontal bars.
- `reports.js` is the tab UI. It reads **only entry snapshot fields**.

**Tech Stack:** As Plans 1–2: vanilla ES modules, IndexedDB, `node --test`. Zero npm dependencies. No chart library.

**Spec:** `expense-tracker/docs/spec.md` §5.3 (Reports) and §4.4 (reads spanning months). This builds on Plans 1 and 2, which are already implemented. This plan's "replace X" anchors are from the code **after Plan 2**.

## Global Constraints

- Ranges are **calendar-aligned and end today**:
  - 1M = this month so far
  - 3M = this month + the previous 2
  - 6M = +5, 1Y = +11
  - Custom = any two dates (swapped if reversed)
- Group limits: **Day ≤ 93 days**, **Week ≤ 371 days**, **Month always**.
- Default group: ≤ 31 days → Day, ≤ 93 → Week, else Month. That gives 1M→Day, 3M→Week, 6M/1Y→Month.
- Weeks run **Monday–Sunday**, keyed by their Monday, and are never cut at month boundaries.
- Comparison is with the **previous period of the same length**. Month-aligned presets cut at the same day-of-month, clamped to the shorter month: Oct 1–31 vs Sep 1–30. Custom ranges use the same number of days immediately before.
- Reports, the tag filter and breakdowns read entry snapshot `name` / `categoryId` / `tagIds`, never the live item. Ledger entries never appear in spend reports.
- Money is integer paise, shown with `formatINR`. Dates are local `YYYY-MM-DD` strings, and all date maths goes through `dates.js`.
- **No builds. No git write commands.** The user commits. Tests run from `expense-tracker/`: `node --test`. From the main Claude session, delegate test runs to a background subagent.

## Review Focus

1. **Comparing on the 31st against a 30-day month.** Oct 1–31 must compare with Sep 1–30. It must not spill into Oct 1, and must not crash on Sep 31. Test: `report-data.test.js` "previousRange: month-aligned …" (31st, March→Feb, and the leap year).
2. **Ranges with zero spend.** No divide-by-zero in the percentages, and a hint instead of an empty chart. Tests: `compare(5000, 0)` gives `pct: null`, and `byCategory([])` gives `[]`. In Task 3, `fillSpendReport` shows "nothing spent in this range".
3. **A huge custom range** (years). Day and Week must be unavailable, so the chart never draws 2,000 bars. Test: `allowedGroups(customRange('2020-01-01', …))` returns `['month']`.
4. **A stale drill-down after changing range, group or tag.** The selected bar may no longer exist. Every control change resets the drill (`resetDrill`), and `fillSpendReport` ignores a drill key that isn't among the current bars. Covered in Task 3 code and its manual check.
5. **CSS clash with macro's `.bar`.** Macro styles `.bar { height: 3px }`, and a CSS `height` applied to an SVG `<rect>` overrides its height attribute. Trend rects use the class `tbar`, never `bar`. Covered in Task 3 (`charts.js` and the CSS) and its manual check: bars must be visibly tall.

---

## File map

| File | Change | Task |
|---|---|---|
| `js/dates.js` | **modify**: `daysInMonth`, `dayOfMonth`, `dayDiff` | 1 |
| `tests/dates.test.js` | **modify**: append 1 test | 1 |
| `js/report-data.js` | **create**: ranges, groups, buckets, trend, breakdowns, comparison | 1 |
| `tests/report-data.test.js` | **create** (13 tests) | 1 |
| `js/store.js` | **modify**: `loadRange` | 2 |
| `tests/store.test.js` | **modify**: append 1 test | 2 |
| `js/charts.js` | **create**: `barChart`, `hBars` | 3 |
| `js/reports.js` | **create**: Reports tab | 3 |
| `js/ctx.js` | **modify**: `view.report` | 3 |
| `js/app.js` | **modify**: render the Reports tab | 3 |
| `sw.js` | **modify**: precache 3 modules, bump the cache name | 3 |
| `style.css` | **modify**: append report styles | 3 |

---

### Task 1: dates helpers + report-data.js (pure)

**Files:**
- Modify: `expense-tracker/js/dates.js`, `expense-tracker/tests/dates.test.js`
- Create: `expense-tracker/js/report-data.js`, `expense-tracker/tests/report-data.test.js`

**Interfaces:**
- Produces (`dates.js`):
  - `daysInMonth(month): number`
  - `dayOfMonth(day): number`
  - `dayDiff(a, b): number` (whole days, b − a)
- Produces (`report-data.js`):
  - `RANGE_PRESETS: {'1M':1,'3M':3,'6M':6,'1Y':12}`
  - `GROUPS: ['day','week','month']`
  - `Range = {from, to, monthAligned}`
  - `rangeFor(preset, today) → Range`
  - `customRange(from, to) → Range`
  - `rangeDays(range) → number` (inclusive)
  - `allowedGroups(range) → string[]`
  - `defaultGroup(range) → string`
  - `bucketKey(day, group) → string`
  - `bucketsInRange(range, group) → string[]`
  - `bucketRange(key, group, range) → {from, to}`
  - `bucketLabel(key, group) → string`
  - `filterEntries(entries, {from, to}, tagId?) → Entry[]`
  - `total(entries) → number`
  - `trend(entries, range, group) → {key, label, value}[]`
  - `byCategory(entries) → {categoryId, value, pct}[]`
  - `topItems(entries, limit=10) → {name, value, count}[]`
  - `previousRange(range) → Range`
  - `compare(cur, prev) → {delta, pct|null}`

- [ ] **Step 1: Append the failing dates test** to the end of `tests/dates.test.js`. First extend its import: replace
```js
  weekStart, monthsBetween, formatDayLabel, formatMonthLabel,
} from '../js/dates.js';
```
with
```js
  weekStart, monthsBetween, formatDayLabel, formatMonthLabel,
  daysInMonth, dayOfMonth, dayDiff,
} from '../js/dates.js';
```
Then append:
```js
test('daysInMonth, dayOfMonth, dayDiff', () => {
  assert.equal(daysInMonth('2026-09'), 30);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-12'), 31);
  assert.equal(dayOfMonth('2026-10-04'), 4);
  assert.equal(dayDiff('2026-10-01', '2026-10-04'), 3);
  assert.equal(dayDiff('2026-10-04', '2026-10-01'), -3);
  assert.equal(dayDiff('2025-12-31', '2026-01-01'), 1);
  assert.equal(dayDiff('2028-02-28', '2028-03-01'), 2);
});
```

- [ ] **Step 2: Write the failing report-data test** at `tests/report-data.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeFor, customRange, rangeDays, allowedGroups, defaultGroup, bucketsInRange, bucketRange, bucketLabel,
  filterEntries, total, trend, byCategory, topItems, previousRange, compare,
} from '../js/report-data.js';

process.env.TZ = 'Asia/Kolkata';

let n = 0;
const e = (ts, amount, extra = {}) => ({
  id: `e${++n}`, itemId: null, name: 'X', categoryId: 'food', tagIds: [], qty: 1, amount, ts, note: '', ...extra,
});

test('presets are calendar-aligned and end today', () => {
  assert.deepEqual(rangeFor('1M', '2026-10-04'), { from: '2026-10-01', to: '2026-10-04', monthAligned: true });
  assert.equal(rangeFor('3M', '2026-10-04').from, '2026-08-01');
  assert.equal(rangeFor('6M', '2026-10-04').from, '2026-05-01');
  assert.equal(rangeFor('1Y', '2026-10-04').from, '2025-11-01');
  assert.throws(() => rangeFor('2W', '2026-10-04'), /Unknown range/);
});

test('customRange swaps reversed dates; rangeDays is inclusive', () => {
  assert.deepEqual(customRange('2026-10-10', '2026-10-01'), { from: '2026-10-01', to: '2026-10-10', monthAligned: false });
  assert.equal(rangeDays({ from: '2026-10-01', to: '2026-10-10' }), 10);
  assert.equal(rangeDays({ from: '2026-10-04', to: '2026-10-04' }), 1);
});

test('allowed and default groups follow range length', () => {
  const m1 = rangeFor('1M', '2026-10-31');
  const m3 = rangeFor('3M', '2026-10-31'); // 92 days
  const m6 = rangeFor('6M', '2026-10-31');
  const y1 = rangeFor('1Y', '2026-10-31'); // 365 days
  assert.deepEqual(allowedGroups(m1), ['day', 'week', 'month']);
  assert.equal(defaultGroup(m1), 'day');
  assert.deepEqual(allowedGroups(m3), ['day', 'week', 'month']);
  assert.equal(defaultGroup(m3), 'week');
  assert.deepEqual(allowedGroups(m6), ['week', 'month']);
  assert.equal(defaultGroup(m6), 'month');
  assert.deepEqual(allowedGroups(y1), ['week', 'month']);
  assert.equal(defaultGroup(y1), 'month');
  assert.deepEqual(allowedGroups(customRange('2020-01-01', '2026-10-04')), ['month']);
});

test('week buckets run Monday–Sunday across a year boundary', () => {
  assert.deepEqual(bucketsInRange({ from: '2025-12-25', to: '2026-01-06' }, 'week'), ['2025-12-22', '2025-12-29', '2026-01-05']);
  assert.deepEqual(bucketsInRange({ from: '2026-09-30', to: '2026-10-02' }, 'day'), ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(bucketsInRange(rangeFor('3M', '2026-10-04'), 'month'), ['2026-08', '2026-09', '2026-10']);
});

test('bucketRange is clipped to the range', () => {
  const range = { from: '2026-10-01', to: '2026-10-04' };
  assert.deepEqual(bucketRange('2026-09-28', 'week', range), { from: '2026-10-01', to: '2026-10-04' });
  assert.deepEqual(bucketRange('2026-02', 'month', { from: '2026-01-01', to: '2026-12-31' }), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(bucketRange('2026-10-02', 'day', range), { from: '2026-10-02', to: '2026-10-02' });
});

test('bucketLabel', () => {
  assert.equal(bucketLabel('2026-10-04', 'day'), '4');
  assert.match(bucketLabel('2026-09-28', 'week'), /28/);
  assert.match(bucketLabel('2026-10', 'month'), /Oct/);
});

test('trend zero-fills empty buckets and sums by bucket; entries outside the range are ignored', () => {
  const range = { from: '2026-10-01', to: '2026-10-03' };
  const es = [e('2026-10-01T09:00', 100), e('2026-10-01T22:00', 50), e('2026-10-03T08:00', 25), e('2026-09-30T23:59', 999)];
  assert.deepEqual(trend(es, range, 'day').map((b) => [b.key, b.value]), [['2026-10-01', 150], ['2026-10-02', 0], ['2026-10-03', 25]]);
});

test('filterEntries by range and by snapshot tag', () => {
  const es = [e('2026-10-01T09:00', 100, { tagIds: ['unh'] }), e('2026-10-02T09:00', 50), e('2026-11-01T00:30', 7, { tagIds: ['unh'] })];
  const range = { from: '2026-10-01', to: '2026-10-31' };
  assert.equal(total(filterEntries(es, range)), 150);
  assert.equal(total(filterEntries(es, range, 'unh')), 100);
});

test('byCategory sorts by amount with percentages', () => {
  const cats = byCategory([
    e('2026-10-01T09:00', 300, { categoryId: 'food' }),
    e('2026-10-01T09:00', 100, { categoryId: 'bills' }),
    e('2026-10-02T09:00', 100, { categoryId: 'food' }),
  ]);
  assert.deepEqual(cats.map((c) => [c.categoryId, c.value, c.pct]), [['food', 400, 80], ['bills', 100, 20]]);
  assert.deepEqual(byCategory([]), []);
});

test('topItems groups by snapshot name (case-insensitive), counts qty, ranks by amount', () => {
  const top = topItems([
    e('2026-10-01T09:00', 6000, { name: 'Milk', qty: 2 }),
    e('2026-10-02T09:00', 3000, { name: 'milk' }),
    e('2026-10-02T09:00', 34000, { name: 'Hardware' }),
  ]);
  assert.deepEqual(top.map((t) => [t.name, t.value, t.count]), [['Hardware', 34000, 1], ['Milk', 9000, 3]]);
  assert.equal(topItems([e('2026-10-01T09:00', 1, { name: 'a' }), e('2026-10-01T09:00', 2, { name: 'b' })], 1).length, 1);
});

test('previousRange: month-aligned compares the same point of the previous period', () => {
  assert.deepEqual(previousRange(rangeFor('1M', '2026-10-04')), { from: '2026-09-01', to: '2026-09-04', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('1M', '2026-10-31')), { from: '2026-09-01', to: '2026-09-30', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('1M', '2026-03-31')), { from: '2026-02-01', to: '2026-02-28', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('1M', '2028-03-31')), { from: '2028-02-01', to: '2028-02-29', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('3M', '2026-10-04')), { from: '2026-05-01', to: '2026-07-04', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('1Y', '2026-10-04')), { from: '2024-11-01', to: '2025-10-04', monthAligned: true });
});

test('previousRange: custom ranges use the same number of days just before', () => {
  assert.deepEqual(previousRange(customRange('2026-10-05', '2026-10-11')), { from: '2026-09-28', to: '2026-10-04', monthAligned: false });
});

test('compare gives a rounded percentage, or null when there is nothing to compare with', () => {
  assert.deepEqual(compare(11200, 10000), { delta: 1200, pct: 12 });
  assert.deepEqual(compare(5000, 10000), { delta: -5000, pct: -50 });
  assert.deepEqual(compare(5000, 0), { delta: 5000, pct: null });
});
```

- [ ] **Step 3: Run both and confirm they fail**

Run: `node --test tests/dates.test.js`. Expected: FAIL, `daysInMonth` is not exported.
Run: `node --test tests/report-data.test.js`. Expected: FAIL, module not found.

- [ ] **Step 4: Add the dates helpers.** Append to the end of `js/dates.js`:

```js

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
}

export const dayOfMonth = (day) => Number(day.slice(8, 10));

// whole days from a to b (b - a). pure calendar maths via UTC, so no timezone can shift it.
export function dayDiff(a, b) {
  const utc = (d) => {
    const [y, m, dd] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((utc(b) - utc(a)) / 86400000);
}
```

- [ ] **Step 5: Create `js/report-data.js`**

```js
// report-data — pure maths for the Reports tab: ranges, buckets, comparisons, breakdowns.
// reads ONLY entry snapshot fields (name, categoryId, tagIds), never the live item.
import { dayKey, monthKey, addDays, addMonths, weekStart, dayDiff, daysInMonth, dayOfMonth, parseDay } from './dates.js';

export const RANGE_PRESETS = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
export const GROUPS = ['day', 'week', 'month'];
const MAX_DAY_DAYS = 93;   // day bars only up to ~3 months
const MAX_WEEK_DAYS = 371; // week bars only up to ~1 year (53 weeks)

// calendar-aligned, ends today: '3M' on 2026-10-04 = 2026-08-01 .. 2026-10-04
export function rangeFor(preset, today) {
  const months = RANGE_PRESETS[preset];
  if (!months) throw new Error(`Unknown range: ${preset}`);
  return { from: `${addMonths(monthKey(today), -(months - 1))}-01`, to: today, monthAligned: true };
}

export function customRange(from, to) {
  return from <= to ? { from, to, monthAligned: false } : { from: to, to: from, monthAligned: false };
}

export const rangeDays = ({ from, to }) => dayDiff(from, to) + 1;

export function allowedGroups(range) {
  const days = rangeDays(range);
  return GROUPS.filter((g) => (g === 'day' ? days <= MAX_DAY_DAYS : g === 'week' ? days <= MAX_WEEK_DAYS : true));
}

export function defaultGroup(range) {
  const days = rangeDays(range);
  if (days <= 31) return 'day';
  if (days <= MAX_DAY_DAYS) return 'week';
  return 'month';
}

export function bucketKey(day, group) {
  if (group === 'day') return day;
  if (group === 'week') return weekStart(day);
  return monthKey(day);
}

export function bucketsInRange({ from, to }, group) {
  const keys = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = bucketKey(d, group);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}

// the days a bucket covers, clipped to the range
export function bucketRange(key, group, range) {
  let from;
  let to;
  if (group === 'day') {
    from = key;
    to = key;
  } else if (group === 'week') {
    from = key;
    to = addDays(key, 6);
  } else {
    from = `${key}-01`;
    to = `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;
  }
  return { from: from < range.from ? range.from : from, to: to > range.to ? range.to : to };
}

export function bucketLabel(key, group) {
  if (group === 'day') return String(dayOfMonth(key));
  if (group === 'week') return parseDay(key).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return parseDay(`${key}-01`).toLocaleDateString('en-IN', { month: 'short' });
}

export function filterEntries(entries, { from, to }, tagId = '') {
  return entries.filter((e) => {
    const d = dayKey(e.ts);
    return d >= from && d <= to && (!tagId || e.tagIds.includes(tagId));
  });
}

export const total = (entries) => entries.reduce((s, e) => s + e.amount, 0);

// one bar per bucket in the range, zero-filled
export function trend(entries, range, group) {
  const sums = new Map(bucketsInRange(range, group).map((k) => [k, 0]));
  for (const e of entries) {
    const k = bucketKey(dayKey(e.ts), group);
    if (sums.has(k)) sums.set(k, sums.get(k) + e.amount);
  }
  return [...sums].map(([key, value]) => ({ key, label: bucketLabel(key, group), value }));
}

export function byCategory(entries) {
  const sums = new Map();
  for (const e of entries) sums.set(e.categoryId, (sums.get(e.categoryId) || 0) + e.amount);
  const all = total(entries);
  return [...sums]
    .map(([categoryId, value]) => ({ categoryId, value, pct: all ? (value / all) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

// grouped by snapshot name (case-insensitive), so same-named one-offs merge; count = total qty
export function topItems(entries, limit = 10) {
  const groups = new Map();
  for (const e of entries) {
    const k = e.name.trim().toLowerCase();
    const g = groups.get(k) || { name: e.name, value: 0, count: 0 };
    g.value += e.amount;
    g.count += e.qty;
    groups.set(k, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function monthsSpan({ from, to }) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

// the period to compare against: same length, immediately before.
// month-aligned presets go month-for-month and cut at the same day-of-month,
// clamped to the shorter month (Oct 1–31 vs Sep 1–30).
export function previousRange(range) {
  if (range.monthAligned) {
    const n = monthsSpan(range);
    const fromMonth = addMonths(monthKey(range.from), -n);
    const toMonth = addMonths(monthKey(range.to), -n);
    const d = Math.min(dayOfMonth(range.to), daysInMonth(toMonth));
    return { from: `${fromMonth}-01`, to: `${toMonth}-${String(d).padStart(2, '0')}`, monthAligned: true };
  }
  const len = rangeDays(range);
  return { from: addDays(range.from, -len), to: addDays(range.from, -1), monthAligned: false };
}

export function compare(cur, prev) {
  return { delta: cur - prev, pct: prev ? Math.round(((cur - prev) / prev) * 100) : null };
}
```

- [ ] **Step 6: Run both and confirm they pass**

Run: `node --test tests/dates.test.js`. Expected: PASS, 8 tests.
Run: `node --test tests/report-data.test.js`. Expected: PASS, 13 tests.

- [ ] **Step 7: Checkpoint** for the user to commit.

---

### Task 2: store.loadRange

**Files:**
- Modify: `expense-tracker/js/store.js`, `expense-tracker/tests/store.test.js`

**Interfaces:**
- Consumes: `monthsBetween` from `dates.js`.
- Produces: `store.loadRange(from, to) → Promise<Entry[]>`. It loads (and caches) every month key the range touches and returns the entries whose local day falls in `[from, to]`. It's a read, so it is not serialized.

- [ ] **Step 1: Append the failing test** to the end of `tests/store.test.js`

```js
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/store.test.js`. Expected: 22 pass and 1 fail (`store.loadRange is not a function`).

- [ ] **Step 3: Modify `js/store.js`**

**3a.** Replace:
```js
import { nowTs, monthKey, dayKey, addMonths } from './dates.js';
```
with:
```js
import { nowTs, monthKey, dayKey, addMonths, monthsBetween } from './dates.js';
```

**3b.** Insert immediately **before** the line `  // ---------- whole-db ----------`:
```js
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

```

**3c.** In the returned object, replace:
```js
    entriesForDay, monthEntries, loadedEntries,
```
with:
```js
    entriesForDay, monthEntries, loadedEntries, loadRange,
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/store.test.js`. Expected: PASS, 23 tests.
Run: `node --test`. Expected: PASS, 66 tests (money 6, dates 8, frecency 7, store 23, ledger 9, report-data 13).

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 3: charts + Reports tab

**Files:**
- Create: `js/charts.js`, `js/reports.js`
- Modify: `js/ctx.js`, `js/app.js`, `sw.js`, `style.css`

**Interfaces:**
- Consumes:
  - Task 1–2 exports
  - `renderPeople` from `people.js`
  - `el`, `attachSwipe` from `ui.js`
  - `formatINR`
  - `todayKey`, `addDays`, `parseDay` from `dates.js`
- Produces:
  - `charts.js`:
    - `barChart({bars, selectedKey, onSelect}) → Node`
    - `hBars(rows, formatValue) → Node`, where rows are `{label, value, pct, active, onClick}`
  - `reports.js`: `renderReports() → HTMLElement`

- [ ] **Step 1: Create `js/charts.js`**

```js
// charts — hand-drawn SVG trend bars + HTML horizontal bars. no chart library.
// trend rects use class "tbar", never "bar": macro's .bar sets height:3px, and CSS height
// overrides an SVG rect's height attribute.
import { el } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const FIT_MAX = 31;      // up to this many bars fit the screen width; more scroll sideways
const SCROLL_BAR_PX = 28; // width per bar when scrolling

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

// bars: [{key, label, value}]. tapping a bar calls onSelect(key).
// each bar owns a 10-unit slot in a 0..100 tall viewBox, stretched to the container.
export function barChart({ bars, selectedKey = null, onSelect }) {
  const n = bars.length;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const fits = n <= FIT_MAX;
  const svg = svgEl('svg', { viewBox: `0 0 ${n * 10} 100`, preserveAspectRatio: 'none', class: 'bar-chart-svg' });
  bars.forEach((b, i) => {
    const h = b.value ? Math.max(2, (b.value / max) * 96) : 0;
    const cls = 'tbar' + (selectedKey === b.key ? ' selected' : selectedKey ? ' dim' : '');
    svg.appendChild(svgEl('rect', { x: i * 10 + 1.5, y: 100 - h, width: 7, height: h, class: cls }));
    // full-height invisible hit area so thin or zero bars are still tappable
    const hit = svgEl('rect', { x: i * 10, y: 0, width: 10, height: 100, class: 'tbar-hit' });
    hit.dataset.key = b.key;
    svg.appendChild(hit);
  });
  svg.addEventListener('click', (e) => {
    const key = e.target.dataset?.key;
    if (key) onSelect(key);
  });
  const step = fits ? Math.ceil(n / 8) : 2; // label every Nth bar so labels never collide
  const labels = el('div', { class: 'bar-labels' },
    ...bars.map((b, i) => el('span', {}, i % step === 0 ? b.label : '')));
  const inner = el('div', { class: 'chart-inner', style: fits ? {} : { minWidth: `${n * SCROLL_BAR_PX}px` } }, svg, labels);
  return el('div', { class: 'chart-scroll' }, inner);
}

// rows: [{label, value, pct, active, onClick}]
export function hBars(rows, formatValue) {
  return el('div', { class: 'hbars' },
    ...rows.map((r) => el('button', { class: 'hbar' + (r.active ? ' active' : ''), onClick: r.onClick },
      el('div', { class: 'hbar-top' },
        el('span', { class: 'hbar-label' }, r.label),
        el('span', { class: 'hbar-value' }, `${formatValue(r.value)} · ${Math.round(r.pct)}%`)),
      el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: { width: `${Math.max(1, r.pct)}%` } })),
    )),
  );
}
```

- [ ] **Step 2: `js/ctx.js`.** Replace:
```js
import { todayKey } from './dates.js';
```
with:
```js
import { todayKey, addDays } from './dates.js';
```
Then replace:
```js
  showSettled: false, // people tab: expand the settled list
```
with:
```js
  showSettled: false, // people tab: expand the settled list
  report: {
    seg: 'spend',          // 'spend' | 'people'
    range: '1M',           // '1M' | '3M' | '6M' | '1Y' | 'custom'
    customFrom: addDays(todayKey(), -29),
    customTo: todayKey(),
    group: null,           // null = default for the range
    tag: '',               // '' = all
    drill: null,           // tapped bucket key
    cat: null,             // tapped categoryId
  },
```

- [ ] **Step 3: Create `js/reports.js`**

```js
// reports tab — spend: range × group trend (tap a bar to drill in), by category (tap to filter
// top items), top items, tag filter, vs previous period. people: the balances list.
// all maths is in report-data.js; this file only draws it.
import { el, attachSwipe } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { formatINR } from './money.js';
import { todayKey, parseDay } from './dates.js';
import {
  RANGE_PRESETS, rangeFor, customRange, allowedGroups, defaultGroup, filterEntries, total,
  trend, byCategory, topItems, previousRange, compare, bucketRange,
} from './report-data.js';
import { barChart, hBars } from './charts.js';
import { renderPeople } from './people.js';

const rep = () => view.report;
const catName = (id) => store.state.categories.find((c) => c.id === id)?.name || '—';
const resetDrill = () => { rep().drill = null; rep().cat = null; };
const shortDay = (d) => parseDay(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const rangeLabel = ({ from, to }) => (from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`);

function currentRange() {
  if (rep().range === 'custom') return customRange(rep().customFrom, rep().customTo);
  return rangeFor(rep().range, todayKey());
}

function currentGroup(range) {
  return allowedGroups(range).includes(rep().group) ? rep().group : defaultGroup(range);
}

// horizontal chip rows scroll sideways; don't let that also switch tabs
function noTabSwipe(node) {
  attachSwipe(node, () => {}, { stopProp: true });
  return node;
}

function chipRow(options, active, onPick) {
  return noTabSwipe(el('div', { class: 'chips' },
    ...options.map(([value, label]) => el('button', {
      class: 'chip' + (value === active ? ' active' : ''),
      onClick: () => onPick(value),
    }, label))));
}

// ============================================================
//  tab
// ============================================================
export function renderReports() {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('div', { class: 'sub-tabs' },
    ...['spend', 'people'].map((s) => el('button', {
      class: 'sub-tab' + (rep().seg === s ? ' active' : ''),
      onClick: () => { rep().seg = s; rerender(); },
    }, s))));

  if (rep().seg === 'people') {
    pad.appendChild(renderPeople());
    return pad;
  }

  const range = currentRange();
  const group = currentGroup(range);
  pad.appendChild(renderControls(range, group));
  const body = el('div', { class: 'report-body' }, el('div', { class: 'hint' }, 'loading…'));
  pad.appendChild(body);
  fillSpendReport(body, range, group).catch((e) => {
    body.replaceChildren(el('div', { class: 'hint' }, `could not load: ${e.message}`));
  });
  return pad;
}

function renderControls(range, group) {
  const wrap = el('div', { class: 'report-controls' });
  const ranges = [...Object.keys(RANGE_PRESETS).map((k) => [k, k]), ['custom', 'custom']];
  wrap.appendChild(chipRow(ranges, rep().range, (v) => { rep().range = v; rep().group = null; resetDrill(); rerender(); }));

  if (rep().range === 'custom') {
    wrap.appendChild(el('div', { class: 'field-row' },
      dateInput('from', rep().customFrom, (v) => { rep().customFrom = v; }),
      dateInput('to', rep().customTo, (v) => { rep().customTo = v; }),
    ));
  }

  wrap.appendChild(chipRow(allowedGroups(range).map((g) => [g, g]), group,
    (v) => { rep().group = v; resetDrill(); rerender(); }));

  if (store.state.tags.length) {
    const tags = [['', 'all tags'], ...store.state.tags.map((t) => [t.id, t.name])];
    wrap.appendChild(chipRow(tags, rep().tag, (v) => { rep().tag = v; resetDrill(); rerender(); }));
  }
  return wrap;
}

function dateInput(label, value, set) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label' }, label),
    el('input', {
      class: 'input', type: 'date', value, max: todayKey(),
      onChange: (e) => {
        if (!e.target.value) return;
        set(e.target.value);
        rep().group = null;
        resetDrill();
        rerender();
      },
    }),
  );
}

// ============================================================
//  spend report
// ============================================================
async function fillSpendReport(body, range, group) {
  const prev = previousRange(range);
  const curAll = await store.loadRange(range.from, range.to);
  const prevAll = await store.loadRange(prev.from, prev.to);
  const cur = filterEntries(curAll, range, rep().tag);
  const curTotal = total(cur);
  const prevTotal = total(filterEntries(prevAll, prev, rep().tag));
  const bars = trend(cur, range, group);

  // a tapped bar narrows the breakdowns to that bucket (ignored if it no longer exists)
  const drillOn = rep().drill && bars.some((b) => b.key === rep().drill);
  const drillRange = drillOn ? bucketRange(rep().drill, group, range) : null;
  const scoped = drillRange ? filterEntries(cur, drillRange) : cur;
  const cats = byCategory(scoped);
  const catOn = rep().cat && cats.some((c) => c.categoryId === rep().cat);
  const itemsScope = catOn ? scoped.filter((e) => e.categoryId === rep().cat) : scoped;

  const parts = [
    totalCard(curTotal, prevTotal, range),
    el('div', { class: 'section-label' }, `trend · by ${group}`),
    curTotal
      ? noTabSwipe(barChart({
        bars,
        selectedKey: drillOn ? rep().drill : null,
        onSelect: (key) => { rep().drill = rep().drill === key ? null : key; rep().cat = null; rerender(); },
      }))
      : el('div', { class: 'hint' }, 'nothing spent in this range'),
    drillRange
      ? el('button', { class: 'link-btn', onClick: () => { resetDrill(); rerender(); } }, `showing ${rangeLabel(drillRange)} · clear`)
      : null,
    el('div', { class: 'section-label' }, 'by category'),
    cats.length
      ? hBars(cats.map((c) => ({
        label: catName(c.categoryId),
        value: c.value,
        pct: c.pct,
        active: rep().cat === c.categoryId,
        onClick: () => { rep().cat = rep().cat === c.categoryId ? null : c.categoryId; rerender(); },
      })), (v) => formatINR(v))
      : el('div', { class: 'hint' }, '—'),
    el('div', { class: 'section-label' }, catOn ? `top items · ${catName(rep().cat)}` : 'top items'),
    topList(topItems(itemsScope)),
  ];
  body.replaceChildren(...parts.filter(Boolean)); // never pass null: replaceChildren would print "null"
}

function totalCard(cur, prev, range) {
  const c = compare(cur, prev);
  const text = c.pct === null
    ? 'nothing to compare with'
    : `${c.delta >= 0 ? '↑' : '↓'} ${Math.abs(c.pct)}% vs previous period (${formatINR(prev)})`;
  const tone = c.pct === null ? '' : c.delta > 0 ? ' up' : ' down';
  return el('div', { class: 'totals-card' },
    el('div', { class: 'metric-label' }, rangeLabel(range).toLowerCase()),
    el('div', { class: 'big-num' }, formatINR(cur)),
    el('div', { class: 'report-compare' + tone }, text),
  );
}

function topList(items) {
  if (!items.length) return el('div', { class: 'hint' }, '—');
  return el('div', {},
    ...items.map((t) => el('div', { class: 'log-row' },
      el('div', { class: 'log-main' },
        el('div', { class: 'log-name' }, t.name),
        el('div', { class: 'log-meta' }, `×${t.count}`)),
      el('div', { class: 'log-amount' }, formatINR(t.value)),
    )),
  );
}
```

- [ ] **Step 4: `js/app.js`.** Add under `import { renderPeople } from './people.js';`:
```js
import { renderReports } from './reports.js';
```
Then replace:
```js
  return el('div', { class: 'view-pad' }, el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, 'reports arrive in a later update')));
```
with:
```js
  return renderReports();
```

- [ ] **Step 5: `sw.js`.** Replace `const CACHE_NAME = 'expense-v2';` with `const CACHE_NAME = 'expense-v3';`. In `ASSETS`, after `  './js/people.js',` add:
```js
  './js/report-data.js',
  './js/charts.js',
  './js/reports.js',
```

- [ ] **Step 6: Append report styles** to the end of `style.css`, using the Edit/Write tool (not a shell heredoc):

```css

/* ========== expense: reports ========== */
.view-pad .view-pad { padding: 0; }
.report-controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.report-compare { margin-top: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
.report-compare.up { color: var(--warn); }
.report-compare.down { color: var(--accent); }
.chart-scroll { overflow-x: auto; margin: 8px 0 4px; scrollbar-width: none; }
.chart-scroll::-webkit-scrollbar { display: none; }
.bar-chart-svg { display: block; width: 100%; height: 140px; }
.bar-chart-svg .tbar { fill: var(--accent); }
.bar-chart-svg .tbar.dim { fill: var(--accent-dim); opacity: 0.45; }
.bar-chart-svg .tbar-hit { fill: transparent; cursor: pointer; }
.bar-labels { display: flex; margin-top: 4px; }
.bar-labels span {
  flex: 1 1 0; min-width: 0; text-align: center; white-space: nowrap; overflow: visible;
  font-family: var(--font-mono); font-size: 9px; color: var(--text-muted);
}
.hbars { display: flex; flex-direction: column; gap: 10px; margin-bottom: 8px; }
.hbar { display: block; width: 100%; text-align: left; }
.hbar-top { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
.hbar-value { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
.hbar.active .hbar-label { color: var(--accent); }
.hbar.active .bar-fill { background: var(--accent); }
```

- [ ] **Step 7: Syntax check and suite**

Run: `node --check js/charts.js && node --check js/reports.js && node --check js/app.js && node --check js/ctx.js && node --check sw.js`. Expected: no output.
Check that every `js/*.js` file appears in `sw.js` ASSETS (16 files).
Run: `node --test`. Expected: PASS, 66 tests.

- [ ] **Step 8: Manual check (the user, `python -m http.server 8080` in `expense-tracker/`).** First log a handful of spends across a few days, including one or two backdated into last month.
  1. **Reports → spend, 1M:** the total shows this month so far, and "↑/↓ x% vs previous period" compares with the same days of last month. If last month is empty, it says "nothing to compare with" (Review Focus 2).
  2. **Trend bars are visibly tall**, not 3px slivers (Review Focus 5). Day labels show day numbers.
  3. **Tap a bar:** the other bars dim, "showing … · clear" appears, and by category / top items narrow to that day. Tap the same bar again to un-drill.
  4. **Tap a category:** "top items · Food" lists only that category's items. Tap it again to clear.
  5. **Switch to 3M:** the group switches to week automatically. Week labels show Monday dates, and the drill from step 3 is gone (Review Focus 4).
  6. **6M / 1Y:** the group chips offer only week / month.
  7. **Custom**, from a date years ago to today: only "month" is offered (Review Focus 3). With 40+ bars the chart scrolls sideways, and **scrolling it does not switch tabs**.
  8. **Tag filter `unhealthy`:** the totals and every section shrink to tagged entries only.
  9. **Lend/borrow amounts never appear** in spend totals.
  10. **Reports → people** shows the balances list, and tapping a person opens their history.
  11. **Offline reload** (DevTools → Network → Offline): the Reports tab still works.

  Known limitation: the Reports body loads asynchronously, so a re-render on this tab can briefly reset the scroll position. It's acceptable for now.

- [ ] **Step 9: Checkpoint** for the user to commit, then redeploy to the same Netlify site.
