// The reminder clock. Every minute it works out, for each person, whether today's
// reminders are due and whether someone else has just finished a job, and sends a push.
// The phone does no timing of its own (iOS gives web apps none), so a locked or closed
// phone makes no difference.

import { hmToMinutes, localDate, localMinutes, niceDate } from '../../shared/dates.js';
import { needsMe, reminderWords, remindersFor, type Reminder } from '../../shared/reminders.js';
import type { Job } from '../../shared/model.js';
import type { User } from './accounts.js';
import { keyHandled, notify, type NotifyDeps, type SentNotification } from './notify.js';
import type { Ctx } from './http.js';

/** Reminders come at the person's chosen time, or later that day if the server was down
 *  then, but never after this: nobody wants a to-do list at bedtime. */
const LATEST_MIN = 21 * 60;
/** A finished job is announced after this long, so a slip of the thumb can be undone first. */
export const DONE_SETTLE_MS = 45_000;
/** ...and not at all if it's older than this (the server was down; the moment has gone). */
const DONE_WINDOW_MS = 30 * 60_000;

/** What one person would be reminded of right now (nothing is sent). */
export function plan(ctx: Pick<Ctx, 'db' | 'now' | 'house'>, user: User): { today: string; reminders: Reminder[]; due: boolean; badge: number } {
  const now = ctx.now();
  const s = user.settings;
  const today = localDate(now, s.tz);
  const minutes = localMinutes(now, s.tz);
  const jobs = ctx.house.jobs();
  const reminders = remindersFor(jobs, user.id, s.remind, today);
  const due = reminders.length > 0 && minutes >= hmToMinutes(s.remindAt) && minutes < LATEST_MIN && !keyHandled(ctx.db, user.id, `remind:${today}`);
  return { today, reminders, due, badge: needsMe(jobs, user.id, today) };
}

const who = (ctx: Pick<Ctx, 'accounts'>, id: number | null) => (id ? ctx.accounts.findById(id)?.displayName : null) ?? 'Someone';

const CHEERS = ['Nice one.', 'One less on the list.', 'Kettle on?', 'That one’s been waiting.', 'Onwards!'];

/** Tells everyone else (who wants to know) that a job was finished. */
async function announceDone(ctx: Ctx, user: User, jobs: Job[], rooms: Map<number, string>, badge: number): Promise<SentNotification[]> {
  if (!user.settings.headsUp) return [];
  const now = ctx.now();
  const sent: SentNotification[] = [];
  for (const job of jobs) {
    if (job.status !== 'done' || !job.doneAt || job.doneBy === user.id || job.doneBy === null) continue;
    if (job.doneAt > now - DONE_SETTLE_MS || job.doneAt < now - DONE_WINDOW_MS) continue;
    const room = job.roomId ? rooms.get(job.roomId) : null;
    const r = await notify(
      ctx.notifyDeps,
      user.id,
      { title: `🎉 ${who(ctx, job.doneBy)} finished “${job.title}”`, body: [room, CHEERS[job.id % CHEERS.length]].filter(Boolean).join(' · '), url: `/job/${job.id}`, tag: `done-${job.id}`, badge },
      { kind: 'done', jobIds: [job.id], keys: [`done:${job.id}:${job.doneAt}`], ttl: 6 * 3600 },
    );
    if (r) sent.push(r);
  }
  return sent;
}

/** Sends whatever is due for one person. */
export async function nudgeUser(ctx: Ctx, user: User): Promise<SentNotification[]> {
  const { today, reminders, due, badge } = plan(ctx, user);
  const rooms = ctx.house.rooms();
  const sent: SentNotification[] = [];
  if (due) {
    const words = reminderWords(reminders, rooms, today);
    const r = await notify(ctx.notifyDeps, user.id, { ...words, badge }, { kind: 'reminder', jobIds: [...new Set(reminders.map((x) => x.job.id))], keys: [`remind:${today}`] });
    if (r) sent.push(r);
  }
  sent.push(...(await announceDone(ctx, user, ctx.house.jobs(), new Map(rooms.map((r) => [r.id, r.name])), badge)));
  return sent;
}

/** Straight away, when someone gives a job to somebody else. */
export async function announceAssigned(ctx: Ctx, job: Job, by: User): Promise<SentNotification | null> {
  const to = job.assigneeId ? ctx.accounts.findById(job.assigneeId) : null;
  if (!to || to.id === by.id || to.disabled || !to.settings.headsUp || job.status !== 'todo') return null;
  const today = localDate(ctx.now(), to.settings.tz);
  const room = ctx.house.rooms().find((r) => r.id === job.roomId)?.name;
  return notify(
    ctx.notifyDeps,
    to.id,
    { title: `🧰 ${by.displayName} gave you “${job.title}”`, body: [room, job.dueDate ? `due ${job.dueDate === today ? 'today' : niceDate(job.dueDate, today)}` : null].filter(Boolean).join(' · '), url: `/job/${job.id}`, tag: `job-${job.id}`, badge: needsMe(ctx.house.jobs(), to.id, today) },
    { kind: 'assigned', jobIds: [job.id], keys: [`assigned:${job.id}:${ctx.now()}`], ttl: 24 * 3600 },
  );
}

export async function runNudges(ctx: Ctx): Promise<SentNotification[]> {
  const out: SentNotification[] = [];
  for (const user of ctx.accounts.active()) {
    try {
      out.push(...(await nudgeUser(ctx, user)));
    } catch (err) {
      ctx.log(`Reminders for ${user.username} failed: ${(err as Error).stack ?? err}`);
    }
  }
  return out;
}

export function startScheduler(ctx: Ctx): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const n of await runNudges(ctx)) {
        ctx.log(`Sent ${n.kind} #${n.id} "${n.title}" to ${n.delivered}/${n.devices} devices${n.error ? ` (${n.error})` : ''}`);
      }
      // A calendar change that didn't get through is tried again.
      if (ctx.calendar.dirty) await ctx.calendar.sync();
    } finally {
      busy = false;
    }
  };
  // Lined up with the start of each minute, so a 09:00 reminder goes at 09:00, not 09:00:59.
  let timer: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), 60_000);
    timer.unref();
  }, 60_000 - (Date.now() % 60_000) + 500);
  first.unref();
  void tick();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
