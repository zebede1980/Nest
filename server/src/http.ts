// Shared bits for the routes: the context, auth checks and input checking.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Accounts, User } from './accounts.js';
import { SESSION_MS } from './accounts.js';
import type { Db } from './db.js';
import type { Devices } from './push.js';
import type { NotifyDeps } from './notify.js';
import type { House } from './house.js';
import type { Calendar } from './gcal.js';
import { isHm, isIsoDate } from '../../shared/dates.js';

export interface Ctx {
  db: Db;
  accounts: Accounts;
  house: House;
  calendar: Calendar;
  /** Where photos are kept. */
  photoDir: string;
  devices: Devices;
  notifyDeps: NotifyDeps;
  vapidPublicKey: string;
  now: () => number;
  log: (msg: string) => void;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionToken: string | null;
  }
}

export const SESSION_COOKIE = 'nest_session';
/** Every state-changing API call must send this header. A cross-site form can't set it,
 *  and a cross-site fetch that tries gets stopped by CORS, which this server never allows. */
export const CSRF_HEADER = 'x-nest';

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // req.protocol honours X-Forwarded-Proto from nginx proxy manager (trustProxy).
    secure: req.protocol === 'https',
    maxAge: Math.floor(SESSION_MS / 1000),
  });
}

// 401 here only ever means "not signed in": no WWW-Authenticate header, so the
// browser never pops up its own password box.
export function requireUser(req: FastifyRequest, reply: FastifyReply): User | null {
  if (!req.user) {
    void reply.code(401).send({ ok: false, error: 'no_session' });
    return null;
  }
  return req.user;
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): User | null {
  const user = requireUser(req, reply);
  if (user && user.role !== 'admin') {
    void reply.code(403).send({ ok: false, error: 'admin_only' });
    return null;
  }
  return user;
}

export class BadInput extends Error {}

export type Body = Record<string, unknown>;

export function body(req: FastifyRequest): Body {
  return req.body && typeof req.body === 'object' ? (req.body as Body) : {};
}

export function idParam(req: FastifyRequest, key = 'id'): number {
  const n = Number((req.params as Record<string, string | undefined>)[key]);
  if (!Number.isInteger(n) || n <= 0) throw new BadInput('bad id');
  return n;
}

export function text(b: Body, key: string, opts: { max?: number; optional?: false }): string;
export function text(b: Body, key: string, opts: { max?: number; optional: true }): string | null;
export function text(b: Body, key: string, opts: { max?: number; optional?: boolean } = {}): string | null {
  const v = b[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (opts.optional) return null;
    throw new BadInput(`${key} is needed`);
  }
  if (typeof v !== 'string') throw new BadInput(`${key} should be text`);
  return v.trim().slice(0, opts.max ?? 200);
}

export function number(b: Body, key: string, opts: { min?: number; max?: number; optional?: boolean; int?: boolean } = {}): number | null {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return null;
    throw new BadInput(`${key} is needed`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadInput(`${key} should be a number`);
  if (opts.int && !Number.isInteger(n)) throw new BadInput(`${key} should be a whole number`);
  if ((opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) throw new BadInput(`${key} is out of range`);
  return n;
}

export function date(b: Body, key: string, optional = false): string | null {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw new BadInput(`${key} is needed`);
  }
  if (!isIsoDate(v)) throw new BadInput(`${key} should be a date`);
  return v;
}

export function hm(b: Body, key: string): string | null {
  const v = b[key];
  if (v === undefined || v === null || v === '') return null;
  if (!isHm(v)) throw new BadInput(`${key} should be a time like 09:00`);
  return v;
}

export function oneOf<T extends string>(b: Body, key: string, allowed: readonly T[], fallback?: T): T {
  const v = b[key];
  if ((v === undefined || v === null) && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new BadInput(`${key} is not one of the choices`);
  return v as T;
}

export function ints(b: Body, key: string, min: number, max: number): number[] {
  const v = b[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new BadInput(`${key} should be a list`);
  const out = [...new Set(v.map(Number))].filter((n) => Number.isInteger(n) && n >= min && n <= max);
  return out.sort((a, c) => a - c);
}

/** A list of ids, kept in the order sent (it's an ordering). */
export function idList(b: Body, key: string): number[] {
  const v = b[key];
  if (!Array.isArray(v)) throw new BadInput(`${key} should be a list`);
  return [...new Set(v.map(Number))].filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
}

export function bool(b: Body, key: string): boolean | undefined {
  const v = b[key];
  return typeof v === 'boolean' ? v : undefined;
}

/** An amount in pence. */
export function pence(b: Body, key: string, optional = false): number | null {
  return number(b, key, { min: 0, max: 100_000_000, int: true, optional });
}

/** A key the caller may have left out (undefined: leave it alone) or cleared (null). */
export const has = (b: Body, key: string) => b[key] !== undefined;
