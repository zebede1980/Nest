// People, their sessions, sign-in links and device codes, and the brake on password guessing.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from './db.js';
import { DEFAULT_SETTINGS, REMIND_CHOICES, type Me, type UserSettings } from '../../shared/model.js';
import { isHm, isValidTz } from '../../shared/dates.js';

/** Stay signed in for a year, sliding forward while the app is used: a phone app
 *  that keeps asking you to sign in would be a reason to stop using it. */
export const SESSION_MS = 365 * 24 * 60 * 60_000;
const TOUCH_EVERY_MS = 60 * 60_000;
export const LINK_MS = 7 * 24 * 60 * 60_000;
export const CODE_MS = 15 * 60_000;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

// No 0/O, 1/I/L: the code is read off one screen and typed into another.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string | null;
  role: 'admin' | 'member';
  settings: string;
  created_at: number;
  last_login_at: number | null;
  last_seen_at: number | null;
  disabled_at: number | null;
}

export interface User extends Me {
  hasPassword: boolean;
  settings: UserSettings;
  lastLoginAt: number | null;
  disabled: boolean;
}

/** Stored settings over the defaults, with anything malformed dropped. */
export function readSettings(raw: string): UserSettings {
  let s: Partial<UserSettings> = {};
  try {
    s = JSON.parse(raw) as Partial<UserSettings>;
  } catch {
    /* defaults */
  }
  const out = { ...DEFAULT_SETTINGS };
  if (isValidTz(s.tz)) out.tz = s.tz;
  if (isHm(s.remindAt)) out.remindAt = s.remindAt;
  if (REMIND_CHOICES.includes(s.remind as never)) out.remind = s.remind!;
  if (typeof s.headsUp === 'boolean') out.headsUp = s.headsUp;
  return out;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  hasPassword: !!r.password_hash,
  settings: readSettings(r.settings),
  lastLoginAt: r.last_login_at,
  disabled: r.disabled_at !== null,
});

export const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/i;

export class Accounts {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  // ── Users ────────────────────────────────────────────────────────────────
  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  list(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY id').all() as unknown as UserRow[]).map(toUser);
  }

  active(): User[] {
    return this.list().filter((u) => !u.disabled);
  }

  findById(id: number): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return r ? toUser(r) : null;
  }

  findByName(username: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
    return r ? toUser(r) : null;
  }

  create(username: string, displayName: string, role: 'admin' | 'member'): User {
    if (!USERNAME_RE.test(username)) throw new Error('Usernames are 2–32 letters, numbers, dots, dashes or underscores');
    if (this.findByName(username)) throw new Error(`There is already a user called ${username}`);
    const r = this.db
      .prepare('INSERT INTO users (username, display_name, role, created_at) VALUES (?, ?, ?, ?)')
      .run(username, displayName || username, role, this.now());
    return this.findById(Number(r.lastInsertRowid))!;
  }

  async setPassword(userId: number, password: string): Promise<void> {
    if (password.length < 6) throw new Error('Passwords need at least 6 characters');
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hash(password), userId);
  }

  async checkPassword(username: string, password: string): Promise<User | null> {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
    if (!r?.password_hash || r.disabled_at !== null) return null;
    return (await verify(r.password_hash, password)) ? toUser(r) : null;
  }

  update(userId: number, fields: { displayName?: string; role?: 'admin' | 'member' }): void {
    if (fields.displayName !== undefined) this.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(fields.displayName, userId);
    if (fields.role !== undefined) this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(fields.role, userId);
  }

  saveSettings(userId: number, settings: UserSettings): void {
    this.db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(settings), userId);
  }

  disable(userId: number): boolean {
    return this.db.prepare('UPDATE users SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL').run(this.now(), userId).changes > 0;
  }

  restore(userId: number): boolean {
    return this.db.prepare('UPDATE users SET disabled_at = NULL WHERE id = ? AND disabled_at IS NOT NULL').run(userId).changes > 0;
  }

  remove(userId: number): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  // ── Sessions ─────────────────────────────────────────────────────────────
  /** Returns the cookie token. Only its hash is stored. */
  startSession(userId: number, userAgent?: string): string {
    const token = newToken();
    const now = this.now();
    this.db
      .prepare('INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
      .run(digest(token), userId, now, now, now + SESSION_MS, userAgent?.slice(0, 200) ?? null);
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, userId);
    return token;
  }

  /** The user behind a session token, sliding its expiry forward; null if unknown or expired.
   *  `renewed` is true when the cookie should be re-sent with a fresh max-age. */
  lookupSession(token: string | undefined): { user: User; renewed: boolean } | null {
    if (!token) return null;
    const id = digest(token);
    const row = this.db.prepare('SELECT user_id, last_seen_at, expires_at FROM sessions WHERE id = ?').get(id) as
      | { user_id: number; last_seen_at: number; expires_at: number }
      | undefined;
    const now = this.now();
    if (!row) return null;
    if (row.expires_at <= now) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }
    const user = this.findById(row.user_id);
    if (!user || user.disabled) return null;
    let renewed = false;
    if (now - row.last_seen_at >= TOUCH_EVERY_MS) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(now, now + SESSION_MS, id);
      this.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, user.id);
      renewed = true;
    }
    return { user, renewed };
  }

  endSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(digest(token));
  }

  endAllSessions(userId: number): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  endOtherSessions(userId: number, keepToken: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, digest(keepToken));
  }

  // ── One-time links and device codes ──────────────────────────────────────
  createLink(userId: number): string {
    const token = newToken();
    this.insertToken(digest(token), userId, 'link', LINK_MS);
    return token;
  }

  /** A short code like "K7PQ-4XZ2" for signing in on another device; good for 15 minutes. */
  createCode(userId: number): { code: string; expiresAt: number } {
    let raw = '';
    for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    // Only one live code per person: making a new one cancels the old.
    this.db.prepare("DELETE FROM login_tokens WHERE user_id = ? AND kind = 'code' AND used_at IS NULL").run(userId);
    this.insertToken(digest('code:' + raw), userId, 'code', CODE_MS);
    return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: this.now() + CODE_MS };
  }

  useLink(token: string): User | null {
    return this.useToken(digest(token), 'link');
  }

  useCode(code: string): User | null {
    const raw = normaliseCode(code);
    if (raw.length !== 8) return null;
    return this.useToken(digest('code:' + raw), 'code');
  }

  private insertToken(id: string, userId: number, kind: 'link' | 'code', ms: number): void {
    const now = this.now();
    this.db.prepare('INSERT INTO login_tokens (id, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, kind, now, now + ms);
  }

  private useToken(id: string, kind: 'link' | 'code'): User | null {
    const row = this.db.prepare('SELECT user_id, expires_at, used_at FROM login_tokens WHERE id = ? AND kind = ?').get(id, kind) as
      | { user_id: number; expires_at: number; used_at: number | null }
      | undefined;
    const now = this.now();
    if (!row || row.used_at || row.expires_at <= now) return null;
    const user = this.findById(row.user_id);
    if (!user || user.disabled) return null;
    this.db.prepare('UPDATE login_tokens SET used_at = ? WHERE id = ?').run(now, id);
    return user;
  }

  // ── Password-guessing brake ──────────────────────────────────────────────
  recordAttempt(ip: string, username: string, ok: boolean): void {
    this.db.prepare('INSERT INTO login_attempts (ip, username, ok, at) VALUES (?, ?, ?, ?)').run(ip, username, ok ? 1 : 0, this.now());
  }

  /** Seconds to wait before trying again: 5 wrong passwords for a name, or 20 from one address, in 15 minutes. */
  lockedFor(ip: string, username: string): number {
    const since = this.now() - 15 * 60_000;
    const failures = (sql: string, key: string) => this.db.prepare(sql).all(key, since) as { at: number }[];
    const byName = failures('SELECT at FROM login_attempts WHERE username = ? AND ok = 0 AND at > ? ORDER BY at DESC LIMIT 5', username);
    const byIp = failures('SELECT at FROM login_attempts WHERE ip = ? AND ok = 0 AND at > ? ORDER BY at DESC LIMIT 20', ip);
    const until = Math.max(byName.length >= 5 ? byName[4].at + 15 * 60_000 : 0, byIp.length >= 20 ? byIp[19].at + 15 * 60_000 : 0);
    return Math.max(0, Math.ceil((until - this.now()) / 1000));
  }

  prune(): void {
    const now = this.now();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM login_tokens WHERE expires_at <= ?').run(now - 24 * 60 * 60_000);
    this.db.prepare('DELETE FROM login_attempts WHERE at < ?').run(now - 7 * 24 * 60 * 60_000);
  }
}
