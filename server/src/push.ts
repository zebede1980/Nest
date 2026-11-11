// Web push: the server's VAPID keys, people's subscribed devices, and sending.
//
// Payloads use Declarative Web Push (iOS/iPadOS 18.4+): the phone shows the notification
// itself, even if the app's service worker never runs, and sets the badge. Older iOS,
// desktop Chrome and Firefox hand the same JSON to the service worker (sw.js), which
// shows it. Every push is visible: iOS can withdraw permission from silent ones.

import * as webpush from 'web-push';
import type { Db } from './db.js';
import { getSetting, putSetting } from './db.js';
import type { PushMessage } from '../../shared/model.js';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** From the environment if set, otherwise made once and kept in the database. */
export function vapidKeys(db: Db): VapidKeys {
  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv };
  const stored = getSetting(db, 'vapid');
  if (stored) return JSON.parse(stored) as VapidKeys;
  const keys = webpush.generateVAPIDKeys();
  putSetting(db, 'vapid', JSON.stringify(keys));
  return keys;
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendResult {
  status: number;
  /** The push service says this subscription is dead (404/410): forget it. */
  gone: boolean;
  error?: string;
}

/** Sends one encrypted payload; swapped for a fake in tests. */
export type PushSender = (sub: Subscription, payload: string, opts: { ttl: number; urgency: 'normal' | 'high'; topic?: string }) => Promise<SendResult>;

export function webPushSender(keys: VapidKeys, subject: string): PushSender {
  return async (sub, payload, opts) => {
    try {
      const r = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
        TTL: opts.ttl,
        urgency: opts.urgency,
        topic: opts.topic,
        timeout: 15_000,
      });
      return { status: r.statusCode, gone: false };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 0;
      const text = (err as { body?: string }).body || (err as Error).message;
      return { status, gone: status === 404 || status === 410, error: `${status || 'network'}: ${String(text).slice(0, 200)}` };
    }
  };
}

/** The JSON a push carries: declarative fields for the phone, read by sw.js elsewhere. */
export function payloadFor(msg: PushMessage, appUrl: string): string {
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: msg.title,
      body: msg.body,
      navigate: appUrl + msg.url,
      lang: 'en-GB',
      tag: msg.tag,
      app_badge: msg.badge,
    },
  });
}

/** Push topics collapse undelivered pushes with the same name: up to 32 URL-safe characters. */
export const topicFor = (tag: string) => tag.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);

export interface Device {
  id: number;
  label: string | null;
  userAgent: string | null;
  createdAt: number;
  seenAt: number;
  lastOkAt: number | null;
  lastError: string | null;
  failures: number;
}

export class Devices {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  /** Saves (or refreshes) a subscription. The app re-sends it every time it opens, since
   *  iOS doesn't reliably say when a subscription changes. An endpoint moves to whoever
   *  sends it last: one phone, one person. */
  save(userId: number, sub: Subscription, userAgent: string | null, label: string | null): number {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO push_subs (user_id, endpoint, p256dh, auth, label, user_agent, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
           user_agent = excluded.user_agent, label = COALESCE(excluded.label, push_subs.label), seen_at = excluded.seen_at`,
      )
      .run(userId, sub.endpoint, sub.p256dh, sub.auth, label, userAgent?.slice(0, 200) ?? null, now, now);
    return (this.db.prepare('SELECT id FROM push_subs WHERE endpoint = ?').get(sub.endpoint) as { id: number }).id;
  }

  forUser(userId: number): (Device & Subscription)[] {
    const rows = this.db.prepare('SELECT * FROM push_subs WHERE user_id = ? ORDER BY id').all(userId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      endpoint: r.endpoint as string,
      p256dh: r.p256dh as string,
      auth: r.auth as string,
      label: r.label as string | null,
      userAgent: r.user_agent as string | null,
      createdAt: r.created_at as number,
      seenAt: r.seen_at as number,
      lastOkAt: r.last_ok_at as number | null,
      lastError: r.last_error as string | null,
      failures: r.failures as number,
    }));
  }

  remove(userId: number, id: number): boolean {
    return this.db.prepare('DELETE FROM push_subs WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  }

  removeEndpoint(userId: number, endpoint: string): boolean {
    return this.db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(endpoint, userId).changes > 0;
  }

  rename(userId: number, id: number, label: string | null): boolean {
    return this.db.prepare('UPDATE push_subs SET label = ? WHERE id = ? AND user_id = ?').run(label, id, userId).changes > 0;
  }

  markOk(id: number): void {
    this.db.prepare('UPDATE push_subs SET last_ok_at = ?, last_error = NULL, failures = 0 WHERE id = ?').run(this.now(), id);
  }

  /** A failure is noted; a dead subscription, or 20 failures in a row, is dropped. */
  markFailed(id: number, error: string, gone: boolean): void {
    if (gone) {
      this.db.prepare('DELETE FROM push_subs WHERE id = ?').run(id);
      return;
    }
    this.db.prepare('UPDATE push_subs SET last_error = ?, failures = failures + 1 WHERE id = ?').run(error, id);
    this.db.prepare('DELETE FROM push_subs WHERE id = ? AND failures >= 20').run(id);
  }
}
