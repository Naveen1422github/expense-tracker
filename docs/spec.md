# Expense Tracker — Design Spec

Date: 2026-10-04 · Status: awaiting review

A personal PWA for logging everyday spends with one tap, tracking money lent to / borrowed from people, budgets, and reports. Single user, single phone. Sibling of the macro tracker (`frontend2/macro/`, trackmacro.netlify.app) and built the same way.

## 1. Goals and non-goals

**Goals**
- Logging a frequent spend takes **one tap**.
- Lend/borrow shows **who owes whom, right now**, partial repayments included.
- Spend reports for any **range** (1M/3M/6M/1Y/custom) at any **grouping** (day/week/month).
- Budgets on everything, a category, or an item, per day, week, or month.
- Data survives phone loss (Google Drive backup), and Claude can read it cheaply (summary + monthly CSVs).

**Non-goals (v1):** multi-device sync, cash vs UPI, multi-currency, budget rollover, budgets on tags, accounts or a server.

## 2. Stack and constraints

- Vanilla JS as **native ES modules**: no framework, no build step, **zero npm dependencies** in the shipped app.
- IndexedDB: a single `kv` object store in DB `expense-db`.
- PWA: manifest + service worker, network-first. Deployed by drag-and-drop to a **new** Netlify site (separate origin from macro, so the data stays separate).
- UI language copied from macro: dark theme (`--bg #0f0f0e`, `--accent #7fb069`), IBM Plex Mono for numbers/labels and Plex Sans for body text, bottom-sheet modals, inline SVG icons. No gradients, shadows, or emoji.
- Charts are hand-drawn SVG. No chart library.
- `navigator.storage.persist()` is requested on boot.

## 3. File layout

```
expense-tracker/
  index.html  style.css  manifest.json  sw.js  icon.svg  icon-192.png  icon-512.png
  docs/spec.md
  js/
    app.js       boot, tab routing, render(), SW registration, install banner
    db.js        idbGet / idbSet / idbDelete / idbListKeys      (copied from macro, DB name changed)
    ui.js        el, icon, toast, openModal, attachSwipe, onLongPress   (copied + modified, see §3.1)
    money.js     parse/format ₹ ↔ paise, Indian digit grouping
    dates.js     ALL date→key logic (local time): dayKey, monthKey, weekStart, ranges, buckets
    store.js     state + every read/write; the ONLY module importing db.js
    frecency.js  item ranking score
    spend.js     Spend tab
    people.js    People tab + ledger maths (balance, signOf)
    budgets.js   budget evaluation (spent, pace, warnings)
    reports.js   Reports tab
    charts.js    SVG bar chart (horizontal + vertical), scrollable
    export.js    build summary.md, spend-YYYY-MM.csv, people.csv, backup.json; import validation
    drive.js     Google Drive connect / upload / restore
    settings.js  categories, tags, items, budgets, backup, wipe
  tests/         node --test files for the pure modules
```

**Pure modules** (no DOM, no IndexedDB; testable under Node): `money.js`, `dates.js`, `frecency.js`, `budgets.js`, `export.js`, and the ledger maths in `people.js`. The ledger maths goes in its own pure section, or into `ledger.js` if `people.js` grows.

### 3.1 Changes to code copied from macro
- `db.js`: DB name becomes `expense-db`. Otherwise unchanged.
- `ui.js`:
  - `toast(msg, kind, action?)` gains an optional `{label, onClick}` action button (needed for **Undo**). The visible duration becomes ~4s when an action is present.
  - New `onLongPress(node, handler, ms=450)`. It suppresses the context menu and text selection, and a long-press does **not** also fire a click.
  - Everything else is unchanged.
- `sw.js`:
  - `ASSETS` must list **every** `js/*.js` file, plus the icons.
  - The offline fallback to `index.html` applies **only to navigation requests** (`request.mode === 'navigate'`). A missing module must fail as a missing module, not be served HTML.
  - Cache name is `expense-v1`, bumped on every deploy.

## 4. Data model

All money is **integer paise**. All timestamps are `ts`: a **local** ISO-like string `YYYY-MM-DDTHH:mm` (no `Z`, no offset). Day, week and month keys are derived from `ts` **only via `dates.js`**, using local date parts. Nothing derives keys from UTC.

| Key | Shape |
|---|---|
| `categories` | `[{id, name, archived:boolean}]` |
| `tags` | `[{id, name}]` |
| `items` | `[{id, name, price:paise, categoryId, tagIds:string[], archived:boolean, createdAt:ts}]` |
| `spend:YYYY-MM` | `[{id, itemId:string\|null, name, categoryId, tagIds:string[], qty:number, amount:paise, ts, note}]` |
| `people` | `[{id, name, archived:boolean}]` |
| `ledger` | `[{id, personId, kind, amount:paise (always > 0), ts, note}]` |
| `budgets` | `[{id, scope:'all'\|'category'\|'item', refId:string\|null, period:'day'\|'week'\|'month', limit:paise}]` |
| `meta` | `{schemaVersion:1, lastBackupAt:ts\|null, dirtyMonths:string[], dirtyPeople:boolean, drive:{connected, folderId, fileIds:{[name]:id}}, budgetWarnings:{[budgetId]:{periodKey, level:80\|100}}}` |

`id` = `uid()` from macro (time base36 + random).

**Seed on first run:** categories Food, Groceries, Travel, Bills, Shopping; tag `unhealthy`.

### 4.1 Snapshot rule
A spend entry stores its own `name`, `categoryId` and `tagIds` as they were **when it was logged**. Reports, budgets, the tag filter and exports read the entry's **snapshot fields**, never the current item. Editing an item offers "Apply to past entries too?". If you say yes, `store.js` rewrites the matching entries in every `spend:*` month key.

One-off expenses have `itemId: null` and carry their own name and category.

### 4.2 Ledger sign: single source of truth
The stored `amount` is always positive. The sign comes from `kind`, and only from `signOf(kind)`:

| kind | meaning | sign (+ = they owe me) |
|---|---|---|
| `lent` | I gave them money | **+** |
| `borrowed` | they gave me money | **−** |
| `repaid_to_me` | they paid me back | **−** |
| `repaid_by_me` | I paid them back | **+** |

`balance(personId) = Σ signOf(kind) × amount`. Positive means they owe me. Negative means I owe them.

**Ledger entries never count as spending.** They are not in spend totals, budgets, or the spend reports.

### 4.3 Writes that span month keys (all in `store.js`)
- **Log with a past date:** write to `spend:<monthKey(ts)>`, not the current month.
- **Edit an entry's date into another month:** remove it from the old key and add it to the new key. Both writes are done before reporting success.
- **Apply item edit to past entries:** list the `spend:*` keys and rewrite only the months that contain entries for that item.
- Every write adds the affected month(s) to `meta.dirtyMonths` (ledger writes set `dirtyPeople`).

### 4.4 Reads that span month keys
- **Boot loads:** the current month plus the previous **3 months**. That covers frecency's lookback, week buckets that cross a month boundary, and the "vs last month" comparison.
- **Reports and week budgets** call `store.loadRange(from, to)`. It loads every month key the range touches, and caches results in memory for the session.

## 5. Screens and flows

### 5.1 Spend tab (default)
- **Header:** today's total and this month's total. Swipe left/right on the header to move to the previous/next day; this changes the "Today" list below.
- **Budget strip:** the 3 budgets with the highest `spent/limit`. Tap it to see all of them. Hidden if there are no budgets.
- **Search box:** matches item name, category name, or tag name.
- **Category chips:** `All` plus every non-archived category.
- **Item grid:**
  - With no search and `All` selected, it shows **all** items by frecency; the grid shows 4 rows and scrolls inside (changed 2026-10-06, was top 12).
  - With a search or a chip active, it shows **all** matching items, ordered by frecency.
- **Tap an item:** logs `qty 1, amount = price, ts = now` immediately, then shows the toast "Name ₹X · **Undo**".
- **Long-press an item:** opens the log modal with qty stepper, amount (price × qty, editable), date/time, note, and an "Edit item" link.
- **Day list:** the selected day's entries. Tap an entry to edit it; swipe it left to delete it (with Undo).
- **(+) button:** "New item" or "One-off expense" (name, amount, category, date, note).
- Every category picker can **create a new category inline**.

### 5.2 People tab
- **Header:** "Owed to you ₹X · You owe ₹Y".
- **List:** people with a non-zero balance, sorted by |balance|. Settled people (balance 0) are collapsed under "Settled (n)".
- **(+) button:** person (pick, or create inline), kind [Lent | Borrowed | They repaid | I repaid], amount, date, note.
- **Person view:** entries oldest→newest with the running balance after each one, and a **"Settle ₹X"** button that prefills the right repaid kind with the full outstanding amount (editable).

### 5.3 Reports tab
- Segment control: **Spend | People**.
- **Spend controls:**
  - **Range:** `1M 3M 6M 1Y Custom`. These are calendar-aligned and end today: 1M is the current month so far, 3M is the current month plus the previous 2, and so on.
  - **Group:** `Day Week Month`.
  - Allowed combinations: Day ≤ 3M; Week ≤ 1Y; Month any. Default group per range: 1M→Day, 3M→Week, 6M/1Y→Month.
  - **Tag filter** (optional) applies to every section.
- **Spend sections:**
  1. **Total**, plus "vs previous period". The previous period is the same length immediately before. If the range ends today, the comparison is cut at the same point: day-of-month, or the same number of days.
  2. **Trend:** a vertical bar per bucket. It scrolls sideways when there are more than ~31 bars. Tap a bar to drill in: sections 3–4 narrow to that bucket. Tap again to go back to the full range.
  3. **By category:** horizontal bars with ₹ and %. Tap one to see that category's items.
  4. **Top items:** by amount, with count. Items are grouped by snapshot `name`, so one-offs with the same name merge together.
- **Weeks** run **Monday–Sunday** and are labelled by their Monday date. They are never cut at month boundaries.
- **People section:** the balances list, then tap a person for their history (the same view as §5.2).

### 5.4 Budgets
- Set up in Settings → Budgets: scope (All/Category/Item) → target → period (Day/Week/Month) → limit.
- **Spent** = sum of entries in the **current** period that match the scope, using snapshot fields.
- **Pace:**
  - `elapsed = fraction of the period passed` (day: by hours; week: by days incl. today, Mon start; month: by days incl. today).
  - Status `on track` | `ahead of pace` | `over`, from comparing `spent/limit` with `elapsed` (thresholds: see §8 TODO).
- **Warnings:** when a log pushes a budget past 80%, then past 100%, a toast shows **once per budget per period**. This is tracked in `meta.budgetWarnings`, so it survives reloads.
- **Logging is never blocked.**

### 5.5 Settings
Categories, tags, and items (rename, archive; hard-delete only if never used) · Budgets · People (rename/archive) · Backup (Drive connect/status, last successful backup, manual export, import) · Wipe (with confirmation).

**Backup reminder:** if more than 14 days have passed since the last successful backup, show a dot on the settings icon and a line in Settings.

## 6. Export, backup and Drive

### 6.1 Files (built by `export.js`, pure)
- **`summary.md`** (~1–2 KB). Generated date; this month vs last month (same point) by category; the last 6 monthly totals; budget status; per-person balances and overall owed/owing. Written so Claude can answer most questions from this file alone.
- **`spend-YYYY-MM.csv`**, one per month. Header `date,time,item,category,tags,qty,amount,note`. Amount is in rupees with 2 decimals; tags are `;`-joined. RFC 4180 quoting (commas, quotes, newlines).
- **`people.csv`**: `date,person,kind,amount,balance_after,note`.
- **`backup.json`**: every key verbatim plus `schemaVersion`. This file is for restoring only.

### 6.2 Manual export / import
- **Export** downloads `backup.json`, with an option to download `summary.md`.
- **Import** validates first:
  - `schemaVersion` is known
  - every key has the expected shape
  - amounts are non-negative integers
  - referenced ids exist
  
  Then it shows a confirmation with counts ("Replace all data? Current: 412 expenses, 9 people"), and only then replaces the data. A file that fails validation never touches existing data.

### 6.3 Google Drive (`drive.js`, built last)
- **One-time setup** (documented in the README when this step is built): a Google Cloud project and an OAuth Web client ID, with the Netlify origin as an authorized JS origin.
- **Sign-in:**
  - Google Identity Services is loaded **lazily**, on the first "Connect".
  - Scope is `drive.file` (the app can only see files it created).
  - Tokens are short-lived, with silent re-request when possible. If that fails, the status becomes "Backup pending — tap to sign in".
- **Folder:** a visible `Expense Tracker/` in My Drive, so the Claude Drive connector can read it. Folder and file ids are kept in `meta.drive`.
- **Triggers:** when the app opens (if anything is dirty), and 60s after the last write (debounced).
- **Uploads:**
  - the `spend-YYYY-MM.csv` for each month in `dirtyMonths`
  - `people.csv` if `dirtyPeople`
  - always `summary.md` and `backup.json`
  
  On success, clear the dirty flags and set `lastBackupAt`. On failure, keep the flags and retry on the next trigger.
- **Restore:** "Restore from Drive" downloads `backup.json` and runs the import path (§6.2).
- **To verify when building this step:** under `drive.file`, check that a fresh install (new phone, same OAuth client) can see files created by the earlier install. If it can't, the fallback is to pick `backup.json` with the Google Picker, or to use manual import.

## 7. Error handling
- **A store write rejects:** show an error toast. The modal stays open with your input still in it, and there's no optimistic "saved" state.
- **Undo** reverses exactly one write, through the same store functions.
- **Drive errors** are never fatal and never block logging. The backup status is shown in Settings.
- **`schemaVersion`** is checked at boot. A `migrate(from, to)` hook exists (it does nothing at v1).

## 8. User-contribution points (learning mode)
- **`frecency.js` → `score(uses, now)`:** the decay formula. A suggested starting point is a half-life of ~14 days, summed over uses in the loaded lookback. You'll write it.
- **`budgets.js` → pace thresholds:** at what gap "ahead of pace" kicks in (e.g. `spent/limit > elapsed + 0.10`). You'll pick the numbers.

## 9. Testing
- `node --test expense-tracker/tests/`, using Node's built-in runner. No npm.
- Run by a background subagent per the project rule; it reports a compact summary.
- **Required cases:**
  - **money:** `"45.5"→4550`, `"0.1"+"0.2"` sums exactly, Indian grouping `123456789 → 12,34,56,789.00`.
  - **dates:**
    - `ts` at **00:30 local on the 1st** lands in the new month and the new day.
    - A Mon–Sun week crossing a month boundary and a year boundary.
    - Leap day.
    - Same-point comparison on the 31st vs a 30-day month.
  - **ledger:** the `signOf` table; a partial repayment leaves the correct balance; mixed lend+borrow with one person.
  - **budgets:** spent and elapsed for each period; a week budget spanning two month keys; warning dedup per period.
  - **export:** CSV quoting of a note containing a comma, a quote and a newline; `summary.md` totals match the sum of the CSV rows; import rejects a bad shape without side effects.
- UI is verified manually by the user on their phone.

## 10. Build order
1. Shell: copied helpers (with the §3.1 changes), SW, manifest, tabs, `money.js`, `dates.js`, `store.js` + tests.
2. Spend: items, categories, tags, one-tap log + Undo, long-press modal, one-offs, day list, frecency, search, chips.
3. People: ledger, balances, person history, settle.
4. Reports: range/group, trend chart, category, top items, tag filter, people reports.
5. Budgets.
6. Export/import + `summary.md`/CSVs + backup reminder.
7. Google Drive backup/restore.
