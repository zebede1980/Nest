<script lang="ts">
  import { post } from '../lib/api';
  import { showError } from '../lib/state.svelte';

  // Shows a short code for signing in on another device (or the Home Screen app).
  let code = $state<{ code: string; expiresAt: number } | null>(null);
  let left = $state(0);
  let busy = $state(false);

  async function make() {
    busy = true;
    try {
      code = await post<{ code: string; expiresAt: number }>('/api/me/code');
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (!code) return;
    const tick = () => {
      left = Math.max(0, Math.round((code!.expiresAt - Date.now()) / 1000));
      if (left === 0) code = null;
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  });
</script>

{#if code}
  <div class="code-box">
    <div class="code">{code.code}</div>
    <div class="small muted">Type it into “I have a code” on the other device · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</div>
  </div>
{:else}
  <button class="btn sage block" onclick={make} disabled={busy}>Get a sign-in code</button>
{/if}

<style>
  .code-box {
    display: grid;
    gap: 8px;
    justify-items: center;
    padding: 18px 14px;
    border-radius: 18px;
    background: var(--warm-bg);
    border: 1.5px dashed var(--dash);
    text-align: center;
  }
  .code {
    font: 700 2rem/1 ui-monospace, 'SF Mono', Menlo, monospace;
    letter-spacing: 0.12em;
    color: var(--accent-ink);
    -webkit-user-select: all;
    user-select: all;
  }
</style>
