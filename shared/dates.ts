// Calendar dates are 'yyyy-mm-dd' strings in the person's own time zone (Europe/London
// unless they change it). Instants are epoch milliseconds.

export const DEFAULT_TZ = 'Europe/London';

const ymdCache = new Map<string, Intl.DateTimeFormat>();
const partsCache = new Map<string, Intl.DateTimeFormat>();

function ymdFmt(tz: string): Intl.DateTimeFormat {
  let f = ymdCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    ymdCache.set(tz, f);
  }
  return f;
}

function partsFmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date at an instant, in `tz`. */
export function localDate(ms: number, tz: string): string {
  return ymdFmt(tz).format(new Date(ms));
}

/** Minutes past local midnight at an instant. */
export function localMinutes(ms: number, tz: string): number {
  const p = Object.fromEntries(partsFmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

/** How far `tz` is ahead of UTC at an instant, in ms. */
function offsetAt(ms: number, tz: string): number {
  const p = Object.fromEntries(partsFmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant of a local date and time (minutes past midnight). Times skipped by a clock
 *  change land just after it; repeated ones take the first. */
export function localToMs(iso: string, minutes: number, tz: string): number {
  const guess = toUtc(iso) + minutes * 60_000;
  let ms = guess - offsetAt(guess, tz);
  ms = guess - offsetAt(ms, tz);
  return ms;
}

const toUtc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

export function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Same day of the month `n` months on, held to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(iso: string, n: number, anchorDay = +iso.slice(8, 10)): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + n;
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(anchorDay, last));
  return first.toISOString().slice(0, 10);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso: string): number {
  return new Date(toUtc(iso)).getUTCDay();
}

/** The Monday on or before a date. */
export function weekStart(iso: string): string {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}

export function monthStart(iso: string): string {
  return iso.slice(0, 8) + '01';
}

export function monthEnd(iso: string): string {
  return addDays(addMonths(monthStart(iso), 1), -1);
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s)) && addDays(s, 0) === s;
}

export function isHm(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export const hmToMinutes = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
export const minutesToHm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Whether `minutes` falls in a quiet window that may wrap midnight (22:00–08:00). */
export function inWindow(minutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Tue 14 Oct", with the year when it isn't `thisYear`. */
export function niceDate(iso: string, today?: string): string {
  const d = new Date(toUtc(iso));
  const year = today && today.slice(0, 4) !== iso.slice(0, 4) ? ` ${iso.slice(0, 4)}` : '';
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
}

/** A span of days in words: "3 days", "2 weeks", "5 months", "1 year". */
export function spanWords(days: number): string {
  const abs = Math.abs(Math.round(days));
  if (abs === 1) return '1 day';
  if (abs < 14) return `${abs} days`;
  if (abs < 63) return `${Math.round(abs / 7)} weeks`;
  if (abs < 365 * 2) {
    const m = Math.round(abs / 30.44);
    return m === 12 ? '1 year' : `${m} months`;
  }
  return `${Math.round(abs / 365.25)} years`;
}

/** "today", "yesterday", "in 3 days", "2 weeks ago" … relative to `today`. */
export function relativeDay(iso: string, today: string): string {
  const n = daysBetween(today, iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${spanWords(n)}` : `${spanWords(n)} ago`;
}
