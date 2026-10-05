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
