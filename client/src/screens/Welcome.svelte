<script lang="ts">
  import InstallGuide from '../components/InstallGuide.svelte';
  import { app } from '../lib/state.svelte';
  import { isIOS, isStandalone } from '../lib/push';
  import { navigate } from '../lib/router.svelte';

  // Where a sign-in link lands. On an iPhone in Safari, that's the moment to get the
  // app onto the Home Screen; anywhere else there's nothing to explain.
  const show = isIOS() && !isStandalone();
  if (!show) navigate('/', { replace: true });
</script>

{#if show}
  <div class="page bare">
    <div class="hello">
      <h1>Hi {app.me?.displayName} 👋</h1>
      <p class="muted">You’re in. One more thing makes Nest feel like a proper app, and lets it send reminders.</p>
    </div>
    <div class="card">
      <h3>Put it on your Home Screen</h3>
      <InstallGuide />
    </div>
    <button class="btn block" onclick={() => navigate('/', { replace: true })}>Carry on in Safari for now</button>
  </div>
{/if}

<style>
  .hello {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 12px;
  }
  p {
    margin: 0;
  }
</style>
