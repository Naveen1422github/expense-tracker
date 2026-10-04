// dates — everything here is LOCAL time.
// ts format: 'YYYY-MM-DDTHH:mm' (no Z, no offset). keys are slices of it.
// never use toISOString() for keys: it converts to UTC and shifts the day
// (00:30 IST on the 1st is still the previous month in UTC).

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const toTs = (d) => `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const nowTs = () => toTs(new Date());
export const dayKey = (ts) => ts.slice(0, 10);
export const monthKey = (tsOrDay) => tsOrDay.slice(0, 7);
export const todayKey = () => dayKey(nowTs());
export const timeOf = (ts) => ts.slice(11, 16);
export const joinTs = (day, hhmm) => `${day}T${hhmm}`;

export function parseDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function tsToMs(ts) {
  const [y, m, d] = ts.slice(0, 10).split('-').map(Number);
  const [hh, mm] = ts.slice(11, 16).split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

// calendar arithmetic via setDate, so DST in other timezones can't skip a day
export function addDays(day, n) {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// weeks run Monday–Sunday
export function weekStart(day) {
  const d = parseDay(day);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayOf(d);
}

export function monthsBetween(fromDay, toDay) {
  const out = [];
  const end = monthKey(toDay);
  for (let m = monthKey(fromDay); m <= end; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function formatDayLabel(day, today = todayKey()) {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return parseDay(day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatMonthLabel(month) {
  return parseDay(`${month}-01`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
}

export const dayOfMonth = (day) => Number(day.slice(8, 10));

// whole days from a to b (b - a). pure calendar maths via UTC, so no timezone can shift it.
export function dayDiff(a, b) {
  const utc = (d) => {
    const [y, m, dd] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((utc(b) - utc(a)) / 86400000);
}
