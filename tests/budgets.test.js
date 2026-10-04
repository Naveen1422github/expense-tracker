import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, elapsedFraction, matches, evaluate, paceStatus, warningsToFire, mostAtRisk } from '../js/budgets.js';

process.env.TZ = 'Asia/Kolkata';

let n = 0;
const e = (ts, amount, extra = {}) => ({
  id: `e${++n}`, itemId: null, name: 'X', categoryId: 'food', tagIds: [], qty: 1, amount, ts, note: '', ...extra,
});
const budget = (over = {}) => ({ id: 'b1', scope: 'all', refId: null, period: 'month', limit: 10000, ...over });

test('periodRange: day, week (Mon–Sun, may start last month), month', () => {
  assert.deepEqual(periodRange('day', '2026-10-01'), { from: '2026-10-01', to: '2026-10-01' });
  assert.deepEqual(periodRange('week', '2026-10-01'), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(periodRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
});

test('elapsedFraction counts today as in progress', () => {
  assert.equal(elapsedFraction('month', '2026-10-04T10:00'), 4 / 31);
  assert.equal(elapsedFraction('week', '2026-10-05T10:00'), 1 / 7); // Monday
  assert.equal(elapsedFraction('week', '2026-10-04T10:00'), 1);     // Sunday
  assert.ok(Math.abs(elapsedFraction('day', '2026-10-04T12:00') - 0.5) < 0.01);
});

test('matches uses the entry snapshot category and the item id', () => {
  const entry = e('2026-10-04T10:00', 100, { itemId: 'milk', categoryId: 'groc' });
  assert.equal(matches(budget(), entry), true);
  assert.equal(matches(budget({ scope: 'category', refId: 'groc' }), entry), true);
  assert.equal(matches(budget({ scope: 'category', refId: 'food' }), entry), false);
  assert.equal(matches(budget({ scope: 'item', refId: 'milk' }), entry), true);
  assert.equal(matches(budget({ scope: 'item', refId: 'sting' }), entry), false);
});

test('evaluate: a week budget sums across the month boundary and ignores other weeks and categories', () => {
  const b = budget({ scope: 'category', refId: 'food', period: 'week', limit: 1000 });
  const es = [
    e('2026-09-28T09:00', 300),                         // Monday of this week, last month
    e('2026-10-01T09:00', 200),
    e('2026-09-27T23:59', 999),                         // previous week
    e('2026-10-01T10:00', 500, { categoryId: 'bills' }), // other category
  ];
  const ev = evaluate(b, es, '2026-10-01T12:00');
  assert.equal(ev.spent, 500);
  assert.equal(ev.spentFrac, 0.5);
  assert.equal(ev.periodKey, '2026-09-28');
  assert.equal(ev.elapsed, 4 / 7);
  assert.equal(ev.status, 'on track');
});

test('paceStatus: nothing spent is on track, overspent is over, far ahead of the clock is ahead', () => {
  assert.equal(paceStatus(0, 0.5), 'on track');
  assert.equal(paceStatus(0.5, 0.5), 'on track');
  assert.equal(paceStatus(0.9, 0.1), 'ahead');
  assert.equal(paceStatus(1.2, 0.5), 'over');
});

test('warningsToFire: once per level per period; a new period resets; a big jump fires only 100', () => {
  const ev = (frac, periodKey = '2026-10') => ({ budget: budget(), spentFrac: frac, periodKey });
  assert.deepEqual(warningsToFire([ev(0.5)], {}), []);
  assert.deepEqual(warningsToFire([ev(0.85)], {}).map((w) => w.level), [80]);
  assert.deepEqual(warningsToFire([ev(0.85)], { b1: { periodKey: '2026-10', level: 80 } }), []);
  assert.deepEqual(warningsToFire([ev(1.05)], { b1: { periodKey: '2026-10', level: 80 } }).map((w) => w.level), [100]);
  assert.deepEqual(warningsToFire([ev(0.85, '2026-11')], { b1: { periodKey: '2026-10', level: 100 } }).map((w) => w.level), [80]);
  assert.deepEqual(warningsToFire([ev(1.2)], {}).map((w) => w.level), [100]);
});

test('mostAtRisk returns the highest spent share first', () => {
  const evs = [0.2, 0.9, 1.3, 0.5].map((f, i) => ({ budget: { id: `b${i}` }, spentFrac: f }));
  assert.deepEqual(mostAtRisk(evs, 3).map((x) => x.spentFrac), [1.3, 0.9, 0.5]);
});
