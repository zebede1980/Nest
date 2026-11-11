<script lang="ts">
  import Avatar from '../components/Avatar.svelte';
  import Check from '../components/Check.svelte';
  import CostSheet from '../components/CostSheet.svelte';
  import Icon from '../components/Icon.svelte';
  import PhotoStrip from '../components/PhotoStrip.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { del, post, put } from '../lib/api';
  import { act, app, toggleJob, toggleStep } from '../lib/state.svelte';
  import { COST_WORDS, costState, costTone, jobOf, jobPhotos, personOf, receipts, roomOf, stepsDone } from '../lib/house';
  import { dueWords, focusNow, penceText } from '../lib/look';
  import { back, navigate } from '../lib/router.svelte';
  import { localDate, niceDate } from '../../../shared/dates';
  import { SIZE_LONG, isRepeating, jobSpent, jobTotal, money, parseMoney, repeatWords, type Cost, type Step } from '../../../shared/model';

  let { id }: { id: number } = $props();
  const h = $derived(app.house!);
  const job = $derived(jobOf(h, id));
  const room = $derived(job ? roomOf(h, job.roomId) : undefined);
  const who = $derived(job ? personOf(h, job.assigneeId) : undefined);
  const due = $derived(job?.dueDate && job.status !== 'done' ? dueWords(job.dueDate, h.today) : null);
  const tz = $derived(app.me?.settings.tz ?? 'Europe/London');
  const day = (ms: number) => niceDate(localDate(ms, tz), h.today);

  let menu = $state(false);
  let wantSteps = $state(false);
  let newStep = $state('');
  let editStep = $state<Step | null>(null);
  let stepTitle = $state('');
  let stepDue = $state('');
  let costSheet = $state<{ cost: Cost | null } | null>(null);

  function edit() {
    menu = false;
    if (job) app.jobSheet = { job };
  }

  async function bin() {
    menu = false;
    if (!job) return;
    const jobId = job.id;
    back('/jobs');
    await act(() => del(`/api/jobs/${jobId}`), 'Job binned', () => post(`/api/jobs/${jobId}/restore`));
  }

  // ── Steps ──
  async function addStep(e: SubmitEvent) {
    e.preventDefault();
    const title = newStep.trim();
    if (!title || !job) return;
    newStep = '';
    await act(() => post(`/api/jobs/${job.id}/steps`, { title }));
  }
  function openStep(s: Step) {
    editStep = s;
    stepTitle = s.title;
    stepDue = s.dueDate ?? '';
  }
  async function saveStep(e: SubmitEvent) {
    e.preventDefault();
    const s = editStep;
    if (!s || !stepTitle.trim()) return;
    editStep = null;
    await act(() => put(`/api/steps/${s.id}`, { title: stepTitle.trim(), dueDate: stepDue || null }));
  }
  async function removeStep() {
    const s = editStep;
    if (!s) return;
    editStep = null;
    await act(() => del(`/api/steps/${s.id}`), 'Step removed');
  }
  async function moveStep(by: number) {
    const s = editStep;
    if (!s || !job) return;
    const ids = job.steps.map((x) => x.id);
    const i = ids.indexOf(s.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await act(() => post(`/api/jobs/${job.id}/steps/order`, { ids }));
  }

  // ── The one simple cost ──
  let rough = $state('');
  let roughFor = -1;
  $effect(() => {
    // Filled in from the job once, so typing isn't trampled by a refresh.
    if (job && roughFor !== job.id) {
      roughFor = job.id;
      rough = penceText(job.simpleCost);
    }
  });
  async function saveRough() {
    if (!job) return;
    const pence = rough.trim() ? parseMoney(rough) : null;
    if (rough.trim() && pence == null) return void (rough = penceText(job.simpleCost));
    if (pence === job.simpleCost) return;
    await act(() => put(`/api/jobs/${job.id}`, { simpleCost: pence }));
  }

  // ── Notes: saved when you tap away, and when you leave the page ──
  let notes = $state('');
  let notesFor = -1;
  let savedNotes = '';
  $effect(() => {
    if (job && notesFor !== job.id) {
      notesFor = job.id;
      notes = savedNotes = job.notes ?? '';
    }
  });
  function saveNotes() {
    if (notesFor < 0 || notes === savedNotes) return;
    const text = notes;
    savedNotes = text;
    void act(() => put(`/api/jobs/${notesFor}`, { notes: text.trim() || null }));
  }
  $effect(() => () => saveNotes());

  async function makeJob() {
    if (!job) return;
    if (job.roomId == null) app.jobSheet = { job, idea: false };
    else await act(() => put(`/api/jobs/${job.id}`, { status: 'todo' }), 'It’s a job now');
  }
</script>

{#if !job}
  <div class="page bare">
    <div class="head"><button class="round" onclick={() => back('/jobs')} aria-label="Back"><Icon name="back" /></button></div>
    <div class="empty"><div class="big" aria-hidden="true">🧹</div><p>That job isn’t here any more.</p></div>
  </div>
{:else}
  {@const photos = jobPhotos(h, job.id)}
  {@const total = jobTotal(job)}
  {@const spent = jobSpent(job, h.payments)}
  <div class="page bare">
    <div class="head">
      <button class="round" onclick={() => back('/jobs')} aria-label="Back"><Icon name="back" /></button>
      <button class="round" onclick={() => (menu = true)} aria-label="More"><Icon name="dots" /></button>
    </div>

    <div class="titleblock">
      <div class="row wrap">
        {#if room}<button class="pill tinted tint-{room.tint}" onclick={() => navigate(`/room/${room.id}`)}>{room.name}</button>{/if}
        {#if job.status === 'idea'}<span class="pill warm"><Icon name="idea" size={14} />Idea</span>{/if}
        {#if job.status === 'done'}<span class="pill sage"><Icon name="check" size={14} />Done{job.doneAt ? ` ${day(job.doneAt)}` : ''}</span>{/if}
      </div>
      <h1 class:struck={job.status === 'done'}>{job.title}</h1>
    </div>

    <div class="row wrap pills">
      <button class="pill sage" onclick={edit}><Icon name={job.size} size={14} />{SIZE_LONG[job.size]}</button>
      {#if job.status !== 'done'}
        {#if due}
          <button class="pill {due.tone === 'warm' ? 'warm' : ''}" onclick={edit}><Icon name="calendar" size={14} />Due {due.label === 'Today' || due.label === 'Tomorrow' || due.label === 'Yesterday' ? due.label.toLowerCase() : due.label}</button>
        {:else}
          <button class="pill line" onclick={edit}><Icon name="calendar" size={14} />Add a date</button>
        {/if}
      {/if}
      <button class="pill" onclick={edit}>
        {#if who}<Avatar id={who.id} size={20} />{who.displayName}{:else}<Icon name="person" size={14} />{h.people.length === 2 ? 'Either of us' : 'Anyone'}{/if}
      </button>
      {#if isRepeating(job)}<button class="pill" onclick={edit}><Icon name="repeat" size={14} />{repeatWords(job.repeatEvery!, job.repeatUnit!)}</button>{/if}
    </div>

    <PhotoStrip {photos} target={{ job: job.id }} addLabel="Add a photo" />

    {#if job.steps.length || job.size === 'bigger' || wantSteps}
      <div class="card">
        <div class="card-head">
          <h3>Steps</h3>
          {#if job.steps.length}<span class="small muted">{stepsDone(job)} of {job.steps.length}</span>{/if}
        </div>
        {#each job.steps as s (s.id)}
          {@const sd = s.dueDate && !s.doneAt ? dueWords(s.dueDate, h.today) : null}
          <div class="step" class:done={!!s.doneAt}>
            <Check done={!!s.doneAt} size={22} label={s.title} onclick={() => toggleStep(s)} />
            <button class="steptitle" onclick={() => openStep(s)}>{s.title}</button>
            {#if sd}<span class="due {sd.tone}">{sd.label}</span>{/if}
          </div>
        {/each}
        <form class="addstep" onsubmit={addStep}>
          <span class="plus"><Icon name="plus" size={16} /></span>
          <input bind:value={newStep} placeholder={job.steps.length ? 'Add another step' : 'Break it into steps…'} maxlength="140" enterkeyhint="done" aria-label="Add a step" />
          {#if newStep.trim()}<button class="btn small dark">Add</button>{/if}
        </form>
      </div>
    {/if}

    <div class="card">
      <div class="card-head">
        <h3>Costs</h3>
        {#if total > 0}<span class="figure total">{money(total)}</span>{/if}
      </div>
      {#if !job.costs.length}
        <label class="field">Rough cost <span class="money"><input bind:value={rough} inputmode="decimal" placeholder="0" onblur={saveRough} onchange={saveRough} /></span></label>
        <div class="row wrap">
          <button class="btn small" onclick={() => (costSheet = { cost: null })}><Icon name="plus" size={15} />List what’s needed</button>
        </div>
      {:else}
        {#each job.costs as c (c.id)}
          {@const st = costState(c, h)}
          <button class="costline" onclick={() => (costSheet = { cost: c })}>
            <span class="grow">
              <span class="clabel">{c.label}</span>
              {#if c.kind === 'trade' ? h.trades.find((t) => t.id === c.tradeId) : c.shop}<span class="csub">{c.kind === 'trade' ? h.trades.find((t) => t.id === c.tradeId)?.name : c.shop}</span>{/if}
            </span>
            {#if receipts(h, c.id).length}<span class="rcpt" title="Has a receipt"><Icon name="receipt" size={15} /></span>{/if}
            <span class="tag {costTone(st)}">{COST_WORDS[st]}</span>
            <span class="amt">{c.amount ? money(c.amount) : '—'}</span>
          </button>
        {/each}
        <div class="row between">
          <span class="small muted">{money(spent)} spent so far</span>
          <button class="btn small" onclick={() => (costSheet = { cost: null })}><Icon name="plus" size={15} />Add</button>
        </div>
      {/if}
    </div>

    <div class="card">
      <h3>Notes</h3>
      <textarea class="input notes" bind:value={notes} onblur={saveNotes} maxlength="4000" placeholder="Measurements, which paint, what the plumber said…"></textarea>
    </div>

    {#if !job.steps.length && job.size !== 'bigger' && !wantSteps}
      <button class="link addsteps" onclick={() => (wantSteps = true)}><Icon name="plus" size={15} /> Break it into steps</button>
    {/if}

    <p class="small faint">
      Added {day(job.createdAt)}{personOf(h, job.createdBy) ? ` by ${personOf(h, job.createdBy)!.displayName}` : ''}{#if job.status === 'done' && job.doneAt}
        · done {day(job.doneAt)}{personOf(h, job.doneBy) ? ` by ${personOf(h, job.doneBy)!.displayName}` : ''}{/if}
    </p>
  </div>

  <div class="foot">
    {#if job.status === 'idea'}
      <button class="btn primary big block" onclick={makeJob}>Make it a job</button>
    {:else if job.status === 'todo'}
      <button class="btn dark big block" onclick={() => toggleJob(job)}><Icon name="check" size={20} stroke={2.4} />Mark job done</button>
    {:else}
      <button class="btn big block" onclick={() => toggleJob(job)}>Not done after all</button>
    {/if}
  </div>

  {#if menu}
    <Sheet title={job.title} onclose={() => (menu = false)}>
      <button class="btn block" onclick={edit}><Icon name="pencil" size={18} />Edit job</button>
      {#if job.status === 'todo'}
        <button class="btn block" onclick={() => ((menu = false), act(() => put(`/api/jobs/${job.id}`, { status: 'idea' }), 'Moved to Ideas', () => put(`/api/jobs/${job.id}`, { status: 'todo' })))}><Icon name="idea" size={18} />Move back to Ideas</button>
      {/if}
      <button class="btn danger block" onclick={bin}><Icon name="trash" size={18} />Delete job</button>
      <p class="small muted center">Deleted jobs can be brought back straight away with Undo.</p>
    </Sheet>
  {/if}

  {#if editStep}
    {@const i = job.steps.findIndex((s) => s.id === editStep!.id)}
    <Sheet title="Step" onclose={() => (editStep = null)}>
      <form class="stack" onsubmit={saveStep}>
        <label class="field">What <input bind:value={stepTitle} maxlength="140" /></label>
        <label class="field">Due (optional) <input type="date" bind:value={stepDue} /></label>
        {#if job.steps.length > 1}
          <div class="row">
            <button type="button" class="btn small grow" onclick={() => moveStep(-1)} disabled={i <= 0}><Icon name="up" size={16} />Move up</button>
            <button type="button" class="btn small grow" onclick={() => moveStep(1)} disabled={i < 0 || i >= job.steps.length - 1}><Icon name="down" size={16} />Move down</button>
          </div>
        {/if}
        <div class="row">
          <button type="button" class="btn danger" onclick={removeStep}>Remove</button>
          <button class="btn primary grow">Save</button>
        </div>
      </form>
    </Sheet>
  {/if}

  {#if costSheet}
    <CostSheet {job} cost={costSheet.cost} onclose={() => (costSheet = null)} />
  {/if}
{/if}

<style>
  .head {
    justify-content: space-between;
  }
  .titleblock {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h1 {
    font-size: 1.75rem;
    overflow-wrap: anywhere;
  }
  h1.struck {
    color: var(--muted);
  }
  .pills {
    gap: 8px;
  }
  .titleblock button.pill {
    min-height: 38px;
  }
  .pills .pill {
    min-height: 40px;
    box-shadow: var(--shadow-row);
  }
  .pills .pill.line {
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--muted);
  }
  .step {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding-left: 2px;
  }
  .steptitle {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    padding: 8px 0;
    text-align: left;
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }
  .step.done .steptitle {
    color: var(--faint);
    text-decoration: line-through;
  }
  .addstep {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-left: 2px;
  }
  .addstep .plus {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 11px;
    border: 1.5px dashed var(--dash);
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .addstep input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    border: 0;
    background: none;
    outline: none;
    font-size: 1rem;
    color: var(--ink);
  }
  .addstep input::placeholder {
    color: var(--faint);
  }
  .total {
    font-size: 1.25rem;
    color: var(--accent-ink);
  }
  .costline {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 4px 0;
    border: 0;
    background: none;
    text-align: left;
    font-size: 0.875rem;
    min-width: 0;
  }
  .costline .grow {
    display: flex;
    flex-direction: column;
  }
  .clabel {
    overflow-wrap: anywhere;
  }
  .csub {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .rcpt {
    color: var(--muted);
  }
  .amt {
    flex: none;
    min-width: 52px;
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .notes {
    min-height: 96px;
    font-size: 0.9375rem;
    color: var(--ink-2);
  }
  .addsteps {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
  }
</style>
