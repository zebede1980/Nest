<script lang="ts">
  import { slide } from 'svelte/transition';
  import Check from './Check.svelte';
  import Icon from './Icon.svelte';
  import { app, toggleJob } from '../lib/state.svelte';
  import { jobMeta, nextDate, personOf, roomOf } from '../lib/house';
  import { dueWords } from '../lib/look';
  import { navigate } from '../lib/router.svelte';
  import { localDate, niceDate } from '../../../shared/dates';
  import type { Job } from '../../../shared/model';

  // One job in a list: tick it off on the left, open it by tapping the rest.
  let { job, room = true }: { job: Job; room?: boolean } = $props();
  const h = $derived(app.house!);
  const date = $derived(job.status === 'todo' ? nextDate(job) : null);
  const due = $derived(date ? dueWords(date, h.today) : null);
  const meta = $derived.by(() => {
    if (job.status !== 'done') return jobMeta(h, job, { room });
    const bits: string[] = [];
    const r = room ? roomOf(h, job.roomId) : undefined;
    if (r) bits.push(r.name);
    if (job.doneAt) bits.push(`Done ${niceDate(localDate(job.doneAt, app.me?.settings.tz ?? 'Europe/London'), h.today)}`);
    const who = personOf(h, job.doneBy);
    if (who) bits.push(who.displayName);
    return bits.join(' · ');
  });
</script>

<div class="jobrow" class:done={job.status === 'done'} out:slide={{ duration: 220 }}>
  {#if job.status === 'idea'}
    <span class="bulb"><Icon name="idea" size={20} /></span>
  {:else}
    <Check done={job.status === 'done'} label={job.status === 'done' ? `Not done: ${job.title}` : `Done: ${job.title}`} onclick={() => toggleJob(job)} />
  {/if}
  <button class="main" onclick={() => navigate(`/job/${job.id}`)}>
    <span class="title">{job.title}</span>
    {#if meta}<span class="meta">{meta}</span>{/if}
  </button>
  {#if due}<span class="due {due.tone}">{due.label}</span>{/if}
</div>

<style>
  .jobrow {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 16px;
    min-height: 64px;
    border-radius: 18px;
    background: var(--card);
    box-shadow: var(--shadow-row);
    min-width: 0;
  }
  .bulb {
    flex: none;
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    color: var(--accent);
  }
  .main {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    padding: 8px 0;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 1px;
    -webkit-user-select: text;
    user-select: text;
  }
  .title {
    font-size: 0.9375rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta {
    font-size: 0.8125rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .done .title {
    color: var(--faint);
    text-decoration: line-through;
  }
</style>
