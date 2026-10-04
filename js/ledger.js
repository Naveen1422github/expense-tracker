// ledger — lend/borrow maths. pure: no DOM, no storage.
// the stored amount is ALWAYS positive; the sign comes ONLY from signOf(kind).
// balance > 0: they owe me.  balance < 0: I owe them.
export const KINDS = ['lent', 'borrowed', 'repaid_to_me', 'repaid_by_me'];

export const KIND_LABELS = {
  lent: 'lent',
  borrowed: 'borrowed',
  repaid_to_me: 'they repaid',
  repaid_by_me: 'i repaid',
};

const SIGN = { lent: 1, borrowed: -1, repaid_to_me: -1, repaid_by_me: 1 };

export function signOf(kind) {
  const s = SIGN[kind];
  if (!s) throw new Error(`Unknown kind: ${kind}`);
  return s;
}

export function balanceOf(entries, personId) {
  let b = 0;
  for (const e of entries) if (e.personId === personId) b += signOf(e.kind) * e.amount;
  return b;
}

export function balances(people, entries) {
  const sums = new Map(people.map((p) => [p.id, 0]));
  for (const e of entries) {
    if (sums.has(e.personId)) sums.set(e.personId, sums.get(e.personId) + signOf(e.kind) * e.amount);
  }
  return people.map((p) => ({ person: p, balance: sums.get(p.id) }));
}

export function totals(rows) {
  let owedToMe = 0;
  let iOwe = 0;
  for (const { balance } of rows) {
    if (balance > 0) owedToMe += balance;
    else iOwe -= balance;
  }
  return { owedToMe, iOwe };
}

// oldest -> newest; equal timestamps keep their stored (entry) order
export function history(entries, personId) {
  const mine = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.personId === personId)
    .sort((a, b) => a.e.ts.localeCompare(b.e.ts) || a.i - b.i);
  let running = 0;
  return mine.map(({ e }) => {
    running += signOf(e.kind) * e.amount;
    return { ...e, balanceAfter: running };
  });
}

// the entry that would bring this balance to zero
export function settlement(balance) {
  if (balance > 0) return { kind: 'repaid_to_me', amount: balance };
  if (balance < 0) return { kind: 'repaid_by_me', amount: -balance };
  return null;
}
