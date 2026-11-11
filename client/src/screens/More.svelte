<script lang="ts">
  import Avatar from '../components/Avatar.svelte';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import { app } from '../lib/state.svelte';
  import { ideas, moneyFor } from '../lib/house';
  import { back, navigate } from '../lib/router.svelte';
  import { money } from '../../../shared/model';

  const h = $derived(app.house!);
  const owed = $derived(moneyFor(h).owed);
  const links = $derived<{ path: string; icon: IconName; title: string; sub: string }[]>([
    { path: '/ideas', icon: 'idea', title: 'Ideas', sub: ideas(h).length ? `${ideas(h).length} for one day` : 'Wouldn’t it be nice if…' },
    { path: '/notes', icon: 'note', title: 'Notes', sub: h.notes.length ? `${h.notes.length} kept` : 'Wi-Fi code, bin day, the boiler’s quirks' },
    { path: '/trades', icon: 'trade', title: 'People we pay', sub: owed ? `${money(owed)} to pay` : 'Plumbers, sparkies, their numbers and bills' },
    { path: '/settings', icon: 'settings', title: 'Settings', sub: 'Reminders, calendar, who’s in the house' },
  ]);
</script>

<div class="page">
  <div class="head">
    <button class="round" onclick={() => back('/')} aria-label="Back"><Icon name="back" /></button>
  </div>
  <div class="who">
    <div class="row">
      {#each h.people as p (p.id)}<Avatar id={p.id} size={44} />{/each}
    </div>
    <h1>{h.people.map((p) => p.displayName).join(' & ')}</h1>
  </div>

  <div class="rows">
    {#each links as l (l.path)}
      <button class="linkrow" onclick={() => navigate(l.path)}>
        <span class="ic"><Icon name={l.icon} size={22} /></span>
        <span class="grow">
          <span class="t">{l.title}</span>
          <span class="small muted">{l.sub}</span>
        </span>
        <Icon name="next" size={18} />
      </button>
    {/each}
  </div>
</div>

<style>
  .who {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .linkrow {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 72px;
    padding: 10px 16px;
    border: 0;
    border-radius: 20px;
    background: var(--card);
    box-shadow: var(--shadow-row);
    text-align: left;
    color: var(--muted);
  }
  .ic {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: var(--warm-bg);
    color: var(--accent-ink);
    display: grid;
    place-items: center;
  }
  .grow {
    display: flex;
    flex-direction: column;
  }
  .t {
    font-weight: 600;
    color: var(--ink);
  }
</style>
