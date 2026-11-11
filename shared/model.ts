// Types and small sums shared by the server and the app.

import { addDays, addMonths } from './dates.js';

/** How big a job is: one evening, a weekend, or more than that. */
export const SIZES = ['evening', 'weekend', 'bigger'] as const;
export type Size = (typeof SIZES)[number];
export const SIZE_LABEL: Record<Size, string> = { evening: 'Evening', weekend: 'Weekend', bigger: 'Bigger' };
export const SIZE_LONG: Record<Size, string> = { evening: 'Evening job', weekend: 'Weekend job', bigger: 'Bigger job' };

/** An idea is a "wouldn't it be nice": no room or date needed until it becomes a job. */
export const STATUSES = ['idea', 'todo', 'done'] as const;
export type JobStatus = (typeof STATUSES)[number];

export const REPEAT_UNITS = ['week', 'month', 'year'] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export const COST_KINDS = ['item', 'trade'] as const;
export type CostKind = (typeof COST_KINDS)[number];

export interface Person {
  id: number;
  displayName: string;
}

export interface Step {
  id: number;
  jobId: number;
  title: string;
  doneAt: number | null;
  doneBy: number | null;
  dueDate: string | null;
}

/** One line of a job's costs: something to buy, or a bill from someone we pay. Pence. */
export interface Cost {
  id: number;
  jobId: number;
  label: string;
  amount: number;
  kind: CostKind;
  tradeId: number | null;
  /** Things to buy: when it was bought. Bills are paid off by payments instead. */
  boughtAt: number | null;
  shop: string | null;
}

export interface Payment {
  id: number;
  costId: number;
  amount: number;
  paidOn: string;
  note: string | null;
}

export interface Photo {
  id: number;
  jobId: number | null;
  roomId: number | null;
  /** A receipt for this cost line. */
  costId: number | null;
  caption: string | null;
  w: number;
  h: number;
  createdAt: number;
  createdBy: number | null;
}

export interface Job {
  id: number;
  title: string;
  status: JobStatus;
  roomId: number | null;
  size: Size;
  /** null: whoever gets to it. */
  assigneeId: number | null;
  dueDate: string | null;
  notes: string | null;
  /** One simple spend, used while the job has no cost lines. Pence. */
  simpleCost: number | null;
  /** Upkeep that comes round again: every so many weeks, months or years after it's done. */
  repeatEvery: number | null;
  repeatUnit: RepeatUnit | null;
  createdAt: number;
  createdBy: number | null;
  doneAt: number | null;
  doneBy: number | null;
  steps: Step[];
  costs: Cost[];
}

/** Something worth remembering about a room: the paint colour, the bulb type, a measurement. */
export interface Fact {
  id: number;
  roomId: number;
  label: string;
  value: string;
}

export interface Room {
  id: number;
  name: string;
  /** Which of the room colours it wears. */
  tint: number;
  notes: string | null;
  archived: boolean;
  facts: Fact[];
}

/** Someone we pay: a plumber, a decorator, a skip firm. */
export interface Trade {
  id: number;
  name: string;
  trade: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  archived: boolean;
}

export interface Note {
  id: number;
  body: string;
  pinned: boolean;
  updatedAt: number;
  updatedBy: number | null;
}

/** Everything about the house, sent whole: it's two people and a few hundred jobs. */
export interface House {
  today: string;
  people: Person[];
  rooms: Room[];
  jobs: Job[];
  trades: Trade[];
  payments: Payment[];
  photos: Photo[];
  notes: Note[];
  /** Jobs and steps of mine that are due today or overdue: the app icon's number. */
  badge: number;
  calendar: { connected: boolean; error: string | null };
}

// ── People's settings ───────────────────────────────────────────────────────

export const REMIND_CHOICES = ['mine', 'all', 'off'] as const;
export type RemindChoice = (typeof REMIND_CHOICES)[number];

export interface UserSettings {
  tz: string;
  /** Reminders for jobs given to me (or to nobody), for every job, or none. */
  remind: RemindChoice;
  /** The time of day reminders arrive. */
  remindAt: string;
  /** Tell me when someone else finishes a job, or gives me one. */
  headsUp: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = { tz: 'Europe/London', remind: 'mine', remindAt: '09:00', headsUp: true };

export interface Me {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
}

export interface PushMessage {
  title: string;
  body: string;
  /** Path opened when the notification is tapped. */
  url: string;
  /** Pushes with the same tag replace each other. */
  tag: string;
  badge: number;
}

// ── Money ───────────────────────────────────────────────────────────────────

/** 184000 → "£1,840", 650 → "£6.50". */
export function money(pence: number): string {
  const neg = pence < 0;
  const p = Math.abs(Math.round(pence));
  const pounds = Math.floor(p / 100).toLocaleString('en-GB');
  const rest = p % 100;
  return `${neg ? '−' : ''}£${pounds}${rest ? '.' + String(rest).padStart(2, '0') : ''}`;
}

/** "12", "12.5", "£1,200.50" → pence; null if it isn't an amount. */
export function parseMoney(text: string): number | null {
  const t = text.replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

export const paidOn = (cost: Cost, payments: Payment[]) =>
  cost.kind === 'trade' ? payments.reduce((sum, p) => (p.costId === cost.id ? sum + p.amount : sum), 0) : cost.boughtAt ? cost.amount : 0;

/** What a job is expected to cost in all: its lines if it has any, else its one simple cost. */
export const jobTotal = (job: Job) => (job.costs.length ? job.costs.reduce((s, c) => s + c.amount, 0) : (job.simpleCost ?? 0));

/** What has actually gone out. A simple cost counts once the job is done. */
export function jobSpent(job: Job, payments: Payment[]): number {
  if (job.costs.length) return job.costs.reduce((s, c) => s + paidOn(c, payments), 0);
  return job.status === 'done' ? (job.simpleCost ?? 0) : 0;
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export const isRepeating = (job: Pick<Job, 'repeatEvery' | 'repeatUnit'>) => !!job.repeatEvery && !!job.repeatUnit;

/** When upkeep is next due, counted from the day it was done. */
export function nextDue(doneOn: string, every: number, unit: RepeatUnit): string {
  if (unit === 'week') return addDays(doneOn, every * 7);
  return addMonths(doneOn, unit === 'year' ? every * 12 : every);
}

export function repeatWords(every: number, unit: RepeatUnit): string {
  return every === 1 ? `Every ${unit}` : `Every ${every} ${unit}s`;
}

/** Jobs that count towards "how far along are we": real jobs, not ideas, not upkeep. */
export const countsForProgress = (job: Job) => job.status !== 'idea' && !isRepeating(job);
