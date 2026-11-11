import { buildApp } from './app.js';
import { APP_URL, CLIENT_DIR, DB_PATH, PHOTO_DIR, VAPID_SUBJECT, VERSION } from './config.js';

const { app, ctx } = await buildApp({
  clientDir: CLIENT_DIR,
  dbPath: DB_PATH,
  photoDir: PHOTO_DIR,
  version: VERSION,
  appUrl: APP_URL,
  vapidSubject: VAPID_SUBJECT,
  logger: true,
  scheduler: true,
});

if (ctx.accounts.count() === 0) {
  app.log.warn('No accounts yet. Create the first one with: docker exec -it nest nest add-user <name> --admin');
}
app.log.info(`Links and notifications point at ${APP_URL}; push contact ${VAPID_SUBJECT}`);

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(() => process.exit(0));
  });
}
