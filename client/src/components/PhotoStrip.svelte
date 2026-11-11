<script lang="ts">
  import Icon from './Icon.svelte';
  import { del, put } from '../lib/api';
  import { act, app, photoUrl, refresh, showError, thumbUrl } from '../lib/state.svelte';
  import { uploadPhoto, type PhotoTarget } from '../lib/photos';
  import { personOf } from '../lib/house';
  import { timeAgo } from '../lib/look';
  import type { Photo } from '../../../shared/model';

  // A row of photos with an "add" tile; tap one to see it big, caption it or remove it.
  let { photos, target, addLabel = 'Add' }: { photos: Photo[]; target: PhotoTarget; addLabel?: string } = $props();

  let sending = $state(0);
  let openId = $state<number | null>(null);
  let confirming = $state(false);
  const index = $derived(photos.findIndex((p) => p.id === openId));
  const open = $derived(index >= 0 ? photos[index] : null);

  async function add(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    sending = files.length;
    try {
      for (const f of files) {
        await uploadPhoto(f, target);
        sending--;
      }
    } catch (err) {
      showError(err);
    } finally {
      sending = 0;
      await refresh().catch(() => {});
    }
  }

  function show(id: number | null) {
    openId = id;
    confirming = false;
  }

  async function saveCaption(p: Photo, value: string) {
    const caption = value.trim() || null;
    if (caption === p.caption) return;
    await act(() => put(`/api/photos/${p.id}`, { caption }));
  }

  async function remove(p: Photo) {
    if (!confirming) {
      confirming = true;
      setTimeout(() => (confirming = false), 4000);
      return;
    }
    const next = photos[index + 1]?.id ?? photos[index - 1]?.id ?? null;
    await act(() => del(`/api/photos/${p.id}`), 'Photo removed');
    show(next);
  }

  $effect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (!open) return;
    if (e.key === 'Escape') show(null);
    if (e.key === 'ArrowRight' && photos[index + 1]) show(photos[index + 1].id);
    if (e.key === 'ArrowLeft' && photos[index - 1]) show(photos[index - 1].id);
  }}
/>

<div class="strip">
  {#each photos as p (p.id)}
    <button class="thumb" onclick={() => show(p.id)} aria-label={p.caption ? `Photo: ${p.caption}` : 'Photo'}>
      <img src={thumbUrl(p.id)} alt="" loading="lazy" />
      {#if p.caption}<span>{p.caption}</span>{/if}
    </button>
  {/each}
  <label class="add" class:wide={!photos.length} class:busy={sending > 0}>
    <Icon name="camera" size={20} />
    <span>{sending > 0 ? 'Sending…' : photos.length ? 'Add' : addLabel}</span>
    <input type="file" accept="image/*" multiple onchange={add} disabled={sending > 0} />
  </label>
</div>

{#if open}
  <div class="viewer" role="dialog" aria-modal="true" aria-label="Photo">
    <div class="bar">
      <button class="vbtn" onclick={() => show(null)} aria-label="Close"><Icon name="close" /></button>
      <span class="count">{index + 1} of {photos.length}</span>
      <button class="vbtn del" class:sure={confirming} onclick={() => remove(open)} aria-label="Delete photo">
        <Icon name="trash" />{#if confirming}<span>Tap again to delete</span>{/if}
      </button>
    </div>
    <div class="stage">
      {#key open.id}
        <img src={photoUrl(open.id)} alt={open.caption ?? ''} />
      {/key}
      {#if photos[index - 1]}<button class="nav prev" onclick={() => show(photos[index - 1].id)} aria-label="Previous photo"><Icon name="back" /></button>{/if}
      {#if photos[index + 1]}<button class="nav next" onclick={() => show(photos[index + 1].id)} aria-label="Next photo"><Icon name="next" /></button>{/if}
    </div>
    <div class="cap">
      {#key open.id}
        <input value={open.caption ?? ''} placeholder="Add a caption (Before, After, the paint tin…)" maxlength="80" enterkeyhint="done" onchange={(e) => saveCaption(open, (e.target as HTMLInputElement).value)} aria-label="Caption" />
      {/key}
      <div class="by">
        {personOf(app.house!, open.createdBy)?.displayName ?? 'Someone'} added this {timeAgo(open.createdAt)}
      </div>
    </div>
  </div>
{/if}

<style>
  .strip {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    margin: 0 -20px;
    padding: 2px 20px;
    scrollbar-width: none;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .thumb {
    position: relative;
    flex: none;
    width: 96px;
    height: 76px;
    border: 0;
    padding: 0;
    border-radius: 14px;
    overflow: hidden;
    background: var(--track);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb span {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 12px 6px 4px;
    font-size: 0.6875rem;
    font-weight: 600;
    color: #fff;
    text-align: left;
    background: linear-gradient(to top, rgba(30, 20, 10, 0.72), transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .add {
    position: relative;
    flex: none;
    width: 60px;
    height: 76px;
    border-radius: 14px;
    border: 1.5px dashed var(--dash);
    color: var(--muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    font-size: 0.6875rem;
    font-weight: 600;
    cursor: pointer;
    overflow: hidden;
  }
  .add.wide {
    width: auto;
    flex-direction: row;
    gap: 8px;
    height: 48px;
    padding: 0 16px;
    font-size: 0.8125rem;
  }
  .add.busy {
    opacity: 0.6;
  }
  /* The real file box covers the tile, see-through, so a tap opens the camera or library. */
  .add input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    font-size: 0;
  }

  .viewer {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: #171310;
    color: #f3ebdf;
    display: flex;
    flex-direction: column;
    animation: fade 0.2s;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: calc(10px + env(safe-area-inset-top)) 14px 10px;
  }
  .count {
    font-size: 0.8125rem;
    opacity: 0.7;
  }
  .vbtn {
    min-width: 44px;
    height: 44px;
    padding: 0 12px;
    border-radius: 22px;
    border: 0;
    background: rgba(255, 255, 255, 0.12);
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.8125rem;
  }
  .vbtn.sure {
    background: #a8321f;
    color: #fff;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
  }
  .stage img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 22px;
    border: 0;
    background: rgba(23, 19, 16, 0.55);
    color: #fff;
    display: grid;
    place-items: center;
  }
  .prev {
    left: 10px;
  }
  .next {
    right: 10px;
  }
  .cap {
    padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cap input {
    width: 100%;
    min-height: 46px;
    padding: 0 14px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    font-size: 1rem;
  }
  .cap input::placeholder {
    color: rgba(243, 235, 223, 0.5);
  }
  .by {
    font-size: 0.75rem;
    opacity: 0.6;
  }
</style>
