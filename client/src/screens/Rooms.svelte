<script lang="ts">
  import Fab from '../components/Fab.svelte';
  import Icon from '../components/Icon.svelte';
  import RoomSheet from '../components/RoomSheet.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { post, put } from '../lib/api';
  import { act, app } from '../lib/state.svelte';
  import { liveRooms } from '../lib/house';
  import { navigate } from '../lib/router.svelte';
  import type { Room } from '../../../shared/model';

  const h = $derived(app.house!);
  const rooms = $derived(
    liveRooms(h).map((room) => {
      const jobs = h.jobs.filter((j) => j.roomId === room.id && j.status !== 'idea');
      const left = jobs.filter((j) => j.status === 'todo').length;
      return { room, left, total: jobs.length, ideas: h.jobs.filter((j) => j.roomId === room.id && j.status === 'idea').length };
    }),
  );
  const away = $derived(h.rooms.filter((r) => r.archived));

  let editing = $state(false);
  let one = $state<Room | null>(null);
  let newName = $state('');

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    newName = '';
    await act(() => post('/api/rooms', { name }), `${name} added`);
  }

  async function move(id: number, by: number) {
    const ids = liveRooms(h).map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await act(() => post('/api/rooms/order', { ids: [...ids, ...away.map((r) => r.id)] }));
  }
</script>

<div class="page">
  <div class="head">
    <h1>Rooms</h1>
    <button class="btn small" onclick={() => (editing = true)}>Edit</button>
  </div>

  <div class="grid">
    {#each rooms as r (r.room.id)}
      <button class="roomcard tinted tint-{r.room.tint}" onclick={() => navigate(`/room/${r.room.id}`)}>
        <span class="name">{r.room.name}</span>
        <span class="left">
          {#if r.left}{r.left} job{r.left === 1 ? '' : 's'} left{:else if r.total}All done ✓{:else if r.ideas}{r.ideas} idea{r.ideas === 1 ? '' : 's'}{:else}Nothing yet{/if}
        </span>
        <span class="rbar"><i style="width:{r.total ? ((r.total - r.left) / r.total) * 100 : 0}%"></i></span>
      </button>
    {/each}
  </div>
</div>
<Fab />

{#if editing && !one}
  <Sheet title="Rooms" onclose={() => (editing = false)}>
    <div class="rows">
      {#each liveRooms(h) as room, i (room.id)}
        <div class="editrow">
          <span class="dot tinted tint-{room.tint}"></span>
          <button class="rname" onclick={() => (one = room)}>{room.name}</button>
          <button class="arrow" onclick={() => move(room.id, -1)} disabled={i === 0} aria-label="Move {room.name} up"><Icon name="up" size={18} /></button>
          <button class="arrow" onclick={() => move(room.id, 1)} disabled={i === liveRooms(h).length - 1} aria-label="Move {room.name} down"><Icon name="down" size={18} /></button>
        </div>
      {/each}
    </div>
    <form class="row" onsubmit={add}>
      <input class="input" bind:value={newName} placeholder="Add a room (Garden, Garage, Loft…)" maxlength="60" autocapitalize="words" />
      <button class="btn dark">Add</button>
    </form>
    {#if away.length}
      <div class="stack">
        <div class="label">Put away</div>
        {#each away as room (room.id)}
          <div class="row between">
            <span>{room.name}</span>
            <button class="btn small" onclick={() => act(() => put(`/api/rooms/${room.id}`, { archived: false }), `${room.name} is back`)}>Bring back</button>
          </div>
        {/each}
      </div>
    {/if}
    <p class="small muted">Tap a room to rename it, change its colour or remove it.</p>
  </Sheet>
{/if}
{#if one}
  <RoomSheet room={one} onclose={() => (one = null)} />
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  @media (min-width: 560px) {
    .grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .roomcard {
    min-height: 104px;
    border: 0;
    border-radius: 20px;
    padding: 14px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .name {
    font-family: var(--serif);
    font-variation-settings: 'opsz' 72;
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .left {
    font-size: 0.8125rem;
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
  .editrow {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
  }
  .dot {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 9px;
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .rname {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    text-align: left;
    padding: 10px 0;
    font-weight: 500;
  }
  .arrow {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 20px;
    border: 0;
    background: var(--track);
    color: var(--ink-2);
    display: grid;
    place-items: center;
  }
</style>
