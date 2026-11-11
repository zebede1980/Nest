<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import { navigate, route } from '../lib/router.svelte';

  const tabs: { path: string; label: string; icon: IconName; also?: RegExp }[] = [
    { path: '/', label: 'Home', icon: 'home' },
    { path: '/jobs', label: 'Jobs', icon: 'jobs' },
    { path: '/rooms', label: 'Rooms', icon: 'rooms', also: /^\/room\// },
    { path: '/shopping', label: 'Shopping', icon: 'shopping' },
    { path: '/progress', label: 'Progress', icon: 'progress' },
  ];
</script>

<nav class="tabbar" aria-label="Main">
  {#each tabs as t (t.path)}
    {@const on = route.path === t.path || !!t.also?.test(route.path)}
    <button class:on onclick={() => navigate(t.path)} aria-current={on ? 'page' : undefined}>
      <Icon name={t.icon} size={23} stroke={on ? 2.2 : 1.9} />
      <span>{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    background: var(--card);
    border-top: 1px solid var(--line-soft);
  }
  button {
    border: 0;
    background: none;
    padding: 6px 0 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    color: var(--faint);
    font-size: 0.6875rem;
    font-weight: 600;
    min-width: 0;
  }
  button.on {
    color: var(--accent);
  }
  span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (min-width: 760px) {
    .tabbar {
      left: 50%;
      right: auto;
      transform: translateX(-50%);
      width: 620px;
      border: 1px solid var(--line-soft);
      border-bottom: 0;
      border-radius: 22px 22px 0 0;
    }
  }
</style>
