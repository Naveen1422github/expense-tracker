// report-data — pure maths for the Reports tab: ranges, buckets, comparisons, breakdowns.
// reads ONLY entry snapshot fields (name, categoryId, tagIds), never the live item.
import { dayKey, monthKey, addDays, addMonths, weekStart, dayDiff, daysInMonth, dayOfMonth, parseDay } from './dates.js';

export const RANGE_PRESETS = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
export const GROUPS = ['day', 'week', 'month'];
const MAX_DAY_DAYS = 93;   // day bars only up to ~3 months
const MAX_WEEK_DAYS = 371; // week bars only up to ~1 year (53 weeks)

// calendar-aligned, ends today: '3M' on 2026-10-04 = 2026-08-01 .. 2026-10-04
export function rangeFor(preset, today) {
  const months = RANGE_PRESETS[preset];
  if (!months) throw new Error(`Unknown range: ${preset}`);
  return { from: `${addMonths(monthKey(today), -(months - 1))}-01`, to: today, monthAligned: true };
}

export function customRange(from, to) {
  return from <= to ? { from, to, monthAligned: false } : { from: to, to: from, monthAligned: false };
}

export const rangeDays = ({ from, to }) => dayDiff(from, to) + 1;

export function allowedGroups(range) {
  const days = rangeDays(range);
  return GROUPS.filter((g) => (g === 'day' ? days <= MAX_DAY_DAYS : g === 'week' ? days <= MAX_WEEK_DAYS : true));
}

export function defaultGroup(range) {
  const days = rangeDays(range);
  if (days <= 31) return 'day';
  if (days <= MAX_DAY_DAYS) return 'week';
  return 'month';
}

export function bucketKey(day, group) {
  if (group === 'day') return day;
  if (group === 'week') return weekStart(day);
  return monthKey(day);
}

export function bucketsInRange({ from, to }, group) {
  const keys = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = bucketKey(d, group);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}

// the days a bucket covers, clipped to the range
export function bucketRange(key, group, range) {
  let from;
  let to;
  if (group === 'day') {
    from = key;
    to = key;
  } else if (group === 'week') {
    from = key;
    to = addDays(key, 6);
  } else {
    from = `${key}-01`;
    to = `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;
  }
  return { from: from < range.from ? range.from : from, to: to > range.to ? range.to : to };
}

export function bucketLabel(key, group) {
  if (group === 'day') return String(dayOfMonth(key));
  if (group === 'week') return parseDay(key).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return parseDay(`${key}-01`).toLocaleDateString('en-IN', { month: 'short' });
}

export function filterEntries(entries, { from, to }, tagId = '') {
  return entries.filter((e) => {
    const d = dayKey(e.ts);
    return d >= from && d <= to && (!tagId || e.tagIds.includes(tagId));
  });
}

export const total = (entries) => entries.reduce((s, e) => s + e.amount, 0);

// one bar per bucket in the range, zero-filled
export function trend(entries, range, group) {
  const sums = new Map(bucketsInRange(range, group).map((k) => [k, 0]));
  for (const e of entries) {
    const k = bucketKey(dayKey(e.ts), group);
    if (sums.has(k)) sums.set(k, sums.get(k) + e.amount);
  }
  return [...sums].map(([key, value]) => ({ key, label: bucketLabel(key, group), value }));
}

export function byCategory(entries) {
  const sums = new Map();
  for (const e of entries) sums.set(e.categoryId, (sums.get(e.categoryId) || 0) + e.amount);
  const all = total(entries);
  return [...sums]
    .map(([categoryId, value]) => ({ categoryId, value, pct: all ? (value / all) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

// grouped by snapshot name (case-insensitive), so same-named one-offs merge; count = total qty
export function topItems(entries, limit = 10) {
  const groups = new Map();
  for (const e of entries) {
    const k = e.name.trim().toLowerCase();
    const g = groups.get(k) || { name: e.name, value: 0, count: 0 };
    g.value += e.amount;
    g.count += e.qty;
    groups.set(k, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function monthsSpan({ from, to }) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

// the period to compare against: same length, immediately before.
// month-aligned presets go month-for-month and cut at the same day-of-month,
// clamped to the shorter month (Oct 1–31 vs Sep 1–30).
export function previousRange(range) {
  if (range.monthAligned) {
    const n = monthsSpan(range);
    const fromMonth = addMonths(monthKey(range.from), -n);
    const toMonth = addMonths(monthKey(range.to), -n);
    const d = Math.min(dayOfMonth(range.to), daysInMonth(toMonth));
    return { from: `${fromMonth}-01`, to: `${toMonth}-${String(d).padStart(2, '0')}`, monthAligned: true };
  }
  const len = rangeDays(range);
  return { from: addDays(range.from, -len), to: addDays(range.from, -1), monthAligned: false };
}

export function compare(cur, prev) {
  return { delta: cur - prev, pct: prev ? Math.round(((cur - prev) / prev) * 100) : null };
}
