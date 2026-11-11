<script lang="ts">
  // The round tick box on jobs, steps and things to buy.
  let { done, label, onclick, size = 24 }: { done: boolean; label: string; onclick: () => void; size?: number } = $props();
</script>

<button
  class="check"
  class:done
  style="--s:{size}px"
  role="checkbox"
  aria-checked={done}
  aria-label={label}
  onclick={(e) => {
    e.stopPropagation();
    onclick();
  }}
>
  <span>
    {#if done}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12.5l4 4 8-9" /></svg>
    {/if}
  </span>
</button>

<style>
  /* The button is bigger than the ring, so it's easy to hit with a thumb. */
  .check {
    flex: none;
    width: 44px;
    height: 44px;
    margin: -10px;
    padding: 0;
    border: 0;
    background: none;
    display: grid;
    place-items: center;
  }
  span {
    width: var(--s);
    height: var(--s);
    border-radius: 50%;
    border: 2px solid var(--ring);
    display: grid;
    place-items: center;
    color: #fff;
    transition:
      background 0.15s,
      border-color 0.15s;
  }
  .done span {
    background: var(--sage);
    border-color: var(--sage);
    animation: pop 0.3s var(--ease);
  }
  svg {
    width: 62%;
    height: 62%;
  }
  @keyframes pop {
    40% {
      transform: scale(1.25);
    }
  }
</style>
