# Nest

Joe and Nia's home-improvement tracker (started 2026-11-11). A shared list of jobs around the house with rooms, sizes, steps, costs, photos, reminders and a progress page. iPhone-first, as a Home Screen web app; the website does everything too. Built on Life Tracker's plumbing (cookie login, sign-in links, device codes, web push, Docker/NPM deploy) with its own look.

## What Joe asked for

- **Keep it easy.** "It should be perfectly capable to be used as just a list of tasks - the rest is all nice touches on top." Adding a job needs only a title; every other field is optional and tucked behind "More".
- **The look has to win Nia over:** "modern and inviting". He picked look A, warm and homely: Fraunces headings, Inter text, cream ground, terracotta accent, sage for done, six soft room tints. Light, dark, or match the phone.
- **Rooms** (his list, his order, seeded in `server/src/db.ts`): Kitchen, Cwtch, The Den, Downstairs bathroom, Office, Hallway and Landing, Utility Room, Our bedroom, Olly's Room, Carys's Room, Spare Room, Box Room, Upstairs Bathroom. **Cwtch is Welsh, not a typo.**
- **Address:** https://nest.terminuscloud.giize.com

## Where we are (2026-11-12)

- **v0.1.0 is live** at the address above. Everything Joe asked for is built: the list, rooms, sizes, steps, costs and people we pay, photos and receipts, reminders and heads-ups, ideas, notes, upkeep, shopping, progress with the done timeline, and the Google calendar link.
- Accounts `joe` (admin) and `nia` (member). Both have signed in through their links and Joe has started adding jobs. **The live data is real now: never test against it** beyond the look-only checks with a temporary account.
- **Verified:** 33 tests; headless WebKit at 375/390/430 on a seeded scratch copy; the look-only check on the live address; a live add-job and photo upload through the proxy; the sign-in link flow on the live address (`tools/check-link.mjs`).
- **Not yet verified, because it needs a real iPhone or real Google:** installing to the Home Screen, the notification permission prompt, a real reminder arriving, the badge number, and the calendar against real Google (tests use a fake). Neither person has a device registered for push yet (`nest list-users` shows 0 devices). When Joe reports on these, start with `nest devices <name>`, `nest nudges <name>` and `nest sent <name>`.
- Nothing is half-built and there is no to-do list. Next work comes from what Joe and Nia say after using it.
- **The GitHub repo is public.** Keep passwords, sign-in links, calendar IDs, key files and anything from the live data out of commits, this file and the README. `README.md` is the public-facing guide; this file is the working notes.

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
- `docs/screens/` the README's screenshots, retaken with `tools/readme-shots.mjs` from a seeded scratch copy.
- `tools/` `readme-shots.mjs`, `make-icons.mjs` (icon PNGs from `client/public/icon.svg`), `seed-demo.mjs` (demo house for a scratch copy), `check-ui.mjs` (headless WebKit at 375/390/430; changes data), `check-live.mjs` (look-only), `check-link.mjs` (a sign-in link: preview fetches, then a real press of the button; uses the link up, so make it for a temporary account).

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

Stop a scratch server by the PID on its port (`ss -ltnp | grep :3072`). **Never `pkill -f` on the script path:** the host's process list also shows the live container's node process.

`tools/check-live.mjs <url> <user> <password> <dir>` only looks (every tab at 390px, nothing changed), so it's safe against the live copy with a temporary account. Run it against an **empty** house too: the seeded check never sees the first-day screens.

## Rules for changes

- **Prove a fix on the running copy before saying it's done**, and make sure the check can fail: show it failing on the fault first where that's cheap. Passing tests alone aren't proof; three of the bugs below passed every test.
- **Keep it easy.** A new feature must not add a required field or a step to adding a job. Plain words on screen ("People we pay", not "Contractors"; "Upkeep", not "Recurring tasks").
- **Database:** `server/src/db.ts` holds numbered migrations. Never edit one that has shipped; add a new one. Back up `./data` before deploying a migration.
- **Money is pence, dates are `YYYY-MM-DD` strings** in the person's timezone (`shared/dates.ts`). Don't use `Date` sums on them.
- **Undo, not "Are you sure?"**: changes happen at once with an Undo toast.
- Screen changes: run `check-ui.mjs` on a seeded scratch copy **and** `check-live.mjs` on an empty one, then look at the screenshots.
- Test a Docker build from a fresh clone when files are added or `.gitignore` changes (an unanchored ignore line once hid source files in a sister project).

## Traps already found

- **A GET must never spend a sign-in link.** WhatsApp's preview fetch used up Nia's first link, and was handed a session as her. `GET /l/:token` only looks (`peekLink`); the button's `POST` spends it (`useLink`). The form post needs the `application/x-www-form-urlencoded` parser in `routes/auth.ts`, or Fastify answers 415.
- **Don't change the route while a screen is first drawing.** `Welcome.svelte` redirected during init inside `{#key route.path}` and left a blank screen with only the tab bar, everywhere except iPhone Safari. Do it in `onMount`.
- **The empty house looks different from the seeded one.** A swollen "Add the first job" button (`.welcome .big` also matched the button) only showed on the live, empty copy. Hence `check-live.mjs` and its oversized-button check.
- **Upkeep dated far ahead isn't "what fits tonight".** `resting()` in `Home.svelte` hides repeating jobs due more than 21 days away from that list only. Ordinary dated jobs must stay in it.
- A check that waits for an element can hide a blank page by crashing first. Wait on the URL, then measure the text on the page.
- `tools/check-ui.mjs` and `tools/seed-demo.mjs` change data: scratch copies only.
- `./data` must be owned by uid 1000 or the container can't open the database.
- `git mv -k` on an untracked file silently does nothing.

## Deploy

Dev repo `~/Nest` → GitHub `zebede1980/Nest` → deploy clone `~/DockerSource/Nest`.

```
cd ~/DockerSource/Nest && git pull && docker compose up -d --build
```

- Container `nest`, `127.0.0.1:3070` on the host, `nest:3000` on `nginx-proxy-nw` for nginx-proxy-manager.
- `./data` holds `nest.db` and `photos/`; it must be owned by uid 1000 (the container's `node` user). Back it up before anything risky: `docker compose stop && sudo tar czf ~/nest-backup-$(date +%F).tgz data && docker compose start`.
- The proxy host is nginx-proxy-manager's, forwarding to `nest:3000` with SSL forced and HTTP/2, and no Basic Auth.
- After a deploy: `curl -s http://127.0.0.1:3070/api/health` shows the version, then run `check-live.mjs` with a temporary account (`add-user keeper`, then `delete-user keeper`).
- Accounts: `docker exec -i nest nest add-user <name> [--display X] [--admin]` (password on stdin), `docker exec nest nest login-link <name>`, `docker exec nest nest list-users`.
