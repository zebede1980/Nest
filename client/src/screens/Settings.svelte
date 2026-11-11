<script lang="ts">
  import CodeCard from '../components/CodeCard.svelte';
  import Icon from '../components/Icon.svelte';
  import InstallGuide from '../components/InstallGuide.svelte';
  import { del, get, post, put } from '../lib/api';
  import { app, loadMe, refresh, showError, toast } from '../lib/state.svelte';
  import { disablePush, enablePush, isIOS, preloadKey, pushState, type PushState } from '../lib/push';
  import { back, navigate } from '../lib/router.svelte';
  import { getLook, setLook, timeAgo, type Look } from '../lib/look';
  import type { RemindChoice, UserSettings } from '../../../shared/model';

  interface Device {
    id: number;
    label: string | null;
    host: string;
    seenAt: number;
    lastOkAt: number | null;
    lastError: string | null;
  }
  interface Delivery {
    devices: number;
    delivered: number;
    error: string | null;
  }

  let push = $state<PushState | null>(null);
  let devices = $state<Device[]>([]);
  let busy = $state(false);
  let s = $state<UserSettings>({ ...app.me!.settings });
  let name = $state(app.me!.displayName);
  let look = $state<Look>(getLook());
  const isAdmin = app.me?.role === 'admin';

  async function refreshPush() {
    push = await pushState();
    devices = (await get<{ devices: Device[] }>('/api/push/devices')).devices;
  }
  void refreshPush().catch(showError);
  void preloadKey().catch(() => {});

  // Straight from the tap, or iOS won't show its permission prompt.
  async function turnOn() {
    busy = true;
    try {
      push = await enablePush();
      if (push === 'on') toast('🔔 Notifications are on');
      else if (push === 'denied') toast('Notifications were blocked', { kind: 'error' });
      await refreshPush();
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  }

  async function turnOff() {
    await disablePush();
    toast('Notifications off on this device', { kind: 'info' });
    await refreshPush();
  }

  async function test() {
    busy = true;
    try {
      const r = await post<{ sent: Delivery }>('/api/push/test');
      if (!r.sent.devices) toast('No devices have notifications on yet', { kind: 'error' });
      else if (r.sent.delivered) toast(`Sent to ${r.sent.delivered} device${r.sent.delivered === 1 ? '' : 's'} — lock your phone and watch`);
      else toast(`Couldn't deliver: ${r.sent.error}`, { kind: 'error', ms: 8000 });
      await refreshPush();
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  }

  async function forget(d: Device) {
    await del(`/api/push/devices/${d.id}`).catch(showError);
    await refreshPush();
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await put('/api/me/settings', { ...s, ...(name.trim() ? { displayName: name.trim() } : {}) });
        await loadMe();
        await refresh();
        toast('Saved', { kind: 'info', ms: 1500 });
      } catch (err) {
        showError(err);
      }
    }, 500);
  }
  const REMIND: { value: RemindChoice; label: string }[] = [
    { value: 'mine', label: 'My jobs' },
    { value: 'all', label: 'Every job' },
    { value: 'off', label: 'None' },
  ];

  let pw = $state('');
  async function setPassword(e: SubmitEvent) {
    e.preventDefault();
    try {
      await post('/api/me/password', { password: pw });
      pw = '';
      await loadMe();
      toast('Password saved. Other devices were signed out.');
    } catch (err) {
      showError(err);
    }
  }

  async function signOut() {
    await post('/api/logout').catch(() => {});
    app.me = null;
    app.house = null;
    navigate('/', { replace: true });
  }

  // ── The shared Google calendar ──
  interface Cal {
    connected: boolean;
    calendarId: string | null;
    clientEmail: string | null;
    events: number;
    lastSyncAt: number | null;
    error: string | null;
  }
  let cal = $state<Cal | null>(null);
  let calId = $state('');
  let calKey = $state('');
  let calBusy = $state(false);
  let calHelp = $state(false);
  void get<{ calendar: Cal }>('/api/calendar')
    .then((r) => (cal = r.calendar))
    .catch(() => {});

  async function calDo(run: () => Promise<{ calendar: Cal }>, done: (c: Cal) => string) {
    calBusy = true;
    try {
      cal = (await run()).calendar;
      if (cal.error) toast(cal.error, { kind: 'error', ms: 9000 });
      else toast(done(cal));
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      calBusy = false;
    }
  }
  function connect(e: SubmitEvent) {
    e.preventDefault();
    void calDo(
      () => put('/api/calendar', { key: calKey.trim(), calendarId: calId.trim() }),
      (c) => `Connected. ${c.events} date${c.events === 1 ? '' : 's'} in the calendar.`,
    ).then(() => {
      if (cal?.connected) calKey = '';
    });
  }
  async function keyFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) calKey = await f.text();
  }

  // ── People (admin) ──
  interface Person {
    id: number;
    username: string;
    displayName: string;
    role: string;
    lastLoginAt: number | null;
    disabled: boolean;
  }
  let people = $state<Person[]>([]);
  let newName = $state('');
  let link = $state<{ url: string; who: string } | null>(null);
  async function loadPeople() {
    if (isAdmin) people = (await get<{ users: Person[] }>('/api/users')).users;
  }
  void loadPeople().catch(() => {});
  async function addPerson(e: SubmitEvent) {
    e.preventDefault();
    const who = newName.trim();
    if (!who) return;
    try {
      const r = await post<{ url: string }>('/api/users', { username: who.toLowerCase().replace(/[^a-z0-9]+/g, ''), displayName: who });
      link = { url: r.url, who };
      newName = '';
      await loadPeople();
      await refresh();
    } catch (err) {
      showError(err);
    }
  }
  async function makeLink(p: Person) {
    try {
      link = { url: (await post<{ url: string }>(`/api/users/${p.id}/link`)).url, who: p.displayName };
    } catch (err) {
      showError(err);
    }
  }
  async function shareLink() {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: 'Nest', text: `${link.who}, here’s your way into Nest`, url: link.url });
      else {
        await navigator.clipboard.writeText(link.url);
        toast('Link copied');
      }
    } catch {
      /* cancelled */
    }
  }

  const STATUS: Record<PushState, string> = {
    unsupported: 'This browser can’t do notifications.',
    'needs-install': 'On iPhone, reminders only work from the Home Screen app.',
    default: 'Not turned on yet on this device.',
    denied: 'Blocked. Turn them back on in iPhone Settings → Notifications → Nest.',
    off: 'Allowed, but this device isn’t signed up for them.',
    on: 'On for this device.',
  };
</script>

<div class="page">
  <div class="head">
    <button class="round" onclick={() => back('/more')} aria-label="Back"><Icon name="back" /></button>
    <h1>Settings</h1>
  </div>

  <section class="section">
    <div class="section-head"><h2>Reminders</h2></div>
    <div class="card">
      {#if push}
        <div class="pstate {push}"><span class="dot"></span>{STATUS[push]}</div>
        {#if push === 'needs-install'}
          <InstallGuide />
        {:else if push === 'default' || push === 'off'}
          <button class="btn primary big block" onclick={turnOn} disabled={busy}><Icon name="bell" size={20} />Turn on notifications</button>
        {:else if push === 'on'}
          <div class="row">
            <button class="btn sage grow" onclick={test} disabled={busy}>Send a test</button>
            <button class="btn" onclick={turnOff}>Turn off here</button>
          </div>
        {/if}
      {/if}
      {#if devices.length}
        <div class="label">Devices that get reminders</div>
        {#each devices as d (d.id)}
          <div class="row between">
            <div class="grow">
              <b>{d.label ?? 'Device'}</b>
              <div class="small muted">{d.lastOkAt ? `last delivered ${timeAgo(d.lastOkAt)}` : 'nothing delivered yet'} · opened {timeAgo(d.seenAt)}</div>
              {#if d.lastError}<div class="err small">{d.lastError}</div>{/if}
            </div>
            <button class="btn small" onclick={() => forget(d)}>Remove</button>
          </div>
        {/each}
      {/if}
    </div>

    <div class="card">
      <div class="stack">
        <div class="label">Remind me about</div>
        <div class="seg">
          {#each REMIND as r (r.value)}
            <button class:on={s.remind === r.value} onclick={() => ((s.remind = r.value), saveSoon())}>{r.label}</button>
          {/each}
        </div>
        <p class="small muted">
          {#if s.remind === 'mine'}Jobs given to you, and ones nobody has claimed.{:else if s.remind === 'all'}Every job with a date, whoever it belongs to.{:else}No reminders about dates.{/if}
          One round-up a day: shortly before a date, on the day, then the odd nudge if it slips.
        </p>
      </div>
      {#if s.remind !== 'off'}
        <label class="field">Time of day <input type="time" bind:value={s.remindAt} onchange={saveSoon} /></label>
      {/if}
      <div class="toggle-row">
        <div><b>Heads-up</b><div class="small muted">Tell me when someone else ticks a job off, or gives me one.</div></div>
        <button class="switch" class:on={s.headsUp} onclick={() => ((s.headsUp = !s.headsUp), saveSoon())} aria-label="Heads-up" aria-pressed={s.headsUp}></button>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Shared calendar</h2></div>
    <div class="card">
      {#if !cal}
        <p class="small muted">Checking…</p>
      {:else if cal.connected}
        <div class="pstate {cal.error ? 'denied' : 'on'}"><span class="dot"></span>{cal.error ? 'Connected, but the last update failed.' : 'Dates go into your Google calendar.'}</div>
        {#if cal.error}<p class="err small">{cal.error}</p>{/if}
        <p class="small muted">
          {cal.events} date{cal.events === 1 ? '' : 's'} in the calendar{cal.lastSyncAt ? ` · updated ${timeAgo(cal.lastSyncAt)}` : ''}.
          Jobs and steps with a date show up as all-day events, and disappear when they’re done.
        </p>
        <div class="row">
          <button class="btn sage grow" disabled={calBusy} onclick={() => calDo(() => post('/api/calendar/sync'), () => 'Calendar is up to date')}>{calBusy ? 'Updating…' : 'Update now'}</button>
          {#if isAdmin}<button class="btn" disabled={calBusy} onclick={() => calDo(() => del('/api/calendar'), () => 'Calendar disconnected')}>Disconnect</button>{/if}
        </div>
      {:else if isAdmin}
        <p class="small muted">Put every job and step that has a date into the Google calendar you share, so they sit alongside everything else.</p>
        <button class="link" onclick={() => (calHelp = !calHelp)} aria-expanded={calHelp}>{calHelp ? 'Hide the steps' : 'How to set it up (10 minutes, once)'}</button>
        {#if calHelp}
          <ol class="help small">
            <li>At <b>console.cloud.google.com</b>, make a project (any name) and switch on the <b>Google Calendar API</b>.</li>
            <li>Under <b>IAM &amp; Admin → Service accounts</b>, create a service account. Open it, then <b>Keys → Add key → JSON</b>. A file downloads.</li>
            <li>In Google Calendar, open your shared calendar’s <b>Settings and sharing</b>. Under <b>Share with specific people</b>, add the service account’s email (it ends <i>iam.gserviceaccount.com</i>) with <b>Make changes to events</b>.</li>
            <li>On the same page, copy the <b>Calendar ID</b> from <b>Integrate calendar</b>.</li>
            <li>Paste the ID and choose the key file below.</li>
          </ol>
        {/if}
        <form class="stack" onsubmit={connect}>
          <label class="field">Calendar ID <input bind:value={calId} placeholder="…@group.calendar.google.com" autocapitalize="none" autocorrect="off" spellcheck="false" /></label>
          <label class="field">Key file (JSON)
            <input type="file" accept=".json,application/json" onchange={keyFile} />
          </label>
          {#if calKey}<p class="small muted">Key loaded ✓</p>{/if}
          {#if cal.error}<p class="err small">{cal.error}</p>{/if}
          <button class="btn primary block" disabled={calBusy || !calId.trim() || !calKey.trim()}>{calBusy ? 'Connecting…' : 'Connect calendar'}</button>
        </form>
      {:else}
        <p class="small muted">Not connected yet. {app.house?.people[0]?.displayName ?? 'The admin'} can connect your shared Google calendar from their Settings.</p>
      {/if}
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>How it looks</h2></div>
    <div class="card">
      <div class="seg">
        {#each [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match phone']] as [value, label] (value)}
          <button class:on={look === value} onclick={() => ((look = value as Look), setLook(look))}>{label}</button>
        {/each}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Sign in another device</h2></div>
    <div class="card">
      <p class="small muted">{isIOS() ? 'For the Home Screen app, an iPad or a computer:' : 'For your phone’s Home Screen app or another computer:'} make a code here and type it into “I have a code” there.</p>
      <CodeCard />
    </div>
  </section>

  {#if isAdmin}
    <section class="section">
      <div class="section-head"><h2>Who’s in the house</h2></div>
      <div class="card">
        {#each people as p (p.id)}
          <div class="row between">
            <div class="grow">
              <b>{p.displayName}</b> <span class="faint small">{p.role === 'admin' ? 'runs Nest' : ''}</span>
              <div class="small muted">{p.lastLoginAt ? `signed in ${timeAgo(p.lastLoginAt)}` : 'hasn’t signed in yet'}</div>
            </div>
            <button class="btn small" onclick={() => makeLink(p)}>Sign-in link</button>
          </div>
        {/each}
        <form class="row" onsubmit={addPerson}>
          <input class="input" bind:value={newName} placeholder="Add someone by name" maxlength="40" autocapitalize="words" />
          <button class="btn dark" disabled={!newName.trim()}>Add</button>
        </form>
        {#if link}
          <div class="linkbox">
            <div class="small muted">{link.who}’s way in. It works once, within 7 days; send it however you like.</div>
            <code>{link.url}</code>
            <button class="btn sage small" onclick={shareLink}><Icon name="share" size={16} />Share link</button>
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <section class="section">
    <div class="section-head"><h2>You</h2></div>
    <div class="card">
      <label class="field">Your name <input bind:value={name} maxlength="40" oninput={saveSoon} autocapitalize="words" /></label>
      <form class="stack" onsubmit={setPassword}>
        <label class="field">{app.me?.hasPassword ? 'Change password' : 'Set a password (optional)'}
          <span class="row">
            <input class="grow" type="password" bind:value={pw} placeholder="At least 6 characters" minlength="6" autocomplete="new-password" required />
            <button class="btn">Save</button>
          </span>
        </label>
      </form>
      <button class="btn danger block" onclick={signOut}>Sign out</button>
    </div>
  </section>
  <p class="faint small center">Nest {__APP_VERSION__}</p>
</div>

<style>
  .head {
    justify-content: flex-start;
    gap: 12px;
  }
  p {
    margin: 0;
  }
  .pstate {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
  }
  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 5px;
    background: var(--faint);
  }
  .pstate.on .dot {
    background: var(--sage);
  }
  .pstate.denied .dot,
  .pstate.default .dot,
  .pstate.off .dot,
  .pstate.needs-install .dot {
    background: var(--accent);
  }
  .help {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 8px;
    color: var(--ink-2);
  }
  .linkbox {
    display: grid;
    gap: 10px;
    justify-items: start;
    padding: 14px;
    border-radius: 16px;
    background: var(--warm-bg);
  }
  .linkbox code {
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
    -webkit-user-select: all;
    user-select: all;
  }
  input[type='file'] {
    padding: 10px;
    font-size: 0.875rem;
  }
</style>
