// one-time tips — shown inline on the spend tab after real actions, one at a time, never as a toast
// (a toast would replace the undo toast). seen keys live in localStorage: a per-device convenience.
export const TIPS = [
  { key: 'hold', text: 'tip: hold an item to change qty, amount or date, or add a note.', when: (c) => c.logs >= 1 },
  { key: 'edit', text: 'tip: logged the wrong thing? tap it in the list below to fix it.', when: (c) => c.logs >= 3 },
  { key: 'swipe', text: 'tip: swipe left or right for people and reports.', when: (c) => c.logs >= 5 },
  { key: 'help', text: 'tip: tap ? at the top any time for the quick guide.', when: (c) => c.logs >= 8 },
];

// first unseen tip whose condition holds, else null. ctx: { logs }
export function nextTip(ctx, seen) {
  return TIPS.find((t) => !seen.has(t.key) && t.when(ctx)) || null;
}

const KEY = 'kharchly:tips';

export function seenTips() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(TIPS.map((t) => t.key)); }
}

export function markTipSeen(key) {
  try { localStorage.setItem(KEY, JSON.stringify([...seenTips(), key])); } catch { /* storage blocked — fine */ }
}
