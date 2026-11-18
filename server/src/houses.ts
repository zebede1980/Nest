// The houses Nest looks after. Each person belongs to one; a global admin can look in on any.

import type { Db } from './db.js';
import { tx } from './db.js';
import { NotFound } from './house.js';

export interface HouseSummary {
  id: number;
  name: string;
  people: { id: number; displayName: string; role: 'admin' | 'member'; disabled: boolean }[];
  jobs: number;
}

export class Houses {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  ids(): number[] {
    return (this.db.prepare('SELECT id FROM houses ORDER BY id').all() as { id: number }[]).map((r) => r.id);
  }

  exists(id: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM houses WHERE id = ?').get(id);
  }

  /** By id, or by name (any case). */
  find(idOrName: string | number): { id: number; name: string } | null {
    const r = (
      typeof idOrName === 'number' || /^\d+$/.test(idOrName)
        ? this.db.prepare('SELECT id, name FROM houses WHERE id = ?').get(Number(idOrName))
        : this.db.prepare('SELECT id, name FROM houses WHERE name = ? COLLATE NOCASE').get(idOrName.trim())
    ) as { id: number; name: string } | undefined;
    return r ?? null;
  }

  list(): HouseSummary[] {
    const people = this.db.prepare('SELECT id, display_name, role, disabled_at FROM users WHERE house_id = ? ORDER BY id');
    const jobs = this.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE house_id = ? AND deleted_at IS NULL');
    return (this.db.prepare('SELECT id, name FROM houses ORDER BY id').all() as { id: number; name: string }[]).map((h) => ({
      id: h.id,
      name: h.name,
      people: (people.all(h.id) as { id: number; display_name: string; role: 'admin' | 'member'; disabled_at: number | null }[]).map((p) => ({
        id: p.id,
        displayName: p.display_name,
        role: p.role,
        disabled: p.disabled_at !== null,
      })),
      jobs: (jobs.get(h.id) as { n: number }).n,
    }));
  }

  /** A new house with its rooms, in the order given. */
  create(name: string, rooms: string[]): number {
    const clean = name.trim();
    if (!clean) throw new Error('The house needs a name');
    if (this.find(clean)) throw new Error(`There is already a house called ${clean}`);
    return tx(this.db, () => {
      const now = this.now();
      const id = Number(this.db.prepare('INSERT INTO houses (name, created_at) VALUES (?, ?)').run(clean, now).lastInsertRowid);
      const add = this.db.prepare('INSERT INTO rooms (house_id, name, tint, sort, created_at) VALUES (?, ?, ?, ?, ?)');
      rooms
        .map((r) => r.trim())
        .filter(Boolean)
        .forEach((room, i) => add.run(id, room.slice(0, 60), i % 6, i, now));
      return id;
    });
  }

  rename(id: number, name: string): void {
    const clean = name.trim();
    if (!clean) throw new Error('The house needs a name');
    const other = this.find(clean);
    if (other && other.id !== id) throw new Error(`There is already a house called ${clean}`);
    if (!this.db.prepare('UPDATE houses SET name = ? WHERE id = ?').run(clean, id).changes) throw new NotFound('That house has gone');
  }
}
