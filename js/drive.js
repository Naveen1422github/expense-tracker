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
