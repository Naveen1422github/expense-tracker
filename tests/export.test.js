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
