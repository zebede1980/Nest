<script lang="ts">
  import Avatar from '../components/Avatar.svelte';
  import Fab from '../components/Fab.svelte';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import JobRow from '../components/JobRow.svelte';
  import Ring from '../components/Ring.svelte';
  import { app } from '../lib/state.svelte';
  import { countBySize, ideas, liveRooms, moneyFor, nextDate, progress, todo } from '../lib/house';
  import { greeting, longDate } from '../lib/look';
  import { navigate } from '../lib/router.svelte';
  import { addDays, weekday } from '../../../shared/dates';
  import { SIZES, SIZE_LABEL, isRepeating, money, type Job, type Size } from '../../../shared/model';

  const h = $derived(app.house!);
  const open = $derived(todo(h));
  const prog = $derived(progress(h.jobs));
  const cash = $derived(moneyFor(h));
  const weekend = $derived([0, 6].includes(weekday(h.today)));
  let size = $state<Size>([0, 6].includes(new Date().getDay()) ? 'weekend' : 'evening');

  // Anything with a date in the next week, or already late.
  const soon = $derived(open.filter((j) => (nextDate(j) ?? '9') <= addDays(h.today, 7)));
  // Upkeep that isn't due for ages stays out of the way until it's nearly time.
  const resting = (j: Job) => isRepeating(j) && (nextDate(j) ?? '0') > addDays(h.today, 21);
  const fits = $derived(open.filter((j) => j.size === size && !soon.includes(j) && !resting(j)));
  const rooms = $derived(
    liveRooms(h)
      .map((room) => {
        const jobs = h.jobs.filter((j) => j.roomId === room.id && j.status !== 'idea');
        const left = jobs.filter((j) => j.status === 'todo').length;
        return { room, left, total: jobs.length };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.left - a.left),
  );
  const links = $derived<{ path: string; label: string; icon: IconName; n?: number }[]>([
    { path: '/ideas', label: 'Ideas', icon: 'idea', n: ideas(h).length },
    { path: '/notes', label: 'Notes', icon: 'note', n: h.notes.length },
    { path: '/trades', label: 'People we pay', icon: 'trade', n: h.trades.filter((t) => !t.archived).length },
    { path: '/settings', label: 'Settings', icon: 'settings' },
  ]);
</script>

<div class="page">
  <header class="top">
    <div class="grow">
      <div class="eyebrow">{longDate(h.today)}</div>
      <h1>{greeting(new Date().getHours())}, {app.me?.displayName}</h1>
    </div>
    <button class="people" onclick={() => navigate('/more')} aria-label="More: ideas, notes, people we pay, settings">
      {#each h.people.slice(0, 3) as p (p.id)}<Avatar id={p.id} />{/each}
    </button>
  </header>

  {#if !h.jobs.length}
    <div class="card lift welcome">
      <div class="big" aria-hidden="true">🏡</div>
      <h2>Welcome to your Nest</h2>
      <p class="muted">Every job around the house in one place, from “change the hallway bulb” to “new kitchen”. Start with whatever’s been nagging at you.</p>
      <button class="btn primary big" onclick={() => (app.jobSheet = {})}>Add the first job</button>
    </div>
  {:else}
    <button class="card lift prog" onclick={() => navigate('/progress')} aria-label="Progress">
      <Ring pct={prog.pct} label="{prog.pct} percent of jobs done" />
      <div class="grow">
        <div class="figure line1">{prog.total ? `${prog.done} of ${prog.total} jobs done` : 'Nothing ticked off yet'}</div>
        <div class="small muted">{money(cash.spent)} spent{cash.planned > cash.spent ? ` · ${money(cash.planned)} planned` : ''}</div>
        <div class="bar"><i style="width:{cash.planned ? Math.min(100, (cash.spent / cash.planned) * 100) : 0}%"></i></div>
      </div>
    </button>

    {#if soon.length}
      <section class="section">
        <div class="section-head"><h2>Coming up</h2></div>
        <div class="rows">
          {#each soon.slice(0, 5) as job (job.id)}<JobRow {job} />{/each}
        </div>
        {#if soon.length > 5}<button class="link" onclick={() => navigate('/jobs')}>And {soon.length - 5} more</button>{/if}
      </section>
    {/if}

    <section class="section">
      <div class="section-head">
        <h2>What fits {size === 'evening' ? (weekend ? 'this evening' : 'tonight') : size === 'weekend' ? 'this weekend' : 'the bigger plans'}?</h2>
      </div>
      <div class="chips slide">
        {#each SIZES as s (s)}
          <button class="chip" class:on={size === s} onclick={() => (size = s)} aria-pressed={size === s}><Icon name={s} size={16} />{SIZE_LABEL[s]} · {countBySize(open, s)}</button>
        {/each}
      </div>
      <div class="rows">
        {#each fits.slice(0, 4) as job (job.id)}<JobRow {job} />{/each}
      </div>
      {#if !fits.length}
        <p class="muted small none">{soon.some((j) => j.size === size) ? 'They’re all in “Coming up” above.' : `No ${SIZE_LABEL[size].toLowerCase()} jobs waiting. Lovely.`}</p>
      {:else if fits.length > 4}
        <button class="link" onclick={() => navigate(`/jobs?size=${size}`)}>See all {fits.length}</button>
      {/if}
    </section>

    {#if rooms.length}
      <section class="section">
        <div class="section-head"><h2>Rooms</h2><button class="link" onclick={() => navigate('/rooms')}>All rooms</button></div>
        <div class="roomscroll">
          {#each rooms as r (r.room.id)}
            <button class="roomcard tinted tint-{r.room.tint}" onclick={() => navigate(`/room/${r.room.id}`)}>
              <span class="name">{r.room.name}</span>
              <span class="left">{r.left ? `${r.left} job${r.left === 1 ? '' : 's'} left` : 'All done'}</span>
              <span class="rbar"><i style="width:{((r.total - r.left) / r.total) * 100}%"></i></span>
            </button>
          {/each}
        </div>
      </section>
    {/if}
  {/if}

  <nav class="quick" aria-label="More">
    {#each links as l (l.path)}
      <button onclick={() => navigate(l.path)}>
        <Icon name={l.icon} size={20} />
        <span>{l.label}</span>
        {#if l.n}<b>{l.n}</b>{/if}
      </button>
    {/each}
  </nav>
</div>
<Fab />

<style>
  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding-top: 8px;
  }
  .top h1 {
    margin-top: 2px;
    overflow-wrap: anywhere;
  }
  .people {
    flex: none;
    display: flex;
    border: 0;
    background: none;
    padding: 4px 0 4px 8px;
  }
  .people :global(.avatar + .avatar) {
    margin-left: -8px;
  }
  .welcome {
    align-items: center;
    text-align: center;
    gap: 12px;
    padding: 28px 22px;
  }
  .welcome .big {
    font-size: 2.6rem;
    line-height: 1;
  }
  .prog {
    flex-direction: row;
    align-items: center;
    gap: 16px;
    border: 0;
    text-align: left;
    width: 100%;
    color: inherit;
  }
  .prog .grow {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .line1 {
    font-size: 1.125rem;
    line-height: 1.2;
  }
  .prog .bar {
    margin-top: 6px;
  }
  .none {
    padding: 4px 2px;
  }
  .roomscroll {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    margin: 0 -20px;
    padding: 2px 20px 4px;
    scrollbar-width: none;
  }
  .roomscroll::-webkit-scrollbar {
    display: none;
  }
  .roomcard {
    flex: none;
    width: 124px;
    min-height: 92px;
    border: 0;
    border-radius: 18px;
    padding: 12px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .roomcard .name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.25;
  }
  .roomcard .left {
    font-size: 0.75rem;
  }
  .rbar {
    margin-top: auto;
    height: 5px;
    border-radius: 3px;
    background: var(--tint-bar);
    overflow: hidden;
  }
  .rbar i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--tint-ink);
  }
  .quick {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 6px;
  }
  .quick button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 14px;
    border-radius: 16px;
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink-2);
    font-size: 0.875rem;
    font-weight: 500;
    min-width: 0;
  }
  .quick span {
    flex: 1;
    min-width: 0;
    text-align: left;
    line-height: 1.2;
    padding: 6px 0;
  }
  .quick b {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted);
  }
</style>
