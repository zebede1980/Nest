// Sending a push to everyone of a person's devices, and keeping the record of it.

import type { Db } from './db.js';
import { tx } from './db.js';
import { Devices, payloadFor, topicFor, type PushSender } from './push.js';
import type { PushMessage } from '../../shared/model.js';

export type NotificationKind = 'reminder' | 'done' | 'assigned' | 'test';

export interface SentNotification {
  id: number;
  kind: NotificationKind;
  jobIds: number[];
  title: string;
  body: string;
  url: string;
  sentAt: number;
  devices: number;
  delivered: number;
  error: string | null;
  openedAt: number | null;
}

export interface NotifyDeps {
  db: Db;
  now: () => number;
  devices: Devices;
  sender: PushSender;
  appUrl: string;
}

/**
 * Claims the nudge keys, then sends. Returns null if any key was already handled, so
 * the same nudge never goes twice, even with two schedulers or a retry.
 */
export async function notify(
  deps: NotifyDeps,
  userId: number,
  msg: Omit<PushMessage, 'url'> & { url: string },
  record: { kind: NotificationKind; jobIds: number[]; keys: string[]; ttl?: number; urgency?: 'normal' | 'high' },
): Promise<SentNotification | null> {
  const { db } = deps;
  const now = deps.now();
  const id = tx(db, () => {
    const taken = db.prepare('SELECT 1 FROM nudge_keys WHERE user_id = ? AND key = ?');
    if (record.keys.some((k) => taken.get(userId, k))) return null;
    const r = db
      .prepare('INSERT INTO notifications (user_id, kind, job_ids, title, body, url, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, record.kind, JSON.stringify(record.jobIds), msg.title, msg.body, msg.url, now);
    const nid = Number(r.lastInsertRowid);
    const claim = db.prepare('INSERT INTO nudge_keys (user_id, key, notification_id, at) VALUES (?, ?, ?, ?)');
    for (const k of record.keys) claim.run(userId, k, nid, now);
    return nid;
  });
  if (id === null) return null;

  // The app opens on the push's own page and reports back that it was tapped.
  const url = msg.url + (msg.url.includes('?') ? '&' : '?') + `n=${id}`;
  db.prepare('UPDATE notifications SET url = ? WHERE id = ?').run(url, id);
  const payload = payloadFor({ ...msg, url }, deps.appUrl);
  const subs = deps.devices.forUser(userId);
  let delivered = 0;
  const errors: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      const r = await deps.sender(sub, payload, { ttl: record.ttl ?? 12 * 3600, urgency: record.urgency ?? 'normal', topic: topicFor(msg.tag) });
      if (r.status >= 200 && r.status < 300) {
        delivered++;
        deps.devices.markOk(sub.id);
      } else {
        errors.push(r.error ?? String(r.status));
        deps.devices.markFailed(sub.id, r.error ?? String(r.status), r.gone);
      }
    }),
  );
  const error = subs.length === 0 ? 'no devices' : errors.length ? errors.join('; ').slice(0, 500) : null;
  db.prepare('UPDATE notifications SET devices = ?, delivered = ?, error = ? WHERE id = ?').run(subs.length, delivered, error, id);
  return getNotification(db, userId, id);
}

/** Marks keys as handled without sending anything. */
export function passOver(db: Db, userId: number, keys: string[], now: number): void {
  const claim = db.prepare('INSERT OR IGNORE INTO nudge_keys (user_id, key, notification_id, at) VALUES (?, ?, NULL, ?)');
  for (const k of keys) claim.run(userId, k, now);
}

export function keyHandled(db: Db, userId: number, key: string): boolean {
  return !!db.prepare('SELECT 1 FROM nudge_keys WHERE user_id = ? AND key = ?').get(userId, key);
}

const toSent = (r: Record<string, unknown>): SentNotification => ({
  id: r.id as number,
  kind: r.kind as NotificationKind,
  jobIds: JSON.parse(r.job_ids as string) as number[],
  title: r.title as string,
  body: r.body as string,
  url: r.url as string,
  sentAt: r.sent_at as number,
  devices: r.devices as number,
  delivered: r.delivered as number,
  error: r.error as string | null,
  openedAt: r.opened_at as number | null,
});

export function getNotification(db: Db, userId: number, id: number): SentNotification | null {
  const r = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
  return r ? toSent(r) : null;
}

export function recentNotifications(db: Db, userId: number, limit = 30): SentNotification[] {
  return (db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY sent_at DESC, id DESC LIMIT ?').all(userId, limit) as Record<string, unknown>[]).map(toSent);
}

export function markOpened(db: Db, userId: number, id: number, now: number): void {
  db.prepare('UPDATE notifications SET opened_at = COALESCE(opened_at, ?) WHERE id = ? AND user_id = ?').run(now, id, userId);
}
