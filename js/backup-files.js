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
