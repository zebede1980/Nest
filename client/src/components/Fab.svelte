<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, type JobSheetState } from '../lib/state.svelte';

  // The round "add a job" button, bottom right.
  let { start = {}, label = 'Add a job' }: { start?: JobSheetState; label?: string } = $props();
</script>

<button class="fab" aria-label={label} onclick={() => (app.jobSheet = { ...start })}><Icon name="plus" size={26} stroke={2.4} /></button>

<style>
  .fab {
    position: fixed;
    right: max(20px, calc(50vw - 290px));
    bottom: calc(var(--tabbar-h) + 16px + env(safe-area-inset-bottom));
    z-index: 35;
    width: 58px;
    height: 58px;
    border-radius: 29px;
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
    display: grid;
    place-items: center;
    box-shadow: var(--shadow-fab);
    transition: transform 0.15s var(--ease);
  }
  .fab:active {
    transform: scale(0.93);
  }
</style>
