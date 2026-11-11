import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../server/src/app';
import type { Fetch } from '../server/src/gcal';
import { BIN_MS } from '../server/src/house';
import type { PushSender, SendResult, Subscription } from '../server/src/push';
import { photoFile } from '../server/src/routes/photos';
import { DONE_SETTLE_MS, runNudges } from '../server/src/scheduler';
import { localToMs } from '../shared/dates';
import type { House, Job } from '../shared/model';

const clientDir = mkdtempSync(path.join(tmpdir(), 'nest-client-'));
writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>t</title>');

const TZ = 'Europe/London';
const at = (date: string, hm: string) => localToMs(date, +hm.slice(0, 2) * 60 + +hm.slice(3), TZ);

let clock = 0;
let sent: { sub: Subscription; payload: { web_push: number; notification: { title: string; body: string; navigate: string } } }[] = [];
let reply: (sub: Subscription) => SendResult = () => ({ status: 201, gone: false });
const sender: PushSender = async (sub, payload) => {
  sent.push({ sub, payload: JSON.parse(payload) });
  return reply(sub);
};

// A pretend Google: remembers the events it's given.
let google: Map<string, { summary: string; start: { date: string } }>;
let googleCalls: string[];
let googleSays: number | null;
const fakeFetch: Fetch = async (url, init) => {
  const method = init?.method ?? 'GET';
  const res = (status: number, body: unknown = {}) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
  if (url.includes('oauth2.googleapis.com')) return res(200, { access_token: 'tok', expires_in: 3600 });
  googleCalls.push(`${method} ${url.split('/calendars/')[1]}`);
  if (googleSays) return res(googleSays, { error: { message: 'nope' } });
  if (!url.includes(encodeURIComponent('family@group.calendar.google.com'))) return res(404, { error: { message: 'Not Found' } });
  const id = url.split('/events/')[1];
  if (method === 'GET') return res(200, { items: [] });
  if (method === 'POST') {
    const newId = `ev${google.size + 1}_${googleCalls.length}`;
    google.set(newId, JSON.parse(init!.body!));
    return res(200, { id: newId });
  }
  if (!google.has(id)) return res(404, { error: { message: 'Not Found' } });
  if (method === 'PATCH') google.set(id, JSON.parse(init!.body!));
  if (method === 'DELETE') google.delete(id);
  return res(method === 'DELETE' ? 204 : 200, {});
};
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const KEY = JSON.stringify({ client_email: 'nest@proj.iam.gserviceaccount.com', private_key: privateKey });
const CAL = 'family@group.calendar.google.com';

let a: App;
let photoDir: string;
const H = { 'x-nest': '1' };

async function signIn(name: string, admin = false): Promise<{ cookie: string; id: number }> {
  const u = a.ctx.accounts.create(name.toLowerCase(), name, admin ? 'admin' : 'member');
  const { code } = a.ctx.accounts.createCode(u.id);
  const r = await a.app.inject({ method: 'POST', url: '/api/login/code', headers: H, payload: { code: code.toLowerCase().replace('-', ' ') } });
  expect(r.statusCode).toBe(200);
  return { cookie: `nest_session=${r.cookies.find((x) => x.name === 'nest_session')!.value}`, id: u.id };
}

type Who = { cookie: string; id: number };
const call = (who: Who, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  a.app.inject({ method, url, headers: { ...H, cookie: who.cookie }, payload: payload as object });
const house = async (who: Who) => (await call(who, 'GET', '/api/house')).json().house as House;
const addJob = async (who: Who, f: Record<string, unknown>) => {
  const r = await call(who, 'POST', '/api/jobs', { roomId: 1, ...f });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().job as Job;
};
const sub = (n: number) => ({ endpoint: `https://web.push.apple.com/abc${n}xxxxxxxx`, keys: { p256dh: 'p' + n, auth: 'a' + n } });
const jpeg = (size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]);
const titles = () => sent.map((s) => s.payload.notification.title);

beforeEach(async () => {
  clock = at('2026-11-11', '08:00');
  sent = [];
  reply = () => ({ status: 201, gone: false });
  google = new Map();
  googleCalls = [];
  googleSays = null;
  photoDir = mkdtempSync(path.join(tmpdir(), 'nest-photos-'));
  a = await buildApp({ clientDir, dbPath: ':memory:', photoDir, version: 't', appUrl: 'https://nest.example', vapidSubject: 'https://nest.example', now: () => clock, sender, fetch: fakeFetch });
});
afterEach(async () => a.app.close());

describe('sign-in', () => {
  it('refuses changes without the header, a used code, and says 401 only for no session', async () => {
    const u = a.ctx.accounts.create('joe', 'Joe', 'admin');
    const { code } = a.ctx.accounts.createCode(u.id);
    expect((await a.app.inject({ method: 'POST', url: '/api/login/code', payload: { code } })).statusCode).toBe(403);
    expect((await a.app.inject({ method: 'POST', url: '/api/login/code', headers: H, payload: { code } })).statusCode).toBe(200);
    expect((await a.app.inject({ method: 'POST', url: '/api/login/code', headers: H, payload: { code } })).statusCode).toBe(403);
    expect((await a.app.inject({ method: 'GET', url: '/api/house' })).statusCode).toBe(401);
    expect((await a.app.inject({ method: 'GET', url: '/api/photos/1' })).statusCode).toBe(401);
  });
});

describe('the house', () => {
  it('starts with our rooms, in order, and both of us', async () => {
    const joe = await signIn('Joe', true);
    await signIn('Nia');
    const h = await house(joe);
    expect(h.rooms.map((r) => r.name)).toEqual(['Kitchen', 'Cwtch', 'The Den', 'Downstairs bathroom', 'Office', 'Hallway and Landing', 'Utility Room', 'Our bedroom', "Olly's Room", "Carys's Room", 'Spare Room', 'Box Room', 'Upstairs Bathroom']);
    expect(h.people.map((p) => p.displayName)).toEqual(['Joe', 'Nia']);
    expect(h.today).toBe('2026-11-11');
    expect(h.calendar).toEqual({ connected: false, error: null });
  });

  it('works as a plain list: add with just a title and room, tick, untick, bin, restore', async () => {
    const joe = await signIn('Joe');
    const nia = await signIn('Nia');
    const job = await addJob(joe, { title: '  Fix the dripping tap ' });
    expect(job).toMatchObject({ title: 'Fix the dripping tap', status: 'todo', size: 'evening', roomId: 1, assigneeId: null, dueDate: null });
    expect((await call(joe, 'POST', '/api/jobs', { title: 'No room' })).statusCode).toBe(400);
    expect((await call(joe, 'POST', '/api/jobs', { roomId: 1 })).statusCode).toBe(400);

    // Either of us can tick it.
    const done = (await call(nia, 'POST', `/api/jobs/${job.id}/done`, { done: true })).json().job as Job;
    expect(done).toMatchObject({ status: 'done', doneBy: nia.id, doneAt: clock });
    expect(((await call(nia, 'POST', `/api/jobs/${job.id}/done`, { done: false })).json().job as Job).status).toBe('todo');

    await call(joe, 'DELETE', `/api/jobs/${job.id}`);
    expect((await house(joe)).jobs).toHaveLength(0);
    expect((await call(joe, 'PUT', `/api/jobs/${job.id}`, { title: 'x' })).statusCode).toBe(404);
    await call(joe, 'POST', `/api/jobs/${job.id}/restore`);
    expect((await house(joe)).jobs).toHaveLength(1);
  });

  it('changes only what it is sent, and clears what is sent as null', async () => {
    const joe = await signIn('Joe');
    const job = await addJob(joe, { title: 'Paint the hall', roomId: 6, size: 'weekend', dueDate: '2026-11-21', assigneeId: joe.id, notes: 'Two coats', simpleCost: 4500 });
    let j = (await call(joe, 'PUT', `/api/jobs/${job.id}`, { title: 'Paint the hallway' })).json().job as Job;
    expect(j).toMatchObject({ title: 'Paint the hallway', roomId: 6, size: 'weekend', dueDate: '2026-11-21', assigneeId: joe.id, notes: 'Two coats', simpleCost: 4500 });
    j = (await call(joe, 'PUT', `/api/jobs/${job.id}`, { dueDate: null, assigneeId: null, simpleCost: null })).json().job as Job;
    expect(j).toMatchObject({ title: 'Paint the hallway', dueDate: null, assigneeId: null, simpleCost: null, notes: 'Two coats' });
    expect((await call(joe, 'PUT', `/api/jobs/${job.id}`, { size: 'huge' })).statusCode).toBe(400);
    expect((await call(joe, 'PUT', `/api/jobs/${job.id}`, { roomId: 999 })).statusCode).toBe(400);
  });

  it('keeps ideas without a room until they become jobs', async () => {
    const joe = await signIn('Joe');
    const r = await call(joe, 'POST', '/api/jobs', { title: 'Window seat?', status: 'idea' });
    expect(r.statusCode).toBe(200);
    const id = r.json().job.id;
    expect((await call(joe, 'PUT', `/api/jobs/${id}`, { status: 'todo' })).statusCode).toBe(400);
    const j = (await call(joe, 'PUT', `/api/jobs/${id}`, { status: 'todo', roomId: 2 })).json().job as Job;
    expect(j).toMatchObject({ status: 'todo', roomId: 2 });
  });

  it('has steps that tick, move and go', async () => {
    const joe = await signIn('Joe');
    const job = await addJob(joe, { title: 'Refit the bathroom', size: 'bigger', steps: ['Strip tiles', 'Plumbing', '  ', 'Tile'] });
    expect(job.steps.map((s) => s.title)).toEqual(['Strip tiles', 'Plumbing', 'Tile']);
    const [a1, b1, c1] = job.steps;
    const s = (await call(joe, 'PUT', `/api/steps/${a1.id}`, { done: true })).json().step;
    expect(s).toMatchObject({ doneBy: joe.id, doneAt: clock });
    await call(joe, 'PUT', `/api/steps/${b1.id}`, { dueDate: '2026-11-20' });
    await call(joe, 'POST', `/api/jobs/${job.id}/steps/order`, { ids: [c1.id, a1.id, b1.id] });
    await call(joe, 'POST', `/api/jobs/${job.id}/steps`, { title: 'Grout' });
    await call(joe, 'DELETE', `/api/steps/${a1.id}`);
    const now = (await house(joe)).jobs[0];
    expect(now.steps.map((x) => x.title)).toEqual(['Tile', 'Plumbing', 'Grout']);
    expect(now.steps.find((x) => x.title === 'Plumbing')!.dueDate).toBe('2026-11-20');
  });
});

describe('costs', () => {
  it('adds a job up from things to buy and bills, and tracks what has gone out', async () => {
    const joe = await signIn('Joe');
    const job = await addJob(joe, { title: 'Replaster the den', roomId: 3, size: 'bigger', simpleCost: 100 });
    const paint = (await call(joe, 'POST', `/api/jobs/${job.id}/costs`, { label: 'Paint', amount: 3800, shop: 'B&Q' })).json().cost;
    expect(paint).toMatchObject({ kind: 'item', amount: 3800, boughtAt: null, shop: 'B&Q' });
    const bought = (await call(joe, 'PUT', `/api/costs/${paint.id}`, { bought: true })).json().cost;
    expect(bought.boughtAt).toBe(clock);

    const dai = (await call(joe, 'POST', '/api/trades', { name: 'Dai the plasterer', trade: 'Plasterer', phone: '07700 900123' })).json().trade;
    const bill = (await call(joe, 'POST', `/api/jobs/${job.id}/costs`, { label: 'Plastering', amount: 60000, kind: 'trade', tradeId: dai.id })).json().cost;
    expect(bill).toMatchObject({ kind: 'trade', tradeId: dai.id });
    // Payments only go against bills, and need an amount.
    expect((await call(joe, 'POST', `/api/costs/${paint.id}/payments`, { amount: 100 })).statusCode).toBe(400);
    expect((await call(joe, 'POST', `/api/costs/${bill.id}/payments`, { amount: 0 })).statusCode).toBe(400);
    const p = await call(joe, 'POST', `/api/costs/${bill.id}/payments`, { amount: 20000, note: 'Deposit' });
    expect(p.statusCode).toBe(200);
    await call(joe, 'POST', `/api/costs/${bill.id}/payments`, { amount: 15000, paidOn: '2026-11-20' });

    const h = await house(joe);
    expect(h.payments.map((x) => [x.amount, x.paidOn, x.note])).toEqual([
      [20000, '2026-11-11', 'Deposit'],
      [15000, '2026-11-20', null],
    ]);
    await call(joe, 'DELETE', `/api/payments/${p.json().id}`);
    expect((await house(joe)).payments).toHaveLength(1);

    // Someone with bills is kept (archived) when removed; someone without goes.
    await call(joe, 'DELETE', `/api/trades/${dai.id}`);
    expect((await house(joe)).trades).toMatchObject([{ name: 'Dai the plasterer', archived: true }]);
    const tmp = (await call(joe, 'POST', '/api/trades', { name: 'Skip firm' })).json().trade;
    await call(joe, 'DELETE', `/api/trades/${tmp.id}`);
    expect((await house(joe)).trades).toHaveLength(1);

    await call(joe, 'DELETE', `/api/costs/${bill.id}`);
    expect((await house(joe)).payments).toHaveLength(0);
  });
});

describe('upkeep that comes round again', () => {
  it('leaves a fresh copy when done, and takes it back on undo', async () => {
    const joe = await signIn('Joe');
    const job = await addJob(joe, { title: 'Service the boiler', roomId: 7, repeatEvery: 1, repeatUnit: 'year', dueDate: '2026-11-01', steps: ['Book engineer'], simpleCost: 9000 });
    await call(joe, 'POST', `/api/jobs/${job.id}/costs`, { label: 'Engineer', amount: 9000, bought: true });
    await call(joe, 'POST', `/api/jobs/${job.id}/done`, { done: true });
    let jobs = (await house(joe)).jobs;
    expect(jobs).toHaveLength(2);
    const next = jobs.find((j) => j.status === 'todo')!;
    expect(next).toMatchObject({ title: 'Service the boiler', dueDate: '2027-11-11', repeatEvery: 1, repeatUnit: 'year', roomId: 7 });
    expect(next.steps.map((s) => [s.title, s.doneAt])).toEqual([['Book engineer', null]]);
    expect(next.costs.map((c) => [c.label, c.amount, c.boughtAt])).toEqual([['Engineer', 9000, null]]);

    await call(joe, 'POST', `/api/jobs/${job.id}/done`, { done: false });
    jobs = (await house(joe)).jobs;
    expect(jobs.map((j) => [j.id, j.status])).toEqual([[job.id, 'todo']]);

    // If the copy has been worked on since, it stays.
    await call(joe, 'POST', `/api/jobs/${job.id}/done`, { done: true });
    const copy = (await house(joe)).jobs.find((j) => j.status === 'todo')!;
    clock += 60_000;
    await call(joe, 'PUT', `/api/steps/${copy.steps[0].id}`, { done: true });
    await call(joe, 'POST', `/api/jobs/${job.id}/done`, { done: false });
    expect((await house(joe)).jobs).toHaveLength(2);
  });
});

describe('rooms, facts and notes', () => {
  it('keeps a passport for each room', async () => {
    const joe = await signIn('Joe');
    const id = (await call(joe, 'POST', '/api/rooms/1/facts', { label: 'Wall paint', value: 'Dulux Egyptian Cotton, matt' })).json().id;
    await call(joe, 'PUT', `/api/facts/${id}`, { label: 'Walls', value: 'Egyptian Cotton' });
    await call(joe, 'PUT', '/api/rooms/1', { notes: 'Stopcock under the sink' });
    let h = await house(joe);
    expect(h.rooms[0]).toMatchObject({ name: 'Kitchen', notes: 'Stopcock under the sink', facts: [{ label: 'Walls', value: 'Egyptian Cotton' }] });
    await call(joe, 'DELETE', `/api/facts/${id}`);
    const garage = (await call(joe, 'POST', '/api/rooms', { name: 'Garage' })).json().id;
    await call(joe, 'PUT', `/api/rooms/${garage}`, { name: 'Garden' });
    h = await house(joe);
    expect(h.rooms.at(-1)).toMatchObject({ name: 'Garden', facts: [] });
    expect(h.rooms[0].facts).toEqual([]);
    // A room with jobs is put away, not lost; an empty one just goes.
    await addJob(joe, { title: 'Sweep', roomId: 1 });
    await call(joe, 'DELETE', '/api/rooms/1');
    await call(joe, 'DELETE', `/api/rooms/${garage}`);
    h = await house(joe);
    expect(h.rooms.find((r) => r.id === 1)!.archived).toBe(true);
    expect(h.rooms.find((r) => r.id === garage)).toBeUndefined();
  });
  it('keeps shared notes, pinned first', async () => {
    const joe = await signIn('Joe');
    const nia = await signIn('Nia');
    const one = (await call(joe, 'POST', '/api/notes', { body: 'Bin day is Thursday' })).json().id;
    clock += 1000;
    await call(nia, 'POST', '/api/notes', { body: 'Wifi: on the fridge' });
    await call(nia, 'PUT', `/api/notes/${one}`, { pinned: true });
    const notes = (await house(joe)).notes;
    expect(notes.map((n) => n.body)).toEqual(['Bin day is Thursday', 'Wifi: on the fridge']);
    expect(notes[0]).toMatchObject({ pinned: true, updatedBy: joe.id }); // pinning is not an edit
    await call(joe, 'DELETE', `/api/notes/${one}`);
    expect((await house(joe)).notes).toHaveLength(1);
  });
});

describe('photos', () => {
  it('saves a photo and its thumbnail, serves them only to us, and tidies up', async () => {
    const joe = await signIn('Joe');
    const job = await addJob(joe, { title: 'Tile the splashback' });
    const up = await a.app.inject({ method: 'POST', url: `/api/photos?job=${job.id}&caption=Before&w=1600&h=1200`, headers: { ...H, cookie: joe.cookie, 'content-type': 'image/jpeg' }, payload: jpeg(300_000) });
    expect(up.statusCode, up.body).toBe(200);
    const id = up.json().id as number;
    expect(existsSync(photoFile(photoDir, id))).toBe(true);
    // Before the thumbnail arrives, the thumb address gives the full photo.
    expect((await call(joe, 'GET', `/api/photos/${id}/thumb`)).rawPayload.length).toBe(300_004);
    const th = await a.app.inject({ method: 'PUT', url: `/api/photos/${id}/thumb`, headers: { ...H, cookie: joe.cookie, 'content-type': 'image/jpeg' }, payload: jpeg(500) });
    expect(th.statusCode).toBe(200);
    const got = await call(joe, 'GET', `/api/photos/${id}/thumb`);
    expect(got.rawPayload.length).toBe(504);
    expect(got.headers['cache-control']).toContain('immutable');
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect((await house(joe)).photos).toMatchObject([{ id, jobId: job.id, caption: 'Before', w: 1600, h: 1200, createdBy: joe.id }]);

    // Not a JPEG, or not for anything: refused.
    const bad = await a.app.inject({ method: 'POST', url: `/api/photos?job=${job.id}`, headers: { ...H, cookie: joe.cookie, 'content-type': 'image/jpeg' }, payload: Buffer.alloc(500, 1) });
    expect(bad.statusCode).toBe(400);
    const nowhere = await a.app.inject({ method: 'POST', url: '/api/photos', headers: { ...H, cookie: joe.cookie, 'content-type': 'image/jpeg' }, payload: jpeg() });
    expect(nowhere.statusCode).toBe(400);

    await call(joe, 'PUT', `/api/photos/${id}`, { caption: 'After' });
    expect((await house(joe)).photos[0].caption).toBe('After');
    await call(joe, 'DELETE', `/api/photos/${id}`);
    expect(existsSync(photoFile(photoDir, id))).toBe(false);
    expect(existsSync(photoFile(photoDir, id, true))).toBe(false);
  });

  it('files a receipt under its cost, and bins photos with their job after a month', async () => {
    const joe = await signIn('Joe');
    const job = await addJob(joe, { title: 'New tap' });
    const cost = (await call(joe, 'POST', `/api/jobs/${job.id}/costs`, { label: 'Tap', amount: 6500 })).json().cost;
    const up = await a.app.inject({ method: 'POST', url: `/api/photos?cost=${cost.id}`, headers: { ...H, cookie: joe.cookie, 'content-type': 'image/jpeg' }, payload: jpeg() });
    const id = up.json().id as number;
    expect((await house(joe)).photos).toMatchObject([{ id, costId: cost.id, jobId: job.id }]);
    await call(joe, 'DELETE', `/api/jobs/${job.id}`);
    expect((await house(joe)).photos).toHaveLength(0);
    clock += BIN_MS + 1000;
    expect(a.ctx.house.emptyBin()).toEqual([id]);
    expect((await call(joe, 'POST', `/api/jobs/${job.id}/restore`)).statusCode).toBe(404);
  });
});

describe('reminders', () => {
  const setup = async () => {
    const joe = await signIn('Joe', true);
    const nia = await signIn('Nia');
    await call(joe, 'POST', '/api/push/subscribe', { subscription: sub(1) });
    await call(nia, 'POST', '/api/push/subscribe', { subscription: sub(2) });
    return { joe, nia };
  };
  const to = (n: number) => sent.filter((s) => s.sub.endpoint === sub(n).endpoint).map((s) => s.payload.notification.title);

  it('sends one reminder a day at the chosen time, to whoever the job belongs to', async () => {
    const { joe, nia } = await setup();
    await addJob(joe, { title: 'Hang the mirror', dueDate: '2026-11-11', assigneeId: joe.id });
    await addJob(joe, { title: 'Bleed the radiators', dueDate: '2026-11-11' });
    sent = [];
    await runNudges(a.ctx);
    expect(sent).toHaveLength(0); // 08:00: too early
    clock = at('2026-11-11', '09:00');
    await runNudges(a.ctx);
    expect(to(1)).toEqual(['🏡 2 jobs to keep in mind']);
    expect(to(2)).toEqual(['🔨 Today: Bleed the radiators']);
    expect(sent[0].payload.web_push).toBe(8030);
    clock += 60_000;
    await runNudges(a.ctx);
    expect(sent).toHaveLength(2); // once a day
    expect((await house(joe)).badge).toBe(2);
    expect((await house(nia)).badge).toBe(1);

    // Tomorrow: both are a day late, so a nag; the day after, nothing.
    clock = at('2026-11-12', '09:30');
    sent = [];
    await runNudges(a.ctx);
    expect(to(2)).toEqual(['⏰ Still waiting: Bleed the radiators']);
    clock = at('2026-11-13', '09:30');
    sent = [];
    await runNudges(a.ctx);
    expect(sent).toHaveLength(0);
  });

  it('respects each person’s choices', async () => {
    const { joe, nia } = await setup();
    await call(nia, 'PUT', '/api/me/settings', { remind: 'all', remindAt: '18:30' });
    await call(joe, 'PUT', '/api/me/settings', { remind: 'off' });
    expect((await call(joe, 'PUT', '/api/me/settings', { remind: 'sometimes' })).statusCode).toBe(400);
    await addJob(joe, { title: 'Joe’s job', dueDate: '2026-11-11', assigneeId: joe.id });
    sent = [];
    clock = at('2026-11-11', '12:00');
    await runNudges(a.ctx);
    expect(sent).toHaveLength(0);
    clock = at('2026-11-11', '18:30');
    await runNudges(a.ctx);
    expect(to(2)).toEqual(['🔨 Today: Joe’s job']);
    expect(to(1)).toEqual([]);
  });

  it('never sends the list at bedtime if the server was down all day', async () => {
    const { joe } = await setup();
    await addJob(joe, { title: 'Late', dueDate: '2026-11-11' });
    sent = [];
    clock = at('2026-11-11', '21:30');
    await runNudges(a.ctx);
    expect(sent).toHaveLength(0);
  });

  it('tells the other person when a job is finished, once the tick has settled', async () => {
    const { joe, nia } = await setup();
    const job = await addJob(joe, { title: 'Fix the gate', roomId: 6 });
    sent = [];
    await call(nia, 'POST', `/api/jobs/${job.id}/done`, { done: true });
    await runNudges(a.ctx);
    expect(sent).toHaveLength(0); // still inside the undo window
    clock += DONE_SETTLE_MS + 1000;
    await runNudges(a.ctx);
    expect(to(1)).toEqual(['🎉 Nia finished “Fix the gate”']);
    expect(to(2)).toEqual([]);
    expect(sent[0].payload.notification.navigate).toContain(`https://nest.example/job/${job.id}`);
    clock += 60_000;
    await runNudges(a.ctx);
    expect(sent).toHaveLength(1);
  });

  it('says nothing about a tick that was undone, or to someone who turned heads-ups off', async () => {
    const { joe, nia } = await setup();
    const one = await addJob(joe, { title: 'Slip of the thumb' });
    const two = await addJob(joe, { title: 'Real one' });
    await call(nia, 'POST', `/api/jobs/${one.id}/done`, { done: true });
    await call(nia, 'POST', `/api/jobs/${one.id}/done`, { done: false });
    await call(joe, 'PUT', '/api/me/settings', { headsUp: false });
    await call(nia, 'POST', `/api/jobs/${two.id}/done`, { done: true });
    sent = [];
    clock += DONE_SETTLE_MS + 1000;
    await runNudges(a.ctx);
    expect(sent).toHaveLength(0);
  });

  it('tells someone straight away when they are given a job', async () => {
    const { joe, nia } = await setup();
    sent = [];
    const job = await addJob(joe, { title: 'Order the blinds', roomId: 5, assigneeId: nia.id, dueDate: '2026-11-14' });
    await new Promise((r) => setTimeout(r, 20));
    expect(to(2)).toEqual(['🧰 Joe gave you “Order the blinds”']);
    expect(sent[0].payload.notification.body).toBe('Office · due Sat 14 Nov');
    // Changing something else doesn't say it again; giving it to myself says nothing.
    await call(joe, 'PUT', `/api/jobs/${job.id}`, { title: 'Order blinds' });
    await call(joe, 'PUT', `/api/jobs/${job.id}`, { assigneeId: joe.id });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
  });

  it('sends a test push and drops a phone that has gone', async () => {
    const { joe } = await setup();
    const r = await call(joe, 'POST', '/api/push/test');
    expect(r.json().sent).toMatchObject({ delivered: 1, devices: 1 });
    reply = () => ({ status: 410, gone: true });
    clock += 5000;
    await call(joe, 'POST', '/api/push/test');
    expect((await call(joe, 'GET', '/api/push/devices')).json().devices).toHaveLength(0);
  });
});

describe('the shared calendar', () => {
  const connect = (who: Who, key = KEY, calendarId = CAL) => call(who, 'PUT', '/api/calendar', { key, calendarId });
  const summaries = () => [...google.values()].map((e) => `${e.start.date} ${e.summary}`).sort();

  it('is for the admin to set up, and explains what went wrong', async () => {
    const joe = await signIn('Joe', true);
    const nia = await signIn('Nia');
    expect((await connect(nia)).statusCode).toBe(403);
    expect((await connect(joe, 'not json')).json().message).toContain('whole of the JSON file');
    expect((await connect(joe, '{"type":"x"}')).json().message).toContain('client_email');
    const wrong = await connect(joe, KEY, 'other@group.calendar.google.com');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().message).toContain('shared with nest@proj.iam.gserviceaccount.com');
    googleSays = 403;
    expect((await connect(joe)).json().message).toContain('Make changes to events');
    expect((await house(joe)).calendar.connected).toBe(false);
  });

  it('puts dated jobs and steps in, keeps them in step, and takes them out when done', async () => {
    const joe = await signIn('Joe', true);
    const mirror = await addJob(joe, { title: 'Hang the mirror', dueDate: '2026-11-14', roomId: 6 });
    await addJob(joe, { title: 'No date' });
    const refit = await addJob(joe, { title: 'Refit', size: 'bigger', steps: ['Order worktop'] });
    await call(joe, 'PUT', `/api/steps/${refit.steps[0].id}`, { dueDate: '2026-11-20' });

    const r = await connect(joe);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().calendar).toMatchObject({ connected: true, calendarId: CAL, clientEmail: 'nest@proj.iam.gserviceaccount.com', events: 2, error: null });
    expect(JSON.stringify(r.json())).not.toContain('PRIVATE KEY');
    expect(JSON.stringify((await call(joe, 'GET', '/api/calendar')).json())).not.toContain('PRIVATE KEY');
    expect(summaries()).toEqual(['2026-11-14 🏡 Hang the mirror', '2026-11-20 🏡 Order worktop (Refit)']);

    // Nothing changed: nothing sent.
    googleCalls = [];
    expect(await a.ctx.calendar.sync()).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(googleCalls).toEqual([]);

    await call(joe, 'PUT', `/api/jobs/${mirror.id}`, { dueDate: '2026-11-15' });
    expect(a.ctx.calendar.dirty).toBe(true);
    expect(await a.ctx.calendar.sync()).toEqual({ added: 0, changed: 1, removed: 0 });
    await call(joe, 'POST', `/api/jobs/${mirror.id}/done`, { done: true });
    await call(joe, 'PUT', `/api/steps/${refit.steps[0].id}`, { done: true });
    expect(await a.ctx.calendar.sync()).toEqual({ added: 0, changed: 0, removed: 2 });
    expect(google.size).toBe(0);
  });

  it('puts back an event someone deleted in Google, and retries after a failure', async () => {
    const joe = await signIn('Joe', true);
    const job = await addJob(joe, { title: 'Paint', dueDate: '2026-11-14' });
    await connect(joe);
    google.clear();
    await call(joe, 'PUT', `/api/jobs/${job.id}`, { title: 'Paint the fence' });
    expect(await a.ctx.calendar.sync()).toEqual({ added: 1, changed: 0, removed: 0 });
    expect(summaries()).toEqual(['2026-11-14 🏡 Paint the fence']);

    googleSays = 500;
    await call(joe, 'PUT', `/api/jobs/${job.id}`, { dueDate: '2026-11-16' });
    expect(await a.ctx.calendar.sync()).toBeNull();
    expect((await house(joe)).calendar).toMatchObject({ connected: true });
    expect((await house(joe)).calendar.error).toContain('500');
    expect(a.ctx.calendar.dirty).toBe(true);
    googleSays = null;
    expect(await a.ctx.calendar.sync()).toEqual({ added: 0, changed: 1, removed: 0 });
    expect((await house(joe)).calendar.error).toBeNull();
    expect(summaries()).toEqual(['2026-11-16 🏡 Paint the fence']);

    await call(joe, 'DELETE', '/api/calendar');
    expect(google.size).toBe(0);
    expect((await house(joe)).calendar.connected).toBe(false);
  });
});
