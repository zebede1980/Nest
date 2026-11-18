// Houses: a global admin sees them all, adds new ones and chooses which one to look at.
// A house's own admin can rename it. Everyone else only ever sees their own house.

import type { FastifyInstance } from 'fastify';
import { NotFound } from '../house.js';
import { BadInput, body, idParam, number, requireAdmin, requireGlobalAdmin, text, type Ctx } from '../http.js';

export function houseAdminRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/houses', async (req, reply) => {
    if (!requireGlobalAdmin(req, reply)) return;
    return { ok: true, houses: ctx.houses.list() };
  });

  // A new house, with its rooms (one per line, in order).
  app.post('/api/houses', async (req, reply) => {
    if (!requireGlobalAdmin(req, reply)) return;
    const b = body(req);
    const name = text(b, 'name', { max: 80 });
    const rooms = (text(b, 'rooms', { max: 4000, optional: true }) ?? '').split(/\n/).slice(0, 60);
    try {
      return { ok: true, id: ctx.houses.create(name, rooms) };
    } catch (err) {
      throw new BadInput((err as Error).message);
    }
  });

  // Look at another house (or, with null, go back to your own). Only this session changes.
  app.post('/api/houses/view', async (req, reply) => {
    const me = requireGlobalAdmin(req, reply);
    if (!me) return;
    const id = number(body(req), 'houseId', { int: true, min: 1, optional: true });
    if (id !== null && !ctx.houses.exists(id)) return reply.code(404).send({ ok: false, error: 'not_found' });
    ctx.accounts.viewHouse(req.sessionToken!, id === me.houseId ? null : id);
    return { ok: true };
  });

  // Renaming: a global admin can rename any house; a house's admin only their own.
  app.put('/api/houses/:id', async (req, reply) => {
    const me = requireAdmin(req, reply);
    if (!me) return;
    const id = idParam(req);
    if (!me.globalAdmin && id !== me.houseId) return reply.code(404).send({ ok: false, error: 'not_found' });
    try {
      ctx.houses.rename(id, text(body(req), 'name', { max: 80 }));
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw new BadInput((err as Error).message);
    }
    return { ok: true };
  });
}
