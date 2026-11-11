// The app's shared state: who's signed in, the whole house, and the
// "do it, show a toast with Undo, refresh" pattern.

import { ApiError, get, post, put, whenSignedOut } from './api';
import { setBadge } from './push';
import type { Cost, House, Job, Me, Size, Step, UserSettings } from '../../../shared/model';

export interface MeFull extends Me {
  hasPassword: boolean;
  settings: UserSettings;
}

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
  undo?: () => Promise<unknown>;
}

/** The add/edit job sheet: a job to edit, or how a new one should start. */
export interface JobSheetState {
  job?: Job;
  roomId?: number | null;
  size?: Size;
  idea?: boolean;
}

export const app = $state({
  loaded: false,
  me: null as MeFull | null,
  appName: 'Nest',
  house: null as House | null,
  toast: null as Toast | null,
  jobSheet: null as JobSheetState | null,
});

whenSignedOut(() => {
  app.me = null;
  app.house = null;
  app.jobSheet = null;
});

export async function loadMe(): Promise<void> {
  const r = await get<{ user: MeFull | null; appName: string }>('/api/me');
  app.me = r.user;
  app.appName = r.appName;
  app.loaded = true;
}

/** Fetches the whole house again. Everything on screen is worked out from it. */
export async function refresh(): Promise<void> {
  const { house } = await get<{ house: House }>('/api/house');
  app.house = house;
  setBadge(house.badge);
}

export const photoUrl = (id: number) => `/api/photos/${id}`;
export const thumbUrl = (id: number) => `/api/photos/${id}/thumb`;

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, opts: { undo?: () => Promise<unknown>; kind?: Toast['kind']; ms?: number } = {}): void {
  clearTimeout(toastTimer);
  const id = ++toastSeq;
  app.toast = { id, text, kind: opts.kind ?? 'ok', undo: opts.undo };
  toastTimer = setTimeout(() => {
    if (app.toast?.id === id) app.toast = null;
  }, opts.ms ?? (opts.undo ? 8_000 : 3_500));
}

export function showError(err: unknown): void {
  if (err instanceof ApiError && err.status === 401) return;
  toast(err instanceof Error ? err.message : 'Something went wrong.', { kind: 'error', ms: 6000 });
}

function undoer(undo: () => Promise<unknown>): () => Promise<void> {
  return async () => {
    try {
      await undo();
      await refresh();
      toast('Undone', { kind: 'info' });
    } catch (err) {
      showError(err);
    }
  };
}

/** Runs an action, refreshes, and shows `message` (with Undo when `undo` is given). */
export async function act<T>(run: () => Promise<T>, message?: string | ((r: T) => string), undo?: (r: T) => Promise<unknown>): Promise<T | undefined> {
  try {
    const result = await run();
    await refresh();
    if (message) toast(typeof message === 'function' ? message(result) : message, { undo: undo ? undoer(() => undo(result)) : undefined });
    return result;
  } catch (err) {
    showError(err);
    // Put back anything changed on screen ahead of the server.
    void refresh().catch(() => {});
    return undefined;
  }
}

const DONE_LINES = ['Nice one!', 'Ticked off!', 'Done and dusted.', 'One less to think about.', 'Lovely.', 'That’s that sorted.'];

/** Ticks a job done (or not done after all). The tick shows at once; the server catches up. */
export async function toggleJob(job: Job): Promise<void> {
  const done = job.status !== 'done';
  const mine = app.house?.jobs.find((j) => j.id === job.id);
  if (mine) {
    mine.status = done ? 'done' : 'todo';
    mine.doneAt = done ? Date.now() : null;
    mine.doneBy = done ? (app.me?.id ?? null) : null;
  }
  await act(
    () => post(`/api/jobs/${job.id}/done`, { done }),
    done ? `✓ ${DONE_LINES[Math.floor(Math.random() * DONE_LINES.length)]}` : 'Back on the list',
    done ? () => post(`/api/jobs/${job.id}/done`, { done: false }) : undefined,
  );
}

export async function toggleStep(step: Step): Promise<void> {
  const done = !step.doneAt;
  const mine = app.house?.jobs.find((j) => j.id === step.jobId)?.steps.find((s) => s.id === step.id);
  if (mine) mine.doneAt = done ? Date.now() : null;
  await act(() => put(`/api/steps/${step.id}`, { done }));
}

export async function toggleBought(cost: Cost): Promise<void> {
  const bought = !cost.boughtAt;
  const mine = app.house?.jobs.find((j) => j.id === cost.jobId)?.costs.find((c) => c.id === cost.id);
  if (mine) mine.boughtAt = bought ? Date.now() : null;
  await act(
    () => put(`/api/costs/${cost.id}`, { bought }),
    bought ? `Bought: ${cost.label}` : undefined,
    bought ? () => put(`/api/costs/${cost.id}`, { bought: false }) : undefined,
  );
}

/** Opened from a notification (?n=12): say so, then tidy the address. */
export function noteOpenedFromPush(query: URLSearchParams): void {
  const n = query.get('n');
  if (!n || !/^\d+$/.test(n)) return;
  void post(`/api/notifications/${n}/opened`).catch(() => {});
  const url = new URL(location.href);
  url.searchParams.delete('n');
  history.replaceState(history.state, '', url.pathname + url.search);
}
