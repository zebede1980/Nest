<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import { post, put } from '../lib/api';
  import { act } from '../lib/state.svelte';
  import { focusNow } from '../lib/look';
  import type { Trade } from '../../../shared/model';

  // Someone we pay: who they are and how to get hold of them.
  let { trade = null, onclose }: { trade?: Trade | null; onclose: () => void } = $props();
  const was = untrack(() => trade);
  let name = $state(was?.name ?? '');
  let what = $state(was?.trade ?? '');
  let phone = $state(was?.phone ?? '');
  let email = $state(was?.email ?? '');
  let notes = $state(was?.notes ?? '');
  let error = $state('');

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return (error = 'Who are they?');
    const fields = { name: name.trim(), trade: what.trim() || null, phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null };
    const ok = await act(() => (trade ? put(`/api/trades/${trade.id}`, fields) : post('/api/trades', fields)), trade ? 'Saved' : `${fields.name} added`);
    if (ok) onclose();
  }
</script>

<Sheet title={trade ? 'Edit details' : 'Someone we pay'} onclose={onclose}>
  <form class="stack" onsubmit={save}>
    <label class="field">Name or firm
      {#if trade}<input bind:value={name} maxlength="80" autocapitalize="words" />{:else}<input bind:value={name} maxlength="80" autocapitalize="words" placeholder="Dai the plumber" use:focusNow />{/if}
    </label>
    <label class="field">What they do <input bind:value={what} maxlength="60" placeholder="Plumber, electrician, skip hire…" /></label>
    <div class="grid2">
      <label class="field">Phone <input type="tel" bind:value={phone} maxlength="40" autocomplete="off" /></label>
      <label class="field">Email <input type="email" bind:value={email} maxlength="120" autocomplete="off" autocapitalize="none" /></label>
    </div>
    <label class="field">Notes <textarea bind:value={notes} maxlength="2000" placeholder="Recommended by next door. Prefers a text."></textarea></label>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <button class="btn primary block">{trade ? 'Save' : 'Add'}</button>
  </form>
</Sheet>
