import { describe, expect, it } from 'vitest';
import { jobSpent, jobTotal, money, nextDue, parseMoney, type Job, type Room } from '../shared/model';
import { leadDays, nagDay, needsMe, reminderWords, remindersFor } from '../shared/reminders';

let nextId = 1;
const job = (f: Partial<Job>): Job => ({
  id: nextId++,
  title: 'Job',
  status: 'todo',
  roomId: 1,
  size: 'evening',
  assigneeId: null,
  dueDate: null,
  notes: null,
  simpleCost: null,
  repeatEvery: null,
  repeatUnit: null,
  createdAt: 0,
  createdBy: 1,
  doneAt: null,
  doneBy: null,
  steps: [],
  costs: [],
  ...f,
});
const rooms: Room[] = [{ id: 1, name: 'Kitchen', tint: 0, notes: null, archived: false, facts: [] }];
const TODAY = '2026-11-11'; // a Wednesday

describe('money', () => {
  it('shows pounds, with pence only when there are some', () => {
    expect(money(184000)).toBe('£1,840');
    expect(money(650)).toBe('£6.50');
    expect(money(0)).toBe('£0');
  });
  it('reads what people type', () => {
    expect(parseMoney('£1,200.50')).toBe(120050);
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('19.99')).toBe(1999);
    expect(parseMoney('a tenner')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });
  it('adds a job up from its lines, or its one simple cost', () => {
    const simple = job({ simpleCost: 4000 });
    expect(jobTotal(simple)).toBe(4000);
    expect(jobSpent(simple, [])).toBe(0);
    expect(jobSpent({ ...simple, status: 'done' }, [])).toBe(4000);
    const lines = job({
      simpleCost: 99999,
      costs: [
        { id: 1, jobId: 1, label: 'Paint', amount: 3800, kind: 'item', tradeId: null, boughtAt: 5, shop: null },
        { id: 2, jobId: 1, label: 'Brushes', amount: 1200, kind: 'item', tradeId: null, boughtAt: null, shop: null },
        { id: 3, jobId: 1, label: 'Plasterer', amount: 40000, kind: 'trade', tradeId: 1, boughtAt: null, shop: null },
      ],
    });
    expect(jobTotal(lines)).toBe(45000);
    expect(jobSpent(lines, [{ id: 1, costId: 3, amount: 15000, paidOn: TODAY, note: null }])).toBe(18800);
  });
});

describe('upkeep', () => {
  it('comes round again from the day it was done', () => {
    expect(nextDue('2026-11-11', 2, 'week')).toBe('2026-11-25');
    expect(nextDue('2026-01-31', 1, 'month')).toBe('2026-02-28');
    expect(nextDue('2026-11-11', 1, 'year')).toBe('2027-11-11');
  });
});

describe('reminders', () => {
  it('gives bigger jobs more warning', () => {
    expect(leadDays('evening', false)).toEqual([1]);
    expect(leadDays('weekend', false)).toEqual([2]);
    expect(leadDays('bigger', false)).toEqual([7, 1]);
    expect(leadDays('bigger', true)).toEqual([1]);
  });
  it('nags late jobs now and then, not every day', () => {
    const days = Array.from({ length: 30 }, (_, i) => i + 1).filter(nagDay);
    expect(days).toEqual([1, 3, 7, 14, 21, 28]);
  });
  it('picks out today, the lead days and the nag days', () => {
    const jobs = [
      job({ title: 'today', dueDate: TODAY }),
      job({ title: 'tomorrow', dueDate: '2026-11-12' }),
      job({ title: 'in two days, evening', dueDate: '2026-11-13' }),
      job({ title: 'weekend in two', size: 'weekend', dueDate: '2026-11-13' }),
      job({ title: 'bigger in a week', size: 'bigger', dueDate: '2026-11-18' }),
      job({ title: 'late 1', dueDate: '2026-11-10' }),
      job({ title: 'late 2', dueDate: '2026-11-09' }),
      job({ title: 'done', status: 'done', dueDate: TODAY }),
      job({ title: 'idea', status: 'idea', dueDate: TODAY }),
      job({ title: 'no date' }),
    ];
    expect(remindersFor(jobs, 1, 'mine', TODAY).map((r) => r.job.title)).toEqual(['today', 'late 1', 'tomorrow', 'weekend in two', 'bigger in a week']);
    expect(remindersFor(jobs, 1, 'off', TODAY)).toEqual([]);
  });
  it("leaves the other person's jobs out unless I asked for all", () => {
    const jobs = [job({ title: 'mine', assigneeId: 1, dueDate: TODAY }), job({ title: 'theirs', assigneeId: 2, dueDate: TODAY }), job({ title: 'anyone', dueDate: TODAY })];
    expect(remindersFor(jobs, 1, 'mine', TODAY).map((r) => r.job.title)).toEqual(['mine', 'anyone']);
    expect(remindersFor(jobs, 1, 'all', TODAY)).toHaveLength(3);
    expect(needsMe(jobs, 1, TODAY)).toBe(2);
  });
  it('reminds about steps with their own dates, until they are ticked', () => {
    const j = job({
      title: 'Kitchen refit',
      size: 'bigger',
      steps: [
        { id: 1, jobId: 0, title: 'Order worktop', doneAt: null, doneBy: null, dueDate: TODAY },
        { id: 2, jobId: 0, title: 'Book fitter', doneAt: 5, doneBy: 1, dueDate: TODAY },
      ],
    });
    const list = remindersFor([j], 1, 'mine', TODAY);
    expect(list.map((r) => r.step?.title)).toEqual(['Order worktop']);
    expect(needsMe([j], 1, TODAY)).toBe(1);
    const w = reminderWords(list, rooms, TODAY);
    expect(w.title).toBe('🔨 Today: Order worktop');
    expect(w.body).toBe('Kitchen refit · Kitchen');
    expect(w.url).toBe(`/job/${j.id}`);
  });
  it('says one job plainly and rolls several into one', () => {
    const one = remindersFor([job({ title: 'Hang mirror', dueDate: '2026-11-12' })], 1, 'mine', TODAY);
    expect(reminderWords(one, rooms, TODAY)).toMatchObject({ title: '🗓️ Tomorrow: Hang mirror', body: 'Kitchen · evening job' });
    const late = remindersFor([job({ title: 'Bleed radiators', dueDate: '2026-11-08' })], 1, 'mine', TODAY);
    expect(reminderWords(late, rooms, TODAY)).toMatchObject({ title: '⏰ Still waiting: Bleed radiators', body: 'Was due Sun 8 Nov · Kitchen · evening job' });
    const many = remindersFor(
      [1, 2, 3, 4, 5].map((n) => job({ title: `Job ${n}`, dueDate: TODAY })),
      1,
      'mine',
      TODAY,
    );
    const w = reminderWords(many, rooms, TODAY);
    expect(w.title).toBe('🏡 5 jobs to keep in mind');
    expect(w.body.split('\n')).toHaveLength(5);
    expect(w.body).toContain('…and 1 more');
    expect(w.url).toBe('/');
  });
});
