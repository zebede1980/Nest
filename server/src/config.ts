import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The compiled server sits deeper (dist-server/server/src) than the source (server/src),
// so find the project root by walking up to package.json.
function findRoot(from: string): string {
  let dir = from;
  while (!existsSync(path.join(dir, 'package.json'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('package.json not found above ' + from);
    dir = up;
  }
  return dir;
}

export const ROOT = findRoot(path.dirname(fileURLToPath(import.meta.url)));

export const VERSION = (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

export const APP_NAME = process.env.APP_NAME ?? 'Nest';
export const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
export const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'nest.db');
export const PHOTO_DIR = process.env.PHOTO_DIR ?? path.join(DATA_DIR, 'photos');
export const CLIENT_DIR = process.env.CLIENT_DIR ?? path.join(ROOT, 'dist');

/** The address people use: sign-in links, and the "contact" in push requests. */
export const APP_URL = (process.env.APP_URL ?? 'http://localhost:3070').replace(/\/+$/, '');

/** Apple's push service wants a mailto: or https: contact in every request. */
export const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? (APP_URL.startsWith('https://') ? APP_URL : 'mailto:admin@example.com');
