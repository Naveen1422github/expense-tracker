import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIPS, nextTip } from '../js/tips.js';

test('no tip before the first log; then tips unlock in order by log count', () => {
  assert.equal(nextTip({ logs: 0 }, new Set()), null);
  assert.equal(nextTip({ logs: 1 }, new Set()).key, 'hold');
  assert.equal(nextTip({ logs: 3 }, new Set(['hold'])).key, 'edit');
  assert.equal(nextTip({ logs: 2 }, new Set(['hold'])), null);
  assert.equal(nextTip({ logs: 99 }, new Set(TIPS.map((t) => t.key))), null);
});

test('tips are short one-liners with unique keys', () => {
  assert.equal(new Set(TIPS.map((t) => t.key)).size, TIPS.length);
  for (const t of TIPS) assert.ok(t.text.length < 80, t.key);
});
