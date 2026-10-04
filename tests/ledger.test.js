import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, signOf, balanceOf, balances, totals, history, settlement } from '../js/ledger.js';

let n = 0;
const entry = (personId, kind, amount, ts = '2026-10-04T10:00') => ({ id: `e${++n}`, personId, kind, amount, ts, note: '' });

test('signOf follows the spec table; unknown kinds throw', () => {
  assert.deepEqual(KINDS, ['lent', 'borrowed', 'repaid_to_me', 'repaid_by_me']);
  assert.equal(signOf('lent'), 1);
  assert.equal(signOf('borrowed'), -1);
  assert.equal(signOf('repaid_to_me'), -1);
  assert.equal(signOf('repaid_by_me'), 1);
  assert.throws(() => signOf('gift'), /Unknown kind/);
});

test('partial repayment leaves the rest owed', () => {
  const es = [entry('puru', 'lent', 100000), entry('puru', 'repaid_to_me', 40000)];
  assert.equal(balanceOf(es, 'puru'), 60000);
});

test('lend and borrow with the same person net out', () => {
  const es = [entry('amit', 'lent', 100000), entry('amit', 'borrowed', 150000)];
  assert.equal(balanceOf(es, 'amit'), -50000); // I owe Amit 500
  const es2 = [...es, entry('amit', 'repaid_by_me', 50000)];
  assert.equal(balanceOf(es2, 'amit'), 0);
});

test('over-repayment flips the balance', () => {
  const es = [entry('rahul', 'lent', 50000), entry('rahul', 'repaid_to_me', 70000)];
  assert.equal(balanceOf(es, 'rahul'), -20000);
  assert.deepEqual(settlement(-20000), { kind: 'repaid_by_me', amount: 20000 });
});

test('balances: one row per person in input order, zero when no entries, unknown persons ignored', () => {
  const people = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const rows = balances(people, [entry('a', 'lent', 500), entry('ghost', 'lent', 999)]);
  assert.deepEqual(rows.map((r) => [r.person.id, r.balance]), [['a', 500], ['b', 0]]);
});

test('totals split owed-to-me and I-owe, both positive', () => {
  const rows = [{ balance: 1600 }, { balance: 1000 }, { balance: -500 }, { balance: 0 }];
  assert.deepEqual(totals(rows), { owedToMe: 2600, iOwe: 500 });
});

test('history is oldest-first with a running balance', () => {
  const es = [
    entry('p', 'repaid_to_me', 400, '2026-10-03T09:00'),
    entry('p', 'lent', 1000, '2026-10-01T09:00'),
    entry('q', 'lent', 9999, '2026-10-02T09:00'),
  ];
  const h = history(es, 'p');
  assert.deepEqual(h.map((e) => [e.kind, e.balanceAfter]), [['lent', 1000], ['repaid_to_me', 600]]);
});

test('history keeps entry order for identical timestamps', () => {
  const es = [entry('p', 'lent', 1000, '2026-10-01T09:00'), entry('p', 'repaid_to_me', 1000, '2026-10-01T09:00')];
  assert.deepEqual(history(es, 'p').map((e) => e.balanceAfter), [1000, 0]);
});

test('settlement prefills the right repayment', () => {
  assert.deepEqual(settlement(160000), { kind: 'repaid_to_me', amount: 160000 });
  assert.deepEqual(settlement(-50000), { kind: 'repaid_by_me', amount: 50000 });
  assert.equal(settlement(0), null);
});
