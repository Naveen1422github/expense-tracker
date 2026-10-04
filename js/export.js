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
