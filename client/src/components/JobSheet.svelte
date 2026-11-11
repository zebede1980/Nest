<script lang="ts">
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { del, post, put } from '../lib/api';
  import { act, app } from '../lib/state.svelte';
  import { liveRooms, thisSaturday } from '../lib/house';
  import { focusNow, penceText } from '../lib/look';
  import { addDays, niceDate } from '../../../shared/dates';
  import { REPEAT_UNITS, SIZES, SIZE_LABEL, isRepeating, parseMoney, type Job, type RepeatUnit, type Size } from '../../../shared/model';

  // Add a job, or change one. Only the name and the room are needed; the rest is there
  // for when it's wanted.
  const start = app.jobSheet!;
  const editing = start.job;
  const h = $derived(app.house!);

  let title = $state(editing?.title ?? '');
  let roomId = $state<number | null>(editing ? editing.roomId : (start.roomId ?? null));
  let size = $state<Size>(editing?.size ?? start.size ?? 'evening');
  let idea = $state(start.idea ?? editing?.status === 'idea');
  let dueDate = $state(editing?.dueDate ?? '');
  let assigneeId = $state<number | null>(editing?.assigneeId ?? null);
  let cost = $state(penceText(editing?.simpleCost));
  let repeats = $state(editing ? isRepeating(editing) : false);
  let every = $state(editing?.repeatEvery ?? 6);
  let unit = $state<RepeatUnit>(editing?.repeatUnit ?? 'month');
  let more = $state(!!editing);
  let busy = $state(false);
  let error = $state('');
  let titleBox = $state<HTMLInputElement>();

  const rooms = $derived(h.rooms.filter((r) => !r.archived || r.id === roomId));
  const hasLines = !!editing?.costs.length;
  const quick = $derived([
    { label: 'Today', date: h.today },
    { label: 'Tomorrow', date: addDays(h.today, 1) },
    { label: 'Saturday', date: thisSaturday(addDays(h.today, 1)) },
    { label: 'In a week', date: addDays(h.today, 7) },
  ]);
  const UNIT_WORD: Record<RepeatUnit, string> = { week: 'weeks', month: 'months', year: 'years' };

  function close() {
    app.jobSheet = null;
  }

  async function save(another = false) {
    error = '';
    if (!title.trim()) return (error = 'Give it a name first.');
    if (!idea && roomId == null) return (error = 'Which room is it in?');
    const simpleCost = cost.trim() ? parseMoney(cost) : null;
    if (cost.trim() && simpleCost == null) return (error = "That cost doesn't look like an amount.");
    const n = Math.round(Number(every));
    if (repeats && !(n >= 1 && n <= 120)) return (error = 'How often does it come round?');
    const fields = {
      title: title.trim(),
      roomId,
      size,
      assigneeId,
      dueDate: dueDate || null,
      ...(hasLines ? {} : { simpleCost }),
      repeatEvery: repeats ? n : null,
      repeatUnit: repeats ? unit : null,
    };
    busy = true;
    try {
      if (editing) {
        const was = editing.status === 'idea';
        const status = was !== idea && editing.status !== 'done' ? { status: idea ? 'idea' : 'todo' } : {};
        const ok = await act(() => put(`/api/jobs/${editing.id}`, { ...fields, ...status }), was && !idea ? 'It’s a job now' : 'Saved');
        if (ok) close();
        return;
      }
      const where = liveRooms(h).find((r) => r.id === roomId)?.name;
      const ok = await act(
        () => post<{ job: Job }>('/api/jobs', { ...fields, status: idea ? 'idea' : 'todo' }),
        idea ? 'Idea saved' : where ? `Added to ${where}` : 'Added',
        (r) => del(`/api/jobs/${r.job.id}`),
      );
      if (!ok) return;
      if (another) {
        title = '';
        dueDate = '';
        cost = '';
        titleBox?.focus();
      } else close();
    } finally {
      busy = false;
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    void save();
  }
</script>

<Sheet title={editing ? 'Edit job' : idea ? 'New idea' : 'New job'} onclose={close}>
  <form class="stack" onsubmit={submit}>
    <input class="input title" bind:this={titleBox} bind:value={title} placeholder={idea ? 'Wouldn’t it be nice if…' : 'What needs doing?'} maxlength="140" enterkeyhint="done" aria-label="Job name" use:focusNow />

    <div class="group">
      <div class="label">Room{idea ? ' (if you know)' : ''}</div>
      <div class="chips">
        {#each rooms as r (r.id)}
          <button type="button" class="chip tint tint-{r.tint}" class:on={roomId === r.id} class:tinted={roomId === r.id} onclick={() => (roomId = roomId === r.id && idea ? null : r.id)} aria-pressed={roomId === r.id}>{r.name}</button>
        {/each}
      </div>
    </div>

    <div class="group">
      <div class="label">How big is it?</div>
      <div class="seg">
        {#each SIZES as s (s)}
          <button type="button" class:on={size === s} onclick={() => (size = s)} aria-pressed={size === s}><span class="segi"><Icon name={s} size={16} />{SIZE_LABEL[s]}</span></button>
        {/each}
      </div>
    </div>

    {#if !more}
      <button type="button" class="link more" onclick={() => (more = true)}>Date, who, cost and more <Icon name="down" size={16} /></button>
    {:else}
      <div class="group">
        <div class="label">Due</div>
        <div class="chips">
          {#each quick as q (q.label)}
            <button type="button" class="chip" class:on={dueDate === q.date} onclick={() => (dueDate = dueDate === q.date ? '' : q.date)}>{q.label}</button>
          {/each}
        </div>
        <div class="row">
          <input class="input" type="date" bind:value={dueDate} aria-label="Due date" />
          {#if dueDate}<button type="button" class="btn small ghost" onclick={() => (dueDate = '')}>No date</button>{/if}
        </div>
        {#if dueDate}<div class="small muted">{niceDate(dueDate, h.today)} — you’ll get a reminder beforehand and on the day.</div>{/if}
      </div>

      <div class="group">
        <div class="label">Who’s doing it?</div>
        <div class="chips">
          <button type="button" class="chip" class:on={assigneeId === null} onclick={() => (assigneeId = null)}>{h.people.length === 2 ? 'Either of us' : 'Anyone'}</button>
          {#each h.people as p (p.id)}
            <button type="button" class="chip" class:on={assigneeId === p.id} onclick={() => (assigneeId = p.id)}>{p.displayName}</button>
          {/each}
        </div>
      </div>

      {#if !hasLines}
        <label class="field">Rough cost <span class="money"><input bind:value={cost} inputmode="decimal" placeholder="0" /></span></label>
      {/if}

      <div class="group">
        <div class="toggle-row">
          <div><b>Comes round again</b><div class="small muted">Upkeep, like bleeding radiators or clearing gutters.</div></div>
          <button type="button" class="switch" class:on={repeats} onclick={() => (repeats = !repeats)} aria-label="Comes round again" aria-pressed={repeats}></button>
        </div>
        {#if repeats}
          <div class="row every">
            <span class="small muted">Every</span>
            <input class="input n" type="number" min="1" max="120" bind:value={every} inputmode="numeric" aria-label="How many" />
            <div class="seg grow">
              {#each REPEAT_UNITS as u (u)}
                <button type="button" class:on={unit === u} onclick={() => (unit = u)}>{UNIT_WORD[u]}</button>
              {/each}
            </div>
          </div>
          <div class="small muted">When it’s ticked off, the next one is added by itself.</div>
        {/if}
      </div>

      {#if editing?.status !== 'done'}
        <div class="toggle-row">
          <div><b>Just an idea for now</b><div class="small muted">Kept in Ideas, off the to-do list.</div></div>
          <button type="button" class="switch" class:on={idea} onclick={() => (idea = !idea)} aria-label="Just an idea" aria-pressed={idea}></button>
        </div>
      {/if}
    {/if}

    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="row actions">
      {#if !editing}<button type="button" class="btn" onclick={() => save(true)} disabled={busy}>Add &amp; another</button>{/if}
      <button class="btn primary grow" disabled={busy}>{editing ? 'Save' : idea ? 'Save idea' : 'Add job'}</button>
    </div>
  </form>
</Sheet>

<style>
  .title {
    font-size: 1.0625rem;
    font-weight: 500;
    min-height: 54px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stack {
    gap: 18px;
  }
  .chip {
    height: 38px;
    padding: 0 13px;
  }
  .chip.tinted {
    background: var(--tint);
    color: var(--tint-ink);
    box-shadow: inset 0 0 0 2px var(--tint-ink);
  }
  .segi {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
  }
  .every .n {
    width: 76px;
    flex: none;
    text-align: center;
  }
  .actions {
    position: sticky;
    bottom: 0;
    padding-top: 4px;
  }
</style>
