# Kharchly — Plan 5: Export, Import, Summary + Backup Reminder

> **For agentic workers:** Execute Tasks 1–3 in order, in one pass (no per-task reviewer). Use superpowers:executing-plans when running it inside Claude. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the data safe and readable outside the phone.
- **Restore** from a `backup.json`. The file is validated first, then you confirm. A bad file never touches existing data.
- **Download** `summary.md` (about 1–2 KB, the file Claude reads first) and a month's spend CSV, alongside the existing JSON backup.
- **"Last backup: N days ago"** in Settings, plus a dot on the settings icon when a backup is due (more than 14 days, and only once there is data).

The file builders made here are the same ones Plan 6 (Google Drive) will upload.

**Architecture:**
- A new pure module, `export.js`: CSV escaping, `spendCsv`, `peopleCsv`, `summaryMd`, `validateBackup`, `backupDue`. It reuses `report-data.js`, `budgets.js`, `ledger.js` and `money.js`.
- `store.js` gains `importRaw(dump)` and `markBackedUp()`.
- A new non-pure helper, `backup-files.js`, gathers store data into those builders, so Settings now and Drive later share it.
- Settings gets a rebuilt backup section and the restore flow. `app.js` gets the reminder dot.

**Tech Stack:** As before: vanilla ES modules, IndexedDB, `node --test`. Zero npm dependencies.

**Spec:** `expense-tracker/docs/spec.md` §6.1 (files), §6.2 (manual export / import), §5.5 (backup reminder), §9 (export test cases). This builds on Plans 1–4, which are implemented and pushed. Anchors are from commit `4b429b6`.

## Global Constraints

- **CSV:** RFC 4180 quoting (commas, quotes, newlines), with CRLF line endings.
  - Amounts are in rupees with 2 decimals (`toRupeesString`).
  - Tags are names joined with `;`. Category and person are **names**, never ids.
- `spend-YYYY-MM.csv` header: `date,time,item,category,tags,qty,amount,note`. Rows are oldest first.
- `people.csv` header: `date,person,kind,amount,balance_after,note`. Rows are grouped by person (A→Z), oldest first, and `balance_after` is that person's running balance (+ means they owe me).
- **`summary.md`:**
  - Plain markdown, under 3,000 characters.
  - Month labels use `YYYY-MM`, not the locale's month names, so they're stable and machine-friendly.
  - "This month vs last month" compares the **same days** (`rangeFor('1M')` vs `previousRange`).
  - The last 6 months always appear, including months with ₹0.
  - Budgets show their current period. People show non-zero balances plus totals.
  - It ends with a short guide to the other files.
- **Import:**
  - The file is validated first.
  - The user confirms, with counts shown for the file and for this phone.
  - Only then does it replace **everything**.
  - After import: `lastBackupAt = now`, every imported month is marked dirty, `dirtyPeople = true`, and **this device's** `meta.drive` is kept. If a write fails mid-way, it tries to put the previous data back.
- **Backup reminder:** due when there is data **and** either there has never been a backup or the last one was more than 14 days ago. A manual JSON download counts as a backup.
- `store.js` is the only module touching `kv`. No `alert` / `confirm`: use in-modal two-tap.
- **No builds. No git write commands.** The user commits. Tests run from `expense-tracker/` with `node --test`. From the main Claude session, delegate test runs to a background subagent.

## Review Focus

1. **A bad or foreign file chosen for restore** (macro's backup, a half-edited JSON). It must be refused with a reason, and nothing on the phone may change. Tests: `export.test.js` "validateBackup rejects bad files" and `store.test.js` "importRaw rejects an invalid backup and changes nothing".
2. **A note with a comma, a quote or a line break** breaking the CSV columns. Test: `export.test.js` "spendCsv" (the note `he said "ok"`, the item `Milk, Amul`) and "csvEscape".
3. **The summary disagreeing with the CSVs.** Test: `export.test.js` "summaryMd … totals match the CSV".
4. **Restoring on a phone already connected to Drive (Plan 6).** The Drive link must survive, and everything must be re-uploaded. Test: `store.test.js` "importRaw restores … keeps this device's drive state".
5. **A reminder dot on a brand-new empty app.** It must not appear until there's data. Test: `export.test.js` "backupDue: never for an empty app".

---

## File map

| File | Change | Task |
|---|---|---|
| `js/export.js` | **create**: csv, summary, validation, reminder maths (pure) | 1 |
| `tests/export.test.js` | **create** (7 tests) | 1 |
| `js/store.js` | **modify**: `importRaw`, `markBackedUp` | 2 |
| `tests/store.test.js` | **modify**: append 3 tests | 2 |
| `js/backup-files.js` | **create**: builds summary/csv text from the store | 3 |
| `js/settings.js` | **modify**: new backup section, downloads, restore flow | 3 |
| `js/app.js` | **modify**: reminder dot on the settings icon | 3 |
| `sw.js` | **modify**: precache 2 modules, bump the cache name | 3 |
| `style.css` | **modify**: dot + warn text | 3 |

---

### Task 1: export.js (pure)

**Files:**
- Create: `expense-tracker/js/export.js`
- Test: `expense-tracker/tests/export.test.js`

**Interfaces:**
- Consumes:
  - `toRupeesString`, `formatINR` (money)
  - `dayKey`, `timeOf`, `monthKey`, `addMonths`, `monthsBetween`, `dayOfMonth`, `dayDiff` (dates)
  - `rangeFor`, `previousRange`, `filterEntries`, `total` (report-data)
  - `evaluate` (budgets)
  - `KINDS`, `balances`, `totals`, `history` (ledger)
- Produces:
  - `csvEscape(v) → string`
  - `spendCsv(entries, {categories, tags}) → string`
  - `peopleCsv(people, ledger) → string`
  - `summaryMd({now, entries, categories, items, tags, people, ledger, budgets}) → string`
  - `validateBackup(dump, maxSchema) → {counts: {expenses, items, people, ledger, budgets}}` (throws `Error('Not a valid backup: …')`)
  - `BACKUP_REMIND_DAYS = 14`
  - `daysSinceBackup(meta, now) → number|null`
  - `backupDue(meta, now, hasData) → boolean`

- [ ] **Step 1: Write the failing test** at `tests/export.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, spendCsv, peopleCsv, summaryMd, validateBackup, backupDue, daysSinceBackup } from '../js/export.js';

process.env.TZ = 'Asia/Kolkata';

const categories = [{ id: 'food', name: 'Food', archived: false }, { id: 'groc', name: 'Groceries', archived: false }];
const tags = [{ id: 'unh', name: 'unhealthy' }];
const people = [{ id: 'puru', name: 'Puru', archived: false }, { id: 'amit', name: 'Amit', archived: false }];
let n = 0;
const e = (ts, amount, extra = {}) => ({
  id: `e${++n}`, itemId: null, name: 'Chai', categoryId: 'food', tagIds: [], qty: 1, amount, ts, note: '', ...extra,
});

test('csvEscape quotes commas, quotes and newlines (RFC 4180)', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('line1\nline2'), '"line1\nline2"');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(12), '12');
});

test('spendCsv: header, rows oldest first, rupee amounts, names not ids', () => {
  const csv = spendCsv([
    e('2026-10-02T09:05', 4550, { name: 'Milk, Amul', categoryId: 'groc', qty: 2, tagIds: ['unh'], note: 'he said "ok"' }),
    e('2026-10-01T08:00', 2000),
  ], { categories, tags });
  assert.equal(csv, [
    'date,time,item,category,tags,qty,amount,note',
    '2026-10-01,08:00,Chai,Food,,1,20.00,',
    '2026-10-02,09:05,"Milk, Amul",Groceries,unhealthy,2,45.50,"he said ""ok"""',
  ].join('\r\n') + '\r\n');
});

test('peopleCsv: grouped by person A→Z with running balance', () => {
  const ledger = [
    { id: 'l1', personId: 'puru', kind: 'lent', amount: 100000, ts: '2026-10-01T10:00', note: '' },
    { id: 'l2', personId: 'amit', kind: 'borrowed', amount: 50000, ts: '2026-10-02T10:00', note: 'cab' },
    { id: 'l3', personId: 'puru', kind: 'repaid_to_me', amount: 40000, ts: '2026-10-03T10:00', note: '' },
  ];
  assert.equal(peopleCsv(people, ledger), [
    'date,person,kind,amount,balance_after,note',
    '2026-10-02,Amit,borrowed,500.00,-500.00,cab',
    '2026-10-01,Puru,lent,1000.00,1000.00,',
    '2026-10-03,Puru,repaid_to_me,400.00,600.00,',
  ].join('\r\n') + '\r\n');
});

test('summaryMd: small, same-days comparison, 6-month totals, budgets, people; totals match the CSV', () => {
  const entries = [
    e('2026-10-01T09:00', 3000, { categoryId: 'groc' }),
    e('2026-10-03T09:00', 2000),
    e('2026-09-02T09:00', 1500),
    e('2026-09-20T09:00', 99900), // after day 4 of Sep: not in the comparison, but in Sep's month total
    e('2026-05-10T09:00', 700),
  ];
  const md = summaryMd({
    now: '2026-10-04T10:00', entries, categories, items: [], tags, people,
    ledger: [{ id: 'l1', personId: 'puru', kind: 'lent', amount: 60000, ts: '2026-10-01T10:00', note: '' }],
    budgets: [{ id: 'b1', scope: 'category', refId: 'food', period: 'month', limit: 10000 }],
  });
  assert.ok(md.length < 3000, `summary is ${md.length} chars`);
  assert.match(md, /\| category \| 2026-10 \(1–4\) \| 2026-09 \(1–4\) \|/);
  assert.match(md, /\| Groceries \| ₹30 \| ₹0 \|/);
  assert.match(md, /\| Food \| ₹20 \| ₹15 \|/);
  assert.match(md, /\| \*\*total\*\* \| \*\*₹50\*\* \| \*\*₹15\*\* \|/);
  assert.match(md, /\| 2026-09 \| ₹1,014 \|/);
  assert.match(md, /\| 2026-06 \| ₹0 \|/);
  assert.match(md, /\| 2026-05 \| ₹7 \|/);
  assert.match(md, /Food · month: ₹20 \/ ₹100 \(20%, on track\)/);
  assert.match(md, /Puru owes you ₹600/);
  // the October total in the summary equals the sum of October's CSV amounts
  const oct = entries.filter((x) => x.ts.startsWith('2026-10'));
  const csvSum = spendCsv(oct, { categories, tags }).trim().split('\r\n').slice(1)
    .reduce((s, line) => s + Math.round(Number(line.split(',')[6]) * 100), 0);
  assert.equal(csvSum, 5000);
});

const good = () => ({
  app: 'expense-tracker',
  schemaVersion: 1,
  exportedAt: '2026-10-04T10:00',
  data: {
    categories,
    tags,
    items: [{ id: 'milk', name: 'Milk', price: 3000, categoryId: 'groc', tagIds: [], archived: false, createdAt: '2026-10-01T08:00' }],
    meta: { schemaVersion: 1 },
    people,
    ledger: [{ id: 'l1', personId: 'puru', kind: 'lent', amount: 100, ts: '2026-10-01T10:00', note: '' }],
    budgets: [],
    'spend:2026-10': [e('2026-10-01T09:00', 3000)],
  },
});

test('validateBackup accepts a good backup and counts it', () => {
  assert.deepEqual(validateBackup(good(), 1).counts, { expenses: 1, items: 1, people: 2, ledger: 1, budgets: 0 });
});

test('validateBackup rejects bad files with a reason', () => {
  const bad = (mutate, re) => {
    const d = good();
    mutate(d);
    assert.throws(() => validateBackup(d, 1), re);
  };
  assert.throws(() => validateBackup(null, 1), /Not a valid backup/);
  bad((d) => { d.app = 'macro'; }, /not a kharchly backup/);
  bad((d) => { d.schemaVersion = 2; }, /newer/);
  bad((d) => { delete d.data.categories; }, /categories/);
  bad((d) => { d.data['spend:2026-10'][0].amount = 12.5; }, /amount/);
  bad((d) => { d.data['spend:2026-10'][0].amount = -1; }, /amount/);
  bad((d) => { d.data['spend:2026-10'][0].categoryId = 'gone'; }, /unknown category/);
  bad((d) => { d.data['spend:2026-10'][0].ts = '2026-09-30T10:00'; }, /wrong month/);
  bad((d) => { d.data.ledger[0].personId = 'ghost'; }, /unknown person/);
  bad((d) => { d.data.ledger[0].amount = 0; }, /amount/);
  bad((d) => { d.data.items[0].categoryId = 'gone'; }, /unknown category/);
});

test('backupDue: never for an empty app; due when never backed up or older than 14 days', () => {
  assert.equal(backupDue({ lastBackupAt: null }, '2026-10-04T10:00', false), false);
  assert.equal(backupDue({ lastBackupAt: null }, '2026-10-04T10:00', true), true);
  assert.equal(backupDue({ lastBackupAt: '2026-09-25T10:00' }, '2026-10-04T10:00', true), false);
  assert.equal(backupDue({ lastBackupAt: '2026-09-19T10:00' }, '2026-10-04T10:00', true), true);
  assert.equal(daysSinceBackup({ lastBackupAt: '2026-10-01T23:00' }, '2026-10-04T01:00'), 3);
  assert.equal(daysSinceBackup({ lastBackupAt: null }, '2026-10-04T01:00'), null);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/export.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Create `js/export.js`**

```js
// export — pure builders for the files that leave the phone, plus backup validation.
//   spend-YYYY-MM.csv  every expense of a month (RFC 4180, CRLF, rupees, names not ids)
//   people.csv         every lend/borrow entry with running balance per person
//   summary.md         ~1-2 KB overview: the file to read first (by you or by Claude)
// no DOM, no storage: callers pass data in.
import { toRupeesString, formatINR } from './money.js';
import { dayKey, timeOf, monthKey, addMonths, monthsBetween, dayOfMonth, dayDiff } from './dates.js';
import { rangeFor, previousRange, filterEntries, total } from './report-data.js';
import { evaluate } from './budgets.js';
import { KINDS, balances, totals, history } from './ledger.js';

// ============================================================
//  csv
// ============================================================
export function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvLines = (rows) => rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
const nameOf = (list, id) => list.find((r) => r.id === id)?.name ?? '';

export function spendCsv(entries, { categories, tags }) {
  const rows = [...entries]
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((e) => [
      dayKey(e.ts), timeOf(e.ts), e.name, nameOf(categories, e.categoryId),
      e.tagIds.map((t) => nameOf(tags, t)).filter(Boolean).join(';'),
      e.qty, toRupeesString(e.amount), e.note,
    ]);
  return csvLines([['date', 'time', 'item', 'category', 'tags', 'qty', 'amount', 'note'], ...rows]);
}

export function peopleCsv(people, ledger) {
  const rows = [];
  for (const p of [...people].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const h of history(ledger, p.id)) {
      rows.push([dayKey(h.ts), p.name, h.kind, toRupeesString(h.amount), toRupeesString(h.balanceAfter), h.note]);
    }
  }
  return csvLines([['date', 'person', 'kind', 'amount', 'balance_after', 'note'], ...rows]);
}

// ============================================================
//  summary.md
// ============================================================
const STATUS_TEXT = { 'on track': 'on track', ahead: 'ahead of pace', over: 'over' };

export function summaryMd({ now, entries, categories, items, people, ledger, budgets }) {
  const today = dayKey(now);
  const catName = (id) => nameOf(categories, id) || '—';
  const lines = [
    '# kharchly summary',
    `generated ${today} ${timeOf(now)} · amounts in ₹ · spending only (lend/borrow is listed separately)`,
    '',
  ];

  // this month vs last month, same days
  const cur = rangeFor('1M', today);
  const prev = previousRange(cur);
  const curE = filterEntries(entries, cur);
  const prevE = filterEntries(entries, prev);
  const label = (r) => `${monthKey(r.from)} (1–${dayOfMonth(r.to)})`;
  const sumCat = (list, id) => total(list.filter((e) => e.categoryId === id));
  const catIds = [...new Set([...curE, ...prevE].map((e) => e.categoryId))]
    .sort((a, b) => sumCat(curE, b) - sumCat(curE, a) || sumCat(prevE, b) - sumCat(prevE, a));
  lines.push('## this month vs last month (same days)', `| category | ${label(cur)} | ${label(prev)} |`, '|---|---:|---:|');
  for (const id of catIds) lines.push(`| ${catName(id)} | ${formatINR(sumCat(curE, id))} | ${formatINR(sumCat(prevE, id))} |`);
  lines.push(`| **total** | **${formatINR(total(curE))}** | **${formatINR(total(prevE))}** |`, '');

  // last 6 months, zero months included
  lines.push('## last 6 months', '| month | total |', '|---|---:|');
  for (const mk of monthsBetween(`${addMonths(monthKey(today), -5)}-01`, today)) {
    lines.push(`| ${mk} | ${formatINR(total(entries.filter((e) => monthKey(e.ts) === mk)))} |`);
  }
  lines.push('');

  // budgets, current period
  lines.push('## budgets (current period)');
  if (!budgets.length) lines.push('- none');
  for (const b of budgets) {
    const ev = evaluate(b, entries, now);
    const name = b.scope === 'all' ? 'all spending' : nameOf(b.scope === 'category' ? categories : items, b.refId) || '(removed)';
    lines.push(`- ${name} · ${b.period}: ${formatINR(ev.spent)} / ${formatINR(b.limit)} (${Math.round(ev.spentFrac * 100)}%, ${STATUS_TEXT[ev.status]})`);
  }
  lines.push('');

  // people
  const rows = balances(people, ledger);
  const open = rows.filter((r) => r.balance !== 0).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  const t = totals(rows);
  lines.push('## people (lend / borrow)');
  if (!open.length) lines.push('- nobody owes anything');
  for (const r of open) {
    lines.push(r.balance > 0 ? `- ${r.person.name} owes you ${formatINR(r.balance)}` : `- you owe ${r.person.name} ${formatINR(-r.balance)}`);
  }
  lines.push(`owed to you ${formatINR(t.owedToMe)} · you owe ${formatINR(t.iOwe)}`, '');

  lines.push(
    '## files in this folder',
    '- spend-YYYY-MM.csv — every expense of that month: date,time,item,category,tags,qty,amount,note',
    '- people.csv — every lend/borrow entry: date,person,kind,amount,balance_after,note (+ = they owe me)',
    '- backup.json — full backup for restoring the app (no need to read it)',
    '',
  );
  return lines.join('\n');
}

// ============================================================
//  backup validation — runs BEFORE anything on the phone is touched
// ============================================================
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function validateBackup(dump, maxSchema) {
  const fail = (msg) => { throw new Error(`Not a valid backup: ${msg}`); };
  if (!dump || typeof dump !== 'object') fail('not a JSON object');
  if (dump.app !== 'expense-tracker') fail('not a kharchly backup');
  if (!Number.isInteger(dump.schemaVersion)) fail('missing version');
  if (dump.schemaVersion > maxSchema) fail('made by a newer app version');
  const d = dump.data;
  if (!d || typeof d !== 'object') fail('no data');
  if (!d.meta || typeof d.meta !== 'object') fail('meta missing');

  const list = (key, required) => {
    if (d[key] === undefined && !required) return [];
    if (!Array.isArray(d[key])) fail(`${key} is not a list`);
    return d[key];
  };
  const ids = (records, what) => {
    const set = new Set();
    for (const r of records) {
      if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') fail(`bad ${what} record`);
      set.add(r.id);
    }
    return set;
  };
  const amount = (v, where, min = 0) => { if (!Number.isInteger(v) || v < min) fail(`bad amount in ${where}`); };
  const stamp = (v, where) => { if (typeof v !== 'string' || !TS_RE.test(v)) fail(`bad date in ${where}`); };

  const categories = list('categories', true);
  const tags = list('tags', true);
  const items = list('items', true);
  const people = list('people', false);
  const ledger = list('ledger', false);
  const budgets = list('budgets', false);
  const catIds = ids(categories, 'category');
  ids(tags, 'tag');
  ids(items, 'item');
  const personIds = ids(people, 'person');

  for (const it of items) {
    amount(it.price, 'items');
    if (!catIds.has(it.categoryId)) fail(`item "${it.name}" has an unknown category`);
  }

  let expenses = 0;
  for (const key of Object.keys(d)) {
    if (!key.startsWith('spend:')) continue;
    if (!/^spend:\d{4}-\d{2}$/.test(key)) fail(`bad key ${key}`);
    if (!Array.isArray(d[key])) fail(`${key} is not a list`);
    for (const e of d[key]) {
      if (!e || typeof e.id !== 'string' || typeof e.name !== 'string') fail(`bad expense in ${key}`);
      amount(e.amount, key);
      stamp(e.ts, key);
      if (monthKey(e.ts) !== key.slice('spend:'.length)) fail(`expense in the wrong month in ${key}`);
      if (!catIds.has(e.categoryId)) fail(`expense "${e.name}" has an unknown category`);
      if (!Number.isInteger(e.qty) || e.qty < 1) fail(`bad quantity in ${key}`);
      if (!Array.isArray(e.tagIds)) fail(`bad tags in ${key}`);
      expenses++;
    }
  }

  for (const l of ledger) {
    amount(l.amount, 'ledger', 1);
    stamp(l.ts, 'ledger');
    if (!personIds.has(l.personId)) fail('ledger entry for an unknown person');
    if (!KINDS.includes(l.kind)) fail('unknown ledger kind');
  }
  for (const b of budgets) amount(b.limit, 'budgets', 1);

  return { counts: { expenses, items: items.length, people: people.length, ledger: ledger.length, budgets: budgets.length } };
}

// ============================================================
//  backup reminder
// ============================================================
export const BACKUP_REMIND_DAYS = 14;

export function daysSinceBackup(meta, now) {
  return meta.lastBackupAt ? dayDiff(dayKey(meta.lastBackupAt), dayKey(now)) : null;
}

export function backupDue(meta, now, hasData) {
  if (!hasData) return false;
  const days = daysSinceBackup(meta, now);
  return days === null || days > BACKUP_REMIND_DAYS;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/export.test.js`. Expected: PASS, 7 tests.

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 2: store.js — importRaw + markBackedUp

**Files:**
- Modify: `expense-tracker/js/store.js`, `expense-tracker/tests/store.test.js`

**Interfaces:**
- Consumes: `validateBackup` (`export.js`).
- Produces (serialized):
  - `importRaw(dump)`: validate, then replace all keys, then boot. Rejects without side effects on an invalid dump.
  - `markBackedUp()`: sets `meta.lastBackupAt = now()`.

- [ ] **Step 1: Append the failing tests** to the end of `tests/store.test.js`

```js
// ---------- backup / restore (plan 5) ----------
test("importRaw restores another store's export, marks everything dirty, keeps this device's drive state", async () => {
  const { store: a } = await fresh();
  const item = await a.saveItem({ name: 'Chai', price: 1500, categoryId: catId(a, 'Food') });
  await a.logItem(item, { ts: '2026-09-15T08:00' });
  const p = await a.savePerson({ name: 'Puru' });
  await a.addLedger({ personId: p.id, kind: 'lent', amount: 50000 });
  const dump = await a.exportRaw();

  const { store: b, kv: kvB } = await fresh();
  await kvB.set('meta', { ...b.state.meta, drive: { connected: true, folderId: 'F', fileIds: {} } });
  await b.boot();
  await b.logSpend({ name: 'Will be replaced', categoryId: catId(b, 'Food'), amount: 100 });
  await b.importRaw(dump);

  assert.deepEqual(b.state.items.map((i) => i.name), ['Chai']);
  assert.deepEqual((await kvB.get('spend:2026-09')).map((e) => e.name), ['Chai']);
  assert.equal(await kvB.get('spend:2026-10'), null);
  assert.equal(b.state.ledger.length, 1);
  assert.deepEqual(b.state.meta.dirtyMonths, ['2026-09']);
  assert.equal(b.state.meta.dirtyPeople, true);
  assert.equal(b.state.meta.drive.folderId, 'F');
  assert.equal(b.state.meta.lastBackupAt, '2026-10-04T10:00');
});

test('importRaw rejects an invalid backup and changes nothing', async () => {
  const { store } = await fresh();
  await store.logSpend({ name: 'Keep me', categoryId: catId(store, 'Food'), amount: 100 });
  const before = await store.exportRaw();
  await assert.rejects(store.importRaw({ app: 'expense-tracker', schemaVersion: 1, data: { meta: {}, categories: [] } }), /Not a valid backup/);
  assert.deepEqual(await store.exportRaw(), before);
  assert.equal(store.monthEntries('2026-10').length, 1);
});

test('markBackedUp records the time and survives a reload', async () => {
  const { store, kv } = await fresh();
  await store.markBackedUp();
  const { store: again } = await fresh('2026-10-05T09:00', kv);
  assert.equal(again.state.meta.lastBackupAt, '2026-10-04T10:00');
});
```

- [ ] **Step 2: Run it and confirm the new tests fail**

Run: `node --test tests/store.test.js`. Expected: 26 pass and 3 fail (`importRaw is not a function` / `markBackedUp is not a function`).

- [ ] **Step 3: Modify `js/store.js`.** Make three edits.

**3a.** Replace:
```js
import { SCOPES, PERIODS } from './budgets.js';
```
with:
```js
import { SCOPES, PERIODS } from './budgets.js';
import { validateBackup } from './export.js';
```

**3b.** Insert immediately **after** the `wipe` function (its closing `  }` comes right after the `await boot();` that follows the `kv.del` loop), so the new code sits right before the `// every public mutator runs one at a time…` comment:
```js

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
```

**3c.** In the returned object, replace:
```js
    wipe: serial(wipe),
```
with:
```js
    wipe: serial(wipe),
    importRaw: serial(importRaw),
    markBackedUp: serial(markBackedUp),
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/store.test.js`. Expected: PASS, 29 tests.
Run: `node --test`. Expected: PASS, 86 tests (money 6, dates 8, frecency 7, store 29, ledger 9, report-data 13, budgets 7, export 7).

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 3: Settings backup section, restore flow, reminder dot

**Files:**
- Create: `js/backup-files.js`
- Modify: `js/settings.js`, `js/app.js`, `sw.js`, `style.css`

**Interfaces:**
- Consumes:
  - Tasks 1–2
  - `store` (ctx)
  - `todayKey`, `nowTs`, `monthKey`, `addMonths` (dates)
  - `SCHEMA_VERSION` (store.js)
- Produces:
  - `backup-files.js`:
    - `buildSummary() → Promise<string>`
    - `buildMonthCsv(mk) → Promise<string>`
    - `buildPeopleCsv() → string`
    - `hasData() → boolean`
    - `currentCounts() → Promise<counts|null>`
  - These are reused by Plan 6 (Drive).

- [ ] **Step 1: Create `js/backup-files.js`**

```js
// backup-files — turns store data into the exported files. shared by Settings downloads
// now and the Google Drive backup later, so both always produce identical files.
import { store } from './ctx.js';
import { SCHEMA_VERSION } from './store.js';
import { nowTs, todayKey, monthKey, addMonths } from './dates.js';
import { summaryMd, spendCsv, peopleCsv, validateBackup } from './export.js';

export async function buildSummary() {
  const today = todayKey();
  const entries = await store.loadRange(`${addMonths(monthKey(today), -5)}-01`, today); // 6 months (covers last month too)
  const s = store.state;
  return summaryMd({
    now: nowTs(), entries, categories: s.categories, items: s.items, tags: s.tags,
    people: s.people, ledger: s.ledger, budgets: s.budgets,
  });
}

export async function buildMonthCsv(mk) {
  return spendCsv(await store.ensureMonth(mk), store.state);
}

export const buildPeopleCsv = () => peopleCsv(store.state.people, store.state.ledger);

// anything worth backing up? (keeps the reminder dot off a brand-new app)
export const hasData = () =>
  store.state.items.length > 0 || store.state.ledger.length > 0 || store.loadedEntries().length > 0;

// counts of what is on this phone right now, in the same shape as validateBackup()
export async function currentCounts() {
  try { return validateBackup(await store.exportRaw(), SCHEMA_VERSION).counts; } catch { return null; }
}
```

- [ ] **Step 2: `js/settings.js`.**

**2a.** Replace the imports:
```js
import { formatINR } from './money.js';
import { todayKey } from './dates.js';
```
with:
```js
import { formatINR } from './money.js';
import { todayKey, nowTs, monthKey } from './dates.js';
import { SCHEMA_VERSION } from './store.js';
import { validateBackup, daysSinceBackup, backupDue } from './export.js';
import { buildSummary, buildMonthCsv, hasData, currentCounts } from './backup-files.js';
```

**2b.** Replace:
```js
      backupSection(),
```
with:
```js
      backupSection(close),
```

**2c.** Replace the whole `backupSection` and `downloadJson` functions, from `function backupSection() {` up to (not including) the `// two-tap erase (no confirm() dialogs)` comment, with:
```js
function backupSection(closeSettings) {
  const days = daysSinceBackup(store.state.meta, nowTs());
  const last = days === null ? 'never' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  const due = backupDue(store.state.meta, nowTs(), hasData());
  return el('div', { class: 'settings-section' },
    el('div', { class: 'settings-section-title' }, 'backup'),
    el('div', { class: 'settings-info' + (due ? ' warn-text' : '') }, `last backup: ${last}`),
    el('div', { class: 'settings-btn-row' },
      el('button', { class: 'btn-ghost', onClick: downloadJson }, 'backup (json)'),
      el('button', { class: 'btn-ghost', onClick: () => pickRestore(closeSettings) }, 'restore'),
    ),
    el('div', { class: 'settings-btn-row' },
      el('button', { class: 'btn-ghost', onClick: downloadSummary }, 'summary.md'),
      el('button', { class: 'btn-ghost', onClick: downloadMonthCsv }, 'this month (csv)'),
    ),
    el('div', { class: 'settings-info' },
      'json = full copy you can restore. summary.md + csv = readable reports (for you, excel, or claude). google drive auto-backup comes next.'),
  );
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadJson() {
  try {
    const dump = await store.exportRaw();
    download(`kharchly-backup-${dump.exportedAt.slice(0, 10)}.json`, JSON.stringify(dump, null, 2), 'application/json');
    await store.markBackedUp();
    rerender();
    toast('backup downloaded', 'success');
  } catch (e) { toast(`backup failed: ${e.message}`, 'error'); }
}

async function downloadSummary() {
  try {
    download(`kharchly-summary-${todayKey()}.md`, await buildSummary(), 'text/markdown');
  } catch (e) { toast(`summary failed: ${e.message}`, 'error'); }
}

async function downloadMonthCsv() {
  try {
    const mk = monthKey(todayKey());
    download(`spend-${mk}.csv`, await buildMonthCsv(mk), 'text/csv');
  } catch (e) { toast(`csv failed: ${e.message}`, 'error'); }
}

// restore: pick file -> parse -> validate -> confirm with counts -> replace everything
function pickRestore(closeSettings) {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    try {
      let dump;
      try { dump = JSON.parse(await file.text()); } catch { throw new Error('Not a valid backup: not a JSON file'); }
      const { counts } = validateBackup(dump, SCHEMA_VERSION);
      closeSettings();
      confirmRestore(dump, counts, await currentCounts());
    } catch (e) { toast(e.message, 'error'); }
  });
  document.body.appendChild(input);
  input.click();
}

const describe = (c) => (c
  ? `${c.expenses} expenses · ${c.items} items · ${c.people} people · ${c.budgets} budgets`
  : 'unknown');

function confirmRestore(dump, incoming, current) {
  openModal('restore backup', (body, close) => {
    let armed = false;
    const go = el('button', {
      class: 'btn-danger-ghost',
      onClick: async () => {
        if (!armed) {
          armed = true;
          go.textContent = 'tap again to replace everything';
          return;
        }
        try {
          await store.importRaw(dump);
          view.day = todayKey();
          view.chip = 'all';
          view.search = '';
          close();
          rerender();
          toast('backup restored', 'success');
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'replace everything');
    body.append(
      el('div', { class: 'settings-info' }, `backup from ${String(dump.exportedAt || '?').replace('T', ' ')}`),
      el('div', { class: 'settings-info' }, `in the backup: ${describe(incoming)}`),
      el('div', { class: 'settings-info' }, `on this phone now: ${describe(current)}`),
      el('div', { class: 'settings-info warn-text' }, 'restoring replaces everything on this phone with the backup.'),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', onClick: close }, 'cancel'),
        go,
      ),
    );
  });
}

```

- [ ] **Step 3: `js/app.js`.** Add under `import { openSettings } from './settings.js';`:
```js
import { backupDue } from './export.js';
import { hasData } from './backup-files.js';
import { nowTs } from './dates.js';
```
Then replace:
```js
      el('button', { class: 'icon-btn', 'aria-label': 'Settings', onClick: openSettings }, icon('settings', 16)),
```
with:
```js
      el('button', {
        // dot = backup due (never backed up, or more than 14 days ago, once there is data)
        class: 'icon-btn' + (backupDue(store.state.meta, nowTs(), hasData()) ? ' has-dot' : ''),
        'aria-label': 'Settings',
        onClick: openSettings,
      }, icon('settings', 16)),
```

- [ ] **Step 4: `sw.js`.** Replace `const CACHE_NAME = 'kharchly-v6';` with `const CACHE_NAME = 'kharchly-v7';`. In `ASSETS`, after `  './js/budget-view.js',` add:
```js
  './js/export.js',
  './js/backup-files.js',
```

- [ ] **Step 5: Append styles** to the end of `style.css`, using the Edit tool:

```css

/* ========== kharchly: backup ========== */
.icon-btn.has-dot { position: relative; }
.icon-btn.has-dot::after {
  content: ''; position: absolute; top: 4px; right: 4px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--warn);
}
.warn-text { color: var(--warn); }
```

- [ ] **Step 6: Syntax check and suite**

Run: `node --check js/backup-files.js && node --check js/settings.js && node --check js/app.js && node --check sw.js`. Expected: no output.
Check that every `js/*.js` file appears in `sw.js` ASSETS (20 files).
Run: `node --test`. Expected: PASS, 86 tests.

- [ ] **Step 7: Manual check (the user, on kharchly.netlify.app after deploy)**
  1. **The reminder dot** appears on the settings icon, because you have data and have never backed up. Settings shows "last backup: never" in the warn colour (Review Focus 5).
  2. **backup (json)** downloads `kharchly-backup-YYYY-MM-DD.json`. Expected: the dot disappears and it shows "last backup: today".
  3. **summary.md** downloads, opens as readable text, and is about 1–2 KB:
     - this month vs last month (same days)
     - 6 months
     - budgets
     - people
     - a file guide
  4. **this month (csv)** opens in Excel / Google Sheets with the right columns. A note containing a comma or quotes stays in one cell (Review Focus 2).
  5. **Restore a wrong file** (e.g. macro's backup, or any other JSON). Expected: an error toast with a reason, and **nothing changes** (Review Focus 1).
  6. **Restore the real backup:** the confirm screen shows the counts for the backup and for this phone. The first tap arms it, the second restores. Expected: data identical to when the backup was taken.
  7. **Round trip:** log one spend, then restore the earlier backup. Expected: that spend is gone, which proves the restore replaced everything.

- [ ] **Step 8: Checkpoint** for the user to commit. Pushing deploys.
