<script lang="ts">
  import { post } from '../lib/api';
  import { app, loadMe } from '../lib/state.svelte';
  import { isStandalone } from '../lib/push';

  // The Home Screen app has its own sign-in, so it starts on "I have a code".
  let mode = $state<'code' | 'password'>(isStandalone() ? 'code' : 'password');
  let code = $state('');
  let username = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  function typeCode(e: Event) {
    const raw = (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    code = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      if (mode === 'code') await post('/api/login/code', { code });
      else await post('/api/login', { username, password });
      await loadMe();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="page bare login">
  <div class="brand">
    <img src="/icon.svg" alt="" width="84" height="84" />
    <h1>{app.appName}</h1>
    <p class="muted">The jobs around our home, and how far we’ve come.</p>
  </div>

  <div class="card">
    <div class="seg">
      <button type="button" class:on={mode === 'code'} onclick={() => ((mode = 'code'), (error = ''))}>I have a code</button>
      <button type="button" class:on={mode === 'password'} onclick={() => ((mode = 'password'), (error = ''))}>Password</button>
    </div>
    <form class="stack" onsubmit={submit}>
      {#if mode === 'code'}
        <label class="field">Sign-in code
          <input class="codein" value={code} oninput={typeCode} placeholder="ABCD-2345" autocomplete="one-time-code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="9" />
        </label>
        <p class="small muted">On a phone or computer that’s already signed in, open Settings → Sign in another device and type the code it shows.</p>
      {:else}
        <label class="field">Name <input bind:value={username} autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" /></label>
        <label class="field">Password <input type="password" bind:value={password} autocomplete="current-password" /></label>
      {/if}
      {#if error}<p class="err" role="alert">{error}</p>{/if}
      <button class="btn primary big block" disabled={busy || (mode === 'code' ? code.length < 9 : !username || !password)}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>
</div>

<style>
  .login {
    min-height: 100dvh;
    justify-content: center;
    padding-bottom: 40px;
    gap: 24px;
  }
  .brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }
  .brand img {
    border-radius: 22px;
    box-shadow: var(--shadow-card);
  }
  .brand h1 {
    font-size: 2.5rem;
  }
  .codein {
    font: 700 1.5rem/1.2 ui-monospace, 'SF Mono', Menlo, monospace;
    letter-spacing: 0.12em;
    text-align: center;
  }
  p {
    margin: 0;
  }
</style>
