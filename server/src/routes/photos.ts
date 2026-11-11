// Photos: of a job, of a room, or of a receipt. The app shrinks each one before sending
// (a phone photo is 3–5 MB; 1600 px across is plenty), then sends a small thumbnail too.

import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BadInput, body, idParam, requireUser, text, type Ctx } from '../http.js';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const isJpeg = (b: unknown): b is Buffer => Buffer.isBuffer(b) && b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export const photoFile = (dir: string, id: number, thumb = false) => path.join(dir, `${id}${thumb ? '.t' : ''}.jpg`);

export function removePhotoFiles(dir: string, ids: number[]): void {
  for (const id of ids) for (const thumb of [false, true]) rmSync(photoFile(dir, id, thumb), { force: true });
}

function queryInt(req: FastifyRequest, key: string): number | null {
  const v = (req.query as Record<string, string | undefined>)[key];
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1e9) throw new BadInput(`bad ${key}`);
  return n;
}

export function photoRoutes(app: FastifyInstance, ctx: Ctx): void {
  mkdirSync(ctx.photoDir, { recursive: true });
  // Photos arrive as the raw JPEG, not wrapped in JSON.
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES }, (_req, payload, done) => done(null, payload));

  app.post('/api/photos', { bodyLimit: MAX_PHOTO_BYTES }, async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!isJpeg(req.body)) throw new BadInput("That photo didn't arrive in one piece. Try again.");
    const caption = (req.query as { caption?: string }).caption?.trim().slice(0, 80) || null;
    const id = ctx.house.addPhoto(user.id, { jobId: queryInt(req, 'job'), roomId: queryInt(req, 'room'), costId: queryInt(req, 'cost'), caption, w: queryInt(req, 'w') ?? 0, h: queryInt(req, 'h') ?? 0 });
    try {
      writeFileSync(photoFile(ctx.photoDir, id), req.body);
    } catch (err) {
      ctx.house.deletePhoto(id);
      throw err;
    }
    return { ok: true, id };
  });

  app.put('/api/photos/:id/thumb', { bodyLimit: 512 * 1024 }, async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const id = idParam(req);
    ctx.house.photo(id);
    if (!isJpeg(req.body)) throw new BadInput('bad thumbnail');
    writeFileSync(photoFile(ctx.photoDir, id, true), req.body);
    ctx.house.markThumb(id);
    return { ok: true };
  });

  app.put('/api/photos/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    ctx.house.captionPhoto(idParam(req), text(body(req), 'caption', { max: 80, optional: true }));
    return { ok: true };
  });

  app.delete('/api/photos/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const id = idParam(req);
    ctx.house.deletePhoto(id);
    removePhotoFiles(ctx.photoDir, [id]);
    return { ok: true };
  });

  // A photo never changes once saved, so the phone can keep it.
  const send = (thumb: boolean) => async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!requireUser(req, reply)) return;
    const id = idParam(req);
    const p = ctx.house.photo(id);
    const file = photoFile(ctx.photoDir, id, thumb && p.hasThumb);
    if (!existsSync(file)) return reply.code(404).send({ ok: false, error: 'not_found' });
    return reply.type('image/jpeg').header('Cache-Control', 'private, max-age=31536000, immutable').send(createReadStream(file));
  };
  app.get('/api/photos/:id', send(false));
  app.get('/api/photos/:id/thumb', send(true));
}
