import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaise, groupIndian, formatINR, toRupeesString, toInputValue } from '../js/money.js';

test('toPaise parses rupee strings into integer paise', () => {
  assert.equal(toPaise('45.5'), 4550);
  assert.equal(toPaise('45.50'), 4550);
  assert.equal(toPaise('45'), 4500);
  assert.equal(toPaise('45.'), 4500);
  assert.equal(toPaise('.5'), 50);
  assert.equal(toPaise('₹1,234.05'), 123405);
  assert.equal(toPaise(' 30 '), 3000);
  assert.equal(toPaise(12.5), 1250);
  assert.equal(toPaise('0'), 0);
});

test('toPaise rejects invalid input', () => {
  for (const bad of ['', '.', 'abc', '-5', '1.234', '1.2.3', null, undefined]) {
    assert.equal(toPaise(bad), null, `expected null for ${String(bad)}`);
  }
});

test('paise sums are exact where float sums drift', () => {
  assert.notEqual(0.1 + 0.2, 0.3);
  assert.equal(toPaise('0.1') + toPaise('0.2'), toPaise('0.3'));
});

test('groupIndian uses lakh/crore grouping', () => {
  assert.equal(groupIndian('0'), '0');
  assert.equal(groupIndian('999'), '999');
  assert.equal(groupIndian('1000'), '1,000');
  assert.equal(groupIndian('100000'), '1,00,000');
  assert.equal(groupIndian('123456789'), '12,34,56,789');
});

test('formatINR', () => {
  assert.equal(formatINR(4550), '₹45.50');
  assert.equal(formatINR(4500), '₹45');
  assert.equal(formatINR(4500, { fixed: true }), '₹45.00');
  assert.equal(formatINR(12345678900, { fixed: true }), '₹12,34,56,789.00');
  assert.equal(formatINR(-50000), '-₹500');
  assert.equal(formatINR(0), '₹0');
  assert.equal(formatINR(5), '₹0.05');
});

test('toRupeesString and toInputValue', () => {
  assert.equal(toRupeesString(4550), '45.50');
  assert.equal(toRupeesString(5), '0.05');
  assert.equal(toRupeesString(-150), '-1.50');
  assert.equal(toInputValue(4500), '45');
  assert.equal(toInputValue(4550), '45.50');
});
