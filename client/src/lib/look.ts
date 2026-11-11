// How the app looks on this device (light by default; each phone can choose), and small
// bits of wording shared by the screens.

import { DAYS, DAYS_LONG, MONTHS, daysBetween, niceDate, weekday } from '../../../shared/dates';

export type Look = 'light' | 'dark' | 'auto';
const KEY = 'nest-look';

export function getLook(): Look {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'auto' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function applyLook(look: Look = getLook()): void {
  const dark = look === 'dark' || (look === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#1F1B18' : '#F5EFE6');
}

export function setLook(look: Look): void {
  try {
    localStorage.setItem(KEY, look);
  } catch {
    /* private browsing: it just won't be remembered */
  }
  applyLook(look);
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyLook());

const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Wednesday 11 November" */
export function longDate(iso: string): string {
  return `${DAYS_LONG[weekday(iso)]} ${+iso.slice(8)} ${FULL[+iso.slice(5, 7) - 1]}`;
}

/** "November 2026" */
export function monthName(ym: string): string {
  return `${FULL[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
}
export const monthShort = (ym: string) => MONTHS[+ym.slice(5, 7) - 1];

export interface DueWords {
  label: string;
  tone: 'warm' | 'sage' | '';
}

/** A due date the way you'd say it: "Overdue", "Today", "Tomorrow", "Sat", "Sat 15 Nov". */
export function dueWords(iso: string, today: string): DueWords {
  const n = daysBetween(today, iso);
  if (n < 0) return { label: n === -1 ? 'Yesterday' : `${-n} days late`, tone: 'warm' };
  if (n === 0) return { label: 'Today', tone: 'warm' };
  if (n === 1) return { label: 'Tomorrow', tone: 'warm' };
  if (n < 7) return { label: DAYS[weekday(iso)], tone: '' };
  return { label: niceDate(iso, today), tone: '' };
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

export const greeting = (hour: number) => (hour < 5 ? 'Still up' : hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening');

/** Pence as you'd type it: 1250 → "12.50", 4000 → "40". */
export const penceText = (p: number | null | undefined) => (p == null ? '' : (p / 100).toFixed(p % 100 ? 2 : 0));

/** Puts the cursor in a box as soon as it appears. */
export function focusNow(node: HTMLElement): void {
  node.focus({ preventScroll: true });
}
