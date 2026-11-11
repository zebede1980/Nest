<script lang="ts">
  import { app } from '../lib/state.svelte';

  async function undo() {
    const u = app.toast?.undo;
    app.toast = null;
    await u?.();
  }
</script>

{#if app.toast}
  {#key app.toast.id}
    <div class="toast {app.toast.kind}" role="status" aria-live="polite">
      <span class="msg">{app.toast.text}</span>
      {#if app.toast.undo}
        <button class="undo" onclick={undo}>Undo</button>
      {/if}
    </div>
  {/key}
{/if}

<style>
  .toast {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: calc(var(--tabbar-h) + 22px + env(safe-area-inset-bottom));
    z-index: 70;
    max-width: 520px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 18px;
    min-height: 54px;
    border-radius: 27px;
    background: var(--dark);
    color: var(--on-dark);
    box-shadow: 0 10px 30px rgba(40, 25, 10, 0.3);
    font-weight: 500;
    font-size: 0.9375rem;
    animation: toast-in 0.3s var(--ease);
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
  :global([data-theme='dark']) .toast.error {
    color: #2a0f08;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
  }
  .msg {
    flex: 1;
    min-width: 0;
  }
  .undo {
    flex: none;
    min-height: 38px;
    padding: 0 16px;
    border-radius: 19px;
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
</style>
