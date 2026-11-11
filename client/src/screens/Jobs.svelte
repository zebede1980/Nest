<script lang="ts">
  import Fab from '../components/Fab.svelte';
  import Icon from '../components/Icon.svelte';
  import JobRow from '../components/JobRow.svelte';
  import { app } from '../lib/state.svelte';
  import { done, todo } from '../lib/house';
  import { isMine } from '../../../shared/reminders';
  import { route } from '../lib/router.svelte';
  import { SIZES, SIZE_LABEL, type Size } from '../../../shared/model';

  const h = $derived(app.house!);
  const asked = route.query.get('size');
  let show = $state<'todo' | 'done'>('todo');
  let size = $state<Size | null>(SIZES.includes(asked as Size) ? (asked as Size) : null);
  let mine = $state(false);
  let search = $state('');

  const all = $derived(show === 'todo' ? todo(h) : done(h));
  const list = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return all.filter((j) => {
      if (size && j.size !== size) return false;
      if (mine && !(show === 'todo' ? isMine(j, app.me!.id) : j.doneBy === app.me!.id)) return false;
      if (q && !`${j.title} ${j.notes ?? ''} ${h.rooms.find((r) => r.id === j.roomId)?.name ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  });
  const dated = $derived(show === 'todo' ? list.filter((j) => j.dueDate) : []);
  const undated = $derived(show === 'todo' ? list.filter((j) => !j.dueDate) : list);
</script>

<div class="page">
  <div class="head"><h1>Jobs</h1></div>

  <div class="seg">
    <button class:on={show === 'todo'} onclick={() => (show = 'todo')}>To do · {todo(h).length}</button>
    <button class:on={show === 'done'} onclick={() => (show = 'done')}>Done · {done(h).length}</button>
  </div>

  <div class="chips slide">
    <button class="chip" class:on={size === null} onclick={() => (size = null)}>All</button>
    {#each SIZES as s (s)}
      <button class="chip" class:on={size === s} onclick={() => (size = size === s ? null : s)}><Icon name={s} size={16} />{SIZE_LABEL[s]}</button>
    {/each}
    <button class="chip" class:on={mine} onclick={() => (mine = !mine)}><Icon name="person" size={16} />Mine</button>
  </div>

  {#if all.length > 8 || search}
    <label class="search">
      <Icon name="search" size={18} />
      <input bind:value={search} type="search" placeholder="Search jobs" enterkeyhint="search" aria-label="Search jobs" />
    </label>
  {/if}

  {#if !list.length}
    <div class="empty">
      <div class="big" aria-hidden="true">{show === 'todo' ? '🛋️' : '🧰'}</div>
      {#if all.length}
        <p>Nothing matches that.</p>
      {:else if show === 'todo'}
        <p>Nothing on the list. Put your feet up, or add something.</p>
        <button class="btn primary" onclick={() => (app.jobSheet = {})}>Add a job</button>
      {:else}
        <p>Nothing ticked off yet. The first one’s the hardest.</p>
      {/if}
    </div>
  {:else}
    {#if dated.length}
      <section class="section">
        {#if undated.length}<div class="eyebrow">With a date</div>{/if}
        <div class="rows">{#each dated as job (job.id)}<JobRow {job} />{/each}</div>
      </section>
    {/if}
    {#if undated.length}
      <section class="section">
        {#if dated.length}<div class="eyebrow">Whenever</div>{/if}
        <div class="rows">{#each undated as job (job.id)}<JobRow {job} />{/each}</div>
      </section>
    {/if}
  {/if}
</div>
<Fab start={size ? { size } : {}} />

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    min-height: 46px;
    border-radius: 23px;
    background: var(--card);
    border: 1px solid var(--line);
    color: var(--muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    align-self: stretch;
    border: 0;
    background: none;
    outline: none;
    font-size: 1rem;
    color: var(--ink);
    appearance: none;
    -webkit-appearance: none;
  }
  .search:focus-within {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }
</style>
