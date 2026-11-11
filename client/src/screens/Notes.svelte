<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { del, post, put } from '../lib/api';
  import { act, app } from '../lib/state.svelte';
  import { personOf } from '../lib/house';
  import { focusNow, timeAgo } from '../lib/look';
  import { back } from '../lib/router.svelte';
  import type { Note } from '../../../shared/model';

  // A shared notepad for the house: anything that isn't a job.
  const h = $derived(app.house!);
  const notes = $derived([...h.notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt));

  let editing = $state<{ note: Note | null } | null>(null);
  let body = $state('');
  let sure = $state(false);

  function open(note: Note | null) {
    editing = { note };
    body = note?.body ?? '';
    sure = false;
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    const note = editing?.note;
    const text = body.trim();
    if (!text) return;
    editing = null;
    if (note && text === note.body) return;
    await act(() => (note ? put(`/api/notes/${note.id}`, { body: text }) : post('/api/notes', { body: text })), note ? 'Saved' : 'Note kept');
  }
  async function remove() {
    const note = editing?.note;
    if (!note) return;
    if (!sure) return void (sure = true);
    editing = null;
    await act(() => del(`/api/notes/${note.id}`), 'Note deleted');
  }
  const pin = (note: Note) => act(() => put(`/api/notes/${note.id}`, { pinned: !note.pinned }));
</script>

<div class="page">
  <div class="head">
    <div class="row">
      <button class="round" onclick={() => back('/more')} aria-label="Back"><Icon name="back" /></button>
      <h1>Notes</h1>
    </div>
    <button class="btn small dark" onclick={() => open(null)}><Icon name="plus" size={15} />New</button>
  </div>

  {#if notes.length}
    <div class="rows">
      {#each notes as note (note.id)}
        <div class="note" class:pinned={note.pinned}>
          <button class="text" onclick={() => open(note)}>
            <span class="body">{note.body}</span>
            <span class="small faint">{personOf(h, note.updatedBy)?.displayName ?? 'Someone'} · {timeAgo(note.updatedAt)}</span>
          </button>
          <button class="pin" class:on={note.pinned} onclick={() => pin(note)} aria-label={note.pinned ? 'Unpin' : 'Pin to the top'} aria-pressed={note.pinned}><Icon name="pin" size={18} /></button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <div class="big" aria-hidden="true">📝</div>
      <p>Nothing noted yet.</p>
      <p class="small">Handy for the things you always end up asking each other: where the stopcock is, which day the bins go, who fitted the boiler.</p>
      <button class="btn primary" onclick={() => open(null)}>Write the first one</button>
    </div>
  {/if}
</div>

{#if editing}
  <Sheet title={editing.note ? 'Note' : 'New note'} onclose={() => (editing = null)}>
    <form class="stack" onsubmit={save}>
      {#if editing.note}
        <textarea class="input tall" bind:value={body} maxlength="4000" aria-label="Note"></textarea>
      {:else}
        <textarea class="input tall" bind:value={body} maxlength="4000" aria-label="Note" placeholder="The stopcock is under the kitchen sink, left-hand side." use:focusNow></textarea>
      {/if}
      <div class="row">
        {#if editing.note}<button type="button" class="btn danger" onclick={remove}>{sure ? 'Really delete?' : 'Delete'}</button>{/if}
        <button class="btn primary grow" disabled={!body.trim()}>Save</button>
      </div>
    </form>
  </Sheet>
{/if}

<style>
  .note {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    border-radius: 18px;
    background: var(--card);
    box-shadow: var(--shadow-row);
    padding: 6px 6px 6px 16px;
  }
  .note.pinned {
    background: var(--warm-bg);
  }
  .text {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    text-align: left;
    padding: 10px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    -webkit-user-select: text;
    user-select: text;
  }
  .body {
    white-space: pre-line;
    overflow-wrap: anywhere;
    font-size: 0.9375rem;
    display: -webkit-box;
    -webkit-line-clamp: 8;
    line-clamp: 8;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .pin {
    flex: none;
    width: 44px;
    height: 44px;
    border: 0;
    background: none;
    color: var(--faint);
    display: grid;
    place-items: center;
  }
  .pin.on {
    color: var(--accent);
  }
  .tall {
    min-height: 180px;
  }
</style>
