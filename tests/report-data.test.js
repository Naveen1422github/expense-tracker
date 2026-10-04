import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeFor, customRange, rangeDays, allowedGroups, defaultGroup, bucketsInRange, bucketRange, bucketLabel,
  filterEntries, total, trend, byCategory, topItems, previousRange, compare,
} from '../js/report-data.js';

process.env.TZ = 'Asia/Kolkata';

let n = 0;
const e = (ts, amount, extra = {}) => ({
  id: `e${++n}`, itemId: null, name: 'X', categoryId: 'food', tagIds: [], qty: 1, amount, ts, note: '', ...extra,
});

test('presets are calendar-aligned and end today', () => {
  assert.deepEqual(rangeFor('1M', '2026-10-04'), { from: '2026-10-01', to: '2026-10-04', monthAligned: true });
  assert.equal(rangeFor('3M', '2026-10-04').from, '2026-08-01');
  assert.equal(rangeFor('6M', '2026-10-04').from, '2026-05-01');
  assert.equal(rangeFor('1Y', '2026-10-04').from, '2025-11-01');
  assert.throws(() => rangeFor('2W', '2026-10-04'), /Unknown range/);
});

test('customRange swaps reversed dates; rangeDays is inclusive', () => {
  assert.deepEqual(customRange('2026-10-10', '2026-10-01'), { from: '2026-10-01', to: '2026-10-10', monthAligned: false });
  assert.equal(rangeDays({ from: '2026-10-01', to: '2026-10-10' }), 10);
  assert.equal(rangeDays({ from: '2026-10-04', to: '2026-10-04' }), 1);
});

test('allowed and default groups follow range length', () => {
  const m1 = rangeFor('1M', '2026-10-31');
  const m3 = rangeFor('3M', '2026-10-31'); // 92 days
  const m6 = rangeFor('6M', '2026-10-31');
  const y1 = rangeFor('1Y', '2026-10-31'); // 365 days
  assert.deepEqual(allowedGroups(m1), ['day', 'week', 'month']);
  assert.equal(defaultGroup(m1), 'day');
  assert.deepEqual(allowedGroups(m3), ['day', 'week', 'month']);
  assert.equal(defaultGroup(m3), 'week');
  assert.deepEqual(allowedGroups(m6), ['week', 'month']);
  assert.equal(defaultGroup(m6), 'month');
  assert.deepEqual(allowedGroups(y1), ['week', 'month']);
  assert.equal(defaultGroup(y1), 'month');
  assert.deepEqual(allowedGroups(customRange('2020-01-01', '2026-10-04')), ['month']);
});

test('week buckets run Monday–Sunday across a year boundary', () => {
  assert.deepEqual(bucketsInRange({ from: '2025-12-25', to: '2026-01-06' }, 'week'), ['2025-12-22', '2025-12-29', '2026-01-05']);
  assert.deepEqual(bucketsInRange({ from: '2026-09-30', to: '2026-10-02' }, 'day'), ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(bucketsInRange(rangeFor('3M', '2026-10-04'), 'month'), ['2026-08', '2026-09', '2026-10']);
});

test('bucketRange is clipped to the range', () => {
  const range = { from: '2026-10-01', to: '2026-10-04' };
  assert.deepEqual(bucketRange('2026-09-28', 'week', range), { from: '2026-10-01', to: '2026-10-04' });
  assert.deepEqual(bucketRange('2026-02', 'month', { from: '2026-01-01', to: '2026-12-31' }), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(bucketRange('2026-10-02', 'day', range), { from: '2026-10-02', to: '2026-10-02' });
});

test('bucketLabel', () => {
  assert.equal(bucketLabel('2026-10-04', 'day'), '4');
  assert.match(bucketLabel('2026-09-28', 'week'), /28/);
  assert.match(bucketLabel('2026-10', 'month'), /Oct/);
});

test('trend zero-fills empty buckets and sums by bucket; entries outside the range are ignored', () => {
  const range = { from: '2026-10-01', to: '2026-10-03' };
  const es = [e('2026-10-01T09:00', 100), e('2026-10-01T22:00', 50), e('2026-10-03T08:00', 25), e('2026-09-30T23:59', 999)];
  assert.deepEqual(trend(es, range, 'day').map((b) => [b.key, b.value]), [['2026-10-01', 150], ['2026-10-02', 0], ['2026-10-03', 25]]);
});

test('filterEntries by range and by snapshot tag', () => {
  const es = [e('2026-10-01T09:00', 100, { tagIds: ['unh'] }), e('2026-10-02T09:00', 50), e('2026-11-01T00:30', 7, { tagIds: ['unh'] })];
  const range = { from: '2026-10-01', to: '2026-10-31' };
  assert.equal(total(filterEntries(es, range)), 150);
  assert.equal(total(filterEntries(es, range, 'unh')), 100);
});

test('byCategory sorts by amount with percentages', () => {
  const cats = byCategory([
    e('2026-10-01T09:00', 300, { categoryId: 'food' }),
    e('2026-10-01T09:00', 100, { categoryId: 'bills' }),
    e('2026-10-02T09:00', 100, { categoryId: 'food' }),
  ]);
  assert.deepEqual(cats.map((c) => [c.categoryId, c.value, c.pct]), [['food', 400, 80], ['bills', 100, 20]]);
  assert.deepEqual(byCategory([]), []);
});

test('topItems groups by snapshot name (case-insensitive), counts qty, ranks by amount', () => {
  const top = topItems([
    e('2026-10-01T09:00', 6000, { name: 'Milk', qty: 2 }),
    e('2026-10-02T09:00', 3000, { name: 'milk' }),
    e('2026-10-02T09:00', 34000, { name: 'Hardware' }),
  ]);
  assert.deepEqual(top.map((t) => [t.name, t.value, t.count]), [['Hardware', 34000, 1], ['Milk', 9000, 3]]);
  assert.equal(topItems([e('2026-10-01T09:00', 1, { name: 'a' }), e('2026-10-01T09:00', 2, { name: 'b' })], 1).length, 1);
});

test('previousRange: month-aligned compares the same point of the previous period', () => {
  assert.deepEqual(previousRange(rangeFor('1M', '2026-10-04')), { from: '2026-09-01', to: '2026-09-04', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('1M', '2026-10-31')), { from: '2026-09-01', to: '2026-09-30', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('1M', '2026-03-31')), { from: '2026-02-01', to: '2026-02-28', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('1M', '2028-03-31')), { from: '2028-02-01', to: '2028-02-29', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('3M', '2026-10-04')), { from: '2026-05-01', to: '2026-07-04', monthAligned: true });
  assert.deepEqual(previousRange(rangeFor('1Y', '2026-10-04')), { from: '2024-11-01', to: '2025-10-04', monthAligned: true });
});

test('previousRange: custom ranges use the same number of days just before', () => {
  assert.deepEqual(previousRange(customRange('2026-10-05', '2026-10-11')), { from: '2026-09-28', to: '2026-10-04', monthAligned: false });
});

test('compare gives a rounded percentage, or null when there is nothing to compare with', () => {
  assert.deepEqual(compare(11200, 10000), { delta: 1200, pct: 12 });
  assert.deepEqual(compare(5000, 10000), { delta: -5000, pct: -50 });
  assert.deepEqual(compare(5000, 0), { delta: 5000, pct: null });
});
