// budgets — pure maths: which entries a budget covers, how much of the period has passed,
// pace status, and which 80% / 100% warnings are due. no DOM, no storage.
// matching reads the entry SNAPSHOT categoryId (and itemId), never the live item.
import { bucketKey, bucketRange, filterEntries, total } from './report-data.js';
import { dayKey, timeOf, dayDiff, weekStart, dayOfMonth, daysInMonth, monthKey } from './dates.js';

export const SCOPES = ['all', 'category', 'item'];
export const PERIODS = ['day', 'week', 'month'];
export const WARN_LEVELS = [80, 100];
const EVERYTHING = { from: '0000-01-01', to: '9999-12-31' };

// the current day / week (Mon–Sun) / month containing `day`
export function periodRange(period, day) {
  return bucketRange(bucketKey(day, period), period, EVERYTHING);
}

// share of the period that has passed, counting today (or this minute) as in progress
export function elapsedFraction(period, ts) {
  const day = dayKey(ts);
  if (period === 'day') {
    const [h, m] = timeOf(ts).split(':').map(Number);
    return (h * 60 + m + 1) / 1440;
  }
  if (period === 'week') return (dayDiff(weekStart(day), day) + 1) / 7;
  return dayOfMonth(day) / daysInMonth(monthKey(day));
}

export function matches(budget, entry) {
  if (budget.scope === 'all') return true;
  if (budget.scope === 'category') return entry.categoryId === budget.refId;
  return entry.itemId === budget.refId;
}

// USER CONTRIBUTION POINT (spec §8): when does a budget count as "ahead of pace"?
// default: spent share is more than AHEAD_MARGIN above the share of the period gone.
export const AHEAD_MARGIN = 0.10;
export function paceStatus(spentFrac, elapsedFrac) {
  if (spentFrac > 1) return 'over';
  if (spentFrac > elapsedFrac + AHEAD_MARGIN) return 'ahead';
  return 'on track';
}

export function evaluate(budget, entries, ts) {
  const today = dayKey(ts);
  const spent = total(filterEntries(entries, periodRange(budget.period, today)).filter((e) => matches(budget, e)));
  const spentFrac = spent / budget.limit;
  const elapsed = elapsedFraction(budget.period, ts);
  return { budget, spent, spentFrac, elapsed, status: paceStatus(spentFrac, elapsed), periodKey: bucketKey(today, budget.period) };
}

export function mostAtRisk(evals, n = 3) {
  return [...evals].sort((a, b) => b.spentFrac - a.spentFrac).slice(0, n);
}

// levels crossed this period that haven't been shown yet.
// warned = meta.budgetWarnings = { [budgetId]: { periodKey, level } }
export function warningsToFire(evals, warned) {
  const out = [];
  for (const ev of evals) {
    const pct = ev.spentFrac * 100;
    const level = [...WARN_LEVELS].reverse().find((l) => pct >= l);
    if (!level) continue;
    const prev = warned[ev.budget.id];
    const shown = prev && prev.periodKey === ev.periodKey ? prev.level : 0;
    if (level > shown) out.push({ budgetId: ev.budget.id, periodKey: ev.periodKey, level, eval: ev });
  }
  return out;
}
