<script lang="ts">
  // Shown to a global admin who's looking after someone else's house, so it's never a
  // surprise whose list they're changing. One tap takes them home.
  import { post } from '../lib/api';
  import { navigate } from '../lib/router.svelte';
  import { app, refresh, showError } from '../lib/state.svelte';

  let busy = $state(false);

  async function home() {
    busy = true;
    try {
      await post('/api/houses/view', { houseId: null });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    document.documentElement.classList.add('visiting');
    return () => document.documentElement.classList.remove('visiting');
  });
</script>

<div class="visit" role="status">
  <span class="grow">Looking after <b>{app.house?.name}</b></span>
  <button class="btn small" disabled={busy} onclick={home}>Back to mine</button>
</div>

<style>
  .visit {
    position: fixed;
    z-index: 40;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: calc(8px + env(safe-area-inset-top)) 16px 8px;
    background: var(--accent);
    color: #fff;
    font-size: 0.9rem;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.12);
  }
  .grow {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btn {
    flex: none;
  }
</style>
