import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// Each entry upgrades the schema by one version (tracked in PRAGMA user_version).
// Never edit a shipped migration — add a new one, or old databases won't match.
export const MIGRATIONS: string[] = [
  // v1: people, the house (rooms, jobs, steps, costs, trades, photos, notes), phones, and what was sent.
  `
  CREATE TABLE users (
    id             INTEGER PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name   TEXT NOT NULL,
    password_hash  TEXT,
    role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    settings       TEXT NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL,
    last_login_at  INTEGER,
    last_seen_at   INTEGER,
    disabled_at    INTEGER
  );

  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,  -- sha256 of the cookie token, never the token itself
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    user_agent   TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- One-time sign-in links and short device codes (sha256 of the token).
  -- The installed iPhone app has its own cookies, separate from Safari, so a code
  -- shown in one is how the other signs in without a password.
  CREATE TABLE login_tokens (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('link', 'code')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  CREATE TABLE login_attempts (
    id       INTEGER PRIMARY KEY,
    ip       TEXT NOT NULL,
    username TEXT COLLATE NOCASE,
    ok       INTEGER NOT NULL,
    at       INTEGER NOT NULL
  );
  CREATE INDEX attempts_user ON login_attempts(username, at);
  CREATE INDEX attempts_ip ON login_attempts(ip, at);

  CREATE TABLE rooms (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    tint        INTEGER NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0,
    notes       TEXT,
    archived_at INTEGER,
    created_at  INTEGER NOT NULL
  );

  -- The room passport: paint colours, bulb types, measurements.
  CREATE TABLE room_facts (
    id         INTEGER PRIMARY KEY,
    room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    value      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- The people we pay.
  CREATE TABLE trades (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    trade       TEXT,
    phone       TEXT,
    email       TEXT,
    notes       TEXT,
    archived_at INTEGER,
    created_at  INTEGER NOT NULL
  );

  -- Jobs belong to the household, not to one person. An idea has no room until it's promoted.
  CREATE TABLE jobs (
    id           INTEGER PRIMARY KEY,
    title        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('idea', 'todo', 'done')),
    room_id      INTEGER REFERENCES rooms(id),
    size         TEXT NOT NULL DEFAULT 'evening' CHECK (size IN ('evening', 'weekend', 'bigger')),
    assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_date     TEXT,
    notes        TEXT,
    simple_cost  INTEGER,            -- pence
    repeat_every INTEGER,
    repeat_unit  TEXT CHECK (repeat_unit IN ('week', 'month', 'year')),
    next_id      INTEGER,            -- upkeep: the copy made when this one was done
    created_at   INTEGER NOT NULL,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at   INTEGER NOT NULL,
    done_at      INTEGER,
    done_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deleted_at   INTEGER             -- in the bin: Undo brings it back, and it's emptied after a month
  );
  CREATE INDEX jobs_status ON jobs(status, deleted_at);

  CREATE TABLE steps (
    id         INTEGER PRIMARY KEY,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    due_date   TEXT,
    done_at    INTEGER,
    done_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX steps_job ON steps(job_id);

  -- A job's cost lines: things to buy (bought_at) and bills from trades (paid by payments).
  CREATE TABLE costs (
    id         INTEGER PRIMARY KEY,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    amount     INTEGER NOT NULL DEFAULT 0,   -- pence
    kind       TEXT NOT NULL DEFAULT 'item' CHECK (kind IN ('item', 'trade')),
    trade_id   INTEGER REFERENCES trades(id) ON DELETE SET NULL,
    bought_at  INTEGER,
    shop       TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX costs_job ON costs(job_id);

  CREATE TABLE payments (
    id         INTEGER PRIMARY KEY,
    cost_id    INTEGER NOT NULL REFERENCES costs(id) ON DELETE CASCADE,
    amount     INTEGER NOT NULL,
    paid_on    TEXT NOT NULL,
    note       TEXT,
    created_at INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX payments_cost ON payments(cost_id);

  -- Pictures of a job, of a room, or of a receipt (cost_id). The files are in data/photos.
  CREATE TABLE photos (
    id         INTEGER PRIMARY KEY,
    job_id     INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    room_id    INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
    cost_id    INTEGER REFERENCES costs(id) ON DELETE SET NULL,
    caption    TEXT,
    w          INTEGER NOT NULL DEFAULT 0,
    h          INTEGER NOT NULL DEFAULT 0,
    has_thumb  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX photos_job ON photos(job_id);

  CREATE TABLE notes (
    id         INTEGER PRIMARY KEY,
    body       TEXT NOT NULL,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  -- What we've put in the shared Google calendar, so a change only sends what changed.
  CREATE TABLE calendar_events (
    ref        TEXT PRIMARY KEY,     -- job:12 or step:40
    event_id   TEXT NOT NULL,
    hash       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE push_subs (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL UNIQUE,
    p256dh       TEXT NOT NULL,
    auth         TEXT NOT NULL,
    label        TEXT,
    user_agent   TEXT,
    created_at   INTEGER NOT NULL,
    seen_at      INTEGER NOT NULL,   -- last time the app re-sent it (every open)
    last_ok_at   INTEGER,
    last_error   TEXT,
    failures     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX push_user ON push_subs(user_id);

  -- Every push sent (reminders, heads-ups, tests).
  CREATE TABLE notifications (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL,         -- reminder, done, assigned, test
    job_ids   TEXT NOT NULL DEFAULT '[]',
    title     TEXT NOT NULL,
    body      TEXT NOT NULL,
    url       TEXT NOT NULL,
    sent_at   INTEGER NOT NULL,
    devices   INTEGER NOT NULL DEFAULT 0,
    delivered INTEGER NOT NULL DEFAULT 0,
    error     TEXT,
    opened_at INTEGER
  );
  CREATE INDEX notifications_user ON notifications(user_id, sent_at);

  -- Each key (a day's reminders, a job being finished) is handled once, however often the
  -- scheduler runs. notification_id is NULL when it was passed over.
  CREATE TABLE nudge_keys (
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    notification_id INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
    at              INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- The rooms of the house, as given. They can be renamed, added to and retired in the app.
  INSERT INTO rooms (name, tint, sort, created_at) VALUES
    ('Kitchen', 0, 0, unixepoch() * 1000),
    ('Cwtch', 1, 1, unixepoch() * 1000),
    ('The Den', 2, 2, unixepoch() * 1000),
    ('Downstairs bathroom', 3, 3, unixepoch() * 1000),
    ('Office', 4, 4, unixepoch() * 1000),
    ('Hallway and Landing', 5, 5, unixepoch() * 1000),
    ('Utility Room', 0, 6, unixepoch() * 1000),
    ('Our bedroom', 1, 7, unixepoch() * 1000),
    ('Olly''s Room', 2, 8, unixepoch() * 1000),
    ('Carys''s Room', 3, 9, unixepoch() * 1000),
    ('Spare Room', 4, 10, unixepoch() * 1000),
    ('Box Room', 5, 11, unixepoch() * 1000),
    ('Upstairs Bathroom', 0, 12, unixepoch() * 1000);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL lets the admin CLI write while the server is running.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (current > MIGRATIONS.length) {
    throw new Error(`Database is schema v${current}, but this build only knows v${MIGRATIONS.length}`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Run `fn` in a transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(db: Db, key: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

export function putSetting(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
