// frecency — rank items by how often AND how recently they were logged.
// each use is worth 0.5^(ageDays / HALF_LIFE_DAYS): today = 1, 14 days ago = 0.5, 28 days ago = 0.25.
// USER CONTRIBUTION POINT (spec §8): retune score() to your own habits.
import { tsToMs } from './dates.js';

export const HALF_LIFE_DAYS = 14;
const DAY_MS = 86400000;

export function score(useTimesMs, nowMs) {
  let s = 0;
  for (const t of useTimesMs) {
    const ageDays = Math.max(0, (nowMs - t) / DAY_MS);
    s += Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  }
  return s;
}

export function rankItems(items, entries, nowMs) {
  const uses = new Map();
  for (const e of entries) {
    if (!e.itemId) continue;
    if (!uses.has(e.itemId)) uses.set(e.itemId, []);
    uses.get(e.itemId).push(tsToMs(e.ts));
  }
  const scored = items.map((item) => ({ item, s: score(uses.get(item.id) || [], nowMs) }));
  scored.sort((a, b) => b.s - a.s || a.item.name.localeCompare(b.item.name));
  return scored.map((x) => x.item);
}
