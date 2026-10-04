# Expense Tracker — Plan 2: People (lend / borrow)

> **For agentic workers:** Execute Tasks 1–3 in order, in one pass (no per-task reviewer). Use superpowers:executing-plans when running it inside Claude. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The People tab: record money lent to and borrowed from people, see who owes whom, see each person's history with a running balance, and settle up in one tap.

**Architecture:**
- A new pure module `ledger.js` holds all sign and balance maths. It's unit-tested.
- `store.js` gains `people` and `ledger` keys, with the same rules as Plan 1: validate, then write, then update state, with serialized mutators.
- `people.js` is the tab UI. `fields.js` gains a person picker and a kind picker. The category picker is refactored onto a shared "select with inline create" field, so category and person pickers share one implementation.

**Tech Stack:** As Plan 1: vanilla ES modules, IndexedDB, `node --test`. Zero npm dependencies.

**Spec:** `expense-tracker/docs/spec.md`, §4 (`people`, `ledger` keys), §4.2 (sign table), §5.2 (People tab). This builds on Plan 1 (`plan-1-foundation-spend.md`), which is already implemented.

## Global Constraints

- The stored ledger `amount` is always a **positive** integer in paise. The sign comes **only** from `signOf(kind)` in `ledger.js`.
- `balance > 0` means **they owe me**. `balance < 0` means **I owe them**.
- Ledger entries **never** count as spending. They never touch `spend:*` keys, spend totals or budgets.
- `ts` format is local `YYYY-MM-DDTHH:mm`. `js/store.js` is the only module that touches `kv`.
- UI: lower-case copy, IBM Plex Mono numbers, bottom-sheet modals. No `alert` / `confirm` / `prompt`.
- **Do not run builds. Do not run git write commands** (add / commit / stash / reset / checkout). The user commits.
- Tests run from `expense-tracker/`: `node --test` (full suite) or `node --test tests/<file>`. Per the repo `CLAUDE.md`, when run from the main Claude session, delegate test runs to a background subagent.

## Review Focus

1. **Over-repayment.** Lent ₹500, they pay back ₹700. The balance must flip to "you owe them ₹200", never show a negative "owes you". Test: `ledger.test.js` "over-repayment flips the balance".
2. **Same-minute entries.** Two entries with the same `ts` must keep the order they were entered in, or the running balance in history reads wrong. Test: `ledger.test.js` "history keeps entry order for identical timestamps".
3. **Archived person who still owes money.** They must stay visible in the main list until settled. Archiving only hides them from the person picker. Covered in Task 3 (`renderPeople` lists every non-zero balance regardless of `archived`) and its manual check.
4. **Lending leaking into spend.** A ledger write must not touch any `spend:*` month or the spend totals. Test: `store.test.js` "ledger writes never touch spend months".
5. **Delete then undo from inside a person's history.** The person modal would show stale data after an undo. By design, delete closes the person modal and returns to the tab; undo then re-renders the tab. Covered in Task 3 (`openLedgerModal` delete path) and its manual check.

---

## File map

| File | Change | Task |
|---|---|---|
| `js/ledger.js` | **create**: KINDS, labels, signOf, balances, totals, history, settlement | 1 |
| `tests/ledger.test.js` | **create** | 1 |
| `js/store.js` | **modify**: people + ledger state, boot, mutators, serialized exports | 2 |
| `tests/store.test.js` | **modify**: append 6 tests | 2 |
| `js/fields.js` | **modify**: generic `namedSelectField`, `categoryField` rewritten on it, new `personField`, `kindField` | 3 |
| `js/people.js` | **create**: People tab, person modal, ledger entry modal | 3 |
| `js/ctx.js` | **modify**: `view.showSettled` | 3 |
| `js/app.js` | **modify**: render the People tab | 3 |
| `sw.js` | **modify**: precache the 2 new modules, bump the cache name | 3 |
| `style.css` | **modify**: append people styles | 3 |

---

### Task 1: ledger.js (pure maths)

**Files:**
- Create: `expense-tracker/js/ledger.js`
- Test: `expense-tracker/tests/ledger.test.js`

**Interfaces:**
- Produces:
  - `KINDS: ['lent','borrowed','repaid_to_me','repaid_by_me']`
  - `KIND_LABELS: Record<kind,string>`
  - `signOf(kind): 1|-1` (throws on an unknown kind)
  - `balanceOf(entries, personId): number`
  - `balances(people, entries): {person, balance}[]` (same order as `people`)
  - `totals(rows): {owedToMe, iOwe}` (both ≥ 0)
  - `history(entries, personId): (Entry & {balanceAfter})[]` (oldest → newest)
  - `settlement(balance): {kind, amount} | null`

- [ ] **Step 1: Write the failing test** at `tests/ledger.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, signOf, balanceOf, balances, totals, history, settlement } from '../js/ledger.js';

let n = 0;
const entry = (personId, kind, amount, ts = '2026-10-04T10:00') => ({ id: `e${++n}`, personId, kind, amount, ts, note: '' });

test('signOf follows the spec table; unknown kinds throw', () => {
  assert.deepEqual(KINDS, ['lent', 'borrowed', 'repaid_to_me', 'repaid_by_me']);
  assert.equal(signOf('lent'), 1);
  assert.equal(signOf('borrowed'), -1);
  assert.equal(signOf('repaid_to_me'), -1);
  assert.equal(signOf('repaid_by_me'), 1);
  assert.throws(() => signOf('gift'), /Unknown kind/);
});

test('partial repayment leaves the rest owed', () => {
  const es = [entry('puru', 'lent', 100000), entry('puru', 'repaid_to_me', 40000)];
  assert.equal(balanceOf(es, 'puru'), 60000);
});

test('lend and borrow with the same person net out', () => {
  const es = [entry('amit', 'lent', 100000), entry('amit', 'borrowed', 150000)];
  assert.equal(balanceOf(es, 'amit'), -50000); // I owe Amit 500
  const es2 = [...es, entry('amit', 'repaid_by_me', 50000)];
  assert.equal(balanceOf(es2, 'amit'), 0);
});

test('over-repayment flips the balance', () => {
  const es = [entry('rahul', 'lent', 50000), entry('rahul', 'repaid_to_me', 70000)];
  assert.equal(balanceOf(es, 'rahul'), -20000);
  assert.deepEqual(settlement(-20000), { kind: 'repaid_by_me', amount: 20000 });
});

test('balances: one row per person in input order, zero when no entries, unknown persons ignored', () => {
  const people = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const rows = balances(people, [entry('a', 'lent', 500), entry('ghost', 'lent', 999)]);
  assert.deepEqual(rows.map((r) => [r.person.id, r.balance]), [['a', 500], ['b', 0]]);
});

test('totals split owed-to-me and I-owe, both positive', () => {
  const rows = [{ balance: 1600 }, { balance: 1000 }, { balance: -500 }, { balance: 0 }];
  assert.deepEqual(totals(rows), { owedToMe: 2600, iOwe: 500 });
});

test('history is oldest-first with a running balance', () => {
  const es = [
    entry('p', 'repaid_to_me', 400, '2026-10-03T09:00'),
    entry('p', 'lent', 1000, '2026-10-01T09:00'),
    entry('q', 'lent', 9999, '2026-10-02T09:00'),
  ];
  const h = history(es, 'p');
  assert.deepEqual(h.map((e) => [e.kind, e.balanceAfter]), [['lent', 1000], ['repaid_to_me', 600]]);
});

test('history keeps entry order for identical timestamps', () => {
  const es = [entry('p', 'lent', 1000, '2026-10-01T09:00'), entry('p', 'repaid_to_me', 1000, '2026-10-01T09:00')];
  assert.deepEqual(history(es, 'p').map((e) => e.balanceAfter), [1000, 0]);
});

test('settlement prefills the right repayment', () => {
  assert.deepEqual(settlement(160000), { kind: 'repaid_to_me', amount: 160000 });
  assert.deepEqual(settlement(-50000), { kind: 'repaid_by_me', amount: 50000 });
  assert.equal(settlement(0), null);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/ledger.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `js/ledger.js`

```js
// ledger — lend/borrow maths. pure: no DOM, no storage.
// the stored amount is ALWAYS positive; the sign comes ONLY from signOf(kind).
// balance > 0: they owe me.  balance < 0: I owe them.
export const KINDS = ['lent', 'borrowed', 'repaid_to_me', 'repaid_by_me'];

export const KIND_LABELS = {
  lent: 'lent',
  borrowed: 'borrowed',
  repaid_to_me: 'they repaid',
  repaid_by_me: 'i repaid',
};

const SIGN = { lent: 1, borrowed: -1, repaid_to_me: -1, repaid_by_me: 1 };

export function signOf(kind) {
  const s = SIGN[kind];
  if (!s) throw new Error(`Unknown kind: ${kind}`);
  return s;
}

export function balanceOf(entries, personId) {
  let b = 0;
  for (const e of entries) if (e.personId === personId) b += signOf(e.kind) * e.amount;
  return b;
}

export function balances(people, entries) {
  const sums = new Map(people.map((p) => [p.id, 0]));
  for (const e of entries) {
    if (sums.has(e.personId)) sums.set(e.personId, sums.get(e.personId) + signOf(e.kind) * e.amount);
  }
  return people.map((p) => ({ person: p, balance: sums.get(p.id) }));
}

export function totals(rows) {
  let owedToMe = 0;
  let iOwe = 0;
  for (const { balance } of rows) {
    if (balance > 0) owedToMe += balance;
    else iOwe -= balance;
  }
  return { owedToMe, iOwe };
}

// oldest -> newest; equal timestamps keep their stored (entry) order
export function history(entries, personId) {
  const mine = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.personId === personId)
    .sort((a, b) => a.e.ts.localeCompare(b.e.ts) || a.i - b.i);
  let running = 0;
  return mine.map(({ e }) => {
    running += signOf(e.kind) * e.amount;
    return { ...e, balanceAfter: running };
  });
}

// the entry that would bring this balance to zero
export function settlement(balance) {
  if (balance > 0) return { kind: 'repaid_to_me', amount: balance };
  if (balance < 0) return { kind: 'repaid_by_me', amount: -balance };
  return null;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/ledger.test.js`. Expected: PASS, 9 tests.

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 2: store.js — people + ledger

**Files:**
- Modify: `expense-tracker/js/store.js`
- Modify: `expense-tracker/tests/store.test.js` (append)

**Interfaces:**
- Consumes: `KINDS` from `ledger.js`.
- Produces (new store methods; the mutators are serialized):
  - `state.people: Person[]`, `state.ledger: LedgerEntry[]`
  - `savePerson({id?, name, archived?}) → Person`
  - `deletePerson(id)`
  - `addLedger({personId, kind, amount, ts?, note?}) → LedgerEntry`
  - `updateLedger(entry, patch) → LedgerEntry`
  - `deleteLedger(entry)`
  - `restoreLedger(entry)`
- Every ledger or people write sets `meta.dirtyPeople = true`.

- [ ] **Step 1: Append the failing tests** to the end of `tests/store.test.js`. The file already defines `memKv`, `fresh` and `catId`.

```js
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
```

- [ ] **Step 2: Run it and confirm the new tests fail**

Run: `node --test tests/store.test.js`. Expected: the 16 existing tests PASS and the 6 new ones FAIL (`savePerson is not a function` / `state.people` undefined).

- [ ] **Step 3: Modify `js/store.js`.** Make five edits.

**3a.** Imports and keys. Replace:
```js
import { nowTs, monthKey, dayKey, addMonths } from './dates.js';
```
with:
```js
import { nowTs, monthKey, dayKey, addMonths } from './dates.js';
import { KINDS } from './ledger.js';
```
Then replace:
```js
const K = { categories: 'categories', tags: 'tags', items: 'items', meta: 'meta', month: (mk) => `spend:${mk}` };
```
with:
```js
const K = {
  categories: 'categories', tags: 'tags', items: 'items', meta: 'meta',
  people: 'people', ledger: 'ledger',
  month: (mk) => `spend:${mk}`,
};
```

**3b.** State. Replace:
```js
  const state = { categories: [], tags: [], items: [], meta: defaultMeta(), months: new Map() };
```
with:
```js
  const state = { categories: [], tags: [], items: [], people: [], ledger: [], meta: defaultMeta(), months: new Map() };
```

**3c.** Boot. Replace:
```js
    state.items = (await kv.get(K.items)) || [];
```
with:
```js
    state.items = (await kv.get(K.items)) || [];
    state.people = (await kv.get(K.people)) || [];
    state.ledger = (await kv.get(K.ledger)) || [];
```

**3d.** New functions. Insert this block immediately **before** the line `  // ---------- reads ----------`:
```js
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

```

**3e.** Exports. In the returned object, replace:
```js
    restoreSpend: serial(restoreSpend),
```
with:
```js
    restoreSpend: serial(restoreSpend),
    savePerson: serial(savePerson),
    deletePerson: serial(deletePerson),
    addLedger: serial(addLedger),
    updateLedger: serial(updateLedger),
    deleteLedger: serial(deleteLedger),
    restoreLedger: serial(restoreLedger),
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/store.test.js`. Expected: PASS, 22 tests.
Run: `node --test`. Expected: PASS, 51 tests (money 6, dates 7, frecency 7, store 22, ledger 9).

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 3: People tab UI

**Files:**
- Modify: `js/fields.js`, `js/ctx.js`, `js/app.js`, `sw.js`, `style.css`
- Create: `js/people.js`

**Interfaces:**
- Consumes:
  - Task 2 store methods
  - from `ledger.js`: `KINDS`, `KIND_LABELS`, `signOf`, `balances`, `totals`, `history`, `settlement`
  - from Plan 1: `amountField`, `noteField`, `dateTimeFields`, `el`, `openModal`, `toast`, `icon`, `formatINR`, `nowTs`, `dayKey`, `timeOf`, `formatDayLabel`
- Produces:
  - `fields.js`:
    - `namedSelectField({label, newLabel, getList, create, selectedId, onChange}) → Node`
    - `categoryField(selectedId, onChange)` (same signature as before)
    - `personField(selectedId, onChange) → Node`
    - `kindField(kind, onChange) → Node`
  - `people.js`:
    - `renderPeople() → HTMLElement`
    - `openPersonModal(personId)`
    - `openLedgerModal({entry?, personId?, kind?, amount?, back?})`

- [ ] **Step 1: `js/fields.js`**

Replace the whole `categoryField` function (from `// category <select> with an inline "+ new category"` through its closing `}`) with:

```js
// <select> over a named list + an inline "+ new …" row that creates the record on the spot.
// archived records are hidden unless currently selected.
export function namedSelectField({ label, newLabel, getList, create, selectedId, onChange }) {
  let current = selectedId || '';
  const select = el('select', { class: 'input' });
  const newInput = el('input', { class: 'input', type: 'text', placeholder: `${newLabel} name`, maxlength: '40' });
  const newRow = el('div', { class: 'inline-new', hidden: true });

  const fill = () => {
    select.innerHTML = '';
    select.appendChild(el('option', { value: '' }, 'pick one…'));
    for (const r of getList()) {
      if (r.archived && r.id !== current) continue;
      select.appendChild(el('option', { value: r.id }, r.name));
    }
    select.appendChild(el('option', { value: '__new' }, `+ ${newLabel}`));
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
        const r = await create(newInput.value);
        current = r.id;
        fill();
        onChange(current);
        newInput.value = '';
        newRow.hidden = true;
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'add'));

  fill();
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, label), select, newRow);
}

export function categoryField(selectedId, onChange) {
  return namedSelectField({
    label: 'category',
    newLabel: 'new category',
    getList: () => store.state.categories,
    create: (name) => store.saveCategory({ name }),
    selectedId,
    onChange,
  });
}

export function personField(selectedId, onChange) {
  return namedSelectField({
    label: 'person',
    newLabel: 'new person',
    getList: () => [...store.state.people].sort((a, b) => a.name.localeCompare(b.name)),
    create: (name) => store.savePerson({ name }),
    selectedId,
    onChange,
  });
}

// one-of-four chips: lent / borrowed / they repaid / i repaid
export function kindField(kind, onChange) {
  const row = el('div', { class: 'chips kind-chips' });
  const draw = () => {
    row.replaceChildren(...KINDS.map((k) => el('button', {
      type: 'button',
      class: 'chip' + (k === kind ? ' active' : ''),
      onClick: () => { kind = k; onChange(k); draw(); },
    }, KIND_LABELS[k])));
  };
  draw();
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'what happened'), row);
}
```

Add this import line under the existing imports at the top of `fields.js`:
```js
import { KINDS, KIND_LABELS } from './ledger.js';
```

- [ ] **Step 2: `js/ctx.js`.** In `view`, replace:
```js
  chip: 'all',       // 'all' | categoryId
```
with:
```js
  chip: 'all',       // 'all' | categoryId
  showSettled: false, // people tab: expand the settled list
```

- [ ] **Step 3: Create `js/people.js`**

```js
// people tab — who owes whom, each person's history with a running balance, one-tap settle.
// all sign/balance maths lives in ledger.js; this file only draws it.
import { el, icon, toast, openModal } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { formatINR } from './money.js';
import { nowTs, dayKey, timeOf, formatDayLabel } from './dates.js';
import { KIND_LABELS, signOf, balances, totals, history, settlement } from './ledger.js';
import { amountField, noteField, dateTimeFields, personField, kindField } from './fields.js';

const byName = (a, b) => a.person.name.localeCompare(b.person.name);

function balanceLine(balance) {
  if (balance > 0) return `owes you ${formatINR(balance)}`;
  if (balance < 0) return `you owe ${formatINR(-balance)}`;
  return 'settled';
}

// ============================================================
//  tab
// ============================================================
export function renderPeople() {
  const rows = balances(store.state.people, store.state.ledger);
  const { owedToMe, iOwe } = totals(rows);
  // archived people with money outstanding stay visible until settled
  const open = rows.filter((r) => r.balance !== 0)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || byName(a, b));
  const settled = rows.filter((r) => r.balance === 0).sort(byName);

  const pad = el('div', { class: 'view-pad' },
    el('div', { class: 'totals-card' },
      el('div', { class: 'spend-totals' },
        el('div', {},
          el('div', { class: 'metric-label' }, 'owed to you'),
          el('div', { class: 'big-num' }, formatINR(owedToMe))),
        el('div', { class: 'spend-totals-month' },
          el('div', { class: 'metric-label' }, 'you owe'),
          el('div', { class: 'med-num' }, formatINR(iOwe))),
      ),
    ),
  );

  if (!rows.length) {
    pad.appendChild(el('div', { class: 'empty' },
      el('div', { class: 'empty-text' }, 'no one yet — tap + to record money you lent or borrowed')));
  }
  for (const r of open) pad.appendChild(personRow(r));

  if (settled.length) {
    pad.appendChild(el('button', {
      class: 'link-btn settled-toggle',
      onClick: () => { view.showSettled = !view.showSettled; rerender(); },
    }, `${view.showSettled ? '▾' : '▸'} settled (${settled.length})`));
    if (view.showSettled) for (const r of settled) pad.appendChild(personRow(r));
  }

  pad.appendChild(el('button', { class: 'fab', 'aria-label': 'Add', onClick: () => openLedgerModal() }, icon('plus', 22)));
  return pad;
}

function personRow({ person, balance }) {
  const tone = balance > 0 ? ' pos' : balance < 0 ? ' neg' : '';
  return el('button', { class: 'person-row', onClick: () => openPersonModal(person.id) },
    el('span', { class: 'person-name' }, person.name, person.archived ? el('span', { class: 'log-meta' }, ' · archived') : null),
    el('span', { class: 'person-balance' + tone }, balanceLine(balance)),
  );
}

// ============================================================
//  person modal: balance, settle, history, rename/archive
// ============================================================
export function openPersonModal(personId) {
  const person = store.state.people.find((p) => p.id === personId);
  if (!person) return;
  openModal(person.name, (body, close) => {
    const rows = history(store.state.ledger, personId);
    const balance = rows.length ? rows[rows.length - 1].balanceAfter : 0;
    const settle = settlement(balance);

    body.append(el('div', { class: 'person-summary' },
      el('div', { class: 'metric-label' }, balance > 0 ? `${person.name} owes you` : balance < 0 ? `you owe ${person.name}` : 'all settled'),
      el('div', { class: 'big-num' }, formatINR(Math.abs(balance))),
    ));

    const actions = el('div', { class: 'modal-actions' });
    if (settle) {
      actions.append(el('button', {
        class: 'btn-primary',
        onClick: () => { close(); openLedgerModal({ personId, ...settle, back: personId }); },
      }, `settle ${formatINR(settle.amount)}`));
    }
    actions.append(el('button', {
      class: 'btn-ghost',
      onClick: () => { close(); openLedgerModal({ personId, back: personId }); },
    }, 'add entry'));
    body.append(actions);

    body.append(el('div', { class: 'section-label' }, 'history'));
    if (!rows.length) body.append(el('div', { class: 'hint' }, 'no entries yet'));
    for (const r of rows) {
      body.append(el('button', {
        class: 'log-row ledger-row',
        onClick: () => { close(); openLedgerModal({ entry: r, back: personId }); },
      },
        el('div', { class: 'log-main' },
          el('div', { class: 'log-name' }, KIND_LABELS[r.kind]),
          el('div', { class: 'log-meta' }, `${formatDayLabel(dayKey(r.ts)).toLowerCase()} ${timeOf(r.ts)}${r.note ? ' · ' + r.note : ''}`),
        ),
        el('div', { class: 'ledger-nums' },
          el('div', { class: 'log-amount' }, `${signOf(r.kind) > 0 ? '+' : '−'}${formatINR(r.amount)}`),
          el('div', { class: 'log-meta' }, `bal ${formatINR(r.balanceAfter)}`),
        ),
      ));
    }

    body.append(manageSection(person, rows.length > 0, close));
  });
}

function manageSection(person, hasEntries, close) {
  const nameInput = el('input', { class: 'input', type: 'text', value: person.name, maxlength: '40' });
  const reopen = () => { close(); rerender(); openPersonModal(person.id); };
  return el('div', { class: 'settings-section' },
    el('div', { class: 'settings-section-title' }, 'person'),
    el('div', { class: 'settings-list-row' },
      nameInput,
      el('button', {
        class: 'btn-ghost',
        onClick: async () => {
          try { await store.savePerson({ ...person, name: nameInput.value }); reopen(); } catch (e) { toast(e.message, 'error'); }
        },
      }, 'rename'),
    ),
    el('button', {
      class: 'btn-danger-ghost',
      style: { width: '100%' },
      onClick: async () => {
        try {
          if (hasEntries) {
            await store.savePerson({ ...person, archived: !person.archived });
            toast(person.archived ? `${person.name} unarchived` : `${person.name} archived — hidden from the picker`, 'success');
            reopen();
          } else {
            await store.deletePerson(person.id);
            close();
            rerender();
            toast(`${person.name} deleted`, 'success');
          }
        } catch (e) { toast(e.message, 'error'); }
      },
    }, hasEntries ? (person.archived ? 'unarchive' : 'archive') : 'delete'),
  );
}

// ============================================================
//  add / edit a ledger entry. `back` = person modal to return to after saving.
// ============================================================
export function openLedgerModal({ entry = null, personId = '', kind = 'lent', amount = null, back = null } = {}) {
  openModal(entry ? 'edit entry' : 'lend / borrow', (body, close) => {
    const f = {
      personId: entry?.personId ?? personId,
      kind: entry?.kind ?? kind,
      amount: entry?.amount ?? amount,
      ts: entry?.ts ?? nowTs(),
      note: entry?.note ?? '',
    };
    const finish = (reopenPerson) => {
      close();
      rerender();
      if (reopenPerson && back) openPersonModal(back);
    };

    body.append(
      personField(f.personId, (v) => { f.personId = v; }),
      kindField(f.kind, (v) => { f.kind = v; }),
      amountField(f.amount, (v) => { f.amount = v; }).node,
      dateTimeFields(f.ts, (v) => { f.ts = v; }),
      noteField(f.note, (v) => { f.note = v; }),
    );

    const actions = el('div', { class: 'modal-actions' });
    if (entry) {
      // delete returns to the tab (not the person modal) so undo never leaves a stale modal open
      actions.append(el('button', {
        class: 'btn-danger-ghost',
        onClick: async () => {
          try {
            await store.deleteLedger(entry);
            finish(false);
            toast('entry deleted', '', {
              label: 'undo',
              onClick: async () => {
                try { await store.restoreLedger(entry); rerender(); } catch (e) { toast(`undo failed: ${e.message}`, 'error'); }
              },
            });
          } catch (e) { toast(`not deleted: ${e.message}`, 'error'); }
        },
      }, 'delete'));
    }
    actions.append(el('button', {
      class: 'btn-primary',
      onClick: async () => {
        if (!f.amount) return toast('enter an amount', 'error');
        try {
          if (entry) await store.updateLedger(entry, f);
          else await store.addLedger(f);
          finish(true);
          toast('saved', 'success');
        } catch (e) { toast(`not saved: ${e.message}`, 'error'); }
      },
    }, 'save'));
    body.append(actions);
  });
}
```

- [ ] **Step 4: `js/app.js`.** Add this import under the existing `import { renderSpend } from './spend.js';`:
```js
import { renderPeople } from './people.js';
```
Then replace the body of `renderTab`:
```js
function renderTab() {
  if (view.tab === 'spend') return renderSpend();
  const msg = view.tab === 'people' ? 'lend & borrow arrives in the next update' : 'reports arrive in a later update';
  return el('div', { class: 'view-pad' }, el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, msg)));
}
```
with:
```js
function renderTab() {
  if (view.tab === 'spend') return renderSpend();
  if (view.tab === 'people') return renderPeople();
  return el('div', { class: 'view-pad' }, el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, 'reports arrive in a later update')));
}
```

- [ ] **Step 5: `sw.js`.** Replace `const CACHE_NAME = 'expense-v1';` with `const CACHE_NAME = 'expense-v2';`. Then in `ASSETS`, after the line `  './js/frecency.js',`, add:
```js
  './js/ledger.js',
  './js/people.js',
```

- [ ] **Step 6: Append people styles** to the end of `style.css`

```css

/* ========== expense: people ========== */
.person-row {
  display: flex; justify-content: space-between; align-items: center; width: 100%;
  padding: 12px 0; border-bottom: 1px solid var(--border); text-align: left;
}
.person-name { font-size: 14px; }
.person-balance { font-family: var(--font-mono); font-size: 12px; color: var(--text-dim); }
.person-balance.pos { color: var(--accent); }
.person-balance.neg { color: var(--warn); }
.settled-toggle { display: block; margin-top: 16px; }
.person-summary { margin-bottom: 4px; }
.kind-chips { flex-wrap: wrap; }
button.log-row { width: 100%; text-align: left; }
.ledger-nums { text-align: right; }
```

- [ ] **Step 7: Syntax check and suite**

Run: `node --check js/fields.js && node --check js/people.js && node --check js/app.js && node --check js/ctx.js && node --check sw.js`. Expected: no output.
Check that every `js/*.js` file appears in `sw.js` ASSETS (13 files).
Run: `node --test`. Expected: PASS, 51 tests.

- [ ] **Step 8: Manual check (the user, `python -m http.server 8080` in `expense-tracker/`)**
  1. **People tab, empty:** shows ₹0 / ₹0 and "no one yet".
  2. **+ → person "+ new person"** "Puru" → add. Kind **lent**, 1000, save. Expected: the list shows "Puru · owes you ₹1,000", and the header shows owed to you ₹1,000.
  3. **Tap Puru → settle ₹1,000.** Expected: the modal opens prefilled (they repaid, 1000). Change the amount to 400 and save. Expected: you're back in Puru's modal, which shows "Puru owes you ₹600", with history rows +₹1,000 bal ₹1,000 and −₹400 bal ₹600.
  4. **Over-repay:** add entry "they repaid" 900. Expected: "you owe Puru ₹300", shown in the warn colour in the list, and the header shows you owe ₹300 (Review Focus 1).
  5. **Borrow:** + → new person "Amit", borrowed 500. Expected: "you owe ₹500", and the list is sorted by the largest amount.
  6. **Settle to zero:** Amit → settle ₹500 → save. Expected: Amit moves to "▸ settled (1)", and tapping it expands the list.
  7. **Delete with undo:** Puru → tap a history row → delete. Expected: you're back on the tab, Puru's balance updates, and undo restores it (Review Focus 5).
  8. **Archive:** Puru (has entries) → archive. Expected: Puru is **still listed**, because he has a balance (Review Focus 3), and is marked "· archived". In + → person, Puru is no longer in the picker.
  9. **Delete a person with no entries:** + → new person "Temp" → close without saving the entry. Temp now appears under settled. Tap Temp → delete. Expected: Temp is gone.
  10. **Spend tab unaffected:** the day and month totals don't include any lend/borrow amounts (Review Focus 4).
  11. **Category picker still works** (it was refactored): Spend → + → new item → "+ new category" creates and selects it.
  12. Reload the page. Everything persists.

- [ ] **Step 9: Checkpoint** for the user to commit. To deploy: drag the folder onto the same Netlify site. The cache name is already bumped.
