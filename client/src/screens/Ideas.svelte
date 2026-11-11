<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { post } from '../lib/api';
  import { act, app } from '../lib/state.svelte';
  import { ideas, roomOf } from '../lib/house';
  import { back, navigate } from '../lib/router.svelte';

  // Things we might do one day. No room, size or date needed until one becomes a job.
  const h = $derived(app.house!);
  const list = $derived(ideas(h));
  let title = $state('');

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    title = '';
    await act(() => post('/api/jobs', { title: t, status: 'idea' }));
  }
</script>

<div class="page">
  <div class="head">
    <button class="round" onclick={() => back('/more')} aria-label="Back"><Icon name="back" /></button>
    <h1>Ideas</h1>
  </div>
  <p class="muted">For the “wouldn’t it be nice if…” thoughts. They wait here, out of the way, until you decide to do one.</p>

  <form class="add" onsubmit={add}>
    <input class="input" bind:value={title} maxlength="140" placeholder="Window seat in the Cwtch…" enterkeyhint="done" aria-label="A new idea" />
    <button class="btn dark" disabled={!title.trim()}>Add</button>
  </form>

  {#if list.length}
    <div class="rows">
      {#each list as job (job.id)}
        <div class="idea">
          <button class="main" onclick={() => navigate(`/job/${job.id}`)}>
            <span class="t">{job.title}</span>
            {#if roomOf(h, job.roomId)}<span class="small muted">{roomOf(h, job.roomId)!.name}</span>{/if}
          </button>
          <button class="btn small sage" onclick={() => (app.jobSheet = { job, idea: false })}>Make it a job</button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty"><div class="big" aria-hidden="true">💡</div><p>No ideas yet. They’ll come.</p></div>
  {/if}
</div>

<style>
  .head {
    justify-content: flex-start;
    gap: 12px;
  }
  .add {
    display: flex;
    gap: 8px;
  }
  .add .input {
    background: var(--card);
  }
  .idea {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 64px;
    padding: 6px 12px 6px 16px;
    border-radius: 18px;
    background: var(--card);
    box-shadow: var(--shadow-row);
  }
  .main {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    text-align: left;
    padding: 8px 0;
    display: flex;
    flex-direction: column;
  }
  .t {
    font-weight: 600;
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }
  .idea .btn {
    flex: none;
  }
</style>
