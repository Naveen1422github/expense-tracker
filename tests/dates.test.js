import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toTs, dayKey, monthKey, timeOf, joinTs, parseDay, tsToMs, addDays, addMonths,
  weekStart, monthsBetween, formatDayLabel, formatMonthLabel,
  daysInMonth, dayOfMonth, dayDiff,
} from '../js/dates.js';

// run every test as if the phone is in India (UTC+5:30), where UTC-based keys go wrong
process.env.TZ = 'Asia/Kolkata';

test('00:30 local on the 1st belongs to the new month and new day', () => {
  const d = new Date(2026, 10, 1, 0, 30); // 1 Nov 2026, 00:30 local
  // sanity: the trap is real in this timezone (UTC is still 31 Oct)
  assert.equal(d.toISOString().slice(0, 10), '2026-10-31');
  const ts = toTs(d);
  assert.equal(ts, '2026-11-01T00:30');
  assert.equal(dayKey(ts), '2026-11-01');
  assert.equal(monthKey(ts), '2026-11');
  assert.equal(timeOf(ts), '00:30');
});

test('joinTs / parseDay / tsToMs round-trip in local time', () => {
  assert.equal(joinTs('2026-10-04', '09:05'), '2026-10-04T09:05');
  const day = parseDay('2026-10-04');
  assert.deepEqual([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()], [2026, 9, 4, 0]);
  assert.equal(tsToMs('2026-10-04T09:05'), new Date(2026, 9, 4, 9, 5).getTime());
});

test('addDays crosses month, year and leap-day boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-10-04', 0), '2026-10-04');
});

test('addMonths crosses year boundaries', () => {
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-10', -3), '2026-07');
});

test('weekStart is the Monday on or before the day, across month/year boundaries', () => {
  assert.equal(weekStart('2026-10-05'), '2026-10-05'); // Monday
  assert.equal(weekStart('2026-10-04'), '2026-09-28'); // Sunday -> previous Monday, previous month
  assert.equal(weekStart('2026-01-01'), '2025-12-29'); // Thursday -> previous year
});

test('monthsBetween lists every month a range touches', () => {
  assert.deepEqual(monthsBetween('2026-08-15', '2026-10-04'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(monthsBetween('2026-12-20', '2027-01-02'), ['2026-12', '2027-01']);
  assert.deepEqual(monthsBetween('2026-10-01', '2026-10-31'), ['2026-10']);
});

test('labels', () => {
  assert.equal(formatDayLabel('2026-10-04', '2026-10-04'), 'Today');
  assert.equal(formatDayLabel('2026-10-03', '2026-10-04'), 'Yesterday');
  assert.match(formatDayLabel('2026-09-28', '2026-10-04'), /28/);
  assert.match(formatMonthLabel('2026-10'), /Oct/);
});

test('daysInMonth, dayOfMonth, dayDiff', () => {
  assert.equal(daysInMonth('2026-09'), 30);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-12'), 31);
  assert.equal(dayOfMonth('2026-10-04'), 4);
  assert.equal(dayDiff('2026-10-01', '2026-10-04'), 3);
  assert.equal(dayDiff('2026-10-04', '2026-10-01'), -3);
  assert.equal(dayDiff('2025-12-31', '2026-01-01'), 1);
  assert.equal(dayDiff('2028-02-28', '2028-03-01'), 2);
});
