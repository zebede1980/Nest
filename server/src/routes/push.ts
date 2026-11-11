import type { FastifyInstance } from 'fastify';
import { BadInput, body, idParam, requireUser, text, type Ctx } from '../http.js';
import { markOpened, notify, recentNotifications } from '../notify.js';
import { reminderWords } from '../../../shared/reminders.js';
import { plan } from '../scheduler.js';

const TEST_LINES = [
  'If you can read this, reminders will reach you. 🎉',
  'Testing, testing… loud and clear.',
  'Reminders are working. The shelves won’t put themselves up, mind.',
];

export function pushRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/push/key', async () => ({ ok: true, publicKey: ctx.vapidPublicKey }));

  // The app sends its subscription every time it opens: iOS doesn't reliably tell
  // the page when a subscription changes, so this keeps the server's copy fresh.
  app.post('/api/push/subscribe', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const b = body(req);
    const sub = b.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (typeof endpoint !== 'string' || !/^https:\/\/[^\s]{10,1000}$/.test(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string') {
      throw new BadInput('That isn’t a push subscription');
    }
    const id = ctx.devices.save(user.id, { endpoint, p256dh, auth }, req.headers['user-agent'] ?? null, text(b, 'label', { max: 40, optional: true }));
    return { ok: true, id };
  });

  app.post('/api/push/unsubscribe', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const endpoint = text(body(req), 'endpoint', { max: 1100 });
    ctx.devices.removeEndpoint(user.id, endpoint);
    return { ok: true };
  });

  app.get('/api/push/devices', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    // Endpoints and keys stay on the server.
    const devices = ctx.devices.forUser(user.id).map(({ endpoint, p256dh: _p, auth: _a, ...d }) => ({ ...d, host: new URL(endpoint).host }));
    return { ok: true, devices };
  });

  app.delete('/api/push/devices/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    ctx.devices.remove(user.id, idParam(req));
    return { ok: true };
  });

  app.put('/api/push/devices/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    ctx.devices.rename(user.id, idParam(req), text(body(req), 'label', { max: 40, optional: true }));
    return { ok: true };
  });

  app.post('/api/push/test', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const now = ctx.now();
    const sent = await notify(
      ctx.notifyDeps,
      user.id,
      {
        title: '🔔 Test reminder',
        body: TEST_LINES[Math.floor(now / 1000) % TEST_LINES.length],
        url: '/settings',
        tag: `test-${now}`,
        badge: plan(ctx, user).badge,
      },
      { kind: 'test', jobIds: [], keys: [`test:${now}`], ttl: 600, urgency: 'high' },
    );
    return { ok: true, sent };
  });

  app.get('/api/notifications', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const p = plan(ctx, user);
    return {
      ok: true,
      sent: recentNotifications(ctx.db, user.id, 40),
      // What today's reminder says (or would say), for the settings page.
      today: p.reminders.length ? reminderWords(p.reminders, ctx.house.rooms(), p.today) : null,
    };
  });

  app.post('/api/notifications/:id/opened', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    markOpened(ctx.db, user.id, idParam(req), ctx.now());
    return { ok: true };
  });
}
