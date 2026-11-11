<script lang="ts">
  import JobSheet from './components/JobSheet.svelte';
  import TabBar from './components/TabBar.svelte';
  import Toast from './components/Toast.svelte';
  import Home from './screens/Home.svelte';
  import Ideas from './screens/Ideas.svelte';
  import JobPage from './screens/JobPage.svelte';
  import Jobs from './screens/Jobs.svelte';
  import Login from './screens/Login.svelte';
  import More from './screens/More.svelte';
  import Notes from './screens/Notes.svelte';
  import Progress from './screens/Progress.svelte';
  import RoomPage from './screens/RoomPage.svelte';
  import Rooms from './screens/Rooms.svelte';
  import Settings from './screens/Settings.svelte';
  import Shopping from './screens/Shopping.svelte';
  import TradePage from './screens/TradePage.svelte';
  import Trades from './screens/Trades.svelte';
  import Welcome from './screens/Welcome.svelte';
  import { app, loadMe, noteOpenedFromPush, refresh, showError } from './lib/state.svelte';
  import { param, route } from './lib/router.svelte';
  import { registerServiceWorker, syncPush } from './lib/push';

  let loadError = $state('');

  async function start() {
    try {
      await loadMe();
    } catch (err) {
      loadError = (err as Error).message;
    }
  }
  void start();
  void registerServiceWorker();

  // Signed in → fetch the house and refresh this device's push subscription.
  $effect(() => {
    if (app.me && !app.house) {
      refresh().catch((err) => {
        showError(err);
        if (!app.house) loadError = (err as Error).message;
      });
      void syncPush();
    }
  });

  $effect(() => {
    if (app.me) noteOpenedFromPush(route.query);
  });

  // Back to the app (unlocked, switched to) → see what the other one has been up to.
  // Also when the signal comes back.
  function wake() {
    if (document.visibilityState === 'visible' && app.me) {
      refresh().catch(() => {});
      void syncPush();
    }
  }
  // And every minute while it's open: two people share this list.
  $effect(() => {
    if (!app.me) return;
    const t = setInterval(() => document.visibilityState === 'visible' && !app.jobSheet && refresh().catch(() => {}), 60_000);
    return () => clearInterval(t);
  });

  const jobId = $derived(param('/job/:id'));
  const roomId = $derived(param('/room/:id'));
  const tradeId = $derived(param('/trade/:id'));
  const bare = $derived(jobId != null || route.path === '/welcome');
</script>

<svelte:document onvisibilitychange={wake} />
<svelte:window ononline={wake} />

{#if loadError}
  <div class="page bare">
    <div class="empty">
      <div class="big" aria-hidden="true">🔌</div>
      <p>{loadError}</p>
      <button class="btn primary" onclick={() => location.reload()}>Try again</button>
    </div>
  </div>
{:else if !app.loaded}
  <div class="splash" aria-label="Loading"></div>
{:else if !app.me}
  <Login />
{:else if !app.house}
  <div class="splash" aria-label="Loading"><span></span></div>
{:else}
  {#key route.path}
    {#if route.path === '/welcome'}
      <Welcome />
    {:else if jobId != null}
      <JobPage id={jobId} />
    {:else if roomId != null}
      <RoomPage id={roomId} />
    {:else if tradeId != null}
      <TradePage id={tradeId} />
    {:else if route.path === '/jobs'}
      <Jobs />
    {:else if route.path === '/rooms'}
      <Rooms />
    {:else if route.path === '/shopping'}
      <Shopping />
    {:else if route.path === '/progress'}
      <Progress />
    {:else if route.path === '/more'}
      <More />
    {:else if route.path === '/ideas'}
      <Ideas />
    {:else if route.path === '/notes'}
      <Notes />
    {:else if route.path === '/trades'}
      <Trades />
    {:else if route.path === '/settings'}
      <Settings />
    {:else}
      <Home />
    {/if}
  {/key}
  {#if !bare}<TabBar />{/if}
  {#if app.jobSheet}<JobSheet />{/if}
{/if}
<Toast />

<style>
  .splash {
    min-height: 100dvh;
    display: grid;
    place-items: center;
  }
  .splash span {
    width: 28px;
    height: 28px;
    border-radius: 14px;
    border: 3px solid var(--track);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
