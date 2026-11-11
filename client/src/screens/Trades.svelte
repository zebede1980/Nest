<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import TradeSheet from '../components/TradeSheet.svelte';
  import { put } from '../lib/api';
  import { act, app } from '../lib/state.svelte';
  import { back, navigate } from '../lib/router.svelte';
  import { money, paidOn, type Trade } from '../../../shared/model';

  // The people we pay: who they are, their number, and what we owe them.
  const h = $derived(app.house!);
  function sums(t: Trade) {
    const bills = h.jobs.flatMap((j) => j.costs.filter((c) => c.kind === 'trade' && c.tradeId === t.id));
    const billed = bills.reduce((s, c) => s + c.amount, 0);
    const paid = bills.reduce((s, c) => s + paidOn(c, h.payments), 0);
    return { billed, owing: Math.max(0, billed - paid), bills: bills.length };
  }
  const list = $derived(h.trades.filter((t) => !t.archived).map((t) => ({ t, ...sums(t) })));
  const away = $derived(h.trades.filter((t) => t.archived));
  let adding = $state(false);
</script>

<div class="page">
  <div class="head">
    <div class="row">
      <button class="round" onclick={() => back('/more')} aria-label="Back"><Icon name="back" /></button>
      <h1>People we pay</h1>
    </div>
    <button class="btn small dark" onclick={() => (adding = true)}><Icon name="plus" size={15} />Add</button>
  </div>

  {#if list.length}
    <div class="rows">
      {#each list as r (r.t.id)}
        <button class="trade" onclick={() => navigate(`/trade/${r.t.id}`)}>
          <span class="ic"><Icon name="trade" size={20} /></span>
          <span class="grow">
            <span class="t">{r.t.name}</span>
            <span class="small muted">{[r.t.trade, r.bills ? `${money(r.billed)} billed` : ''].filter(Boolean).join(' · ') || 'No bills yet'}</span>
          </span>
          {#if r.owing > 0}<span class="tag warm">{money(r.owing)} to pay</span>{:else if r.bills}<span class="tag sage">Paid up</span>{/if}
        </button>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <div class="big" aria-hidden="true">🧰</div>
      <p>Nobody here yet.</p>
      <p class="small">Add the plumber, the electrician, the skip firm. Keep their number handy, and see what they’ve billed and what’s been paid.</p>
      <button class="btn primary" onclick={() => (adding = true)}>Add someone</button>
    </div>
  {/if}

  {#if away.length}
    <section class="section">
      <div class="section-head"><h2>Not used any more</h2></div>
      <div class="card">
        {#each away as t (t.id)}
          <div class="row between">
            <button class="link" onclick={() => navigate(`/trade/${t.id}`)}>{t.name}</button>
            <button class="btn small" onclick={() => act(() => put(`/api/trades/${t.id}`, { name: t.name, archived: false }), `${t.name} is back`)}>Bring back</button>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

{#if adding}<TradeSheet onclose={() => (adding = false)} />{/if}

<style>
  .trade {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 68px;
    padding: 8px 14px;
    border: 0;
    border-radius: 18px;
    background: var(--card);
    box-shadow: var(--shadow-row);
    text-align: left;
    min-width: 0;
  }
  .ic {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 20px;
    background: var(--sage-bg);
    color: var(--sage-ink);
    display: grid;
    place-items: center;
  }
  .grow {
    display: flex;
    flex-direction: column;
  }
  .t {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .tag {
    flex: none;
  }
</style>
