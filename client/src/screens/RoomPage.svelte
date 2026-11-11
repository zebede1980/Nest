<script lang="ts">
  import Fab from '../components/Fab.svelte';
  import Icon from '../components/Icon.svelte';
  import JobRow from '../components/JobRow.svelte';
  import PhotoStrip from '../components/PhotoStrip.svelte';
  import RoomSheet from '../components/RoomSheet.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { del, post, put } from '../lib/api';
  import { act, app } from '../lib/state.svelte';
  import { byDone, byDue, moneyFor, roomOf, roomPhotos } from '../lib/house';
  import { focusNow } from '../lib/look';
  import { back, navigate } from '../lib/router.svelte';
  import { money, type Fact } from '../../../shared/model';

  let { id }: { id: number } = $props();
  const h = $derived(app.house!);
  const room = $derived(roomOf(h, id));
  const jobs = $derived(h.jobs.filter((j) => j.roomId === id));
  const open = $derived(jobs.filter((j) => j.status === 'todo').sort(byDue));
  const finished = $derived(jobs.filter((j) => j.status === 'done').sort(byDone));
  const thoughts = $derived(jobs.filter((j) => j.status === 'idea'));
  const cash = $derived(moneyFor(h, jobs));

  let editing = $state(false);
  let showDone = $state(false);

  // ── Good to know ──
  const SUGGEST = ['Wall paint', 'Ceiling', 'Woodwork', 'Flooring', 'Bulbs', 'Measurements'];
  const unused = $derived(SUGGEST.filter((s) => !room?.facts.some((f) => f.label.toLowerCase() === s.toLowerCase())));
  let fact = $state<{ id: number | null; label: string; value: string } | null>(null);

  async function saveFact(e: SubmitEvent) {
    e.preventDefault();
    const f = fact;
    if (!f || !f.label.trim() || !f.value.trim()) return;
    fact = null;
    const body = { label: f.label.trim(), value: f.value.trim() };
    await act(() => (f.id ? put(`/api/facts/${f.id}`, body) : post(`/api/rooms/${id}/facts`, body)));
  }
  async function removeFact() {
    const f = fact;
    if (!f?.id) return;
    fact = null;
    await act(() => del(`/api/facts/${f.id}`), 'Removed');
  }
  const openFact = (f: Fact) => (fact = { id: f.id, label: f.label, value: f.value });

  // ── Notes ──
  let notes = $state('');
  let saved = '';
  let loaded = false;
  $effect(() => {
    if (room && !loaded) {
      loaded = true;
      notes = saved = room.notes ?? '';
    }
  });
  function saveNotes() {
    if (!loaded || notes === saved) return;
    const text = notes;
    saved = text;
    void act(() => put(`/api/rooms/${id}`, { notes: text.trim() || null }));
  }
  $effect(() => () => saveNotes());
</script>

{#if !room}
  <div class="page">
    <div class="head"><button class="round" onclick={() => back('/rooms')} aria-label="Back"><Icon name="back" /></button></div>
    <div class="empty"><p>That room isn’t here any more.</p></div>
  </div>
{:else}
  <div class="page">
    <div class="head">
      <button class="round" onclick={() => back('/rooms')} aria-label="Back"><Icon name="back" /></button>
      <button class="round" onclick={() => (editing = true)} aria-label="Edit room"><Icon name="pencil" size={18} /></button>
    </div>

    <div class="hero tinted tint-{room.tint}">
      <h1>{room.name}</h1>
      <div class="small">
        {#if open.length}{open.length} job{open.length === 1 ? '' : 's'} left{:else if finished.length}All done{:else}Nothing on the list{/if}{finished.length ? ` · ${finished.length} done` : ''}{cash.spent ? ` · ${money(cash.spent)} spent` : ''}{cash.toSpend ? ` · ${money(cash.toSpend)} to go` : ''}
      </div>
      {#if open.length + finished.length}
        <div class="rbar"><i style="width:{(finished.length / (open.length + finished.length)) * 100}%"></i></div>
      {/if}
    </div>

    <section class="section">
      <div class="section-head"><h2>To do</h2></div>
      {#if open.length}
        <div class="rows">{#each open as job (job.id)}<JobRow {job} room={false} />{/each}</div>
      {:else}
        <p class="muted small">Nothing to do in here{finished.length ? '. Lovely.' : ' yet.'}</p>
      {/if}
    </section>

    {#if thoughts.length}
      <section class="section">
        <div class="section-head"><h2>Ideas</h2></div>
        <div class="rows">{#each thoughts as job (job.id)}<JobRow {job} room={false} />{/each}</div>
      </section>
    {/if}

    <div class="card">
      <div class="card-head"><h3>Good to know</h3><span class="small muted">Paint, bulbs, sizes</span></div>
      {#each room.facts as f (f.id)}
        <button class="fact" onclick={() => openFact(f)}>
          <span class="flabel">{f.label}</span>
          <span class="fvalue">{f.value}</span>
        </button>
      {/each}
      <div class="chips">
        {#each unused as s (s)}
          <button class="chip sm" onclick={() => (fact = { id: null, label: s, value: '' })}><Icon name="plus" size={14} />{s}</button>
        {/each}
        <button class="chip sm" onclick={() => (fact = { id: null, label: '', value: '' })}><Icon name="plus" size={14} />Something else</button>
      </div>
    </div>

    <div class="card">
      <h3>Notes</h3>
      <textarea class="input notes" bind:value={notes} onblur={saveNotes} maxlength="4000" placeholder="Anything about this room worth keeping."></textarea>
    </div>

    <section class="section">
      <div class="section-head"><h2>Photos</h2></div>
      <PhotoStrip photos={roomPhotos(h, id)} target={{ room: id }} addLabel="Add a photo of the room" />
    </section>

    {#if finished.length}
      <section class="section">
        <button class="donehead" onclick={() => (showDone = !showDone)} aria-expanded={showDone}>
          <h2>Done · {finished.length}</h2>
          <Icon name={showDone ? 'up' : 'down'} size={18} />
        </button>
        {#if showDone}
          <div class="rows">{#each finished as job (job.id)}<JobRow {job} room={false} />{/each}</div>
        {/if}
      </section>
    {/if}
  </div>
  <Fab start={{ roomId: id }} label="Add a job in {room.name}" />

  {#if editing}
    <RoomSheet {room} onclose={() => (editing = false)} onremoved={() => navigate('/rooms', { replace: true })} />
  {/if}

  {#if fact}
    <Sheet title={fact.id ? 'Good to know' : 'Add something to remember'} onclose={() => (fact = null)}>
      <form class="stack" onsubmit={saveFact}>
        <label class="field">What <input bind:value={fact.label} maxlength="60" placeholder="Wall paint" /></label>
        <label class="field">Details <textarea bind:value={fact.value} maxlength="300" placeholder="Dulux Timeless, matt — tin’s in the garage" use:focusNow></textarea></label>
        <div class="row">
          {#if fact.id}<button type="button" class="btn danger" onclick={removeFact}>Remove</button>{/if}
          <button class="btn primary grow">Save</button>
        </div>
      </form>
    </Sheet>
  {/if}
{/if}

<style>
  .head {
    justify-content: space-between;
  }
  .hero {
    border-radius: 24px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hero h1 {
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .rbar {
    margin-top: 8px;
    height: 6px;
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
  .fact {
    display: flex;
    flex-direction: column;
    gap: 1px;
    border: 0;
    background: none;
    text-align: left;
    padding: 4px 0;
  }
  .flabel {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted);
  }
  .fvalue {
    font-size: 0.9375rem;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .chip.sm {
    height: 34px;
    padding: 0 11px;
    font-size: 0.8125rem;
    color: var(--muted);
    background: transparent;
    border-style: dashed;
    border-color: var(--dash);
  }
  .notes {
    min-height: 84px;
    font-size: 0.9375rem;
    color: var(--ink-2);
  }
  .donehead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: 0;
    background: none;
    padding: 6px 0;
    color: var(--ink);
    text-align: left;
  }
</style>
