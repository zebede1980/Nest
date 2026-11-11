# Nest

A shared home-improvement list for two. At its simplest it's a list of jobs you tick off; everything else is optional and sits on top.

- **Jobs** sized as evening, weekend or bigger, each in a room. Optional steps, due dates, who's doing it, notes and photos.
- **Costs:** one rough figure, or a list of things to buy and bills from people you pay, adding up to a job total. A shopping list falls out of it.
- **People we pay:** contact details, running bills and payments.
- **Rooms:** what's left in each, plus the things worth remembering (paint colours, bulbs, measurements).
- **Reminders** by web push: a heads-up before a date, on the day, and the odd nag after. A heads-up when the other person finishes something.
- **Ideas, notes, upkeep that repeats, a progress page** and a timeline of what's been done.
- **Shared Google calendar:** dated jobs and steps appear in it as all-day events.
- **iPhone first:** install from Safari (Share → Add to Home Screen) for notifications and the badge. Works in any browser too.

Svelte 5 + Fastify + `node:sqlite`, one Docker container. See `CLAUDE.md` for how it works and how to deploy.

```
npm ci && npm run build && npm test
docker compose up -d --build
docker exec -it nest nest add-user <name> --admin
docker exec nest nest login-link <name>
```
