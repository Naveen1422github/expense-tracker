import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, rankItems } from '../js/frecency.js';
import { tsToMs } from '../js/dates.js';

const NOW = tsToMs('2026-10-04T12:00');
const DAY = 86400000;
const item = (id, name) => ({ id, name });
const use = (itemId, daysAgo) => {
  const d = new Date(NOW - daysAgo * DAY);
  const p = (n) => String(n).padStart(2, '0');
  return { itemId, ts: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` };
};

test('score: more uses beat fewer at the same age', () => {
  assert.ok(score([NOW, NOW], NOW) > score([NOW], NOW));
});

test('score: a recent use beats an old one', () => {
  assert.ok(score([NOW - 1 * DAY], NOW) > score([NOW - 30 * DAY], NOW));
});

test('score: no uses scores zero', () => {
  assert.equal(score([], NOW), 0);
});

test('rankItems: one use today outranks three uses two months ago', () => {
  const items = [item('old', 'Old'), item('new', 'New')];
  const entries = [use('old', 60), use('old', 61), use('old', 62), use('new', 0)];
  assert.deepEqual(rankItems(items, entries, NOW).map((i) => i.id), ['new', 'old']);
});

test('rankItems: daily habit beats a one-off from yesterday', () => {
  const items = [item('milk', 'Milk'), item('cake', 'Cake')];
  const entries = [...[1, 2, 3, 4, 5, 6, 7].map((d) => use('milk', d)), use('cake', 1)];
  assert.equal(rankItems(items, entries, NOW)[0].id, 'milk');
});

test('rankItems: unused items come last, alphabetically; one-off entries are ignored', () => {
  const items = [item('z', 'Zebra'), item('a', 'Apple'), item('u', 'Used')];
  const entries = [use('u', 3), { itemId: null, ts: '2026-10-04T10:00' }];
  assert.deepEqual(rankItems(items, entries, NOW).map((i) => i.id), ['u', 'a', 'z']);
});

test('rankItems does not mutate its input', () => {
  const items = [item('b', 'B'), item('a', 'A')];
  rankItems(items, [], NOW);
  assert.deepEqual(items.map((i) => i.id), ['b', 'a']);
});
