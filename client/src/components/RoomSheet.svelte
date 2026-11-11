<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import { del, put } from '../lib/api';
  import { act, app } from '../lib/state.svelte';
  import type { Room } from '../../../shared/model';

  // Rename a room, give it a colour, or take it off the list.
  let { room, onclose, onremoved }: { room: Room; onclose: () => void; onremoved?: () => void } = $props();
  const was = untrack(() => room);
  let name = $state(was.name);
  let tint = $state(was.tint);
  let sure = $state(false);
  const used = $derived(app.house!.jobs.some((j) => j.roomId === room.id));

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const ok = await act(() => put(`/api/rooms/${room.id}`, { name: name.trim(), tint }), 'Saved');
    if (ok) onclose();
  }

  async function remove() {
    if (!sure) return void (sure = true);
    const ok = await act(() => del(`/api/rooms/${room.id}`), used ? `${room.name} put away` : `${room.name} removed`, used ? () => put(`/api/rooms/${room.id}`, { archived: false }) : undefined);
    if (ok) (onremoved ?? onclose)();
  }
</script>

<Sheet title="Edit room" onclose={onclose}>
  <form class="stack" onsubmit={save}>
    <label class="field">Name <input bind:value={name} maxlength="60" autocapitalize="words" /></label>
    <div class="stack tight">
      <div class="label">Colour</div>
      <div class="swatches">
        {#each [0, 1, 2, 3, 4, 5] as t (t)}
          <button type="button" class="swatch tinted tint-{t}" class:on={tint === t} onclick={() => (tint = t)} aria-label="Colour {t + 1}" aria-pressed={tint === t}></button>
        {/each}
      </div>
    </div>
    <div class="row">
      <button type="button" class="btn danger" onclick={remove}>{sure ? 'Tap again to remove' : 'Remove room'}</button>
      <button class="btn primary grow">Save</button>
    </div>
    {#if sure}<p class="small muted">{used ? 'Its jobs are kept; the room is just put away. You can bring it back from Rooms → Edit.' : 'Nothing uses this room, so it will be removed for good.'}</p>{/if}
  </form>
</Sheet>

<style>
  .tight {
    gap: 8px;
  }
  .swatches {
    display: flex;
    gap: 10px;
  }
  .swatch {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    border: 0;
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .swatch.on {
    box-shadow:
      0 0 0 2px var(--card),
      0 0 0 4px var(--tint-ink);
  }
</style>
