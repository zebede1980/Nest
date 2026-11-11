import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { Accounts } from './accounts.js';
import { openDb, type Db } from './db.js';
import { BadInput, CSRF_HEADER, SESSION_COOKIE, setSessionCookie, type Ctx } from './http.js';
import { Calendar, type Fetch } from './gcal.js';
import { House, NotFound } from './house.js';
import { Devices, vapidKeys, webPushSender, type PushSender } from './push.js';
import { authRoutes } from './routes/auth.js';
import { houseRoutes } from './routes/house.js';
import { photoRoutes, removePhotoFiles } from './routes/photos.js';
import { pushRoutes } from './routes/push.js';
import { startScheduler } from './scheduler.js';

export interface AppOptions {
  /** Directory holding the built client (index.html, assets/, sw.js). */
  clientDir: string;
  /** SQLite file, or ':memory:' for tests. */
  dbPath: string;
  /** Where photos are kept. */
  photoDir: string;
  version: string;
  appUrl: string;
  vapidSubject: string;
  logger?: boolean;
  now?: () => number;
  /** Swapped for a fake in tests. */
  sender?: PushSender;
  /** How Google is reached; swapped for a fake in tests. */
  fetch?: Fetch;
  /** Run the nudger on its own (off in tests). */
  scheduler?: boolean;
}

export interface App {
  app: FastifyInstance;
  db: Db;
  ctx: Ctx;
}

export async function buildApp(opts: AppOptions): Promise<App> {
  if (!existsSync(path.join(opts.clientDir, 'index.html'))) {
    throw new Error(`No built client at ${opts.clientDir} — run "npm run build" first`);
  }

  const now = opts.now ?? Date.now;
  const db = openDb(opts.dbPath);
  const app = Fastify({
    logger: opts.logger ?? false,
    // nginx proxy manager reaches us over the Docker network; only trust
    // X-Forwarded-* from there, so a direct caller can't fake its IP.
    trustProxy: ['loopback', 'uniquelocal'],
    bodyLimit: 256 * 1024,
  });
  const keys = vapidKeys(db);
  const devices = new Devices(db, now);
  const log = (msg: string) => app.log.info(msg);
  const house = new House(db, now);
  const ctx: Ctx = {
    db,
    accounts: new Accounts(db, now),
    house,
    calendar: new Calendar(db, house, now, opts.fetch ?? ((url, init) => fetch(url, init)), opts.appUrl, log),
    photoDir: opts.photoDir,
    devices,
    vapidPublicKey: keys.publicKey,
    notifyDeps: { db, now, devices, sender: opts.sender ?? webPushSender(keys, opts.vapidSubject), appUrl: opts.appUrl },
    now,
    log,
  };
  app.addHook('onClose', async () => {
    ctx.calendar.stop();
    db.close();
  });

  await app.register(fastifyCookie);
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    const changes = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (changes && url.startsWith('/api/') && req.headers[CSRF_HEADER] !== '1') {
      return reply.code(403).send({ ok: false, error: 'csrf' });
    }
    const token = req.cookies[SESSION_COOKIE];
    const found = ctx.accounts.lookupSession(token);
    if (found && token) {
      req.user = found.user;
      req.sessionToken = token;
      // Re-send the cookie now and then, so the browser's year keeps sliding too.
      if (found.renewed) setSessionCookie(req, reply, token);
    }
  });

  // Anything that changes the house may change what belongs in the shared calendar.
  app.addHook('onResponse', async (req, reply) => {
    if (req.method !== 'GET' && reply.statusCode < 400 && req.url.startsWith('/api/') && !req.url.startsWith('/api/calendar')) ctx.calendar.poke();
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof BadInput) return reply.code(400).send({ ok: false, error: 'bad_input', message: err.message });
    if (err instanceof NotFound) return reply.code(404).send({ ok: false, error: 'not_found', message: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ ok: false, error: 'bad_request', message: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ ok: false, error: 'server_error' });
  });

  app.get('/api/health', async () => ({ ok: true, name: 'nest', version: opts.version, time: new Date(now()).toISOString() }));

  authRoutes(app, ctx);
  houseRoutes(app, ctx);
  photoRoutes(app, ctx);
  pushRoutes(app, ctx);

  // Unknown /api routes are JSON 404s, never the app page.
  app.all('/api/*', async (_req, reply) => reply.code(404).send({ ok: false, error: 'not_found' }));

  await app.register(fastifyStatic, {
    root: opts.clientDir,
    // Vite fingerprints asset filenames, so they can be cached for good; pages and the
    // service worker must always be re-fetched so a deploy is picked up.
    setHeaders: (res, filePath) => {
      res.header('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  // The app is one page: any other path gets it.
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET') return reply.code(404).send({ ok: false, error: 'not_found' });
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  const prune = () => {
    ctx.accounts.prune();
    // Jobs deleted a month ago go for good, and their photos with them.
    removePhotoFiles(ctx.photoDir, ctx.house.emptyBin());
  };
  prune();
  const timer = setInterval(prune, 60 * 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  if (opts.scheduler) {
    const stop = startScheduler(ctx);
    app.addHook('onClose', async () => stop());
  }

  return { app, db, ctx };
}
