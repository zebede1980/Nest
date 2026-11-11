// Things worked out from the house: lookups, the order lists come in, and the sums.

import { countsForProgress, isRepeating, jobSpent, jobTotal, paidOn, type Cost, type House, type Job, type Person, type Photo, type Room, type Size } from '../../../shared/model';
import { addDays, weekday } from '../../../shared/dates';

export const roomOf = (h: House, id: number | null): Room | undefined => (id == null ? undefined : h.rooms.find((r) => r.id === id));
export const personOf = (h: House, id: number | null): Person | undefined => (id == null ? undefined : h.people.find((p) => p.id === id));
export const jobOf = (h: House, id: number | null): Job | undefined => (id == null ? undefined : h.jobs.find((j) => j.id === id));
export const liveRooms = (h: House) => h.rooms.filter((r) => !r.archived);

/** The order a to-do list comes in: dated jobs first, soonest at the top, then the newest. */
export function byDue(a: Job, b: Job): number {
  if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : b.createdAt - a.createdAt;
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return b.createdAt - a.createdAt;
}
export const byDone = (a: Job, b: Job) => (b.doneAt ?? 0) - (a.doneAt ?? 0);

export const todo = (h: House) => h.jobs.filter((j) => j.status === 'todo').sort(byDue);
export const done = (h: House) => h.jobs.filter((j) => j.status === 'done').sort(byDone);
export const ideas = (h: House) => h.jobs.filter((j) => j.status === 'idea').sort((a, b) => b.createdAt - a.createdAt);

/** The earliest date anything about the job is due: the job itself or one of its open steps. */
export function nextDate(job: Job): string | null {
  let d = job.dueDate;
  for (const s of job.steps) if (s.dueDate && !s.doneAt && (!d || s.dueDate < d)) d = s.dueDate;
  return d;
}

export interface Progress {
  done: number;
  total: number;
  pct: number;
}

export function progress(jobs: Job[]): Progress {
  const counted = jobs.filter(countsForProgress);
  const n = counted.filter((j) => j.status === 'done').length;
  return { done: n, total: counted.length, pct: counted.length ? Math.round((n / counted.length) * 100) : 0 };
}

export interface Money {
  /** What has gone out so far. */
  spent: number;
  /** What everything on the list (done or not) adds up to. */
  planned: number;
  /** Still to spend on jobs that aren't done. */
  toSpend: number;
  /** Bills from people we pay, not yet paid off. */
  owed: number;
}

export function moneyFor(h: House, jobs: Job[] = h.jobs): Money {
  const m: Money = { spent: 0, planned: 0, toSpend: 0, owed: 0 };
  for (const job of jobs) {
    if (job.status === 'idea') continue;
    const total = jobTotal(job);
    const spent = jobSpent(job, h.payments);
    m.planned += total;
    m.spent += spent;
    if (job.status === 'todo') m.toSpend += Math.max(0, total - spent);
    for (const c of job.costs) if (c.kind === 'trade') m.owed += Math.max(0, c.amount - paidOn(c, h.payments));
  }
  return m;
}

export type CostState = 'bought' | 'tobuy' | 'paid' | 'part' | 'topay';
export function costState(c: Cost, h: House): CostState {
  if (c.kind === 'item') return c.boughtAt ? 'bought' : 'tobuy';
  const paid = paidOn(c, h.payments);
  return paid >= c.amount && c.amount > 0 ? 'paid' : paid > 0 ? 'part' : 'topay';
}
export const COST_WORDS: Record<CostState, string> = { bought: 'Bought', tobuy: 'To buy', paid: 'Paid', part: 'Part paid', topay: 'To pay' };
export const costTone = (s: CostState) => (s === 'bought' || s === 'paid' ? 'sage' : 'warm');

/** A job's own photos (not its receipts), oldest first. */
export const jobPhotos = (h: House, jobId: number): Photo[] => h.photos.filter((p) => p.jobId === jobId && p.costId == null).sort((a, b) => a.createdAt - b.createdAt);
export const receipts = (h: House, costId: number): Photo[] => h.photos.filter((p) => p.costId === costId);
export const roomPhotos = (h: House, roomId: number): Photo[] => h.photos.filter((p) => p.roomId === roomId && p.jobId == null).sort((a, b) => a.createdAt - b.createdAt);

export const stepsDone = (job: Job) => job.steps.filter((s) => s.doneAt).length;

/** The little line under a job's name: "Kitchen · Nia · 2 of 5 steps". */
export function jobMeta(h: House, job: Job, opts: { room?: boolean } = {}): string {
  const bits: string[] = [];
  if (opts.room !== false) {
    const room = roomOf(h, job.roomId);
    if (room) bits.push(room.name);
  }
  const who = personOf(h, job.assigneeId);
  if (who) bits.push(who.displayName);
  if (job.steps.length) bits.push(`${stepsDone(job)} of ${job.steps.length} steps`);
  if (isRepeating(job)) bits.push('repeats');
  return bits.join(' · ');
}

/** The Saturday of this weekend (today, if it's already the weekend). */
export function thisSaturday(today: string): string {
  const wd = weekday(today);
  return wd === 0 || wd === 6 ? today : addDays(today, 6 - wd);
}

export const countBySize = (jobs: Job[], size: Size) => jobs.filter((j) => j.size === size).length;

/** People get a colour each, in the order they joined. */
export const PERSON_COLOURS = ['var(--accent)', 'var(--sage)', '#8a7fb0', '#5f9a96', '#c49a3c'];
export const personColour = (h: House, id: number) => PERSON_COLOURS[Math.max(0, h.people.findIndex((p) => p.id === id)) % PERSON_COLOURS.length];
