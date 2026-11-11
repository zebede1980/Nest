// A tiny router over the address bar, so a notification can open /i/12 directly.

export const route = $state({ path: location.pathname, query: new URLSearchParams(location.search) });

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const url = new URL(path, location.origin);
  if (url.pathname + url.search === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', url.pathname + url.search);
  else history.pushState(null, '', url.pathname + url.search);
  route.path = url.pathname;
  route.query = url.searchParams;
  window.scrollTo({ top: 0 });
}

export function back(fallback = '/'): void {
  if (history.length > 1 && history.state !== 'root') history.back();
  else navigate(fallback, { replace: true });
}

window.addEventListener('popstate', () => {
  route.path = location.pathname;
  route.query = new URLSearchParams(location.search);
});

/** `/i/12` → 12 for pattern `/i/:id`. */
export function param(pattern: string): number | null {
  const re = new RegExp('^' + pattern.replace(':id', '(\\d+)') + '$');
  const m = route.path.match(re);
  return m ? Number(m[1]) : null;
}
