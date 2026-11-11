<script lang="ts">
  // How far along: a ring that fills clockwise from the top.
  let { pct, size = 72, stroke = 8, label }: { pct: number; size?: number; stroke?: number; label: string } = $props();
  const r = $derived((size - stroke) / 2);
  const c = $derived(2 * Math.PI * r);
</script>

<div class="ring" style="width:{size}px;height:{size}px" role="img" aria-label={label}>
  <svg width={size} height={size} viewBox="0 0 {size} {size}">
    <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="var(--track)" stroke-width={stroke} />
    <circle
      class="arc"
      cx={size / 2}
      cy={size / 2}
      {r}
      fill="none"
      stroke="var(--accent)"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray={c}
      stroke-dashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)}
      transform="rotate(-90 {size / 2} {size / 2})"
      opacity={pct > 0 ? 1 : 0}
    />
  </svg>
  <span class="figure" style="font-size:{Math.round(size * 0.24)}px">{pct}%</span>
</div>

<style>
  .ring {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
  }
  svg {
    position: absolute;
    inset: 0;
  }
  .arc {
    transition: stroke-dashoffset 0.8s var(--ease);
  }
  span {
    position: relative;
  }
</style>
