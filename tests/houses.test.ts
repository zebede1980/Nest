// More than one house: nothing from one house can be seen, changed or reminded about from
// another, a global admin can look after any of them, and the move to houses kept every
// row that was already there.

import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../server/src/app';
import { MIGRATIONS, openDb } from '../server/src/db';
import type { Fetch } from '../server/src/gcal';
import type { PushSender, Subscription } from '../server/src/push';
import { photoFile } from '../server/src/routes/photos';
import { DONE_SETTLE_MS, runNudges } from '../server/src/scheduler';
import { localToMs } from '../shared/dates';
import type { House, Job } from '../shared/model';

const clientDir = mkdtempSync(path.join(tmpdir(), 'nest-client-'));
writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>t</title>');

const TZ = 'Europe/London';
const at = (date: string, hm: string) => localToMs(date, +hm.slice(0, 2) * 60 + +hm.slice(3), TZ);
const TODAY = '2026-11-11';

const COTTAGE_ROOMS = ['Lounge', 'Dining Room', 'Study', 'Kitchen', 'Downstairs Loo', 'Main Bedroom', 'Ensuite', 'Blue Room', 'Green Room', 'Spare Room', 'Attic'];

let clock = 0;
let sent: { sub: Subscription; title: string }[] = [];
const sender: PushSender = async (sub, payload) => {
  sent.push({ sub, title: (JSON.parse(payload) as { notification: { title: string } }).notification.title });
  return { status: 201, gone: false };
};
const pushedTo = () => sent.map((s) => s.sub.endpoint.match(/abc(\d+)x/)![1]).map(Number);

// A pretend Google calendar, as in app.test.ts.
let google: Map<string, { summary: string }>;
const fakeFetch: Fetch = async (url, init) => {
  const method = init?.method ?? 'GET';
  const res = (status: number, body: unknown = {}) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
  if (url.includes('oauth2.googleapis.com')) return res(200, { access_token: 'tok', expires_in: 3600 });
  if (method === 'GET') return res(200, { items: [] });
  if (method === 'POST') {
    const id = `ev${google.size + 1}`;
    google.set(id, JSON.parse(init!.body!));
    return res(200, { id });
  }
  const id = url.split('/events/')[1];
  if (method === 'PATCH') google.set(id, JSON.parse(init!.body!));
  if (method === 'DELETE') google.delete(id);
  return res(200, {});
};
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const KEY = JSON.stringify({ client_email: 'nest@proj.iam.gserviceaccount.com', private_key: privateKey });

let a: App;
let photoDir: string;
const H = { 'x-nest': '1' };
type Who = { cookie: string; id: number };

async function session(userId: number): Promise<Who> {
  const { code } = a.ctx.accounts.createCode(userId);
  const r = await a.app.inject({ method: 'POST', url: '/api/login/code', headers: H, payload: { code } });
  expect(r.statusCode).toBe(200);
  return { cookie: `nest_session=${r.cookies.find((x) => x.name === 'nest_session')!.value}`, id: userId };
}
const signIn = async (name: string, houseId: number, admin = false) => session(a.ctx.accounts.create(name.toLowerCase(), name, admin ? 'admin' : 'member', houseId).id);

const call = (who: Who, method: string, url: string, payload?: unknown) =>
  a.app.inject({ method: method as 'GET', url, headers: { ...H, cookie: who.cookie }, payload: payload as object });
const ok = async (who: Who, method: string, url: string, payload?: unknown) => {
  const r = await call(who, method, url, payload);
  expect(r.statusCode, `${method} ${url}: ${r.body}`).toBe(200);
  return r.json();
};
const jpeg = (size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]);
const upload = (who: Who, url: string) => a.app.inject({ method: 'POST', url, headers: { ...H, cookie: who.cookie, 'content-type': 'image/jpeg' }, payload: jpeg() });
const house = async (who: Who) => (await ok(who, 'GET', '/api/house')).house as House;

let joe: Who, nia: Who, sam: Who, alex: Who;
let cottage: number;

beforeEach(async () => {
  clock = at(TODAY, '08:00');
  sent = [];
  google = new Map();
  photoDir = mkdtempSync(path.join(tmpdir(), 'nest-photos-'));
  a = await buildApp({ clientDir, dbPath: ':memory:', photoDir, version: 't', appUrl: 'https://nest.example', vapidSubject: 'https://nest.example', now: () => clock, sender, fetch: fakeFetch });
  cottage = a.ctx.houses.create('The Cottage', COTTAGE_ROOMS);
  joe = await signIn('Joe', 1, true);
  nia = await signIn('Nia', 1);
  sam = await signIn('Sam', cottage, true);
  alex = await signIn('Alex', cottage);
});

/** Our house with one of everything in it, and the ids of each. */
async function fillOurHouse() {
  const room = (await house(joe)).rooms[0].id;
  const job = (await ok(joe, 'POST', '/api/jobs', { title: 'Paint the hall', roomId: room, dueDate: TODAY, assigneeId: nia.id, steps: ['Sand it'] })).job as Job;
  const binned = (await ok(joe, 'POST', '/api/jobs', { title: 'Old idea', roomId: room })).job as Job;
  await ok(joe, 'DELETE', `/api/jobs/${binned.id}`);
  const trade = (await ok(joe, 'POST', '/api/trades', { name: 'Dave the plasterer' })).trade.id as number;
  const item = (await ok(joe, 'POST', `/api/jobs/${job.id}/costs`, { label: 'Paint', amount: 2500 })).cost.id as number;
  const bill = (await ok(joe, 'POST', `/api/jobs/${job.id}/costs`, { label: 'Plastering', amount: 40000, kind: 'trade', tradeId: trade })).cost.id as number;
  const payment = (await ok(joe, 'POST', `/api/costs/${bill}/payments`, { amount: 10000 })).id as number;
  const photo = (await upload(joe, `/api/photos?job=${job.id}`)).json().id as number;
  await upload(joe, `/api/photos?room=${room}`);
  const fact = (await ok(joe, 'POST', `/api/rooms/${room}/facts`, { label: 'Paint', value: 'Farrow & Ball' })).id as number;
  const note = (await ok(joe, 'POST', '/api/notes', { body: 'Boiler code 1234' })).id as number;
  await ok(joe, 'POST', '/api/push/subscribe', { subscription: { endpoint: 'https://web.push.apple.com/abc1xxxxxxxxxx', keys: { p256dh: 'p', auth: 'a' } } });
  const device = (await ok(joe, 'GET', '/api/push/devices')).devices[0].id as number;
  const notification = (await ok(joe, 'POST', '/api/push/test')).sent.id as number;
  return { room, job: job.id, step: job.steps[0].id, binned: binned.id, trade, item, bill, payment, photo, fact, note, device, notification };
}

/** Everything about our house, as Joe and Nia see it. */
async function snapshot() {
  const h = await house(joe);
  return JSON.stringify({
    house: { ...h, today: null },
    users: (await ok(joe, 'GET', '/api/users')).users,
    devices: (await ok(joe, 'GET', '/api/push/devices')).devices,
    sent: (await ok(joe, 'GET', '/api/notifications')).sent,
    houses: a.db.prepare('SELECT * FROM houses ORDER BY id').all(),
    sessions: a.db.prepare('SELECT user_id, house_id FROM sessions ORDER BY rowid').all(),
    photoFiles: h.photos.map((p) => readFileSync(photoFile(photoDir, p.id)).length),
  });
}

describe('houses are kept apart', () => {
  it('shows each house only its own rooms, people and jobs', async () => {
    await fillOurHouse();
    const ours = await house(joe);
    const theirs = await house(sam);
    expect(ours.rooms.map((r) => r.name)).toContain('Cwtch');
    expect(theirs).toMatchObject({ id: cottage, name: 'The Cottage', visiting: false, jobs: [], trades: [], photos: [], notes: [], payments: [], visitors: [] });
    expect(theirs.rooms.map((r) => r.name)).toEqual(COTTAGE_ROOMS);
    expect(theirs.people.map((p) => p.displayName)).toEqual(['Sam', 'Alex']);
    expect(ours.people.map((p) => p.displayName)).toEqual(['Joe', 'Nia']);
    expect((await ok(sam, 'GET', '/api/users')).users.map((u: { username: string }) => u.username)).toEqual(['sam', 'alex']);
    expect((await ok(joe, 'GET', '/api/users')).users.map((u: { username: string }) => u.username)).toEqual(['joe', 'nia']);
    // A room added in one house starts at the top of that house's own order.
    await ok(sam, 'POST', '/api/rooms', { name: 'Garage' });
    expect((await house(sam)).rooms.at(-1)!.name).toBe('Garage');
    expect((await house(joe)).rooms.map((r) => r.name)).not.toContain('Garage');
  });

  it('answers "gone" to every route given something from another house, and changes nothing', async () => {
    const ids = await fillOurHouse();
    const before = await snapshot();

    // Every route that takes an id, and what of ours to point it at. A new route that isn't
    // listed here fails this test, so it can't skip the house check unnoticed.
    const target: Record<string, number> = {
      '/api/jobs/:id/restore': ids.binned,
      '/api/jobs/:id': ids.job,
      '/api/steps/:id': ids.step,
      '/api/costs/:id': ids.bill,
      '/api/payments/:id': ids.payment,
      '/api/photos/:id': ids.photo,
      '/api/trades/:id': ids.trade,
      '/api/rooms/:id': ids.room,
      '/api/facts/:id': ids.fact,
      '/api/notes/:id': ids.note,
      '/api/users/:id': nia.id,
      '/api/houses/:id': 1,
      // These belong to a person, not a house: someone else's are silently left alone.
      '/api/push/devices/:id': ids.device,
      '/api/notifications/:id': ids.notification,
    };
    const perPerson = ['/api/push/devices/:id', '/api/notifications/:id'];
    // Routes with no id: each works only on the caller's own house or their own things.
    const noId = new Set([
      'GET /api/health', 'GET /api/house', 'GET /api/houses', 'POST /api/houses', 'POST /api/houses/view',
      'GET /api/me', 'POST /api/me/code', 'POST /api/me/password', 'PUT /api/me/settings', 'POST /api/login', 'POST /api/login/code', 'POST /api/logout',
      'GET /api/users', 'POST /api/users', 'POST /api/jobs', 'POST /api/trades', 'POST /api/rooms', 'POST /api/rooms/order', 'POST /api/notes', 'POST /api/photos',
      'GET /api/calendar', 'PUT /api/calendar', 'DELETE /api/calendar', 'POST /api/calendar/sync',
      'GET /api/push/key', 'POST /api/push/subscribe', 'POST /api/push/unsubscribe', 'GET /api/push/devices', 'POST /api/push/test', 'GET /api/notifications',
      'GET /l/:token', 'POST /l/:token', 'GET /*', 'GET /api/*', 'POST /api/*', 'PUT /api/*', 'DELETE /api/*', 'PATCH /api/*', 'OPTIONS /api/*',
      'SEARCH /api/*', 'PROPFIND /api/*', 'PROPPATCH /api/*', 'MKCOL /api/*', 'COPY /api/*', 'MOVE /api/*', 'LOCK /api/*', 'UNLOCK /api/*', 'TRACE /api/*',
      'REPORT /api/*', 'MKCALENDAR /api/*', 'QUERY /api/*',
    ]);

    const tried: string[] = [];
    const unknown: string[] = [];
    // Everything a route might want in its body, so it gets past checking the input.
    const anything = { title: 'Hacked', label: 'Hacked', value: 'Hacked', name: 'Hacked', body: 'Hacked', caption: 'Hacked', amount: 100, done: true, pinned: true, archived: true, ids: [ids.step, ids.room] };
    for (const r of a.routes) {
      const key = `${r.method} ${r.url}`;
      if (noId.has(key)) continue;
      const prefix = Object.keys(target).find((p) => r.url.startsWith(p));
      if (!prefix || !r.url.includes(':id')) {
        unknown.push(key);
        continue;
      }
      const url = r.url.replace(':id', String(target[prefix]));
      for (const who of [sam, alex]) {
        const res = r.url.endsWith('/thumb') && r.method === 'PUT'
          ? await a.app.inject({ method: 'PUT', url, headers: { ...H, cookie: who.cookie, 'content-type': 'image/jpeg' }, payload: jpeg() })
          : await call(who, r.method, url, r.method === 'GET' || r.method === 'DELETE' ? undefined : anything);
        if (perPerson.includes(prefix)) continue;
        // Sam is an admin in his own house, so for him it's always "not found";
        // Alex may be stopped earlier for not being an admin.
        if (who === sam) expect(res.statusCode, `${key} as Sam: ${res.body}`).toBe(404);
        else expect([403, 404], `${key} as Alex: ${res.body}`).toContain(res.statusCode);
      }
      tried.push(key);
    }
    expect(unknown, 'routes this test does not know about').toEqual([]);
    expect(tried.length).toBeGreaterThan(30);

    // Ids of ours slipped into their own requests.
    const theirRoom = (await house(sam)).rooms[0].id;
    expect((await call(sam, 'POST', '/api/jobs', { title: 'x', roomId: ids.room })).statusCode).toBe(400);
    expect((await call(sam, 'POST', '/api/jobs', { title: 'x', roomId: theirRoom, assigneeId: nia.id })).statusCode).toBe(400);
    const theirJob = (await ok(sam, 'POST', '/api/jobs', { title: 'Fix the gate', roomId: theirRoom })).job.id as number;
    expect((await call(sam, 'PUT', `/api/jobs/${theirJob}`, { roomId: ids.room })).statusCode).toBe(400);
    expect((await call(sam, 'PUT', `/api/jobs/${theirJob}`, { assigneeId: joe.id })).statusCode).toBe(400);
    expect((await call(sam, 'POST', `/api/jobs/${theirJob}/costs`, { label: 'x', amount: 1, kind: 'trade', tradeId: ids.trade })).statusCode).toBe(400);
    expect((await upload(sam, `/api/photos?job=${ids.job}`)).statusCode).toBe(404);
    expect((await upload(sam, `/api/photos?room=${ids.room}`)).statusCode).toBe(404);
    expect((await upload(sam, `/api/photos?cost=${ids.bill}`)).statusCode).toBe(404);
    // Trying to pull our last room to the top of the list.
    const ourLast = (await house(joe)).rooms.at(-1)!.id;
    await call(sam, 'POST', '/api/rooms/order', { ids: [ourLast, theirRoom, ids.room] });
    await call(sam, 'POST', `/api/jobs/${theirJob}/steps/order`, { ids: [ids.step] });
    // Not even an admin of theirs can rename ours, or look at other houses.
    expect((await call(sam, 'GET', '/api/houses')).statusCode).toBe(403);
    expect((await call(sam, 'POST', '/api/houses/view', { houseId: 1 })).statusCode).toBe(403);

    expect(await snapshot()).toBe(before);
  });

  it('only reminds and tells people about their own house', async () => {
    const sub = (who: Who, n: number) => ok(who, 'POST', '/api/push/subscribe', { subscription: { endpoint: `https://web.push.apple.com/abc${n}xxxxxxxxxx`, keys: { p256dh: 'p', auth: 'a' } } });
    await sub(joe, 1);
    await sub(nia, 2);
    await sub(sam, 3);
    await sub(alex, 4);
    const room = (await house(joe)).rooms[0].id;
    // Nobody's in particular, due today: everyone in our house hears about it, nobody at The Cottage.
    const job = (await ok(joe, 'POST', '/api/jobs', { title: 'Bleed the radiators', roomId: room, dueDate: TODAY })).job as Job;
    clock = at(TODAY, '09:00');
    await runNudges(a.ctx);
    expect(pushedTo().sort()).toEqual([1, 2]);

    // Joe finishes it: Nia is told, Sam and Alex aren't.
    sent = [];
    await ok(joe, 'POST', `/api/jobs/${job.id}/done`, { done: true });
    clock += DONE_SETTLE_MS + 1000;
    await runNudges(a.ctx);
    expect(pushedTo()).toEqual([2]);
    expect(sent[0].title).toContain('Joe finished');

    // Their own reminder only lists their own jobs.
    const theirs = (await house(sam)).rooms[0].id;
    await ok(sam, 'POST', '/api/jobs', { title: 'Clear the gutters', roomId: theirs, dueDate: '2026-11-12', size: 'evening' });
    const words = (r: { today: { title: string; body: string } | null }) => (r.today ? r.today.title + r.today.body : '');
    expect(words(await ok(sam, 'GET', '/api/notifications'))).toContain('Clear the gutters');
    expect(words(await ok(joe, 'GET', '/api/notifications'))).not.toContain('Clear the gutters');
  });

  it('keeps a calendar per house', async () => {
    const theirs = (await house(sam)).rooms[0].id;
    await ok(joe, 'POST', '/api/jobs', { title: 'Paint the fence', roomId: (await house(joe)).rooms[0].id, dueDate: '2026-11-14' });
    await ok(sam, 'POST', '/api/jobs', { title: 'Clear the gutters', roomId: theirs, dueDate: '2026-11-15' });
    expect((await call(alex, 'PUT', '/api/calendar', { key: KEY, calendarId: 'cottage@group.calendar.google.com' })).statusCode).toBe(403);
    await ok(sam, 'PUT', '/api/calendar', { key: KEY, calendarId: 'cottage@group.calendar.google.com' });
    expect([...google.values()].map((e) => e.summary)).toEqual(['🏡 Clear the gutters']);
    expect((await house(sam)).calendar.connected).toBe(true);
    expect((await house(joe)).calendar.connected).toBe(false);
    expect((await ok(joe, 'GET', '/api/calendar')).calendar.events).toBe(0);
    // Our changes don't touch their calendar.
    await ok(joe, 'POST', '/api/jobs', { title: 'Hang the mirror', roomId: (await house(joe)).rooms[0].id, dueDate: '2026-11-16' });
    await a.ctx.calendars.for(cottage).sync();
    expect(google.size).toBe(1);
  });

  it('moves a person to another house, and lets go of their jobs in the old one', async () => {
    const room = (await house(joe)).rooms[0].id;
    const job = (await ok(joe, 'POST', '/api/jobs', { title: 'Mend the shed', roomId: room, assigneeId: nia.id })).job as Job;
    a.ctx.accounts.moveTo(nia.id, cottage);
    expect((await house(joe)).jobs.find((j) => j.id === job.id)!.assigneeId).toBeNull();
    expect((await house(nia)).name).toBe('The Cottage');
    expect((await house(joe)).people.map((p) => p.displayName)).toEqual(['Joe']);
  });
});

describe('a global admin', () => {
  beforeEach(() => a.ctx.accounts.update(joe.id, { globalAdmin: true }));

  it('sees every house, looks after one at a time, and is still reminded only of home', async () => {
    const room = (await house(joe)).rooms[0].id;
    await ok(joe, 'POST', '/api/jobs', { title: 'Bleed the radiators', roomId: room, dueDate: TODAY });
    expect((await call(nia, 'GET', '/api/houses')).statusCode).toBe(403);
    expect((await call(nia, 'POST', '/api/houses/view', { houseId: cottage })).statusCode).toBe(403);

    const list = (await ok(joe, 'GET', '/api/houses')).houses as { id: number; name: string; people: { displayName: string }[] }[];
    expect(list.map((h) => [h.name, h.people.map((p) => p.displayName)])).toEqual([
      ['Our house', ['Joe', 'Nia']],
      ['The Cottage', ['Sam', 'Alex']],
    ]);

    // A second phone of Joe's stays at home while this one looks after The Cottage.
    const joePhone = await session(joe.id);
    await ok(joe, 'POST', '/api/houses/view', { houseId: cottage });
    const there = await house(joe);
    expect(there).toMatchObject({ id: cottage, name: 'The Cottage', visiting: true });
    expect(there.people.map((p) => p.displayName)).toEqual(['Sam', 'Alex']);
    // The app icon's number is still about his own house.
    expect(there.badge).toBe(1);
    expect((await house(joePhone)).id).toBe(1);

    // He works in their house as one of them, but can't be given their jobs.
    const theirRoom = there.rooms[0].id;
    const job = (await ok(joe, 'POST', '/api/jobs', { title: 'Fix the gate', roomId: theirRoom })).job as Job;
    expect((await call(joe, 'PUT', `/api/jobs/${job.id}`, { assigneeId: joe.id })).statusCode).toBe(400);
    const seen = await house(sam);
    expect(seen.jobs.map((j) => j.title)).toEqual(['Fix the gate']);
    expect(seen.visitors).toEqual([{ id: joe.id, displayName: 'Joe' }]);
    expect((await house(nia)).jobs.map((j) => j.title)).toEqual(['Bleed the radiators']);

    // ...and is their admin: their people, and sign-in links for them.
    expect((await ok(joe, 'GET', '/api/users')).users.map((u: { username: string }) => u.username)).toEqual(['sam', 'alex']);
    expect((await ok(joe, 'POST', `/api/users/${sam.id}/link`)).url).toMatch(/\/l\//);
    expect((await call(joe, 'POST', `/api/users/${nia.id}/link`)).statusCode).toBe(404);
    const added = await ok(joe, 'POST', '/api/users', { username: 'robin', displayName: 'Robin' });
    expect(a.ctx.accounts.findById(added.user.id)!.houseId).toBe(cottage);

    // Home again.
    await ok(joe, 'POST', '/api/houses/view', { houseId: null });
    expect((await house(joe)).id).toBe(1);

    // Without the flag, a chosen house counts for nothing.
    await ok(joe, 'POST', '/api/houses/view', { houseId: cottage });
    a.ctx.accounts.update(joe.id, { globalAdmin: false });
    expect((await house(joe)).id).toBe(1);
  });

  it('adds houses with their rooms, and renames them; a house admin only their own', async () => {
    const id = (await ok(joe, 'POST', '/api/houses', { name: 'The Caravan', rooms: 'Lounge\n\nBunk room\n' })).id as number;
    await ok(joe, 'POST', '/api/houses/view', { houseId: id });
    expect((await house(joe)).rooms.map((r) => r.name)).toEqual(['Lounge', 'Bunk room']);
    expect((await call(joe, 'POST', '/api/houses', { name: 'the caravan' })).statusCode).toBe(400);
    await ok(sam, 'PUT', `/api/houses/${cottage}`, { name: 'The Cottage' });
    expect((await house(sam)).name).toBe('The Cottage');
    expect((await call(sam, 'PUT', '/api/houses/1', { name: 'Mine now' })).statusCode).toBe(404);
    expect((await call(alex, 'PUT', `/api/houses/${cottage}`, { name: 'The Den' })).statusCode).toBe(403);
    await ok(joe, 'PUT', '/api/houses/1', { name: 'Our place' });
    expect((await house(nia)).name).toBe('Our place');
  });
});

describe('moving to houses', () => {
  it('keeps every row that was there, all in house 1, with nothing else changed', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'nest-migrate-')), 'nest.db');
    const old = new DatabaseSync(file);
    old.exec('PRAGMA foreign_keys = ON');
    old.exec(MIGRATIONS[0]);
    old.exec('PRAGMA user_version = 1');
    const t = 1_794_000_000_000;
    old.exec(`
      INSERT INTO users (id, username, display_name, role, created_at) VALUES (1, 'joe', 'Joe', 'admin', ${t}), (2, 'nia', 'Nia', 'member', ${t});
      INSERT INTO sessions VALUES ('s1', 2, ${t}, ${t}, ${t + 1}, 'iPhone');
      INSERT INTO login_tokens VALUES ('t1', 2, 'link', ${t}, ${t + 1}, ${t});
      INSERT INTO login_attempts (ip, username, ok, at) VALUES ('1.2.3.4', 'nia', 1, ${t});
      INSERT INTO trades (id, name, created_at) VALUES (1, 'Dave', ${t});
      INSERT INTO room_facts (room_id, label, value, created_at) VALUES (2, 'Paint', 'Sage', ${t});
      INSERT INTO jobs (id, title, status, room_id, size, assignee_id, due_date, notes, simple_cost, created_at, created_by, updated_at)
        VALUES (1, 'Paint the cwtch', 'todo', 2, 'weekend', 2, '2026-11-20', 'Nia''s colour', NULL, ${t}, 2, ${t}),
               (2, 'New boiler', 'idea', NULL, 'bigger', NULL, NULL, NULL, 250000, ${t}, 1, ${t});
      INSERT INTO jobs (id, title, status, room_id, created_at, updated_at, done_at, done_by, deleted_at) VALUES (3, 'Old', 'done', 1, ${t}, ${t}, ${t}, 1, ${t});
      INSERT INTO steps (job_id, title, sort, created_at) VALUES (1, 'Sand', 0, ${t}), (1, 'Paint', 1, ${t});
      INSERT INTO costs (id, job_id, label, amount, kind, trade_id, created_at) VALUES (1, 1, 'Paint', 2500, 'item', NULL, ${t}), (2, 1, 'Plaster', 40000, 'trade', 1, ${t});
      INSERT INTO payments (cost_id, amount, paid_on, created_at, created_by) VALUES (2, 10000, '2026-11-12', ${t}, 1);
      INSERT INTO photos (id, job_id, room_id, cost_id, w, h, has_thumb, created_at, created_by) VALUES (1, 1, NULL, NULL, 1600, 1200, 1, ${t}, 2), (2, NULL, 3, NULL, 800, 600, 1, ${t}, 1), (3, 1, NULL, 2, 10, 10, 0, ${t}, 1);
      INSERT INTO notes (body, pinned, created_at, updated_at, updated_by) VALUES ('Boiler code', 1, ${t}, ${t}, 2);
      INSERT INTO calendar_events VALUES ('job:1', 'ev1', 'h', ${t});
      INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at, seen_at) VALUES (2, 'https://web.push.apple.com/x', 'p', 'a', ${t}, ${t});
      INSERT INTO notifications (user_id, kind, title, body, url, sent_at) VALUES (2, 'test', 'Hi', 'There', '/', ${t});
      INSERT INTO nudge_keys VALUES (2, 'test:1', 1, ${t});
      INSERT INTO settings VALUES ('vapid', '{"publicKey":"k"}'), ('gcal', '{"calendarId":"c"}'), ('gcal_status', '{}');
    `);
    const tables = (old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    const dump = (db: DatabaseSync) => Object.fromEntries(tables.map((tb) => [tb, db.prepare(`SELECT * FROM ${tb} ORDER BY rowid`).all()]));
    const before = dump(old);
    old.close();

    const db = openDb(file);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('SELECT id, name FROM houses').all()).toEqual([{ id: 1, name: 'Our house' }]);
    const after = dump(db);
    for (const tb of tables) {
      // Every row still there, with every old column as it was, and the new ones on house 1.
      const strip = (rows: Record<string, unknown>[]) => rows.map(({ house_id: h, global_admin: g, ...rest }) => {
        if (h !== undefined && tb !== 'sessions') expect(h, `${tb}.house_id`).toBe(1);
        if (tb === 'sessions') expect(h).toBeNull();
        if (g !== undefined) expect(g).toBe(0);
        return rest;
      });
      if (tb === 'settings') continue;
      expect(strip(after[tb] as Record<string, unknown>[]), tb).toEqual(before[tb]);
    }
    expect(after.settings).toEqual([
      { key: 'vapid', value: '{"publicKey":"k"}' },
      { key: 'gcal:1', value: '{"calendarId":"c"}' },
      { key: 'gcal_status:1', value: '{}' },
    ]);
    db.close();
    // Opening it again changes nothing.
    const again = openDb(file);
    expect(dump(again)).toEqual(after);
    again.close();
  });
});
