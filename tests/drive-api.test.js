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
