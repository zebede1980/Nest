<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import PhotoStrip from './PhotoStrip.svelte';
  import Icon from './Icon.svelte';
  import { del, post, put } from '../lib/api';
  import { act, app, refresh, showError } from '../lib/state.svelte';
  import { receipts } from '../lib/house';
  import { focusNow, penceText } from '../lib/look';
  import { uploadPhoto } from '../lib/photos';
  import { niceDate } from '../../../shared/dates';
  import { money, paidOn, parseMoney, type Cost, type CostKind, type Job, type Trade } from '../../../shared/model';

  // One line of a job's costs: something to buy, or a bill from someone we pay.
  let { job, cost = null, kind: startKind = 'item', tradeId: startTrade = null, onclose }: { job: Job; cost?: Cost | null; kind?: CostKind; tradeId?: number | null; onclose: () => void } = $props();
  const h = $derived(app.house!);
  // The line as it is now: payments and receipts change while the sheet is open.
  const live = $derived(cost ? (h.jobs.find((j) => j.id === job.id)?.costs.find((c) => c.id === cost.id) ?? null) : null);

  // The form starts from the line as it was when the sheet opened.
  const [c0, k0, t0] = untrack(() => [cost, startKind, startTrade] as const);
  let label = $state(c0?.label ?? '');
  let amount = $state(c0 ? penceText(c0.amount) : '');
  let kind = $state<CostKind>(c0?.kind ?? k0);
  let shop = $state(c0?.shop ?? '');
  let bought = $state(!!c0?.boughtAt);
  let tradeId = $state<number | null>(c0 ? c0.tradeId : t0);
  let newTrade = $state('');
  let addingTrade = $state(false);
  let receipt = $state<File | null>(null);
  let busy = $state(false);
  let error = $state('');

  const trades = $derived(h.trades.filter((t) => !t.archived || t.id === tradeId));
  const shops = $derived([...new Set(h.jobs.flatMap((j) => j.costs.map((c) => c.shop)).filter((s): s is string => !!s))].sort());
  const payments = $derived(live ? h.payments.filter((p) => p.costId === live.id).sort((a, b) => (a.paidOn < b.paidOn ? 1 : -1)) : []);
  const paid = $derived(live ? paidOn(live, h.payments) : 0);
  const left = $derived(live ? Math.max(0, live.amount - paid) : 0);

  let payAmount = $state('');
  let payDate = $state('');
  let payNote = $state('');
  let paying = $state(false);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    if (!label.trim()) return (error = kind === 'item' ? 'What is it?' : 'What’s the bill for?');
    const pence = amount.trim() ? parseMoney(amount) : 0;
    if (pence == null) return (error = "That doesn't look like an amount.");
    busy = true;
    try {
      let who = tradeId;
      if (kind === 'trade' && addingTrade && newTrade.trim()) {
        who = (await post<{ trade: Trade }>('/api/trades', { name: newTrade.trim() })).trade.id;
      }
      const fields = {
        label: label.trim(),
        amount: pence,
        kind,
        tradeId: kind === 'trade' ? who : null,
        shop: kind === 'item' ? shop.trim() || null : null,
        ...(kind === 'item' ? { bought } : {}),
      };
      if (cost) {
        await put(`/api/costs/${cost.id}`, fields);
      } else {
        const made = await post<{ cost: Cost }>(`/api/jobs/${job.id}/costs`, fields);
        if (receipt) await uploadPhoto(receipt, { cost: made.cost.id }).catch(showError);
      }
      await refresh();
      onclose();
    } catch (err) {
      showError(err);
      void refresh().catch(() => {});
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!cost) return;
    const ok = await act(() => del(`/api/costs/${cost.id}`), 'Removed');
    if (ok) onclose();
  }

  function startPaying() {
    paying = true;
    payAmount = penceText(left);
    payDate = h.today;
    payNote = '';
  }

  async function pay() {
    if (!live) return;
    const pence = parseMoney(payAmount);
    if (!pence) return showError(new Error('How much was paid?'));
    const ok = await act(() => post(`/api/costs/${live.id}/payments`, { amount: pence, paidOn: payDate || h.today, note: payNote.trim() || null }), `Payment of ${money(pence)} recorded`);
    if (ok) paying = false;
  }
</script>

<Sheet title={cost ? 'Edit cost' : kind === 'item' ? 'Something to buy' : 'Someone to pay'} onclose={onclose}>
  <form class="stack" onsubmit={save}>
    {#if !cost}
      <div class="seg">
        <button type="button" class:on={kind === 'item'} onclick={() => (kind = 'item')}>Something to buy</button>
        <button type="button" class:on={kind === 'trade'} onclick={() => (kind = 'trade')}>Someone to pay</button>
      </div>
    {/if}

    <label class="field">{kind === 'item' ? 'What is it?' : 'What’s it for?'}
      {#if cost}
        <input bind:value={label} maxlength="140" placeholder={kind === 'item' ? 'Tile adhesive' : 'Replastering the ceiling'} />
      {:else}
        <input bind:value={label} maxlength="140" placeholder={kind === 'item' ? 'Tile adhesive' : 'Replastering the ceiling'} use:focusNow />
      {/if}
    </label>

    <div class="grid2">
      <label class="field">{kind === 'item' ? 'Price' : 'Their bill'} <span class="money"><input bind:value={amount} inputmode="decimal" placeholder="0" /></span></label>
      {#if kind === 'item'}
        <label class="field">Shop <input bind:value={shop} maxlength="60" placeholder="Optional" list="nest-shops" autocapitalize="words" /></label>
        <datalist id="nest-shops">{#each shops as s (s)}<option value={s}></option>{/each}</datalist>
      {/if}
    </div>

    {#if kind === 'item'}
      <div class="toggle-row">
        <div><b>Already bought</b><div class="small muted">Otherwise it goes on the shopping list.</div></div>
        <button type="button" class="switch" class:on={bought} onclick={() => (bought = !bought)} aria-label="Already bought" aria-pressed={bought}></button>
      </div>
    {:else}
      <div class="group">
        <div class="label">Who?</div>
        <div class="chips">
          {#each trades as t (t.id)}
            <button type="button" class="chip" class:on={!addingTrade && tradeId === t.id} onclick={() => ((tradeId = tradeId === t.id ? null : t.id), (addingTrade = false))}>{t.name}</button>
          {/each}
          <button type="button" class="chip" class:on={addingTrade} onclick={() => (addingTrade = !addingTrade)}><Icon name="plus" size={15} /> Someone new</button>
        </div>
        {#if addingTrade}<input class="input" bind:value={newTrade} maxlength="80" placeholder="Their name or firm" autocapitalize="words" use:focusNow />{/if}
      </div>
    {/if}

    {#if live}
      {#if live.kind === 'trade'}
        <div class="group paybox">
          <div class="row between"><b>Payments</b><span class="small muted">{money(paid)} paid · {money(left)} to go</span></div>
          {#each payments as p (p.id)}
            <div class="row between small">
              <span class="grow">{niceDate(p.paidOn, h.today)}{p.note ? ` · ${p.note}` : ''}</span>
              <b>{money(p.amount)}</b>
              <button type="button" class="tiny" onclick={() => act(() => del(`/api/payments/${p.id}`), 'Payment removed')} aria-label="Remove payment"><Icon name="close" size={14} /></button>
            </div>
          {/each}
          {#if paying}
            <div class="grid2">
              <label class="field">Amount <span class="money"><input bind:value={payAmount} inputmode="decimal" /></span></label>
              <label class="field">Paid on <input type="date" bind:value={payDate} /></label>
            </div>
            <input class="input" bind:value={payNote} maxlength="140" placeholder="Note (deposit, bank transfer…)" />
            <div class="row">
              <button type="button" class="btn small" onclick={() => (paying = false)}>Cancel</button>
              <button type="button" class="btn small dark grow" onclick={pay}>Record payment</button>
            </div>
          {:else}
            <button type="button" class="btn small sage" onclick={startPaying}>Record a payment</button>
          {/if}
        </div>
      {/if}
      <div class="group">
        <div class="label">Receipt</div>
        <PhotoStrip photos={receipts(h, live.id)} target={{ cost: live.id }} addLabel="Add a photo of the receipt" />
      </div>
    {:else}
      <label class="receipt">
        <Icon name="receipt" size={18} />
        <span>{receipt ? `Receipt: ${receipt.name}` : 'Add a photo of the receipt'}</span>
        <input type="file" accept="image/*" onchange={(e) => (receipt = (e.target as HTMLInputElement).files?.[0] ?? null)} />
      </label>
    {/if}

    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="row">
      {#if cost}<button type="button" class="btn danger" onclick={remove}>Remove</button>{/if}
      <button class="btn primary grow" disabled={busy}>{busy ? 'Saving…' : cost ? 'Save' : 'Add'}</button>
    </div>
  </form>
</Sheet>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .paybox {
    padding: 14px;
    border-radius: 16px;
    background: var(--page);
    gap: 10px;
  }
  .paybox :global(input) {
    background: var(--card) !important;
  }
  .tiny {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 20px;
    border: 0;
    background: var(--track);
    color: var(--muted);
    display: grid;
    place-items: center;
  }
  .receipt {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 16px;
    border-radius: 14px;
    border: 1.5px dashed var(--dash);
    color: var(--muted);
    font-size: 0.8125rem;
    font-weight: 600;
    overflow: hidden;
  }
  .receipt span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .receipt input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    font-size: 0;
  }
</style>
