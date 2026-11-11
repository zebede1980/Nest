# Nest

Joe and Nia's home-improvement tracker (started 2026-11-11). A shared list of jobs around the house with rooms, sizes, steps, costs, photos, reminders and a progress page. iPhone-first, as a Home Screen web app; the website does everything too. Built on Life Tracker's plumbing (cookie login, sign-in links, device codes, web push, Docker/NPM deploy) with its own look.

## What Joe asked for

- **Keep it easy.** "It should be perfectly capable to be used as just a list of tasks - the rest is all nice touches on top." Adding a job needs only a title; every other field is optional and tucked behind "More".
- **The look has to win Nia over:** "modern and inviting". He picked look A, warm and homely: Fraunces headings, Inter text, cream ground, terracotta accent, sage for done, six soft room tints. Light, dark, or match the phone.
- **Rooms** (his list, his order, seeded in `server/src/db.ts`): Kitchen, Cwtch, The Den, Downstairs bathroom, Office, Hallway and Landing, Utility Room, Our bedroom, Olly's Room, Carys's Room, Spare Room, Box Room, Upstairs Bathroom. **Cwtch is Welsh, not a typo.**
- **Address:** https://nest.terminuscloud.giize.com

## How it works

- **The whole house in one call.** `GET /api/house` returns everything (`House` in `shared/model.ts`): it's two people and a few hundred jobs. The client keeps it in `app.house` and derives every screen from it (`client/src/lib/house.ts`). Changes go through `act()` in `client/src/lib/state.svelte.ts`: run the call, refresh the house, toast (with Undo where there is one). Ticks are optimistic.
- **Jobs** have a status (`idea` → `todo` → `done`), a size (`evening`, `weekend`, `bigger`), an optional room, assignee, due date, notes, steps, and costs. Money is pence throughout.
- **Costs:** a job has either one `simpleCost` or cost lines. A line is an `item` (bought or not, optional shop) or a `trade` bill (paid off by `payments`). `jobTotal` / `jobSpent` in `shared/model.ts` are the only sums.
- **Upkeep** (`repeatEvery` + `repeatUnit`): ticking it done logs the finish and moves the due date on from the day it was done. It doesn't count towards progress.
- **Deleted jobs** go to a bin (`deleted_at`) so Undo can bring them back.
- **Photos** are resized in the browser (`client/src/lib/photos.ts`) and stored as files in `PHOTO_DIR`, with a thumbnail. A photo belongs to a job, a room, or a cost line (a receipt).

## Reminders

- Rules are pure functions in `shared/reminders.ts`; `server/src/scheduler.ts` does the sending, once a minute.
- **One round-up a day per person**, at their chosen time (never after 21:00): things due today, things coming (evening jobs and steps 1 day ahead, weekend jobs 2, bigger jobs 7 and 1), and late things on day 1, day 3, then weekly.
- "My jobs" means given to me or to nobody. Each person picks My jobs / Every job / None.
- **Heads-ups:** when someone else finishes a job (sent 45 s later, so a slip can be undone first) and when someone gives you a job.
- Dedupe is by key in the same transaction as the notification row, so nothing goes twice.
- `nest nudges` shows what would go now; `nest sent` shows what went.

## Push (the iPhone part)

- **Only works from the Home Screen app** on iOS. Permission must be asked straight from a tap; the VAPID key is preloaded so nothing slow is awaited first (`client/src/lib/push.ts`).
- Payloads are Declarative Web Push, with `client/public/sw.js` as the fallback for older iOS and desktop.
- The app re-sends its subscription on every open and wake (`syncPush()`).
- VAPID keys are generated on first start and kept in the DB. Changing them breaks every subscription.

## Sign-in

- App login with a year-long cookie (`nest_session`). **No NPM Basic Auth**: it breaks Home Screen apps.
- **The Home Screen app has its own cookies, separate from Safari.** A sign-in link (`/l/<token>`, 7 days, one sign-in) opens a page with a Sign in button; pressing it signs Safari in and lands on `/welcome`, which shows how to install. **Opening the link must never spend it:** WhatsApp and Messages fetch a link for its preview the moment it's pasted, which used up Nia's first link (2026-11-11). Only the button's POST spends it. The installed app opens on "I have a code": an 8-character device code made in Settings (or `nest code <name>`).
- 401 means only "no session" (the client signs out on it), so never pass on someone else's 401. Wrong password or code is 403. Changes need header `x-nest: 1`.

## Google calendar

- `server/src/gcal.ts`. Nest signs in as a Google service account that the shared calendar has been shared with ("Make changes to events"). Connected in Settings by an admin: calendar ID plus the service account's JSON key file.
- Dated jobs and steps become all-day events; they follow changes and are removed when done. Nest only touches events it made (`calendar_events`). A failed change is retried by the scheduler.
- Tests use a fake Google. **Ask Joe before making live Google calls.**

## Layout

- `shared/` types, dates, money and reminder rules, used by both sides.
- `server/src/` Fastify app: `house.ts` (jobs, rooms, costs, trades, notes, photos), `accounts.ts`, `push.ts`, `notify.ts`, `scheduler.ts`, `gcal.ts`, `cli.ts`.
- `client/src/` Svelte 5 (runes): `screens/`, `components/`, `lib/`. Styles and tokens in `client/src/app.css`.
- `tests/` vitest against the real app with an in-memory database.
- `tools/` `make-icons.mjs` (icon PNGs from `client/public/icon.svg`), `seed-demo.mjs` (demo house for a scratch copy), `check-ui.mjs` (headless WebKit at 375/390/430; changes data), `check-live.mjs` (look-only).

## Working on it

```
npm run check     # svelte-check + tsc for the server
npm test          # vitest
npm run build     # dist/ (client) and dist-server/
npm run dev       # vite on 3071, API on 3072
```

Check screens against a scratch copy, never the live data (the check adds and ticks jobs):

```
DATA_DIR=/tmp/nest-scratch PORT=3072 npm start
echo some-password | DATA_DIR=/tmp/nest-scratch node dist-server/server/src/cli.js add-user joe --admin
node tools/seed-demo.mjs http://localhost:3072 joe some-password
node tools/check-ui.mjs http://localhost:3072 joe some-password shots
```

`PROBE=1` plants an over-wide element so you can see the sideways-scroll check fail.

`tools/check-live.mjs <url> <user> <password> <dir>` only looks (every tab at 390px, nothing changed), so it's safe against the live copy with a temporary account. Run it against an **empty** house too: the seeded check never sees the first-day screens.

## Deploy

Dev repo `~/Nest` → GitHub `zebede1980/Nest` → deploy clone `~/DockerSource/Nest`.

```
cd ~/DockerSource/Nest && git pull && docker compose up -d --build
```

- Container `nest`, `127.0.0.1:3070` on the host, `nest:3000` on `nginx-proxy-nw` for nginx-proxy-manager.
- `./data` holds `nest.db` and `photos/`; it must be owned by uid 1000 (the container's `node` user). Back it up before anything risky.
- Accounts: `docker exec -i nest nest add-user <name> [--display X] [--admin]` (password on stdin), `docker exec nest nest login-link <name>`, `docker exec nest nest list-users`.
