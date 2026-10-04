# Expense Tracker — Plan 1: Foundation + Spend

> **For agentic workers:** Execute Tasks 1–7 in order, in one pass (no per-task reviewer). Use superpowers:executing-plans when running it inside Claude. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installable PWA where the user can create items/categories/tags and log spends with one tap (plus long-press, one-offs, edit, delete, Undo), with data in IndexedDB.

**Architecture:** Vanilla JS ES modules, no build step. Pure logic modules (`money`, `dates`, `frecency`, `store`) are unit-tested under Node's built-in runner. `store.js` takes an injected key/value adapter, so it runs against an in-memory map in tests and against IndexedDB in the browser. UI modules (`ui`, `fields`, `spend`, `settings`, `app`) are verified manually on the phone.

**Tech Stack:** HTML/CSS/JS (ES2022 modules), IndexedDB, Service Worker, `node --test` (Node 22, already installed). Zero npm dependencies.

**Spec:** `expense-tracker/docs/spec.md`. This plan covers build-order steps 1–2 (§10). Later plans: People, Reports, Budgets, Export/Import, Drive.

## Global Constraints

- Zero npm dependencies. `package.json` exists only to set `"type": "module"` for Node tests. It has no `dependencies` field.
- All money is integer **paise**. Never store a float amount.
- `ts` format is local `YYYY-MM-DDTHH:mm`. Never use `toISOString()` for keys. All day/month/week derivation goes through `js/dates.js`.
- `js/store.js` is the only module that touches storage (`kv`).
- Entries carry snapshot fields (`name`, `categoryId`, `tagIds`). Readers use the snapshot, never the live item.
- UI follows macro: lower-case UI copy, IBM Plex Mono for numbers, no emoji, no gradients or shadows, bottom-sheet modals.
- Never call `alert` / `confirm` / `prompt`. Use two-tap buttons or in-modal choices.
- **Do not run any build command. Do not `git add` / `git commit` / `git stash` / `git reset`.** The user commits. Each task ends with a checkpoint for the user instead.
- Tests: the commands below are what to run. Per the repo `CLAUDE.md`, when executing from the main Claude session, delegate test runs to a background subagent that reports pass/fail counts plus failures only.
- Macro reference source: `frontend2/macro/` (read-only; never edit it).

## Review Focus

1. **Scroll jump after one-tap log.** Every log re-renders, and `.content` is the scroll container. Without preserving `scrollTop`, the grid jumps to the top on every tap. Covered in Task 5 (`render()` restores scroll) and in the Task 6 manual check.
2. **Storage write fails mid-action.** The UI must show an error toast and in-memory state must stay unchanged. No "saved" state that isn't actually saved. Covered by the Task 4 test `a failed write leaves state unchanged`.
3. **Long-press also firing a tap**, which would double-log. Covered by `onTapOrHold` in Task 5 and the Task 6 manual check.
4. **Tapping while viewing a past day.** The entry lands on the viewed day, not today, and the toast says which day. Covered in Task 6 (`tsForViewedDay`, toast suffix) and its manual check.
5. **Offline reload with a module not in cache.** It must fail as a missing module, never by HTML being served as JS. Covered in Task 5 (`sw.js` navigate-only fallback; every module listed in `ASSETS`) and its manual offline check.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `expense-tracker/package.json` | `"type": "module"` for Node tests only | 1 |
| `expense-tracker/js/money.js` | paise parsing/formatting | 1 |
| `expense-tracker/tests/money.test.js` | | 1 |
| `expense-tracker/js/dates.js` | local-time keys, day/week/month arithmetic, labels | 2 |
| `expense-tracker/tests/dates.test.js` | | 2 |
| `expense-tracker/js/frecency.js` | item ranking | 3 |
| `expense-tracker/tests/frecency.test.js` | | 3 |
| `expense-tracker/js/store.js` | state + all persistence (injected kv) | 4 |
| `expense-tracker/tests/store.test.js` | | 4 |
| `expense-tracker/index.html`, `manifest.json`, `sw.js`, `style.css`, icons | PWA shell | 5 |
| `expense-tracker/js/db.js` | IndexedDB wrapper + `kv` adapter | 5 |
| `expense-tracker/js/ui.js` | el, icon, toast(+action), openModal, attachSwipe, onTapOrHold | 5 |
| `expense-tracker/js/ctx.js` | shared `store` instance, `view` state, `rerender()` | 5 |
| `expense-tracker/js/app.js` | boot, header, tabs, render loop, install banner | 5 |
| `expense-tracker/js/fields.js` | reusable form fields (category, tags, amount, date/time, text) | 6 |
| `expense-tracker/js/spend.js` | Spend tab + its modals | 6 |
| `expense-tracker/js/settings.js` | categories/tags/items management, JSON download, wipe | 7 |

`ctx.js` and `fields.js` are additions to the spec's file list. They exist to avoid import cycles and duplicated form code. The spec's `js/` list otherwise holds.

---

### Task 1: money.js

**Files:**
- Create: `expense-tracker/package.json`
- Create: `expense-tracker/js/money.js`
- Test: `expense-tracker/tests/money.test.js`

**Interfaces:**
- Produces:
  - `toPaise(input: string|number|null|undefined): number|null`
  - `groupIndian(digits: string): string`
  - `formatINR(paise: number, opts?: {fixed?: boolean}): string`
  - `toRupeesString(paise: number): string`
  - `toInputValue(paise: number): string`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "expense-tracker",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

- [ ] **Step 2: Write the failing test** at `tests/money.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaise, groupIndian, formatINR, toRupeesString, toInputValue } from '../js/money.js';

test('toPaise parses rupee strings into integer paise', () => {
  assert.equal(toPaise('45.5'), 4550);
  assert.equal(toPaise('45.50'), 4550);
  assert.equal(toPaise('45'), 4500);
  assert.equal(toPaise('45.'), 4500);
  assert.equal(toPaise('.5'), 50);
  assert.equal(toPaise('₹1,234.05'), 123405);
  assert.equal(toPaise(' 30 '), 3000);
  assert.equal(toPaise(12.5), 1250);
  assert.equal(toPaise('0'), 0);
});

test('toPaise rejects invalid input', () => {
  for (const bad of ['', '.', 'abc', '-5', '1.234', '1.2.3', null, undefined]) {
    assert.equal(toPaise(bad), null, `expected null for ${String(bad)}`);
  }
});

test('paise sums are exact where float sums drift', () => {
  assert.notEqual(0.1 + 0.2, 0.3);
  assert.equal(toPaise('0.1') + toPaise('0.2'), toPaise('0.3'));
});

test('groupIndian uses lakh/crore grouping', () => {
  assert.equal(groupIndian('0'), '0');
  assert.equal(groupIndian('999'), '999');
  assert.equal(groupIndian('1000'), '1,000');
  assert.equal(groupIndian('100000'), '1,00,000');
  assert.equal(groupIndian('123456789'), '12,34,56,789');
});

test('formatINR', () => {
  assert.equal(formatINR(4550), '₹45.50');
  assert.equal(formatINR(4500), '₹45');
  assert.equal(formatINR(4500, { fixed: true }), '₹45.00');
  assert.equal(formatINR(12345678900, { fixed: true }), '₹12,34,56,789.00');
  assert.equal(formatINR(-50000), '-₹500');
  assert.equal(formatINR(0), '₹0');
  assert.equal(formatINR(5), '₹0.05');
});

test('toRupeesString and toInputValue', () => {
  assert.equal(toRupeesString(4550), '45.50');
  assert.equal(toRupeesString(5), '0.05');
  assert.equal(toRupeesString(-150), '-1.50');
  assert.equal(toInputValue(4500), '45');
  assert.equal(toInputValue(4550), '45.50');
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run (from `expense-tracker/`): `node --test tests/money.test.js`
Expected: FAIL, "Cannot find module ... js/money.js".

- [ ] **Step 4: Implement** `js/money.js`

```js
// money — every amount in the app is an integer number of paise.
// floats never reach storage: "45.5" becomes 4550 at the input boundary.

// "45.5" | "₹1,234.05" | 12.5 -> paise, or null when the input is not a valid amount.
export function toPaise(input) {
  const s = String(input ?? '').replace(/[₹,\s]/g, '');
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return null;
  return Number(m[1] || '0') * 100 + Number(((m[2] || '') + '00').slice(0, 2));
}

// "123456789" -> "12,34,56,789"
export function groupIndian(digits) {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${digits.slice(-3)}`;
}

// 4550 -> "₹45.50", 4500 -> "₹45" (or "₹45.00" with fixed)
export function formatINR(paise, { fixed = false } = {}) {
  const abs = Math.abs(Math.round(paise));
  const p = abs % 100;
  const frac = fixed || p ? '.' + String(p).padStart(2, '0') : '';
  return (paise < 0 ? '-' : '') + '₹' + groupIndian(String(Math.floor(abs / 100))) + frac;
}

// 4550 -> "45.50" (CSV, exports)
export function toRupeesString(paise) {
  const abs = Math.abs(paise);
  return (paise < 0 ? '-' : '') + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
}

// value to prefill an <input>: "45" for whole rupees, "45.50" otherwise
export function toInputValue(paise) {
  return paise % 100 ? toRupeesString(paise) : String(paise / 100);
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `node --test tests/money.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 6: Checkpoint.** Tell the user Task 1 is ready to commit. Do not commit.

---

### Task 2: dates.js

**Files:**
- Create: `expense-tracker/js/dates.js`
- Test: `expense-tracker/tests/dates.test.js`

**Interfaces:**
- Produces:
  - `toTs(d: Date): string` (local, `YYYY-MM-DDTHH:mm`)
  - `nowTs(): string`
  - `todayKey(): string`
  - `dayKey(ts: string): string` (`YYYY-MM-DD`)
  - `monthKey(tsOrDay: string): string` (`YYYY-MM`)
  - `timeOf(ts): string` (`HH:mm`)
  - `joinTs(day, hhmm): string`
  - `parseDay(day): Date` (local midnight)
  - `tsToMs(ts): number`
  - `addDays(day, n): string`
  - `addMonths(month, n): string`
  - `weekStart(day): string` (Monday)
  - `monthsBetween(fromDay, toDay): string[]`
  - `formatDayLabel(day, today?): string`
  - `formatMonthLabel(month): string`

- [ ] **Step 1: Write the failing test** at `tests/dates.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toTs, dayKey, monthKey, timeOf, joinTs, parseDay, tsToMs, addDays, addMonths,
  weekStart, monthsBetween, formatDayLabel, formatMonthLabel,
} from '../js/dates.js';

// run every test as if the phone is in India (UTC+5:30), where UTC-based keys go wrong
process.env.TZ = 'Asia/Kolkata';

test('00:30 local on the 1st belongs to the new month and new day', () => {
  const d = new Date(2026, 10, 1, 0, 30); // 1 Nov 2026, 00:30 local
  // sanity: the trap is real in this timezone (UTC is still 31 Oct)
  assert.equal(d.toISOString().slice(0, 10), '2026-10-31');
  const ts = toTs(d);
  assert.equal(ts, '2026-11-01T00:30');
  assert.equal(dayKey(ts), '2026-11-01');
  assert.equal(monthKey(ts), '2026-11');
  assert.equal(timeOf(ts), '00:30');
});

test('joinTs / parseDay / tsToMs round-trip in local time', () => {
  assert.equal(joinTs('2026-10-04', '09:05'), '2026-10-04T09:05');
  const day = parseDay('2026-10-04');
  assert.deepEqual([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()], [2026, 9, 4, 0]);
  assert.equal(tsToMs('2026-10-04T09:05'), new Date(2026, 9, 4, 9, 5).getTime());
});

test('addDays crosses month, year and leap-day boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-10-04', 0), '2026-10-04');
});

test('addMonths crosses year boundaries', () => {
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-10', -3), '2026-07');
});

test('weekStart is the Monday on or before the day, across month/year boundaries', () => {
  assert.equal(weekStart('2026-10-05'), '2026-10-05'); // Monday
  assert.equal(weekStart('2026-10-04'), '2026-09-28'); // Sunday -> previous Monday, previous month
  assert.equal(weekStart('2026-01-01'), '2025-12-29'); // Thursday -> previous year
});

test('monthsBetween lists every month a range touches', () => {
  assert.deepEqual(monthsBetween('2026-08-15', '2026-10-04'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(monthsBetween('2026-12-20', '2027-01-02'), ['2026-12', '2027-01']);
  assert.deepEqual(monthsBetween('2026-10-01', '2026-10-31'), ['2026-10']);
});

test('labels', () => {
  assert.equal(formatDayLabel('2026-10-04', '2026-10-04'), 'Today');
  assert.equal(formatDayLabel('2026-10-03', '2026-10-04'), 'Yesterday');
  assert.match(formatDayLabel('2026-09-28', '2026-10-04'), /28/);
  assert.match(formatMonthLabel('2026-10'), /Oct/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/dates.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `js/dates.js`

```js
// dates — everything here is LOCAL time.
// ts format: 'YYYY-MM-DDTHH:mm' (no Z, no offset). keys are slices of it.
// never use toISOString() for keys: it converts to UTC and shifts the day
// (00:30 IST on the 1st is still the previous month in UTC).

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const toTs = (d) => `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const nowTs = () => toTs(new Date());
export const dayKey = (ts) => ts.slice(0, 10);
export const monthKey = (tsOrDay) => tsOrDay.slice(0, 7);
export const todayKey = () => dayKey(nowTs());
export const timeOf = (ts) => ts.slice(11, 16);
export const joinTs = (day, hhmm) => `${day}T${hhmm}`;

export function parseDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function tsToMs(ts) {
  const [y, m, d] = ts.slice(0, 10).split('-').map(Number);
  const [hh, mm] = ts.slice(11, 16).split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

// calendar arithmetic via setDate, so DST in other timezones can't skip a day
export function addDays(day, n) {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// weeks run Monday–Sunday
export function weekStart(day) {
  const d = parseDay(day);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayOf(d);
}

export function monthsBetween(fromDay, toDay) {
  const out = [];
  const end = monthKey(toDay);
  for (let m = monthKey(fromDay); m <= end; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function formatDayLabel(day, today = todayKey()) {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return parseDay(day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatMonthLabel(month) {
  return parseDay(`${month}-01`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/dates.test.js`
Expected: PASS, 7 tests. If the "sanity" assertion fails, Node isn't honouring `TZ` on this machine. Report that; don't weaken the test.

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 3: frecency.js

**Files:**
- Create: `expense-tracker/js/frecency.js`
- Test: `expense-tracker/tests/frecency.test.js`

**Interfaces:**
- Consumes: `tsToMs` from `dates.js`.
- Produces:
  - `HALF_LIFE_DAYS: number`
  - `score(useTimesMs: number[], nowMs: number): number`
  - `rankItems(items: Item[], entries: Entry[], nowMs: number): Item[]` (a new array)

**User contribution point (spec §8).** Implement the default below so the tests pass, then tell the user `score()` is theirs to retune. The tests check behaviour, not exact numbers, so a different decay formula still passes as long as it keeps "recent beats old" and "more uses beats fewer".

- [ ] **Step 1: Write the failing test** at `tests/frecency.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, rankItems } from '../js/frecency.js';
import { tsToMs } from '../js/dates.js';

const NOW = tsToMs('2026-10-04T12:00');
const DAY = 86400000;
const item = (id, name) => ({ id, name });
const use = (itemId, daysAgo) => {
  const d = new Date(NOW - daysAgo * DAY);
  const p = (n) => String(n).padStart(2, '0');
  return { itemId, ts: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` };
};

test('score: more uses beat fewer at the same age', () => {
  assert.ok(score([NOW, NOW], NOW) > score([NOW], NOW));
});

test('score: a recent use beats an old one', () => {
  assert.ok(score([NOW - 1 * DAY], NOW) > score([NOW - 30 * DAY], NOW));
});

test('score: no uses scores zero', () => {
  assert.equal(score([], NOW), 0);
});

test('rankItems: one use today outranks three uses two months ago', () => {
  const items = [item('old', 'Old'), item('new', 'New')];
  const entries = [use('old', 60), use('old', 61), use('old', 62), use('new', 0)];
  assert.deepEqual(rankItems(items, entries, NOW).map((i) => i.id), ['new', 'old']);
});

test('rankItems: daily habit beats a one-off from yesterday', () => {
  const items = [item('milk', 'Milk'), item('cake', 'Cake')];
  const entries = [...[1, 2, 3, 4, 5, 6, 7].map((d) => use('milk', d)), use('cake', 1)];
  assert.equal(rankItems(items, entries, NOW)[0].id, 'milk');
});

test('rankItems: unused items come last, alphabetically; one-off entries are ignored', () => {
  const items = [item('z', 'Zebra'), item('a', 'Apple'), item('u', 'Used')];
  const entries = [use('u', 3), { itemId: null, ts: '2026-10-04T10:00' }];
  assert.deepEqual(rankItems(items, entries, NOW).map((i) => i.id), ['u', 'a', 'z']);
});

test('rankItems does not mutate its input', () => {
  const items = [item('b', 'B'), item('a', 'A')];
  rankItems(items, [], NOW);
  assert.deepEqual(items.map((i) => i.id), ['b', 'a']);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/frecency.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `js/frecency.js`

```js
// frecency — rank items by how often AND how recently they were logged.
// each use is worth 0.5^(ageDays / HALF_LIFE_DAYS): today = 1, 14 days ago = 0.5, 28 days ago = 0.25.
// USER CONTRIBUTION POINT (spec §8): retune score() to your own habits.
import { tsToMs } from './dates.js';

export const HALF_LIFE_DAYS = 14;
const DAY_MS = 86400000;

export function score(useTimesMs, nowMs) {
  let s = 0;
  for (const t of useTimesMs) {
    const ageDays = Math.max(0, (nowMs - t) / DAY_MS);
    s += Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  }
  return s;
}

export function rankItems(items, entries, nowMs) {
  const uses = new Map();
  for (const e of entries) {
    if (!e.itemId) continue;
    if (!uses.has(e.itemId)) uses.set(e.itemId, []);
    uses.get(e.itemId).push(tsToMs(e.ts));
  }
  const scored = items.map((item) => ({ item, s: score(uses.get(item.id) || [], nowMs) }));
  scored.sort((a, b) => b.s - a.s || a.item.name.localeCompare(b.item.name));
  return scored.map((x) => x.item);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/frecency.test.js`. Expected: PASS, 7 tests.

- [ ] **Step 5: Checkpoint.** Remind the user that `score()` is their contribution point.

---

### Task 4: store.js

**Files:**
- Create: `expense-tracker/js/store.js`
- Test: `expense-tracker/tests/store.test.js`

**Interfaces:**
- Consumes: `nowTs`, `monthKey`, `dayKey`, `addMonths` from `dates.js`.
- Produces:
  - `SCHEMA_VERSION = 1`
  - `uid(): string`
  - `createStore(kv, { now?: () => ts, makeId?: () => string })`
- `kv` contract: `{ get(key): Promise<any|null>, set(key, value): Promise<void>, del(key): Promise<void>, keys(prefix): Promise<string[]> }`
- The store object:
  - `state: { categories, tags, items, meta, months: Map<monthKey, Entry[]> }`
  - `boot()`
  - `ensureMonth(mk) → Entry[]`
  - `saveCategory({id?, name, archived?}) → Category`
  - `saveTag({id?, name}) → Tag`
  - `saveItem({id?, name, price, categoryId, tagIds?, archived?}) → Item`
  - `deleteItem(id)`
  - `isItemUsed(id) → boolean`
  - `applyItemToPast(item) → number`
  - `logSpend({itemId?, name, categoryId, tagIds?, qty?, amount, ts?, note?}) → Entry`
  - `logItem(item, {qty?, amount?, ts?, note?}) → Entry`
  - `updateSpend(entry, patch) → Entry`
  - `deleteSpend(entry)`
  - `restoreSpend(entry)`
  - `entriesForDay(day) → Entry[]` (newest first; month must already be loaded)
  - `monthEntries(mk) → Entry[]`
  - `loadedEntries() → Entry[]`
  - `exportRaw() → {app, schemaVersion, exportedAt, data}`
  - `wipe()`
- Every mutating method validates first, writes to `kv`, and **only then** updates `state`. A rejected write leaves `state` unchanged.

- [ ] **Step 1: Write the failing test** at `tests/store.test.js`

```js
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/store.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `js/store.js`

```js
// store — app state + every read/write. the ONLY module that touches storage.
// storage is injected (kv = {get,set,del,keys}) so this file runs under node tests.
// rule: validate -> write kv -> only then update state. a failed write changes nothing.
import { nowTs, monthKey, dayKey, addMonths } from './dates.js';

export const SCHEMA_VERSION = 1;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const K = { categories: 'categories', tags: 'tags', items: 'items', meta: 'meta', month: (mk) => `spend:${mk}` };
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
  const state = { categories: [], tags: [], items: [], meta: defaultMeta(), months: new Map() };

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

  // ---------- reads ----------
  const monthEntries = (mk) => state.months.get(mk) || [];
  const loadedEntries = () => [...state.months.values()].flat();
  function entriesForDay(day) {
    return monthEntries(monthKey(day))
      .filter((e) => dayKey(e.ts) === day)
      .sort((a, b) => b.ts.localeCompare(a.ts));
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

  // every public mutator runs one at a time. without this, two fast taps both read the
  // same month array while the first idb write is pending, and the second write drops the first entry.
  // internal calls (logItem -> logSpend, wipe -> boot) use the raw functions, so the queue never waits on itself.
  let tail = Promise.resolve();
  const serial = (fn) => (...args) => {
    const run = tail.then(() => fn(...args));
    tail = run.catch(() => {});
    return run;
  };

  return {
    state,
    boot: serial(boot),
    ensureMonth,
    saveCategory: serial(saveCategory),
    saveTag: serial(saveTag),
    saveItem: serial(saveItem),
    deleteItem: serial(deleteItem),
    isItemUsed,
    applyItemToPast: serial(applyItemToPast),
    logSpend: serial(logSpend),
    logItem: serial(logItem),
    updateSpend: serial(updateSpend),
    deleteSpend: serial(deleteSpend),
    restoreSpend: serial(restoreSpend),
    entriesForDay, monthEntries, loadedEntries,
    exportRaw,
    wipe: serial(wipe),
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/store.test.js`. Expected: PASS, 16 tests.

- [ ] **Step 5: Run the whole suite**

Run: `node --test`. Expected: PASS, all 36 tests across 4 files.

- [ ] **Step 6: Checkpoint** for the user to commit.

---

### Task 5: PWA shell (copied helpers, SW, tabs, render loop)

**Files:**
- Create:
  - `expense-tracker/index.html`, `manifest.json`, `sw.js`, `style.css`
  - `icon.svg`, `icon-192.png`, `icon-512.png`
  - `js/db.js`, `js/ui.js`, `js/ctx.js`, `js/app.js`
  - Temporary stubs `js/spend.js` and `js/settings.js` (Tasks 6–7 replace these)

**Interfaces:**
- Consumes: `createStore` (Task 4), `todayKey` (Task 2).
- Produces:
  - `ui.js` exports: `$`, `$$`, `el`, `icon`, `toast(msg, kind?, action?: {label, onClick})`, `openModal(title, bodyBuilder) → {overlay, close}`, `attachSwipe(node, onSwipe, {stopProp?})`, `onTapOrHold(node, onTap, onHold, ms=450)`.
  - `ctx.js` exports: `store`, `view: {tab, day, search, chip}`, `setRender(fn)`, `rerender()`.
  - `db.js` exports: `kv`.
  - `spend.js` must export `renderSpend(): HTMLElement`.
  - `settings.js` must export `openSettings(): void`.

- [ ] **Step 1: Copy the static assets from macro**

```bash
cd /c/Users/NaveenPrajapati/Downloads/dev/frontend2
mkdir -p expense-tracker/js
cp macro/style.css macro/icon.svg macro/icon-192.png macro/icon-512.png expense-tracker/
```

The icons are macro's for now. A ₹ icon is a later cosmetic swap (regenerate the PNGs with cairosvg, as was done for macro).

- [ ] **Step 2: Append expense styles** to the end of `expense-tracker/style.css`

```css

/* ========== expense: item grid ========== */
.item-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0 20px; }
.item-grid .empty { grid-column: 1 / -1; }
.item-tile {
  display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between;
  gap: 6px; min-height: 64px; padding: 10px;
  background: var(--bg-raised); border: 1px solid var(--border); border-radius: 8px; text-align: left;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation;
}
.item-tile:active { border-color: var(--accent-dim); }
.item-tile-name {
  font-size: 13px; line-height: 1.25; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.item-tile-price { font-family: var(--font-mono); font-size: 12px; color: var(--accent); }

/* ========== expense: chips ========== */
.chips { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0; scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.chip {
  flex: none; padding: 5px 10px; border: 1px solid var(--border); border-radius: 999px;
  font-family: var(--font-mono); font-size: 11px; color: var(--text-dim);
}
.chip.active { border-color: var(--accent); color: var(--accent); }

/* ========== expense: totals + day list ========== */
.spend-totals { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px; }
.spend-totals-month { text-align: right; }
.log-amount { font-family: var(--font-mono); white-space: nowrap; }

/* ========== expense: floating add button ========== */
.view-pad { padding-bottom: 96px; }
.fab {
  position: fixed; right: max(16px, calc(50vw - 270px + 16px));
  bottom: calc(20px + env(safe-area-inset-bottom));
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--accent); color: var(--bg);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}

/* ========== expense: toast with action ========== */
.toast { bottom: calc(84px + env(safe-area-inset-bottom)); }
.toast-action { margin-left: 12px; padding: 2px 6px; color: var(--accent); font-family: var(--font-mono); }

/* ========== expense: forms + settings ========== */
select.input { appearance: none; -webkit-appearance: none; }
.inline-new { display: flex; gap: 6px; margin-top: 6px; }
.inline-new[hidden] { display: none; }
.settings-list-row { display: flex; gap: 6px; margin-bottom: 6px; }
.settings-list-row.archived .input { opacity: 0.5; }
.settings-item-row {
  display: flex; justify-content: space-between; width: 100%;
  padding: 8px 0; border-bottom: 1px solid var(--border); text-align: left;
}
.settings-item-row.archived { opacity: 0.5; }
.settings-item-price { font-family: var(--font-mono); color: var(--text-dim); }
.qty-control { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 12px; }
```

- [ ] **Step 3: Create `index.html`.** Copy `macro/index.html`, then make exactly these edits:
  - `<meta name="apple-mobile-web-app-title" content="macro" />` → `content="expense"`
  - `<meta name="description" content="A minimal nutrition tracker." />` → `content="One-tap expense tracker."`
  - `<title>macro</title>` → `<title>expense</title>`
  - `<script src="app.js" type="module"></script>` → `<script src="js/app.js" type="module"></script>`
  - Keep the inline service-worker registration script unchanged.

- [ ] **Step 4: Create `manifest.json`** (macro's, renamed)

```json
{
  "name": "expense",
  "short_name": "expense",
  "description": "One-tap expense tracker: spend, lend, borrow, budgets, reports.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0f0f0e",
  "theme_color": "#0f0f0e",
  "icons": [
    { "src": "icon.svg", "type": "image/svg+xml", "sizes": "any", "purpose": "any" },
    { "src": "icon-192.png", "type": "image/png", "sizes": "192x192", "purpose": "any maskable" },
    { "src": "icon-512.png", "type": "image/png", "sizes": "512x512", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 5: Create `sw.js`.** This is macro's strategy with two spec §3.1 changes: every module is precached, and the HTML fallback applies only to navigations.

```js
// expense service worker — network-first, cache as offline fallback.
// bump CACHE_NAME on every deploy. ASSETS must list EVERY js module:
// a module missing from cache must fail as missing, never be answered with index.html.
const CACHE_NAME = 'expense-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './js/app.js',
  './js/ctx.js',
  './js/db.js',
  './js/ui.js',
  './js/fields.js',
  './js/money.js',
  './js/dates.js',
  './js/frecency.js',
  './js/store.js',
  './js/spend.js',
  './js/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        // only page loads fall back to the app shell
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
```

Note: `cache.addAll` fails the whole install if any listed file is missing. `fields.js` is created in Task 6, so create an empty placeholder `js/fields.js` now (content: `// filled in Task 6`), together with the stubs in Step 9.

- [ ] **Step 6: Create `js/db.js`.** Copy `macro/app.js` lines 6–59 (the IndexedDB wrapper) and change it as follows:
  - `const DB_NAME = 'macro-db';` becomes `const DB_NAME = 'expense-db';`
  - Prefix each of `idbGet`, `idbSet`, `idbDelete`, `idbListKeys` with `export`.
  - Append:

```js

// adapter consumed by createStore() — the store never imports idb* directly
export const kv = { get: idbGet, set: idbSet, del: idbDelete, keys: idbListKeys };
```

- [ ] **Step 7: Create `js/ui.js`.** Build it from macro pieces plus two changes:
  1. Header comment: `// ui helpers — copied from macro/app.js. CHANGED: toast() takes an action. NEW: onTapOrHold().`
  2. Copy `macro/app.js` lines 70–93 (`$`, `$$`, `BOOL_ATTRS`, `el`) and prefix `$`, `$$` and `el` with `export`.
  3. Copy `macro/app.js` lines 110–130 (`icon`) and prefix it with `export`.
  4. Copy `macro/app.js` lines 791–815 (`openModal`) and prefix it with `export`.
  5. Copy `macro/app.js` lines 405–424 (`attachSwipe`) and prefix it with `export`.
  6. Add the changed `toast` and the new `onTapOrHold`:

```js
// CHANGED from macro: optional action button (used for undo). stays 4s when it has one.
let toastTimeout = null;
export function toast(msg, kind = '', action = null) {
  const existing = $('.toast');
  if (existing) existing.remove();
  if (toastTimeout) clearTimeout(toastTimeout);
  const t = el('div', { class: `toast ${kind}` }, msg);
  if (action) {
    t.appendChild(el('button', {
      class: 'toast-action',
      onClick: () => { clearTimeout(toastTimeout); t.remove(); action.onClick(); },
    }, action.label));
  }
  document.body.appendChild(t);
  toastTimeout = setTimeout(() => t.remove(), action ? 4000 : 2200);
}

// NEW: tap and long-press on one node. a long-press never also fires the tap,
// and moving the finger (scrolling) cancels the long-press.
export function onTapOrHold(node, onTap, onHold, ms = 450) {
  let timer = null;
  let held = false;
  let sx = 0;
  let sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  node.addEventListener('contextmenu', (e) => e.preventDefault());
  node.addEventListener('pointerdown', (e) => {
    held = false;
    sx = e.clientX;
    sy = e.clientY;
    timer = setTimeout(() => { timer = null; held = true; onHold(); }, ms);
  });
  node.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  });
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', (e) => {
    if (held) { held = false; e.preventDefault(); return; }
    onTap(e);
  });
}
```

- [ ] **Step 8: Create `js/ctx.js`**

```js
// ctx — the one shared store instance + transient view state.
// lives in its own module so spend/settings/app can share it without import cycles.
import { kv } from './db.js';
import { createStore } from './store.js';
import { todayKey } from './dates.js';

export const store = createStore(kv);

// UI-only state; never persisted
export const view = {
  tab: 'spend',      // 'spend' | 'people' | 'reports'
  day: todayKey(),   // day shown on the Spend tab
  search: '',
  chip: 'all',       // 'all' | categoryId
};

let renderFn = () => {};
export const setRender = (fn) => { renderFn = fn; };
export const rerender = () => renderFn();
```

- [ ] **Step 9: Create the temporary stubs** (replaced in Tasks 6–7)

`js/spend.js`:
```js
import { el } from './ui.js';
export function renderSpend() {
  return el('div', { class: 'view-pad' }, el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, 'spend — task 6')));
}
```

`js/settings.js`:
```js
import { openModal, el } from './ui.js';
export function openSettings() {
  openModal('settings', (body) => body.appendChild(el('div', { class: 'settings-info' }, 'settings — task 7')));
}
```

`js/fields.js`:
```js
// filled in Task 6
export {};
```

- [ ] **Step 10: Create `js/app.js`**

```js
// expense — one-tap expense tracker PWA. vanilla JS modules, IndexedDB, no dependencies.
import { $, el, icon, attachSwipe } from './ui.js';
import { store, view, setRender } from './ctx.js';
import { renderSpend } from './spend.js';
import { openSettings } from './settings.js';

const TABS = ['spend', 'people', 'reports'];

function render() {
  const app = $('#app');
  // keep the scroll position across re-renders (otherwise every one-tap log jumps to the top).
  // macro's #app uses min-height, so usually the window scrolls; save both to be safe.
  const prevScroll = $('.content')?.scrollTop || 0;
  const prevWindowScroll = window.scrollY;
  app.innerHTML = '';
  app.appendChild(renderHeader());
  app.appendChild(renderTabs());
  const content = el('div', { class: 'content' });
  attachSwipe(content, (dir) => switchTab(dir === 'left' ? 1 : -1));
  content.appendChild(renderTab());
  app.appendChild(content);
  content.scrollTop = prevScroll;
  window.scrollTo(0, prevWindowScroll);
}

function renderTab() {
  if (view.tab === 'spend') return renderSpend();
  const msg = view.tab === 'people' ? 'lend & borrow arrives in the next update' : 'reports arrive in a later update';
  return el('div', { class: 'view-pad' }, el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, msg)));
}

function renderHeader() {
  return el('div', { class: 'header' },
    el('div', { class: 'brand' },
      el('span', { class: 'brand-dot' }),
      el('span', { class: 'brand-text' }, 'expense'),
    ),
    el('div', { class: 'header-actions' },
      el('button', { class: 'icon-btn', 'aria-label': 'Settings', onClick: openSettings }, icon('settings', 16)),
    ),
  );
}

function renderTabs() {
  const t = el('div', { class: 'tabs' });
  for (const name of TABS) {
    t.appendChild(el('button', {
      class: 'tab' + (view.tab === name ? ' active' : ''),
      onClick: () => { view.tab = name; render(); },
    }, name));
  }
  return t;
}

function switchTab(delta) {
  const idx = TABS.indexOf(view.tab) + delta;
  if (idx < 0 || idx >= TABS.length) return;
  view.tab = TABS[idx];
  $('.content') && ($('.content').scrollTop = 0);
  render();
}
```

Append the install banner: copy `macro/app.js` lines 1214–1252 (from the `// PWA install banner` comment through the end of `showInstallBanner`). Make these replacements:
- `'macro:install-dismissed'` → `'expense:install-dismissed'` (both occurrences)
- the `'install macro'` text → `'install expense'`

Then add boot:

```js
async function start() {
  setRender(render);
  // ask the browser not to evict our data under storage pressure (installed PWAs usually get it)
  try { await navigator.storage?.persist?.(); } catch { /* not supported — fine */ }
  await store.boot();
  render();
}

start().catch((err) => {
  console.error(err);
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(el('div', { class: 'loading' }, `storage error: ${err.message}`));
});
```

- [ ] **Step 11: Manual check (the user runs this)**

From `expense-tracker/`, run `python -m http.server 8080`, then open `http://localhost:8080`. ES modules don't load from `file://`. Expected:
1. Header shows "expense" with a settings icon.
2. Tabs spend / people / reports switch on tap and on horizontal swipe.
3. Settings opens a bottom sheet.
4. DevTools → Application → IndexedDB → `expense-db` → `kv` contains `categories` (5), `tags` (1), `meta`.
5. **Offline check:** DevTools → Network → Offline, then reload. The app still loads. In the Console there must be **no** "Failed to load module script … MIME type text/html" error.

- [ ] **Step 12: Run the unit suite** (it must still pass): `node --test`. Expected: PASS, 36 tests.

- [ ] **Step 13: Checkpoint** for the user to commit.

---

### Task 6: Spend tab (grid, one-tap log, Undo, modals)

**Files:**
- Replace: `expense-tracker/js/fields.js`
- Replace: `expense-tracker/js/spend.js`

**Interfaces:**
- Consumes:
  - `store` (Task 4 API), `view` and `rerender` (ctx)
  - `el`, `icon`, `toast`, `openModal`, `attachSwipe`, `onTapOrHold` (ui)
  - `formatINR`, `toPaise`, `toInputValue` (money)
  - from dates: `nowTs`, `todayKey`, `dayKey`, `monthKey`, `timeOf`, `joinTs`, `addDays`, `formatDayLabel`, `formatMonthLabel`
  - `rankItems` (frecency)
- Produces:
  - `fields.js`:
    - `textField(label, value, onChange) → Node`
    - `noteField(value, onChange) → Node`
    - `amountField(paise|null, onChange(paise|null), label?) → {node, input}`
    - `categoryField(selectedId, onChange(id)) → Node`
    - `tagToggles(selectedIds, onChange(ids)) → Node`
    - `dateTimeFields(ts, onChange(ts)) → Node`
  - `spend.js`: `renderSpend() → HTMLElement`, `openItemModal(item|null, defaults?: {name?}) → void` (also used by settings).

- [ ] **Step 1: Write `js/fields.js`**

```js
// fields — small form building blocks shared by spend + settings modals.
// each field reports changes through onChange; callers keep their own form object.
import { el, toast } from './ui.js';
import { store } from './ctx.js';
import { toPaise, toInputValue } from './money.js';
import { dayKey, timeOf, joinTs, todayKey } from './dates.js';

export function textField(label, value, onChange) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label' }, label),
    el('input', { class: 'input', type: 'text', value, maxlength: '80', onInput: (e) => onChange(e.target.value) }),
  );
}

export function noteField(value, onChange) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label' }, 'note (optional)'),
    el('input', { class: 'input', type: 'text', value, maxlength: '200', onInput: (e) => onChange(e.target.value) }),
  );
}

// onChange receives paise, or null while the text is not a valid amount
export function amountField(paise, onChange, label = 'amount (₹)') {
  const input = el('input', {
    class: 'input',
    type: 'text',
    inputmode: 'decimal',
    placeholder: '0',
    value: paise == null ? '' : toInputValue(paise),
    onInput: (e) => onChange(toPaise(e.target.value)),
  });
  return { node: el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input), input };
}

// category <select> with an inline "+ new category" that creates it on the spot
export function categoryField(selectedId, onChange) {
  let current = selectedId || '';
  const select = el('select', { class: 'input' });
  const newInput = el('input', { class: 'input', type: 'text', placeholder: 'new category name', maxlength: '40' });
  const newRow = el('div', { class: 'inline-new', hidden: true });

  const fill = () => {
    select.innerHTML = '';
    select.appendChild(el('option', { value: '' }, 'pick one…'));
    for (const c of store.state.categories) {
      if (c.archived && c.id !== current) continue;
      select.appendChild(el('option', { value: c.id }, c.name));
    }
    select.appendChild(el('option', { value: '__new' }, '+ new category'));
    select.value = current;
  };

  select.addEventListener('change', () => {
    if (select.value === '__new') {
      select.value = current;
      newRow.hidden = false;
      newInput.focus();
      return;
    }
    current = select.value;
    onChange(current);
  });

  newRow.append(newInput, el('button', {
    class: 'btn-ghost',
    type: 'button',
    onClick: async () => {
      try {
        const c = await store.saveCategory({ name: newInput.value });
        current = c.id;
        fill();
        onChange(current);
        newInput.value = '';
        newRow.hidden = true;
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'add'));

  fill();
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'category'), select, newRow);
}

export function tagToggles(selectedIds, onChange) {
  const selected = new Set(selectedIds);
  const row = el('div', { class: 'chips' });
  for (const t of store.state.tags) {
    const chip = el('button', {
      type: 'button',
      class: 'chip' + (selected.has(t.id) ? ' active' : ''),
      onClick: () => {
        if (selected.has(t.id)) selected.delete(t.id); else selected.add(t.id);
        chip.classList.toggle('active', selected.has(t.id));
        onChange([...selected]);
      },
    }, t.name);
    row.appendChild(chip);
  }
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'tags (optional)'), row);
}

// future dates are not allowed (max = today)
export function dateTimeFields(ts, onChange) {
  let day = dayKey(ts);
  let time = timeOf(ts);
  const emit = () => onChange(joinTs(day, time));
  return el('div', { class: 'field-row' },
    el('label', { class: 'field' },
      el('span', { class: 'field-label' }, 'date'),
      el('input', {
        class: 'input', type: 'date', value: day, max: todayKey(),
        onChange: (e) => { if (e.target.value) { day = e.target.value; emit(); } },
      }),
    ),
    el('label', { class: 'field' },
      el('span', { class: 'field-label' }, 'time'),
      el('input', {
        class: 'input', type: 'time', value: time,
        onChange: (e) => { if (e.target.value) { time = e.target.value; emit(); } },
      }),
    ),
  );
}
```

- [ ] **Step 2: Write `js/spend.js`**

```js
// spend tab — item grid (frecency-ranked), one-tap log + undo, day list, and its modals.
import { el, icon, toast, openModal, attachSwipe, onTapOrHold } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { formatINR, toInputValue } from './money.js';
import { nowTs, todayKey, dayKey, monthKey, timeOf, joinTs, addDays, formatDayLabel, formatMonthLabel } from './dates.js';
import { rankItems } from './frecency.js';
import { textField, noteField, amountField, categoryField, tagToggles, dateTimeFields } from './fields.js';

const TOP_N = 12;
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
  return q || view.chip !== 'all' ? ranked : ranked.slice(0, TOP_N);
}

function fillGrid(grid) {
  grid.innerHTML = '';
  const items = visibleItems();
  if (!items.length) {
    const q = view.search.trim();
    grid.appendChild(el('div', { class: 'empty' },
      el('div', { class: 'empty-text' },
        store.state.items.length ? 'no matching items' : 'no items yet — add the things you buy often'),
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
    undoToast(`${item.name} ${formatINR(entry.amount)}${where}`, () => store.deleteSpend(entry));
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
              undoToast(`${item.name} ${formatINR(entry.amount)}`, () => store.deleteSpend(entry));
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
              undoToast(`${entry.name} ${formatINR(entry.amount)}`, () => store.deleteSpend(entry));
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
              toast('saved', 'success');
            } catch (e) { toast(`not saved: ${e.message}`, 'error'); }
          },
        }, 'save'),
      ),
    );
  });
}
```

- [ ] **Step 3: Manual check (the user, at `http://localhost:8080` on desktop and on the phone)**
  1. Empty state shows "no items yet" and "+ new item".
  2. Create "Amul milk", 30, Groceries. Then "save & log". Expected: the tile appears, today shows ₹30, and the toast says "Amul milk ₹30 · undo".
  3. Tap the tile 3 times, then tap **undo** on the last toast. Expected: today = ₹90.
  4. Scroll down so the grid is partly off-screen, then tap a tile. Expected: **the page does not jump to the top** (Review Focus 1).
  5. Long-press the tile. Expected: the log modal opens **and stays open**, and **no extra entry** is logged (Review Focus 3). Known fix if the modal flashes open then closes (some mobile browsers send the finger-lift click to the new overlay): in `ui.js` `openModal`, ignore overlay clicks for 400 ms after opening (`const openedAt = Date.now();` and `if (Date.now() - openedAt < 400) return;` in the overlay click handler). Set qty 2 and confirm the amount becomes 60. Set the date to yesterday, then log. Expected: the view jumps to Yesterday and shows the entry.
  6. While on Yesterday, tap a tile. Expected: the toast ends with "→ yesterday" and the entry is in Yesterday's list (Review Focus 4).
  7. Swipe the totals card left/right. Expected: the day changes and the tab does **not** change. Swiping in the empty area changes tabs.
  8. Swipe an entry row left. Expected: it's deleted, and undo restores it.
  9. Tap an entry and change its date into last month. Expected: the view jumps there and the month totals update.
  10. One-off: + → one-off expense → "Hardware" 340, Shopping. Expected: it's logged and does not appear in the grid.
  11. Type "gro" in search. Expected: Amul milk matches (by category). Type "zzz". Expected: `+ add "zzz"` prefills the name.
  12. In the item modal pick "+ new category", enter "Health", add. Expected: it's selected and a chip appears.
  13. Edit Amul milk → rename it to "Milk". Expected: the "past entries?" question appears. "past too" → the toast reports the count, and old rows show "Milk".
  14. Reload the page. Everything persists.

- [ ] **Step 4: Run the unit suite:** `node --test`. Expected: PASS, 36 tests.

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 7: Settings (categories, tags, items, JSON download, wipe)

**Files:**
- Replace: `expense-tracker/js/settings.js`

**Interfaces:**
- Consumes: `store`, `view`, `rerender` (ctx); `openItemModal` (spend); `el`, `openModal`, `toast` (ui); `formatINR` (money); `todayKey` (dates).
- Produces: `openSettings(): void`.

The JSON download is a stop-gap safety net until the Export/Import plan (spec §6.2) adds validated import, CSVs and the backup reminder. It does not update `meta.lastBackupAt` yet.

- [ ] **Step 1: Write `js/settings.js`**

```js
// settings — manage categories / tags / items, download a backup, erase everything.
import { el, openModal, toast } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { openItemModal } from './spend.js';
import { formatINR } from './money.js';
import { todayKey } from './dates.js';

export function openSettings() {
  openModal('settings', (body, close) => {
    body.append(
      namedListSection('categories', 'category', () => store.state.categories, (rec) => store.saveCategory(rec), true),
      namedListSection('tags', 'tag', () => store.state.tags, (rec) => store.saveTag(rec), false),
      itemsSection(close),
      backupSection(),
      dangerSection(close),
      el('div', { class: 'settings-info', style: { textAlign: 'center', marginTop: '16px' } }, 'expense · stored locally on your device'),
    );
  });
}

// rename inline (on change), archive/restore, add new
function namedListSection(title, singular, getList, save, archivable) {
  const sec = el('div', { class: 'settings-section' });
  const run = async (fn) => {
    try { await fn(); draw(); rerender(); } catch (e) { toast(e.message, 'error'); draw(); }
  };
  const draw = () => {
    sec.replaceChildren(el('div', { class: 'settings-section-title' }, title));
    for (const rec of getList()) {
      sec.appendChild(el('div', { class: 'settings-list-row' + (rec.archived ? ' archived' : '') },
        el('input', {
          class: 'input', type: 'text', value: rec.name, maxlength: '40',
          onChange: (e) => run(() => save({ ...rec, name: e.target.value })),
        }),
        archivable
          ? el('button', { class: 'btn-ghost', onClick: () => run(() => save({ ...rec, archived: !rec.archived })) },
            rec.archived ? 'restore' : 'archive')
          : null,
      ));
    }
    const add = el('input', { class: 'input', type: 'text', placeholder: `new ${singular}`, maxlength: '40' });
    sec.appendChild(el('div', { class: 'settings-list-row' },
      add,
      el('button', { class: 'btn-ghost', onClick: () => run(() => save({ name: add.value })) }, 'add'),
    ));
  };
  draw();
  return sec;
}

function itemsSection(closeSettings) {
  const sec = el('div', { class: 'settings-section' }, el('div', { class: 'settings-section-title' }, 'items'));
  const items = [...store.state.items].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  if (!items.length) sec.appendChild(el('div', { class: 'settings-info' }, 'no items yet'));
  for (const item of items) {
    sec.appendChild(el('button', {
      class: 'settings-item-row' + (item.archived ? ' archived' : ''),
      onClick: () => { closeSettings(); if (item.archived) restoreItem(item); else openItemModal(item); },
    },
      el('span', {}, item.archived ? `${item.name} (archived — tap to restore)` : item.name),
      el('span', { class: 'settings-item-price' }, formatINR(item.price)),
    ));
  }
  return sec;
}

async function restoreItem(item) {
  try {
    await store.saveItem({ ...item, archived: false });
    rerender();
    toast(`${item.name} restored`, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function backupSection() {
  return el('div', { class: 'settings-section' },
    el('div', { class: 'settings-section-title' }, 'backup'),
    el('button', { class: 'btn-ghost', style: { width: '100%' }, onClick: downloadJson }, 'download backup (json)'),
    el('div', { class: 'settings-info' },
      'a full copy of your data. restore and google drive backup arrive in a later update — download one now and then until then.'),
  );
}

async function downloadJson() {
  try {
    const dump = await store.exportRaw();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `expense-backup-${dump.exportedAt.slice(0, 10)}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('backup downloaded', 'success');
  } catch (e) { toast(`backup failed: ${e.message}`, 'error'); }
}

// two-tap erase (no confirm() dialogs)
function dangerSection(closeSettings) {
  let armed = false;
  const btn = el('button', {
    class: 'btn-danger-ghost',
    style: { width: '100%' },
    onClick: async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'tap again to erase everything';
        setTimeout(() => { armed = false; btn.textContent = 'erase all data'; }, 4000);
        return;
      }
      try {
        await store.wipe();
        view.day = todayKey();
        view.chip = 'all';
        view.search = '';
        closeSettings();
        rerender();
        toast('all data erased');
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'erase all data');
  return el('div', { class: 'settings-section' }, el('div', { class: 'settings-section-title' }, 'danger zone'), btn);
}
```

- [ ] **Step 2: Manual check (the user)**
  1. Rename "Bills" to "Bills & recharge". Expected: the chip updates.
  2. Try renaming "Food" to "groceries". Expected: error toast "already exists", and the field resets.
  3. Archive "Travel". Expected: its chip disappears and items in Travel still show their category name in the day list.
  4. Add a tag "office". Expected: it appears in the item modal tag toggles.
  5. Items list: tap an item. Expected: the item modal opens. Archive it via remove (if it's used). Expected: it shows as archived, and tapping it restores it.
  6. Download backup. Expected: the JSON file contains `spend:YYYY-MM`, `items`, `categories`, `meta`.
  7. Erase: the first tap arms it, the second erases. Expected: the app shows 5 default categories and no items.

- [ ] **Step 3: Run the unit suite:** `node --test`. Expected: PASS, 36 tests.

- [ ] **Step 4: Checkpoint** for the user to commit. Then deploy: create a **new** Netlify site by dragging the `expense-tracker/` folder in. After that, always redeploy through that site's Deploys tab, and bump `CACHE_NAME` in `sw.js` on every deploy.

---

## What comes next (separate plans, written after Plan 1 lands)

1. People (ledger, balances, person history, settle). Spec §4.2, §5.2.
2. Reports (range × group, trend, category, top items, tag filter, people reports). Spec §5.3. The sideways-scrolling trend chart needs `attachSwipe(chart, () => {}, { stopProp: true })`, like the chips.
3. Budgets. Spec §5.4.
4. Export/import + `summary.md` / CSVs + backup reminder. Spec §6.1–6.2.
5. Google Drive. Spec §6.3.
