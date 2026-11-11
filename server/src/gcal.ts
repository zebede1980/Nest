// The shared Google calendar. Jobs and steps with a due date appear in it as all-day
// events, kept in step as they change and taken out when they're done.
//
// Nest signs in as a Google "service account" (a robot address) that the calendar has
// been shared with, so nobody's own Google password or sign-in is involved. Nest only
// ever touches the events it made itself: it remembers each one in calendar_events.

import { createHash, createSign } from 'node:crypto';
import type { Db } from './db.js';
import { getSetting, putSetting } from './db.js';
import { BadInput } from './http.js';
import type { House } from './house.js';
import { addDays } from '../../shared/dates.js';
import { SIZE_LONG } from '../../shared/model.js';

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; text: () => Promise<string> }>;

interface Config {
  clientEmail: string;
  privateKey: string;
  calendarId: string;
}

export interface CalendarStatus {
  connected: boolean;
  calendarId: string | null;
  clientEmail: string | null;
  events: number;
  lastSyncAt: number | null;
  error: string | null;
}

interface Wanted {
  hash: string;
  body: Record<string, unknown>;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3/calendars';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

class GoogleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Google's errors, put the way a person would. */
function plain(err: unknown, cfg: Pick<Config, 'clientEmail'>): string {
  if (err instanceof GoogleError) {
    if (err.status === 404) return `Google can't find that calendar. Check the calendar ID, and that the calendar is shared with ${cfg.clientEmail}.`;
    if (err.status === 403) return `Google won't let Nest change that calendar. Share it with ${cfg.clientEmail} and choose "Make changes to events".`;
    if (err.status === 401 || err.status === 400) return `Google didn't accept the key (${err.message}). Is the Calendar API switched on for that project?`;
    return `Google said ${err.status}: ${err.message}`;
  }
  return `Couldn't reach Google: ${(err as Error).message}`;
}

export class Calendar {
  private token: { value: string; until: number; email: string } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Something changed since the last sync that worked. */
  dirty = true;

  constructor(
    private readonly db: Db,
    private readonly house: House,
    private readonly now: () => number,
    private readonly fetch: Fetch,
    private readonly appUrl: string,
    private readonly log: (msg: string) => void,
  ) {}

  private config(): Config | null {
    const raw = getSetting(this.db, 'gcal');
    return raw ? (JSON.parse(raw) as Config) : null;
  }

  status(): CalendarStatus {
    const cfg = this.config();
    const st = JSON.parse(getSetting(this.db, 'gcal_status') ?? '{}') as { lastSyncAt?: number; error?: string | null };
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get() as { n: number };
    return { connected: !!cfg, calendarId: cfg?.calendarId ?? null, clientEmail: cfg?.clientEmail ?? null, events: n, lastSyncAt: st.lastSyncAt ?? null, error: cfg ? (st.error ?? null) : null };
  }

  private note(error: string | null): void {
    const was = JSON.parse(getSetting(this.db, 'gcal_status') ?? '{}') as { lastSyncAt?: number };
    putSetting(this.db, 'gcal_status', JSON.stringify({ lastSyncAt: error ? was.lastSyncAt : this.now(), error }));
  }

  // ── Google ───────────────────────────────────────────────────────────────

  private async call(cfg: Config, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const token = await this.accessToken(cfg);
    const res = await this.fetch(`${API}/${encodeURIComponent(cfg.calendarId)}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new GoogleError(res.status, googleMessage(text));
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  /** Swaps a signed note saying who we are for an hour-long access token. */
  private async accessToken(cfg: Config): Promise<string> {
    const now = this.now();
    if (this.token && this.token.email === cfg.clientEmail && this.token.until > now + 60_000) return this.token.value;
    const iat = Math.floor(now / 1000);
    const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64(JSON.stringify({ iss: cfg.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
    let signature: string;
    try {
      signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(cfg.privateKey).toString('base64url');
    } catch {
      throw new BadInput("That key file's private key can't be read. Download a fresh JSON key and try again.");
    }
    const res = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claims}.${signature}`,
    });
    const text = await res.text();
    if (!res.ok) throw new GoogleError(res.status, googleMessage(text));
    const j = JSON.parse(text) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, until: now + j.expires_in * 1000, email: cfg.clientEmail };
    return j.access_token;
  }

  // ── Connecting ───────────────────────────────────────────────────────────

  /** Takes the service account's JSON key file and the calendar's ID, checks Google lets
   *  us in, then fills the calendar. Throws BadInput, in plain words, if it doesn't. */
  async connect(keyJson: string, calendarId: string): Promise<CalendarStatus> {
    let key: { client_email?: unknown; private_key?: unknown };
    try {
      key = JSON.parse(keyJson) as typeof key;
    } catch {
      throw new BadInput("That doesn't look like the key file. Paste the whole of the JSON file Google gave you.");
    }
    if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') throw new BadInput('That file has no client_email or private_key in it. It should be a service account key.');
    const cfg: Config = { clientEmail: key.client_email, privateKey: key.private_key, calendarId: calendarId.trim() };
    try {
      await this.call(cfg, 'GET', '/events?maxResults=1');
    } catch (err) {
      if (err instanceof BadInput) throw err;
      throw new BadInput(plain(err, cfg));
    }
    // Anything we put in a previous calendar comes out of it first.
    if (this.config()) await this.disconnect();
    putSetting(this.db, 'gcal', JSON.stringify(cfg));
    this.note(null);
    await this.sync();
    return this.status();
  }

  /** Takes our events back out of the calendar (as far as Google lets us) and forgets the key. */
  async disconnect(): Promise<void> {
    await (this.chain = this.chain.then(async () => {
      const cfg = this.config();
      if (!cfg) return;
      for (const row of this.db.prepare('SELECT event_id FROM calendar_events').all() as { event_id: string }[]) {
        await this.call(cfg, 'DELETE', `/events/${row.event_id}`).catch(() => {});
      }
      this.db.exec("DELETE FROM calendar_events; DELETE FROM settings WHERE key IN ('gcal', 'gcal_status')");
      this.token = null;
    }));
  }

  // ── Keeping in step ──────────────────────────────────────────────────────

  /** What should be in the calendar right now. */
  wanted(): Map<string, Wanted> {
    const out = new Map<string, Wanted>();
    const rooms = new Map(this.house.rooms().map((r) => [r.id, r.name]));
    const people = new Map(this.house.people().map((p) => [p.id, p.displayName]));
    const add = (ref: string, summary: string, date: string, about: (string | null | undefined)[], jobId: number) => {
      const body = {
        summary: `🏡 ${summary}`,
        description: `${about.filter(Boolean).join(' · ')}\n${this.appUrl}/job/${jobId}`,
        start: { date },
        end: { date: addDays(date, 1) },
        // An all-day job shouldn't make the day look busy.
        transparency: 'transparent',
      };
      out.set(ref, { body, hash: createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32) });
    };
    for (const job of this.house.jobs()) {
      if (job.status !== 'todo') continue;
      const where = job.roomId ? rooms.get(job.roomId) : null;
      const who = job.assigneeId ? people.get(job.assigneeId) : null;
      if (job.dueDate) add(`job:${job.id}`, job.title, job.dueDate, [where, SIZE_LONG[job.size], who], job.id);
      for (const step of job.steps) if (step.dueDate && !step.doneAt) add(`step:${step.id}`, `${step.title} (${job.title})`, step.dueDate, [where, who], job.id);
    }
    return out;
  }

  /** Something may have changed: sync shortly, once things settle. */
  poke(): void {
    this.dirty = true;
    if (!this.config()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), 3_000);
    this.timer.unref();
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  /** Makes the calendar match: adds what's new, changes what changed, removes what's gone.
   *  One at a time, and a failure is kept for the settings page and retried next minute. */
  sync(): Promise<{ added: number; changed: number; removed: number } | null> {
    const run = this.chain.then(() => this.syncOnce());
    this.chain = run.catch(() => {});
    return run;
  }

  private async syncOnce(): Promise<{ added: number; changed: number; removed: number } | null> {
    const cfg = this.config();
    if (!cfg) return null;
    this.dirty = false;
    const want = this.wanted();
    const have = new Map((this.db.prepare('SELECT ref, event_id, hash FROM calendar_events').all() as { ref: string; event_id: string; hash: string }[]).map((r) => [r.ref, r]));
    const save = this.db.prepare('INSERT INTO calendar_events (ref, event_id, hash, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(ref) DO UPDATE SET event_id = excluded.event_id, hash = excluded.hash, updated_at = excluded.updated_at');
    const out = { added: 0, changed: 0, removed: 0 };
    try {
      for (const [ref, ev] of want) {
        const row = have.get(ref);
        if (row?.hash === ev.hash) continue;
        let eventId = row?.event_id;
        if (eventId) {
          try {
            await this.call(cfg, 'PATCH', `/events/${eventId}`, ev.body);
            out.changed++;
          } catch (err) {
            // Someone deleted it in Google: put it back.
            if (!(err instanceof GoogleError) || (err.status !== 404 && err.status !== 410)) throw err;
            eventId = undefined;
          }
        }
        if (!eventId) {
          eventId = (await this.call(cfg, 'POST', '/events', ev.body)).id as string;
          out.added++;
        }
        save.run(ref, eventId, ev.hash, this.now());
      }
      for (const [ref, row] of have) {
        if (want.has(ref)) continue;
        try {
          await this.call(cfg, 'DELETE', `/events/${row.event_id}`);
        } catch (err) {
          if (!(err instanceof GoogleError) || (err.status !== 404 && err.status !== 410)) throw err;
        }
        this.db.prepare('DELETE FROM calendar_events WHERE ref = ?').run(ref);
        out.removed++;
      }
      this.note(null);
      if (out.added || out.changed || out.removed) this.log(`Calendar: ${out.added} added, ${out.changed} changed, ${out.removed} removed`);
      return out;
    } catch (err) {
      this.dirty = true;
      const msg = plain(err, cfg);
      this.note(msg);
      this.log(`Calendar sync failed: ${msg}`);
      return null;
    }
  }
}

function googleMessage(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
    if (typeof j.error === 'object' && j.error?.message) return j.error.message;
    return j.error_description ?? (typeof j.error === 'string' ? j.error : text.slice(0, 200));
  } catch {
    return text.slice(0, 200);
  }
}
