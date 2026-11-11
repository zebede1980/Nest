import type { FastifyInstance } from 'fastify';
import { APP_NAME, APP_URL } from '../config.js';
import { LINK_MS } from '../accounts.js';
import { BadInput, body, bool, has, hm, idParam, oneOf, requireAdmin, requireUser, SESSION_COOKIE, setSessionCookie, text, type Ctx } from '../http.js';
import { isValidTz } from '../../../shared/dates.js';
import { REMIND_CHOICES } from '../../../shared/model.js';

export function authRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/me', async (req) => ({ ok: true, appName: APP_NAME, user: req.user }));

  app.post('/api/login', async (req, reply) => {
    const b = body(req);
    const username = text(b, 'username', { max: 40 });
    const password = text(b, 'password', { max: 200 });
    const wait = ctx.accounts.lockedFor(req.ip, username);
    if (wait > 0) return reply.code(429).send({ ok: false, error: 'locked', waitSeconds: wait });
    const user = await ctx.accounts.checkPassword(username, password);
    ctx.accounts.recordAttempt(req.ip, username, !!user);
    // 403, not 401: a 401 means "signed out" to the app.
    if (!user) return reply.code(403).send({ ok: false, error: 'wrong' });
    setSessionCookie(req, reply, ctx.accounts.startSession(user.id, req.headers['user-agent']));
    return { ok: true, user };
  });

  // A device code, made on a device that's already signed in. The installed iPhone app
  // keeps its own cookies apart from Safari, so this is how it signs in without a password.
  app.post('/api/login/code', async (req, reply) => {
    const code = text(body(req), 'code', { max: 20 });
    const wait = ctx.accounts.lockedFor(req.ip, '#code');
    if (wait > 0) return reply.code(429).send({ ok: false, error: 'locked', waitSeconds: wait });
    const user = ctx.accounts.useCode(code);
    ctx.accounts.recordAttempt(req.ip, '#code', !!user);
    if (!user) return reply.code(403).send({ ok: false, error: 'bad_code' });
    setSessionCookie(req, reply, ctx.accounts.startSession(user.id, req.headers['user-agent']));
    return { ok: true, user };
  });

  app.post('/api/me/code', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { ok: true, ...ctx.accounts.createCode(user.id) };
  });

  app.post('/api/logout', async (req, reply) => {
    if (req.sessionToken) ctx.accounts.endSession(req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/me/password', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const password = text(body(req), 'password', { max: 200 });
    if (password.length < 6) throw new BadInput('Passwords need at least 6 characters');
    await ctx.accounts.setPassword(me.id, password);
    if (req.sessionToken) ctx.accounts.endOtherSessions(me.id, req.sessionToken);
    return { ok: true };
  });

  app.put('/api/me/settings', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const b = body(req);
    const s = { ...me.settings };
    if (b.tz !== undefined) {
      if (!isValidTz(b.tz)) throw new BadInput('Unknown time zone');
      s.tz = b.tz;
    }
    s.remindAt = hm(b, 'remindAt') ?? s.remindAt;
    if (has(b, 'remind')) s.remind = oneOf(b, 'remind', REMIND_CHOICES);
    s.headsUp = bool(b, 'headsUp') ?? s.headsUp;
    if (b.displayName !== undefined) ctx.accounts.update(me.id, { displayName: text(b, 'displayName', { max: 40 }) });
    ctx.accounts.saveSettings(me.id, s);
    return { ok: true, user: ctx.accounts.findById(me.id) };
  });

  // ── People (admin) ───────────────────────────────────────────────────────
  app.get('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { ok: true, users: ctx.accounts.list() };
  });

  app.post('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = body(req);
    const username = text(b, 'username', { max: 32 }).toLowerCase();
    const displayName = text(b, 'displayName', { max: 40, optional: true }) ?? username;
    if (ctx.accounts.findByName(username)) return reply.code(409).send({ ok: false, error: 'name_taken' });
    let user;
    try {
      user = ctx.accounts.create(username, displayName, 'member');
    } catch (err) {
      throw new BadInput((err as Error).message);
    }
    return { ok: true, user, url: `${APP_URL}/l/${ctx.accounts.createLink(user.id)}`, expiresAt: ctx.now() + LINK_MS };
  });

  app.post('/api/users/:id/link', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = idParam(req);
    if (!ctx.accounts.findById(id)) return reply.code(404).send({ ok: false, error: 'not_found' });
    return { ok: true, url: `${APP_URL}/l/${ctx.accounts.createLink(id)}`, expiresAt: ctx.now() + LINK_MS };
  });

  app.post('/api/users/:id/disable', async (req, reply) => {
    const me = requireAdmin(req, reply);
    if (!me) return;
    const id = idParam(req);
    if (id === me.id) return reply.code(400).send({ ok: false, error: 'not_yourself' });
    ctx.accounts.disable(id);
    ctx.accounts.endAllSessions(id);
    return { ok: true };
  });

  app.post('/api/users/:id/restore', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    ctx.accounts.restore(idParam(req));
    return { ok: true };
  });

  // One-time sign-in links: tap it and you're in.
  app.get('/l/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const user = /^[A-Za-z0-9_-]{20,100}$/.test(token) ? ctx.accounts.useLink(token) : null;
    if (!user) {
      return reply
        .code(410)
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(
          `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${APP_NAME}</title>
           <body style="font:18px/1.5 system-ui,sans-serif;max-width:32em;margin:3em auto;padding:0 16px;color:#2B2622;background:#F5EFE6">
           <h1>${APP_NAME}</h1><p>This sign-in link has already been used or is out of date.</p>
           <p>Ask for a new one, or <a style="color:#9A4424" href="/">sign in with your password</a>.</p></body>`,
        );
    }
    setSessionCookie(req, reply, ctx.accounts.startSession(user.id, req.headers['user-agent']));
    return reply.header('Cache-Control', 'no-store').redirect('/welcome');
  });
}
