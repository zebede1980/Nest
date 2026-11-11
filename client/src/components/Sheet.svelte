<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  // A panel that slides up from the bottom on a phone and sits in the middle on a big screen.
  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();

  $effect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
  <div class="grab" aria-hidden="true"></div>
  <header>
    <h2>{title}</h2>
    <button class="x" onclick={onclose} aria-label="Close"><Icon name="close" size={18} /></button>
  </header>
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 50;
    animation: fade 0.2s;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .sheet {
    position: fixed;
    z-index: 51;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 92dvh;
    display: flex;
    flex-direction: column;
    background: var(--card);
    border-radius: 28px 28px 0 0;
    box-shadow: var(--shadow-pop);
    animation: up 0.32s var(--ease);
  }
  .grab {
    width: 40px;
    height: 5px;
    margin: 8px auto 0;
    border-radius: 3px;
    background: var(--line);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px 6px 20px;
  }
  header h2 {
    font-size: 1.35rem;
    min-width: 0;
  }
  .x {
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
  .body {
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 20px calc(24px + env(safe-area-inset-bottom));
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  @media (min-width: 760px) {
    .sheet {
      left: 50%;
      right: auto;
      bottom: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(560px, 92vw);
      border-radius: 28px;
      animation: none;
    }
    .grab {
      display: none;
    }
  }
  @keyframes up {
    from {
      transform: translateY(100%);
    }
  }
</style>
