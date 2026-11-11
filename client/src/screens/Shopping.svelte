<script lang="ts">
  import Check from '../components/Check.svelte';
  import CostSheet from '../components/CostSheet.svelte';
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { app, toggleBought } from '../lib/state.svelte';
  import { roomOf, todo } from '../lib/house';
  import { money, type Cost, type Job } from '../../../shared/model';

  // Everything still to buy, pulled together from every job that isn't done.
  const h = $derived(app.house!);
  interface Line {
    cost: Cost;
    job: Job;
  }
  const lines = $derived(h.jobs.filter((j) => j.status === 'todo').flatMap((job) => job.costs.filter((c) => c.kind === 'item' && !c.boughtAt).map((cost) => ({ cost, job }))));
  const total = $derived(lines.reduce((s, l) => s + l.cost.amount, 0));
  const recent = $derived(
    h.jobs
      .flatMap((job) => job.costs.filter((c) => c.kind === 'item' && c.boughtAt && c.boughtAt > Date.now() - 14 * 86_400_000).map((cost) => ({ cost, job })))
      .sort((a, b) => b.cost.boughtAt! - a.cost.boughtAt!)
      .slice(0, 8),
  );

  let by = $state<'job' | 'shop'>('job');
  const groups = $derived.by(() => {
    const map = new Map<string, { name: string; sub: string; lines: Line[] }>();
    for (const l of lines) {
      const key = by === 'job' ? `j${l.job.id}` : (l.cost.shop ?? '').toLowerCase();
      let g = map.get(key);
      if (!g) map.set(key, (g = { name: by === 'job' ? l.job.title : l.cost.shop || 'Anywhere', sub: by === 'job' ? (roomOf(h, l.job.roomId)?.name ?? '') : '', lines: [] }));
      g.lines.push(l);
    }
    const list = [...map.values()];
    // "Anywhere" goes last when grouped by shop.
    if (by === 'shop') list.sort((a, b) => (a.name === 'Anywhere' ? 1 : b.name === 'Anywhere' ? -1 : a.name.localeCompare(b.name)));
    return list;
  });

  let picking = $state(false);
  let sheet = $state<{ job: Job; cost: Cost | null } | null>(null);
  const jobs = $derived(todo(h));
</script>

<div class="page">
  <div class="head">
    <h1>Shopping</h1>
    <button class="btn small dark" onclick={() => (picking = true)}><Icon name="plus" size={15} />Add</button>
  </div>

  {#if lines.length}
    <div class="card summary">
      <div>
        <div class="figure big">{lines.length}</div>
        <div class="small muted">thing{lines.length === 1 ? '' : 's'} to buy</div>
      </div>
      {#if total > 0}
        <div class="right">
          <div class="figure big">{money(total)}</div>
          <div class="small muted">or thereabouts</div>
        </div>
      {/if}
    </div>

    <div class="seg" role="tablist">
      <button class:on={by === 'job'} onclick={() => (by = 'job')}>By job</button>
      <button class:on={by === 'shop'} onclick={() => (by = 'shop')}>By shop</button>
    </div>

    {#each groups as g (g.name + g.sub)}
      <div class="card">
        <div class="card-head">
          <h3>{g.name}</h3>
          {#if g.sub}<span class="small muted">{g.sub}</span>{/if}
        </div>
        {#each g.lines as l (l.cost.id)}
          <div class="line">
            <Check done={false} size={22} label="Bought: {l.cost.label}" onclick={() => toggleBought(l.cost)} />
            <button class="what" onclick={() => (sheet = l)}>
              <span>{l.cost.label}</span>
              {#if by === 'shop'}<span class="sub">{l.job.title}</span>{:else if l.cost.shop}<span class="sub">{l.cost.shop}</span>{/if}
            </button>
            <span class="amt">{l.cost.amount ? money(l.cost.amount) : ''}</span>
          </div>
        {/each}
      </div>
    {/each}
  {:else}
    <div class="empty">
      <div class="big" aria-hidden="true">🛒</div>
      <p>Nothing to buy.</p>
      <p class="small">When a job needs things, list them under its Costs and they’ll all turn up here, ready for the next trip to the shops.</p>
    </div>
  {/if}

  {#if recent.length}
    <section class="section">
      <div class="section-head"><h2>Just bought</h2></div>
      <div class="card">
        {#each recent as l (l.cost.id)}
          <div class="line done">
            <Check done size={22} label="Not bought after all: {l.cost.label}" onclick={() => toggleBought(l.cost)} />
            <button class="what" onclick={() => (sheet = l)}><span>{l.cost.label}</span><span class="sub">{l.job.title}</span></button>
            <span class="amt">{l.cost.amount ? money(l.cost.amount) : ''}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

{#if picking}
  <Sheet title="Which job is it for?" onclose={() => (picking = false)}>
    {#if jobs.length}
      <div class="rows">
        {#each jobs as job (job.id)}
          <button class="pick" onclick={() => ((picking = false), (sheet = { job, cost: null }))}>
            <span class="grow">{job.title}</span>
            <span class="small muted">{roomOf(h, job.roomId)?.name ?? ''}</span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="muted">Shopping belongs to a job, so add a job first, then list what it needs.</p>
      <button class="btn primary block" onclick={() => ((picking = false), (app.jobSheet = {}))}>Add a job</button>
    {/if}
  </Sheet>
{/if}
{#if sheet}
  <CostSheet job={sheet.job} cost={sheet.cost} onclose={() => (sheet = null)} />
{/if}

<style>
  .summary {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
  }
  .figure.big {
    font-size: 2rem;
    line-height: 1.05;
  }
  .right {
    text-align: right;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
  }
  .what {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    text-align: left;
    padding: 6px 0;
    display: flex;
    flex-direction: column;
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }
  .sub {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .line.done .what > span:first-child {
    color: var(--faint);
    text-decoration: line-through;
  }
  .amt {
    flex: none;
    font-weight: 600;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 8px 14px;
    border: 0;
    border-radius: 16px;
    background: var(--page);
    text-align: left;
    font-weight: 500;
  }
</style>
