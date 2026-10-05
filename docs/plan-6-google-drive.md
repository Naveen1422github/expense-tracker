# Kharchly — Plan 6: Google Drive Backup

> **For agentic workers:** Execute Tasks 1–3 in order, in one pass (no per-task reviewer). Use superpowers:executing-plans when running it inside Claude. Steps use checkbox (`- [ ]`) syntax. **Prerequisite:** Plan 5 is implemented (export.js, backup-files.js, importRaw, restore flow in settings.js).

**Goal:** Automatic backup to a visible **`Kharchly/`** folder in the user's Google Drive, with restore from it.
- **Files:** `summary.md`, `spend-YYYY-MM.csv` (changed months only), `people.csv`, and `backup.json`. These are the same files Plan 5 builds, so the Claude Drive connector can read them cheaply.
- **When it uploads:** on app open (if anything changed), 60 seconds after the last change, and when the app goes to the background.
- **Backup only, never sync.** The phone is the source of truth.

**Architecture:**
- `drive-api.js`: a **pure-ish** Drive REST client. `fetch` and the token are injected, so it runs under `node --test` against a fake Drive. It finds or creates the folder, writes files by name (update in place; recreate if deleted), and reads `backup.json`.
- `drive.js`: the browser side.
  - Loads Google Identity Services (GIS) lazily.
  - Holds the ~1 hour access token. There is no refresh token without a server.
  - Runs the triggers and status, and draws the Settings section.
- `store.js` gains:
  - change notifications: `subscribe`, `changeSeq`
  - Drive bookkeeping: `setDrive`, `clearDirty`, `markAllDirty`
- The restore confirmation moves into `restore-view.js`, so Settings and Drive share it without an import cycle.

**Tech Stack:** Vanilla ES modules; Google Identity Services token model (`accounts.google.com/gsi/client`, loaded at runtime only when Drive is configured); Drive REST v3 via `fetch`; `node --test`. Still zero npm dependencies.

**Spec:** `expense-tracker/docs/spec.md` §6.3. **One change from the spec:** the folder is named **`Kharchly`** (the app was renamed), not `Expense Tracker`.

## Global Constraints

- **Scope:** only `https://www.googleapis.com/auth/drive.file`, so the app sees only files it created. No other scope.
- **Sign-in popups open only from a user tap.** Browsers block popups otherwise. The GIS script is preloaded when Settings opens or at boot if connected, so the tap opens the popup immediately.
- **Token:**
  - Kept in memory, plus `localStorage['kharchly:drive-token']` with its expiry, so a reopen within the hour needs no popup.
  - When it's missing or expired, background backups don't prompt. Instead the status becomes **"backup pending — tap to sign in"** and the settings dot shows.
  - A Drive `401` clears the token and sets the same status.
- **Never overwrite a Drive backup by accident.** When connecting finds an existing `Kharchly/backup.json`, the user must choose **restore from drive** or **keep this phone (overwrite drive)**. Nothing uploads before that choice.
- **Dirty tracking:** an upload sends the dirty months and people captured at its start. Afterwards, `clearDirty` clears exactly those, **unless any data change happened during the upload** (`changeSeq` moved). In that case everything stays dirty and the next backup re-sends.
- **Files are written by name inside the folder:**
  - Known id → update in place.
  - A 404 → create again.
  - Unknown id → find by name first, so a reconnect never makes duplicates.
  - A trashed or missing folder → find or create a fresh one.
- **Failure handling:** Drive failures never block or slow logging. They show in Settings, and backups retry on the next trigger.
- **Not configured:** `GOOGLE_CLIENT_ID` in `js/config.js` is public and safe to commit. When it's empty, the Drive section just says setup is needed.
- `store.js` is the only module touching `kv`. No `alert` / `confirm` / `prompt`.
- **No builds. No git write commands.** The user commits. Tests run from `expense-tracker/` with `node --test`. From the main Claude session, delegate test runs to a background subagent.

## Review Focus

1. **A new phone connects and wipes the real backup.** An empty app's first upload would replace a good `backup.json` with an empty one. Connect must find an existing backup and ask first. Covered in Task 3 (`connect` → `askWhichCopy`) and its manual check step 6.
2. **An edit made while an upload is running.** It must not be marked as uploaded. Test: `store.test.js` "clearDirty … unless something changed meanwhile".
3. **Duplicate files after disconnect and reconnect, or a new install.** Test: `drive-api.test.js` "reconnecting with no saved ids finds the existing folder and files by name".
4. **The user deletes a file or trashes the folder in Drive.** It must be recreated. Test: `drive-api.test.js` "a file deleted in Drive is recreated; a trashed folder is replaced".
5. **Token expiry (about 1 hour).** It must turn into "tap to sign in", never a silent failure or an error loop. Test: `drive-api.test.js` "HTTP errors surface as DriveError with the status". The status handling is in Task 3, and it's covered by manual check step 5.

---

## One-time Google setup (the user does this; Task 3 also writes it into README.md)

1. Go to https://console.cloud.google.com and create a project named `kharchly`.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **OAuth consent screen:**
   - User type: External.
   - App name: kharchly. Support and developer email: yours.
   - Scopes: add `.../auth/drive.file`.
   - Test users: add your own Gmail.
   - Start in **Testing**: only the listed test users can sign in. Prove the flow there first.
4. **Credentials → Create credentials → OAuth client ID:**
   - Type: **Web application**.
   - **Authorized JavaScript origins:** `https://kharchly.netlify.app` and `http://localhost:8080`.
   - No redirect URIs.
5. Copy the client ID (`….apps.googleusercontent.com`) into `js/config.js`, then commit and push.

### Opening Drive backup to everyone (decided 2026-10-05)

The one client ID serves every user. Each person signs in with their own Google account and gets their own `Kharchly/` folder in their own Drive. Nothing passes through us, and there is no per-user setup beyond tapping connect. `summary.md` and the CSVs are generic files that anyone can open in Sheets or hand to any AI. Nothing in them is specific to Claude.

6. **Privacy page:** add `privacy.html` at the site root (Task 3). Keep it short and plain:
   - Data stays on the device and in the user's own Drive.
   - The app uses only `drive.file`, so it sees only the files it created.
   - No server, no analytics, no sharing.
   - How to disconnect: Settings, or Google account → Security → third-party access.
   - Add it to the SW `ASSETS`.
7. **Branding on the consent screen:**
   - App home page: `https://kharchly.netlify.app/`
   - Privacy policy: `https://kharchly.netlify.app/privacy.html`
   - Logo: `icon-512.png`, resized to 120×120.
   - Authorized domain: try `kharchly.netlify.app`.
   - **Open question:** Google may require a domain you can verify in Search Console. If it rejects the netlify subdomain, either verify `kharchly.netlify.app` as a URL-prefix property in Search Console (an HTML-file method that can be deployed with the site), or move to a cheap custom domain.
8. **Publish app → In production.** `drive.file` is a non-sensitive scope, so no security assessment is expected. Brand verification (app name and logo shown on the consent screen) may take a few days.
   - Until it's verified, users may see a plainer consent screen. Verify on the day: they must **not** see the red "Google hasn't verified this app" wall.
   - If they do, stay in Testing and add people as test users (up to 100) until verification passes.
9. **Manual check after publishing:** sign in with a Gmail that is **not** a test user. Connecting must work, and the backup must land in that account's own `Kharchly/` folder.

---

## File map

| File | Change | Task |
|---|---|---|
| `js/drive-api.js` | **create**: Drive REST client + `uploadAll` (fetch injected) | 1 |
| `tests/drive-api.test.js` | **create** (7 tests, fake Drive) | 1 |
| `js/store.js` | **modify**: `subscribe`/`changeSeq`, `setDrive`, `clearDirty`, `markAllDirty` | 2 |
| `tests/store.test.js` | **modify**: append 4 tests | 2 |
| `js/config.js` | **already exists** (415b44a) with the real `GOOGLE_CLIENT_ID`. Do NOT overwrite it with `''`; just add it to SW `ASSETS` | 3 |
| `js/restore-view.js` | **create**: `confirmRestore` moved out of settings.js (+ `afterRestore`) | 3 |
| `js/drive.js` | **create**: GIS sign-in, triggers, status, Settings section | 3 |
| `js/settings.js` | **modify**: use restore-view + Drive section | 3 |
| `js/app.js` | **modify**: `initDrive()`, dot when sign-in is needed | 3 |
| `sw.js` | **modify**: precache 4 modules, bump the cache name | 3 |
| `README.md` | **create**: run / test / deploy / Google setup | 3 |
| `privacy.html` | **create**: short privacy page (setup step 6); add to SW `ASSETS` | 3 |

---

### Task 1: drive-api.js

**Files:**
- Create: `expense-tracker/js/drive-api.js`
- Test: `expense-tracker/tests/drive-api.test.js`

**Interfaces:**
- Produces:
  - `FOLDER_NAME = 'Kharchly'`
  - `class DriveError extends Error { status }`
  - `multipartBody(boundary, metadata, content, mime) → string`
  - `createDriveApi({fetchFn, token}) → { findFolder, createFolder, folderAlive, findFile, putFile, downloadText, readBackup }`
    - `findFolder() → id|null`
    - `folderAlive(id) → boolean`
    - `findFile(folderId, name) → id|null`
    - `putFile(folderId, name, content, mime, knownId?) → id`
    - `readBackup() → {folderId, text}|null`
  - `uploadAll({api, drive: {folderId, fileIds}, months: string[], people: boolean, build: {monthCsv(mk), peopleCsv(), summary(), backupJson()}}) → Promise<{folderId, fileIds}>`

- [ ] **Step 1: Write the failing test** at `tests/drive-api.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveApi, uploadAll, multipartBody, DriveError, FOLDER_NAME } from '../js/drive-api.js';

// a tiny in-memory Google Drive that understands exactly the calls drive-api.js makes
function fakeDrive() {
  const files = new Map();
  let n = 0;
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  async function fetchFn(url, opts = {}) {
    if (opts.headers?.Authorization !== 'Bearer T') return reply(401, { error: 'no token' });
    const method = opts.method || 'GET';
    const u = new URL(url);
    const one = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q');
      const name = /name='([^']*)'/.exec(q)[1];
      const parent = /'([^']*)' in parents/.exec(q)?.[1];
      const folderOnly = q.includes("mimeType='application/vnd.google-apps.folder'");
      const found = [...files.values()].filter((f) =>
        !f.trashed && f.name === name && (!parent || f.parent === parent) && (!folderOnly || f.folder));
      return reply(200, { files: found.map((f) => ({ id: f.id, name: f.name })) });
    }
    if (method === 'GET' && one) {
      const f = files.get(one[1]);
      if (!f) return reply(404, { error: 'not found' });
      return u.searchParams.get('alt') === 'media' ? reply(200, f.content) : reply(200, { id: f.id, trashed: !!f.trashed });
    }
    if (method === 'POST' && u.pathname === '/drive/v3/files') {
      const meta = JSON.parse(opts.body);
      const id = `f${++n}`;
      files.set(id, { id, name: meta.name, folder: true });
      return reply(200, { id });
    }
    if (method === 'POST' && u.pathname === '/upload/drive/v3/files') {
      const parts = opts.body.split('\r\n\r\n');
      const meta = JSON.parse(parts[1].split('\r\n')[0]);
      const content = parts.slice(2).join('\r\n\r\n').replace(/\r\n--[^\r\n]*--$/, '');
      const id = `f${++n}`;
      files.set(id, { id, name: meta.name, parent: meta.parents[0], content });
      return reply(200, { id });
    }
    if (method === 'PATCH' && one) {
      const f = files.get(one[1]);
      if (!f) return reply(404, { error: 'not found' });
      f.content = opts.body;
      return reply(200, { id: f.id });
    }
    return reply(500, { error: `unexpected ${method} ${u.pathname}` });
  }
  return { files, api: createDriveApi({ fetchFn, token: () => 'T' }) };
}

const build = (tag) => ({
  monthCsv: async (mk) => `csv ${mk} ${tag}`,
  peopleCsv: async () => `people ${tag}`,
  summary: async () => `summary ${tag}`,
  backupJson: async () => `{"v":"${tag}"}`,
});
const live = (d, name) => [...d.files.values()].filter((f) => f.name === name && !f.trashed);
const EMPTY = { folderId: null, fileIds: {} };

test('multipartBody: json metadata part, then the content part', () => {
  assert.equal(
    multipartBody('B', { name: 'a.csv' }, 'x,y', 'text/csv'),
    '--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.csv"}\r\n--B\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\nx,y\r\n--B--',
  );
});

test('first backup creates the folder and every file, and returns their ids', async () => {
  const d = fakeDrive();
  const res = await uploadAll({ api: d.api, drive: EMPTY, months: ['2026-09', '2026-10'], people: true, build: build('v1') });
  assert.equal(live(d, FOLDER_NAME).length, 1);
  assert.deepEqual(Object.keys(res.fileIds).sort(), ['backup.json', 'people.csv', 'spend-2026-09.csv', 'spend-2026-10.csv', 'summary.md']);
  assert.equal(d.files.get(res.fileIds['spend-2026-10.csv']).content, 'csv 2026-10 v1');
  assert.equal(d.files.get(res.fileIds['spend-2026-10.csv']).parent, res.folderId);
});

test('later backups update in place: only dirty months, no duplicates', async () => {
  const d = fakeDrive();
  const first = await uploadAll({ api: d.api, drive: EMPTY, months: ['2026-09', '2026-10'], people: true, build: build('v1') });
  const count = d.files.size;
  const second = await uploadAll({ api: d.api, drive: first, months: ['2026-10'], people: false, build: build('v2') });
  assert.equal(d.files.size, count);
  assert.equal(d.files.get(second.fileIds['spend-2026-10.csv']).content, 'csv 2026-10 v2');
  assert.equal(d.files.get(second.fileIds['spend-2026-09.csv']).content, 'csv 2026-09 v1');
  assert.equal(d.files.get(second.fileIds['people.csv']).content, 'people v1');
  assert.equal(d.files.get(second.fileIds['summary.md']).content, 'summary v2');
  assert.equal(d.files.get(second.fileIds['backup.json']).content, '{"v":"v2"}');
});

test('a file deleted in Drive is recreated; a trashed folder is replaced', async () => {
  const d = fakeDrive();
  const first = await uploadAll({ api: d.api, drive: EMPTY, months: ['2026-10'], people: false, build: build('v1') });
  d.files.delete(first.fileIds['summary.md']);
  const second = await uploadAll({ api: d.api, drive: first, months: [], people: false, build: build('v2') });
  assert.notEqual(second.fileIds['summary.md'], first.fileIds['summary.md']);
  assert.equal(live(d, 'summary.md')[0].content, 'summary v2');
  d.files.get(second.folderId).trashed = true;
  const third = await uploadAll({ api: d.api, drive: second, months: [], people: false, build: build('v3') });
  assert.notEqual(third.folderId, second.folderId);
  assert.equal(d.files.get(third.fileIds['backup.json']).parent, third.folderId);
});

test('reconnecting with no saved ids finds the existing folder and files by name (no duplicates)', async () => {
  const d = fakeDrive();
  await uploadAll({ api: d.api, drive: EMPTY, months: ['2026-10'], people: true, build: build('v1') });
  const count = d.files.size;
  const folderId = await d.api.findFolder();
  await uploadAll({ api: d.api, drive: { folderId, fileIds: {} }, months: ['2026-10'], people: true, build: build('v2') });
  await uploadAll({ api: d.api, drive: EMPTY, months: ['2026-10'], people: true, build: build('v3') });
  assert.equal(d.files.size, count);
  assert.equal(live(d, 'people.csv')[0].content, 'people v3');
});

test('readBackup finds backup.json in the folder, or returns null', async () => {
  const d = fakeDrive();
  assert.equal(await d.api.readBackup(), null);
  await uploadAll({ api: d.api, drive: EMPTY, months: [], people: false, build: build('v1') });
  const found = await d.api.readBackup();
  assert.equal(found.text, '{"v":"v1"}');
  assert.equal(found.folderId, await d.api.findFolder());
});

test('HTTP errors surface as DriveError with the status (401 = sign in again)', async () => {
  const api = createDriveApi({
    fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'token expired' }),
    token: () => '',
  });
  await assert.rejects(api.findFolder(), (e) => e instanceof DriveError && e.status === 401);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/drive-api.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Create `js/drive-api.js`**

```js
// drive-api — minimal Google Drive REST v3 client. fetch + token are injected, so it runs
// under node tests against a fake Drive. scope is drive.file: we only ever see our own files.
// files are written BY NAME inside one folder: known id -> update in place; 404 -> create again;
// unknown id -> look it up by name first (so a reconnect or new install never makes duplicates).
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const FOLDER_NAME = 'Kharchly';

export class DriveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function multipartBody(boundary, metadata, content, mime) {
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
}

export function createDriveApi({ fetchFn, token }) {
  async function call(url, opts = {}) {
    const res = await fetchFn(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new DriveError(res.status, `drive ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
    }
    return res;
  }
  const query = (q) => `${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name)')}&spaces=drive`;

  async function findFolder() {
    const res = await call(query(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`));
    return (await res.json()).files[0]?.id || null;
  }

  async function createFolder() {
    const res = await call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    return (await res.json()).id;
  }

  async function folderAlive(id) {
    try {
      const res = await call(`${API}/files/${id}?fields=id,trashed`);
      return !(await res.json()).trashed;
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return false;
      throw e;
    }
  }

  async function findFile(folderId, name) {
    const res = await call(query(`name='${name}' and '${folderId}' in parents and trashed=false`));
    return (await res.json()).files[0]?.id || null;
  }

  async function createFile(folderId, name, content, mime) {
    const boundary = `kharchly${Math.random().toString(36).slice(2)}`;
    const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody(boundary, { name, parents: [folderId], mimeType: mime }, content, mime),
    });
    return (await res.json()).id;
  }

  async function updateFile(id, content, mime) {
    await call(`${UPLOAD}/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': `${mime}; charset=UTF-8` },
      body: content,
    });
    return id;
  }

  async function putFile(folderId, name, content, mime, knownId) {
    const id = knownId || (await findFile(folderId, name));
    if (id) {
      try { return await updateFile(id, content, mime); } catch (e) {
        if (!(e instanceof DriveError) || e.status !== 404) throw e; // deleted in Drive: fall through and recreate
      }
    }
    return createFile(folderId, name, content, mime);
  }

  async function downloadText(id) {
    return (await call(`${API}/files/${id}?alt=media`)).text();
  }

  async function readBackup() {
    const folderId = await findFolder();
    if (!folderId) return null;
    const id = await findFile(folderId, 'backup.json');
    return id ? { folderId, text: await downloadText(id) } : null;
  }

  return { findFolder, createFolder, folderAlive, findFile, putFile, downloadText, readBackup };
}

// one backup run. returns the (possibly new) folder + file ids to remember in meta.drive.
export async function uploadAll({ api, drive, months, people, build }) {
  let folderId = drive.folderId && (await api.folderAlive(drive.folderId)) ? drive.folderId : null;
  const fileIds = folderId ? { ...drive.fileIds } : {};
  if (!folderId) folderId = (await api.findFolder()) || (await api.createFolder());
  const put = async (name, mime, make) => {
    fileIds[name] = await api.putFile(folderId, name, await make(), mime, fileIds[name]);
  };
  for (const mk of months) await put(`spend-${mk}.csv`, 'text/csv', () => build.monthCsv(mk));
  if (people) await put('people.csv', 'text/csv', build.peopleCsv);
  await put('summary.md', 'text/markdown', build.summary);
  await put('backup.json', 'application/json', build.backupJson);
  return { folderId, fileIds };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/drive-api.test.js`. Expected: PASS, 7 tests.

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 2: store.js — change notifications + Drive bookkeeping

**Files:**
- Modify: `expense-tracker/js/store.js`, `expense-tracker/tests/store.test.js`

**Interfaces:**
- Produces:
  - `subscribe(fn) → unsubscribe`. `fn()` runs after every **successful data** mutation.
  - `changeSeq() → number`
  - `setDrive(drive)` (meta only)
  - `clearDirty(months, people, seqAtStart) → boolean` (meta only)
  - `markAllDirty()` (meta only)
- Meta-only mutators (`boot`, `markBudgetWarned`, `markBackedUp`, `setDrive`, `clearDirty`, `markAllDirty`) **don't** notify and don't bump `changeSeq`. A backup run therefore never re-schedules itself.

- [ ] **Step 1: Append the failing tests** to the end of `tests/store.test.js`

```js
// ---------- drive bookkeeping (plan 6) ----------
test('subscribers hear successful data changes only, and changeSeq counts them', async () => {
  const { store } = await fresh();
  let heard = 0;
  store.subscribe(() => { heard++; });
  const s0 = store.changeSeq();
  await store.logSpend({ name: 'Chai', categoryId: catId(store, 'Food'), amount: 1500 });
  await store.savePerson({ name: 'Puru' });
  await store.markBackedUp();
  await store.setDrive({ connected: true, folderId: 'F', fileIds: {} });
  assert.equal(heard, 2);
  assert.equal(store.changeSeq(), s0 + 2);
  await assert.rejects(store.logSpend({ name: '', categoryId: 'x', amount: 1 }));
  assert.equal(heard, 2); // a rejected write is not a change
});

test('clearDirty clears exactly what was uploaded, unless something changed meanwhile', async () => {
  const { store } = await fresh();
  const food = catId(store, 'Food');
  await store.logSpend({ name: 'A', categoryId: food, amount: 100, ts: '2026-09-10T10:00' });
  await store.logSpend({ name: 'B', categoryId: food, amount: 100, ts: '2026-10-01T10:00' });
  await store.savePerson({ name: 'Puru' });
  const seq = store.changeSeq();
  await store.logSpend({ name: 'C', categoryId: food, amount: 100 }); // lands mid-upload
  assert.equal(await store.clearDirty(['2026-09', '2026-10'], true, seq), false);
  assert.deepEqual(store.state.meta.dirtyMonths, ['2026-09', '2026-10']);
  assert.equal(await store.clearDirty(['2026-09'], true, store.changeSeq()), true);
  assert.deepEqual(store.state.meta.dirtyMonths, ['2026-10']);
  assert.equal(store.state.meta.dirtyPeople, false);
});

test('markAllDirty marks every stored month and people', async () => {
  const { store } = await fresh();
  const food = catId(store, 'Food');
  await store.logSpend({ name: 'A', categoryId: food, amount: 100, ts: '2025-01-10T10:00' });
  await store.logSpend({ name: 'B', categoryId: food, amount: 100, ts: '2026-10-01T10:00' });
  await store.clearDirty(['2025-01', '2026-10'], true, store.changeSeq());
  await store.markAllDirty();
  assert.deepEqual(store.state.meta.dirtyMonths, ['2025-01', '2026-10']);
  assert.equal(store.state.meta.dirtyPeople, true);
});

test('setDrive persists across reloads', async () => {
  const { store, kv } = await fresh();
  await store.setDrive({ connected: true, folderId: 'F', fileIds: { 'summary.md': 'S' } });
  const { store: again } = await fresh('2026-10-04T10:00', kv);
  assert.deepEqual(again.state.meta.drive, { connected: true, folderId: 'F', fileIds: { 'summary.md': 'S' } });
});
```

- [ ] **Step 2: Run it and confirm the new tests fail**

Run: `node --test tests/store.test.js`. Expected: 29 pass and 4 fail (`store.subscribe is not a function`, etc.).

- [ ] **Step 3: Modify `js/store.js`.** Make three edits.

**3a.** Insert immediately **before** the comment line `  // every public mutator runs one at a time. without this, two fast taps both read the`:
```js
  // ---------- drive bookkeeping (meta only: these never notify) ----------
  async function setDrive(drive) {
    const meta = { ...state.meta, drive };
    await kv.set(K.meta, meta);
    state.meta = meta;
  }

  // clear exactly what an upload sent — unless data changed while it ran (then the next backup re-sends)
  async function clearDirty(months, people, seqAtStart) {
    if (seq !== seqAtStart) return false;
    const meta = {
      ...state.meta,
      dirtyMonths: state.meta.dirtyMonths.filter((m) => !months.includes(m)),
      dirtyPeople: people ? false : state.meta.dirtyPeople,
    };
    await kv.set(K.meta, meta);
    state.meta = meta;
    return true;
  }

  async function markAllDirty() {
    const meta = { ...state.meta, dirtyMonths: await spendMonthKeys(), dirtyPeople: true };
    await kv.set(K.meta, meta);
    state.meta = meta;
  }

  // ---------- change notifications ----------
  let seq = 0;
  const listeners = new Set();
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

```

**3b.** Directly **after** the existing `serial` helper (the `const serial = (fn) => (...args) => { … };` block), add:
```js
  // data mutators: serialized, and after a SUCCESSFUL run bump the change counter and notify
  const data = (fn) => serial(async (...args) => {
    const result = await fn(...args);
    seq += 1;
    for (const l of listeners) { try { l(); } catch { /* a listener must never break a write */ } }
    return result;
  });
```

**3c.** In the returned object, change `serial(` to `data(` for exactly these keys: `saveCategory`, `saveTag`, `saveItem`, `deleteItem`, `applyItemToPast`, `logSpend`, `logItem`, `updateSpend`, `deleteSpend`, `restoreSpend`, `savePerson`, `deletePerson`, `addLedger`, `updateLedger`, `deleteLedger`, `restoreLedger`, `saveBudget`, `deleteBudget`, `wipe`, `importRaw`.
- Keep `serial(` for `boot`, `markBudgetWarned` and `markBackedUp`.
- Then add these entries to the returned object:
```js
    setDrive: serial(setDrive),
    clearDirty: serial(clearDirty),
    markAllDirty: serial(markAllDirty),
    subscribe,
    changeSeq: () => seq,
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test tests/store.test.js`. Expected: PASS, 33 tests.
Run: `node --test`. Expected: PASS, 97 tests (money 6, dates 8, frecency 7, store 33, ledger 9, report-data 13, budgets 7, export 7, drive-api 7).

- [ ] **Step 5: Checkpoint** for the user to commit.

---

### Task 3: config, restore-view, drive.js, wiring, README

**Files:**
- Create: `js/config.js`, `js/restore-view.js`, `js/drive.js`, `README.md`
- Modify: `js/settings.js`, `js/app.js`, `sw.js`

**Interfaces:**
- Consumes:
  - Tasks 1–2
  - Plan 5: `buildSummary`, `buildMonthCsv`, `buildPeopleCsv`, `hasData`, `currentCounts` (backup-files); `validateBackup`, `daysSinceBackup` (export); `SCHEMA_VERSION` (store)
  - `el`, `toast`, `openModal` (ui); `store`, `view`, `rerender` (ctx)
- Produces:
  - `restore-view.js`: `confirmRestore(dump, incoming, current, afterRestore?)`
  - `drive.js`:
    - `initDrive()`
    - `driveNeedsSignIn() → boolean`
    - `renderDriveSection(closeSettings) → HTMLElement`

- [ ] **Step 1: `js/config.js` ALREADY EXISTS** (commit 415b44a) with the real client id. **Do not touch it.** For reference, its shape is `export const GOOGLE_CLIENT_ID = '….apps.googleusercontent.com';`.

- [ ] **Step 2: Create `js/restore-view.js`.** This is the restore confirmation moved out of settings.js, plus an `afterRestore` hook.

```js
// restore-view — the "replace everything?" confirmation, shared by file restore (settings)
// and drive restore (drive.js). lives in its own module so the two don't import each other.
import { el, openModal, toast } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { todayKey } from './dates.js';

const describe = (c) => (c
  ? `${c.expenses} expenses · ${c.items} items · ${c.people} people · ${c.budgets} budgets`
  : 'unknown');

export function confirmRestore(dump, incoming, current, afterRestore = null) {
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
          if (afterRestore) await afterRestore();
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

- [ ] **Step 3: `js/settings.js`.**

**3a.** Delete the `describe` constant and the whole `confirmRestore` function: from the line `const describe = (c) => (c` through the closing `}` of `confirmRestore`, just before the `// two-tap erase (no confirm() dialogs)` comment. They now live in `restore-view.js`.

**3b.** Add under the existing `import { buildSummary, … } from './backup-files.js';` line:
```js
import { confirmRestore } from './restore-view.js';
import { renderDriveSection } from './drive.js';
```

**3c.** Replace:
```js
      backupSection(close),
```
with:
```js
      renderDriveSection(close),
      backupSection(close),
```

**3d.** In `backupSection`, replace the text:
```js
      'json = full copy you can restore. summary.md + csv = readable reports (for you, excel, or claude). google drive auto-backup comes next.'),
```
with:
```js
      'json = full copy you can restore. summary.md + csv = readable reports (for you, excel, or claude). for automatic backups, connect google drive above.'),
```

- [ ] **Step 4: Create `js/drive.js`**

```js
// drive — google drive BACKUP (never sync: the phone is the source of truth).
// sign-in: google identity services token model, loaded only when drive is configured.
//   tokens last ~1h and there is no refresh token without a server, so background backups
//   never prompt; they report "backup pending — tap to sign in" and wait for a tap.
// triggers: app open (if anything changed), 60s after the last change, app going to background.
import { GOOGLE_CLIENT_ID } from './config.js';
import { el, toast, openModal } from './ui.js';
import { store, rerender } from './ctx.js';
import { SCHEMA_VERSION } from './store.js';
import { nowTs } from './dates.js';
import { createDriveApi, uploadAll, FOLDER_NAME } from './drive-api.js';
import { buildSummary, buildMonthCsv, buildPeopleCsv, hasData, currentCounts } from './backup-files.js';
import { validateBackup, daysSinceBackup } from './export.js';
import { confirmRestore } from './restore-view.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'kharchly:drive-token';
const DEBOUNCE_MS = 60_000;

let token = null;        // { value, expiresAt }
let tokenClient = null;
let pending = null;      // { resolve, reject } of the sign-in in flight
let gisLoading = null;
let timer = null;
let running = null;
const status = { state: 'idle', text: '' }; // idle | syncing | ok | pending-auth | error

const driveConfigured = () => Boolean(GOOGLE_CLIENT_ID);
const driveConnected = () => Boolean(store.state.meta.drive?.connected);
export const driveNeedsSignIn = () => driveConnected() && status.state === 'pending-auth';
const hasDirty = () => store.state.meta.dirtyMonths.length > 0 || store.state.meta.dirtyPeople;
const tokenValid = () => Boolean(token && token.expiresAt > Date.now() + 60_000);
const setStatus = (state, text) => { status.state = state; status.text = text; };
const PENDING_TEXT = 'backup pending — tap to sign in';

// ---------- token ----------
function loadToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.expiresAt > Date.now() + 60_000) token = t;
  } catch { /* storage blocked: memory only */ }
}

function saveToken(t) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: memory only */ }
}

// load google's script AHEAD of the tap: browsers block popups not opened right after a tap
function prepareSignIn() {
  if (!driveConfigured()) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPE,
          callback: (r) => {
            const p = pending;
            pending = null;
            if (r.error) { p?.reject(new Error(r.error_description || r.error)); return; }
            saveToken({ value: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
            p?.resolve();
          },
          error_callback: (e) => {
            const p = pending;
            pending = null;
            p?.reject(new Error(e?.type === 'popup_closed' ? 'sign-in cancelled' : (e?.message || 'sign-in failed')));
          },
        });
        resolve();
      };
      s.onerror = () => { gisLoading = null; reject(new Error('could not load google sign-in (offline?)')); };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

// MUST be called from a tap. prompt '' = only ask for what is missing (consent the first time)
async function signIn() {
  await prepareSignIn();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

const api = () => createDriveApi({ fetchFn: (url, opts) => fetch(url, opts), token: () => token?.value || '' });

// ---------- backup ----------
function backupNow({ interactive = false } = {}) {
  if (!driveConnected()) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    try {
      if (!tokenValid()) {
        if (!interactive) { setStatus('pending-auth', PENDING_TEXT); return; }
        await signIn();
      }
      setStatus('syncing', 'backing up…');
      const seq = store.changeSeq();
      const meta = store.state.meta;
      const months = [...meta.dirtyMonths];
      const people = meta.dirtyPeople;
      const result = await uploadAll({
        api: api(),
        drive: meta.drive,
        months,
        people,
        build: {
          monthCsv: buildMonthCsv,
          peopleCsv: async () => buildPeopleCsv(),
          summary: buildSummary,
          backupJson: async () => JSON.stringify(await store.exportRaw()),
        },
      });
      await store.setDrive({ connected: true, ...result });
      await store.clearDirty(months, people, seq);
      await store.markBackedUp();
      setStatus('ok', 'backed up to drive');
    } catch (e) {
      if (e.status === 401) { saveToken(null); setStatus('pending-auth', PENDING_TEXT); }
      else setStatus('error', `backup failed: ${e.message}`);
    } finally {
      running = null;
      rerender();
    }
  })();
  return running;
}

function schedule() {
  if (!driveConnected()) return;
  clearTimeout(timer);
  timer = setTimeout(() => backupNow(), DEBOUNCE_MS);
}

export function initDrive() {
  loadToken();
  store.subscribe(schedule);
  document.addEventListener('visibilitychange', () => {
    // leaving the app is the last good moment to upload (only if we can do it without a popup)
    if (document.visibilityState === 'hidden' && driveConnected() && hasDirty() && tokenValid()) {
      clearTimeout(timer);
      backupNow();
    }
  });
  if (driveConnected()) {
    prepareSignIn().catch(() => {});
    if (hasDirty()) backupNow();
  }
}

// ---------- connect / restore / disconnect (all start from a tap) ----------
const linkFolder = (folderId) => () => store.setDrive({ connected: true, folderId, fileIds: {} });
const reportBackup = () => toast(status.text, status.state === 'ok' ? 'success' : 'error');

async function connect(closeSettings) {
  try {
    await signIn();
    const found = await api().readBackup();
    if (found) { closeSettings(); askWhichCopy(found); return; } // never overwrite an existing backup unasked
    await store.setDrive({ connected: true, folderId: null, fileIds: {} });
    await store.markAllDirty(); // first backup sends every month
    await backupNow({ interactive: true });
    reportBackup();
  } catch (e) { toast(e.message, 'error'); }
}

// drive already holds a kharchly backup (new phone, reinstall, reconnect): the user picks
function askWhichCopy(found) {
  let dump = null;
  let counts = null;
  try {
    dump = JSON.parse(found.text);
    counts = validateBackup(dump, SCHEMA_VERSION).counts;
  } catch { dump = null; } // unreadable: only "keep this phone" is offered
  openModal('backup found in drive', (body, close) => {
    body.append(
      el('div', { class: 'settings-info' }, dump
        ? `drive already has a kharchly backup from ${String(dump.exportedAt).replace('T', ' ')} (${counts.expenses} expenses).`
        : 'drive has a kharchly backup that could not be read.'),
      el('div', { class: 'settings-info' }, hasData()
        ? 'this phone has data too. pick which copy to keep:'
        : 'this phone is empty — you probably want to restore.'),
      el('div', { class: 'modal-actions' },
        dump ? el('button', {
          class: 'btn-primary',
          onClick: async () => { close(); confirmRestore(dump, counts, await currentCounts(), linkFolder(found.folderId)); },
        }, 'restore from drive') : null,
        el('button', {
          class: 'btn-ghost',
          onClick: async () => {
            close();
            try {
              await linkFolder(found.folderId)();
              await store.markAllDirty();
              await backupNow({ interactive: true });
              reportBackup();
            } catch (e) { toast(e.message, 'error'); }
          },
        }, 'keep this phone (overwrite drive)'),
      ),
    );
  });
}

async function restoreFromDrive(closeSettings) {
  try {
    if (!tokenValid()) await signIn();
    const found = await api().readBackup();
    if (!found) throw new Error(`no backup made by this app in drive/${FOLDER_NAME} — use "restore" with a downloaded backup.json instead`);
    let dump;
    try { dump = JSON.parse(found.text); } catch { throw new Error('Not a valid backup: not a JSON file'); }
    const { counts } = validateBackup(dump, SCHEMA_VERSION);
    closeSettings();
    confirmRestore(dump, counts, await currentCounts(), linkFolder(found.folderId));
  } catch (e) { toast(e.message, 'error'); }
}

async function disconnect() {
  try {
    if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.value, () => {});
    saveToken(null);
    clearTimeout(timer);
    await store.setDrive({ connected: false, folderId: null, fileIds: {} });
    setStatus('idle', '');
    rerender();
    toast('drive disconnected — files already in drive are kept', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- settings section ----------
export function renderDriveSection(closeSettings) {
  const sec = el('div', { class: 'settings-section' }, el('div', { class: 'settings-section-title' }, 'google drive'));
  if (!driveConfigured()) {
    sec.append(el('div', { class: 'settings-info' }, 'automatic drive backup needs a one-time google setup — see README.md → "google drive setup".'));
    return sec;
  }
  prepareSignIn().catch(() => {}); // so the next tap can open google's popup instantly

  if (!driveConnected()) {
    sec.append(
      el('button', { class: 'btn-primary', style: { width: '100%' }, onClick: () => connect(closeSettings) }, 'connect google drive'),
      el('div', { class: 'settings-info' },
        `backs up automatically to a "${FOLDER_NAME}" folder in your drive: summary.md, monthly csvs, people.csv, backup.json. this app can only see files it made. if drive already has a backup, you'll be asked before anything is overwritten.`),
    );
    return sec;
  }

  const days = daysSinceBackup(store.state.meta, nowTs());
  const attention = status.state === 'pending-auth' || status.state === 'error';
  const line = attention || status.state === 'syncing'
    ? status.text
    : `connected · last backup ${days === null ? 'never' : days === 0 ? 'today' : `${days}d ago`}`;
  sec.append(
    el('div', { class: 'settings-info' + (attention ? ' warn-text' : '') }, line),
    el('div', { class: 'settings-btn-row' },
      el('button', {
        class: 'btn-ghost',
        onClick: async () => { await backupNow({ interactive: true }); reportBackup(); },
      }, status.state === 'pending-auth' ? 'sign in & back up' : 'back up now'),
      el('button', { class: 'btn-ghost', onClick: () => restoreFromDrive(closeSettings) }, 'restore from drive'),
    ),
    el('button', { class: 'btn-danger-ghost', style: { width: '100%', marginTop: '8px' }, onClick: disconnect }, 'disconnect'),
  );
  return sec;
}
```

- [ ] **Step 5: `js/app.js`.** Add under `import { nowTs } from './dates.js';`:
```js
import { initDrive, driveNeedsSignIn } from './drive.js';
```
Replace:
```js
        class: 'icon-btn' + (backupDue(store.state.meta, nowTs(), hasData()) ? ' has-dot' : ''),
```
with:
```js
        class: 'icon-btn' + (backupDue(store.state.meta, nowTs(), hasData()) || driveNeedsSignIn() ? ' has-dot' : ''),
```
In `start()`, replace:
```js
  await store.boot();
  render();
```
with:
```js
  await store.boot();
  render();
  initDrive(); // after the first render: drive status can only re-render an existing screen
```

- [ ] **Step 6: `sw.js`.** Replace `const CACHE_NAME = 'kharchly-v8';` with `const CACHE_NAME = 'kharchly-v9';` (Plan 7 already used v8). In `ASSETS`, after `  './icon-512.png',` add `  './privacy.html',`. After `  './js/backup-files.js',` add:
```js
  './js/config.js',
  './js/restore-view.js',
  './js/drive-api.js',
  './js/drive.js',
```
Google's script and API calls are cross-origin. The fetch handler already ignores those (`url.origin !== self.location.origin`), so nothing else changes.

- [ ] **Step 7: Create `README.md`**

````markdown
# kharchly

One-tap expense tracker PWA — spend, lend/borrow, budgets, reports, Google Drive backup.
Live: https://kharchly.netlify.app · vanilla JS modules, IndexedDB, zero npm dependencies.

## run locally
```
python -m http.server 8080      # from this folder; ES modules don't load from file://
```
Open http://localhost:8080. If you see an old version: DevTools → Application → Service Workers → Unregister, then Ctrl+Shift+R.

## test
```
node --test
```

## deploy
Push to `main` — Netlify deploys automatically. **Bump `CACHE_NAME` in `sw.js` on every release.**
Never change the site URL or the IndexedDB name (`expense-db`): data is tied to both.

## google drive setup (one time)
1. https://console.cloud.google.com → create a project `kharchly`.
2. APIs & Services → Library → enable **Google Drive API**.
3. OAuth consent screen → External → app name `kharchly`, your email → add scope `.../auth/drive.file` → add yourself as a test user. (Leaving it in *Testing* is fine for personal use.)
4. Credentials → Create credentials → **OAuth client ID** → *Web application* → Authorized JavaScript origins: `https://kharchly.netlify.app` and `http://localhost:8080`. No redirect URIs.
5. Put the client ID in `js/config.js` (`GOOGLE_CLIENT_ID`), commit, push.
6. In the app: Settings → google drive → connect.

Backups land in a `Kharchly/` folder in your Drive: `summary.md` (read this first), `spend-YYYY-MM.csv`, `people.csv`, `backup.json` (for restore).

## docs
`docs/spec.md` (design) and `docs/plan-*.md` (implementation plans, in order).
````

- [ ] **Step 7b: Create `privacy.html`** at the site root. Use a standalone page with inline styles matching the app (dark `#0f0f0e` background, `#e8e6df` text, `#7fb069` headings, system font, max-width 640px, 16px padding, `<meta name="viewport">`). Write it in plain English with no legalese. Title: "kharchly · privacy". Include a "back to the app" link to `./`. Content, with one short paragraph or bullet list each:
  - **What kharchly stores:** your expenses, people and budgets. They are stored only on your device (browser storage).
  - **Google Drive (optional):** if you connect it, kharchly saves backup files into a `Kharchly` folder in **your own** Google Drive. It uses Google's `drive.file` permission, so it can see only the files it created, and nothing else in your Drive.
  - **What we don't do:** there is no kharchly server, account, analytics, ads or tracking, and data is never shared with anyone. The developer cannot see your data.
  - **Disconnecting:** Settings → google drive → disconnect, or Google Account → Security → third-party connections → kharchly → remove access. Deleting the `Kharchly` folder removes the backups.
  - **Contact:** leave the literal placeholder `CONTACT_EMAIL_HERE`; the user fills it in before publishing
  - **Last updated:** 2026-10-05

- [ ] **Step 7c: Help card (Plan 7 hook).** In `js/help.js`, in the `keep it safe` card, replace the line `'settings → backup every couple of weeks (the dot reminds you).'` with `'settings → google drive: backs up by itself once connected.'`. Keep the line under 90 characters (`tests/help.test.js` enforces it).

- [ ] **Step 8: Syntax check and suite**

Run: `node --check js/config.js && node --check js/restore-view.js && node --check js/drive.js && node --check js/settings.js && node --check js/app.js && node --check sw.js`. Expected: no output.
Check that every `js/*.js` file appears in `sw.js` ASSETS (25 files, which includes Plan 7's `help.js`).
Run: `node --test`. Expected: PASS, 99 tests (97 from this plan's count plus Plan 7's 2).

- [ ] **Step 9: Manual check (the user, after the Google setup and a deploy)**
  1. **Before setup** (empty client id): Settings → google drive says setup is needed. Nothing else changes and there are no console errors.
  2. **Connect:** Google's popup appears right away. Approve it. Expected: the toast says "backed up to drive", and Drive now has `Kharchly/` with `summary.md`, `backup.json`, `people.csv` and one `spend-YYYY-MM.csv` per month with data.
  3. **Auto backup:** log a spend and wait about 60 seconds, or switch away from the app. Expected: `spend-<this month>.csv` and `summary.md` update in Drive, and the other months' files are untouched (check "last modified").
  4. **Claude can read it:** ask Claude to read `Kharchly/summary.md` from your Drive. Expected: it answers a spending question from that file alone.
  5. **Token expiry:** wait more than an hour, or delete `kharchly:drive-token` in DevTools → Application → Local Storage, then log a spend. Expected: after about 60 seconds the settings dot appears, and Settings shows "backup pending — tap to sign in". "sign in & back up" fixes it (Review Focus 5).
  6. **New phone (the spec §6.3 open question).** Open the site in a different browser or profile and connect with the same Google account. Expected: the **"backup found in drive"** dialog appears (Review Focus 1). "restore from drive" → confirm → identical data.
     - If no backup is found, `drive.file` doesn't share files across installs. Tell Claude: the fallback is downloading `backup.json` from Drive and using Settings → restore.
  7. **Deleted file:** delete `summary.md` in Drive, then "back up now". Expected: it comes back once, not duplicated (Review Focus 4).
  8. **Disconnect → connect again:** expected the "backup found" dialog, and no duplicate files (Review Focus 3).
  9. **Offline:** turn on airplane mode, log a spend, then "back up now". Expected: "backup failed: …" is shown and logging still works. Online again, the next trigger uploads.

- [ ] **Step 10: Checkpoint** for the user to commit. Pushing deploys.
