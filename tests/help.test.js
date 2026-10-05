import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP_CARDS, APP_URL } from '../js/help.js';

test('help cards are short: title + 1..3 lines, each line under 90 chars', () => {
  assert.ok(HELP_CARDS.length >= 5 && HELP_CARDS.length <= 8);
  for (const c of HELP_CARDS) {
    assert.equal(typeof c.title, 'string');
    assert.ok(c.lines.length >= 1 && c.lines.length <= 3, c.title);
    for (const l of c.lines) assert.ok(l.length < 90, `${c.title}: "${l}"`);
  }
});

test('app url is the public https site', () => {
  assert.match(APP_URL, /^https:\/\/kharchly\.netlify\.app\/$/);
});
