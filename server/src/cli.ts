// nest: admin from inside the container.
//
//   docker exec -it nest nest add-user joe --admin --display "Joe"
//   docker exec -it nest nest login-link joe
//
// Passwords are asked for with hidden typing, or read from stdin when piped
// (echo 'secret' | nest set-password joe), so they never land in shell history.
import { createInterface } from 'node:readline';
import { Accounts } from './accounts.js';
import { APP_URL, DB_PATH, VAPID_SUBJECT } from './config.js';
import { openDb } from './db.js';
import { Devices, vapidKeys, webPushSender } from './push.js';
import { recentNotifications } from './notify.js';
import { nudgeUser, plan } from './scheduler.js';
import type { Ctx } from './http.js';
import { House } from './house.js';
import { reminderWords } from '../../shared/reminders.js';

const HELP = `nest: Nest admin

  nest list-users
  nest add-user <name> [--display "Shown Name"] [--admin]   then asks for a password
  nest set-password <name>            (signs them out everywhere)
  nest login-link <name>              a one-time sign-in link, good for 7 days
  nest code <name>                    a 15-minute code for the app's "I have a code"
  nest set-display <name> "Shown Name"
  nest set-role <name> admin|member
  nest delete-user <name>             for good, with their sign-ins (the house's jobs stay)

  nest devices <name>                 their phones and browsers that get reminders
  nest nudges <name> [--send]         what they'd be reminded of right now
                                             (--send sends it, as the scheduler would)
  nest sent <name>                    the last pushes they were sent

Database: ${DB_PATH}`;

class UserError extends Error {}

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (a === '--display' && next !== undefined) {
        flags.set(a, next);
        i++;
      } else flags.set(a, true);
    } else positional.push(a);
  }
  return { positional, flags };
}

async function readStdinLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    out._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function getPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readStdinLine();
  const first = await askHidden('Password: ');
  const again = await askHidden('Same again: ');
  if (first !== again) throw new UserError("those didn't match");
  return first;
}

function need(arg: string | undefined, what: string): string {
  if (arg === undefined) throw new UserError(`missing ${what}\n\n${HELP}`);
  return arg;
}

const when = (ms: number | null) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : 'never');

async function main(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  const [command, name, ...rest] = positional;
  if (!command || command === 'help' || flags.has('--help')) {
    console.log(HELP);
    return;
  }

  const db = openDb(DB_PATH);
  const now = Date.now;
  const accounts = new Accounts(db, now);
  const devices = new Devices(db, now);
  const user = (n: string | undefined) => {
    const u = accounts.findByName(need(n, 'name'));
    if (!u) throw new UserError(`no user called ${n}`);
    return u;
  };

  switch (command) {
    case 'list-users':
      for (const u of accounts.list()) {
        const n = devices.forUser(u.id).length;
        console.log(
          `${u.username.padEnd(14)} ${u.displayName.padEnd(16)} ${u.role.padEnd(7)} last sign-in ${when(u.lastLoginAt)}  ${n} device${n === 1 ? '' : 's'}${u.disabled ? '  [removed]' : ''}`,
        );
      }
      break;
    case 'add-user': {
      const display = flags.get('--display');
      const u = accounts.create(need(name, 'name'), typeof display === 'string' ? display : need(name, 'name'), flags.has('--admin') ? 'admin' : 'member');
      await accounts.setPassword(u.id, await getPassword());
      console.log(`Added ${u.username}. For a password-free sign-in: nest login-link ${u.username}`);
      break;
    }
    case 'set-password': {
      const u = user(name);
      await accounts.setPassword(u.id, await getPassword());
      accounts.endAllSessions(u.id);
      console.log(`New password set for ${u.username}; signed out everywhere.`);
      break;
    }
    case 'login-link': {
      const u = user(name);
      console.log(`${APP_URL}/l/${accounts.createLink(u.id)}`);
      console.log(`Good for 7 days and one sign-in: ${u.displayName} opens it and presses Sign in. Safe to send by WhatsApp or Messages.`);
      break;
    }
    case 'code': {
      const u = user(name);
      const c = accounts.createCode(u.id);
      console.log(`${c.code}   (for ${u.displayName}, until ${when(c.expiresAt)} UTC)`);
      break;
    }
    case 'set-display':
      accounts.update(user(name).id, { displayName: need(rest[0], 'shown name') });
      console.log('Done.');
      break;
    case 'set-role': {
      const role = need(rest[0], 'role');
      if (role !== 'admin' && role !== 'member') throw new UserError('role is admin or member');
      accounts.update(user(name).id, { role });
      console.log('Done.');
      break;
    }
    case 'delete-user':
      accounts.remove(user(name).id);
      console.log('Deleted.');
      break;
    case 'devices':
      for (const d of devices.forUser(user(name).id)) {
        console.log(
          `${String(d.id).padStart(3)}  ${(d.label ?? '-').padEnd(16)} ${new URL(d.endpoint).host.padEnd(28)} seen ${when(d.seenAt)}  last ok ${when(d.lastOkAt)}${d.lastError ? `  error: ${d.lastError}` : ''}`,
        );
      }
      break;
    case 'nudges': {
      const u = user(name);
      const house = new House(db, now);
      const ctx = { db, now, accounts, devices, house, log: console.log } as unknown as Ctx;
      if (flags.has('--send')) {
        const keys = vapidKeys(db);
        const deps = { db, now, devices, sender: webPushSender(keys, VAPID_SUBJECT), appUrl: APP_URL };
        const sent = await nudgeUser({ ...ctx, notifyDeps: deps }, u);
        for (const n of sent) console.log(`Sent ${n.kind} "${n.title}": ${n.body.replace(/\n/g, ' | ')}  → ${n.delivered}/${n.devices}${n.error ? ` (${n.error})` : ''}`);
        if (!sent.length) console.log('Nothing to send right now.');
        break;
      }
      const p = plan(ctx, u);
      console.log(`Today ${p.today} · needs them: ${p.badge} · reminder ${p.due ? 'is due now' : 'not due now'} (they chose ${u.settings.remind} at ${u.settings.remindAt})`);
      for (const r of p.reminders) console.log(`  ${r.kind.padEnd(8)} ${r.dueDate}  ${r.job.title}${r.step ? ` → ${r.step.title}` : ''}`);
      if (p.reminders.length) {
        const w = reminderWords(p.reminders, house.rooms(), p.today);
        console.log(`\n${w.title}\n${w.body}`);
      } else console.log('  Nothing to remind them of today.');
      break;
    }
    case 'sent':
      for (const n of recentNotifications(db, user(name).id, 20)) {
        console.log(`${when(n.sentAt)}  ${n.kind.padEnd(7)} ${n.delivered}/${n.devices}  ${n.title} — ${n.body.replace(/\n/g, ' | ')}${n.error ? `  [${n.error}]` : ''}${n.openedAt ? '  (opened)' : ''}`);
      }
      break;
    default:
      throw new UserError(`unknown command ${command}\n\n${HELP}`);
  }
  db.close();
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof UserError || err instanceof Error ? `nest: ${err.message}` : err);
  process.exit(1);
});
