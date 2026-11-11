// The house's own routes: jobs, steps, costs, payments, the people we pay, rooms and notes.
// Anyone signed in can change anything: it's one household.

import type { FastifyInstance } from 'fastify';
import { localDate } from '../../../shared/dates.js';
import { COST_KINDS, REPEAT_UNITS, SIZES, type House as HouseState } from '../../../shared/model.js';
import { needsMe } from '../../../shared/reminders.js';
import type { User } from '../accounts.js';
import type { CostFields, JobFields } from '../house.js';
import { BadInput, body, bool, date, has, idList, idParam, number, oneOf, pence, requireAdmin, requireUser, text, type Body, type Ctx } from '../http.js';
import { announceAssigned } from '../scheduler.js';

export function houseState(ctx: Ctx, user: User): HouseState {
  const today = localDate(ctx.now(), user.settings.tz);
  const jobs = ctx.house.jobs();
  const cal = ctx.calendar.status();
  return {
    today,
    people: ctx.house.people(),
    rooms: ctx.house.rooms(),
    jobs,
    trades: ctx.house.trades(),
    payments: ctx.house.payments(),
    photos: ctx.house.photos(),
    notes: ctx.house.notes(),
    badge: needsMe(jobs, user.id, today),
    calendar: { connected: cal.connected, error: cal.error },
  };
}

/** The job fields present in a request body; anything left out stays as it is. */
function jobFields(b: Body): JobFields {
  const f: JobFields = {};
  if (has(b, 'title')) f.title = text(b, 'title', { max: 140 });
  if (has(b, 'status')) f.status = oneOf(b, 'status', ['idea', 'todo'] as const);
  if (has(b, 'roomId')) f.roomId = number(b, 'roomId', { int: true, min: 1, optional: true });
  if (has(b, 'size')) f.size = oneOf(b, 'size', SIZES);
  if (has(b, 'assigneeId')) f.assigneeId = number(b, 'assigneeId', { int: true, min: 1, optional: true });
  if (has(b, 'dueDate')) f.dueDate = date(b, 'dueDate', true);
  if (has(b, 'notes')) f.notes = text(b, 'notes', { max: 4000, optional: true });
  if (has(b, 'simpleCost')) f.simpleCost = pence(b, 'simpleCost', true);
  if (has(b, 'repeatEvery')) f.repeatEvery = number(b, 'repeatEvery', { int: true, min: 1, max: 120, optional: true });
  if (has(b, 'repeatUnit')) f.repeatUnit = b.repeatUnit === null ? null : oneOf(b, 'repeatUnit', REPEAT_UNITS);
  return f;
}

function costFields(b: Body): CostFields {
  const f: CostFields = {};
  if (has(b, 'label')) f.label = text(b, 'label', { max: 140 });
  if (has(b, 'amount')) f.amount = pence(b, 'amount')!;
  if (has(b, 'kind')) f.kind = oneOf(b, 'kind', COST_KINDS);
  if (has(b, 'tradeId')) f.tradeId = number(b, 'tradeId', { int: true, min: 1, optional: true });
  if (has(b, 'shop')) f.shop = text(b, 'shop', { max: 60, optional: true });
  if (has(b, 'bought')) f.bought = bool(b, 'bought');
  return f;
}

export function houseRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { house } = ctx;

  app.get('/api/house', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { ok: true, house: houseState(ctx, user) };
  });

  // ── Jobs ─────────────────────────────────────────────────────────────────
  app.post('/api/jobs', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const b = body(req);
    const job = house.createJob(user.id, { ...jobFields(b), title: text(b, 'title', { max: 140 }) });
    // Steps can come along with a new job, so a bigger one is set up in one go.
    if (Array.isArray(b.steps)) for (const s of b.steps.slice(0, 50)) if (typeof s === 'string' && s.trim()) house.addStep(job.id, s.trim().slice(0, 140), null);
    void announceAssigned(ctx, job, user).catch(() => {});
    return { ok: true, job: house.job(job.id) };
  });

  app.put('/api/jobs/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const id = idParam(req);
    const before = house.job(id);
    const job = house.updateJob(id, jobFields(body(req)));
    if (job.assigneeId !== before.assigneeId) void announceAssigned(ctx, job, user).catch(() => {});
    return { ok: true, job };
  });

  app.post('/api/jobs/:id/done', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const done = bool(body(req), 'done') ?? true;
    return { ok: true, job: house.setDone(idParam(req), user.id, done, localDate(ctx.now(), user.settings.tz)) };
  });

  app.delete('/api/jobs/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.deleteJob(idParam(req));
    return { ok: true };
  });

  app.post('/api/jobs/:id/restore', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return { ok: true, job: house.restoreJob(idParam(req)) };
  });

  // ── Steps ────────────────────────────────────────────────────────────────
  app.post('/api/jobs/:id/steps', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const b = body(req);
    return { ok: true, step: house.addStep(idParam(req), text(b, 'title', { max: 140 }), date(b, 'dueDate', true)) };
  });

  app.post('/api/jobs/:id/steps/order', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.orderSteps(idParam(req), idList(body(req), 'ids'));
    return { ok: true };
  });

  app.put('/api/steps/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const b = body(req);
    const step = house.updateStep(idParam(req), user.id, {
      title: has(b, 'title') ? text(b, 'title', { max: 140 }) : undefined,
      dueDate: has(b, 'dueDate') ? date(b, 'dueDate', true) : undefined,
      done: bool(b, 'done'),
    });
    return { ok: true, step };
  });

  app.delete('/api/steps/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.deleteStep(idParam(req));
    return { ok: true };
  });

  // ── Costs and payments ───────────────────────────────────────────────────
  app.post('/api/jobs/:id/costs', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const b = body(req);
    return { ok: true, cost: house.addCost(idParam(req), { ...costFields(b), label: text(b, 'label', { max: 140 }) }) };
  });

  app.put('/api/costs/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return { ok: true, cost: house.updateCost(idParam(req), costFields(body(req))) };
  });

  app.delete('/api/costs/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.deleteCost(idParam(req));
    return { ok: true };
  });

  app.post('/api/costs/:id/payments', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const b = body(req);
    const amount = pence(b, 'amount')!;
    if (amount <= 0) throw new BadInput('How much was paid?');
    const id = house.addPayment(idParam(req), user.id, { amount, paidOn: date(b, 'paidOn', true) ?? localDate(ctx.now(), user.settings.tz), note: text(b, 'note', { max: 200, optional: true }) });
    return { ok: true, id };
  });

  app.delete('/api/payments/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.deletePayment(idParam(req));
    return { ok: true };
  });

  // ── The people we pay ────────────────────────────────────────────────────
  const tradeFields = (b: Body) => ({
    trade: text(b, 'trade', { max: 60, optional: true }),
    phone: text(b, 'phone', { max: 40, optional: true }),
    email: text(b, 'email', { max: 120, optional: true }),
    notes: text(b, 'notes', { max: 2000, optional: true }),
  });

  app.post('/api/trades', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const b = body(req);
    return { ok: true, trade: house.createTrade({ name: text(b, 'name', { max: 80 }), ...tradeFields(b) }) };
  });

  app.put('/api/trades/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const b = body(req);
    return { ok: true, trade: house.updateTrade(idParam(req), { name: text(b, 'name', { max: 80 }), ...tradeFields(b), archived: bool(b, 'archived') }) };
  });

  app.delete('/api/trades/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.removeTrade(idParam(req));
    return { ok: true };
  });

  // ── Rooms ────────────────────────────────────────────────────────────────
  app.post('/api/rooms', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return { ok: true, id: house.createRoom(text(body(req), 'name', { max: 60 })) };
  });

  app.post('/api/rooms/order', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.orderRooms(idList(body(req), 'ids'));
    return { ok: true };
  });

  app.put('/api/rooms/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const b = body(req);
    house.updateRoom(idParam(req), {
      name: has(b, 'name') ? text(b, 'name', { max: 60 }) : undefined,
      notes: has(b, 'notes') ? text(b, 'notes', { max: 4000, optional: true }) : undefined,
      tint: has(b, 'tint') ? number(b, 'tint', { int: true, min: 0, max: 5 })! : undefined,
      archived: bool(b, 'archived'),
    });
    return { ok: true };
  });

  app.delete('/api/rooms/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.removeRoom(idParam(req));
    return { ok: true };
  });

  app.post('/api/rooms/:id/facts', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const b = body(req);
    return { ok: true, id: house.addFact(idParam(req), text(b, 'label', { max: 60 }), text(b, 'value', { max: 300 })) };
  });

  app.put('/api/facts/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const b = body(req);
    house.updateFact(idParam(req), text(b, 'label', { max: 60 }), text(b, 'value', { max: 300 }));
    return { ok: true };
  });

  app.delete('/api/facts/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.deleteFact(idParam(req));
    return { ok: true };
  });

  // ── Notes ────────────────────────────────────────────────────────────────
  app.post('/api/notes', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { ok: true, id: house.createNote(user.id, text(body(req), 'body', { max: 20_000 })) };
  });

  app.put('/api/notes/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const b = body(req);
    house.updateNote(idParam(req), user.id, { body: has(b, 'body') ? text(b, 'body', { max: 20_000 }) : undefined, pinned: bool(b, 'pinned') });
    return { ok: true };
  });

  app.delete('/api/notes/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    house.deleteNote(idParam(req));
    return { ok: true };
  });

  // ── The shared Google calendar (admin) ───────────────────────────────────
  app.get('/api/calendar', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return { ok: true, calendar: ctx.calendar.status() };
  });

  app.put('/api/calendar', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = body(req);
    return { ok: true, calendar: await ctx.calendar.connect(text(b, 'key', { max: 10_000 }), text(b, 'calendarId', { max: 200 })) };
  });

  app.post('/api/calendar/sync', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    await ctx.calendar.sync();
    return { ok: true, calendar: ctx.calendar.status() };
  });

  app.delete('/api/calendar', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await ctx.calendar.disconnect();
    return { ok: true, calendar: ctx.calendar.status() };
  });
}
