// Who gets reminded about what, and in which words. Pure sums: the scheduler does the sending.

import { DAYS_LONG, daysBetween, niceDate, weekday } from './dates.js';
import { SIZE_LONG, type Job, type RemindChoice, type Room, type Size, type Step } from './model.js';

export type RemindKind = 'ahead' | 'today' | 'overdue';

export interface Reminder {
  kind: RemindKind;
  /** Days until it's due (ahead) or days late (overdue); 0 today. */
  days: number;
  job: Job;
  /** Set when it's one step of the job that's due, not the job itself. */
  step: Step | null;
  dueDate: string;
}

/** How many days ahead a heads-up comes: the bigger the job, the more warning. */
export function leadDays(size: Size, isStep: boolean): number[] {
  if (isStep || size === 'evening') return [1];
  return size === 'weekend' ? [2] : [7, 1];
}

/** Late jobs get the odd nag, not a daily one: the day after, day 3, then weekly. */
export const nagDay = (daysLate: number) => daysLate === 1 || daysLate === 3 || (daysLate >= 7 && daysLate % 7 === 0);

/** A job is "mine" if it's given to me, or to nobody. */
export const isMine = (job: Pick<Job, 'assigneeId'>, userId: number) => job.assigneeId === null || job.assigneeId === userId;

function due(job: Job): { step: Step | null; dueDate: string }[] {
  const out: { step: Step | null; dueDate: string }[] = [];
  if (job.dueDate) out.push({ step: null, dueDate: job.dueDate });
  for (const step of job.steps) if (step.dueDate && !step.doneAt) out.push({ step, dueDate: step.dueDate });
  return out;
}

/** What one person should hear about today. */
export function remindersFor(jobs: Job[], userId: number, choice: RemindChoice, today: string): Reminder[] {
  if (choice === 'off') return [];
  const out: Reminder[] = [];
  for (const job of jobs) {
    if (job.status !== 'todo') continue;
    if (choice === 'mine' && !isMine(job, userId)) continue;
    for (const { step, dueDate } of due(job)) {
      const days = daysBetween(today, dueDate);
      if (days === 0) out.push({ kind: 'today', days: 0, job, step, dueDate });
      else if (days > 0 && leadDays(job.size, !!step).includes(days)) out.push({ kind: 'ahead', days, job, step, dueDate });
      else if (days < 0 && nagDay(-days)) out.push({ kind: 'overdue', days: -days, job, step, dueDate });
    }
  }
  const order: Record<RemindKind, number> = { today: 0, overdue: 1, ahead: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || (a.kind === 'overdue' ? b.days - a.days : a.days - b.days) || a.job.id - b.job.id);
}

/** The number on the app icon: my jobs and steps due today or overdue. */
export function needsMe(jobs: Job[], userId: number, today: string): number {
  let n = 0;
  for (const job of jobs) {
    if (job.status !== 'todo' || !isMine(job, userId)) continue;
    n += due(job).filter((d) => d.dueDate <= today).length;
  }
  return n;
}

function when(r: Reminder): string {
  if (r.kind === 'today') return 'Today';
  if (r.kind === 'overdue') return 'Overdue';
  if (r.days === 1) return 'Tomorrow';
  if (r.days === 7) return 'A week today';
  return r.days < 7 ? `This ${DAYS_LONG[weekday(r.dueDate)]}` : `In ${r.days} days`;
}

const name = (r: Reminder) => (r.step ? `${r.step.title} (${r.job.title})` : r.job.title);

/** One reminder says what and where; several are rolled into a single push. */
export function reminderWords(list: Reminder[], rooms: Room[], today: string): { title: string; body: string; url: string; tag: string } {
  const roomName = (job: Job) => rooms.find((r) => r.id === job.roomId)?.name ?? null;
  if (list.length === 1) {
    const r = list[0];
    const where = [r.step ? r.job.title : null, roomName(r.job), r.step ? null : SIZE_LONG[r.job.size].toLowerCase()].filter(Boolean).join(' · ');
    const title = r.kind === 'overdue' ? `⏰ Still waiting: ${r.step?.title ?? r.job.title}` : `${r.kind === 'today' ? '🔨' : '🗓️'} ${when(r)}: ${r.step?.title ?? r.job.title}`;
    const late = r.kind === 'overdue' ? `Was due ${r.days === 1 ? 'yesterday' : niceDate(r.dueDate, today)}` : null;
    return { title, body: [late, where].filter(Boolean).join(' · '), url: `/job/${r.job.id}`, tag: `job-${r.job.id}` };
  }
  const lines = list.slice(0, 4).map((r) => `${when(r)}: ${name(r)}`);
  if (list.length > 4) lines.push(`…and ${list.length - 4} more`);
  return { title: `🏡 ${list.length} jobs to keep in mind`, body: lines.join('\n'), url: '/', tag: 'reminders' };
}
