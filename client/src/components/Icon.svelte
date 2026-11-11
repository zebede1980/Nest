<script lang="ts" module>
  // Line icons, all drawn on a 24-unit grid.
  const PATHS = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    jobs: 'M10 6h10M10 12h10M10 18h10M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17',
    rooms: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M14.5 12v.5',
    shopping: 'M4 9h16l-1.6 10.2a1 1 0 0 1-1 .8H6.6a1 1 0 0 1-1-.8zM8.5 9 12 3.5 15.5 9M9.5 13v3.5M14.5 13v3.5',
    progress: 'M5 20v-6M12 20V5M19 20V10',
    plus: 'M12 5v14M5 12h14',
    back: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    down: 'M5 9l7 7 7-7',
    up: 'M5 15l7-7 7 7',
    evening: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    weekend: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    bigger: 'M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6',
    dots: 'M5 12h.01M12 12h.01M19 12h.01',
    camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    close: 'M6 6l12 12M18 6 6 18',
    bell: 'M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15zM10 21h4',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
    mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
    idea: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
    note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4',
    trade: 'M14.7 6.3a4 4 0 0 0-5.3 5.3L3.6 17.4a1.5 1.5 0 0 0 2.1 2.1l5.8-5.8a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.2-.5-.5-2.2z',
    settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
    repeat: 'M4 11a8 8 0 0 1 14-4l2 2M20 4v5h-5M20 13a8 8 0 0 1-14 4l-2-2M4 20v-5h5',
    pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    share: 'M12 15V3m0 0L8 7m4-4 4 4M7 10H5v11h14V10h-2',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 20, stroke = 1.9 }: { name: IconName; size?: number; stroke?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={name === 'dots' ? 3 : stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
