<script lang="ts">
  import CostSheet from '../components/CostSheet.svelte';
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import TradeSheet from '../components/TradeSheet.svelte';
  import { del, put } from '../lib/api';
  import { act, app } from '../lib/state.svelte';
  import { COST_WORDS, costState, costTone, todo } from '../lib/house';
  import { back } from '../lib/router.svelte';
  import { niceDate } from '../../../shared/dates';
  import { money, paidOn, type Cost, type Job } from '../../../shared/model';

  let { id }: { id: number } = $props();
  const h = $derived(app.house!);
  const trade = $derived(h.trades.find((t) => t.id === id));
  const bills = $derived(h.jobs.flatMap((job) => job.costs.filter((c) => c.kind === 'trade' && c.tradeId === id).map((cost) => ({ cost, job }))));
  const billed = $derived(bills.reduce((s, b) => s + b.cost.amount, 0));
  const paid = $derived(bills.reduce((s, b) => s + paidOn(b.cost, h.payments), 0));
  const payments = $derived(
    h.payments
      .filter((p) => bills.some((b) => b.cost.id === p.costId))
      .sort((a, b) => (a.paidOn < b.paidOn ? 1 : -1))
      .map((p) => ({ p, bill: bills.find((b) => b.cost.id === p.costId)! })),
  );

  let editing = $state(false);
  let menu = $state(false);
  let picking = $state(false);
  let sheet = $state<{ job: Job; cost: Cost | null } | null>(null);
  const tel = $derived(trade?.phone?.replace(/[^\d+]/g, '') ?? '');

  async function remove() {
    menu = false;
    if (!trade) return;
    const name = trade.name;
    back('/trades');
    await act(() => del(`/api/trades/${id}`), bills.length ? `${name} put away` : `${name} removed`);
  }
</script>

{#if !trade}
  <div class="page">
    <div class="head"><button class="round" onclick={() => back('/trades')} aria-label="Back"><Icon name="back" /></button></div>
    <div class="empty"><p>They aren’t here any more.</p></div>
  </div>
{:else}
  <div class="page">
    <div class="head">
      <button class="round" onclick={() => back('/trades')} aria-label="Back"><Icon name="back" /></button>
      <button class="round" onclick={() => (menu = true)} aria-label="More"><Icon name="dots" /></button>
    </div>

    <div class="stack tight">
      <h1>{trade.name}</h1>
      {#if trade.trade}<div class="muted">{trade.trade}</div>{/if}
      {#if trade.archived}<span class="pill">Not used any more</span>{/if}
    </div>

    {#if trade.phone || trade.email}
      <div class="row wrap">
        {#if trade.phone}<a class="btn sage grow" href="tel:{tel}"><Icon name="phone" size={18} />{trade.phone}</a>{/if}
        {#if trade.email}<a class="btn grow" href="mailto:{trade.email}"><Icon name="mail" size={18} />Email</a>{/if}
      </div>
    {:else}
      <button class="btn" onclick={() => (editing = true)}><Icon name="plus" size={16} />Add a phone number</button>
    {/if}

    <div class="three">
      <div class="card stat"><div class="figure">{money(billed)}</div><div class="small muted">billed</div></div>
      <div class="card stat"><div class="figure">{money(paid)}</div><div class="small muted">paid</div></div>
      <div class="card stat" class:owing={billed - paid > 0}><div class="figure">{money(Math.max(0, billed - paid))}</div><div class="small muted">to pay</div></div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Bills</h3>
        <button class="btn small" onclick={() => (picking = true)}><Icon name="plus" size={15} />Add</button>
      </div>
      {#each bills as b (b.cost.id)}
        {@const st = costState(b.cost, h)}
        <button class="bill" onclick={() => (sheet = b)}>
          <span class="grow">
            <span>{b.cost.label}</span>
            <span class="small muted">{b.job.title}</span>
          </span>
          <span class="tag {costTone(st)}">{COST_WORDS[st]}</span>
          <span class="amt">{money(b.cost.amount)}</span>
        </button>
      {:else}
        <p class="small muted">No bills yet. Add one here, or from a job’s Costs.</p>
      {/each}
    </div>

    {#if payments.length}
      <div class="card">
        <div class="card-head"><h3>Payments</h3></div>
        {#each payments as x (x.p.id)}
          <button class="bill" onclick={() => (sheet = x.bill)}>
            <span class="grow">
              <span>{niceDate(x.p.paidOn, h.today)}</span>
              <span class="small muted">{x.p.note || x.bill.cost.label}</span>
            </span>
            <span class="amt">{money(x.p.amount)}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if trade.notes}
      <div class="card">
        <h3>Notes</h3>
        <p class="pre">{trade.notes}</p>
      </div>
    {/if}
  </div>

  {#if menu}
    <Sheet title={trade.name} onclose={() => (menu = false)}>
      <button class="btn block" onclick={() => ((menu = false), (editing = true))}><Icon name="pencil" size={18} />Edit details</button>
      {#if trade.archived}
        <button class="btn block" onclick={() => ((menu = false), act(() => put(`/api/trades/${id}`, { name: trade.name, archived: false }), 'Back on the list'))}>Bring back</button>
      {:else}
        <button class="btn danger block" onclick={remove}><Icon name="trash" size={18} />{bills.length ? 'Put away' : 'Remove'}</button>
        {#if bills.length}<p class="small muted center">Their bills and payments are kept.</p>{/if}
      {/if}
    </Sheet>
  {/if}
  {#if editing}<TradeSheet {trade} onclose={() => (editing = false)} />{/if}
  {#if picking}
    <Sheet title="Which job is the bill for?" onclose={() => (picking = false)}>
      {#if todo(h).length}
        <div class="rows">
          {#each todo(h) as job (job.id)}
            <button class="pick" onclick={() => ((picking = false), (sheet = { job, cost: null }))}>{job.title}</button>
          {/each}
        </div>
      {:else}
        <p class="muted">Bills belong to a job, so add the job first.</p>
        <button class="btn primary block" onclick={() => ((picking = false), (app.jobSheet = {}))}>Add a job</button>
      {/if}
    </Sheet>
  {/if}
  {#if sheet}
    <CostSheet job={sheet.job} cost={sheet.cost} kind="trade" tradeId={id} onclose={() => (sheet = null)} />
  {/if}
{/if}

<style>
  .head {
    justify-content: space-between;
  }
  .tight {
    gap: 4px;
    align-items: flex-start;
  }
  h1 {
    overflow-wrap: anywhere;
  }
  a.btn {
    text-decoration: none;
  }
  .three {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .stat {
    padding: 14px 12px;
    gap: 0;
    min-width: 0;
  }
  .stat .figure {
    font-size: 1.25rem;
  }
  .stat.owing {
    background: var(--warm-bg);
  }
  .stat.owing .figure {
    color: var(--warm-ink);
  }
  .bill {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 4px 0;
    border: 0;
    background: none;
    text-align: left;
    font-size: 0.9375rem;
    min-width: 0;
  }
  .bill .grow {
    display: flex;
    flex-direction: column;
    overflow-wrap: anywhere;
  }
  .amt {
    flex: none;
    min-width: 52px;
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .pick {
    min-height: 52px;
    padding: 8px 14px;
    border: 0;
    border-radius: 16px;
    background: var(--page);
    text-align: left;
    font-weight: 500;
  }
</style>
