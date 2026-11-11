<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Ring from '../components/Ring.svelte';
  import { app, thumbUrl } from '../lib/state.svelte';
  import { done, jobPhotos, liveRooms, moneyFor, personOf, progress, roomOf } from '../lib/house';
  import { monthName, monthShort } from '../lib/look';
  import { navigate } from '../lib/router.svelte';
  import { addMonths, localDate } from '../../../shared/dates';
  import { SIZES, SIZE_LABEL, countsForProgress, jobSpent, money, type Job } from '../../../shared/model';

  const h = $derived(app.house!);
  const tz = $derived(app.me?.settings.tz ?? 'Europe/London');
  const all = $derived(progress(h.jobs));
  const cash = $derived(moneyFor(h));
  const finished = $derived(done(h));
  const doneDay = (j: Job) => localDate(j.doneAt ?? j.createdAt, tz);

  const sizes = $derived(SIZES.map((size) => ({ size, ...progress(h.jobs.filter((j) => j.size === size)) })).filter((s) => s.total));
  const rooms = $derived(
    liveRooms(h)
      .map((room) => {
        const jobs = h.jobs.filter((j) => j.roomId === room.id);
        return { room, ...progress(jobs), spent: jobs.reduce((s, j) => s + (j.status === 'idea' ? 0 : jobSpent(j, h.payments)), 0) };
      })
      .filter((r) => r.total),
  );

  // The last six months, oldest first, with how many jobs were finished in each.
  const months = $derived.by(() => {
    const first = h.today.slice(0, 7) + '-01';
    const list = [];
    for (let i = 5; i >= 0; i--) {
      const ym = addMonths(first, -i).slice(0, 7);
      list.push({ ym, n: finished.filter((j) => doneDay(j).startsWith(ym)).length });
    }
    return list;
  });
  const most = $derived(Math.max(1, ...months.map((m) => m.n)));

  const timeline = $derived.by(() => {
    const map = new Map<string, Job[]>();
    for (const j of finished) {
      const ym = doneDay(j).slice(0, 7);
      map.set(ym, [...(map.get(ym) ?? []), j]);
    }
    return [...map.entries()].map(([ym, jobs]) => ({ ym, jobs }));
  });
  let shown = $state(3);

  const upkeep = $derived(finished.filter((j) => !countsForProgress(j)).length);
</script>

<div class="page">
  <div class="head"><h1>Progress</h1></div>

  {#if !all.total && !finished.length}
    <div class="empty">
      <div class="big" aria-hidden="true">🌱</div>
      <p>Nothing to measure yet.</p>
      <p class="small">Add a few jobs and this page will keep score: how far along you are, room by room, and what it has all cost.</p>
    </div>
  {:else}
    <div class="card hero">
      <Ring pct={all.pct} size={112} stroke={11} label="{all.pct}%" />
      <div class="stack">
        <div class="figure huge">{all.done} <span class="of">of {all.total}</span></div>
        <div class="muted">job{all.total === 1 ? '' : 's'} done{all.total - all.done ? ` · ${all.total - all.done} to go` : ' — the lot!'}</div>
        {#if upkeep}<div class="small faint">plus {upkeep} bit{upkeep === 1 ? '' : 's'} of upkeep</div>{/if}
      </div>
    </div>

    {#if sizes.length}
      <div class="sizes">
        {#each sizes as s (s.size)}
          <div class="card mini">
            <span class="micon"><Icon name={s.size} size={18} /></span>
            <div class="figure">{s.done}<span class="of">/{s.total}</span></div>
            <div class="small muted">{SIZE_LABEL[s.size]}</div>
            <div class="bar"><i style="width:{s.pct}%"></i></div>
          </div>
        {/each}
      </div>
    {/if}

    {#if cash.planned || cash.spent}
      <div class="card">
        <div class="card-head"><h3>Money</h3></div>
        <div class="moneyrow">
          <div><div class="figure m">{money(cash.spent)}</div><div class="small muted">spent so far</div></div>
          <div><div class="figure m">{money(cash.toSpend)}</div><div class="small muted">still to spend</div></div>
        </div>
        {#if cash.planned > 0}
          <div class="bar thick"><i style="width:{Math.min(100, (cash.spent / cash.planned) * 100)}%"></i></div>
        {/if}
        {#if cash.owed > 0}
          <button class="owed" onclick={() => navigate('/trades')}>
            <span class="tag warm">To pay</span>
            <span class="grow">{money(cash.owed)} owed to people we pay</span>
            <Icon name="next" size={16} />
          </button>
        {/if}
      </div>
    {/if}

    {#if rooms.length}
      <div class="card">
        <div class="card-head"><h3>Room by room</h3></div>
        {#each rooms as r (r.room.id)}
          <button class="roomline" onclick={() => navigate(`/room/${r.room.id}`)}>
            <span class="row between">
              <span class="rname">{r.room.name}</span>
              <span class="small muted">{r.done} of {r.total}{r.spent ? ` · ${money(r.spent)}` : ''}</span>
            </span>
            <span class="bar tinted tint-{r.room.tint}"><i style="width:{r.pct}%"></i></span>
          </button>
        {/each}
      </div>
    {/if}

    {#if finished.length}
      <div class="card">
        <div class="card-head"><h3>Jobs finished</h3><span class="small muted">last six months</span></div>
        <div class="months">
          {#each months as m (m.ym)}
            <div class="month">
              <span class="n">{m.n || ''}</span>
              <span class="col" style="height:{(m.n / most) * 72}px" class:none={!m.n}></span>
              <span class="small muted">{monthShort(m.ym)}</span>
            </div>
          {/each}
        </div>
      </div>

      <section class="section">
        <div class="section-head"><h2>Look how far we’ve come</h2></div>
        {#each timeline.slice(0, shown) as t (t.ym)}
          <div class="tmonth">
            <div class="eyebrow">{monthName(t.ym)} · {t.jobs.length}</div>
            <div class="rows">
              {#each t.jobs as job (job.id)}
                {@const pics = jobPhotos(h, job.id)}
                {@const who = personOf(h, job.doneBy)}
                <button class="tjob" onclick={() => navigate(`/job/${job.id}`)}>
                  <span class="day">{+doneDay(job).slice(8)}</span>
                  <span class="grow">
                    <span class="ttitle">{job.title}</span>
                    <span class="small muted">{[roomOf(h, job.roomId)?.name, who?.displayName].filter(Boolean).join(' · ')}</span>
                  </span>
                  {#if pics.length}<img src={thumbUrl(pics[pics.length - 1].id)} alt="" loading="lazy" />{/if}
                </button>
              {/each}
            </div>
          </div>
        {/each}
        {#if timeline.length > shown}
          <button class="btn block" onclick={() => (shown += 6)}>Show earlier months</button>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .hero {
    flex-direction: row;
    align-items: center;
    gap: 20px;
    padding: 22px;
  }
  .hero .stack {
    gap: 2px;
    min-width: 0;
  }
  .huge {
    font-size: 2.25rem;
    line-height: 1.05;
  }
  .of {
    font-size: 0.5em;
    color: var(--muted);
    font-weight: 500;
  }
  .sizes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 10px;
  }
  .mini {
    padding: 14px;
    gap: 2px;
    min-width: 0;
  }
  .mini .figure {
    font-size: 1.5rem;
  }
  .mini .bar {
    margin-top: 8px;
  }
  .micon {
    color: var(--sage);
    margin-bottom: 4px;
  }
  .moneyrow {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .figure.m {
    font-size: 1.75rem;
  }
  .bar.thick {
    height: 10px;
    border-radius: 5px;
  }
  .bar.thick > i {
    background: var(--accent);
    border-radius: 5px;
  }
  .owed {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 0;
    background: none;
    text-align: left;
    padding: 6px 0 0;
    min-height: 44px;
    font-size: 0.875rem;
    color: var(--ink-2);
  }
  .roomline {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 0;
    background: none;
    text-align: left;
    padding: 4px 0;
  }
  .rname {
    font-weight: 600;
    font-size: 0.9375rem;
  }
  .roomline .bar {
    background: var(--tint);
    height: 8px;
    border-radius: 4px;
  }
  .roomline .bar > i {
    background: var(--tint-ink);
    border-radius: 4px;
  }
  .months {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 8px;
    align-items: end;
  }
  .month {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .month .n {
    font-size: 0.8125rem;
    font-weight: 600;
    min-height: 1.2em;
  }
  .col {
    width: 100%;
    max-width: 34px;
    min-height: 4px;
    border-radius: 8px 8px 3px 3px;
    background: var(--sage);
  }
  .col.none {
    background: var(--track);
  }
  .tmonth {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tjob {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 8px 12px 8px 14px;
    border: 0;
    border-radius: 18px;
    background: var(--card);
    box-shadow: var(--shadow-row);
    text-align: left;
    min-width: 0;
  }
  .day {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 17px;
    background: var(--sage-bg);
    color: var(--sage-ink);
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 0.875rem;
  }
  .tjob .grow {
    display: flex;
    flex-direction: column;
  }
  .ttitle {
    font-weight: 600;
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }
  .tjob img {
    flex: none;
    width: 46px;
    height: 46px;
    border-radius: 12px;
    object-fit: cover;
    background: var(--track);
  }
</style>
