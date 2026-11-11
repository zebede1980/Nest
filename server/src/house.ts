// The house: rooms, jobs and their steps and costs, the people we pay, photos and notes.
// Everything here belongs to the household; who did what is kept, but nobody owns a job.

import type { Db } from './db.js';
import { tx } from './db.js';
import { BadInput } from './http.js';
import { isRepeating, nextDue } from '../../shared/model.js';
import type { Cost, CostKind, Fact, Job, JobStatus, Note, Payment, Person, Photo, RepeatUnit, Room, Size, Step, Trade } from '../../shared/model.js';

export class NotFound extends Error {}

type Row = Record<string, unknown>;

/** Jobs sit in the bin this long before they (and their photos) go for good. */
export const BIN_MS = 30 * 24 * 60 * 60_000;

export interface JobFields {
  title?: string;
  status?: 'idea' | 'todo';
  roomId?: number | null;
  size?: Size;
  assigneeId?: number | null;
  dueDate?: string | null;
  notes?: string | null;
  simpleCost?: number | null;
  repeatEvery?: number | null;
  repeatUnit?: RepeatUnit | null;
}

export interface CostFields {
  label?: string;
  amount?: number;
  kind?: CostKind;
  tradeId?: number | null;
  shop?: string | null;
  bought?: boolean;
}

const toStep = (r: Row): Step => ({
  id: r.id as number,
  jobId: r.job_id as number,
  title: r.title as string,
  doneAt: r.done_at as number | null,
  doneBy: r.done_by as number | null,
  dueDate: r.due_date as string | null,
});

const toCost = (r: Row): Cost => ({
  id: r.id as number,
  jobId: r.job_id as number,
  label: r.label as string,
  amount: r.amount as number,
  kind: r.kind as CostKind,
  tradeId: r.trade_id as number | null,
  boughtAt: r.bought_at as number | null,
  shop: r.shop as string | null,
});

const toJob = (r: Row, steps: Step[], costs: Cost[]): Job => ({
  id: r.id as number,
  title: r.title as string,
  status: r.status as JobStatus,
  roomId: r.room_id as number | null,
  size: r.size as Size,
  assigneeId: r.assignee_id as number | null,
  dueDate: r.due_date as string | null,
  notes: r.notes as string | null,
  simpleCost: r.simple_cost as number | null,
  repeatEvery: r.repeat_every as number | null,
  repeatUnit: r.repeat_unit as RepeatUnit | null,
  createdAt: r.created_at as number,
  createdBy: r.created_by as number | null,
  doneAt: r.done_at as number | null,
  doneBy: r.done_by as number | null,
  steps,
  costs,
});

const toPhoto = (r: Row): Photo => ({
  id: r.id as number,
  jobId: r.job_id as number | null,
  roomId: r.room_id as number | null,
  costId: r.cost_id as number | null,
  caption: r.caption as string | null,
  w: r.w as number,
  h: r.h as number,
  createdAt: r.created_at as number,
  createdBy: r.created_by as number | null,
});

const toTrade = (r: Row): Trade => ({
  id: r.id as number,
  name: r.name as string,
  trade: r.trade as string | null,
  phone: r.phone as string | null,
  email: r.email as string | null,
  notes: r.notes as string | null,
  archived: r.archived_at !== null,
});

const toNote = (r: Row): Note => ({
  id: r.id as number,
  body: r.body as string,
  pinned: !!r.pinned,
  updatedAt: r.updated_at as number,
  updatedBy: r.updated_by as number | null,
});

function group<T, K extends keyof T>(rows: T[], key: K): Map<T[K], T[]> {
  const out = new Map<T[K], T[]>();
  for (const r of rows) {
    const list = out.get(r[key]);
    if (list) list.push(r);
    else out.set(r[key], [r]);
  }
  return out;
}

export class House {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  // ── Reading ──────────────────────────────────────────────────────────────

  people(): Person[] {
    const rows = this.db.prepare('SELECT id, display_name FROM users WHERE disabled_at IS NULL ORDER BY id').all() as Row[];
    return rows.map((r) => ({ id: r.id as number, displayName: r.display_name as string }));
  }

  rooms(): Room[] {
    const facts = group(
      (this.db.prepare('SELECT * FROM room_facts ORDER BY id').all() as Row[]).map(
        (r): Fact => ({ id: r.id as number, roomId: r.room_id as number, label: r.label as string, value: r.value as string }),
      ),
      'roomId',
    );
    return (this.db.prepare('SELECT * FROM rooms ORDER BY sort, id').all() as Row[]).map((r) => ({
      id: r.id as number,
      name: r.name as string,
      tint: r.tint as number,
      notes: r.notes as string | null,
      archived: r.archived_at !== null,
      facts: facts.get(r.id as number) ?? [],
    }));
  }

  /** Every job not in the bin, with its steps and costs. */
  jobs(): Job[] {
    const steps = group((this.db.prepare('SELECT * FROM steps ORDER BY sort, id').all() as Row[]).map(toStep), 'jobId');
    const costs = group((this.db.prepare('SELECT * FROM costs ORDER BY id').all() as Row[]).map(toCost), 'jobId');
    return (this.db.prepare('SELECT * FROM jobs WHERE deleted_at IS NULL ORDER BY id').all() as Row[]).map((r) =>
      toJob(r, steps.get(r.id as number) ?? [], costs.get(r.id as number) ?? []),
    );
  }

  job(id: number, opts: { binned?: boolean } = {}): Job {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
    if (!r || (r.deleted_at !== null && !opts.binned)) throw new NotFound('That job has gone');
    return toJob(
      r,
      (this.db.prepare('SELECT * FROM steps WHERE job_id = ? ORDER BY sort, id').all(id) as Row[]).map(toStep),
      (this.db.prepare('SELECT * FROM costs WHERE job_id = ? ORDER BY id').all(id) as Row[]).map(toCost),
    );
  }

  trades(): Trade[] {
    return (this.db.prepare('SELECT * FROM trades ORDER BY name COLLATE NOCASE').all() as Row[]).map(toTrade);
  }

  payments(): Payment[] {
    const rows = this.db
      .prepare('SELECT p.* FROM payments p JOIN costs c ON c.id = p.cost_id JOIN jobs j ON j.id = c.job_id WHERE j.deleted_at IS NULL ORDER BY p.paid_on, p.id')
      .all() as Row[];
    return rows.map((r) => ({ id: r.id as number, costId: r.cost_id as number, amount: r.amount as number, paidOn: r.paid_on as string, note: r.note as string | null }));
  }

  photos(): Photo[] {
    const rows = this.db
      .prepare('SELECT p.* FROM photos p LEFT JOIN jobs j ON j.id = p.job_id WHERE j.deleted_at IS NULL ORDER BY p.id')
      .all() as Row[];
    return rows.map(toPhoto);
  }

  photo(id: number): Photo & { hasThumb: boolean } {
    const r = this.db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new NotFound('That photo has gone');
    return { ...toPhoto(r), hasThumb: !!r.has_thumb };
  }

  notes(): Note[] {
    return (this.db.prepare('SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC').all() as Row[]).map(toNote);
  }

  // ── Jobs ─────────────────────────────────────────────────────────────────

  private checkRoom(roomId: number | null | undefined): void {
    if (roomId != null && !this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId)) throw new BadInput('That room has gone');
  }

  private checkPerson(userId: number | null | undefined): void {
    if (userId != null && !this.db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled_at IS NULL').get(userId)) throw new BadInput('That person has gone');
  }

  createJob(by: number, f: JobFields & { title: string }): Job {
    const status = f.status ?? 'todo';
    if (status === 'todo' && f.roomId == null) throw new BadInput('Pick a room for the job');
    this.checkRoom(f.roomId);
    this.checkPerson(f.assigneeId);
    const repeat = f.repeatEvery && f.repeatUnit ? { every: f.repeatEvery, unit: f.repeatUnit } : null;
    const now = this.now();
    const r = this.db
      .prepare(
        `INSERT INTO jobs (title, status, room_id, size, assignee_id, due_date, notes, simple_cost, repeat_every, repeat_unit, created_at, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(f.title, status, f.roomId ?? null, f.size ?? 'evening', f.assigneeId ?? null, f.dueDate ?? null, f.notes ?? null, f.simpleCost ?? null, repeat?.every ?? null, repeat?.unit ?? null, now, by, now);
    return this.job(Number(r.lastInsertRowid));
  }

  /** Changes only the fields given. Turning an idea into a job needs a room. */
  updateJob(id: number, f: JobFields): Job {
    const job = this.job(id);
    const next = { ...job, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) } as Job;
    if (f.status !== undefined && job.status === 'done') next.status = 'done';
    if (next.status !== 'idea' && next.roomId == null) throw new BadInput('Pick a room for the job');
    if (f.roomId !== undefined) this.checkRoom(f.roomId);
    if (f.assigneeId !== undefined) this.checkPerson(f.assigneeId);
    if (!next.repeatEvery || !next.repeatUnit) next.repeatEvery = next.repeatUnit = null;
    this.db
      .prepare(
        `UPDATE jobs SET title = ?, status = ?, room_id = ?, size = ?, assignee_id = ?, due_date = ?, notes = ?, simple_cost = ?,
           repeat_every = ?, repeat_unit = ?, updated_at = ? WHERE id = ?`,
      )
      .run(next.title, next.status, next.roomId, next.size, next.assigneeId, next.dueDate, next.notes, next.simpleCost, next.repeatEvery, next.repeatUnit, this.now(), id);
    return this.job(id);
  }

  /**
   * Ticks a job off, or back on. Upkeep that repeats leaves a fresh copy behind, due one
   * interval after `today`; un-ticking takes that copy away again if nobody has touched it.
   */
  setDone(id: number, by: number, done: boolean, today: string): Job {
    return tx(this.db, () => {
      const job = this.job(id);
      const now = this.now();
      if (done && job.status !== 'done') {
        let nextId: number | null = null;
        if (isRepeating(job)) {
          const r = this.db
            .prepare(
              `INSERT INTO jobs (title, status, room_id, size, assignee_id, due_date, notes, simple_cost, repeat_every, repeat_unit, created_at, created_by, updated_at)
               VALUES (?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(job.title, job.roomId, job.size, job.assigneeId, nextDue(today, job.repeatEvery!, job.repeatUnit!), job.notes, job.simpleCost, job.repeatEvery, job.repeatUnit, now, job.createdBy, now);
          nextId = Number(r.lastInsertRowid);
          const step = this.db.prepare('INSERT INTO steps (job_id, title, sort, created_at) VALUES (?, ?, ?, ?)');
          job.steps.forEach((s, i) => step.run(nextId, s.title, i, now));
          const cost = this.db.prepare('INSERT INTO costs (job_id, label, amount, kind, trade_id, shop, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
          for (const c of job.costs) cost.run(nextId, c.label, c.amount, c.kind, c.tradeId, c.shop, now);
        }
        this.db.prepare("UPDATE jobs SET status = 'done', done_at = ?, done_by = ?, next_id = ?, updated_at = ? WHERE id = ?").run(now, by, nextId, now, id);
      } else if (!done && job.status === 'done') {
        const { next_id: nextId } = this.db.prepare('SELECT next_id FROM jobs WHERE id = ?').get(id) as { next_id: number | null };
        if (nextId) this.db.prepare("DELETE FROM jobs WHERE id = ? AND status = 'todo' AND updated_at = created_at").run(nextId);
        this.db.prepare("UPDATE jobs SET status = 'todo', done_at = NULL, done_by = NULL, next_id = NULL, updated_at = ? WHERE id = ?").run(now, id);
      }
      return this.job(id);
    });
  }

  /** Into the bin. */
  deleteJob(id: number): void {
    this.job(id);
    this.db.prepare('UPDATE jobs SET deleted_at = ? WHERE id = ?').run(this.now(), id);
  }

  restoreJob(id: number): Job {
    this.db.prepare('UPDATE jobs SET deleted_at = NULL WHERE id = ?').run(id);
    return this.job(id);
  }

  /** Empties the bin of anything a month old. Returns the photos whose files can go. */
  emptyBin(): number[] {
    const cutoff = this.now() - BIN_MS;
    const photos = (this.db.prepare('SELECT p.id FROM photos p JOIN jobs j ON j.id = p.job_id WHERE j.deleted_at <= ?').all(cutoff) as { id: number }[]).map((r) => r.id);
    this.db.prepare('DELETE FROM jobs WHERE deleted_at <= ?').run(cutoff);
    return photos;
  }

  private touch(jobId: number): void {
    this.db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run(this.now(), jobId);
  }

  // ── Steps ────────────────────────────────────────────────────────────────

  private step(id: number): Step {
    const r = this.db.prepare('SELECT s.* FROM steps s JOIN jobs j ON j.id = s.job_id WHERE s.id = ? AND j.deleted_at IS NULL').get(id) as Row | undefined;
    if (!r) throw new NotFound('That step has gone');
    return toStep(r);
  }

  addStep(jobId: number, title: string, dueDate: string | null): Step {
    this.job(jobId);
    const { n } = this.db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM steps WHERE job_id = ?').get(jobId) as { n: number };
    const r = this.db.prepare('INSERT INTO steps (job_id, title, due_date, sort, created_at) VALUES (?, ?, ?, ?, ?)').run(jobId, title, dueDate, n, this.now());
    this.touch(jobId);
    return this.step(Number(r.lastInsertRowid));
  }

  updateStep(id: number, by: number, f: { title?: string; dueDate?: string | null; done?: boolean }): Step {
    const s = this.step(id);
    const doneAt = f.done === undefined ? s.doneAt : f.done ? (s.doneAt ?? this.now()) : null;
    const doneBy = f.done === undefined ? s.doneBy : f.done ? (s.doneBy ?? by) : null;
    this.db
      .prepare('UPDATE steps SET title = ?, due_date = ?, done_at = ?, done_by = ? WHERE id = ?')
      .run(f.title ?? s.title, f.dueDate === undefined ? s.dueDate : f.dueDate, doneAt, doneBy, id);
    this.touch(s.jobId);
    return this.step(id);
  }

  deleteStep(id: number): void {
    const s = this.step(id);
    this.db.prepare('DELETE FROM steps WHERE id = ?').run(id);
    this.touch(s.jobId);
  }

  /** Puts a job's steps in the order given; any left out keep their place after them. */
  orderSteps(jobId: number, ids: number[]): void {
    this.job(jobId);
    const set = this.db.prepare('UPDATE steps SET sort = ? WHERE id = ? AND job_id = ?');
    tx(this.db, () => ids.forEach((id, i) => set.run(i - ids.length, id, jobId)));
    this.touch(jobId);
  }

  // ── Costs and payments ───────────────────────────────────────────────────

  cost(id: number): Cost {
    const r = this.db.prepare('SELECT c.* FROM costs c JOIN jobs j ON j.id = c.job_id WHERE c.id = ? AND j.deleted_at IS NULL').get(id) as Row | undefined;
    if (!r) throw new NotFound('That cost has gone');
    return toCost(r);
  }

  private checkTrade(kind: CostKind, tradeId: number | null): number | null {
    if (kind !== 'trade') return null;
    if (tradeId != null && !this.db.prepare('SELECT 1 FROM trades WHERE id = ?').get(tradeId)) throw new BadInput('That person has gone');
    return tradeId;
  }

  addCost(jobId: number, f: CostFields & { label: string }): Cost {
    this.job(jobId);
    const kind = f.kind ?? 'item';
    const r = this.db
      .prepare('INSERT INTO costs (job_id, label, amount, kind, trade_id, bought_at, shop, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(jobId, f.label, f.amount ?? 0, kind, this.checkTrade(kind, f.tradeId ?? null), kind === 'item' && f.bought ? this.now() : null, kind === 'item' ? (f.shop ?? null) : null, this.now());
    this.touch(jobId);
    return this.cost(Number(r.lastInsertRowid));
  }

  updateCost(id: number, f: CostFields): Cost {
    const c = this.cost(id);
    const kind = f.kind ?? c.kind;
    const boughtAt = kind !== 'item' ? null : f.bought === undefined ? c.boughtAt : f.bought ? (c.boughtAt ?? this.now()) : null;
    this.db
      .prepare('UPDATE costs SET label = ?, amount = ?, kind = ?, trade_id = ?, bought_at = ?, shop = ? WHERE id = ?')
      .run(f.label ?? c.label, f.amount ?? c.amount, kind, this.checkTrade(kind, f.tradeId === undefined ? c.tradeId : f.tradeId), boughtAt, kind !== 'item' ? null : f.shop === undefined ? c.shop : f.shop, id);
    // A bill turned back into a thing to buy has no payments to keep.
    if (kind === 'item') this.db.prepare('DELETE FROM payments WHERE cost_id = ?').run(id);
    this.touch(c.jobId);
    return this.cost(id);
  }

  deleteCost(id: number): void {
    const c = this.cost(id);
    this.db.prepare('DELETE FROM costs WHERE id = ?').run(id);
    this.touch(c.jobId);
  }

  addPayment(costId: number, by: number, f: { amount: number; paidOn: string; note: string | null }): number {
    const c = this.cost(costId);
    if (c.kind !== 'trade') throw new BadInput('Payments go against a bill');
    const r = this.db.prepare('INSERT INTO payments (cost_id, amount, paid_on, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(costId, f.amount, f.paidOn, f.note, this.now(), by);
    this.touch(c.jobId);
    return Number(r.lastInsertRowid);
  }

  deletePayment(id: number): void {
    if (!this.db.prepare('DELETE FROM payments WHERE id = ?').run(id).changes) throw new NotFound('That payment has gone');
  }

  // ── The people we pay ────────────────────────────────────────────────────

  private trade(id: number): Trade {
    const r = this.db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new NotFound('That person has gone');
    return toTrade(r);
  }

  createTrade(f: { name: string; trade: string | null; phone: string | null; email: string | null; notes: string | null }): Trade {
    const r = this.db.prepare('INSERT INTO trades (name, trade, phone, email, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(f.name, f.trade, f.phone, f.email, f.notes, this.now());
    return this.trade(Number(r.lastInsertRowid));
  }

  updateTrade(id: number, f: Partial<Omit<Trade, 'id'>>): Trade {
    const t = { ...this.trade(id), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) } as Trade;
    const was = this.db.prepare('SELECT archived_at FROM trades WHERE id = ?').get(id) as { archived_at: number | null };
    this.db
      .prepare('UPDATE trades SET name = ?, trade = ?, phone = ?, email = ?, notes = ?, archived_at = ? WHERE id = ?')
      .run(t.name, t.trade, t.phone, t.email, t.notes, t.archived ? (was.archived_at ?? this.now()) : null, id);
    return this.trade(id);
  }

  /** Gone for good if they were never on a bill; otherwise kept, out of sight, for the record. */
  removeTrade(id: number): void {
    this.trade(id);
    if (this.db.prepare('SELECT 1 FROM costs WHERE trade_id = ?').get(id)) this.db.prepare('UPDATE trades SET archived_at = COALESCE(archived_at, ?) WHERE id = ?').run(this.now(), id);
    else this.db.prepare('DELETE FROM trades WHERE id = ?').run(id);
  }

  // ── Rooms ────────────────────────────────────────────────────────────────

  private roomRow(id: number): Row {
    const r = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new NotFound('That room has gone');
    return r;
  }

  createRoom(name: string): number {
    const { n, t } = this.db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n, COUNT(*) AS t FROM rooms').get() as { n: number; t: number };
    return Number(this.db.prepare('INSERT INTO rooms (name, tint, sort, created_at) VALUES (?, ?, ?, ?)').run(name, t % 6, n, this.now()).lastInsertRowid);
  }

  updateRoom(id: number, f: { name?: string; notes?: string | null; tint?: number; archived?: boolean }): void {
    const r = this.roomRow(id);
    const archivedAt = f.archived === undefined ? r.archived_at : f.archived ? (r.archived_at ?? this.now()) : null;
    this.db
      .prepare('UPDATE rooms SET name = ?, notes = ?, tint = ?, archived_at = ? WHERE id = ?')
      .run(f.name ?? (r.name as string), f.notes === undefined ? (r.notes as string | null) : f.notes, f.tint ?? (r.tint as number), archivedAt as number | null, id);
  }

  /** Gone for good if nothing was ever put in it; otherwise retired, with its jobs kept. */
  removeRoom(id: number): void {
    this.roomRow(id);
    const used = this.db.prepare('SELECT 1 FROM jobs WHERE room_id = ? UNION ALL SELECT 1 FROM photos WHERE room_id = ? UNION ALL SELECT 1 FROM room_facts WHERE room_id = ?').get(id, id, id);
    if (used) this.db.prepare('UPDATE rooms SET archived_at = COALESCE(archived_at, ?) WHERE id = ?').run(this.now(), id);
    else this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  }

  orderRooms(ids: number[]): void {
    const set = this.db.prepare('UPDATE rooms SET sort = ? WHERE id = ?');
    tx(this.db, () => ids.forEach((id, i) => set.run(i, id)));
  }

  addFact(roomId: number, label: string, value: string): number {
    this.roomRow(roomId);
    return Number(this.db.prepare('INSERT INTO room_facts (room_id, label, value, created_at) VALUES (?, ?, ?, ?)').run(roomId, label, value, this.now()).lastInsertRowid);
  }

  updateFact(id: number, label: string, value: string): void {
    if (!this.db.prepare('UPDATE room_facts SET label = ?, value = ? WHERE id = ?').run(label, value, id).changes) throw new NotFound('That has gone');
  }

  deleteFact(id: number): void {
    this.db.prepare('DELETE FROM room_facts WHERE id = ?').run(id);
  }

  // ── Notes ────────────────────────────────────────────────────────────────

  createNote(by: number, body: string): number {
    const now = this.now();
    return Number(this.db.prepare('INSERT INTO notes (body, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?)').run(body, now, now, by).lastInsertRowid);
  }

  updateNote(id: number, by: number, f: { body?: string; pinned?: boolean }): void {
    const r = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new NotFound('That note has gone');
    // Pinning isn't an edit: it shouldn't change who wrote it last, or when.
    if (f.body !== undefined && f.body !== r.body) this.db.prepare('UPDATE notes SET body = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(f.body, this.now(), by, id);
    if (f.pinned !== undefined) this.db.prepare('UPDATE notes SET pinned = ? WHERE id = ?').run(f.pinned ? 1 : 0, id);
  }

  deleteNote(id: number): void {
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  }

  // ── Photos ───────────────────────────────────────────────────────────────

  /** A receipt (costId) also belongs to that cost's job. */
  addPhoto(by: number, f: { jobId: number | null; roomId: number | null; costId: number | null; caption: string | null; w: number; h: number }): number {
    let jobId = f.jobId;
    if (f.costId != null) jobId = this.cost(f.costId).jobId;
    if (jobId != null) this.job(jobId);
    if (f.roomId != null) this.roomRow(f.roomId);
    if (jobId == null && f.roomId == null) throw new BadInput('A photo belongs to a job or a room');
    const r = this.db
      .prepare('INSERT INTO photos (job_id, room_id, cost_id, caption, w, h, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(jobId, jobId == null ? f.roomId : null, f.costId, f.caption, f.w, f.h, this.now(), by);
    return Number(r.lastInsertRowid);
  }

  markThumb(id: number): void {
    this.db.prepare('UPDATE photos SET has_thumb = 1 WHERE id = ?').run(id);
  }

  captionPhoto(id: number, caption: string | null): void {
    this.photo(id);
    this.db.prepare('UPDATE photos SET caption = ? WHERE id = ?').run(caption, id);
  }

  deletePhoto(id: number): void {
    this.photo(id);
    this.db.prepare('DELETE FROM photos WHERE id = ?').run(id);
  }
}
