<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { personColour } from '../lib/house';

  let { id, size = 36 }: { id: number; size?: number } = $props();
  const person = $derived(app.house?.people.find((p) => p.id === id));
</script>

{#if person && app.house}
  <span class="avatar" style="--s:{size}px; background:{personColour(app.house, id)}" title={person.displayName}>{person.displayName.slice(0, 1).toUpperCase()}</span>
{/if}

<style>
  .avatar {
    flex: none;
    width: var(--s);
    height: var(--s);
    border-radius: 50%;
    display: inline-grid;
    place-items: center;
    color: #fff;
    font-weight: 600;
    font-size: calc(var(--s) * 0.42);
    border: 2px solid var(--page);
  }
</style>
